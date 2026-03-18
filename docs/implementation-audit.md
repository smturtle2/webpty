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

- rebuilt the embedded frontend bundle so the Rust runtime serves the current shell UI instead of stale assets
- revalidated the runtime contracts that matter for this spec: `webpty up`, `webpty up --funnel`, shared settings loading, and per-profile prompt shaping
- aligned the Studio prompt previews and local demo fallback transcripts with the runtime profile prompt rules
- added explicit `webpty.prompt` template support with shared prompt tokens for profile-level prompt shaping
- verified the color token shortcut chips now write usable shared token values into theme/profile fields
- refreshed the documentation screenshots from the running app after the latest UI pass
- aligned the docs with the current Theme Studio / Profile Studio naming that ships in the interface

## Confirmed Working

- Rust PTY backend, embedded UI serving, and `webpty up`
- external exposure through `webpty up --funnel`
- shared `settings.json` loading, persistence, JSONC parsing, and unknown-key round-trip
- right-rail settings workspace with separate Theme Studio, Profile Studio, JSON, and shortcut surfaces
- color-picker driven theme/profile editing plus token shortcut chips and direct JSON editing
- per-profile prompt shaping on non-Windows hosts
- runtime-matched prompt previews inside the settings workspace

## Remaining Gaps

- deeper pane graphs and persisted pane layouts
- drag reordering for tabs and panes
- broader action-object coverage
- command palette and search surfaces
- session restoration across restarts
