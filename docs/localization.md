# webpty Localization Notes

## Goal

`webpty.language` is designed to stay small in the settings file while keeping
UI-language growth localized to the frontend.

## Current Contract

- the saved setting is `webpty.language`
- the value can be `system` or a registered locale code
- the frontend resolves locale codes through a small registry in `apps/web/src/lib/localization.ts`
- locale payloads live in dedicated modules under `apps/web/src/lib/locales/`
- alias matching is supported so a browser locale such as `ko-KR` can map onto a registered `ko` locale
- unknown saved locale codes are preserved in settings and fall back to the default shipped locale in the UI

## Add A Locale

1. Add a new locale module in `apps/web/src/lib/locales/` that exports a `UiLocaleDefinition`.
2. Keep the locale copy shape aligned with `apps/web/src/lib/localization.types.ts`.
3. Register the new module in `UI_LOCALE_REGISTRY` inside `apps/web/src/lib/localization.ts`.
4. Verify the Language section renders the new option automatically.
5. Build the frontend and refresh screenshots if the visible copy changed.

## Fallback Rules

- `system` follows the browser locale through the registry
- exact locale-code matches win first
- alias and prefix matches such as `en-US` -> `en` are used next
- if nothing matches, the UI falls back to the default shipped locale
