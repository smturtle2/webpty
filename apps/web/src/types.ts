export type OverlayState =
  | 'none'
  | 'palette'
  | 'tab-switcher'
  | 'search'
  | 'settings'

export type SplitAxis = 'vertical' | 'horizontal'
export type PaneStatus = 'running' | 'idle' | 'attention'

export type LayoutNode =
  | {
      type: 'pane'
      paneId: string
    }
  | {
      type: 'split'
      axis: SplitAxis
      ratio: number
      children: [LayoutNode, LayoutNode]
    }

export interface ProfileDefinition {
  id: string
  name: string
  subtitle: string
  accent: string
  icon: string
  shell: string
}

export interface PaneSummary {
  id: string
  sessionId: string
  profileId: string
  cwd: string
  title: string
  status: PaneStatus
  cols: number
  rows: number
  previewLines: string[]
}

export interface TabSummary {
  id: string
  title: string
  profileId: string
  accent: string
  hasBell: boolean
  isDirty: boolean
  lastUsedLabel: string
  primaryPaneId: string
  layout: LayoutNode
}

export interface PaletteAction {
  id: string
  title: string
  subtitle: string
  shortcut: string
  accent: string
}

export interface SettingsField {
  label: string
  value: string
  note: string
}

export interface SettingsSection {
  id: string
  label: string
  description: string
  fields: SettingsField[]
}

export interface ResearchPillar {
  title: string
  body: string
}

export interface ServerHealth {
  status: string
  message: string
  websocketPath: string
  mode: string
  features: string[]
}
