# webpty Runtime Contracts

## Frontend State Shapes

### TabSummary

- `id: string`
- `title: string`
- `profileId: string`
- `accent: string`
- `hasBell: boolean`
- `isDirty: boolean`
- `lastUsedAt: string`

### PaneSummary

- `id: string`
- `sessionId: string`
- `profileId: string`
- `cwd: string`
- `title: string`
- `status: "running" | "idle" | "attention"`
- `cols: number`
- `rows: number`

### LayoutNode

- `type: "pane"` with `paneId`
- `type: "split"` with `axis`, `ratio`, `children`

### OverlayState

- `none`
- `palette`
- `tab-switcher`
- `search`
- `settings`

## HTTP Endpoints

### `GET /api/health`

Returns runtime health and feature flags.

### `GET /api/blueprint`

Returns the demo layout, profiles, actions, and settings categories used by the prototype UI.

### `POST /api/sessions`

Creates a session and returns:

- `session`
- `tab`
- `pane`

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

- The initial server may use seeded or mocked session output.
- Real PTY integration is a next step, but the API is already shaped around session IO.
- Frontend rendering should not depend on a live server to display the workspace shell.
