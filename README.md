<div align="center">

# webpty

**A simple Rust-backed terminal app for the browser**

[![GitHub stars](https://img.shields.io/github/stars/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/issues)
[![Rust](https://img.shields.io/badge/Rust-1.94+-000000?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react)](https://react.dev/)

[한국어 README](./README.ko.md)

</div>

`webpty` is a browser-first terminal app inspired by the visual restraint and
practical session management of Windows Terminal.

The current prototype is intentionally narrow:

- one large terminal surface
- a simple top chrome
- a right-side session rail
- Rust HTTP/WebSocket contracts behind the UI

## Preview

![webpty preview](./docs/assets/webpty-preview.png)

## Current Status

What exists today:

- a dark, minimal terminal window shell
- one active terminal viewport powered by `xterm.js`
- a right-side session list for switching between sessions
- keyboard shortcuts for new session, close session, and session cycling
- a Rust/Axum contract server for health, session creation, and WebSocket IO

What does not exist yet:

- real PTY integration
- tab drag/drop
- Windows Terminal-style settings UI
- search, palette, and pane management

## Philosophy

The goal right now is not “every terminal feature”.

The goal is:

- a clean shell that feels like a real terminal app
- clear session switching
- minimal chrome
- a Rust core that can later own PTY lifecycle and transport

## Quick Start

### Requirements

- Node.js 24+
- npm 11+
- Rust 1.94+

### Install

```bash
npm install
```

### Run the frontend

```bash
npm run dev:web
```

### Run the Rust server

```bash
cargo run --manifest-path apps/server/Cargo.toml
```

The frontend runs standalone as a UI prototype. In development mode it can also
probe the Rust server through the Vite proxy.

## Validate

```bash
npm run lint:web
npm run build:web
cargo check --manifest-path apps/server/Cargo.toml
```

## Project Structure

```text
.
├── apps/
│   ├── server/   # Axum contract server and mock session transport
│   └── web/      # React/Vite terminal UI
├── docs/
│   ├── research-spec.md
│   ├── runtime-contracts.md
│   └── assets/
└── README.md
```

## Architecture

```text
React UI
  ├─ top chrome
  ├─ active terminal viewport
  └─ right session rail
       ↓
HTTP + WebSocket
       ↓
Rust core
  ├─ health and session endpoints
  ├─ mock transport today
  └─ real PTY transport later
```

## Documentation

- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)

## Roadmap

- [ ] Replace mock transport with a PTY-backed session layer
- [ ] Stream live shell output over WebSocket
- [ ] Persist session state
- [ ] Reintroduce Windows Terminal-style settings later, with a much closer UI

## Inspiration

- [microsoft/terminal](https://github.com/microsoft/terminal)

The current app is intentionally simpler than Windows Terminal. The reference
is mostly about **tone, density, and terminal-app feel**, not feature parity.
