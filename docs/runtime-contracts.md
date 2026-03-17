# webpty Runtime Contracts

### `SessionItem`

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
  "message": "WT-compatible mock transport ready",
  "websocketPath": "/ws/:sessionId",
  "mode": "settings-json",
  "features": [
    "health",
    "settings-get-put",
    "sessions-list-create-delete",
    "websocket-transcript-replay"
  ]
}
```

### `GET /api/settings`

Returns the current WT-compatible `settings.json` subset loaded from
`config/webpty.settings.json`.

Supported top-level fields:

- `$schema`
- `defaultProfile`
- `copyFormatting`
- `theme`
- `themes`
- `actions`
- `profiles.defaults`
- `profiles.list`
- `schemes`

### `PUT /api/settings`

Accepts the same WT-compatible JSON subset and persists it to
`config/webpty.settings.json`.

### `GET /api/sessions`

Returns `{ "sessions": SessionItem[] }`.

### `POST /api/sessions`

Creates a session record and returns:

- `session`
- `tab`
- `pane`

The frontend currently only needs the session portion conceptually, but the
server contract is still shaped for later PTY expansion.

### `DELETE /api/sessions/:session_id`

Deletes a session record and returns `204 No Content`.

## WebSocket Protocol

Endpoint: `GET /ws/:session_id`

The socket is strict: unknown session IDs return `404` and are not auto-created.

### Client messages

```json
{ "type": "input", "data": "ls\n" }
{ "type": "resize", "cols": 120, "rows": 32 }
{ "type": "ping" }
```

### Server messages

```json
{ "type": "ready", "sessionId": "session-shell" }
{ "type": "output", "data": "webpty connected\r\n" }
{ "type": "resized", "cols": 120, "rows": 32 }
{ "type": "pong" }
```

## Prototype Assumptions

- The UI does not require a live backend to render.
- The backend is still a mock transport layer with transcript replay.
- Theme switching and profile launchers are driven by a WT-compatible settings file.
- Real PTY transport is the next major backend milestone.
