# webpty Development Plan

## Survey Summary

Confirmed in the current tree:

- Rust remains the only backend runtime and `webpty up` is the one-command launch path.
- first-run profile defaults already follow the host OS instead of assuming one shell catalog
- the shell stays dominant, the right rail is hideable, and settings open inside a dedicated workspace tab
- Theme Studio, Profile Studio, Language, JSON, and Shortcut editors are already shipped
- prompt shaping avoids collapsing into a generic `bash-5.2$` prompt on non-Windows hosts
- Funnel bootstrap exists behind `webpty up --funnel`

Concrete gaps found during the survey:

1. `App.css` had drifted into stacked legacy overrides, which made shell-chrome fidelity brittle
2. the right rail was thin but effectively icon-only because compact tab labels were hidden
3. localization extension still depended on one monolithic locale file instead of per-locale modules
4. `webpty up --funnel` could abort the whole app when Funnel bootstrap failed
5. the docs still implied local `cargo install --path .` support even though the repo root is a virtual workspace manifest
6. settings compatibility remains a supported subset rather than full semantic parity

## Execution Order

### Completed in this pass

- replace the shell/settings stylesheet with one authoritative layout tuned for the terminal-first right-rail shell
- restore compact tab labels in the thin right rail and harden overflow handling across settings surfaces
- refactor localization into per-locale modules behind a smaller registry layer
- make `webpty up --funnel` fall back to local-only access when external exposure cannot be completed
- correct install and runtime docs so the supported paths match the actual workspace and Funnel behavior
- extend docs smoke validation with long-label overflow checks before refreshing screenshots

### Remaining follow-up work

- expand supported action objects beyond the current tab/settings-focused command set
- reduce the remaining dependency on `webpty` extension fields where compatibility is a hard requirement
- decide whether host-specific defaults should include theme/action/scheme catalogs instead of only profile catalogs
- decide whether local checkout install should also be made to work from the repo root instead of only from `apps/server`
- continue pane-graph, tab-order, and session-restoration work already called out in the audit

## Validation Gate

The repository should stay green on:

- `npm run build:web`
- `cargo test --manifest-path apps/server/Cargo.toml`
- `cargo check`
- `npm run ui:smoke`
- `npm run docs:shots`
