import type { UiLanguage } from '../types'
import { englishLocale } from './locales/en'
import { koreanLocale } from './locales/ko'
import type { AppCopy, DisplayLanguage, UiLocaleDefinition } from './localization.types'

export type {
  AppCopy,
  DisplayLanguage,
  SectionCopy,
  UiLocaleDefinition,
} from './localization.types'

const FALLBACK_DISPLAY_LANGUAGE = 'en'

function normalizedLocaleToken(language: string): string {
  return language.trim().toLowerCase()
}

function matchLocaleEntry(language: string): UiLocaleDefinition | null {
  const normalized = normalizedLocaleToken(language)
  if (normalized.length === 0) {
    return null
  }

  for (const locale of UI_LOCALE_REGISTRY) {
    const tokens = [locale.id, ...(locale.aliases ?? [])].map(normalizedLocaleToken)
    if (tokens.includes(normalized)) {
      return locale
    }
  }

  for (const locale of UI_LOCALE_REGISTRY) {
    const tokens = [locale.id, ...(locale.aliases ?? [])].map(normalizedLocaleToken)
    if (tokens.some((token) => normalized.startsWith(`${token}-`))) {
      return locale
    }
  }

  return null
}

function fallbackLocale(): UiLocaleDefinition {
  return UI_LOCALE_REGISTRY.find((locale) => locale.id === FALLBACK_DISPLAY_LANGUAGE) ?? UI_LOCALE_REGISTRY[0]
}

function systemDisplayLanguage(): DisplayLanguage {
  if (typeof navigator === 'undefined') {
    return FALLBACK_DISPLAY_LANGUAGE
  }

  return (matchLocaleEntry(navigator.language) ?? fallbackLocale()).id
}

export function resolveDisplayLanguage(language: UiLanguage | undefined): DisplayLanguage {
  if (language && language !== 'system') {
    const locale = matchLocaleEntry(language)
    if (locale) {
      return locale.id
    }

    return FALLBACK_DISPLAY_LANGUAGE
  }

  return systemDisplayLanguage()
}

export function languageModeLabel(language: UiLanguage | undefined, copy: AppCopy) {
  if (!language || language === 'system') {
    return copy.languageSystem
  }

  return (matchLocaleEntry(language) ?? fallbackLocale()).label(copy)
}

export function getRegisteredUiLocales(): readonly UiLocaleDefinition[] {
  return UI_LOCALE_REGISTRY
}

export function isRegisteredUiLanguage(language: UiLanguage | undefined): boolean {
  return typeof language === 'string' && matchLocaleEntry(language) !== null
}

const UI_LOCALE_REGISTRY = [englishLocale, koreanLocale] as const satisfies readonly UiLocaleDefinition[]

export function getAppCopy(language: DisplayLanguage): AppCopy {
  return (matchLocaleEntry(language) ?? fallbackLocale()).copy
}
