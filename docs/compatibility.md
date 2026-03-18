# webpty Compatibility Notes

## Goal

`webpty` aims for practical interoperability with the shared desktop-terminal
`settings.json` shape, not full schema parity.

## Supported Fields

Top level:

- `$schema`
- `defaultProfile`
- `copyFormatting`
- `theme`
- `themes`
- `actions`
- optional `webpty.language`
- `profiles.defaults`
- `profiles.list`
- `schemes`

Theme fields:

- `window.applicationTheme`
- `window.useMica`
- `window.frame`
- `window.unfocusedFrame`
- `tab.background`
- `tab.unfocusedBackground`
- `tab.showCloseButton` including `activeOnly`
- `tabRow.background`
- `tabRow.unfocusedBackground`

Profile fields used by the UI/runtime:

- `guid`
- `font`
- `name`
- `icon`
- `commandline`
- `startingDirectory`
- `source`
- `hidden`
- `tabColor`
- `tabTitle`
- `colorScheme`
- `fontFace`
- `fontSize`
- `fontWeight`
- `cellHeight`
- `lineHeight`
- `cursorShape`
- `opacity`
- `useAcrylic`
- `foreground`
- `background`
- `cursorColor`
- `selectionBackground`
- `padding`
- optional `webpty.prompt` extension for explicit prompt templates

Action fields currently mapped by the frontend:

- string commands such as `"newTab"`
- object commands with `command.action`, such as `{ "command": { "action": "newTab" } }`
- mapped actions currently include `newTab`, `closeTab`, `nextTab`, `prevTab`, and `openSettings`

## Localization

- `webpty.language` accepts `system` or a registered locale code
- the frontend resolves saved locale codes through a locale registry with alias matching
- unknown locale codes are preserved in settings and fall back to the default shipped locale in the UI
- adding another locale is a frontend-only change centered on the locale registry in `apps/web/src/lib/localization.ts`
- [Localization notes](./localization.md) documents the expected extension path

## Runtime Behavior

- `webpty up` serves the embedded shell UI, `/api/*`, and `/ws/*` from one Rust process
- `webpty up` resolves settings in this order: explicit `--settings` / `WEBPTY_SETTINGS_PATH`, then the user-scoped platform path (`~/.config/webpty/settings.json` on Linux, `~/Library/Application Support/webpty/settings.json` on macOS, `%APPDATA%\\webpty\\settings.json` on Windows)
- the repo sample at `./config/webpty.settings.json` is intentionally opt-in through `webpty up --settings ./config/webpty.settings.json`
- the repo sample is a fixed demo catalog for screenshots and manual QA; it is not the same thing as the host-generated first-run defaults
- if the settings file does not exist, `webpty` creates a default one
- generated defaults and the repo sample do not hardcode a `$schema` value; if a settings file already includes `$schema`, it is preserved on load/save
- generated first-run settings now follow the runtime host: Windows seeds PowerShell/WSL-oriented profiles, while Linux/macOS seed local shell-first profiles
- if an existing settings file is invalid, startup fails without overwriting it
- disk loading accepts JSONC-style comments and trailing commas
- the in-app `settings.json` editor also accepts JSONC-style comments and trailing commas
- the in-app settings workspace stays reachable from its own pinned rail tab rather than overlaying the shell
- the in-app Theme Studio can create, duplicate, delete, and update `themes[]` entries and can also update `theme`
- the in-app Profile Studio can create, duplicate, delete, and update `profiles.list[]` entries and can also update `defaultProfile`
- the in-app Language section persists `webpty.language` as `system` or a registered locale code
- Theme Studio and Profile Studio draft syncing avoids self-triggered render loops while switching entries or reloading runtime settings
- `GET /api/health` now includes `hostPlatform` so the UI can keep Profile Studio command and directory hints aligned with the runtime OS
- the in-app Theme and Profile studios expose direct text editing plus color-picker controls for chrome and shell colors
- theme and profile color inputs keep full token and hex values visible instead of clipping them down to a prefix stub
- theme and profile color fields also offer shortcut chips for shared token values such as `accent`, `terminalBackground`, `terminalForeground`, `cursorColor`, and `selectionBackground`
- helper copy inside Theme Studio and Profile Studio keeps sentence casing instead of inheriting the uppercase field-label treatment
- Profile Studio can edit `webpty.prompt` with `{cwd}`, `{user}`, `{host}`, `{profile}`, and `{symbol}` tokens
- Profile Studio and Theme Studio previews reuse the same profile-family prompt heuristics as the runtime shell launch path
- prompt previews now sanitize `{profile}` the same way the runtime shell launch path does
- prompt previews preserve literal template spacing instead of trimming trailing spaces away
- `webpty up --funnel` exposes the same Rust process through Tailscale Funnel and first attempts automatic CLI install on supported hosts when `tailscale` is missing, then runs `tailscale up` when the local client is offline
- `webpty up --funnel` honors `WEBPTY_TAILSCALE_AUTH_KEY`, `TS_AUTHKEY`, and `TS_AUTH_KEY` for headless bootstrap flows and otherwise surfaces the interactive login URL when needed
- `webpty up --funnel` requires `--host` to stay on loopback or all interfaces so Funnel can proxy the local listener safely, and `::1` is accepted as an explicit IPv6 loopback bind
- Tailscale Funnel is allocated from the currently allowed HTTPS ports (commonly `443`, `8443`, `10000`) and existing mappings for the same local target are reused
- `POST /api/sessions` accepts both `profileId` and `profile_id`
- `POST /api/sessions` rejects profiles marked with `hidden: true`
- `defaultProfile` is normalized to a visible launchable profile during load and in-app editing
- settings payloads must keep at least one visible profile available for launch
- profile launch uses the configured `commandline` when possible
- sessions start at the real shell prompt with no synthetic startup banner injected into the transcript
- on non-Windows hosts, plain shell profile commandlines such as `bash`, `sh`, `zsh`, and `fish` are normalized onto prompt-aware interactive launches when possible
- plain `fish` launches now install a fish-native prompt override so the selected profile prompt survives startup
- host-generated Bash/Zsh/Fish defaults now use profile-named prompt templates so those seeded shells stay visually distinct
- default zsh host-shell launches also use a clean interactive path so host startup files do not immediately override the profile-shaped prompt
- if a configured shell cannot be started, the Rust runtime falls back to a platform shell and keeps a profile-matched prompt shape instead of a generic `bash-5.2$`
- session preview lines strip terminal control sequences before they reach the API or the demo fallback
- `~` and `%USERPROFILE%`-style paths are expanded when launching a session, and the resolved path must be a directory
- `window.useMica` affects the shell chrome/backdrop treatment in the shipped UI
- explicit `lineHeight` now wins over nested `font.cellHeight` when both are present
- `padding` affects the live terminal viewport instead of only round-tripping through settings persistence
- unsupported keys are preserved when the supported subset is loaded and saved again, including edits initiated from the in-app settings UI
- nested `font` objects on profiles and profile defaults round-trip through the Rust runtime
- browser-safe profile icon sources such as `data:`, `http(s)://`, and web-relative paths are rendered in the rail and settings surface
- Rust rebuilds now track embedded UI asset changes so the served bundle stays current after frontend builds
- the shipped UI keeps the terminal dominant, the right rail thin and hideable, and the settings workspace as a full tab rather than a floating overlay
- the right rail now uses icon-first tabs with safe collapsed bounds, a pinned settings tab, and no persistent action stack
- the terminal viewport now reruns fit passes after mount and font load so narrow/mobile shells settle onto the visible width instead of keeping the initial off-canvas geometry
- Theme Studio previews the same right-rail shell geometry the app ships, rather than a top tab strip
- split panes keep subtle separators and active borders without floating badge chrome

## Known Gaps

- advanced pane graphs and persisted pane layouts
- full action object support beyond the current tab/settings subset
- command palette and search surfaces
- broader profile defaults coverage
- host-local icon URI parity for every asset format
- session restoration and persisted tab order

## Practical Expectation

You should expect the same profile and theme JSON to travel between tools for the
supported subset without unrelated keys being discarded on save. You should not
expect full schema parity yet.
