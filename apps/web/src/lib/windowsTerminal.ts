import type {
  ResolvedProfile,
  SessionItem,
  ThemeSelection,
  UiThemeTokens,
  WindowsTerminalColorScheme,
  WindowsTerminalProfile,
  WindowsTerminalSettings,
  WindowsTerminalTheme,
} from '../types'

const DEFAULT_SCHEME: WindowsTerminalColorScheme = {
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

export function profileIdentifier(profile: WindowsTerminalProfile): string {
  return profile.guid ?? profile.id ?? slugify(profile.name)
}

export function resolveProfile(
  settings: WindowsTerminalSettings,
  profileId?: string,
): ResolvedProfile {
  const requestedId = profileId ?? settings.defaultProfile
  const match =
    settings.profiles.list.find((profile) => profileIdentifier(profile) === requestedId) ??
    settings.profiles.list.find((profile) => profile.guid === settings.defaultProfile) ??
    settings.profiles.list[0]

  return {
    ...settings.profiles.defaults,
    ...match,
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
  settings: WindowsTerminalSettings,
  appearance: 'dark' | 'light',
): WindowsTerminalTheme | null {
  const selected = resolveThemeName(settings.theme, appearance)

  if (!selected) {
    return null
  }

  return settings.themes?.find((theme) => theme.name === selected) ?? null
}

export function resolveScheme(
  settings: WindowsTerminalSettings,
  profile: ResolvedProfile,
  appearance: 'dark' | 'light',
): WindowsTerminalColorScheme {
  const selection = profile.colorScheme
  const selectedName =
    typeof selection === 'string'
      ? selection
      : selection?.[appearance] ?? selection?.dark ?? selection?.light ?? DEFAULT_SCHEME.name

  return settings.schemes?.find((scheme) => scheme.name === selectedName) ?? DEFAULT_SCHEME
}

export function resolveUiTheme(
  settings: WindowsTerminalSettings,
  profile: ResolvedProfile,
  appearance: 'dark' | 'light',
): UiThemeTokens {
  const selectedTheme = resolveTheme(settings, appearance)
  const scheme = resolveScheme(settings, profile, appearance)
  const accent =
    profile.tabColor ??
    scheme.brightBlue ??
    scheme.blue ??
    '#4cc2ff'
  const themeSeed =
    selectedTheme?.tabRow?.background ??
    selectedTheme?.tab?.background ??
    selectedTheme?.tab?.unfocusedBackground ??
    '#f3f3f3'
  const chrome = mix(themeSeed, '#ffffff', 0.12)
  const panel = mix(themeSeed, '#ffffff', 0.08)
  const window = mix(scheme.background, '#000000', 0.92)
  const surface = mix(scheme.background, '#000000', 0.86)

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
    tabActive: '#ffffff',
    tabInactive: '#ffffff',
    tabStrip: chrome,
    border: 'rgba(17, 17, 17, 0.12)',
    borderStrong: 'rgba(17, 17, 17, 0.32)',
    text: '#111111',
    textSoft: '#575757',
    textMuted: '#8a8a8a',
    accent,
    accentSoft: alpha(accent, 0.16),
    signal: scheme.yellow ?? accent,
    success: scheme.green ?? '#6fd19d',
    shadow: '0 18px 48px rgba(0, 0, 0, 0.24)',
  }
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
