use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
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
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    sessions: Arc<RwLock<HashMap<String, SessionRecord>>>,
    settings: Arc<RwLock<WindowsTerminalSettings>>,
    settings_path: Arc<PathBuf>,
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

#[derive(Debug, Clone, Serialize)]
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
    #[serde(default, alias = "profile_id")]
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
    Output { data: String },
    Resized { cols: u16, rows: u16 },
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtWindowTheme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    application_theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    use_mica: Option<bool>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtTabRowTheme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    unfocused_background: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtProfiles {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    defaults: Option<WtProfileDefaults>,
    list: Vec<WtProfile>,
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
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3001);

    let settings_path = default_settings_path();
    let settings = load_settings(&settings_path).expect("failed to load settings");
    let sessions = seed_sessions(&settings);

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

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("failed to bind TCP listener");

    println!("webpty server listening on http://127.0.0.1:{port}");

    axum::serve(listener, app)
        .await
        .expect("server failed unexpectedly");
}

async fn root() -> &'static str {
    "webpty server"
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        message: "WT-compatible contract server ready".to_string(),
        websocket_path: "/ws/:sessionId".to_string(),
        mode: "settings-contract".to_string(),
        features: vec![
            "health",
            "settings-read",
            "settings-write",
            "sessions-list",
            "sessions-create-delete",
            "websocket-transcript-replay",
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
        (StatusCode::BAD_REQUEST, format!("invalid settings payload: {message}"))
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
        let mut sessions = state.sessions.write().await;
        for session in sessions.values_mut() {
            if resolve_profile(&normalized, &session.profile_id).is_none() {
                session.profile_id = normalized.default_profile.clone();
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
        .map(|session| (session.sort_index, session.summary()))
        .collect::<Vec<_>>();

    sessions.sort_by_key(|(sort_index, _)| *sort_index);

    Json(SessionsResponse {
        sessions: sessions.into_iter().map(|(_, summary)| summary).collect(),
    })
}

async fn create_session(
    State(state): State<AppState>,
    Json(payload): Json<CreateSessionRequest>,
) -> Result<Json<CreateSessionResponse>, (StatusCode, String)> {
    let settings = state.settings.read().await.clone();
    let profile_id = resolve_requested_profile_id(&settings, payload.profile_id.as_deref()).ok_or((
        StatusCode::BAD_REQUEST,
        "unknown profileId and no defaultProfile available".to_string(),
    ))?;
    let profile = resolve_profile(&settings, &profile_id).ok_or((
        StatusCode::BAD_REQUEST,
        format!("profile `{profile_id}` is not defined in settings"),
    ))?;
    let title = payload
        .title
        .unwrap_or_else(|| format!("{}-tab", slugify(&profile.name)));
    let cwd = payload.cwd.unwrap_or_else(|| "~/projects/webpty".to_string());
    let transcript = seeded_transcript(&title, &profile.name, &cwd, profile.commandline.as_deref());
    let sort_index = {
        let sessions = state.sessions.read().await;
        sessions
            .values()
            .map(|session| session.sort_index)
            .max()
            .unwrap_or(0)
            + 1
    };
    let record = SessionRecord {
        id: format!("session-{}", Uuid::new_v4().simple()),
        title: title.clone(),
        profile_id: profile_id.clone(),
        cwd: cwd.clone(),
        status: "running".to_string(),
        has_activity: false,
        last_used_label: "Now".to_string(),
        sort_index,
        transcript,
    };

    let summary = record.summary();

    state
        .sessions
        .write()
        .await
        .insert(record.id.clone(), record.clone());

    Ok(Json(CreateSessionResponse {
        tab: PrototypeTab {
            id: format!("tab-{}", Uuid::new_v4().simple()),
            title,
            profile_id: profile_id.clone(),
        },
        pane: PrototypePane {
            id: format!("pane-{}", Uuid::new_v4().simple()),
            session_id: record.id.clone(),
            title: record.title.clone(),
        },
        session: summary,
    }))
}

async fn delete_session(
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
) -> StatusCode {
    let deleted = state.sessions.write().await.remove(&session_id).is_some();

    if deleted {
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
    let exists = state.sessions.read().await.contains_key(&session_id);

    if !exists {
        return StatusCode::NOT_FOUND.into_response();
    }

    ws.on_upgrade(move |socket| handle_socket(socket, session_id, state))
}

async fn handle_socket(socket: WebSocket, session_id: String, state: AppState) {
    let (summary, transcript) = {
        let mut sessions = state.sessions.write().await;
        let Some(session) = sessions.get_mut(&session_id) else {
            return;
        };

        session.has_activity = false;
        session.last_used_label = "Now".to_string();
        (session.summary(), session.transcript.clone())
    };

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

    if send_json(&mut sender, &ServerMessage::Output { data: transcript })
        .await
        .is_err()
    {
        return;
    }

    while let Some(Ok(message)) = receiver.next().await {
        match message {
            Message::Text(payload) => {
                let Ok(client_message) = serde_json::from_str::<ClientMessage>(&payload) else {
                    continue;
                };

                match client_message {
                    ClientMessage::Input { data } => {
                        let delta = {
                            let mut sessions = state.sessions.write().await;
                            let Some(session) = sessions.get_mut(&session_id) else {
                                break;
                            };

                            session.last_used_label = "Now".to_string();
                            let appended = format!(
                                "$ {}\r\nmock transport received input for {}\r\n",
                                data.trim_end(),
                                session.title
                            );
                            session.transcript.push_str(&appended);
                            appended
                        };

                        if send_json(&mut sender, &ServerMessage::Output { data: delta })
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    ClientMessage::Resize { cols, rows } => {
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
            Message::Close(_) => break,
            _ => {}
        }
    }
}

async fn send_json(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    payload: &ServerMessage,
) -> Result<(), axum::Error> {
    let serialized = serde_json::to_string(payload)
        .expect("server websocket payload should always serialize");

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

fn seed_sessions(settings: &WindowsTerminalSettings) -> HashMap<String, SessionRecord> {
    let profiles = settings
        .profiles
        .list
        .iter()
        .filter(|profile| profile.hidden != Some(true))
        .collect::<Vec<_>>();

    let default_profile_id =
        resolve_requested_profile_id(settings, Some(&settings.default_profile)).unwrap_or_else(|| {
            profile_key(
                profiles
                    .first()
                    .copied()
                    .unwrap_or(&settings.profiles.list[0]),
            )
        });

    let shell_profile = resolve_profile(settings, &default_profile_id)
        .or_else(|| profiles.first().copied())
        .unwrap_or(&settings.profiles.list[0]);
    let ops_profile = profiles
        .get(1)
        .copied()
        .or_else(|| profiles.first().copied())
        .unwrap_or(&settings.profiles.list[0]);
    let notes_profile = profiles
        .get(2)
        .copied()
        .or_else(|| profiles.last().copied())
        .unwrap_or(&settings.profiles.list[0]);

    HashMap::from([
        (
            "session-shell".to_string(),
            SessionRecord {
                id: "session-shell".to_string(),
                title: "workspace-shell".to_string(),
                profile_id: profile_key(shell_profile),
                cwd: "~/projects/webpty".to_string(),
                status: "running".to_string(),
                has_activity: false,
                last_used_label: "Now".to_string(),
                sort_index: 0,
                transcript: "webpty connected\r\n$ cargo run --manifest-path apps/server/Cargo.toml\r\nWT-compatible server ready\r\n$ npm run dev:web\r\nVite preview connected\r\n".to_string(),
            },
        ),
        (
            "session-ops".to_string(),
            SessionRecord {
                id: "session-ops".to_string(),
                title: "deploy-watch".to_string(),
                profile_id: profile_key(ops_profile),
                cwd: "~/deploy/staging".to_string(),
                status: "attention".to_string(),
                has_activity: true,
                last_used_label: "Updated".to_string(),
                sort_index: 1,
                transcript: "kubectl get pods\r\napi-7d4bf6cd7-ptfsw   1/1 Running\r\nws-6f479cb4cc-gbr7j  1/1 Running\r\nwarning: rollout pending\r\n".to_string(),
            },
        ),
        (
            "session-notes".to_string(),
            SessionRecord {
                id: "session-notes".to_string(),
                title: "release-notes".to_string(),
                profile_id: profile_key(notes_profile),
                cwd: "~/projects/webpty/docs".to_string(),
                status: "idle".to_string(),
                has_activity: false,
                last_used_label: "Recent".to_string(),
                sort_index: 2,
                transcript:
                    "# release notes\r\n- add settings.json persistence\r\n- align websocket sessionId casing\r\n- switch UI to WT-style tabs\r\n"
                        .to_string(),
            },
        ),
    ])
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

fn seeded_transcript(title: &str, profile_name: &str, cwd: &str, commandline: Option<&str>) -> String {
    format!(
        "webpty connected\r\nsession: {title}\r\nprofile: {profile_name}\r\ncwd: {cwd}\r\ncommandline: {}\r\n\r\nmock transport ready\r\n",
        commandline.unwrap_or("default shell")
    )
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
                }),
                tab: Some(WtTabTheme {
                    background: Some("#1c2633".to_string()),
                    unfocused_background: Some("#10161f".to_string()),
                    show_close_button: Some("hover".to_string()),
                }),
                tab_row: Some(WtTabRowTheme {
                    background: Some("#0f141d".to_string()),
                    unfocused_background: Some("#0b1017".to_string()),
                }),
            },
            WtTheme {
                name: "Paperlight".to_string(),
                window: Some(WtWindowTheme {
                    application_theme: Some("light".to_string()),
                    use_mica: None,
                }),
                tab: Some(WtTabTheme {
                    background: Some("#e8eef7".to_string()),
                    unfocused_background: Some("#f6f8fb".to_string()),
                    show_close_button: Some("hover".to_string()),
                }),
                tab_row: Some(WtTabRowTheme {
                    background: Some("#eef3f8".to_string()),
                    unfocused_background: Some("#f7f9fb".to_string()),
                }),
            },
            WtTheme {
                name: "Blueprint".to_string(),
                window: Some(WtWindowTheme {
                    application_theme: Some("dark".to_string()),
                    use_mica: None,
                }),
                tab: Some(WtTabTheme {
                    background: Some("#18273d".to_string()),
                    unfocused_background: Some("#101723".to_string()),
                    show_close_button: Some("always".to_string()),
                }),
                tab_row: Some(WtTabRowTheme {
                    background: Some("#0e1320".to_string()),
                    unfocused_background: Some("#0a0f18".to_string()),
                }),
            },
        ],
        actions: vec![
            WtAction {
                command: Some("newTab".to_string()),
                keys: vec!["ctrl+t".to_string()],
                name: None,
            },
            WtAction {
                command: Some("closeTab".to_string()),
                keys: vec!["ctrl+w".to_string()],
                name: None,
            },
            WtAction {
                command: Some("nextTab".to_string()),
                keys: vec!["ctrl+tab".to_string()],
                name: None,
            },
            WtAction {
                command: Some("prevTab".to_string()),
                keys: vec!["ctrl+shift+tab".to_string()],
                name: None,
            },
            WtAction {
                command: Some("openSettings".to_string()),
                keys: vec!["ctrl+,".to_string()],
                name: None,
            },
        ],
        profiles: WtProfiles {
            defaults: Some(WtProfileDefaults {
                font_face: Some("Cascadia Mono".to_string()),
                font_size: Some(13.0),
                line_height: Some(1.22),
                cursor_shape: Some("bar".to_string()),
                opacity: Some(92.0),
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
                },
            ],
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
            },
        ],
    }
}
