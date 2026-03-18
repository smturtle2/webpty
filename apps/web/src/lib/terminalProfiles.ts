import type {
  ResolvedProfile,
  SessionItem,
  TerminalColorScheme,
  TerminalProfile,
  TerminalSettings,
  TerminalTheme,
  ThemeSelection,
  UiThemeTokens,
} from '../types'

const DEFAULT_SCHEME: TerminalColorScheme = {
  name: 'Campbell',
  background: '#0c0c0c',
  foreground: '#f2f2f2',
  cursorColor: '#ffffff',
  selectionBackground: '#264f78',
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  purple: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightPurple: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2',
}

export function profileIdentifier(profile: TerminalProfile): string {
  return profile.guid ?? profile.id ?? slugify(profile.name)
}

export function resolveProfile(
  settings: TerminalSettings,
  profileId?: string,
): ResolvedProfile {
  const requestedId = profileId ?? settings.defaultProfile
  const defaults = settings.profiles.defaults ?? {}
  const match =
    settings.profiles.list.find((profile) => profileIdentifier(profile) === requestedId) ??
    settings.profiles.list.find((profile) => profile.guid === settings.defaultProfile) ??
    settings.profiles.list[0]
  const mergedFont =
    defaults.font || match.font
      ? {
          ...(defaults.font ?? {}),
          ...(match.font ?? {}),
        }
      : undefined

  return {
    ...defaults,
    ...match,
    font: mergedFont,
    id: profileIdentifier(match),
  }
}

export function resolveThemeName(
  selection: ThemeSelection | undefined,
  appearance: 'dark' | 'light',
): string | null {
  if (!selection) {
    return null
  }

  if (typeof selection === 'string') {
    return selection
  }

  return selection[appearance] ?? selection.system ?? selection.dark ?? selection.light ?? null
}

export function resolveTheme(
  settings: TerminalSettings,
  appearance: 'dark' | 'light',
): TerminalTheme | null {
  const selected = resolveThemeName(settings.theme, appearance)

  if (!selected) {
    return null
  }

  return settings.themes?.find((theme) => theme.name === selected) ?? null
}

export function resolveWindowAppearance(
  settings: TerminalSettings,
  systemAppearance: 'dark' | 'light',
): 'dark' | 'light' {
  const theme = resolveTheme(settings, systemAppearance)
  const requested = theme?.window?.applicationTheme

  if (requested === 'dark' || requested === 'light') {
    return requested
  }

  return systemAppearance
}

export function resolveScheme(
  settings: TerminalSettings,
  profile: ResolvedProfile,
  appearance: 'dark' | 'light',
): TerminalColorScheme {
  const selection = profile.colorScheme
  const selectedName =
    typeof selection === 'string'
      ? selection
      : selection?.[appearance] ?? selection?.dark ?? selection?.light ?? DEFAULT_SCHEME.name

  const resolved =
    settings.schemes?.find((scheme) => scheme.name === selectedName) ?? DEFAULT_SCHEME

  return {
    ...resolved,
    background: profile.background ?? resolved.background,
    foreground: profile.foreground ?? resolved.foreground,
    cursorColor: profile.cursorColor ?? resolved.cursorColor,
    selectionBackground: profile.selectionBackground ?? resolved.selectionBackground,
  }
}

export function resolveUiTheme(
  settings: TerminalSettings,
  profile: ResolvedProfile,
  appearance: 'dark' | 'light',
): UiThemeTokens {
  const selectedTheme = resolveTheme(settings, appearance)
  const scheme = resolveScheme(settings, profile, appearance)
  const accent = profile.tabColor ?? scheme.brightBlue ?? scheme.blue ?? '#4cc2ff'
  const tabActive = selectedTheme?.tab?.background ?? '#ffffff'
  const tabInactive =
    selectedTheme?.tab?.unfocusedBackground ??
    selectedTheme?.tabRow?.unfocusedBackground ??
    '#f3f3f3'
  const tabStrip = selectedTheme?.tabRow?.background ?? '#efefef'
  const chrome = tabStrip
  const panel = mix(tabActive, '#f6f6f6', 0.58)
  const window = mix(scheme.background, '#000000', 0.94)
  const surface = mix(scheme.background, '#000000', 0.88)

  return {
    appBackground: '#000000',
    backgroundGlow: 'transparent',
    window,
    chrome,
    chromeAlt: '#ffffff',
    surface,
    panel,
    terminalBackground: scheme.background,
    terminalForeground: scheme.foreground,
    tabActive,
    tabInactive,
    tabStrip,
    border: 'rgba(17, 17, 17, 0.11)',
    borderStrong: 'rgba(17, 17, 17, 0.2)',
    text: '#111111',
    textSoft: '#5f5f5f',
    textMuted: '#7a7a7a',
    accent,
    accentSoft: alpha(accent, 0.14),
    signal: scheme.yellow ?? accent,
    success: scheme.green ?? '#6fd19d',
    shadow: '0 24px 64px rgba(0, 0, 0, 0.24)',
  }
}

export function resolveProfileFontFace(profile: ResolvedProfile | TerminalProfile): string {
  return profile.font?.face ?? profile.fontFace ?? 'Cascadia Mono'
}

export function resolveProfileFontSize(profile: ResolvedProfile | TerminalProfile): number {
  return profile.font?.size ?? profile.fontSize ?? 13
}

export function resolveProfileLineHeight(profile: ResolvedProfile | TerminalProfile): number {
  return profile.font?.cellHeight ?? profile.lineHeight ?? 1.22
}

export function buildPreviewLines(transcript: string): string[] {
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-4)
}

export function formatSettingsJson(settings: unknown): string {
  return `${JSON.stringify(settings, null, 2)}\n`
}

export function actionLabel(actionKeys: string[] | undefined): string {
  if (!actionKeys || actionKeys.length === 0) {
    return ''
  }

  return actionKeys[0]
}

export function sessionLabel(session: SessionItem, activeSessionId: string): string {
  if (session.id === activeSessionId) {
    return 'Now'
  }

  return session.hasActivity ? 'Updated' : session.lastUsedLabel
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function mix(first: string, second: string, ratio: number): string {
  const one = parseHex(first)
  const two = parseHex(second)

  if (!one || !two) {
    return first
  }

  const blend = {
    r: Math.round(one.r * ratio + two.r * (1 - ratio)),
    g: Math.round(one.g * ratio + two.g * (1 - ratio)),
    b: Math.round(one.b * ratio + two.b * (1 - ratio)),
  }

  return toHex(blend.r, blend.g, blend.b)
}

function alpha(value: string, opacity: number): string {
  const parsed = parseHex(value)

  if (!parsed) {
    return value
  }

  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${opacity})`
}

function parseHex(value: string): { r: number; g: number; b: number } | null {
  const normalized = value.trim()

  if (!normalized.startsWith('#')) {
    return null
  }

  const hex = normalized.slice(1)

  if (hex.length === 3) {
    return {
      r: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      g: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      b: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    }
  }

  if (hex.length !== 6) {
    return null
  }

  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}
