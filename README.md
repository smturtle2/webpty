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

Profiles, themes, schemes, actions, and defaults use a supported shared
desktop-terminal `settings.json` subset. Unknown keys are preserved on save,
and disk loading now accepts JSONC-style comments and trailing commas.

## Preview

![webpty preview](./docs/assets/webpty-preview.png)

![webpty theme studio](./docs/assets/webpty-studio.png)

![webpty profile studio](./docs/assets/webpty-profile-studio.png)

![webpty language studio](./docs/assets/webpty-language-studio.png)

![webpty settings json](./docs/assets/webpty-settings-json.png)

![webpty collapsed rail](./docs/assets/webpty-collapsed-rail.png)

![webpty mobile settings](./docs/assets/webpty-mobile-settings.png)

## Current Status

Shipped:

- Rust PTY runtime, embedded production UI, and one-command startup with `webpty up`
- thin right rail, dedicated settings tab, black terminal-first layout, and split panes inside the active tab
- Theme Studio, Profile Studio, Language, JSON, and Shortcut surfaces in the shipped UI
- profile-aware prompt shaping on non-Windows hosts, including Bash, Zsh, Fish, PowerShell, and WSL-shaped launches
- host-aware first-run defaults and host-native settings paths
- settings compatibility for profiles, themes, schemes, actions, JSONC comments, trailing commas, and unknown-key round-trips
- color pickers plus direct editing for chrome and shell colors
- live profile controls for prompt template, font face, font size, font weight, cell height, line height, padding, and shell colors
- transient draft launches from Profile Studio, so unsaved profile edits can be opened directly for preview
- `webpty up --funnel` with Tailscale bootstrap and auth-key handoff on supported hosts

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
- Python 3.10+ only when running docs screenshot capture or `ui:smoke`

Docs screenshot tooling dependencies:

```bash
python -m pip install -r requirements-docs.txt
python -m playwright install chromium
```

### Global Install

```bash
cargo install --git https://github.com/smturtle2/webpty --bin webpty --locked
```

That is the supported one-command global install path.

If `webpty` is not found after install, add Cargo's bin directory to `PATH`
(`$HOME/.cargo/bin` on Linux/macOS).

Local checkout install:

```bash
cargo install --path apps/server --bin webpty --locked
```

The repository root is a virtual Cargo workspace, so local `--path` installs
target `apps/server`.

### Run

```bash
webpty up
```

The local shell opens at `http://127.0.0.1:3001` by default.

Run with the repository sample settings:

```bash
webpty up --settings ./config/webpty.settings.json
```

`./config/webpty.settings.json` is a fixed demo catalog for screenshots and
manual QA. Installed first-run defaults still come from the runtime host.

### External Access

```bash
webpty up --funnel
```

`--funnel` uses the local `tailscale` CLI to publish the embedded web UI. If the
local CLI is missing on a supported host, `webpty` first attempts to install it,
then runs `tailscale up` automatically before allocating Funnel. For headless bootstrap flows, `webpty` also honors
`WEBPTY_TAILSCALE_AUTH_KEY`, `TS_AUTHKEY`, and `TS_AUTH_KEY`.
If interactive login is still required, `webpty` prints the Tailscale auth URL
or bootstrap error and keeps the local shell running. Treat Funnel as public exposure of the shell surface and only
use it behind a trusted machine and network policy.
Keep `--host` on loopback or all interfaces when using `--funnel`; `::1` is also accepted.

## Settings Path

Resolution order:

1. `webpty up --settings <path>`
2. `WEBPTY_SETTINGS_PATH=<path>`
3. user-scoped platform path
4. local `./settings.json` only when no user-scoped path can be resolved

The repository sample settings file stays opt-in through:

```bash
webpty up --settings ./config/webpty.settings.json
```

User-scoped platform path:

- Linux: `~/.config/webpty/settings.json`
- macOS: `~/Library/Application Support/webpty/settings.json`
- Windows: `%APPDATA%\\webpty\\settings.json`

If the file does not exist, `webpty` creates a default one.
If an existing file is invalid, startup fails without overwriting it.
The generated default profile catalog follows the runtime host:

- Windows: PowerShell-first with additional WSL-oriented profiles
- Linux/macOS: local shell-first profiles derived from the host environment

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
npm run ui:smoke
npm run docs:shots
```

## Ship Changes

```bash
git status --short
npm run build:web
cargo test --manifest-path apps/server/Cargo.toml
git add -A
git commit -m "Refine shell runtime and settings studio"
git push origin main
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
- [Development plan](./docs/development-plan.md)
- [Compatibility notes](./docs/compatibility.md)
- [Localization notes](./docs/localization.md)
- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)
