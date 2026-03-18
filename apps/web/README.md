# webpty Web App

This package contains the React/Vite frontend for `webpty`.

## Responsibilities

- render the terminal-dominant shell layout
- keep the narrow right-side session rail in sync with runtime sessions
- present a Windows 11-style settings panel without adding top chrome
- load and save the WT-compatible settings subset
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
- `src/App.css` - Windows 11-inspired rail and panel styling
- `src/components/TerminalViewport.tsx` - xterm.js viewport and WebSocket transport
- `src/lib/windowsTerminal.ts` - WT-compatible theme/profile/scheme resolution
- `src/data/demo.ts` - local fallback data when the backend is offline
