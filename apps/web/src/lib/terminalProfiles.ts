import type {
  ColorReferencePalette,
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

export const COLOR_REFERENCE_TOKENS = [
  'accent',
  'terminalBackground',
  'terminalForeground',
  'cursorColor',
  'selectionBackground',
] as const

const COLOR_REFERENCE_TOKEN_SET = new Set<string>(COLOR_REFERENCE_TOKENS)

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

  const palette = buildColorReferencePalette(profile, resolved)

  return {
    ...resolved,
    background: palette.terminalBackground,
    foreground: palette.terminalForeground,
    cursorColor: palette.cursorColor,
    selectionBackground: palette.selectionBackground,
  }
}

export function resolveUiTheme(
  settings: TerminalSettings,
  profile: ResolvedProfile,
  appearance: 'dark' | 'light',
): UiThemeTokens {
  const selectedTheme = resolveTheme(settings, appearance)
  const scheme = resolveScheme(settings, profile, appearance)
  const palette = buildColorReferencePalette(profile, scheme)
  const accent = palette.accent
  const usesMica = selectedTheme?.window?.useMica === true
  const tabActive = resolveColorReference(selectedTheme?.tab?.background, palette, '#ffffff')
  const tabInactive = resolveColorReference(
    selectedTheme?.tab?.unfocusedBackground ?? selectedTheme?.tabRow?.unfocusedBackground,
    palette,
    '#f3f3f3',
  )
  const tabStrip = resolveColorReference(selectedTheme?.tabRow?.background, palette, '#efefef')
  const frame = resolveColorReference(selectedTheme?.window?.frame, palette, tabStrip)
  const chrome = usesMica ? mix(tabStrip, frame, 0.14) : tabStrip
  const chromeAlt = usesMica ? mix(tabActive, frame, 0.08) : tabActive
  const panel = usesMica ? mix(tabStrip, tabActive, 0.48) : mix(tabStrip, tabActive, 0.34)
  const surface = usesMica ? mix(tabActive, '#ffffff', 0.9) : mix(tabActive, '#ffffff', 0.94)
  const window = usesMica ? mix(frame, '#ffffff', 0.36) : mix(frame, '#ffffff', 0.46)
  const text = readableText(surface)

  return {
    appBackground: '#000000',
    backgroundGlow: 'transparent',
    window,
    chrome,
    chromeAlt,
    chromeBackdrop: 'none',
    surface,
    panel,
    terminalBackground: scheme.background,
    terminalForeground: scheme.foreground,
    tabActive,
    tabInactive,
    tabStrip,
    border: alpha(text, 0.12),
    borderStrong: alpha(text, 0.22),
    text,
    textSoft: alpha(text, 0.74),
    textMuted: alpha(text, 0.54),
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
  return profile.lineHeight ?? profile.font?.cellHeight ?? 1.22
}

export function resolveProfilePadding(
  profile: ResolvedProfile | TerminalProfile,
): string | undefined {
  const value = profile.padding

  if (typeof value === 'number') {
    return Number.isFinite(value) ? `${Math.max(0, value)}px` : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return undefined
  }

  const tokens = normalized
    .split(normalized.includes(',') ? /\s*,\s*/ : /\s+/)
    .map((token) => normalizePaddingToken(token))
    .filter((token): token is string => token.length > 0)
    .slice(0, 4)

  return tokens.length > 0 ? tokens.join(' ') : undefined
}

function normalizePaddingToken(token: string): string {
  const normalized = token.trim()
  if (normalized.length === 0) {
    return ''
  }

  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return `${Math.max(0, Number(normalized))}px`
  }

  return normalized
}

export function buildColorReferencePalette(
  profile: ResolvedProfile | TerminalProfile,
  scheme: TerminalColorScheme,
): ColorReferencePalette {
  const accentFallback = scheme.brightBlue ?? scheme.blue ?? '#4cc2ff'
  const basePalette: ColorReferencePalette = {
    accent: accentFallback,
    terminalBackground: scheme.background,
    terminalForeground: scheme.foreground,
    cursorColor: scheme.cursorColor ?? scheme.foreground,
    selectionBackground: scheme.selectionBackground ?? '#264f78',
  }
  const accent = resolveColorReference(profile.tabColor, basePalette, accentFallback)
  const paletteWithAccent = {
    ...basePalette,
    accent,
  }
  const terminalBackground = resolveColorReference(
    profile.background,
    paletteWithAccent,
    scheme.background,
  )
  const terminalForeground = resolveColorReference(
    profile.foreground,
    {
      ...paletteWithAccent,
      terminalBackground,
    },
    scheme.foreground,
  )
  const cursorColor = resolveColorReference(
    profile.cursorColor,
    {
      ...paletteWithAccent,
      terminalBackground,
      terminalForeground,
    },
    scheme.cursorColor ?? terminalForeground,
  )
  const selectionBackground = resolveColorReference(
    profile.selectionBackground,
    {
      ...paletteWithAccent,
      terminalBackground,
      terminalForeground,
      cursorColor,
    },
    scheme.selectionBackground ?? '#264f78',
  )

  return {
    accent,
    terminalBackground,
    terminalForeground,
    cursorColor,
    selectionBackground,
  }
}

export function resolveColorReference(
  value: string | undefined,
  palette: ColorReferencePalette,
  fallback: string,
): string {
  if (!value) {
    return fallback
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return fallback
  }

  if (COLOR_REFERENCE_TOKEN_SET.has(normalized)) {
    return palette[normalized as keyof ColorReferencePalette]
  }

  return normalized
}

export function buildPreviewLines(transcript: string): string[] {
  return transcript
    .split(/\r?\n/)
    .map(stripTerminalControlSequences)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-4)
}

function stripTerminalControlSequences(line: string): string {
  let output = ''

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (!character) {
      continue
    }

    if (character === '\u001b') {
      const next = line[index + 1]

      if (next === '[') {
        index += 2
        while (index < line.length) {
          const code = line.charCodeAt(index)
          if (code >= 0x40 && code <= 0x7e) {
            break
          }
          index += 1
        }
        continue
      }

      if (next === ']') {
        index += 2
        while (index < line.length) {
          const oscCharacter = line[index]
          if (oscCharacter === '\u0007') {
            break
          }
          if (oscCharacter === '\u001b' && line[index + 1] === '\\') {
            index += 1
            break
          }
          index += 1
        }
        continue
      }

      continue
    }

    const code = character.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) {
      continue
    }

    output += character
  }

  return output
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

export function promptPrefixForProfile(profile: TerminalProfile, cwd: string): string {
  const promptTemplate = profile.promptTemplate
  const profileName = profile.name.trim()
  const commandline = profile.commandline ?? ''
  const resolvedHostLabel = profileHostLabel(profileName, commandline)
  const sanitizedProfileLabel = sanitizePromptLabel(profileName)

  if (promptTemplate && promptTemplate.trim().length > 0) {
    return promptTemplate
      .replaceAll('{cwd}', cwd)
      .replaceAll('{user}', 'user')
      .replaceAll('{host}', resolvedHostLabel ?? 'shell')
      .replaceAll('{profile}', sanitizedProfileLabel)
      .replaceAll('{name}', profile.name)
      .replaceAll('{symbol}', '$')
  }

  const normalizedName = profileName.toLowerCase()
  const normalizedCommand = commandline.toLowerCase()

  if (normalizedName.includes('powershell') || normalizedCommand.includes('pwsh')) {
    if (normalizedName === 'powershell') {
      return `PS ${cwd}> `
    }

    return `PS(${sanitizedProfileLabel}) ${cwd}> `
  }

  if (resolvedHostLabel) {
    return `user@${resolvedHostLabel}:${cwd}$ `
  }

  return `[${sanitizedProfileLabel}] ${cwd}$ `
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function sanitizePromptLabel(value: string): string {
  const sanitized = value
    .split('')
    .filter(
      (character) =>
        /[A-Za-z0-9]/.test(character) || character === '-' || character === '_' || character === '.',
    )
    .join('')

  return sanitized.length > 0 ? sanitized : 'webpty'
}

function profileHostLabel(profileName: string, commandline: string): string | null {
  const normalizedName = sanitizePromptLabel(profileName.toLowerCase())
  const normalizedCommand = commandline.toLowerCase()
  const distribution = wslDistributionLabel(commandline)

  if (distribution) {
    return distribution
  }

  if (normalizedName.includes('ubuntu')) {
    return normalizedName.length > 0 ? normalizedName : 'ubuntu'
  }

  if (looksPosixShellPrompt(normalizedCommand) || isGenericShellLabel(normalizedName)) {
    if (normalizedName.length === 0 || isGenericShellLabel(normalizedName)) {
      return 'shell'
    }

    return normalizedName
  }

  return null
}

function wslDistributionLabel(commandline: string): string | null {
  const args = parseCommandlineArgs(commandline)
  if (!args || args.length === 0) {
    return null
  }

  const program = programName(args[0])
  if (program !== 'wsl' && program !== 'wsl.exe') {
    return null
  }

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    const lowered = argument.toLowerCase()

    if ((lowered === '-d' || lowered === '--distribution') && args[index + 1]) {
      const distribution = sanitizePromptLabel(args[index + 1].toLowerCase())
      return distribution.length > 0 ? distribution : null
    }

    const split = lowered.split('=')
    if (split.length === 2 && (split[0] === '-d' || split[0] === '--distribution')) {
      const distribution = sanitizePromptLabel(split[1])
      return distribution.length > 0 ? distribution : null
    }
  }

  return null
}

function looksPosixShellPrompt(commandline: string): boolean {
  if (
    commandline.includes('bash') ||
    commandline.includes('zsh') ||
    commandline.includes('fish') ||
    commandline.includes('/bin/sh')
  ) {
    return true
  }

  const program = commandProgramName(commandline)
  return (
    program === 'bash' ||
    program === 'bash.exe' ||
    program === 'sh' ||
    program === 'zsh' ||
    program === 'zsh.exe' ||
    program === 'fish' ||
    program === 'fish.exe'
  )
}

function commandProgramName(commandline: string): string | null {
  const args = parseCommandlineArgs(commandline)
  if (!args || args.length === 0) {
    return null
  }

  return programName(args[0])
}

function programName(program: string): string {
  return program.split(/[\\/]/).at(-1)?.toLowerCase() ?? program.toLowerCase()
}

function isGenericShellLabel(label: string): boolean {
  return (
    label === '' ||
    label === 'shell' ||
    label === 'bash' ||
    label === 'sh' ||
    label === 'zsh' ||
    label === 'fish' ||
    label === 'terminal'
  )
}

function parseCommandlineArgs(commandline: string): string[] | null {
  const trimmed = commandline.trim()
  if (trimmed.length === 0) {
    return null
  }

  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]

    if (quote) {
      if (character === quote) {
        quote = null
      } else if (character === '\\' && index + 1 < trimmed.length && trimmed[index + 1] === quote) {
        current += quote
        index += 1
      } else {
        current += character
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += character
  }

  if (quote) {
    return null
  }

  if (current.length > 0) {
    args.push(current)
  }

  return args.length > 0 ? args : null
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

function readableText(
  background: string,
  dark = '#111111',
  light = '#f6f7fb',
): string {
  const parsed = parseHex(background)

  if (!parsed) {
    return dark
  }

  const luminance =
    (0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b) / 255

  return luminance > 0.58 ? dark : light
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
