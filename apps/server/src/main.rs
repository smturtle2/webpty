use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex, RwLock as StdRwLock},
    thread,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{
        Path as AxumPath, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{
        StatusCode, Uri,
        header::{self, HeaderValue},
    },
    response::{IntoResponse, Response},
    routing::{delete, get},
};
use futures_util::{SinkExt, StreamExt};
use include_dir::{Dir, include_dir};
use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
#[cfg(unix)]
use tokio::signal::unix::{SignalKind, signal};
use tokio::{
    process::Command as TokioCommand,
    sync::{RwLock, broadcast},
};
use uuid::Uuid;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3001;
const FALLBACK_SETTINGS_PATH: &str = "config/webpty.settings.json";
const DEFAULT_SETTINGS_FILENAME: &str = "settings.json";
const DEFAULT_FUNNEL_ALLOWED_HTTPS_PORTS: [u16; 3] = [443, 8443, 10000];
const DEFAULT_TAILSCALE_UP_TIMEOUT: &str = "30s";
const SETTINGS_SCHEMA_URL: &str = "https://aka.ms/terminal-profiles-schema";
const POWERSHELL_PROFILE_GUID: &str = "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}";
const UBUNTU_PROFILE_GUID: &str = "{5b49f6c2-a5f8-4265-a0f5-d184f3c9a13f}";
const AZURE_OPS_PROFILE_GUID: &str = "{8f54aa7f-b2cb-4f79-bf9d-5f06dfc7f265}";
const HOST_SHELL_PROFILE_GUID: &str = "{e8b9f7d8-9f74-4a65-9f6d-43ba3ee24411}";
const BASH_PROFILE_GUID: &str = "{06de9c22-d6f1-43f4-a8dc-c7a29b18ab10}";
const ZSH_PROFILE_GUID: &str = "{7e5f0ec3-5f15-4fc6-ae0f-571dfd6eb0cc}";
const FISH_PROFILE_GUID: &str = "{9d7f8ab8-01b7-44f4-a4c8-488d04408ad6}";
const WEB_UI_FINGERPRINT: &str = env!("WEBPTY_UI_FINGERPRINT");
static WEB_UI_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/ui");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HostPlatform {
    Windows,
    MacOs,
    Linux,
    Other,
}

impl HostPlatform {
    fn api_label(self) -> &'static str {
        match self {
            HostPlatform::Windows => "windows",
            HostPlatform::MacOs => "macos",
            HostPlatform::Linux => "linux",
            HostPlatform::Other => "other",
        }
    }
}

fn runtime_host_platform() -> HostPlatform {
    match env::consts::OS {
        "windows" => HostPlatform::Windows,
        "macos" => HostPlatform::MacOs,
        "linux" => HostPlatform::Linux,
        _ => HostPlatform::Other,
    }
}

#[derive(Clone)]
struct AppState {
    sessions: Arc<RwLock<HashMap<String, Arc<SessionState>>>>,
    settings: Arc<RwLock<TerminalSettings>>,
    settings_path: Arc<PathBuf>,
}

struct SessionState {
    meta: StdRwLock<SessionRecord>,
    runtime: SessionRuntime,
}

struct SessionRuntime {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    events: broadcast::Sender<String>,
}

#[derive(Debug, Clone)]
struct UpOptions {
    host: String,
    port: u16,
    settings_path: PathBuf,
    funnel: bool,
}

#[derive(Debug)]
enum ParsedCli {
    Run(UpOptions),
    Help(String),
    Version(String),
}

struct TunnelHandle {
    https_port: u16,
    public_url: String,
    managed_by_webpty: bool,
}

impl Default for UpOptions {
    fn default() -> Self {
        Self {
            host: env::var("WEBPTY_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(DEFAULT_PORT),
            settings_path: default_settings_path(),
            funnel: env_flag("WEBPTY_FUNNEL"),
        }
    }
}

impl UpOptions {
    fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    fn local_origin(&self) -> String {
        let host = match self.host.as_str() {
            "0.0.0.0" | "::" | "[::]" => DEFAULT_HOST,
            other => other,
        };

        format!("http://{host}:{}", self.port)
    }
}

fn env_flag(name: &str) -> bool {
    env::var(name)
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
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
        if let Ok(mut killer) = self.runtime.killer.lock() {
            let _ = killer.kill();
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
    host_platform: String,
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
struct TerminalSettings {
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    schema: Option<String>,
    default_profile: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    copy_formatting: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    theme: Option<ThemeSelection>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    themes: Vec<TerminalTheme>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    actions: Vec<TerminalAction>,
    profiles: TerminalProfiles,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    schemes: Vec<TerminalColorScheme>,
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
struct TerminalTheme {
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    window: Option<TerminalWindowTheme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tab: Option<TerminalTabTheme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tab_row: Option<TerminalTabRowTheme>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWindowTheme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    application_theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    use_mica: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    frame: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    unfocused_frame: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalTabTheme {
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
struct TerminalTabRowTheme {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    unfocused_background: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum TerminalActionCommand {
    Named(String),
    Structured(JsonMap<String, JsonValue>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalAction {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    command: Option<TerminalActionCommand>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
enum StringOrNumber {
    Number(f64),
    String(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TerminalFontSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    face: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    weight: Option<StringOrNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cell_height: Option<f64>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalProfiles {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    defaults: Option<TerminalProfileDefaults>,
    list: Vec<TerminalProfile>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TerminalProfileDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font: Option<TerminalFontSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font_face: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font_weight: Option<StringOrNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cell_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    line_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor_shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    opacity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    use_acrylic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    foreground: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    selection_background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    padding: Option<StringOrNumber>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebptyProfileOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "JsonMap::is_empty")]
    extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalProfile {
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
    tab_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color_scheme: Option<SchemeSelection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font: Option<TerminalFontSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font_face: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font_weight: Option<StringOrNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cell_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    line_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor_shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    opacity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    use_acrylic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    foreground: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    selection_background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    padding: Option<StringOrNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    webpty: Option<WebptyProfileOptions>,
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
struct TerminalColorScheme {
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
    child: Box<dyn Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
}

#[tokio::main]
async fn main() {
    match parse_cli() {
        Ok(ParsedCli::Run(options)) => {
            if let Err(error) = run_up(options).await {
                eprintln!("webpty failed: {error}");
                std::process::exit(1);
            }
        }
        Ok(ParsedCli::Help(usage)) => println!("{usage}"),
        Ok(ParsedCli::Version(version)) => println!("{version}"),
        Err(error) => {
            eprintln!("{error}\n\n{}", root_usage());
            std::process::exit(2);
        }
    }
}

fn parse_cli() -> Result<ParsedCli, String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let Some(first) = args.first() else {
        return Ok(ParsedCli::Run(default_up_options()));
    };

    match first.as_str() {
        "-h" | "--help" => Ok(ParsedCli::Help(root_usage())),
        "-V" | "--version" => Ok(ParsedCli::Version(version_string())),
        "up" => parse_up_command(args.into_iter().skip(1)),
        flag if flag.starts_with('-') => parse_up_command(args),
        command => Err(format!("unknown command `{command}`")),
    }
}

fn parse_up_command(args: impl IntoIterator<Item = String>) -> Result<ParsedCli, String> {
    let mut options = default_up_options();
    let mut args = args.into_iter();

    while let Some(argument) = args.next() {
        match argument.as_str() {
            "-h" | "--help" => return Ok(ParsedCli::Help(up_usage())),
            "-V" | "--version" => return Ok(ParsedCli::Version(version_string())),
            "--host" => {
                options.host = take_option_value("--host", args.next())?;
            }
            "--port" => {
                let value = take_option_value("--port", args.next())?;
                options.port = value
                    .parse::<u16>()
                    .map_err(|_| format!("invalid port `{value}`"))?;
            }
            "--settings" => {
                options.settings_path =
                    PathBuf::from(take_option_value("--settings", args.next())?);
            }
            "--funnel" => {
                options.funnel = true;
            }
            flag => return Err(format!("unknown `webpty up` option `{flag}`")),
        }
    }

    Ok(ParsedCli::Run(options))
}

fn take_option_value(flag: &str, value: Option<String>) -> Result<String, String> {
    value.ok_or_else(|| format!("missing value for `{flag}`"))
}

fn default_up_options() -> UpOptions {
    UpOptions::default()
}

fn supports_funnel_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "0.0.0.0" | "::" | "[::]" | "localhost")
}

fn root_usage() -> String {
    format!(
        "webpty {}\n\nUsage:\n  webpty [up] [--host <host>] [--port <port>] [--settings <path>] [--funnel]\n  webpty up --help\n\nCommands:\n  up        Start the Rust PTY server and embedded web UI\n\nIf no command is provided, `webpty` defaults to `webpty up`.",
        env!("CARGO_PKG_VERSION")
    )
}

fn up_usage() -> String {
    format!(
        "webpty up\n\nUsage:\n  webpty up [--host <host>] [--port <port>] [--settings <path>] [--funnel]\n\nOptions:\n  --host <host>         Bind address for the local server (default: {})\n  --port <port>         TCP port for the local server (default: {})\n  --settings <path>     Shared settings file path\n  --funnel              Expose the local server through Tailscale Funnel\n  -h, --help            Print help\n  -V, --version         Print version",
        DEFAULT_HOST, DEFAULT_PORT
    )
}

fn version_string() -> String {
    format!("webpty {}", env!("CARGO_PKG_VERSION"))
}

async fn run_up(options: UpOptions) -> Result<(), Box<dyn std::error::Error>> {
    if options.funnel && !supports_funnel_host(&options.host) {
        return Err(format!(
            "`webpty up --funnel` requires `--host` to bind loopback or all interfaces; received `{}`",
            options.host
        )
        .into());
    }

    let settings_path = options.settings_path.clone();
    let settings = load_settings(&settings_path).map_err(|error| {
        format!(
            "failed to load settings from {}: {error}",
            settings_path.display()
        )
    })?;
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
        .route("/api/health", get(health))
        .route("/api/settings", get(get_settings).put(update_settings))
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route("/api/sessions/{session_id}", delete(delete_session))
        .route("/ws/{session_id}", get(ws_handler))
        .fallback(get(static_handler))
        .with_state(state.clone());

    let mut tunnel = None;
    let result: Result<(), Box<dyn std::error::Error>> = async {
        let listener = tokio::net::TcpListener::bind(options.bind_address()).await?;
        println!("webpty ready on {}", options.local_origin());

        if options.funnel {
            tunnel = Some(start_funnel(&options.host, options.port).await?);
        }

        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await?;

        Ok(())
    }
    .await;

    if let Some(tunnel) = tunnel.as_mut() {
        stop_tunnel(tunnel).await;
    }

    terminate_all_sessions(&state).await;
    result
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let ctrl_c = tokio::signal::ctrl_c();
        let mut terminate =
            signal(SignalKind::terminate()).expect("SIGTERM listener should initialize");
        let mut hangup = signal(SignalKind::hangup()).expect("SIGHUP listener should initialize");

        tokio::select! {
            _ = ctrl_c => {}
            _ = terminate.recv() => {}
            _ = hangup.recv() => {}
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn start_funnel(host: &str, port: u16) -> Result<TunnelHandle, Box<dyn std::error::Error>> {
    let status = ensure_tailscale_ready().await?;

    if !status_supports_funnel(&status) {
        println!("webpty funnel requesting Funnel capability from the local Tailscale node");
    }

    let target = funnel_proxy_target(host, port);
    let selection = select_funnel_port(&target).await?;
    let dns_name = tailscale_dns_name().await?;
    let (https_port, managed_by_webpty) = match selection {
        FunnelSelection::Existing(port) => (port, false),
        FunnelSelection::New(port) => {
            run_tailscale_command([
                "funnel".to_string(),
                "--yes".to_string(),
                "--bg".to_string(),
                format!("--https={port}"),
                target.clone(),
            ])
            .await
            .map_err(|error| format!("failed to start Tailscale Funnel: {error}"))?;
            (port, true)
        }
    };
    let public_url = resolve_funnel_url(https_port, &dns_name);

    println!("webpty funnel available at {public_url}");

    Ok(TunnelHandle {
        https_port,
        public_url,
        managed_by_webpty,
    })
}

async fn stop_tunnel(tunnel: &mut TunnelHandle) {
    if !tunnel.managed_by_webpty {
        println!(
            "webpty funnel leaving existing Tailscale mapping intact at {}",
            tunnel.public_url
        );
        return;
    }

    if let Err(error) = run_tailscale_command([
        "funnel".to_string(),
        format!("--https={}", tunnel.https_port),
        "off".to_string(),
    ])
    .await
    {
        eprintln!("failed to stop Tailscale Funnel: {error}");
    }
}

async fn ensure_tailscale_ready() -> Result<JsonValue, Box<dyn std::error::Error>> {
    let mut attempted_bootstrap = false;
    let mut status = match run_tailscale_json(["status", "--json"]).await {
        Ok(status) => status,
        Err(error) => {
            eprintln!(
                "webpty funnel: failed to read Tailscale status ({error}); attempting automatic setup"
            );
            bootstrap_tailscale().await?;
            attempted_bootstrap = true;
            run_tailscale_json(["status", "--json"]).await?
        }
    };
    let mut backend_state = tailscale_backend_state(&status);

    if backend_state != "Running" {
        if !attempted_bootstrap {
            eprintln!(
                "webpty funnel: preparing Tailscale with `tailscale up` (BackendState = `{backend_state}`)"
            );
            bootstrap_tailscale().await?;
            status = run_tailscale_json(["status", "--json"]).await?;
            backend_state = tailscale_backend_state(&status);
        }

        if backend_state != "Running" {
            return Err(tailscale_bootstrap_error(&status, backend_state).into());
        }
    }

    Ok(status)
}

fn tailscale_backend_state(status: &JsonValue) -> &str {
    status
        .get("BackendState")
        .and_then(JsonValue::as_str)
        .unwrap_or_default()
}

async fn bootstrap_tailscale() -> Result<(), Box<dyn std::error::Error>> {
    let auth_key = configured_tailscale_auth_key();
    let args = tailscale_up_args(auth_key.as_deref());
    let mode = if auth_key.is_some() {
        "configured auth key"
    } else {
        "interactive login when required"
    };

    eprintln!("webpty funnel: attempting `tailscale up` with {mode}");

    let output = run_tailscale_command(args).await?;
    if !output.is_empty() {
        println!("{output}");
    }

    Ok(())
}

#[derive(Clone, Copy)]
enum FunnelSelection {
    Existing(u16),
    New(u16),
}

async fn select_funnel_port(target: &str) -> Result<FunnelSelection, Box<dyn std::error::Error>> {
    let status = match run_tailscale_json(["funnel", "status", "--json"]).await {
        Ok(status) => status,
        Err(error) => {
            eprintln!(
                "webpty funnel: could not inspect existing Funnel mappings ({error}); assuming no reusable mappings"
            );
            JsonValue::Object(JsonMap::new())
        }
    };
    let allowed_ports = allowed_funnel_ports().await?;

    if let Some(port) = existing_funnel_port(&status, target) {
        return Ok(FunnelSelection::Existing(port));
    }

    let used_ports = used_funnel_ports(&status);
    allowed_ports
        .iter()
        .copied()
        .find(|port| !used_ports.contains(port))
        .map(FunnelSelection::New)
        .ok_or_else(|| {
            format!(
                "all allowed Tailscale Funnel HTTPS ports are already in use: {:?}",
                allowed_ports
            )
            .into()
        })
}

async fn allowed_funnel_ports() -> Result<Vec<u16>, Box<dyn std::error::Error>> {
    let status = run_tailscale_json(["status", "--json"]).await?;
    let ports = funnel_capability_ports(&status)
        .unwrap_or_else(|| DEFAULT_FUNNEL_ALLOWED_HTTPS_PORTS.to_vec());

    Ok(ports)
}

fn status_supports_funnel(status: &JsonValue) -> bool {
    status
        .pointer("/Self/CapabilitiesMap/funnel")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false)
        || status.pointer("/Self/CapMap/funnel").is_some()
        || capability_strings(status)
            .into_iter()
            .any(|capability| capability_mentions_funnel(&capability))
        || funnel_capability_ports(status).is_some()
}

fn capability_strings(status: &JsonValue) -> Vec<String> {
    let mut values = status
        .pointer("/Self/Capabilities")
        .and_then(JsonValue::as_array)
        .map(|capabilities| {
            capabilities
                .iter()
                .filter_map(JsonValue::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if let Some(map) = status
        .pointer("/Self/CapabilitiesMap")
        .or_else(|| status.pointer("/Self/CapMap"))
        .and_then(JsonValue::as_object)
    {
        values.extend(map.keys().cloned());
    }

    values
}

fn capability_mentions_funnel(capability: &str) -> bool {
    let normalized = capability.trim().to_ascii_lowercase();
    normalized == "funnel"
        || normalized.starts_with("funnel:")
        || normalized.starts_with("funnel/")
        || normalized.starts_with("funnel,")
        || normalized.contains(":funnel")
        || normalized.contains("/funnel")
}

fn funnel_capability_ports(status: &JsonValue) -> Option<Vec<u16>> {
    capability_strings(status)
        .into_iter()
        .find_map(|capability| {
            capability
                .split_once("ports=")
                .map(|(_, values)| {
                    values
                        .split(',')
                        .filter_map(|value| value.parse::<u16>().ok())
                        .collect::<Vec<_>>()
                })
                .filter(|ports| !ports.is_empty())
        })
}

async fn tailscale_dns_name() -> Result<String, Box<dyn std::error::Error>> {
    let status = run_tailscale_json(["status", "--json"]).await?;
    let cert_domain = status
        .get("CertDomains")
        .and_then(JsonValue::as_array)
        .and_then(|domains| domains.first())
        .and_then(JsonValue::as_str)
        .map(str::to_string);
    let fallback = status
        .pointer("/Self/DNSName")
        .and_then(JsonValue::as_str)
        .map(|value| value.trim_end_matches('.').to_string());

    cert_domain
        .or(fallback)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "tailscale did not report a public DNS name for this node".into())
}

async fn run_tailscale_json(
    args: impl IntoIterator<Item = impl Into<String>>,
) -> Result<JsonValue, Box<dyn std::error::Error>> {
    let output = run_tailscale_command(args).await?;
    Ok(serde_json::from_str(&output)?)
}

async fn run_tailscale_command(
    args: impl IntoIterator<Item = impl Into<String>>,
) -> Result<String, Box<dyn std::error::Error>> {
    let args = args.into_iter().map(Into::into).collect::<Vec<String>>();
    let display = display_tailscale_args(&args);
    let output = TokioCommand::new("tailscale")
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| format!("failed to execute `tailscale {display}`: {error}"))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("process exited with status {}", output.status)
    };

    Err(format!("`tailscale {display}` failed: {detail}").into())
}

fn tailscale_bootstrap_error(status: &JsonValue, backend_state: &str) -> String {
    let login_hint = tailscale_auth_url(status)
        .map(|url| {
            format!(" Complete the Tailscale login flow at {url} and rerun `webpty up --funnel`.")
        })
        .unwrap_or_else(|| {
            " Rerun `webpty up --funnel` after the local Tailscale client reaches a running state."
                .to_string()
        });

    format!(
        "tailscale is not ready after automatic setup (BackendState = `{backend_state}`).{login_hint}"
    )
}

fn tailscale_auth_url(status: &JsonValue) -> Option<&str> {
    status
        .get("AuthURL")
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn configured_tailscale_auth_key() -> Option<String> {
    ["WEBPTY_TAILSCALE_AUTH_KEY", "TS_AUTHKEY", "TS_AUTH_KEY"]
        .into_iter()
        .find_map(|key| env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn tailscale_up_args(auth_key: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "up".to_string(),
        format!("--timeout={DEFAULT_TAILSCALE_UP_TIMEOUT}"),
    ];

    if let Some(auth_key) = auth_key {
        args.push(format!("--auth-key={auth_key}"));
    }

    args
}

fn display_tailscale_args(args: &[String]) -> String {
    args.iter()
        .map(|value| {
            if value.starts_with("--auth-key=") {
                "--auth-key=<redacted>".to_string()
            } else {
                value.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn existing_funnel_port(status: &JsonValue, target: &str) -> Option<u16> {
    let web = status.get("Web")?.as_object()?;

    for (host_port, config) in web {
        let handlers = config.get("Handlers")?.as_object()?;
        let root = handlers.get("/")?.as_object()?;
        let proxy = root.get("Proxy")?.as_str()?;

        if proxy != target {
            continue;
        }

        let (_, port) = host_port.rsplit_once(':')?;
        if let Ok(parsed) = port.parse::<u16>() {
            return Some(parsed);
        }
    }

    None
}

fn used_funnel_ports(status: &JsonValue) -> Vec<u16> {
    let mut ports = status
        .get("Web")
        .and_then(JsonValue::as_object)
        .map(|entries| {
            entries
                .keys()
                .filter_map(|host_port| host_port.rsplit_once(':'))
                .filter_map(|(_, port)| port.parse::<u16>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if let Some(tcp_ports) = status.get("TCP").and_then(JsonValue::as_object) {
        ports.extend(tcp_ports.keys().filter_map(|port| port.parse::<u16>().ok()));
    }

    ports.sort_unstable();
    ports.dedup();
    ports
}

fn resolve_funnel_url(https_port: u16, dns_name: &str) -> String {
    if https_port == 443 {
        format!("https://{dns_name}/")
    } else {
        format!("https://{dns_name}:{https_port}/")
    }
}

fn funnel_proxy_target(host: &str, port: u16) -> String {
    match host {
        "::" | "[::]" => format!("[::1]:{port}"),
        "0.0.0.0" | "127.0.0.1" | "localhost" => format!("127.0.0.1:{port}"),
        value => format!("{value}:{port}"),
    }
}

async fn terminate_all_sessions(state: &AppState) {
    let sessions = state.sessions.read().await;
    for session in sessions.values() {
        session.terminate();
    }
}

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    if path == "api" || path.starts_with("api/") || path == "ws" || path.starts_with("ws/") {
        return StatusCode::NOT_FOUND.into_response();
    }

    if let Some(response) = find_embedded_asset(path) {
        return response;
    }

    if path.contains('.') {
        return StatusCode::NOT_FOUND.into_response();
    }

    find_embedded_asset("index.html").unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

fn find_embedded_asset(path: &str) -> Option<Response> {
    let _ = WEB_UI_FINGERPRINT;
    let normalized = match path {
        "" => "index.html",
        value => value,
    };
    let file = WEB_UI_DIR.get_file(normalized)?;
    let mime = mime_guess::from_path(normalized).first_or_octet_stream();
    let mut response = Response::new(Body::from(file.contents().to_vec()));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).ok()?,
    );
    Some(response)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        message: "Schema-compatible PTY server and embedded shell ready".to_string(),
        websocket_path: "/ws/:sessionId".to_string(),
        mode: "standalone-shell".to_string(),
        host_platform: runtime_host_platform().api_label().to_string(),
        features: vec![
            "health",
            "embedded-shell",
            "settings-read",
            "settings-write",
            "sessions-list",
            "sessions-create-delete",
            "websocket-live-pty",
            "pty-resize-input-output",
            "tailscale-funnel",
        ],
    })
}

async fn get_settings(State(state): State<AppState>) -> Json<TerminalSettings> {
    Json(state.settings.read().await.clone())
}

async fn update_settings(
    State(state): State<AppState>,
    Json(payload): Json<TerminalSettings>,
) -> Result<Json<TerminalSettings>, (StatusCode, String)> {
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
    let profile_id = if let Some(requested) = payload.profile_id.as_deref() {
        resolve_requested_profile_id(&settings, Some(requested)).ok_or((
            StatusCode::BAD_REQUEST,
            format!("profile `{requested}` is not defined in settings"),
        ))?
    } else {
        default_launch_profile_id(&settings).ok_or((
            StatusCode::BAD_REQUEST,
            "no launchable profile available".to_string(),
        ))?
    };
    let profile = resolve_profile(&settings, &profile_id).cloned().ok_or((
        StatusCode::BAD_REQUEST,
        format!("profile `{profile_id}` is not defined in settings"),
    ))?;
    if profile.hidden.unwrap_or(false) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "profile `{}` is hidden and cannot be launched",
                profile.name
            ),
        ));
    }
    let title = payload
        .title
        .unwrap_or_else(|| default_session_title(&profile));
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
    if let Ok(path) = env::var("WEBPTY_SETTINGS_PATH") {
        return PathBuf::from(path);
    }

    if let Some(path) = user_settings_path() {
        return path;
    }

    PathBuf::from(FALLBACK_SETTINGS_PATH)
}

fn user_settings_path() -> Option<PathBuf> {
    user_settings_path_for_host(runtime_host_platform())
}

fn user_settings_path_for_host(host: HostPlatform) -> Option<PathBuf> {
    match host {
        HostPlatform::Windows => env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| home_dir().map(|home| home.join("AppData").join("Roaming")))
            .map(|root| root.join("webpty").join(DEFAULT_SETTINGS_FILENAME)),
        HostPlatform::MacOs => home_dir()
            .map(|home| home.join("Library").join("Application Support"))
            .map(|root| root.join("webpty").join(DEFAULT_SETTINGS_FILENAME)),
        HostPlatform::Linux | HostPlatform::Other => env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| home_dir().map(|home| home.join(".config")))
            .map(|root| root.join("webpty").join(DEFAULT_SETTINGS_FILENAME)),
    }
}

fn load_settings(path: &Path) -> Result<TerminalSettings, Box<dyn std::error::Error>> {
    if !path.exists() {
        let defaults = normalize_settings(default_settings())?;
        persist_settings(path, &defaults)?;
        return Ok(defaults);
    }

    let contents = fs::read_to_string(path)?;
    let parsed = json5::from_str::<TerminalSettings>(&contents)?;
    Ok(normalize_settings(parsed)?)
}

fn persist_settings(
    path: &Path,
    settings: &TerminalSettings,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}

fn normalize_settings(
    mut settings: TerminalSettings,
) -> Result<TerminalSettings, Box<dyn std::error::Error>> {
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

    settings.default_profile = default_launch_profile_id(&settings)
        .ok_or("profiles.list must contain at least one visible profile")?;

    Ok(settings)
}

fn seed_sessions(
    settings: &TerminalSettings,
) -> Result<HashMap<String, Arc<SessionState>>, String> {
    let default_profile_id = default_launch_profile_id(settings)
        .unwrap_or_else(|| profile_key(&settings.profiles.list[0]));

    let session = spawn_session(
        settings,
        "session-shell".to_string(),
        default_session_title(
            resolve_profile(settings, &default_profile_id)
                .expect("default profile should resolve for seeded session"),
        ),
        default_profile_id,
        None,
        0,
    )?;

    Ok(HashMap::from([("session-shell".to_string(), session)]))
}

fn spawn_session(
    settings: &TerminalSettings,
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
    let killer = spawned.child.clone_killer();
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
            transcript: String::new(),
        }),
        runtime: SessionRuntime {
            master: Arc::new(Mutex::new(spawned.master)),
            writer: Arc::new(Mutex::new(spawned.writer)),
            killer: Arc::new(Mutex::new(killer)),
            events,
        },
    });

    if !plan.notes.is_empty() {
        for note in &plan.notes {
            eprintln!(
                "webpty launch note [{} / {}]: {}",
                profile.name, title, note
            );
        }
    }

    spawn_reader(state.clone(), spawned.reader);
    spawn_waiter(state.clone(), spawned.child);

    Ok(state)
}

fn build_launch_plan(profile: &TerminalProfile, cwd_override: Option<String>) -> LaunchPlan {
    let mut notes = Vec::new();
    let requested_dir = cwd_override.or_else(|| profile.starting_directory.clone());
    let cwd = resolve_launch_cwd(requested_dir.as_deref(), &mut notes);

    if let Some(commandline) = profile.commandline.as_deref() {
        #[cfg(not(target_os = "windows"))]
        if let Some(builder) = adapt_windows_commandline_to_host(commandline, &mut notes) {
            let fallback = default_shell_builder(Some(profile));

            return LaunchPlan {
                command: builder,
                command_label: commandline.to_string(),
                fallback_command: Some(fallback.clone()),
                fallback_label: Some(default_shell_label()),
                cwd,
                notes,
            };
        }

        #[cfg(not(target_os = "windows"))]
        if looks_windows_command(commandline) {
            notes.push(format!(
                "`{commandline}` is a Windows-targeted profile. Using a local shell with a profile-matched prompt."
            ));

            return LaunchPlan {
                command: default_shell_builder(Some(profile)),
                command_label: default_shell_label(),
                fallback_command: None,
                fallback_label: None,
                cwd,
                notes,
            };
        }

        #[cfg(not(target_os = "windows"))]
        if let Some(builder) = plain_shell_command_builder(commandline, profile, &mut notes) {
            let fallback = default_shell_builder(Some(profile));

            return LaunchPlan {
                command: builder,
                command_label: commandline.to_string(),
                fallback_command: Some(fallback.clone()),
                fallback_label: Some(default_shell_label()),
                cwd,
                notes,
            };
        }

        let builder = if let Some(mut builder) = command_builder_from_commandline(commandline) {
            #[cfg(not(target_os = "windows"))]
            maybe_apply_primary_profile_prompt(&mut builder, commandline, Some(profile));
            builder
        } else {
            notes.push(format!(
                "could not parse `{commandline}` on this host. Falling back to the local shell."
            ));
            default_shell_builder(Some(profile))
        };
        let fallback = default_shell_builder(Some(profile));

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
            command: default_shell_builder(Some(profile)),
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

    if candidate.is_dir() {
        return candidate;
    }

    let reason = if candidate.exists() {
        "is not a directory"
    } else {
        "is unavailable"
    };

    notes.push(format!(
        "[webpty] requested cwd `{raw}` {reason}. Starting in `{}`.",
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
    let args = parse_commandline_args(commandline)?;
    let program = args.first()?;
    let mut builder = CommandBuilder::new(program);
    if args.len() > 1 {
        builder.args(args.iter().skip(1));
    }
    Some(builder)
}

fn parse_commandline_args(commandline: &str) -> Option<Vec<String>> {
    #[cfg(windows)]
    {
        split_windows_commandline(commandline)
    }

    #[cfg(not(windows))]
    {
        shlex::split(commandline)
    }
}

#[cfg(not(target_os = "windows"))]
fn adapt_windows_commandline_to_host(
    commandline: &str,
    notes: &mut Vec<String>,
) -> Option<CommandBuilder> {
    let args = shlex::split(commandline)?;
    let program = args.first()?.trim().to_ascii_lowercase();

    if matches!(program.as_str(), "pwsh.exe" | "powershell.exe") {
        let local_program = first_available_program(&["pwsh", "powershell"])?;
        let mut builder = CommandBuilder::new(&local_program);
        if args.len() > 1 {
            builder.args(args.iter().skip(1));
        }
        notes.push(format!(
            "mapped `{commandline}` to the local `{local_program}` executable."
        ));
        return Some(builder);
    }

    None
}

#[cfg(windows)]
fn split_windows_commandline(commandline: &str) -> Option<Vec<String>> {
    let characters = commandline.chars().collect::<Vec<_>>();
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut argument_open = false;
    let mut index = 0;

    while index < characters.len() {
        let character = characters[index];

        if !in_quotes && character.is_whitespace() {
            if argument_open {
                arguments.push(std::mem::take(&mut current));
                argument_open = false;
            }
            index += 1;
            continue;
        }

        let mut backslash_count = 0;
        while index < characters.len() && characters[index] == '\\' {
            backslash_count += 1;
            index += 1;
        }

        if index < characters.len() && characters[index] == '"' {
            current.push_str(&"\\".repeat(backslash_count / 2));
            argument_open = true;

            if backslash_count % 2 == 0 {
                if in_quotes && index + 1 < characters.len() && characters[index + 1] == '"' {
                    current.push('"');
                    index += 1;
                } else {
                    in_quotes = !in_quotes;
                }
            } else {
                current.push('"');
            }

            index += 1;
            continue;
        }

        if backslash_count > 0 {
            current.push_str(&"\\".repeat(backslash_count));
            argument_open = true;
        }

        if index < characters.len() {
            current.push(characters[index]);
            argument_open = true;
            index += 1;
        }
    }

    if in_quotes {
        return None;
    }

    if argument_open {
        arguments.push(current);
    }

    if arguments.is_empty() {
        None
    } else {
        Some(arguments)
    }
}

fn default_shell_builder(profile: Option<&TerminalProfile>) -> CommandBuilder {
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
        apply_profile_prompt(&mut builder, profile);

        if cfg!(unix) {
            match builder
                .get_argv()
                .first()
                .and_then(|value| value.to_str())
                .map(program_name)
                .as_deref()
            {
                Some("bash") | Some("bash.exe") => {
                    builder.arg("--noprofile");
                    builder.arg("--norc");
                    builder.arg("-i");
                }
                Some("zsh") | Some("zsh.exe") => {
                    builder.arg("-f");
                    builder.arg("-i");
                }
                _ => {
                    builder.arg("-i");
                }
            }
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

#[cfg(not(windows))]
fn apply_profile_prompt(builder: &mut CommandBuilder, profile: Option<&TerminalProfile>) {
    let prompt = profile_prompt(profile);
    let shell_program = builder
        .get_argv()
        .first()
        .and_then(|value| value.to_str())
        .map(program_name);

    builder.env("PS1", prompt.clone());
    builder.env("PROMPT_COMMAND", "");
    if matches!(shell_program.as_deref(), Some("zsh") | Some("zsh.exe")) {
        builder.env("PROMPT", prompt);
    }
    if matches!(shell_program.as_deref(), Some("fish") | Some("fish.exe")) {
        builder.env("fish_greeting", "");
    }
}

#[cfg(not(target_os = "windows"))]
fn plain_shell_command_builder(
    commandline: &str,
    profile: &TerminalProfile,
    notes: &mut Vec<String>,
) -> Option<CommandBuilder> {
    let args = parse_commandline_args(commandline)?;
    let executable = args.first()?.to_string();
    let program = program_name(&executable);
    let mut builder = match program.as_str() {
        "bash" | "bash.exe" if args.len() == 1 => {
            let mut builder = CommandBuilder::new(&executable);
            builder.arg("--noprofile");
            builder.arg("--norc");
            builder.arg("-i");
            builder
        }
        "sh" if args.len() == 1 => {
            let mut builder = CommandBuilder::new(&executable);
            builder.arg("-i");
            builder
        }
        "zsh" | "zsh.exe" if args.len() == 1 => {
            let mut builder = CommandBuilder::new(&executable);
            builder.arg("-f");
            builder.arg("-i");
            builder
        }
        "fish" | "fish.exe" if args.len() == 1 => {
            let mut builder = CommandBuilder::new(&executable);
            builder.arg("-i");
            builder
        }
        _ => return None,
    };

    apply_profile_prompt(&mut builder, Some(profile));
    notes.push(format!(
        "normalized `{commandline}` to an interactive {program} shell so the session prompt matches the selected profile."
    ));
    Some(builder)
}

#[cfg(not(target_os = "windows"))]
fn maybe_apply_primary_profile_prompt(
    builder: &mut CommandBuilder,
    commandline: &str,
    profile: Option<&TerminalProfile>,
) {
    if looks_posix_shell_prompt(commandline) {
        apply_profile_prompt(builder, profile);
    }
}

#[cfg(not(windows))]
fn profile_prompt(profile: Option<&TerminalProfile>) -> String {
    let Some(profile) = profile else {
        return "\\w\\$ ".to_string();
    };

    if let Some(prompt) = configured_profile_prompt(profile) {
        return prompt;
    }

    let profile_name = profile.name.trim();
    let commandline = profile
        .commandline
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let normalized_name = profile_name.to_ascii_lowercase();

    if normalized_name.contains("powershell") || commandline.contains("pwsh") {
        if normalized_name == "powershell" {
            return "PS \\w> ".to_string();
        }

        let label = sanitize_prompt_label(profile_name);
        return format!("PS({label}) \\w> ");
    }

    if let Some(host_label) = profile_host_label(profile_name, &commandline) {
        return format!("\\u@{host_label}:\\w\\$ ");
    }

    let label = sanitize_prompt_label(profile_name);
    format!("[{label}] \\w\\$ ")
}

#[cfg(not(windows))]
fn configured_profile_prompt(profile: &TerminalProfile) -> Option<String> {
    let template = profile
        .webpty
        .as_ref()
        .and_then(|options| options.prompt.as_deref())
        .filter(|prompt| !prompt.trim().is_empty())?;

    let profile_name = profile.name.trim();
    let commandline = profile.commandline.as_deref().unwrap_or_default();
    let host_label =
        profile_host_label(profile_name, commandline).unwrap_or_else(|| "shell".to_string());
    let sanitized_profile = sanitize_prompt_label(profile_name);

    Some(
        template
            .replace("{cwd}", "\\w")
            .replace("{dir}", "\\W")
            .replace("{user}", "\\u")
            .replace("{host}", &host_label)
            .replace("{profile}", &sanitized_profile)
            .replace("{name}", profile_name)
            .replace("{symbol}", "\\$"),
    )
}

#[cfg(not(windows))]
fn sanitize_prompt_label(value: &str) -> String {
    let sanitized = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || *character == '-'
                || *character == '_'
                || *character == '.'
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "webpty".to_string()
    } else {
        sanitized
    }
}

#[cfg(not(windows))]
fn profile_host_label(profile_name: &str, commandline: &str) -> Option<String> {
    let normalized_name = sanitize_prompt_label(&profile_name.to_ascii_lowercase());
    let normalized_command = commandline.to_ascii_lowercase();

    if let Some(distribution) = wsl_distribution_label(commandline) {
        return Some(distribution);
    }

    if normalized_name.contains("ubuntu") {
        return Some(if normalized_name.is_empty() {
            "ubuntu".to_string()
        } else {
            normalized_name
        });
    }

    if looks_posix_shell_prompt(&normalized_command) || is_generic_shell_label(&normalized_name) {
        return Some(
            if normalized_name.is_empty() || is_generic_shell_label(&normalized_name) {
                "shell".to_string()
            } else {
                normalized_name
            },
        );
    }

    None
}

#[cfg(not(windows))]
fn wsl_distribution_label(commandline: &str) -> Option<String> {
    let args = parse_commandline_args(commandline)?;
    let program = program_name(args.first()?);

    if program != "wsl" && program != "wsl.exe" {
        return None;
    }

    let mut index = 1;
    while index < args.len() {
        let argument = &args[index];
        let lowered = argument.to_ascii_lowercase();

        if matches!(lowered.as_str(), "-d" | "--distribution") {
            let distribution = args.get(index + 1)?;
            let label = sanitize_prompt_label(&distribution.to_ascii_lowercase());
            return (!label.is_empty()).then_some(label);
        }

        if let Some((flag, value)) = lowered.split_once('=')
            && matches!(flag, "-d" | "--distribution")
        {
            let label = sanitize_prompt_label(value);
            return (!label.is_empty()).then_some(label);
        }

        index += 1;
    }

    None
}

#[cfg(not(windows))]
fn looks_posix_shell_prompt(commandline: &str) -> bool {
    if commandline.contains("bash")
        || commandline.contains("zsh")
        || commandline.contains("fish")
        || commandline.contains("/bin/sh")
    {
        return true;
    }

    command_program_name(commandline).is_some_and(|program| {
        matches!(
            program.as_str(),
            "bash" | "bash.exe" | "sh" | "zsh" | "zsh.exe" | "fish" | "fish.exe"
        )
    })
}

#[cfg(not(windows))]
fn command_program_name(commandline: &str) -> Option<String> {
    let args = parse_commandline_args(commandline)?;
    Some(program_name(args.first()?))
}

#[cfg(not(windows))]
fn program_name(program: &str) -> String {
    program
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or(program)
        .to_ascii_lowercase()
}

#[cfg(not(windows))]
fn is_generic_shell_label(label: &str) -> bool {
    matches!(
        label,
        "" | "shell" | "bash" | "sh" | "zsh" | "fish" | "terminal"
    )
}

fn first_available_program(candidates: &[&str]) -> Option<String> {
    let paths = env::var_os("PATH")?;

    candidates.iter().find_map(|candidate| {
        env::split_paths(&paths)
            .map(|path| path.join(candidate))
            .find(|path| path.exists())
            .map(|_| (*candidate).to_string())
    })
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

fn spawn_waiter(session: Arc<SessionState>, mut child: Box<dyn Child + Send + Sync>) {
    thread::spawn(move || {
        let status = child.wait();

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
    settings: &TerminalSettings,
    requested: Option<&str>,
) -> Option<String> {
    let requested = requested?;

    settings
        .profiles
        .list
        .iter()
        .find(|profile| profile_matches(profile, requested))
        .map(profile_key)
}

fn default_launch_profile_id(settings: &TerminalSettings) -> Option<String> {
    resolve_requested_profile_id(settings, Some(&settings.default_profile))
        .filter(|profile_id| {
            resolve_profile(settings, profile_id)
                .map(|profile| !profile.hidden.unwrap_or(false))
                .unwrap_or(false)
        })
        .or_else(|| {
            settings
                .profiles
                .list
                .iter()
                .find(|profile| !profile.hidden.unwrap_or(false))
                .map(profile_key)
        })
}

fn resolve_profile<'a>(
    settings: &'a TerminalSettings,
    profile_id: &str,
) -> Option<&'a TerminalProfile> {
    settings
        .profiles
        .list
        .iter()
        .find(|profile| profile_matches(profile, profile_id))
}

fn profile_matches(profile: &TerminalProfile, requested: &str) -> bool {
    profile_key(profile) == requested || profile.name == requested
}

fn profile_key(profile: &TerminalProfile) -> String {
    profile
        .guid
        .clone()
        .unwrap_or_else(|| slugify(&profile.name))
}

fn default_session_title(profile: &TerminalProfile) -> String {
    profile
        .tab_title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&profile.name)
        .to_string()
}

fn preview_lines(transcript: &str) -> Vec<String> {
    transcript
        .lines()
        .map(strip_terminal_control_sequences)
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn strip_terminal_control_sequences(input: &str) -> String {
    let mut output = String::new();
    let mut characters = input.chars().peekable();

    while let Some(character) = characters.next() {
        if character == '\u{1b}' {
            match characters.peek().copied() {
                Some('[') => {
                    characters.next();
                    while let Some(next) = characters.next() {
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    characters.next();
                    while let Some(next) = characters.next() {
                        if next == '\u{7}' {
                            break;
                        }

                        if next == '\u{1b}' && characters.peek().copied() == Some('\\') {
                            characters.next();
                            break;
                        }
                    }
                }
                Some(_) | None => {}
            }
            continue;
        }

        if character.is_control() {
            continue;
        }

        output.push(character);
    }

    output
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

fn default_settings() -> TerminalSettings {
    default_settings_for_host(runtime_host_platform())
}

fn default_settings_for_host(host: HostPlatform) -> TerminalSettings {
    let profiles = default_profiles_for_host(host);
    let default_profile = profiles
        .first()
        .map(profile_key)
        .unwrap_or_else(|| HOST_SHELL_PROFILE_GUID.to_string());

    TerminalSettings {
        schema: Some(SETTINGS_SCHEMA_URL.to_string()),
        default_profile,
        copy_formatting: Some("all".to_string()),
        theme: Some(ThemeSelection::Named("Classic".to_string())),
        themes: default_theme_catalog(),
        actions: default_action_catalog(),
        profiles: TerminalProfiles {
            defaults: Some(default_profile_defaults()),
            list: profiles,
            extra: JsonMap::new(),
        },
        schemes: default_scheme_catalog(),
        extra: JsonMap::new(),
    }
}

fn default_profile_defaults() -> TerminalProfileDefaults {
    TerminalProfileDefaults {
        font: Some(TerminalFontSettings {
            face: Some("Cascadia Mono".to_string()),
            size: Some(13.0),
            weight: None,
            cell_height: Some(1.22),
            extra: JsonMap::new(),
        }),
        font_face: None,
        font_size: None,
        font_weight: None,
        cell_height: None,
        line_height: Some(1.22),
        cursor_shape: Some("bar".to_string()),
        opacity: Some(100.0),
        use_acrylic: None,
        foreground: None,
        background: None,
        cursor_color: None,
        selection_background: None,
        padding: None,
        extra: JsonMap::new(),
    }
}

fn default_theme_catalog() -> Vec<TerminalTheme> {
    vec![
        TerminalTheme {
            name: "Classic".to_string(),
            window: Some(TerminalWindowTheme {
                application_theme: Some("dark".to_string()),
                use_mica: Some(false),
                frame: Some("#d8d8d8".to_string()),
                unfocused_frame: Some("#cfcfcf".to_string()),
                extra: JsonMap::new(),
            }),
            tab: Some(TerminalTabTheme {
                background: Some("#ffffff".to_string()),
                unfocused_background: Some("#f5f5f5".to_string()),
                show_close_button: Some("activeOnly".to_string()),
                extra: JsonMap::new(),
            }),
            tab_row: Some(TerminalTabRowTheme {
                background: Some("#f3f3f3".to_string()),
                unfocused_background: Some("#ededed".to_string()),
                extra: JsonMap::new(),
            }),
            extra: JsonMap::new(),
        },
        TerminalTheme {
            name: "Mist".to_string(),
            window: Some(TerminalWindowTheme {
                application_theme: Some("dark".to_string()),
                use_mica: Some(false),
                frame: Some("#d4d4d4".to_string()),
                unfocused_frame: Some("#cacaca".to_string()),
                extra: JsonMap::new(),
            }),
            tab: Some(TerminalTabTheme {
                background: Some("#ffffff".to_string()),
                unfocused_background: Some("#f2f2f2".to_string()),
                show_close_button: Some("hover".to_string()),
                extra: JsonMap::new(),
            }),
            tab_row: Some(TerminalTabRowTheme {
                background: Some("#efefef".to_string()),
                unfocused_background: Some("#e7e7e7".to_string()),
                extra: JsonMap::new(),
            }),
            extra: JsonMap::new(),
        },
        TerminalTheme {
            name: "Slate".to_string(),
            window: Some(TerminalWindowTheme {
                application_theme: Some("dark".to_string()),
                use_mica: None,
                frame: Some("#cdcdcd".to_string()),
                unfocused_frame: Some("#c2c2c2".to_string()),
                extra: JsonMap::new(),
            }),
            tab: Some(TerminalTabTheme {
                background: Some("#ffffff".to_string()),
                unfocused_background: Some("#ececec".to_string()),
                show_close_button: Some("always".to_string()),
                extra: JsonMap::new(),
            }),
            tab_row: Some(TerminalTabRowTheme {
                background: Some("#e5e5e5".to_string()),
                unfocused_background: Some("#dcdcdc".to_string()),
                extra: JsonMap::new(),
            }),
            extra: JsonMap::new(),
        },
    ]
}

fn default_action_catalog() -> Vec<TerminalAction> {
    vec![
        TerminalAction {
            command: Some(TerminalActionCommand::Named("newTab".to_string())),
            keys: vec!["ctrl+t".to_string()],
            name: None,
            extra: JsonMap::new(),
        },
        TerminalAction {
            command: Some(TerminalActionCommand::Named("closeTab".to_string())),
            keys: vec!["ctrl+w".to_string()],
            name: None,
            extra: JsonMap::new(),
        },
        TerminalAction {
            command: Some(TerminalActionCommand::Named("nextTab".to_string())),
            keys: vec!["ctrl+tab".to_string()],
            name: None,
            extra: JsonMap::new(),
        },
        TerminalAction {
            command: Some(TerminalActionCommand::Named("prevTab".to_string())),
            keys: vec!["ctrl+shift+tab".to_string()],
            name: None,
            extra: JsonMap::new(),
        },
        TerminalAction {
            command: Some(TerminalActionCommand::Named("openSettings".to_string())),
            keys: vec!["ctrl+,".to_string()],
            name: None,
            extra: JsonMap::new(),
        },
    ]
}

fn default_scheme_catalog() -> Vec<TerminalColorScheme> {
    vec![
        TerminalColorScheme {
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
        TerminalColorScheme {
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
        TerminalColorScheme {
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
    ]
}

fn default_profiles_for_host(host: HostPlatform) -> Vec<TerminalProfile> {
    match host {
        HostPlatform::Windows => vec![
            build_profile(
                POWERSHELL_PROFILE_GUID,
                "PowerShell",
                "PS",
                Some("pwsh.exe"),
                Some("%USERPROFILE%"),
                "Campbell",
                "#3b78ff",
                Some("PS {cwd}> "),
            ),
            build_profile(
                UBUNTU_PROFILE_GUID,
                "Ubuntu",
                "UB",
                Some("wsl.exe -d Ubuntu"),
                Some("~"),
                "One Half Dark",
                "#f0a355",
                Some("{user}@{host}:{cwd}{symbol} "),
            ),
            build_profile(
                AZURE_OPS_PROFILE_GUID,
                "Azure Ops",
                "AZ",
                Some("pwsh.exe -NoLogo -NoExit -Command kubectl config current-context"),
                Some("%USERPROFILE%/deploy"),
                "Campbell",
                "#2fbf9b",
                Some("{user}@{host}:{cwd}{symbol} "),
            ),
        ],
        HostPlatform::MacOs | HostPlatform::Linux | HostPlatform::Other => {
            default_unix_profiles(host)
        }
    }
}

fn default_unix_profiles(host: HostPlatform) -> Vec<TerminalProfile> {
    let mut profiles = Vec::new();
    let primary_commandline = preferred_posix_shell_commandline(host);
    let primary_name = shell_display_name(&primary_commandline);
    let primary_icon = profile_icon(&primary_name);
    let primary_program = shell_command_key(&primary_commandline);

    push_unique_profile(
        &mut profiles,
        build_profile(
            HOST_SHELL_PROFILE_GUID,
            &primary_name,
            &primary_icon,
            Some(primary_commandline.as_str()),
            Some("~"),
            "Campbell",
            "#3b78ff",
            Some("{user}@{host}:{cwd}{symbol} "),
        ),
    );

    if let Some(pwsh) = first_available_program(&["pwsh", "powershell"])
        && shell_command_key(&pwsh) != primary_program
    {
        push_unique_profile(
            &mut profiles,
            build_profile(
                POWERSHELL_PROFILE_GUID,
                "PowerShell",
                "PS",
                Some(&pwsh),
                Some("~"),
                "Campbell",
                "#3b78ff",
                Some("PS {cwd}> "),
            ),
        );
    }

    for (guid, candidates, scheme, tab_color) in [
        (BASH_PROFILE_GUID, &["bash"][..], "Campbell", "#3b78ff"),
        (ZSH_PROFILE_GUID, &["zsh"][..], "One Half Dark", "#f0a355"),
        (FISH_PROFILE_GUID, &["fish"][..], "Nord", "#2fbf9b"),
    ] {
        if let Some(commandline) = first_available_program(candidates)
            && shell_command_key(&commandline) != primary_program
        {
            let name = shell_display_name(&commandline);
            let icon = profile_icon(&name);
            push_unique_profile(
                &mut profiles,
                build_profile(
                    guid,
                    &name,
                    &icon,
                    Some(&commandline),
                    Some("~"),
                    scheme,
                    tab_color,
                    Some("{user}@{host}:{cwd}{symbol} "),
                ),
            );
        }
    }

    profiles
}

fn preferred_posix_shell_commandline(host: HostPlatform) -> String {
    if let Ok(shell) = env::var("SHELL") {
        let trimmed = shell.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return trimmed.to_string();
        }
    }

    let candidates: &[&str] = match host {
        HostPlatform::MacOs => &["/bin/zsh", "/bin/bash", "/bin/sh"],
        HostPlatform::Linux | HostPlatform::Other => &["/bin/bash", "/bin/sh"],
        HostPlatform::Windows => &["/bin/sh"],
    };

    candidates
        .iter()
        .find(|candidate| Path::new(candidate).exists())
        .map(|candidate| (*candidate).to_string())
        .unwrap_or_else(|| "/bin/sh".to_string())
}

fn shell_display_name(commandline: &str) -> String {
    match shell_command_key(commandline).as_str() {
        "pwsh" | "pwsh.exe" | "powershell" | "powershell.exe" => "PowerShell".to_string(),
        "bash" | "bash.exe" => "Bash".to_string(),
        "zsh" | "zsh.exe" => "Zsh".to_string(),
        "fish" | "fish.exe" => "Fish".to_string(),
        "sh" => "Shell".to_string(),
        other => title_case_shell_name(other),
    }
}

fn shell_command_key(commandline: &str) -> String {
    commandline
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or(commandline)
        .trim()
        .to_ascii_lowercase()
}

fn title_case_shell_name(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches(".exe");
    if trimmed.is_empty() {
        return "Shell".to_string();
    }

    let mut characters = trimmed.chars();
    let Some(first) = characters.next() else {
        return "Shell".to_string();
    };

    format!(
        "{}{}",
        first.to_ascii_uppercase(),
        characters.as_str().to_ascii_lowercase()
    )
}

fn profile_icon(name: &str) -> String {
    let letters = name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();

    if letters.is_empty() {
        "SH".to_string()
    } else {
        letters
            .chars()
            .take(2)
            .collect::<String>()
            .to_ascii_uppercase()
    }
}

fn push_unique_profile(profiles: &mut Vec<TerminalProfile>, profile: TerminalProfile) {
    let duplicate = profiles.iter().any(|existing| {
        existing.name == profile.name
            || existing.commandline == profile.commandline
            || existing.guid == profile.guid
    });

    if !duplicate {
        profiles.push(profile);
    }
}

fn build_profile(
    guid: &str,
    name: &str,
    icon: &str,
    commandline: Option<&str>,
    starting_directory: Option<&str>,
    scheme: &str,
    tab_color: &str,
    prompt: Option<&str>,
) -> TerminalProfile {
    TerminalProfile {
        guid: Some(guid.to_string()),
        name: name.to_string(),
        icon: Some(icon.to_string()),
        commandline: commandline.map(str::to_string),
        starting_directory: starting_directory.map(str::to_string),
        source: None,
        hidden: Some(false),
        tab_color: Some(tab_color.to_string()),
        tab_title: None,
        color_scheme: Some(SchemeSelection::Named(scheme.to_string())),
        font: None,
        font_face: None,
        font_size: None,
        font_weight: None,
        cell_height: None,
        line_height: None,
        cursor_shape: None,
        opacity: None,
        use_acrylic: None,
        foreground: None,
        background: None,
        cursor_color: None,
        selection_background: None,
        padding: None,
        webpty: Some(WebptyProfileOptions {
            prompt: prompt.map(str::to_string),
            extra: JsonMap::new(),
        }),
        extra: JsonMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn uses_tab_title_for_default_session_title() {
        let profile = TerminalProfile {
            guid: None,
            name: "PowerShell".to_string(),
            icon: None,
            commandline: Some("pwsh.exe".to_string()),
            starting_directory: None,
            source: None,
            hidden: None,
            tab_color: None,
            tab_title: Some("Admin".to_string()),
            color_scheme: None,
            font: None,
            font_face: None,
            font_size: None,
            font_weight: None,
            cell_height: None,
            line_height: None,
            cursor_shape: None,
            opacity: None,
            use_acrylic: None,
            foreground: None,
            background: None,
            cursor_color: None,
            selection_background: None,
            padding: None,
            webpty: None,
            extra: JsonMap::new(),
        };

        assert_eq!(default_session_title(&profile), "Admin");
    }

    #[cfg(not(windows))]
    #[test]
    fn profile_prompt_matches_profile_family() {
        let powershell = TerminalProfile {
            guid: None,
            name: "PowerShell".to_string(),
            icon: None,
            commandline: Some("pwsh.exe".to_string()),
            starting_directory: None,
            source: None,
            hidden: None,
            tab_color: None,
            tab_title: None,
            color_scheme: None,
            font: None,
            font_face: None,
            font_size: None,
            font_weight: None,
            cell_height: None,
            line_height: None,
            cursor_shape: None,
            opacity: None,
            use_acrylic: None,
            foreground: None,
            background: None,
            cursor_color: None,
            selection_background: None,
            padding: None,
            webpty: None,
            extra: JsonMap::new(),
        };
        let ubuntu = TerminalProfile {
            guid: None,
            name: "Ubuntu".to_string(),
            icon: None,
            commandline: Some("wsl.exe -d Ubuntu".to_string()),
            starting_directory: None,
            source: None,
            hidden: None,
            tab_color: None,
            tab_title: None,
            color_scheme: None,
            font: None,
            font_face: None,
            font_size: None,
            font_weight: None,
            cell_height: None,
            line_height: None,
            cursor_shape: None,
            opacity: None,
            use_acrylic: None,
            foreground: None,
            background: None,
            cursor_color: None,
            selection_background: None,
            padding: None,
            webpty: None,
            extra: JsonMap::new(),
        };
        let custom = TerminalProfile {
            guid: None,
            name: "Azure Ops".to_string(),
            icon: None,
            commandline: Some("bash".to_string()),
            starting_directory: None,
            source: None,
            hidden: None,
            tab_color: None,
            tab_title: None,
            color_scheme: None,
            font: None,
            font_face: None,
            font_size: None,
            font_weight: None,
            cell_height: None,
            line_height: None,
            cursor_shape: None,
            opacity: None,
            use_acrylic: None,
            foreground: None,
            background: None,
            cursor_color: None,
            selection_background: None,
            padding: None,
            webpty: None,
            extra: JsonMap::new(),
        };

        assert_eq!(profile_prompt(Some(&powershell)), "PS \\w> ");
        assert_eq!(profile_prompt(Some(&ubuntu)), "\\u@ubuntu:\\w\\$ ");
        assert_eq!(profile_prompt(Some(&custom)), "\\u@azureops:\\w\\$ ");
        assert_eq!(profile_prompt(None), "\\w\\$ ");
    }

    #[cfg(not(windows))]
    #[test]
    fn profile_prompt_uses_wsl_distribution_when_available() {
        let profile = TerminalProfile {
            guid: None,
            name: "Linux".to_string(),
            icon: None,
            commandline: Some("wsl.exe --distribution Debian-12".to_string()),
            starting_directory: None,
            source: None,
            hidden: None,
            tab_color: None,
            tab_title: None,
            color_scheme: None,
            font: None,
            font_face: None,
            font_size: None,
            font_weight: None,
            cell_height: None,
            line_height: None,
            cursor_shape: None,
            opacity: None,
            use_acrylic: None,
            foreground: None,
            background: None,
            cursor_color: None,
            selection_background: None,
            padding: None,
            webpty: None,
            extra: JsonMap::new(),
        };

        assert_eq!(profile_prompt(Some(&profile)), "\\u@debian-12:\\w\\$ ");
    }

    #[cfg(not(windows))]
    #[test]
    fn profile_prompt_prefers_explicit_webpty_prompt() {
        let profile = TerminalProfile {
            guid: None,
            name: "Ops".to_string(),
            icon: None,
            commandline: Some("bash".to_string()),
            starting_directory: None,
            source: None,
            hidden: None,
            tab_color: None,
            tab_title: None,
            color_scheme: None,
            font: None,
            font_face: None,
            font_size: None,
            font_weight: None,
            cell_height: None,
            line_height: None,
            cursor_shape: None,
            opacity: None,
            use_acrylic: None,
            foreground: None,
            background: None,
            cursor_color: None,
            selection_background: None,
            padding: None,
            webpty: Some(WebptyProfileOptions {
                prompt: Some("{user}@{host}:{cwd}{symbol} ".to_string()),
                extra: JsonMap::new(),
            }),
            extra: JsonMap::new(),
        };

        assert_eq!(profile_prompt(Some(&profile)), "\\u@ops:\\w\\$ ");
    }

    #[cfg(not(windows))]
    #[test]
    fn build_launch_plan_normalizes_plain_bash_profiles() {
        let profile = TerminalProfile {
            guid: None,
            name: "Ops".to_string(),
            icon: None,
            commandline: Some("bash".to_string()),
            starting_directory: None,
            source: None,
            hidden: None,
            tab_color: None,
            tab_title: None,
            color_scheme: None,
            font: None,
            font_face: None,
            font_size: None,
            font_weight: None,
            cell_height: None,
            line_height: None,
            cursor_shape: None,
            opacity: None,
            use_acrylic: None,
            foreground: None,
            background: None,
            cursor_color: None,
            selection_background: None,
            padding: None,
            webpty: Some(WebptyProfileOptions {
                prompt: Some("[{profile}] {cwd}{symbol} ".to_string()),
                extra: JsonMap::new(),
            }),
            extra: JsonMap::new(),
        };

        let plan = build_launch_plan(&profile, None);
        let argv = plan
            .command
            .get_argv()
            .iter()
            .filter_map(|value| value.to_str())
            .collect::<Vec<_>>();

        assert_eq!(argv.first().copied(), Some("bash"));
        assert!(argv.contains(&"--noprofile"));
        assert!(argv.contains(&"--norc"));
        assert!(argv.contains(&"-i"));
        assert!(
            plan.notes
                .iter()
                .any(|note| note.contains("interactive bash shell")),
            "plain bash profiles should be normalized onto an interactive shell builder"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn default_shell_builder_normalizes_zsh_hosts_to_clean_interactive_mode() {
        let _guard = env_lock().lock().expect("env mutex poisoned");
        let original_shell = env::var_os("SHELL");
        let fake_zsh = PathBuf::from("/tmp/webpty-test-shells/zsh");

        fs::create_dir_all(fake_zsh.parent().expect("fake zsh should have a parent"))
            .expect("test shell directory should exist");
        fs::write(&fake_zsh, "").expect("fake zsh executable marker should be written");

        unsafe {
            env::set_var("SHELL", &fake_zsh);
        }

        let builder = default_shell_builder(None);
        let argv = builder
            .get_argv()
            .iter()
            .filter_map(|value| value.to_str())
            .collect::<Vec<_>>();

        match original_shell {
            Some(value) => unsafe {
                env::set_var("SHELL", value);
            },
            None => unsafe {
                env::remove_var("SHELL");
            },
        }

        assert_eq!(argv.first().copied(), fake_zsh.to_str());
        assert!(argv.contains(&"-f"));
        assert!(argv.contains(&"-i"));
        assert!(!argv.contains(&"--noprofile"));
    }

    #[test]
    fn normalize_settings_reassigns_hidden_default_profile() {
        let mut settings = default_settings_for_host(HostPlatform::Windows);
        settings.profiles.list[0].hidden = Some(true);

        let normalized = normalize_settings(settings).expect("settings should normalize");

        assert_eq!(
            normalized.default_profile,
            profile_key(&normalized.profiles.list[1])
        );
    }

    #[test]
    fn normalize_settings_rejects_all_hidden_profiles() {
        let mut settings = default_settings();
        for profile in &mut settings.profiles.list {
            profile.hidden = Some(true);
        }

        assert!(
            normalize_settings(settings).is_err(),
            "settings with only hidden profiles should fail"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn default_settings_path_prefers_env_override() {
        let _guard = env_lock().lock().expect("env mutex poisoned");

        let original_override = env::var_os("WEBPTY_SETTINGS_PATH");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");

        unsafe {
            env::set_var("WEBPTY_SETTINGS_PATH", "/tmp/webpty-tests/settings.json");
            env::set_var("XDG_CONFIG_HOME", "/tmp/ignored-xdg");
        }

        assert_eq!(
            default_settings_path(),
            PathBuf::from("/tmp/webpty-tests/settings.json")
        );

        match original_override {
            Some(value) => unsafe { env::set_var("WEBPTY_SETTINGS_PATH", value) },
            None => unsafe { env::remove_var("WEBPTY_SETTINGS_PATH") },
        }

        match original_xdg {
            Some(value) => unsafe { env::set_var("XDG_CONFIG_HOME", value) },
            None => unsafe { env::remove_var("XDG_CONFIG_HOME") },
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn default_settings_path_prefers_user_scope_over_workspace_sample() {
        let _guard = env_lock().lock().expect("env mutex poisoned");

        let original_override = env::var_os("WEBPTY_SETTINGS_PATH");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let original_home = env::var_os("HOME");

        unsafe {
            env::remove_var("WEBPTY_SETTINGS_PATH");
            env::set_var("XDG_CONFIG_HOME", "/tmp/webpty-user-scope");
            env::set_var("HOME", "/tmp/webpty-home");
        }

        let expected = match runtime_host_platform() {
            HostPlatform::MacOs => {
                PathBuf::from("/tmp/webpty-home/Library/Application Support/webpty/settings.json")
            }
            HostPlatform::Linux | HostPlatform::Other => {
                PathBuf::from("/tmp/webpty-user-scope/webpty/settings.json")
            }
            HostPlatform::Windows => unreachable!("windows path test is cfg-gated"),
        };

        assert_eq!(default_settings_path(), expected);

        match original_override {
            Some(value) => unsafe { env::set_var("WEBPTY_SETTINGS_PATH", value) },
            None => unsafe { env::remove_var("WEBPTY_SETTINGS_PATH") },
        }

        match original_xdg {
            Some(value) => unsafe { env::set_var("XDG_CONFIG_HOME", value) },
            None => unsafe { env::remove_var("XDG_CONFIG_HOME") },
        }

        match original_home {
            Some(value) => unsafe { env::set_var("HOME", value) },
            None => unsafe { env::remove_var("HOME") },
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    #[test]
    fn user_settings_path_uses_xdg_config_home() {
        let _guard = env_lock().lock().expect("env mutex poisoned");

        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        unsafe {
            env::set_var("XDG_CONFIG_HOME", "/tmp/webpty-config");
        }

        assert_eq!(
            user_settings_path(),
            Some(PathBuf::from("/tmp/webpty-config/webpty/settings.json"))
        );

        match original_xdg {
            Some(value) => unsafe { env::set_var("XDG_CONFIG_HOME", value) },
            None => unsafe { env::remove_var("XDG_CONFIG_HOME") },
        }
    }

    #[test]
    fn user_settings_path_uses_application_support_on_macos() {
        let _guard = env_lock().lock().expect("env mutex poisoned");

        let original_home = env::var_os("HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        unsafe {
            env::set_var("HOME", "/tmp/webpty-macos-home");
            env::set_var("XDG_CONFIG_HOME", "/tmp/webpty-macos-xdg");
        }

        assert_eq!(
            user_settings_path_for_host(HostPlatform::MacOs),
            Some(PathBuf::from(
                "/tmp/webpty-macos-home/Library/Application Support/webpty/settings.json"
            ))
        );

        match original_home {
            Some(value) => unsafe { env::set_var("HOME", value) },
            None => unsafe { env::remove_var("HOME") },
        }

        match original_xdg {
            Some(value) => unsafe { env::set_var("XDG_CONFIG_HOME", value) },
            None => unsafe { env::remove_var("XDG_CONFIG_HOME") },
        }
    }

    #[test]
    fn default_settings_for_linux_uses_host_shell_defaults() {
        let _guard = env_lock().lock().expect("env mutex poisoned");

        let original_shell = env::var_os("SHELL");
        unsafe {
            env::set_var("SHELL", "/bin/bash");
        }

        let settings = default_settings_for_host(HostPlatform::Linux);
        let primary = settings
            .profiles
            .list
            .first()
            .expect("linux defaults should include a primary profile");

        assert_eq!(settings.default_profile, HOST_SHELL_PROFILE_GUID);
        assert_eq!(primary.name, "Bash");
        assert_eq!(primary.commandline.as_deref(), Some("/bin/bash"));
        assert_eq!(primary.starting_directory.as_deref(), Some("~"));
        assert!(
            settings.profiles.list.iter().all(|profile| profile
                .commandline
                .as_deref()
                .is_none_or(|commandline| !commandline.contains(".exe"))),
            "linux defaults should not seed Windows executables"
        );

        match original_shell {
            Some(value) => unsafe { env::set_var("SHELL", value) },
            None => unsafe { env::remove_var("SHELL") },
        }
    }

    #[test]
    fn default_settings_for_windows_keeps_windows_profiles() {
        let settings = default_settings_for_host(HostPlatform::Windows);
        let primary = settings
            .profiles
            .list
            .first()
            .expect("windows defaults should include a primary profile");

        assert_eq!(settings.default_profile, POWERSHELL_PROFILE_GUID);
        assert_eq!(primary.name, "PowerShell");
        assert_eq!(primary.commandline.as_deref(), Some("pwsh.exe"));
        assert!(
            settings
                .profiles
                .list
                .iter()
                .any(|profile| profile.commandline.as_deref() == Some("wsl.exe -d Ubuntu"))
        );
    }

    #[test]
    fn load_settings_accepts_comments_and_trailing_commas() {
        let path = env::temp_dir().join(format!("webpty-settings-{}.json", Uuid::new_v4()));
        let fixture = r#"
        {
          // shared profile settings
          "$schema": "https://aka.ms/terminal-profiles-schema",
          "defaultProfile": "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}",
          "profiles": {
            "list": [
              {
                "guid": "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}",
                "name": "PowerShell",
                "commandline": "pwsh.exe",
              },
            ],
          },
        }
        "#;

        fs::write(&path, fixture).expect("fixture should be written");
        let settings = load_settings(&path).expect("json5 settings should load");
        assert_eq!(
            settings.default_profile,
            "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}"
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn load_settings_accepts_object_form_actions() {
        let path = env::temp_dir().join(format!("webpty-settings-{}.json", Uuid::new_v4()));
        let fixture = r#"
        {
          "defaultProfile": "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}",
          "actions": [
            {
              "command": {
                "action": "openSettings",
                "target": "settingsUI"
              },
              "keys": ["ctrl+,"]
            }
          ],
          "profiles": {
            "list": [
              {
                "guid": "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}",
                "name": "PowerShell",
                "commandline": "pwsh.exe"
              }
            ]
          }
        }
        "#;

        fs::write(&path, fixture).expect("fixture should be written");
        let settings = load_settings(&path).expect("object-form actions should load");
        let action = settings.actions.first().expect("action should exist");

        match action.command.as_ref() {
            Some(TerminalActionCommand::Structured(command)) => {
                assert_eq!(
                    command.get("action").and_then(JsonValue::as_str),
                    Some("openSettings")
                );
            }
            other => panic!("unexpected action command: {other:?}"),
        }

        let _ = fs::remove_file(path);
    }

    #[test]
    fn persist_settings_preserves_nested_font_and_unknown_keys() {
        let path = env::temp_dir().join(format!("webpty-settings-{}.json", Uuid::new_v4()));
        let fixture = r#"
        {
          "$schema": "https://aka.ms/terminal-profiles-schema",
          "defaultProfile": "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}",
          "experimentalFeature": true,
          "profiles": {
            "defaults": {
              "font": {
                "face": "Cascadia Mono",
                "size": 13,
                "weight": "semi-light",
                "cellHeight": 1.22
              }
            },
            "list": [
              {
                "guid": "{4f1c71d0-7f40-4f9f-91b0-6e1f0d59ad11}",
                "name": "PowerShell",
                "commandline": "pwsh.exe",
                "font": {
                  "face": "Cascadia Mono",
                  "size": 14,
                  "weight": 600
                },
                "webpty": {
                  "prompt": "[ops] \\w\\$ ",
                  "slot": "keep-nested"
                },
                "customProfileFlag": "keep-me"
              }
            ]
          }
        }
        "#;

        fs::write(&path, fixture).expect("fixture should be written");

        let settings = load_settings(&path).expect("settings should load");
        persist_settings(&path, &settings).expect("settings should persist");

        let written = fs::read_to_string(&path).expect("persisted file should exist");
        let payload: JsonValue =
            serde_json::from_str(&written).expect("persisted JSON should parse");

        assert_eq!(
            payload.pointer("/profiles/defaults/font/face"),
            Some(&JsonValue::String("Cascadia Mono".to_string()))
        );
        assert_eq!(
            payload
                .pointer("/profiles/list/0/font/weight")
                .and_then(JsonValue::as_f64),
            Some(600.0)
        );
        assert_eq!(
            payload.pointer("/profiles/list/0/customProfileFlag"),
            Some(&JsonValue::String("keep-me".to_string()))
        );
        assert_eq!(
            payload.pointer("/profiles/list/0/webpty/prompt"),
            Some(&JsonValue::String("[ops] \\w\\$ ".to_string()))
        );
        assert_eq!(
            payload.pointer("/profiles/list/0/webpty/slot"),
            Some(&JsonValue::String("keep-nested".to_string()))
        );
        assert_eq!(
            payload.get("experimentalFeature"),
            Some(&JsonValue::Bool(true))
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn load_settings_does_not_mutate_invalid_existing_file() {
        let path = env::temp_dir().join(format!("webpty-settings-{}.json", Uuid::new_v4()));
        let fixture = "{ invalid json";

        fs::write(&path, fixture).expect("fixture should be written");
        assert!(
            load_settings(&path).is_err(),
            "invalid settings should fail"
        );
        assert_eq!(
            fs::read_to_string(&path).expect("fixture should remain readable"),
            fixture
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn preview_lines_strip_terminal_control_sequences() {
        let transcript = "\u{1b}[?2004hPS ~> \n\u{1b}]0;tab-title\u{7}kubectl get pods\n";

        assert_eq!(
            preview_lines(transcript),
            vec!["PS ~>".to_string(), "kubectl get pods".to_string()]
        );
    }

    #[test]
    fn status_supports_funnel_recognizes_multiple_capability_shapes() {
        let exact = serde_json::json!({
            "Self": {
                "Capabilities": ["funnel"]
            }
        });
        let mapped = serde_json::json!({
            "Self": {
                "CapabilitiesMap": {
                    "funnel": true
                }
            }
        });
        let port_only = serde_json::json!({
            "Self": {
                "Capabilities": ["https://tailscale.com/cap/web/funnel?ports=443,8443"]
            }
        });
        let cap_map = serde_json::json!({
            "Self": {
                "CapMap": {
                    "https://tailscale.com/cap/funnel-ports?ports=443,8443,10000": null
                }
            }
        });

        assert!(status_supports_funnel(&exact));
        assert!(status_supports_funnel(&mapped));
        assert!(status_supports_funnel(&port_only));
        assert!(status_supports_funnel(&cap_map));
        assert_eq!(funnel_capability_ports(&port_only), Some(vec![443, 8443]));
        assert_eq!(
            funnel_capability_ports(&cap_map),
            Some(vec![443, 8443, 10000])
        );
    }

    #[test]
    fn tailscale_bootstrap_error_surfaces_auth_url() {
        let status = serde_json::json!({
            "BackendState": "NeedsLogin",
            "AuthURL": "https://login.tailscale.example/auth"
        });

        assert!(
            tailscale_bootstrap_error(&status, "NeedsLogin")
                .contains("https://login.tailscale.example/auth")
        );
    }

    #[test]
    fn display_tailscale_args_redacts_auth_keys() {
        let args = tailscale_up_args(Some("tskey-auth-k3y"));

        assert_eq!(
            display_tailscale_args(&args),
            format!("up --timeout={DEFAULT_TAILSCALE_UP_TIMEOUT} --auth-key=<redacted>")
        );
    }

    #[test]
    fn resolve_launch_cwd_rejects_file_paths() {
        let path = env::temp_dir().join(format!("webpty-cwd-{}.txt", Uuid::new_v4()));
        fs::write(&path, "cwd").expect("fixture should be written");

        let mut notes = Vec::new();
        let cwd = resolve_launch_cwd(path.to_str(), &mut notes);

        assert_ne!(cwd, path);
        assert!(notes.iter().any(|note| note.contains("not a directory")));

        let _ = fs::remove_file(path);
    }
}
