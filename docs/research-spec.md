# webpty Research Spec

## Product Direction

`webpty` is a browser-first terminal workspace that reinterprets the strongest UI/UX patterns from Windows Terminal for the web.

The product goal is not pixel parity. The goal is to preserve:

- tab and pane oriented workflows
- keyboard-first command discovery
- settings as an explorable studio, not raw JSON only
- high state visibility for active sessions, alerts, and profile identity

## Source Baseline

This prototype is grounded in the following upstream materials:

- Windows Terminal repository: <https://github.com/microsoft/terminal>
- Command Palette spec: <https://github.com/microsoft/terminal/blob/main/doc/specs/%232046%20-%20Command%20Palette.md>
- Advanced Tab Switcher spec: <https://github.com/microsoft/terminal/tree/main/doc/specs/%231502%20-%20Advanced%20Tab%20Switcher>
- Search spec: <https://github.com/microsoft/terminal/tree/main/doc/specs/%23605%20-%20Search>
- Accessibility paper: <https://github.com/microsoft/terminal/blob/main/doc/terminal-a11y-2023.md>
- Windows Terminal docs: <https://learn.microsoft.com/en-us/windows/terminal/>

## UX Principles

1. Fast surfaces first.
   The primary experience is opening, switching, splitting, and locating sessions quickly.
2. State must be visible without opening secondary UI.
   Tabs and panes should communicate profile, activity, alerts, and focus.
3. Keyboard and pointer should be equally valid.
   Every overlay must work by keyboard alone, while still being understandable with the mouse.
4. Settings should feel navigable.
   Users should be able to browse categories, search settings, and preview effects without dropping into JSON.
5. Web constraints are accepted explicitly.
   Browser limitations replace native window behaviors; they are not hidden.

## Surface Inventory

### 1. App Shell

- Custom title area with workspace identity, runtime status, and utility actions
- Dense tab row with active, background, and alert states
- Split-button affordance for creating tabs, panes, or windows later

### 2. Pane Workspace

- Horizontal and vertical split layouts
- Active pane emphasis through focus ring and chrome contrast
- Per-pane session metadata: profile, cwd, status, dimensions

### 3. Command Palette and Tab Switcher

- One shared overlay shell
- Search input, action list, nested commands, and tab mode reuse the same visual grammar
- MRU switching is a first-class behavior

### 4. Search Overlay

- Lightweight, top-right anchored search box
- Search direction and case options stay visible
- Search should not freeze the underlying terminal interaction model

### 5. Settings Studio

- Navigation rail with searchable categories
- Clear split between globals and profile-scoped appearance
- Color scheme previews and stateful toggles matter more than raw form density

## v0 Prototype Scope

Included:

- app shell
- tab row
- split panes
- mock terminal content
- command palette
- tab switcher
- search overlay
- settings studio
- data contracts for a Rust session backend

Deferred:

- real multi-window support
- native quake mode
- full Windows Terminal settings compatibility
- broadcast input
- production PTY lifecycle management

## Interaction Notes

### Tab Row

- Tabs expose profile label, status accent, and quick state chips
- Reordering is represented visually in the model, even if drag/drop remains a later step
- New-tab affordance should imply multiple outcomes, not just one

### Pane Focus

- Only one pane is active at a time
- Focus is visible both in border treatment and pane metadata
- Search always targets the active pane

### Command Palette

- `Ctrl+Shift+P` opens action mode
- `Ctrl+Tab` opens MRU tab switcher mode
- Palette items carry subtitles and shortcut hints
- Nested entries must look related but distinct

### Search

- `Ctrl+Shift+F` opens search
- Search keeps the workspace visible and should feel attached to the active pane
- Closing search should return attention to the previously active pane

### Settings

- Search should route directly to a category or leaf setting
- Appearance previews should reveal color and typographic consequences immediately
- JSON remains an eventual escape hatch, not the main path

## Accessibility Baseline

- Every overlay traps focus intentionally and exits with `Esc`
- Tab order must cycle logically inside overlays
- Reduced motion should disable decorative transitions while preserving structural ones
- Color choices must keep contrast in the terminal chrome, not just the surrounding UI
- State indicators should never rely on color alone

## Runtime Model

Core state is represented by these concepts:

- `TabSummary`
- `PaneSummary`
- `LayoutNode`
- `OverlayState`
- `ProfileDefinition`
- `ActionDescriptor`
- `SessionSummary`

These names are mirrored in the server contract document to keep the frontend and backend aligned.
