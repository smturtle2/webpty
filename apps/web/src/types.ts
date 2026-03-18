export type SessionStatus = 'running' | 'idle' | 'attention'

export type TerminalCursorShape =
  | 'filledBox'
  | 'bar'
  | 'underscore'
  | 'vintage'
  | 'block'
  | 'underline'

export type ThemeSelection =
  | string
  | {
      dark?: string
      light?: string
      system?: string
    }

export type SchemeSelection =
  | string
  | {
      dark?: string
      light?: string
    }

export interface TerminalTheme {
  name: string
  window?: {
    applicationTheme?: 'system' | 'dark' | 'light'
    useMica?: boolean
  }
  tab?: {
    background?: string
    showCloseButton?: 'always' | 'hover' | 'never'
    unfocusedBackground?: string
  }
  tabRow?: {
    background?: string
    unfocusedBackground?: string
  }
}

export type TerminalActionCommand =
  | string
  | {
      action?: string
      [key: string]: unknown
    }

export interface TerminalAction {
  command?: TerminalActionCommand
  keys?: string[]
  name?: string
}

export interface TerminalColorScheme {
  name: string
  background: string
  foreground: string
  cursorColor?: string
  selectionBackground?: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  purple?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightPurple?: string
  brightCyan?: string
  brightWhite?: string
}

export interface TerminalProfile {
  id?: string
  guid?: string
  name: string
  icon?: string
  commandline?: string
  startingDirectory?: string
  source?: string
  hidden?: boolean
  tabColor?: string
  tabTitle?: string
  colorScheme?: SchemeSelection
  fontFace?: string
  fontSize?: number
  lineHeight?: number
  cursorShape?: TerminalCursorShape
  opacity?: number
  useAcrylic?: boolean
}

export interface TerminalSettings {
  $schema?: string
  defaultProfile: string
  copyFormatting?: 'none' | 'html' | 'all'
  theme?: ThemeSelection
  themes?: TerminalTheme[]
  actions?: TerminalAction[]
  profiles: {
    defaults?: Partial<TerminalProfile>
    list: TerminalProfile[]
  }
  schemes?: TerminalColorScheme[]
}

export interface ResolvedProfile extends TerminalProfile {
  id: string
}

export interface SessionItem {
  id: string
  title: string
  profileId: string
  status: SessionStatus
  hasActivity: boolean
  lastUsedLabel: string
  cwd: string
  previewLines: string[]
}

export interface ServerHealth {
  status: string
  message: string
  websocketPath: string
  mode: string
  features: string[]
}

export interface UiThemeTokens {
  appBackground: string
  backgroundGlow: string
  window: string
  chrome: string
  chromeAlt: string
  surface: string
  panel: string
  terminalBackground: string
  terminalForeground: string
  tabActive: string
  tabInactive: string
  tabStrip: string
  border: string
  borderStrong: string
  text: string
  textSoft: string
  textMuted: string
  accent: string
  accentSoft: string
  signal: string
  success: string
  shadow: string
}
