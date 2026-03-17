# webpty Research Spec

## Product Direction

`webpty` is currently scoped as a simple terminal app, not a full workspace.

The reference point from Windows Terminal is:

- restrained chrome
- clear session state
- minimal visual noise
- a real terminal-app feel in a desktop-sized shell

## v1 Surface Model

Included:

- top chrome
- tab strip
- one active terminal viewport
- profile launcher
- settings studio with WT-compatible `settings.json`
- session switching by click and keyboard

Excluded for now:

- split panes
- command palette
- search overlay
- multi-window UI

## UX Principles

1. Keep the terminal dominant.
2. Keep the chrome thin.
3. Make session switching obvious.
4. Avoid decorative panels and marketing-style layout.
5. Add larger features back only when they match Windows Terminal more closely.

## Interaction Notes

- `Ctrl+Tab` cycles sessions
- `Ctrl+Shift+Tab` cycles backwards
- `Ctrl+T` creates a session placeholder
- `Ctrl+W` closes the active session when more than one exists
- `Ctrl+,` opens the settings studio

## Accessibility Baseline

- Session tabs and profile launchers are fully clickable and keyboard reachable
- Status should not rely on color alone
- Reduced motion should remain respected
- The terminal surface stays visually dominant at all widths
