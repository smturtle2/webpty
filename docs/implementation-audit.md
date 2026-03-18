# webpty Implementation Audit

## Audit Focus

This pass checked the repo against the current product constraints:

- Rust backend with one-command startup through `webpty up`
- external exposure through `webpty up --funnel`
- black terminal-first layout with a thin right rail and no persistent top toolbar
- shared `settings.json` compatibility for profiles and themes
- dedicated settings tab with profile/theme editing UX
- per-profile prompt shaping instead of a generic `bash-5.2$`

## Findings Addressed In This Pass

- fixed frontend lint debt in `apps/web/src/App.tsx`
- extended the shared theme model and UI to cover `window.frame` and `window.unfocusedFrame`
- added token shortcut chips for theme color fields so shared color tokens are easier to enter without dropping down to raw JSON
- refreshed the shipped sample settings and demo data so frame colors are visible immediately in the UI
- regenerated the documentation screenshots from the running app after the UI refresh

## Confirmed Working

- Rust PTY backend, embedded UI serving, and `webpty up`
- external exposure through `webpty up --funnel`
- shared `settings.json` loading, persistence, JSONC parsing, and unknown-key round-trip
- right-rail settings workspace with separate Theme Studio, Profile Studio, JSON, and shortcut surfaces
- color-picker driven theme/profile editing plus direct JSON editing
- per-profile prompt shaping on non-Windows hosts

## Remaining Gaps

- deeper pane graphs and persisted pane layouts
- drag reordering for tabs and panes
- broader action-object coverage
- command palette and search surfaces
- session restoration across restarts
