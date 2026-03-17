# webpty Compatibility Notes

## Goal

`webpty` aims for practical interoperability with Windows Terminal settings,
not full schema parity.

## Supported WT-Compatible Fields

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
- `tab.showCloseButton`
- `tabRow.background`
- `tabRow.unfocusedBackground`

Profile fields used by the UI/runtime:

- `guid`
- `name`
- `icon`
- `commandline`
- `startingDirectory`
- `source`
- `hidden`
- `tabColor`
- `colorScheme`
- `fontFace`
- `fontSize`
- `lineHeight`
- `cursorShape`
- `opacity`

Action fields currently mapped by the frontend:

- `newTab`
- `closeTab`
- `nextTab`
- `prevTab`
- `openSettings`

## Runtime Behavior

- `POST /api/sessions` accepts both `profileId` and `profile_id`
- profile launch uses the WT `commandline` when possible
- if a configured shell cannot be started, the Rust runtime falls back to a platform shell and prints a session banner
- `~` and `%USERPROFILE%`-style paths are expanded when launching a session

## Known Gaps

- split panes and pane graphs
- full WT action object support with nested arguments
- command palette and search surfaces
- broader profile defaults coverage
- session restoration and persisted tab order

## Practical Expectation

You should expect the same theme/profile JSON to travel between Windows
Terminal and `webpty` for the supported subset. You should not expect full
feature parity with Windows Terminal yet.
