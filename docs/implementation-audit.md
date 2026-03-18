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
- fixed Theme Studio and Profile Studio color fields so full token and hex values stay visible instead of clipping down to a `#` stub
- upgraded `webpty up --funnel` so it attempts `tailscale up` automatically, supports auth-key env handoff, and reports interactive login URLs cleanly
- extended Funnel shutdown cleanup beyond Ctrl-C so timeout / SIGTERM-style exits do not leave a public mapping behind
- normalized plain non-Windows shell profiles such as `bash` onto prompt-aware interactive launches instead of only fixing fallback shells
- normalized default zsh host-shell launches onto a clean interactive path so runtime prompt shaping survives macOS-style shell defaults
- moved the repo sample settings file to an explicit `--settings` path so installed runs default to the user-scoped settings file
- switched generated first-run settings from a Windows-only profile catalog to host-scoped defaults so Linux/macOS seed local shells immediately
- corrected the macOS user-scoped settings path to `~/Library/Application Support/webpty/settings.json`
- flattened the right rail and split-pane treatment toward the thinner shell-first layout used by the product spec
- tightened the right rail, settings panels, and preview surfaces further so the chrome stays flatter and text is less likely to escape its container
- removed a Theme/Profile Studio draft-sync render loop that could trigger repeated `Maximum update depth exceeded` errors in the browser console
- aligned Profile Studio prompt previews with the runtime `{profile}` sanitization path
- stabilized xterm fitting with repeated post-mount passes so narrow and mobile widths no longer keep the initial off-canvas geometry
- surfaced runtime host metadata to the UI so Profile Studio placeholders reflect the actual execution OS
- surfaced split-pane identity chrome with visible pane badges and stronger active-pane framing
- refreshed the documentation screenshots from the running app after the latest UI pass
- aligned the docs with the current Theme Studio / Profile Studio naming that ships in the interface

## Confirmed Working

- Rust PTY backend, embedded UI serving, and `webpty up`
- external exposure through `webpty up --funnel`
- shared `settings.json` loading, persistence, JSONC parsing, and unknown-key round-trip
- right-rail settings workspace with separate Theme Studio, Profile Studio, JSON, and shortcut surfaces
- color-picker driven theme/profile editing plus token shortcut chips and direct JSON editing
- readable full-value color editing in Theme Studio and Profile Studio
- per-profile prompt shaping on non-Windows hosts, including plain shell profile launches
- default zsh host-shell launches that preserve profile-shaped prompts
- cleaned preview summaries with profile-aware launch defaults and cwd validation
- runtime-backed viewport handling for `padding`, explicit `lineHeight`, and `window.useMica`
- runtime-matched prompt previews inside the settings workspace
- repeated xterm fit passes that settle correctly on narrow and mobile widths
- host-scoped default profile generation and host-native settings paths
- runtime host-aware placeholder hints inside Profile Studio
- stable Theme/Profile draft syncing without recursive render-loop churn
- visible split-pane identity chrome inside the terminal workspace
- broader text-overflow protection in the right rail and settings workspace

## Remaining Gaps

- deeper pane graphs and persisted pane layouts
- drag reordering for tabs and panes
- broader action-object coverage
- command palette and search surfaces
- session restoration across restarts
