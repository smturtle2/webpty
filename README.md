<div align="center">

# webpty

**A Rust-backed, Windows Terminal-compatible terminal shell for the browser**

[![GitHub stars](https://img.shields.io/github/stars/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/issues)
[![Rust](https://img.shields.io/badge/Rust-1.94+-000000?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react)](https://react.dev/)

[한국어 README](./README.ko.md)

</div>

`webpty` keeps the terminal dominant: the shell owns almost the whole screen,
sessions live in a narrow rail on the right, and a WT-compatible settings file
drives profiles, themes, and keyboard shortcuts. The shipped CLI is a single
Rust binary: `webpty up` starts the embedded web UI and the PTY runtime
together.

The app is intentionally smaller than Windows Terminal, but it now runs a real
Rust PTY backend instead of a mock transcript transport.

## Preview

![webpty preview](./docs/assets/webpty-preview.png)

![webpty settings studio](./docs/assets/webpty-studio.png)

## Current Status

Implemented today:

- live PTY-backed sessions from a Rust/Axum server
- embedded production web UI served directly by the Rust binary
- `webpty up` CLI entrypoint for local startup
- `webpty up --funnel` external access through an SSH reverse tunnel
- one dominant black terminal surface with a narrow white right-side session rail
- WT-compatible `settings.json` loading, normalization, persistence, and unknown-key round-trip preservation
- profile launch, default profile selection, and theme switching in a right-anchored settings studio
- WebSocket input/output streaming and PTY resize handling

Not implemented yet:

- split panes
- command palette and search surface
- drag/drop or manual tab reordering
- deeper Windows Terminal action object parity
- session restoration across app restarts

## Product Direction

The reference project is [microsoft/terminal](https://github.com/microsoft/terminal).

The goal is not line-by-line parity. The goal is:

- a shell that feels like a terminal application first
- compatibility with the useful Windows Terminal settings subset
- a Rust runtime that owns PTY lifecycle, input, resize, and streaming
- restrained chrome with no persistent top toolbar and a cleaner browser footprint than a dashboard-style UI

## Quick Start

### Requirements

- Rust 1.94+
- Node.js 24+ and npm 11+ only if you are rebuilding the frontend bundle or working on the UI

### Global install

```bash
cargo install --git https://github.com/smturtle2/webpty --locked
```

From a local checkout you can also install the binary directly:

```bash
cargo install --path apps/server --locked
```

### Run

```bash
webpty up
```

### Run with external access

```bash
webpty up --funnel
```

`--funnel` uses the local OpenSSH client and `localhost.run` to expose the
local server. `ssh` must be available on the host.

### Development

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

The Vite dev server proxies `/api` and `/ws` requests to `http://127.0.0.1:3001`,
while production builds are emitted into `apps/server/ui` and served by the Rust
binary.

## Validate

```bash
npm run build:web
cargo check
```

`npm run lint:web` is still configured, but it currently hangs in this workspace
and needs separate investigation.

## Project Structure

```text
.
├── apps/
│   ├── server/   # Axum PTY runtime and WT-compatible settings contracts
│   └── web/      # React/Vite terminal shell UI
├── config/
│   └── webpty.settings.json
├── docs/
│   ├── compatibility.md
│   ├── research-spec.md
│   ├── runtime-contracts.md
│   └── assets/
└── README.md
```

## Architecture

```text
React shell
  ├─ terminal stage
  ├─ right-side session rail
  └─ right-anchored settings studio
       ↓
Rust runtime
  ├─ serves embedded UI assets
  ├─ WT-compatible settings load/save
  ├─ PTY-backed session lifecycle
  ├─ input / resize / output streaming
  ├─ session creation and deletion
  └─ optional SSH funnel
```

## Documentation

- [Compatibility notes](./docs/compatibility.md)
- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)

## Roadmap

- [x] Replace mock transport with a PTY-backed session layer
- [x] Move to a terminal-dominant layout with a right-side session rail
- [x] Keep WT-compatible theme and profile editing in-app
- [ ] Add split panes
- [ ] Reintroduce search and command palette surfaces
- [ ] Expand WT settings and action compatibility
