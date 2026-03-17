export type SessionStatus = 'running' | 'idle' | 'attention'

export interface ProfileDefinition {
  id: string
  name: string
  accent: string
  icon: string
  shell: string
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
