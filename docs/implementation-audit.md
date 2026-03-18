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
- sanitized session preview summaries so PTY control sequences no longer leak through `/api/sessions`
- hardened startup-profile normalization so hidden profiles cannot silently become the startup shell
- tightened launch cwd validation so only real directories are accepted after token expansion
- applied `padding`, explicit `lineHeight`, and `window.useMica` to the shipped UI instead of leaving them as no-op compatibility fields
- fixed prompt-preview spacing so shared prompt templates render literally inside Theme Studio and Profile Studio
- fixed profile color-scheme selection so the editor reflects the profile being edited rather than the active shell
- flattened the right rail and split-pane treatment toward the thinner shell-first layout used by the product spec
- refreshed the documentation screenshots from the running app after the latest UI pass
- aligned the docs with the current Theme Studio / Profile Studio naming that ships in the interface

## Confirmed Working

- Rust PTY backend, embedded UI serving, and `webpty up`
- external exposure through `webpty up --funnel`
- shared `settings.json` loading, persistence, JSONC parsing, and unknown-key round-trip
- right-rail settings workspace with separate Theme Studio, Profile Studio, JSON, and shortcut surfaces
- color-picker driven theme/profile editing plus token shortcut chips and direct JSON editing
- per-profile prompt shaping on non-Windows hosts
- cleaned preview summaries with profile-aware launch defaults and cwd validation
- runtime-backed viewport handling for `padding`, explicit `lineHeight`, and `window.useMica`
- runtime-matched prompt previews inside the settings workspace

## Remaining Gaps

- deeper pane graphs and persisted pane layouts
- drag reordering for tabs and panes
- broader action-object coverage
- command palette and search surfaces
- session restoration across restarts
