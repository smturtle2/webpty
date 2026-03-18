# webpty Runtime Contracts

## `SessionItem`

- `id: string`
- `title: string`
- `profileId: string`
- `status: "running" | "idle" | "attention"`
- `hasActivity: boolean`
- `lastUsedLabel: string`
- `cwd: string`
- `previewLines: string[]`

## HTTP Endpoints

### `GET /api/health`

Returns runtime health and feature flags for the frontend shell.
`hostPlatform` lets the UI align profile-editor hints with the actual runtime OS.

Example:

```json
{
  "status": "ok",
  "message": "Schema-compatible PTY server and embedded shell ready",
  "websocketPath": "/ws/:sessionId",
  "mode": "standalone-shell",
  "hostPlatform": "linux",
  "features": [
    "health",
    "embedded-shell",
    "settings-read",
    "settings-write",
    "sessions-list",
    "sessions-create-delete",
    "websocket-live-pty",
    "pty-resize-input-output",
    "tailscale-funnel"
  ]
}
```

### `GET /`

Serves the embedded production web UI bundled into the Rust binary.

### `GET /api/settings`

Returns the current shared `settings.json` subset loaded from the active
settings path. The payload can also include `webpty.language` for UI-language
selection, where the value is `system` or a registered locale code.

Default path selection:

- `webpty up --settings <path>` or `WEBPTY_SETTINGS_PATH=<path>`
- Linux: `~/.config/webpty/settings.json`
- macOS: `~/Library/Application Support/webpty/settings.json`
- Windows: `%APPDATA%\\webpty\\settings.json`

The repo sample stays opt-in through `webpty up --settings ./config/webpty.settings.json`.
It is a fixed demo catalog for screenshots and manual QA, not the same thing as the
generated first-run defaults.

Disk parsing accepts JSONC-style comments and trailing commas.
If the settings file is missing, the generated default profile catalog follows the runtime host rather than assuming one fixed OS.

### `PUT /api/settings`

Accepts the same shared JSON subset and persists it back to the active settings
path. Unsupported keys that travel alongside the supported subset are preserved
on round-trip.

Notes:

- the payload must keep at least one visible profile
- `defaultProfile` is normalized onto a visible launchable profile before persistence

### `GET /api/sessions`

Returns `{ "sessions": SessionItem[] }`.

### `POST /api/sessions`

Creates a PTY-backed session.

Accepted fields:

- `profileId` or `profile_id`
- `cwd`
- `title`

Notes:

- requests targeting a `hidden: true` profile return `400`
- runtime settings normalization keeps `defaultProfile` on a visible launchable profile
- runtime settings normalization rejects payloads that hide every profile
- if `title` is omitted, the runtime uses the profile `tabTitle` when present, otherwise the profile `name`
- the runtime does not inject a synthetic startup banner before the shell prompt
- on non-Windows hosts, plain shell profile commandlines are normalized toward prompt-aware interactive launches, and platform fallbacks keep a prompt shape that matches the requested profile more closely than a raw `bash-5.2$` prompt
- default zsh host-shell launches also use a clean interactive path so host startup files do not immediately override the profile-shaped prompt
- `cwd` token expansion accepts only directories; existing file paths fall back to the current working directory

Returns:

- `session`
- `tab`
- `pane`

The frontend primarily consumes `session`, but `tab` and `pane` are kept for
future parity with richer layouts.

### `DELETE /api/sessions/:session_id`

Stops and deletes a session record. Returns `204 No Content`.

## WebSocket Protocol

Endpoint: `GET /ws/:session_id`

The socket is strict: unknown session IDs return `404` and are not auto-created.

Connection behavior:

- on connect, the current transcript snapshot is replayed once
- subsequent PTY output is streamed as deltas
- preview summaries derived from the transcript strip terminal control sequences before reaching the HTTP API

### Client messages

```json
{ "type": "input", "data": "ls\n" }
{ "type": "resize", "cols": 120, "rows": 32 }
{ "type": "ping" }
```

### Server messages

```json
{ "type": "ready", "sessionId": "session-shell" }
{ "type": "output", "data": "PowerShell 7.5.4\r\n" }
{ "type": "resized", "cols": 120, "rows": 32 }
{ "type": "pong" }
```

## Prototype Assumptions

- the UI can still fall back to demo mode if the backend is unavailable
- the backend is a real PTY runtime that also serves the production shell bundle
- profile and theme definitions remain the main source of truth
- `webpty up --funnel` depends on the local `tailscale` client and a node with Funnel capability, and it first attempts `tailscale up` automatically when the client is offline
- `webpty up --funnel` honors `WEBPTY_TAILSCALE_AUTH_KEY`, `TS_AUTHKEY`, and `TS_AUTH_KEY` during automatic bootstrap and otherwise prints the interactive auth URL when login is still required
- `webpty up --funnel` reuses an existing Funnel mapping for the same local target when possible, otherwise it allocates an allowed HTTPS port and cleans it up on exit, including timeout / SIGTERM-style shutdown paths
- the settings surfaces open in a dedicated workspace tab instead of overlaying the terminal stage
- the settings workspace includes Theme, Profile, Language, JSON, and Shortcut sections
- the frontend uses `hostPlatform` from `/api/health` to keep Profile Studio command and directory placeholders host-aware
- the frontend can persist `webpty.language` as `system` or a registered locale code, and unknown saved codes fall back to the default shipped locale in the UI
- split panes keep subtle separators and active-pane framing inside the terminal workspace
- advanced pane graphs, search, and command palette remain future milestones
