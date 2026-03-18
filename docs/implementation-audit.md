# webpty Implementation Audit

## Audit Scope

This audit tracks the product constraints that define the shipped shell:

- Rust backend with one-command startup through `webpty up`
- optional external exposure through `webpty up --funnel`
- black terminal-first layout with a thin right rail and no persistent top toolbar
- shared `settings.json` compatibility for profiles, themes, schemes, and actions
- settings opened as a dedicated rail tab, with dedicated Theme, Profile, Language, JSON, and Shortcut surfaces
- host-aware defaults and prompt shaping so the runtime does not collapse onto a generic shell prompt

## Constraint Coverage

Confirmed in the current tree:

- the PTY runtime, settings API, session lifecycle, and embedded UI all ship from the Rust binary
- `webpty up` starts the local shell surface directly
- `webpty up --funnel` integrates with the local Tailscale client, attempts automatic bootstrap on supported hosts, and now keeps the local shell alive if external exposure cannot be completed
- profile and theme payloads round-trip through a compatible shared settings subset, including unknown-key preservation
- the right rail stays thin, icon-first, hideable, and settings open in their own workspace tab
- Theme Studio and Profile Studio expose dedicated editing UX, including color pickers and direct value entry
- Profile Studio can edit prompt templates, font face, font size, font weight, cell height, line height, padding, shell colors, and launch fields
- unsaved Profile Studio drafts can now be launched into preview sessions without first persisting them
- live terminal rendering now respects font weight, top-level `cellHeight`, and profile padding fallback rules
- seeded defaults follow the runtime host instead of assuming one OS-specific profile catalog
- the shell/settings chrome now comes from one authoritative stylesheet instead of stacked legacy overrides
- the right rail now keeps compact tab labels visible while staying thin and hideable
- frontend locales now live in dedicated modules behind a smaller registry layer
- docs smoke validation now stress-tests long text so settings copy does not escape its containers

## Current Risks

- advanced pane graphs, drag reordering, and persisted layouts are still not shipped
- action-object support remains focused on the current tab/settings subset
- the settings workspace still needs continued shell-chrome fidelity work to fully match the desktop target
- compatibility is still a supported subset rather than full schema parity
- automatic Tailscale install on Linux still depends on host privilege availability

## Verification Baseline

The current baseline should continue to satisfy:

- `npm run build:web`
- `cargo test --manifest-path apps/server/Cargo.toml`
- `cargo check`
- `npm run ui:smoke`
- `npm run docs:shots`
