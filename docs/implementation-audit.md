# webpty Implementation Audit

## Completed In This Pass

- tightened the right rail so the shell stays dominant and the tab surfaces stay thin
- refined the settings workspace to a flatter Windows 11-style chrome profile
- added direct color-pickers for appearance and profile editing
- added a live profile preview for prompt, tab accent, and shell colors
- reset the shipped sample settings to a fully opaque black shell by default
- regenerated the documentation screenshots from the running app

## Confirmed Working

- Rust PTY backend, embedded UI serving, and `webpty up`
- external exposure through `webpty up --funnel`
- shared `settings.json` loading, persistence, JSONC parsing, and unknown-key round-trip
- per-profile prompt shaping on non-Windows hosts
- right-rail settings workspace, profile editing, and appearance editing

## Remaining Gaps

- deeper pane graphs and persisted pane layouts
- drag reordering for tabs and panes
- broader action-object coverage
- command palette and search surfaces
- session restoration across restarts
