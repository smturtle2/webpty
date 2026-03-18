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

1. the docs smoke path was broken because `npm run ui:smoke` passed `--check-only` to a script that did not support it
2. docs screenshot prerequisites were not documented, so a fresh contributor could not reproduce `docs/assets` reliably
3. the settings workspace styling still felt like a custom card UI instead of a tighter desktop shell settings surface
4. settings compatibility remains a supported subset rather than full semantic parity
5. prompt-template persistence still relies on a `webpty` extension field, which is a deliberate compatibility exception
6. default themes, actions, and schemes are still mostly shared across hosts even though the profile catalog is host-aware

## Execution Order

### Completed in this pass

- repair the docs smoke workflow so screenshot capture can be verified without mutating tracked assets
- document the Python and Playwright requirements for docs screenshot generation
- refine the shell chrome styling so the right rail and settings workspace move closer to the desktop shell target
- refresh README guidance and screenshots after validation

### Remaining follow-up work

- expand supported action objects beyond the current tab/settings-focused command set
- reduce the remaining dependency on `webpty` extension fields where compatibility is a hard requirement
- decide whether host-specific defaults should include theme/action/scheme catalogs instead of only profile catalogs
- continue pane-graph, tab-order, and session-restoration work already called out in the audit

## Validation Gate

The repository should stay green on:

- `npm run build:web`
- `cargo test --manifest-path apps/server/Cargo.toml`
- `cargo check`
- `npm run ui:smoke`
- `npm run docs:shots`
