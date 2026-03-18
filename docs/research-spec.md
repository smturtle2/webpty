# webpty Research Spec

## Product Direction

`webpty` is a browser-hosted terminal shell with a Rust PTY runtime.

The Windows Terminal reference points are:

- terminal-first information density
- narrow chrome with clear session state
- right-side session navigation instead of heavy dashboard framing
- a settings model that stays compatible with useful WT fields

## v1 Surface Model

Included:

- one dominant terminal viewport
- narrow right-side session rail
- minimal rail actions
- a right-anchored WT-compatible settings panel
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
3. The shell should feel closer to Windows Terminal than to a web dashboard, with no persistent top toolbar.
4. Settings should stay editable in JSON and approachable in the UI.
5. Feature growth should follow WT compatibility, not random browser-shell sprawl.

## Interaction Notes

- `Ctrl+Tab` cycles sessions
- `Ctrl+Shift+Tab` cycles backwards
- `Ctrl+T` creates a tab
- `Ctrl+W` closes the active tab when more than one exists
- `Ctrl+,` opens the settings panel

These bindings are sourced from the WT-compatible `actions[]` subset when present.

## Accessibility Baseline

- Session rail items are keyboard reachable
- Status uses text labels, not color alone
- Reduced motion remains respected
- The terminal surface stays dominant on desktop and compresses cleanly on smaller widths
