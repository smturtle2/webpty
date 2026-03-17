use std::{collections::HashMap, env, sync::Arc};

use axum::{
    Json, Router,
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    sessions: Arc<RwLock<HashMap<String, SessionSummary>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionSummary {
    id: String,
    title: String,
    profile_id: String,
    cwd: String,
    status: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    message: String,
    websocket_path: String,
    mode: String,
    features: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
struct BlueprintResponse {
    profiles: Vec<BlueprintProfile>,
    actions: Vec<BlueprintAction>,
    settings_sections: Vec<BlueprintSection>,
}

#[derive(Debug, Serialize)]
struct BlueprintProfile {
    id: &'static str,
    name: &'static str,
    accent: &'static str,
    shell: &'static str,
}

#[derive(Debug, Serialize)]
struct BlueprintAction {
    id: &'static str,
    title: &'static str,
    shortcut: &'static str,
}

#[derive(Debug, Serialize)]
struct BlueprintSection {
    id: &'static str,
    label: &'static str,
    description: &'static str,
}

#[derive(Debug, Deserialize)]
struct CreateSessionRequest {
    profile_id: Option<String>,
    cwd: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Serialize)]
struct CreateSessionResponse {
    session: SessionSummary,
    tab: PrototypeTab,
    pane: PrototypePane,
}

#[derive(Debug, Serialize)]
struct PrototypeTab {
    id: String,
    title: String,
    profile_id: String,
}

#[derive(Debug, Serialize)]
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
    Ready { session_id: String },
    Output { data: String },
    Resized { cols: u16, rows: u16 },
    Pong,
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3001);

    let state = AppState {
        sessions: Arc::new(RwLock::new(seed_sessions())),
    };

    let app = Router::new()
        .route("/", get(root))
        .route("/api/health", get(health))
        .route("/api/blueprint", get(blueprint))
        .route("/api/sessions", post(create_session))
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
        message: "Axum contract server ready for UI prototype".to_string(),
        websocket_path: "/ws/:session_id".to_string(),
        mode: "mock-transport".to_string(),
        features: vec![
            "health",
            "blueprint",
            "session-create",
            "websocket-seeded-output",
        ],
    })
}

async fn blueprint() -> Json<BlueprintResponse> {
    Json(BlueprintResponse {
        profiles: vec![
            BlueprintProfile {
                id: "shell",
                name: "Design Shell",
                accent: "#ff9b54",
                shell: "zsh --login",
            },
            BlueprintProfile {
                id: "ops",
                name: "Ops Stream",
                accent: "#73e0a9",
                shell: "fish",
            },
            BlueprintProfile {
                id: "notes",
                name: "Release Notes",
                accent: "#71c6ff",
                shell: "markdown-preview",
            },
        ],
        actions: vec![
            BlueprintAction {
                id: "open-settings",
                title: "Open settings studio",
                shortcut: "Ctrl+,",
            },
            BlueprintAction {
                id: "open-search",
                title: "Find in active pane",
                shortcut: "Ctrl+Shift+F",
            },
            BlueprintAction {
                id: "open-tab-switcher",
                title: "Open MRU tab switcher",
                shortcut: "Ctrl+Tab",
            },
        ],
        settings_sections: vec![
            BlueprintSection {
                id: "launch",
                label: "Launch",
                description: "Startup profile, layout, and shell defaults.",
            },
            BlueprintSection {
                id: "interaction",
                label: "Interaction",
                description: "Keyboard and search behavior.",
            },
            BlueprintSection {
                id: "appearance",
                label: "Appearance",
                description: "Theme and terminal presentation.",
            },
            BlueprintSection {
                id: "actions",
                label: "Actions",
                description: "Palette-discoverable commands and shortcuts.",
            },
        ],
    })
}

async fn create_session(
    State(state): State<AppState>,
    Json(payload): Json<CreateSessionRequest>,
) -> Json<CreateSessionResponse> {
    let profile_id = payload.profile_id.unwrap_or_else(|| "shell".to_string());
    let session = SessionSummary {
        id: format!("session-{}", Uuid::new_v4().simple()),
        title: payload
            .title
            .unwrap_or_else(|| format!("{}-tab", profile_id)),
        profile_id: profile_id.clone(),
        cwd: payload.cwd.unwrap_or_else(|| "~/projects/webpty".to_string()),
        status: "running".to_string(),
    };

    state
        .sessions
        .write()
        .await
        .insert(session.id.clone(), session.clone());

    Json(CreateSessionResponse {
        tab: PrototypeTab {
            id: format!("tab-{}", Uuid::new_v4().simple()),
            title: session.title.clone(),
            profile_id: profile_id.clone(),
        },
        pane: PrototypePane {
            id: format!("pane-{}", Uuid::new_v4().simple()),
            session_id: session.id.clone(),
            title: session.title.clone(),
        },
        session,
    })
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, session_id, state))
}

async fn handle_socket(socket: WebSocket, session_id: String, state: AppState) {
    let session = {
        let mut sessions = state.sessions.write().await;

        sessions
            .entry(session_id.clone())
            .or_insert_with(|| SessionSummary {
                id: session_id.clone(),
                title: "workspace-shell".to_string(),
                profile_id: "shell".to_string(),
                cwd: "~/projects/webpty".to_string(),
                status: "running".to_string(),
            })
            .clone()
    };

    let (mut sender, mut receiver) = socket.split();

    if send_json(
        &mut sender,
        &ServerMessage::Ready {
            session_id: session.id.clone(),
        },
    )
    .await
    .is_err()
    {
        return;
    }

    let seed = seeded_output(&session);
    if send_json(&mut sender, &ServerMessage::Output { data: seed })
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
                        let echoed = format!(
                            "$ {}\r\nmock transport received input for {}\r\n",
                            data.trim_end(),
                            session.title
                        );

                        if send_json(&mut sender, &ServerMessage::Output { data: echoed })
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

fn seed_sessions() -> HashMap<String, SessionSummary> {
    HashMap::from([
        (
            "session-shell".to_string(),
            SessionSummary {
                id: "session-shell".to_string(),
                title: "workspace-shell".to_string(),
                profile_id: "shell".to_string(),
                cwd: "~/projects/webpty".to_string(),
                status: "running".to_string(),
            },
        ),
        (
            "session-ops".to_string(),
            SessionSummary {
                id: "session-ops".to_string(),
                title: "deploy-staging".to_string(),
                profile_id: "ops".to_string(),
                cwd: "~/deploy/staging".to_string(),
                status: "running".to_string(),
            },
        ),
    ])
}

fn seeded_output(session: &SessionSummary) -> String {
    format!(
        "webpty connected\r\nsession: {}\r\nprofile: {}\r\ncwd: {}\r\n\r\nmock transport ready\r\n",
        session.title, session.profile_id, session.cwd
    )
}
