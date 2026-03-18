import type { UiLanguage } from '../types'

export type DisplayLanguage = 'en' | 'ko'

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
  lineHeight: string
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

function systemDisplayLanguage(): DisplayLanguage {
  if (typeof navigator === 'undefined') {
    return 'en'
  }

  return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function resolveDisplayLanguage(language: UiLanguage | undefined): DisplayLanguage {
  if (language === 'ko' || language === 'en') {
    return language
  }

  return systemDisplayLanguage()
}

export function languageModeLabel(language: UiLanguage | undefined, copy: AppCopy) {
  switch (language) {
    case 'ko':
      return copy.languageKorean
    case 'en':
      return copy.languageEnglish
    default:
      return copy.languageSystem
  }
}

const ENGLISH: AppCopy = {
  sections: {
    appearance: { label: 'Theme Studio', meta: 'Surface, tabs, and shell chrome' },
    profiles: { label: 'Profile Studio', meta: 'Shell launch, prompt, and font behavior' },
    language: { label: 'Language', meta: 'App copy and locale behavior' },
    json: { label: 'settings.json', meta: 'Compatible JSON editor' },
    shortcuts: { label: 'Shortcuts', meta: 'Resolved keybindings' },
  },
  studioLabel: 'Studio',
  settingsWorkspace: 'Settings',
  settingsSections: 'Settings sections',
  studioStatus: 'Studio status',
  live: 'live',
  demo: 'demo',
  connecting: 'connecting',
  offline: 'offline',
  saving: 'saving',
  saved: 'saved',
  error: 'error',
  idle: 'idle',
  paneCount: (count) => `${count} panes`,
  themeStudioTitle: 'Theme Studio',
  themeStudioDescription:
    'Keep the shell black, the tab surfaces white, and the chrome flat while editing the shared theme payload directly.',
  newTheme: 'New theme',
  duplicate: 'Duplicate',
  delete: 'Delete',
  applied: 'Applied',
  row: 'Row',
  surface: 'Surface',
  shellLabel: 'shell',
  tabStripLabel: 'tab strip',
  activeAppearance: 'active appearance',
  savedAppearance: 'saved appearance',
  activeAppearanceSuffix: 'shell',
  themeFieldsDescription:
    'These fields write back to the shared `themes[]` payload and keep the shell surface flat.',
  selectedTab: 'selected',
  idleTab: 'idle',
  themeName: 'Theme name',
  appAppearance: 'App appearance',
  activeFrame: 'Active frame',
  inactiveFrame: 'Inactive frame',
  activeTab: 'Active tab',
  inactiveTab: 'Inactive tab',
  tabStrip: 'Tab strip',
  stripInactive: 'Strip inactive',
  closeButton: 'Close button',
  micaTint: 'Mica tint',
  saveTheme: 'Save theme',
  useOnShell: 'Use on this shell',
  reset: 'Reset',
  system: 'system',
  dark: 'dark',
  light: 'light',
  hover: 'hover',
  activeOnly: 'active only',
  always: 'always',
  never: 'never',
  profileStudioTitle: 'Profile Studio',
  profileStudioDescription:
    'Edit launch command, prompt template, and terminal font behavior without leaving the shell.',
  newProfile: 'New profile',
  defaultShell: 'default shell',
  hidden: 'hidden',
  ready: 'ready',
  profileName: 'Profile name',
  iconOrBadge: 'Icon or badge',
  commandLine: 'Command line',
  commandLineHelp: (platformLabel) =>
    `Leave this empty to follow the runtime default shell for ${platformLabel}.`,
  startingDirectory: 'Starting directory',
  startingDirectoryHelp: 'Leave this empty to start from the runtime home directory.',
  promptTemplate: 'Prompt template',
  promptTemplateHelp:
    'Use tokens to keep the shell prompt profile-aware without falling back to a generic prefix.',
  tabTitle: 'Tab title',
  optionalLabel: 'Optional label',
  tabAccent: 'Tab accent',
  colorScheme: 'Color scheme',
  fontFace: 'Font face',
  fontSize: 'Font size',
  lineHeight: 'Line height',
  cursorShape: 'Cursor shape',
  opacity: 'Opacity',
  shellBackground: 'Shell background',
  shellText: 'Shell text',
  cursor: 'Cursor',
  selection: 'Selection',
  acrylicBlur: 'Acrylic blur',
  hiddenToggle: 'Hidden',
  saveProfile: 'Save profile',
  open: 'Open',
  useAtStartup: 'Use at startup',
  onBranchMain: 'On branch main',
  tabChip: 'tab',
  textChip: 'text',
  cursorChip: 'cursor',
  selectionChip: 'selection',
  defaultBadge: 'default',
  liveBadge: 'live',
  languageStudioTitle: 'Language',
  languageStudioDescription:
    'Choose how the shell UI labels are rendered. The selection is stored in `webpty.language` for portable settings files.',
  languageMode: 'UI language',
  languageSystem: 'System',
  languageEnglish: 'English',
  languageKorean: 'Korean',
  languageBrowserPreview: 'Browser locale',
  languageSettingDescription:
    'The app currently ships English and Korean UI copy. `System` follows the browser locale and falls back to English.',
  languageApply: 'Apply language',
  languageActive: 'active',
  languageSavedHint: 'Saved to the shared settings document as `webpty.language`.',
  languageSampleTitle: 'Preview',
  languageSampleBody: 'Tab chrome, settings copy, and status labels change immediately.',
  settingsJsonTitle: 'settings.json',
  settingsJsonDescription:
    'Comments and trailing commas stay valid in the editor, and unknown keys continue to round-trip.',
  saveSettings: 'Save settings',
  resetDraft: 'Reset draft',
  shortcutsTitle: 'Shortcuts',
  shortcutsDescription:
    'Resolved from the shared `actions[]` payload, including object-form commands.',
  shortcutNewTab: 'new tab',
  shortcutCloseTab: 'close tab',
  shortcutNextTab: 'next tab',
  shortcutSettings: 'settings',
  showSessionRail: 'Show session rail',
  hideSessionRail: 'Hide session rail',
  openSettings: 'Open settings',
  settingsTab: 'Settings tab',
  closeSettings: 'Close settings',
  sessionRail: 'Session rail',
  workspaces: 'Workspaces',
  terminalWorkspace: 'Terminal workspace',
  newTab: 'New tab',
  splitVertical: 'Split vertical',
  splitHorizontal: 'Split horizontal',
  editSettingsJson: 'Edit settings.json',
  profileTab: (label) => `${label} tab`,
  closeTab: (label) => `Close ${label}`,
  paneAria: (label) => `${label} pane`,
  rustUnavailable: 'Rust PTY server unavailable, running local demo shell',
  saveFailed: 'Settings save failed. Check the JSON draft and runtime status.',
  invalidSettingsDraft: 'The settings draft is not valid shared settings JSON.',
  chooseAnotherStartupProfile:
    'Choose another startup profile before hiding the current default profile.',
  visibleProfileRequired: 'At least one visible profile must remain available.',
  hiddenProfileCannotStart: 'Hidden profiles cannot be used as the startup shell.',
  atLeastOneProfile: 'At least one profile must remain available.',
  atLeastOneTheme: 'At least one theme must remain available.',
  shellPromptPlaceholder: '{user}@{host}:{cwd}{symbol} ',
}

const KOREAN: AppCopy = {
  sections: {
    appearance: { label: '테마 스튜디오', meta: '표면, 탭, 셸 크롬' },
    profiles: { label: '프로필 스튜디오', meta: '셸 실행, 프롬프트, 폰트 동작' },
    language: { label: '언어', meta: '앱 문구와 로케일 동작' },
    json: { label: 'settings.json', meta: '호환 JSON 편집기' },
    shortcuts: { label: '단축키', meta: '해석된 키 바인딩' },
  },
  studioLabel: '스튜디오',
  settingsWorkspace: '설정',
  settingsSections: '설정 섹션',
  studioStatus: '스튜디오 상태',
  live: '연결됨',
  demo: '데모',
  connecting: '연결 중',
  offline: '오프라인',
  saving: '저장 중',
  saved: '저장됨',
  error: '오류',
  idle: '대기',
  paneCount: (count) => `${count}개 패널`,
  themeStudioTitle: '테마 스튜디오',
  themeStudioDescription:
    '공유 테마 payload를 직접 편집하면서 검은 셸, 흰 탭 표면, 평평한 크롬을 유지합니다.',
  newTheme: '새 테마',
  duplicate: '복제',
  delete: '삭제',
  applied: '적용 중',
  row: '행',
  surface: '표면',
  shellLabel: '셸',
  tabStripLabel: '탭 스트립',
  activeAppearance: '현재 적용',
  savedAppearance: '저장된 스타일',
  activeAppearanceSuffix: '셸',
  themeFieldsDescription:
    '이 필드들은 공유 `themes[]` payload에 그대로 기록되고 셸 표면을 평평하게 유지합니다.',
  selectedTab: '선택됨',
  idleTab: '대기',
  themeName: '테마 이름',
  appAppearance: '앱 외형',
  activeFrame: '활성 프레임',
  inactiveFrame: '비활성 프레임',
  activeTab: '활성 탭',
  inactiveTab: '비활성 탭',
  tabStrip: '탭 스트립',
  stripInactive: '비활성 스트립',
  closeButton: '닫기 버튼',
  micaTint: '마이카 틴트',
  saveTheme: '테마 저장',
  useOnShell: '현재 셸에 적용',
  reset: '초기화',
  system: '시스템',
  dark: '다크',
  light: '라이트',
  hover: '호버',
  activeOnly: '활성 탭만',
  always: '항상',
  never: '표시 안 함',
  profileStudioTitle: '프로필 스튜디오',
  profileStudioDescription:
    '셸을 떠나지 않고 실행 명령, 프롬프트 템플릿, 터미널 폰트 동작을 수정합니다.',
  newProfile: '새 프로필',
  defaultShell: '기본 셸',
  hidden: '숨김',
  ready: '준비됨',
  profileName: '프로필 이름',
  iconOrBadge: '아이콘 또는 배지',
  commandLine: '명령줄',
  commandLineHelp: (platformLabel) =>
    `비워 두면 ${platformLabel}의 런타임 기본 셸을 따릅니다.`,
  startingDirectory: '시작 디렉터리',
  startingDirectoryHelp: '비워 두면 런타임 홈 디렉터리에서 시작합니다.',
  promptTemplate: '프롬프트 템플릿',
  promptTemplateHelp:
    '토큰을 사용해 일반적인 프롬프트로 무너지지 않도록 프로필 인식 프롬프트를 유지합니다.',
  tabTitle: '탭 제목',
  optionalLabel: '선택 라벨',
  tabAccent: '탭 강조색',
  colorScheme: '색상 스킴',
  fontFace: '폰트 페이스',
  fontSize: '폰트 크기',
  lineHeight: '줄 높이',
  cursorShape: '커서 모양',
  opacity: '투명도',
  shellBackground: '셸 배경',
  shellText: '셸 텍스트',
  cursor: '커서',
  selection: '선택 영역',
  acrylicBlur: '아크릴 블러',
  hiddenToggle: '숨김',
  saveProfile: '프로필 저장',
  open: '열기',
  useAtStartup: '시작 시 사용',
  onBranchMain: 'main 브랜치',
  tabChip: '탭',
  textChip: '텍스트',
  cursorChip: '커서',
  selectionChip: '선택',
  defaultBadge: '기본',
  liveBadge: '실행 중',
  languageStudioTitle: '언어',
  languageStudioDescription:
    '셸 UI 문구를 어떤 언어로 렌더할지 선택합니다. 선택 값은 이식 가능한 설정 파일을 위해 `webpty.language`에 저장됩니다.',
  languageMode: 'UI 언어',
  languageSystem: '시스템',
  languageEnglish: '영어',
  languageKorean: '한국어',
  languageBrowserPreview: '브라우저 로케일',
  languageSettingDescription:
    '현재 앱은 영어와 한국어 UI 문구를 제공합니다. `시스템`은 브라우저 로케일을 따르고, 지원되지 않으면 영어로 대체됩니다.',
  languageApply: '언어 적용',
  languageActive: '사용 중',
  languageSavedHint: '공유 설정 문서의 `webpty.language`에 저장됩니다.',
  languageSampleTitle: '미리보기',
  languageSampleBody: '탭 크롬, 설정 문구, 상태 라벨이 즉시 바뀝니다.',
  settingsJsonTitle: 'settings.json',
  settingsJsonDescription:
    '편집기에서는 주석과 trailing comma가 그대로 유효하며, 알 수 없는 키도 round-trip 됩니다.',
  saveSettings: '설정 저장',
  resetDraft: '초안 초기화',
  shortcutsTitle: '단축키',
  shortcutsDescription:
    '객체형 명령을 포함해 공유 `actions[]` payload에서 해석된 결과입니다.',
  shortcutNewTab: '새 탭',
  shortcutCloseTab: '탭 닫기',
  shortcutNextTab: '다음 탭',
  shortcutSettings: '설정',
  showSessionRail: '세션 레일 표시',
  hideSessionRail: '세션 레일 숨기기',
  openSettings: '설정 열기',
  settingsTab: '설정 탭',
  closeSettings: '설정 닫기',
  sessionRail: '세션 레일',
  workspaces: '워크스페이스',
  terminalWorkspace: '터미널 워크스페이스',
  newTab: '새 탭',
  splitVertical: '세로 분할',
  splitHorizontal: '가로 분할',
  editSettingsJson: 'settings.json 편집',
  profileTab: (label) => `${label} 탭`,
  closeTab: (label) => `${label} 닫기`,
  paneAria: (label) => `${label} 패널`,
  rustUnavailable: 'Rust PTY 서버를 사용할 수 없어 로컬 데모 셸로 실행 중입니다.',
  saveFailed: '설정 저장에 실패했습니다. JSON 초안과 런타임 상태를 확인하세요.',
  invalidSettingsDraft: '설정 초안이 유효한 공유 settings JSON 형식이 아닙니다.',
  chooseAnotherStartupProfile:
    '현재 기본 프로필을 숨기기 전에 다른 시작 프로필을 선택해야 합니다.',
  visibleProfileRequired: '표시 가능한 프로필이 최소 하나는 남아 있어야 합니다.',
  hiddenProfileCannotStart: '숨김 프로필은 시작 셸로 사용할 수 없습니다.',
  atLeastOneProfile: '프로필은 최소 하나 이상 남아 있어야 합니다.',
  atLeastOneTheme: '테마는 최소 하나 이상 남아 있어야 합니다.',
  shellPromptPlaceholder: '{user}@{host}:{cwd}{symbol} ',
}

export function getAppCopy(language: DisplayLanguage): AppCopy {
  return language === 'ko' ? KOREAN : ENGLISH
}
