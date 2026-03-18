export type DisplayLanguage = string

export interface SectionCopy {
  label: string
  meta: string
}

export interface AppCopy {
  sections: Record<'appearance' | 'profiles' | 'language' | 'json' | 'shortcuts', SectionCopy>
  studioLabel: string
  settingsWorkspace: string
  settingsSections: string
  studioStatus: string
  live: string
  demo: string
  connecting: string
  offline: string
  saving: string
  saved: string
  error: string
  idle: string
  paneCount: (count: number) => string
  themeStudioTitle: string
  themeStudioDescription: string
  newTheme: string
  duplicate: string
  delete: string
  applied: string
  row: string
  surface: string
  shellLabel: string
  tabStripLabel: string
  activeAppearance: string
  savedAppearance: string
  activeAppearanceSuffix: string
  themeFieldsDescription: string
  selectedTab: string
  idleTab: string
  themeName: string
  appAppearance: string
  activeFrame: string
  inactiveFrame: string
  activeTab: string
  inactiveTab: string
  tabStrip: string
  stripInactive: string
  closeButton: string
  micaTint: string
  saveTheme: string
  useOnShell: string
  reset: string
  system: string
  dark: string
  light: string
  hover: string
  activeOnly: string
  always: string
  never: string
  profileStudioTitle: string
  profileStudioDescription: string
  newProfile: string
  defaultShell: string
  hidden: string
  ready: string
  profileName: string
  iconOrBadge: string
  commandLine: string
  commandLineHelp: (platformLabel: string) => string
  startingDirectory: string
  startingDirectoryHelp: string
  promptTemplate: string
  promptTemplateHelp: string
  tabTitle: string
  optionalLabel: string
  tabAccent: string
  colorScheme: string
  fontFace: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  cellHeight: string
  padding: string
  cursorShape: string
  opacity: string
  shellBackground: string
  shellText: string
  cursor: string
  selection: string
  acrylicBlur: string
  hiddenToggle: string
  saveProfile: string
  open: string
  useAtStartup: string
  onBranchMain: string
  tabChip: string
  textChip: string
  cursorChip: string
  selectionChip: string
  defaultBadge: string
  liveBadge: string
  languageStudioTitle: string
  languageStudioDescription: string
  languageMode: string
  languageSystem: string
  languageEnglish: string
  languageKorean: string
  languageBrowserPreview: string
  languageSettingDescription: string
  languageApply: string
  languageActive: string
  languageSavedHint: string
  languageSampleTitle: string
  languageSampleBody: string
  settingsJsonTitle: string
  settingsJsonDescription: string
  saveSettings: string
  resetDraft: string
  shortcutsTitle: string
  shortcutsDescription: string
  shortcutNewTab: string
  shortcutCloseTab: string
  shortcutNextTab: string
  shortcutSettings: string
  showSessionRail: string
  hideSessionRail: string
  openSettings: string
  settingsTab: string
  closeSettings: string
  sessionRail: string
  workspaces: string
  terminalWorkspace: string
  newTab: string
  splitVertical: string
  splitHorizontal: string
  editSettingsJson: string
  profileTab: (label: string) => string
  closeTab: (label: string) => string
  paneAria: (label: string) => string
  rustUnavailable: string
  saveFailed: string
  invalidSettingsDraft: string
  chooseAnotherStartupProfile: string
  visibleProfileRequired: string
  hiddenProfileCannotStart: string
  atLeastOneProfile: string
  atLeastOneTheme: string
  shellPromptPlaceholder: string
}

export interface UiLocaleDefinition {
  id: string
  aliases?: string[]
  label: (copy: AppCopy) => string
  nativeLabel: string
  copy: AppCopy
}
