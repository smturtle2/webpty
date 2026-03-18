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
- `profiles.defaults`
- `profiles.list`
- `schemes`

Theme fields:

- `window.applicationTheme`
- `window.useMica`
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

Action fields currently mapped by the frontend:

- string commands such as `"newTab"`
- object commands with `command.action`, such as `{ "action": "newTab" }`
- mapped actions currently include `newTab`, `closeTab`, `nextTab`, `prevTab`, and `openSettings`

## Runtime Behavior

- `webpty up` serves the embedded shell UI, `/api/*`, and `/ws/*` from one Rust process
- `webpty up` resolves settings in this order: explicit `--settings` / `WEBPTY_SETTINGS_PATH`, then `./config/webpty.settings.json` from the current working directory if present, then the user-scoped platform path (`~/.config/webpty/settings.json` on Linux/macOS, `%APPDATA%\\webpty\\settings.json` on Windows)
- if the settings file does not exist, `webpty` creates a default one
- if an existing settings file is invalid, startup fails without overwriting it
- disk loading accepts JSONC-style comments and trailing commas
- the in-app `settings.json` editor also accepts JSONC-style comments and trailing commas
- the in-app settings workspace opens as its own tab from the rail rather than overlaying the shell
- the in-app Theme Studio can create, duplicate, delete, and update `themes[]` entries and can also update `theme`
- the in-app Profile Studio can create, duplicate, delete, and update `profiles.list[]` entries and can also update `defaultProfile`
- `webpty up --funnel` exposes the same Rust process through Tailscale Funnel when `tailscale up` is already active on the host
- `webpty up --funnel` requires `--host` to stay on loopback or all interfaces so Funnel can proxy the local listener safely
- Tailscale Funnel is allocated from the currently allowed HTTPS ports (commonly `443`, `8443`, `10000`) and existing mappings for the same local target are reused
- `POST /api/sessions` accepts both `profileId` and `profile_id`
- `POST /api/sessions` rejects profiles marked with `hidden: true`
- profile launch uses the configured `commandline` when possible
- sessions start at the real shell prompt with no synthetic startup banner injected into the transcript
- if a configured shell cannot be started, the Rust runtime falls back to a platform shell and keeps a profile-matched prompt shape instead of a generic `bash-5.2$`
- `~` and `%USERPROFILE%`-style paths are expanded when launching a session
- unsupported keys are preserved when the supported subset is loaded and saved again, including edits initiated from the in-app settings UI
- nested `font` objects on profiles and profile defaults round-trip through the Rust runtime
- browser-safe profile icon sources such as `data:`, `http(s)://`, and web-relative paths are rendered in the rail and settings surface
- Rust rebuilds now track embedded UI asset changes so the served bundle stays current after frontend builds

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
