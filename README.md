<div align="center">

# webpty

**A UI/UX-first web terminal workspace powered by Rust**

[![GitHub stars](https://img.shields.io/github/stars/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/issues)
[![Rust](https://img.shields.io/badge/Rust-1.94+-000000?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react)](https://react.dev/)
[![Axum](https://img.shields.io/badge/Axum-0.8-111111?style=for-the-badge)](https://github.com/tokio-rs/axum)

[한국어 README](./README.ko.md)

</div>

`webpty` is a browser-first terminal project inspired by the best workflows in
Windows Terminal and rebuilt around one priority: **great UI/UX before
everything else**.

Instead of starting from a plain terminal viewport, `webpty` starts from the
full workspace experience:

- dense tab chrome
- multi-pane layouts
- a shared command palette / tab switcher interaction model
- pane-aware search
- a settings studio that feels explorable, not just editable

## Preview

![webpty preview](./docs/assets/webpty-preview.png)

## Why

Modern terminal work is not just “render text fast”. It is:

- switching between active sessions without losing context
- understanding state at a glance
- splitting work across panes without visual chaos
- discovering commands and settings without memorizing everything

`webpty` treats the terminal as a **workspace product**, not only a renderer.

## Current Status

`webpty` is currently an early but working prototype with:

- a React/Vite frontend focused on shell chrome and interaction design
- a Rust/Axum backend skeleton with HTTP and WebSocket contracts
- research and runtime documents to keep UI and backend aligned

What exists today:

- custom app shell and title area
- tab row with profile/state cues
- split-pane workspace
- reusable command palette and MRU tab switcher
- search overlay attached to the active pane
- settings studio prototype
- mock terminal viewports using `xterm.js`
- Rust session contract server for health, blueprint, session creation, and WebSocket IO

What is not done yet:

- real PTY integration
- persistent settings and profile import
- broadcast input
- native window / quake mode
- multi-window orchestration

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite
- `xterm.js`

### Backend

- Rust
- Axum
- Tokio
- WebSocket contracts for session IO

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

The frontend works standalone as a UI prototype. In development mode it can
also probe the Rust server through the Vite proxy.

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
│   ├── server/   # Axum contract server and WebSocket mock transport
│   └── web/      # React/Vite UI prototype
├── docs/
│   ├── research-spec.md
│   ├── runtime-contracts.md
│   └── assets/
└── README.md
```

## Architecture Direction

`webpty` is intentionally split into a browser UI and a Rust core:

```text
React UI
  ├─ workspace shell
  ├─ tabs / panes / overlays
  ├─ settings studio
  └─ terminal surface
       ↓
HTTP + WebSocket contracts
       ↓
Rust core
  ├─ session lifecycle
  ├─ PTY transport
  ├─ layout/runtime state
  └─ settings and action dispatch
```

This keeps the UX layer flexible while reserving Rust for the parts that should
eventually own session correctness and performance.

## Documentation

- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)

## Roadmap

- [ ] Replace mock transport with a real PTY-backed session layer
- [ ] Add live terminal IO over WebSocket
- [ ] Persist tabs, panes, and profile state
- [ ] Import a useful subset of Windows Terminal settings
- [ ] Split the palette/settings UI into lazy-loaded bundles
- [ ] Add drag-and-drop tab and pane interactions

## Design Principles

- **Keyboard-first, not keyboard-only**: every major action should be fast from the keyboard and still clear with a pointer.
- **State must stay visible**: tabs and panes should communicate status without opening secondary UI.
- **One overlay grammar**: command palette, tab switcher, and related overlays should feel like one system.
- **Settings should teach the product**: navigation and previews matter as much as the raw values.

## Inspiration

`webpty` is strongly informed by:

- [microsoft/terminal](https://github.com/microsoft/terminal)
- the Windows Terminal command palette and advanced tab switcher specs
- terminal products that treat layout and command discovery as first-class UX concerns

## Contributing

The repo is still early, so the most useful contributions right now are:

- UX feedback on layout and interaction flow
- backend API and PTY architecture feedback
- accessibility review for overlays, focus movement, and status signaling

---

If you care about terminal UX, session ergonomics, and browser-native tooling,
`webpty` is aiming directly at that problem space.
