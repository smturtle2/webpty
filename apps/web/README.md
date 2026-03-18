# webpty Web App

This package contains the React/Vite frontend for `webpty`.

## Responsibilities

- render the terminal-dominant shell layout
- keep the thin right-side session rail in sync with runtime sessions
- support rail show/hide and split creation without adding top chrome
- present a desktop-style settings panel without adding top chrome
- load and save the shared settings schema subset
- connect the active viewport to the Rust PTY backend over WebSocket

## Development

Run the backend first:

```bash
cargo run --manifest-path ../server/Cargo.toml -- up
```

Then start the web app:

```bash
npm run dev
```

The Vite dev server proxies `/api` and `/ws` to `http://127.0.0.1:3001`.

## Key Files

- `src/App.tsx` - shell state, layout, settings panel, and keyboard handling
- `src/App.css` - right rail and settings panel styling
- `src/components/TerminalViewport.tsx` - xterm.js viewport and WebSocket transport
- `src/lib/terminalProfiles.ts` - shared theme/profile/scheme resolution
- `src/data/demo.ts` - local fallback data when the backend is offline
