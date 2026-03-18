# webpty Localization Notes

## Goal

`webpty.language` is designed to stay small in the settings file while keeping
UI-language growth localized to the frontend.

## Current Contract

- the saved setting is `webpty.language`
- the value can be `system` or a registered locale code
- the frontend resolves locale codes through a registry in `apps/web/src/lib/localization.ts`
- alias matching is supported so a browser locale such as `ko-KR` can map onto a registered `ko` locale
- unknown saved locale codes are preserved in settings and fall back to the default shipped locale in the UI

## Add A Locale

1. Add a new `AppCopy` payload in `apps/web/src/lib/localization.ts`.
2. Register it in `UI_LOCALE_REGISTRY` with `id`, optional `aliases`, `label`, `nativeLabel`, and `copy`.
3. Verify the Language section renders the new option automatically.
4. Build the frontend and refresh screenshots if the visible copy changed.

## Fallback Rules

- `system` follows the browser locale through the registry
- exact locale-code matches win first
- alias and prefix matches such as `en-US` -> `en` are used next
- if nothing matches, the UI falls back to the default shipped locale
