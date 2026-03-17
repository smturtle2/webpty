use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock as StdRwLock},
    thread,
};

use axum::{
    Json, Router,
    extract::{
        Path as AxumPath, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get},
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use tokio::sync::{RwLock, broadcast};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    sessions: Arc<RwLock<HashMap<String, Arc<SessionState>>>>,
    settings: Arc<RwLock<WindowsTerminalSettings>>,
    settings_path: Arc<PathBuf>,
}

struct SessionState {
    meta: StdRwLock<SessionRecord>,
    runtime: SessionRuntime,
}

struct SessionRuntime {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send>>>,
    events: broadcast::Sender<String>,
}

#[derive(Debug, Clone)]
struct SessionRecord {
    id: String,
    title: String,
    profile_id: String,
    cwd: String,
    status: String,
    has_activity: bool,
    last_used_label: String,
    sort_index: usize,
    transcript: String,
}

impl SessionRecord {
    fn summary(&self) -> SessionSummary {
        SessionSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            profile_id: self.profile_id.clone(),
            cwd: self.cwd.clone(),
            status: self.status.clone(),
            has_activity: self.has_activity,
            last_used_label: self.last_used_label.clone(),
            preview_lines: preview_lines(&self.transcript),
        }
    }
}

impl SessionState {
    fn summary(&self) -> SessionSummary {
        self.meta
            .read()
            .expect("session summary lock poisoned")
            .summary()
    }

    fn snapshot(&self) -> (SessionSummary, String) {
        let meta = self.meta.read().expect("session snapshot lock poisoned");
        (meta.summary(), meta.transcript.clone())
    }

    fn sort_index(&self) -> usize {
        self.meta
            .read()
            .expect("session sort index lock poisoned")
            .sort_index
    }

    fn mark_attached(&self) {
        let mut meta = self.meta.write().expect("session attach lock poisoned");
        meta.has_activity = false;
        meta.last_used_label = "Now".to_string();
    }

    fn subscribe(&self) -> broadcast::Receiver<String> {
        self.runtime.events.subscribe()
    }

    fn write_input(&self, data: &str) -> Result<(), String> {
        {
            let mut writer = self
                .runtime
                .writer
                .lock()
                .map_err(|_| "input writer lock poisoned".to_string())?;
            writer
                .write_all(data.as_bytes())
                .and_then(|_| writer.flush())
                .map_err(|error| format!("failed to write input to PTY: {error}"))?;
        }

        let mut meta = self.meta.write().expect("session input lock poisoned");
        meta.last_used_label = "Now".to_string();
        Ok(())
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.runtime
            .master
            .lock()
            .map_err(|_| "PTY master lock poisoned".to_string())?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("failed to resize PTY: {error}"))
    }

    fn append_output(&self, output: &str) {
        if output.is_empty() {
            return;
        }

        {
            let mut meta = self.meta.write().expect("session output lock poisoned");
            meta.transcript.push_str(output);
            meta.has_activity = true;
            if meta.last_used_label != "Now" {
                meta.last_used_label = "Updated".to_string();
            }
        }

        let _ = self.runtime.events.send(output.to_string());
    }

    fn mark_exited(&self, status: String) {
        let mut meta = self.meta.write().expect("session exit lock poisoned");
        meta.status = "idle".to_string();
        meta.has_activity = true;
        meta.last_used_label = status;
    }

    fn update_profile_if_missing(&self, next_profile_id: &str) {
        let mut meta = self.meta.write().expect("session profile lock poisoned");
        meta.profile_id = next_profile_id.to_string();
    }

    fn terminate(&self) {
        if let Ok(mut child) = self.runtime.child.lock() {
            let _ = child.kill();
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSummary {
    id: String,
    title: String,
    profile_id: String,
    cwd: String,
    status: String,
    has_activity: bool,
    last_used_label: String,
    preview_lines: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionsResponse {
    sessions: Vec<SessionSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: String,
    message: String,
    websocket_path: String,
    mode: String,
    features: Vec<&'static str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    #[serde(default, alias = "profile_id", alias = "profileId")]
    profile_id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionResponse {
    session: SessionSummary,
    tab: PrototypeTab,
    pane: PrototypePane,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrototypeTab {
    id: String,
    title: String,
    profile_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrototypePane {
    id: String,
    session_id: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ClientMessage {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
    Ping,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ServerMessage {
    Ready {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Output {
        data: String,
    },
    Resized {
        cols: u16,
        rows: u16,
    },
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsTerminalSettings {
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    schema: Option<String>,
    default_profile: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    copy_formatting: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    theme: Option<ThemeSelection>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    themes: Vec<WtTheme>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    actions: Vec<WtAction>,
    profiles: WtProfiles,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    schemes: Vec<WtColorScheme>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum ThemeSelection {
    Named(String),
    System {
        #[serde(default)]
        dark: Option<String>,
        #[serde(default)]
        light: Option<String>,
        #[serde(default)]
        system: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtTheme {
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    window: Option<WtWindowTheme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tab: Option<WtTabTheme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tab_row: Option<WtTabRowTheme>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtWindowTheme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    application_theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    use_mica: Option<bool>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtTabTheme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    unfocused_background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    show_close_button: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtTabRowTheme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    unfocused_background: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtAction {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtProfiles {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    defaults: Option<WtProfileDefaults>,
    list: Vec<WtProfile>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WtProfileDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font_face: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    line_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor_shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    opacity: Option<f64>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtProfile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    guid: Option<String>,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    commandline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    starting_directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tab_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color_scheme: Option<SchemeSelection>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum SchemeSelection {
    Named(String),
    System {
        #[serde(default)]
        dark: Option<String>,
        #[serde(default)]
        light: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtColorScheme {
    name: String,
    background: String,
    foreground: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    selection_background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    black: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    red: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    green: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    yellow: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    blue: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    purple: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cyan: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    white: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bright_black: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bright_red: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bright_green: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bright_yellow: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bright_blue: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bright_purple: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bright_cyan: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bright_white: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

struct LaunchPlan {
    command: CommandBuilder,
    command_label: String,
    fallback_command: Option<CommandBuilder>,
    fallback_label: Option<String>,
    cwd: PathBuf,
    notes: Vec<String>,
}

struct SpawnedPty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
    reader: Box<dyn Read + Send>,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("webpty server failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3001);

    let settings_path = default_settings_path();
    let settings = load_settings(&settings_path).unwrap_or_else(|error| {
        eprintln!(
            "failed to load settings from {}: {error}. Falling back to defaults.",
            settings_path.display()
        );
        let defaults =
            normalize_settings(default_settings()).expect("default settings should be valid");
        let _ = persist_settings(&settings_path, &defaults);
        defaults
    });
    let sessions = seed_sessions(&settings).unwrap_or_else(|error| {
        eprintln!("failed to seed PTY sessions: {error}");
        HashMap::new()
    });

    let state = AppState {
        sessions: Arc::new(RwLock::new(sessions)),
        settings: Arc::new(RwLock::new(settings)),
        settings_path: Arc::new(settings_path),
    };

    let app = Router::new()
        .route("/", get(root))
        .route("/api/health", get(health))
        .route("/api/settings", get(get_settings).put(update_settings))
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route("/api/sessions/{session_id}", delete(delete_session))
        .route("/ws/{session_id}", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;

    println!("webpty server listening on http://127.0.0.1:{port}");

    axum::serve(listener, app).await?;
    Ok(())
}

async fn root() -> &'static str {
    "webpty PTY server"
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        message: "WT-compatible PTY server ready".to_string(),
        websocket_path: "/ws/:sessionId".to_string(),
        mode: "pty-runtime".to_string(),
        features: vec![
            "health",
            "settings-read",
            "settings-write",
            "sessions-list",
            "sessions-create-delete",
            "websocket-live-pty",
            "pty-resize-input-output",
        ],
    })
}

async fn get_settings(State(state): State<AppState>) -> Json<WindowsTerminalSettings> {
    Json(state.settings.read().await.clone())
}

async fn update_settings(
    State(state): State<AppState>,
    Json(payload): Json<WindowsTerminalSettings>,
) -> Result<Json<WindowsTerminalSettings>, (StatusCode, String)> {
    let normalized = normalize_settings(payload).map_err(|message| {
        (
            StatusCode::BAD_REQUEST,
            format!("invalid settings payload: {message}"),
        )
    })?;

    persist_settings(&state.settings_path, &normalized).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to persist settings: {error}"),
        )
    })?;

    {
        let mut settings = state.settings.write().await;
        *settings = normalized.clone();
    }

    {
        let sessions = state.sessions.read().await;
        for session in sessions.values() {
            let profile_id = session.summary().profile_id;
            if resolve_profile(&normalized, &profile_id).is_none() {
                session.update_profile_if_missing(&normalized.default_profile);
            }
        }
    }

    Ok(Json(normalized))
}

async fn list_sessions(State(state): State<AppState>) -> Json<SessionsResponse> {
    let mut sessions = state
        .sessions
        .read()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();

    sessions.sort_by_key(|session| session.sort_index());

    Json(SessionsResponse {
        sessions: sessions
            .into_iter()
            .map(|session| session.summary())
            .collect(),
    })
}

async fn create_session(
    State(state): State<AppState>,
    Json(payload): Json<CreateSessionRequest>,
) -> Result<Json<CreateSessionResponse>, (StatusCode, String)> {
    let settings = state.settings.read().await.clone();
    let profile_id =
        resolve_requested_profile_id(&settings, payload.profile_id.as_deref()).ok_or((
            StatusCode::BAD_REQUEST,
            "unknown profileId and no defaultProfile available".to_string(),
        ))?;
    let profile = resolve_profile(&settings, &profile_id).cloned().ok_or((
        StatusCode::BAD_REQUEST,
        format!("profile `{profile_id}` is not defined in settings"),
    ))?;
    if profile.hidden.unwrap_or(false) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("profile `{}` is hidden and cannot be launched", profile.name),
        ));
    }
    let title = payload
        .title
        .unwrap_or_else(|| format!("{}-tab", slugify(&profile.name)));
    let sort_index = {
        let sessions = state.sessions.read().await;
        sessions
            .values()
            .map(|session| session.sort_index())
            .max()
            .unwrap_or(0)
            + 1
    };

    let session = spawn_session(
        &settings,
        format!("session-{}", Uuid::new_v4().simple()),
        title.clone(),
        profile_id.clone(),
        payload.cwd,
        sort_index,
    )
    .map_err(|message| (StatusCode::INTERNAL_SERVER_ERROR, message))?;

    let summary = session.summary();

    state
        .sessions
        .write()
        .await
        .insert(summary.id.clone(), session);

    Ok(Json(CreateSessionResponse {
        tab: PrototypeTab {
            id: format!("tab-{}", Uuid::new_v4().simple()),
            title,
            profile_id: profile_id.clone(),
        },
        pane: PrototypePane {
            id: format!("pane-{}", Uuid::new_v4().simple()),
            session_id: summary.id.clone(),
            title: summary.title.clone(),
        },
        session: summary,
    }))
}

async fn delete_session(
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
) -> StatusCode {
    let removed = state.sessions.write().await.remove(&session_id);

    if let Some(session) = removed {
        session.terminate();
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
) -> Response {
    let session = state.sessions.read().await.get(&session_id).cloned();

    match session {
        Some(session) => ws.on_upgrade(move |socket| handle_socket(socket, session)),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn handle_socket(socket: WebSocket, session: Arc<SessionState>) {
    session.mark_attached();
    let (summary, transcript) = session.snapshot();
    let mut events = session.subscribe();
    let (mut sender, mut receiver) = socket.split();

    if send_json(
        &mut sender,
        &ServerMessage::Ready {
            session_id: summary.id.clone(),
        },
    )
    .await
    .is_err()
    {
        return;
    }

    if !transcript.is_empty()
        && send_json(&mut sender, &ServerMessage::Output { data: transcript })
            .await
            .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            maybe_message = receiver.next() => {
                let Some(message) = maybe_message else {
                    break;
                };

                match message {
                    Ok(Message::Text(payload)) => {
                        let Ok(client_message) = serde_json::from_str::<ClientMessage>(&payload) else {
                            continue;
                        };

                        match client_message {
                            ClientMessage::Input { data } => {
                                if let Err(error) = session.write_input(&data) {
                                    let _ = send_json(
                                        &mut sender,
                                        &ServerMessage::Output {
                                            data: format!("\r\n[webpty] {error}\r\n"),
                                        },
                                    )
                                    .await;
                                    break;
                                }
                            }
                            ClientMessage::Resize { cols, rows } => {
                                if session.resize(cols, rows).is_err() {
                                    continue;
                                }

                                if send_json(&mut sender, &ServerMessage::Resized { cols, rows })
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            ClientMessage::Ping => {
                                if send_json(&mut sender, &ServerMessage::Pong).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(output) => {
                        if send_json(&mut sender, &ServerMessage::Output { data: output })
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn send_json(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    payload: &ServerMessage,
) -> Result<(), axum::Error> {
    let serialized =
        serde_json::to_string(payload).expect("server websocket payload should always serialize");

    sender.send(Message::Text(serialized.into())).await
}

fn default_settings_path() -> PathBuf {
    env::var("WEBPTY_SETTINGS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("config/webpty.settings.json"))
}

fn load_settings(path: &Path) -> Result<WindowsTerminalSettings, Box<dyn std::error::Error>> {
    if !path.exists() {
        let defaults = normalize_settings(default_settings())?;
        persist_settings(path, &defaults)?;
        return Ok(defaults);
    }

    let contents = fs::read_to_string(path)?;
    let parsed = serde_json::from_str::<WindowsTerminalSettings>(&contents)?;
    Ok(normalize_settings(parsed)?)
}

fn persist_settings(
    path: &Path,
    settings: &WindowsTerminalSettings,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}

fn normalize_settings(
    mut settings: WindowsTerminalSettings,
) -> Result<WindowsTerminalSettings, Box<dyn std::error::Error>> {
    if settings.profiles.list.is_empty() {
        return Err("profiles.list must contain at least one profile".into());
    }

    let defaults = default_settings();

    if settings.themes.is_empty() {
        settings.themes = defaults.themes;
    }

    if settings.actions.is_empty() {
        settings.actions = defaults.actions;
    }

    if settings.schemes.is_empty() {
        settings.schemes = defaults.schemes;
    }

    if resolve_requested_profile_id(&settings, Some(&settings.default_profile)).is_none() {
        settings.default_profile = profile_key(&settings.profiles.list[0]);
    }

    Ok(settings)
}

fn seed_sessions(
    settings: &WindowsTerminalSettings,
) -> Result<HashMap<String, Arc<SessionState>>, String> {
    let default_profile_id =
        resolve_requested_profile_id(settings, Some(&settings.default_profile))
            .unwrap_or_else(|| profile_key(&settings.profiles.list[0]));

    let session = spawn_session(
        settings,
        "session-shell".to_string(),
        "workspace-shell".to_string(),
        default_profile_id,
        None,
        0,
    )?;

    Ok(HashMap::from([("session-shell".to_string(), session)]))
}

fn spawn_session(
    settings: &WindowsTerminalSettings,
    id: String,
    title: String,
    profile_id: String,
    cwd_override: Option<String>,
    sort_index: usize,
) -> Result<Arc<SessionState>, String> {
    let profile = resolve_profile(settings, &profile_id)
        .cloned()
        .ok_or_else(|| format!("profile `{profile_id}` is not defined"))?;
    let mut plan = build_launch_plan(&profile, cwd_override);
    let spawned = spawn_pty(&mut plan)?;
    let (events, _) = broadcast::channel(128);
    let state = Arc::new(SessionState {
        meta: StdRwLock::new(SessionRecord {
            id,
            title: title.clone(),
            profile_id,
            cwd: plan.cwd.display().to_string(),
            status: "running".to_string(),
            has_activity: false,
            last_used_label: "Now".to_string(),
            sort_index,
            transcript: session_banner(&title, &profile.name, &plan),
        }),
        runtime: SessionRuntime {
            master: Arc::new(Mutex::new(spawned.master)),
            writer: Arc::new(Mutex::new(spawned.writer)),
            child: Arc::new(Mutex::new(spawned.child)),
            events,
        },
    });

    spawn_reader(state.clone(), spawned.reader);
    spawn_waiter(state.clone());

    Ok(state)
}

fn build_launch_plan(profile: &WtProfile, cwd_override: Option<String>) -> LaunchPlan {
    let mut notes = Vec::new();
    let requested_dir = cwd_override.or_else(|| profile.starting_directory.clone());
    let cwd = resolve_launch_cwd(requested_dir.as_deref(), &mut notes);

    if let Some(commandline) = profile.commandline.as_deref() {
        #[cfg(not(target_os = "windows"))]
        if looks_windows_command(commandline) {
            notes.push(format!(
                "[webpty] `{commandline}` is a Windows-targeted profile. Using the local default shell on this host."
            ));

            return LaunchPlan {
                command: default_shell_builder(),
                command_label: default_shell_label(),
                fallback_command: None,
                fallback_label: None,
                cwd,
                notes,
            };
        }

        let builder =
            command_builder_from_commandline(commandline).unwrap_or_else(default_shell_builder);
        let fallback = default_shell_builder();

        LaunchPlan {
            command: builder,
            command_label: commandline.to_string(),
            fallback_command: Some(fallback.clone()),
            fallback_label: Some(default_shell_label()),
            cwd,
            notes,
        }
    } else {
        LaunchPlan {
            command: default_shell_builder(),
            command_label: default_shell_label(),
            fallback_command: None,
            fallback_label: None,
            cwd,
            notes,
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn looks_windows_command(commandline: &str) -> bool {
    let normalized = commandline.trim().to_ascii_lowercase();
    normalized.ends_with(".exe")
        || normalized.contains(".exe ")
        || normalized.contains('\\')
        || normalized.contains("%userprofile%")
}

fn resolve_launch_cwd(requested: Option<&str>, notes: &mut Vec<String>) -> PathBuf {
    let fallback = env::current_dir()
        .ok()
        .or_else(home_dir)
        .unwrap_or_else(|| PathBuf::from("."));

    let Some(raw) = requested.filter(|value| !value.trim().is_empty()) else {
        return fallback;
    };

    let expanded = expand_path_tokens(raw);
    let candidate = PathBuf::from(&expanded);

    if candidate.exists() {
        return candidate;
    }

    notes.push(format!(
        "[webpty] requested cwd `{raw}` is unavailable. Starting in `{}`.",
        fallback.display()
    ));
    fallback
}

fn expand_path_tokens(value: &str) -> String {
    let mut expanded = value.to_string();

    if let Some(rest) = expanded.strip_prefix('~') {
        if let Some(home) = home_dir() {
            expanded = format!("{}{}", home.display(), rest);
        }
    }

    expand_percent_vars(&expanded)
}

fn expand_percent_vars(value: &str) -> String {
    let mut output = String::new();
    let mut chars = value.chars().peekable();

    while let Some(character) = chars.next() {
        if character != '%' {
            output.push(character);
            continue;
        }

        let mut name = String::new();
        while let Some(&next) = chars.peek() {
            chars.next();
            if next == '%' {
                break;
            }
            name.push(next);
        }

        if name.is_empty() {
            output.push('%');
            continue;
        }

        let replacement = env::var(&name)
            .ok()
            .or_else(|| {
                if name.eq_ignore_ascii_case("userprofile") {
                    env::var("HOME").ok()
                } else {
                    None
                }
            })
            .unwrap_or_else(|| format!("%{name}%"));

        output.push_str(&replacement);
    }

    output
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn command_builder_from_commandline(commandline: &str) -> Option<CommandBuilder> {
    let args = shlex::split(commandline)?;
    let program = args.first()?;
    let mut builder = CommandBuilder::new(program);
    if args.len() > 1 {
        builder.args(args.iter().skip(1));
    }
    Some(builder)
}

fn default_shell_builder() -> CommandBuilder {
    #[cfg(windows)]
    {
        let shell = env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let mut builder = CommandBuilder::new(shell);
        builder.env("TERM", "xterm-256color");
        builder
    }

    #[cfg(not(windows))]
    {
        let preferred_shell = env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let shell = if preferred_shell.contains("bash") || Path::new("/bin/bash").exists() {
            if Path::new(&preferred_shell).exists() {
                preferred_shell
            } else {
                "/bin/bash".to_string()
            }
        } else if Path::new(&preferred_shell).exists() {
            preferred_shell
        } else if Path::new("/bin/sh").exists() {
            "/bin/sh".to_string()
        } else {
            preferred_shell
        };

        let mut builder = CommandBuilder::new(shell);
        builder.env("TERM", "xterm-256color");

        if cfg!(unix) {
            if builder
                .get_argv()
                .first()
                .and_then(|value| value.to_str())
                .is_some_and(|program| program.contains("bash"))
            {
                builder.arg("--noprofile");
                builder.arg("--norc");
            }
            builder.arg("-i");
        }

        builder
    }
}

fn default_shell_label() -> String {
    #[cfg(windows)]
    {
        env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(windows))]
    {
        env::var("SHELL").unwrap_or_else(|_| "/bin/bash -i".to_string())
    }
}

fn spawn_pty(plan: &mut LaunchPlan) -> Result<SpawnedPty, String> {
    let mut primary = plan.command.clone();
    primary.cwd(plan.cwd.as_os_str());

    match spawn_with_builder(&primary) {
        Ok(spawned) => Ok(spawned),
        Err(primary_error) => {
            let Some(mut fallback) = plan.fallback_command.clone() else {
                return Err(format!(
                    "failed to launch `{}` in `{}`: {primary_error}",
                    plan.command_label,
                    plan.cwd.display()
                ));
            };
            fallback.cwd(plan.cwd.as_os_str());

            let fallback_label = plan
                .fallback_label
                .clone()
                .unwrap_or_else(|| "default shell".to_string());

            match spawn_with_builder(&fallback) {
                Ok(spawned) => {
                    plan.notes.push(format!(
                        "[webpty] `{}` could not start ({primary_error}). Falling back to `{fallback_label}`.",
                        plan.command_label
                    ));
                    plan.command_label = fallback_label;
                    plan.command = fallback;
                    plan.fallback_command = None;
                    Ok(spawned)
                }
                Err(fallback_error) => Err(format!(
                    "failed to launch `{}` ({primary_error}) and fallback `{fallback_label}` ({fallback_error})",
                    plan.command_label
                )),
            }
        }
    }
}

fn spawn_with_builder(builder: &CommandBuilder) -> Result<SpawnedPty, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 36,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open PTY: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to clone PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to create PTY writer: {error}"))?;
    let child = pair
        .slave
        .spawn_command(builder.clone())
        .map_err(|error| format!("failed to spawn process: {error}"))?;

    Ok(SpawnedPty {
        master: pair.master,
        writer,
        child,
        reader,
    })
}

fn session_banner(title: &str, profile_name: &str, plan: &LaunchPlan) -> String {
    let mut transcript = format!(
        "webpty connected\r\nsession: {title}\r\nprofile: {profile_name}\r\ncwd: {}\r\ncommandline: {}\r\n",
        plan.cwd.display(),
        plan.command_label
    );

    if !plan.notes.is_empty() {
        transcript.push_str(&plan.notes.join("\r\n"));
        transcript.push_str("\r\n");
    }

    transcript.push_str("\r\n");
    transcript
}

fn spawn_reader(session: Arc<SessionState>, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let output = String::from_utf8_lossy(&buffer[..read]).to_string();
                    session.append_output(&output);
                }
                Err(error) => {
                    session.append_output(&format!("\r\n[webpty] PTY read error: {error}\r\n"));
                    break;
                }
            }
        }
    });
}

fn spawn_waiter(session: Arc<SessionState>) {
    thread::spawn(move || {
        let status = {
            let mut child = match session.runtime.child.lock() {
                Ok(child) => child,
                Err(_) => return,
            };
            child.wait()
        };

        match status {
            Ok(exit_status) => {
                let label = format!("Exited {}", exit_status.exit_code());
                session.mark_exited(label);
                session.append_output(&format!(
                    "\r\n[webpty] process exited with {exit_status}\r\n"
                ));
            }
            Err(error) => {
                session.mark_exited("Exited".to_string());
                session.append_output(&format!(
                    "\r\n[webpty] failed while waiting for process exit: {error}\r\n"
                ));
            }
        }
    });
}

fn resolve_requested_profile_id(
    settings: &WindowsTerminalSettings,
    requested: Option<&str>,
) -> Option<String> {
    let requested = requested.unwrap_or(&settings.default_profile);

    settings
        .profiles
        .list
        .iter()
        .find(|profile| profile_matches(profile, requested))
        .map(profile_key)
}

fn resolve_profile<'a>(
    settings: &'a WindowsTerminalSettings,
    profile_id: &str,
) -> Option<&'a WtProfile> {
    settings
        .profiles
        .list
        .iter()
        .find(|profile| profile_matches(profile, profile_id))
}

fn profile_matches(profile: &WtProfile, requested: &str) -> bool {
    profile_key(profile) == requested || profile.name == requested
}

fn profile_key(profile: &WtProfile) -> String {
    profile
        .guid
        .clone()
        .unwrap_or_else(|| slugify(&profile.name))
}

fn preview_lines(transcript: &str) -> Vec<String> {
    transcript
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn slugify(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn default_settings() -> WindowsTerminalSettings {
    WindowsTerminalSettings {
        schema: Some("https://aka.ms/terminal-profiles-schema".to_string()),
        default_profile: "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}".to_string(),
        copy_formatting: Some("all".to_string()),
        theme: Some(ThemeSelection::Named("Blueprint".to_string())),
        themes: vec![
            WtTheme {
                name: "Graphite".to_string(),
                window: Some(WtWindowTheme {
                    application_theme: Some("dark".to_string()),
                    use_mica: Some(true),
                    extra: JsonMap::new(),
                }),
                tab: Some(WtTabTheme {
                    background: Some("#ffffff".to_string()),
                    unfocused_background: Some("#f1f3f5".to_string()),
                    show_close_button: Some("hover".to_string()),
                    extra: JsonMap::new(),
                }),
                tab_row: Some(WtTabRowTheme {
                    background: Some("#d8dee5".to_string()),
                    unfocused_background: Some("#cfd6de".to_string()),
                    extra: JsonMap::new(),
                }),
                extra: JsonMap::new(),
            },
            WtTheme {
                name: "Paperlight".to_string(),
                window: Some(WtWindowTheme {
                    application_theme: Some("light".to_string()),
                    use_mica: None,
                    extra: JsonMap::new(),
                }),
                tab: Some(WtTabTheme {
                    background: Some("#ffffff".to_string()),
                    unfocused_background: Some("#f7f4ef".to_string()),
                    show_close_button: Some("hover".to_string()),
                    extra: JsonMap::new(),
                }),
                tab_row: Some(WtTabRowTheme {
                    background: Some("#e8ddd0".to_string()),
                    unfocused_background: Some("#ddd2c6".to_string()),
                    extra: JsonMap::new(),
                }),
                extra: JsonMap::new(),
            },
            WtTheme {
                name: "Blueprint".to_string(),
                window: Some(WtWindowTheme {
                    application_theme: Some("dark".to_string()),
                    use_mica: None,
                    extra: JsonMap::new(),
                }),
                tab: Some(WtTabTheme {
                    background: Some("#ffffff".to_string()),
                    unfocused_background: Some("#f4f7fb".to_string()),
                    show_close_button: Some("always".to_string()),
                    extra: JsonMap::new(),
                }),
                tab_row: Some(WtTabRowTheme {
                    background: Some("#dce8f5".to_string()),
                    unfocused_background: Some("#cfdff0".to_string()),
                    extra: JsonMap::new(),
                }),
                extra: JsonMap::new(),
            },
        ],
        actions: vec![
            WtAction {
                command: Some("newTab".to_string()),
                keys: vec!["ctrl+t".to_string()],
                name: None,
                extra: JsonMap::new(),
            },
            WtAction {
                command: Some("closeTab".to_string()),
                keys: vec!["ctrl+w".to_string()],
                name: None,
                extra: JsonMap::new(),
            },
            WtAction {
                command: Some("nextTab".to_string()),
                keys: vec!["ctrl+tab".to_string()],
                name: None,
                extra: JsonMap::new(),
            },
            WtAction {
                command: Some("prevTab".to_string()),
                keys: vec!["ctrl+shift+tab".to_string()],
                name: None,
                extra: JsonMap::new(),
            },
            WtAction {
                command: Some("openSettings".to_string()),
                keys: vec!["ctrl+,".to_string()],
                name: None,
                extra: JsonMap::new(),
            },
        ],
        profiles: WtProfiles {
            defaults: Some(WtProfileDefaults {
                font_face: Some("Cascadia Mono".to_string()),
                font_size: Some(13.0),
                line_height: Some(1.22),
                cursor_shape: Some("bar".to_string()),
                opacity: Some(92.0),
                extra: JsonMap::new(),
            }),
            list: vec![
                WtProfile {
                    guid: Some("{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}".to_string()),
                    name: "PowerShell".to_string(),
                    icon: Some("PS".to_string()),
                    commandline: Some("pwsh.exe".to_string()),
                    starting_directory: Some("%USERPROFILE%".to_string()),
                    source: None,
                    hidden: Some(false),
                    tab_color: Some("#3b78ff".to_string()),
                    color_scheme: Some(SchemeSelection::Named("Campbell".to_string())),
                    extra: JsonMap::new(),
                },
                WtProfile {
                    guid: Some("{5b49f6c2-a5f8-4265-a0f5-d184f3c9a13f}".to_string()),
                    name: "Ubuntu".to_string(),
                    icon: Some("UB".to_string()),
                    commandline: Some("wsl.exe -d Ubuntu".to_string()),
                    starting_directory: Some("~".to_string()),
                    source: None,
                    hidden: Some(false),
                    tab_color: Some("#f0a355".to_string()),
                    color_scheme: Some(SchemeSelection::Named("One Half Dark".to_string())),
                    extra: JsonMap::new(),
                },
                WtProfile {
                    guid: Some("{8f54aa7f-b2cb-4f79-bf9d-5f06dfc7f265}".to_string()),
                    name: "Azure Ops".to_string(),
                    icon: Some("AZ".to_string()),
                    commandline: Some(
                        "pwsh.exe -NoLogo -NoExit -Command kubectl config current-context"
                            .to_string(),
                    ),
                    starting_directory: Some("%USERPROFILE%/deploy".to_string()),
                    source: None,
                    hidden: Some(false),
                    tab_color: Some("#2fbf9b".to_string()),
                    color_scheme: Some(SchemeSelection::Named("Campbell".to_string())),
                    extra: JsonMap::new(),
                },
            ],
            extra: JsonMap::new(),
        },
        schemes: vec![
            WtColorScheme {
                name: "Campbell".to_string(),
                background: "#0c0c0c".to_string(),
                foreground: "#f2f2f2".to_string(),
                cursor_color: Some("#ffffff".to_string()),
                selection_background: Some("#264f78".to_string()),
                black: Some("#0c0c0c".to_string()),
                red: Some("#c50f1f".to_string()),
                green: Some("#13a10e".to_string()),
                yellow: Some("#c19c00".to_string()),
                blue: Some("#0037da".to_string()),
                purple: Some("#881798".to_string()),
                cyan: Some("#3a96dd".to_string()),
                white: Some("#cccccc".to_string()),
                bright_black: Some("#767676".to_string()),
                bright_red: Some("#e74856".to_string()),
                bright_green: Some("#16c60c".to_string()),
                bright_yellow: Some("#f9f1a5".to_string()),
                bright_blue: Some("#3b78ff".to_string()),
                bright_purple: Some("#b4009e".to_string()),
                bright_cyan: Some("#61d6d6".to_string()),
                bright_white: Some("#f2f2f2".to_string()),
                extra: JsonMap::new(),
            },
            WtColorScheme {
                name: "One Half Dark".to_string(),
                background: "#282c34".to_string(),
                foreground: "#dcdfe4".to_string(),
                cursor_color: Some("#dcdfe4".to_string()),
                selection_background: Some("#3e4452".to_string()),
                black: Some("#282c34".to_string()),
                red: Some("#e06c75".to_string()),
                green: Some("#98c379".to_string()),
                yellow: Some("#e5c07b".to_string()),
                blue: Some("#61afef".to_string()),
                purple: Some("#c678dd".to_string()),
                cyan: Some("#56b6c2".to_string()),
                white: Some("#dcdfe4".to_string()),
                bright_black: Some("#5a6374".to_string()),
                bright_red: Some("#ff7b86".to_string()),
                bright_green: Some("#b4d88f".to_string()),
                bright_yellow: Some("#f4d399".to_string()),
                bright_blue: Some("#83c7ff".to_string()),
                bright_purple: Some("#d7a7f0".to_string()),
                bright_cyan: Some("#7ddce7".to_string()),
                bright_white: Some("#f4f7fb".to_string()),
                extra: JsonMap::new(),
            },
            WtColorScheme {
                name: "Nord".to_string(),
                background: "#2e3440".to_string(),
                foreground: "#eceff4".to_string(),
                cursor_color: Some("#d8dee9".to_string()),
                selection_background: Some("#434c5e".to_string()),
                black: Some("#3b4252".to_string()),
                red: Some("#bf616a".to_string()),
                green: Some("#a3be8c".to_string()),
                yellow: Some("#ebcb8b".to_string()),
                blue: Some("#81a1c1".to_string()),
                purple: Some("#b48ead".to_string()),
                cyan: Some("#88c0d0".to_string()),
                white: Some("#e5e9f0".to_string()),
                bright_black: Some("#4c566a".to_string()),
                bright_red: Some("#d06f79".to_string()),
                bright_green: Some("#b1d196".to_string()),
                bright_yellow: Some("#f2d399".to_string()),
                bright_blue: Some("#8cafd2".to_string()),
                bright_purple: Some("#c39dc0".to_string()),
                bright_cyan: Some("#93ccdc".to_string()),
                bright_white: Some("#eceff4".to_string()),
                extra: JsonMap::new(),
            },
        ],
        extra: JsonMap::new(),
    }
}
