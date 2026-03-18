# webpty Research Spec

## Product Direction

`webpty` is a browser-hosted terminal shell with a Rust PTY runtime.

Reference points:

- terminal-first information density
- narrow chrome with clear session state
- a right-side rail instead of a heavy dashboard frame
- shared profile/theme settings that can travel through `settings.json`

## v1 Surface Model

Included:

- one dominant terminal viewport
- narrow right-side session rail
- rail show/hide toggle
- split creation from the rail
- a right-anchored settings drawer
- keyboard session switching and creation
- live PTY transport behind the UI
- one-command Rust startup via `webpty up`

Excluded for now:

- advanced pane graphs and persisted pane layouts
- command palette
- search overlay
- multi-window UI
- drag/drop tab ordering

## UX Principles

1. The terminal should own the screen.
2. Session switching should stay visible but narrow.
3. The shell should feel like a native desktop terminal, with no persistent top toolbar.
4. Settings should stay editable in JSON and approachable in the UI.
5. Feature growth should follow shared schema compatibility, not dashboard sprawl.

## Interaction Notes

- `Ctrl+Tab` cycles sessions
- `Ctrl+Shift+Tab` cycles backwards
- `Ctrl+T` creates a tab
- `Ctrl+W` closes the active tab when more than one exists
- `Ctrl+,` opens the settings drawer

These bindings are sourced from the configured `actions[]` subset when present.

## Accessibility Baseline

- rail items are keyboard reachable
- status uses text labels, not color alone
- reduced motion remains respected
- the terminal surface stays dominant on desktop and compresses cleanly on smaller widths
