<div align="center">

# webpty

**Rust-backed browser terminal shell with shared profile and theme settings**

[![GitHub stars](https://img.shields.io/github/stars/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/issues)
[![Rust](https://img.shields.io/badge/Rust-1.94+-000000?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react)](https://react.dev/)

[한국어 README](./README.ko.md)

</div>

`webpty` keeps the shell in control of the screen.
The terminal stays black and dominant, the session rail stays thin and bright
on the right edge, the settings workspace opens as its own rail tab, and the shipped
binary runs the UI and PTY runtime together with `webpty up`.

Profiles, themes, schemes, actions, and defaults use a shared desktop-terminal
`settings.json` shape. Unknown keys are preserved on save, and disk loading now
accepts JSONC-style comments and trailing commas.

## Preview

![webpty preview](./docs/assets/webpty-preview.png)

![webpty theme studio](./docs/assets/webpty-studio.png)

![webpty profile studio](./docs/assets/webpty-profile-studio.png)

## Current Status

Implemented:

- live PTY-backed sessions from a Rust/Axum server
- embedded production UI served directly by the Rust binary
- `webpty up` CLI entrypoint for local startup
- `webpty up --funnel` external access through Tailscale Funnel
- black terminal stage with no top toolbar
- narrow right-side rail with show/hide support
- tighter Windows 11-aligned rail density with white flat tab surfaces and a dedicated settings workspace tab
- dedicated Theme Studio for `themes[]`, `theme`, frame colors, and shell chrome editing
- dedicated Profile Studio for `profiles.list[]`, default profile, prompt, font, and shell field editing
- in-app create / duplicate / delete flows for profile and theme entries
- in-app color pickers for tab, frame, shell, cursor, and selection colors
- token shortcut chips for shared theme color values such as `accent` and `terminalBackground`
- live profile preview surface for prompt, tab accent, and shell color verification
- optional `webpty.prompt` templates with `{cwd}`, `{user}`, `{host}`, `{profile}`, and `{symbol}` tokens
- schema-compatible `settings.json` loading, normalization, persistence, and unknown-key round-trip preservation
- JSONC-style settings file loading on disk
- JSONC-style editing in the in-app `settings.json` panel
- string and object-form action bindings such as `{ "command": { "action": "newTab" } }`
- runtime-matched profile prompt previews in Profile Studio and theme previews
- per-profile prompt shaping on non-Windows fallbacks so sessions do not collapse to `bash-5.2$`
- vertical and horizontal split creation inside the active tab
- WebSocket input/output streaming and PTY resize handling
- browser-safe profile icon sources rendered in the rail and settings workspace
- embedded UI rebuild tracking so Rust picks up fresh bundled assets after frontend builds

Known gaps:

- deeper pane graphs, drag rearranging, and persisted pane layouts
- drag/drop tab ordering
- broader action object coverage beyond the current tab/settings subset
- host-local icon URI parity for every profile asset format
- session restoration across app restarts

## Quick Start

### Requirements

- Rust 1.94+
- Node.js 24+ and npm 11+ only when rebuilding the frontend bundle or working on the UI

### Global Install

```bash
cargo install --git https://github.com/smturtle2/webpty --bin webpty --locked
```

Local checkout install:

```bash
cargo install --path apps/server --bin webpty --locked
```

### Run

```bash
webpty up
```

Run with the repository sample settings:

```bash
webpty up --settings ./config/webpty.settings.json
```

### External Access

```bash
webpty up --funnel
```

`--funnel` uses the local `tailscale` CLI to publish the embedded web UI. Run
`tailscale up` first and make sure the node has Funnel capability enabled.
Treat Funnel as public exposure of the shell surface and only use it behind a
trusted machine and network policy.

## Settings Path

Resolution order:

1. `webpty up --settings <path>`
2. `WEBPTY_SETTINGS_PATH=<path>`
3. `./config/webpty.settings.json` in the current working directory, if present
4. user-scoped platform path

User-scoped platform path:

- Linux/macOS: `~/.config/webpty/settings.json`
- Windows: `%APPDATA%\\webpty\\settings.json`

If the file does not exist, `webpty` creates a default one.
If an existing file is invalid, startup fails without overwriting it.

## Development

Install workspace dependencies:

```bash
npm install
```

Run the frontend dev server:

```bash
npm run dev:web
```

Run the Rust runtime:

```bash
cargo run -- up
```

The Vite dev server proxies `/api` and `/ws` to `http://127.0.0.1:3001`, while
production builds are emitted into `apps/server/ui` and served by the Rust
binary. The Rust build watches `apps/server/ui`, so a fresh backend build
re-embeds updated frontend assets automatically.

## Validate

```bash
npm run build:web
cargo test --manifest-path apps/server/Cargo.toml
cargo check
```

## Architecture

```text
React shell
  ├─ terminal stage
  ├─ right-side session rail
  └─ settings workspace tab
       ↓
Rust runtime
  ├─ embedded asset serving
  ├─ settings load/save
  ├─ PTY session lifecycle
  ├─ input / resize / output streaming
  ├─ session creation and deletion
  └─ optional Tailscale Funnel
```

## Documentation

- [Implementation audit](./docs/implementation-audit.md)
- [Compatibility notes](./docs/compatibility.md)
- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)
