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
  "message": "WT-compatible PTY server and embedded shell ready",
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
    "funnel-ssh"
  ]
}
```

### `GET /`

Serves the embedded production web UI that is bundled into the Rust binary.

### `GET /api/settings`

Returns the current WT-compatible `settings.json` subset loaded from
`config/webpty.settings.json`.

### `PUT /api/settings`

Accepts the same WT-compatible JSON subset and persists it back to
`config/webpty.settings.json`. Unsupported keys that travel alongside the
supported subset are preserved on round-trip.

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

Returns:

- `session`
- `tab`
- `pane`

The frontend primarily consumes `session`, but `tab` and `pane` are kept for
future parity with richer terminal layouts.

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

- The UI can still fall back to demo mode if the backend is unavailable.
- The backend is now a real PTY runtime that also serves the production shell bundle.
- WT-compatible theme and profile definitions remain the main source of truth.
- Split panes, search, and command palette remain future milestones.
