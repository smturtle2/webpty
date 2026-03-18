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

Example:

```json
{
  "status": "ok",
  "message": "Schema-compatible PTY server and embedded shell ready",
  "websocketPath": "/ws/:sessionId",
  "mode": "standalone-shell",
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
settings path.

Default path selection:

- `webpty up --settings <path>` or `WEBPTY_SETTINGS_PATH=<path>`
- `./config/webpty.settings.json` from the current working directory, if present
- Linux/macOS: `~/.config/webpty/settings.json`
- Windows: `%APPDATA%\\webpty\\settings.json`

Disk parsing accepts JSONC-style comments and trailing commas.

### `PUT /api/settings`

Accepts the same shared JSON subset and persists it back to the active settings
path. Unsupported keys that travel alongside the supported subset are preserved
on round-trip.

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
- if `title` is omitted, the runtime uses the profile `tabTitle` when present, otherwise the profile `name`
- the runtime does not inject a synthetic startup banner before the shell prompt
- on non-Windows hosts, platform fallbacks keep a prompt shape that matches the requested profile more closely than a raw `bash-5.2$` prompt

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
- `webpty up --funnel` depends on the local `tailscale` client and an authenticated node with Funnel capability
- `webpty up --funnel` reuses an existing Funnel mapping for the same local target when possible, otherwise it allocates an allowed HTTPS port and cleans it up on exit
- advanced pane graphs, search, and command palette remain future milestones
