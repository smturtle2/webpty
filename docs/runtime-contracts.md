# webpty Runtime Contracts

## Frontend State Shapes

### `ProfileDefinition`

- `id: string`
- `name: string`
- `accent: string`
- `icon: string`
- `shell: string`

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

### `POST /api/sessions`

Creates a session record and returns:

- `session`
- `tab`
- `pane`

The frontend currently only needs the session portion conceptually, but the
server contract is still shaped for later PTY expansion.

## WebSocket Protocol

Endpoint: `GET /ws/:session_id`

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
- The backend is still a mock transport layer.
- Real PTY transport is the next major backend milestone.
