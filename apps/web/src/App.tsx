import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from 'react'
import JSON5 from 'json5'
import './App.css'
import { TerminalViewport } from './components/TerminalViewport'
import { demoHealth, demoSessions, demoSettings } from './data/demo'
import {
  COLOR_REFERENCE_TOKENS,
  actionLabel,
  buildColorReferencePalette,
  buildPreviewLines,
  formatSettingsJson,
  profileIdentifier,
  promptPrefixForProfile,
  resolveColorReference,
  resolveProfileFontFace,
  resolveProfileFontSize,
  resolveProfileLineHeight,
  resolveProfilePadding,
  resolveProfile,
  resolveScheme,
  resolveTheme,
  resolveThemeName,
  resolveUiTheme,
  resolveWindowAppearance,
} from './lib/terminalProfiles'
import type {
  ColorReferencePalette,
  ResolvedProfile,
  ServerHealth,
  SessionItem,
  TerminalAction,
  TerminalActionCommand,
  TerminalProfile,
  TerminalSettings,
  TerminalTheme,
  UiThemeTokens,
} from './types'

type ConnectionState = 'connecting' | 'live' | 'offline'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type PaneLayout = 'single' | 'vertical' | 'horizontal'
type WorkspaceMode = 'terminal' | 'settings'
type SupportedActionCommand = 'newTab' | 'closeTab' | 'nextTab' | 'prevTab' | 'openSettings'
type ActionBindings = Record<SupportedActionCommand, string[]>
type SettingsSection = 'appearance' | 'profiles' | 'json' | 'shortcuts'

interface WorkspaceTab {
  id: string
  paneIds: string[]
  layout: PaneLayout
}

const DEFAULT_ACTION_BINDINGS: ActionBindings = {
  newTab: ['ctrl+t'],
  closeTab: ['ctrl+w'],
  nextTab: ['ctrl+tab'],
  prevTab: ['ctrl+shift+tab'],
  openSettings: ['ctrl+,'],
}

const EMPTY_THEMES: TerminalTheme[] = []

const RAIL_COLLAPSED_STORAGE_KEY = 'webpty:rail-collapsed'
const SETTINGS_WORKSPACE_ID = 'workspace-settings'
const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; meta: string }> = [
  { id: 'appearance', label: 'Theme Studio', meta: 'Surface, tabs, and shell chrome' },
  { id: 'profiles', label: 'Profile Studio', meta: 'Shell launch, prompt, and font behavior' },
  { id: 'json', label: 'settings.json', meta: 'Compatible JSON editor' },
  { id: 'shortcuts', label: 'Shortcuts', meta: 'Resolved keybindings' },
]
const CHROME_COLOR_TOKENS = COLOR_REFERENCE_TOKENS.filter(
  (token) => token !== 'cursorColor' && token !== 'selectionBackground',
)
const TAB_COLOR_TOKENS = COLOR_REFERENCE_TOKENS.filter((token) => token !== 'cursorColor')
const PROFILE_ACCENT_TOKENS = COLOR_REFERENCE_TOKENS.filter(
  (token) => token === 'accent' || token === 'terminalBackground' || token === 'selectionBackground',
)
const TEXT_COLOR_TOKENS = COLOR_REFERENCE_TOKENS.filter(
  (token) => token === 'terminalForeground' || token === 'accent',
)
const CURSOR_COLOR_TOKENS = COLOR_REFERENCE_TOKENS.filter(
  (token) => token === 'cursorColor' || token === 'terminalForeground' || token === 'accent',
)
const SELECTION_COLOR_TOKENS = COLOR_REFERENCE_TOKENS.filter(
  (token) => token === 'selectionBackground' || token === 'accent' || token === 'terminalBackground',
)
const PROMPT_TEMPLATE_TOKENS = ['{cwd}', '{user}', '{host}', '{profile}', '{symbol}'] as const

function App() {
  const [settings, setSettings] = useState<TerminalSettings>(demoSettings)
  const [settingsDocument, setSettingsDocument] = useState<Record<string, unknown>>(() =>
    cloneSettingsDocument(demoSettings),
  )
  const [sessions, setSessions] = useState<SessionItem[]>(demoSessions)
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => buildTabsFromSessions(demoSessions))
  const [activeTabId, setActiveTabId] = useState(() => buildTabsFromSessions(demoSessions)[0].id)
  const [activeSessionId, setActiveSessionId] = useState(demoSessions[0].id)
  const [serverHealth, setServerHealth] = useState<ServerHealth>(demoHealth)
  const [remoteReady, setRemoteReady] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>('offline')
  const [systemAppearance, setSystemAppearance] = useState<'dark' | 'light'>(resolveAppearance())
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMode>('terminal')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSection>('appearance')
  const [isRailCollapsed, setIsRailCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [settingsDraft, setSettingsDraft] = useState(formatSettingsJson(demoSettings))
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [isBooting, setIsBooting] = useState(true)
  const [selectedProfileId, setSelectedProfileId] = useState(demoSettings.defaultProfile)
  const [profileDraft, setProfileDraft] = useState<TerminalProfile>(() =>
    resolveProfile(demoSettings, demoSettings.defaultProfile),
  )
  const [selectedThemeName, setSelectedThemeName] = useState(
    () =>
      resolveThemeName(
        demoSettings.theme,
        resolveWindowAppearance(demoSettings, resolveAppearance()),
      ) ??
      demoSettings.themes?.[0]?.name ??
      'Theme',
  )
  const [themeDraft, setThemeDraft] = useState<TerminalTheme>(
    () =>
      resolveTheme(
        demoSettings,
        resolveWindowAppearance(demoSettings, resolveAppearance()),
      ) ??
      demoSettings.themes?.[0] ?? { name: 'Theme' },
  )
  const nextSessionIdRef = useRef(demoSessions.length + 1)

  const currentTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? buildTabsFromSessions(demoSessions)[0]
  const paneSessions = currentTab.paneIds
    .map((paneId) => sessions.find((session) => session.id === paneId))
    .filter((session): session is SessionItem => session !== undefined)
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ??
    paneSessions[0] ??
    sessions[0] ??
    demoSessions[0]
  const uiAppearance = resolveWindowAppearance(settings, systemAppearance)
  const activeProfile = resolveProfile(settings, activeSession.profileId)
  const defaultProfile = resolveProfile(settings, settings.defaultProfile)
  const activeScheme = resolveScheme(settings, activeProfile, uiAppearance)
  const activeTheme = resolveTheme(settings, uiAppearance)
  const themeName = resolveThemeName(settings.theme, uiAppearance) ?? 'System'
  const uiTheme = resolveUiTheme(settings, activeProfile, uiAppearance)
  const closeButtonMode = activeTheme?.tab?.showCloseButton ?? 'hover'
  const visiblePaneSessions = paneSessions.length > 0 ? paneSessions : [activeSession]
  const activeTabLabel =
    activeWorkspace === 'settings' ? 'Settings' : tabLabelForTab(currentTab, sessions, settings)
  const activeWorkspaceId =
    activeWorkspace === 'settings' ? SETTINGS_WORKSPACE_ID : currentTab.id
  const profileCatalog = settings.profiles.list.map((profile) =>
    resolveProfile(settings, profileIdentifier(profile)),
  )
  const themeCatalog = settings.themes ?? EMPTY_THEMES
  const selectedProfile =
    profileCatalog.find((profile) => profile.id === selectedProfileId) ?? defaultProfile
  const selectedTheme =
    themeCatalog.find((theme) => theme.name === selectedThemeName) ??
    activeTheme ??
    themeCatalog[0] ??
    demoSettings.themes?.[0] ??
    ({ name: 'Theme' } satisfies TerminalTheme)
  const profileDraftScheme = resolveDraftScheme(settings, profileDraft, uiAppearance)
  const selectedProfileSchemeName =
    schemeSelectionLabel(profileDraft.colorScheme, uiAppearance) ?? profileDraftScheme.name
  const activeColorPalette = buildColorReferencePalette(activeProfile, activeScheme)
  const draftColorPalette = buildColorReferencePalette(profileDraft, profileDraftScheme)
  const visibleProfileCount = profileCatalog.filter((profile) => !profile.hidden).length
  const actionBindings = resolveActionBindings(settings.actions)
  const canSplitActiveTab = activeWorkspace === 'terminal' && currentTab.paneIds.length === 1
  const shortcutSummary = [
    { command: 'new tab', keys: actionLabel(actionBindings.newTab) },
    { command: 'close tab', keys: actionLabel(actionBindings.closeTab) },
    { command: 'next tab', keys: actionLabel(actionBindings.nextTab) },
    { command: 'settings', keys: actionLabel(actionBindings.openSettings) },
  ].filter((shortcut) => shortcut.keys.length > 0)
  const canConnect = remoteReady && serverHealth.status === 'ok'
  const isDraftDirty = settingsDraft !== formatSettingsJson(settingsDocument)
  const runtimeLabel = canConnect
    ? connectionState === 'live'
      ? 'live'
      : connectionState
    : 'demo'
  const saveLabel =
    saveState === 'saving'
      ? 'saving'
      : saveState === 'saved'
        ? 'saved'
        : saveState === 'error'
          ? 'error'
          : 'idle'
  const runtimeMessage = isBooting ? 'Syncing runtime contracts…' : serverHealth.message
  const settingsSectionMeta =
    SETTINGS_SECTIONS.find((section) => section.id === activeSettingsSection) ?? SETTINGS_SECTIONS[0]

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => {
      setSystemAppearance(mediaQuery.matches ? 'light' : 'dark')
    }

    handleChange()
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, String(isRailCollapsed))
    } catch {
      // ignore local storage failures and keep the in-memory state
    }
  }, [isRailCollapsed])

  useEffect(() => {
    const controller = new AbortController()

    async function loadRuntime() {
      setIsBooting(true)

      const [healthResult, settingsResult, sessionsResult] = await Promise.allSettled([
        fetchJson('/api/health', controller.signal),
        fetchJson('/api/settings', controller.signal),
        fetchJson('/api/sessions', controller.signal),
      ])

      const nextHealth =
        healthResult.status === 'fulfilled'
          ? normalizeHealth(healthResult.value)
          : {
              ...demoHealth,
              message: 'Rust PTY server unavailable, running local demo shell',
            }
      const nextSettings =
        settingsResult.status === 'fulfilled'
          ? normalizeSettings(settingsResult.value)
          : demoSettings
      const nextSettingsDocument =
        settingsResult.status === 'fulfilled'
          ? cloneSettingsDocument(settingsResult.value, nextSettings)
          : cloneSettingsDocument(demoSettings)
      const nextSessions =
        sessionsResult.status === 'fulfilled'
          ? normalizeSessions(sessionsResult.value)
          : demoSessions
      const nextVisibleSessions = nextSessions.length > 0 ? nextSessions : demoSessions
      const nextTabs = buildTabsFromSessions(nextVisibleSessions)
      const ready =
        healthResult.status === 'fulfilled' &&
        settingsResult.status === 'fulfilled' &&
        sessionsResult.status === 'fulfilled' &&
        nextSessions.length > 0

      setServerHealth(nextHealth)
      setSettings(nextSettings)
      setSettingsDocument(nextSettingsDocument)
      setSettingsDraft(formatSettingsJson(nextSettingsDocument))
      setSessions(nextVisibleSessions)
      setTabs(nextTabs)
      setActiveSessionId(nextTabs[0].paneIds[0])
      setActiveTabId(nextTabs[0].id)
      setRemoteReady(ready)

      setIsBooting(false)
    }

    void loadRuntime()

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (sessions.length === 0) {
      return
    }

    const nextTabs = syncTabsWithSessions(tabs, sessions)
    const needsTabSync = JSON.stringify(nextTabs) !== JSON.stringify(tabs)

    if (needsTabSync) {
      setTabs(nextTabs)
    }

    if (!sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(nextTabs[0]?.paneIds[0] ?? sessions[0].id)
    }

    if (!nextTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(nextTabs[0]?.id ?? tabIdForSession(sessions[0].id))
      return
    }

    if (findTabByPaneId(nextTabs, activeSessionId)?.id !== activeTabId) {
      const owner = findTabByPaneId(nextTabs, activeSessionId)
      if (owner) {
        setActiveTabId(owner.id)
      }
    }
  }, [activeSessionId, activeTabId, sessions, tabs])

  useEffect(() => {
    if (profileCatalog.length === 0) {
      return
    }

    if (!profileCatalog.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profileCatalog[0].id)
      return
    }

    setProfileDraft(resolveProfile(settings, selectedProfileId))
  }, [profileCatalog, selectedProfileId, settings])

  useEffect(() => {
    if (themeCatalog.length === 0) {
      setThemeDraft({ name: 'Theme' })
      return
    }

    if (!themeCatalog.some((theme) => theme.name === selectedThemeName)) {
      setSelectedThemeName(themeCatalog[0].name)
      return
    }

    setThemeDraft(
      themeCatalog.find((theme) => theme.name === selectedThemeName) ?? themeCatalog[0],
    )
  }, [selectedThemeName, themeCatalog])

  function activateSession(sessionId: string) {
    const owner = findTabByPaneId(tabs, sessionId)

    startTransition(() => {
      setActiveWorkspace('terminal')
      if (owner) {
        setActiveTabId(owner.id)
      }
      setActiveSessionId(sessionId)
      setSessions((currentSessions) =>
        currentSessions.map((session) => {
          if (session.id === sessionId) {
            return {
              ...session,
              hasActivity: false,
              lastUsedLabel: 'Now',
            }
          }

          if (session.lastUsedLabel === 'Now') {
            return {
              ...session,
              lastUsedLabel: 'Recent',
            }
          }

          return session
        }),
      )
    })
  }

  function closeSettingsWorkspace() {
    setActiveWorkspace('terminal')
    setIsSettingsOpen(false)
  }

  function openSettingsWorkspace(section: SettingsSection) {
    setIsRailCollapsed(false)
    setActiveSettingsSection(section)
    setIsSettingsOpen(true)
    setActiveWorkspace('settings')
  }

  function cycleWorkspace(direction: 1 | -1) {
    const workspaceOrder = [
      ...tabs.map((tab) => tab.id),
      ...(isSettingsOpen ? [SETTINGS_WORKSPACE_ID] : []),
    ]

    if (workspaceOrder.length <= 1) {
      return
    }

    const currentIndex = workspaceOrder.indexOf(activeWorkspaceId)
    const nextIndex =
      (Math.max(currentIndex, 0) + direction + workspaceOrder.length) % workspaceOrder.length
    const nextWorkspaceId = workspaceOrder[nextIndex]

    if (nextWorkspaceId === SETTINGS_WORKSPACE_ID) {
      setActiveWorkspace('settings')
      return
    }

    const nextTab = tabs.find((tab) => tab.id === nextWorkspaceId)
    if (!nextTab) {
      return
    }

    activateSession(nextTab.paneIds[0])
  }

  function closeCurrentWorkspace() {
    if (activeWorkspace === 'settings' && isSettingsOpen) {
      closeSettingsWorkspace()
      return
    }

    void closeTab(activeTabId)
  }

  async function createSession(profileId = activeProfile.id, mode: PaneLayout = 'single') {
    const targetProfile = resolveProfile(settings, profileId)
    const nextCwd = targetProfile.startingDirectory ?? activeSession.cwd

    if (canConnect) {
      try {
        const payload = await fetchJson('/api/sessions', undefined, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            profileId,
            cwd: nextCwd,
          }),
        })
        const created = normalizeCreatedSession(payload)

        if (created) {
          const nextTabs = appendSessionToTabs(tabs, activeTabId, created.id, mode)
          startTransition(() => {
            setActiveWorkspace('terminal')
            setSessions((currentSessions) => [...promoteSessions(currentSessions), created])
            setTabs(nextTabs)
            setActiveTabId(findTabByPaneId(nextTabs, created.id)?.id ?? tabIdForSession(created.id))
            setActiveSessionId(created.id)
          })
          return
        }
      } catch {
        setRemoteReady(false)
      }
    }

    const fallback = createFallbackSession(profileId, nextCwd, settings, nextSessionIdRef)
    const nextTabs = appendSessionToTabs(tabs, activeTabId, fallback.id, mode)

    startTransition(() => {
      setActiveWorkspace('terminal')
      setSessions((currentSessions) => [...promoteSessions(currentSessions), fallback])
      setTabs(nextTabs)
      setActiveTabId(findTabByPaneId(nextTabs, fallback.id)?.id ?? tabIdForSession(fallback.id))
      setActiveSessionId(fallback.id)
    })
  }

  async function closeSession(sessionId: string) {
    if (sessions.length <= 1) {
      return
    }

    const nextTabs = removeSessionFromTabs(tabs, sessionId)
    const nextActiveSessionId =
      sessionId === activeSessionId
        ? preferredActiveSessionId(nextTabs, activeTabId, sessions, sessionId)
        : activeSessionId
    const nextActiveTabId =
      findTabByPaneId(nextTabs, nextActiveSessionId)?.id ??
      nextTabs[0]?.id ??
      activeTabId

    if (canConnect) {
      void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      }).catch(() => {
        setRemoteReady(false)
      })
    }

    startTransition(() => {
      setSessions((currentSessions) => currentSessions.filter((session) => session.id !== sessionId))
      setTabs(nextTabs)
      setActiveTabId(nextActiveTabId)
      setActiveSessionId(nextActiveSessionId)
    })
  }

  async function closeTab(tabId: string) {
    const targetTab = tabs.find((tab) => tab.id === tabId)

    if (!targetTab || sessions.length <= targetTab.paneIds.length) {
      return
    }

    if (targetTab.paneIds.length === 1) {
      await closeSession(targetTab.paneIds[0])
      return
    }

    if (canConnect) {
      for (const paneId of targetTab.paneIds) {
        void fetch(`/api/sessions/${encodeURIComponent(paneId)}`, {
          method: 'DELETE',
        }).catch(() => {
          setRemoteReady(false)
        })
      }
    }

    const paneIdSet = new Set(targetTab.paneIds)
    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    const nextActiveTab = nextTabs[0]
    const nextActiveSessionId = nextActiveTab?.paneIds[0] ?? activeSessionId

    startTransition(() => {
      setSessions((currentSessions) =>
        currentSessions.filter((session) => !paneIdSet.has(session.id)),
      )
      setTabs(nextTabs)
      setActiveTabId(nextActiveTab?.id ?? activeTabId)
      setActiveSessionId(nextActiveSessionId)
    })
  }

  function handleTranscriptChange(sessionId: string, transcript: string) {
    startTransition(() => {
      setSessions((currentSessions) =>
        currentSessions.map((session) => {
          if (session.id !== sessionId) {
            return session
          }

          return {
            ...session,
            previewLines: buildPreviewLines(transcript),
            hasActivity: session.id === activeSessionId ? false : true,
            lastUsedLabel: session.id === activeSessionId ? 'Now' : 'Updated',
          }
        }),
      )
    })
  }

  function handleConnectionStateChange(sessionId: string, nextState: ConnectionState) {
    if (sessionId === activeSessionId) {
      setConnectionState(nextState)
    }
  }

  function handleShortcut(event: KeyboardEvent) {
    if (event.key === 'Escape' && activeWorkspace === 'settings') {
      event.preventDefault()
      closeSettingsWorkspace()
      return true
    }

    if (isTypingTarget(event.target)) {
      return false
    }

    if (matchesAction(event, actionBindings.prevTab)) {
      event.preventDefault()
      cycleWorkspace(-1)
      return true
    }

    if (matchesAction(event, actionBindings.nextTab)) {
      event.preventDefault()
      cycleWorkspace(1)
      return true
    }

    if (matchesAction(event, actionBindings.newTab)) {
      event.preventDefault()
      void createSession()
      return true
    }

    if (matchesAction(event, actionBindings.closeTab)) {
      event.preventDefault()
      closeCurrentWorkspace()
      return true
    }

    if (matchesAction(event, actionBindings.openSettings)) {
      event.preventDefault()
      if (activeWorkspace === 'settings') {
        closeSettingsWorkspace()
      } else {
        openSettingsWorkspace('appearance')
      }
      return true
    }

    return false
  }

  const handleWindowKeydown = useEffectEvent((event: KeyboardEvent) => {
    handleShortcut(event)
  })

  useEffect(() => {
    window.addEventListener('keydown', handleWindowKeydown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeydown)
    }
  }, [])

  async function commitSettings(nextDocument: Record<string, unknown>, persist: boolean) {
    setSettingsError(null)
    setSaveState(persist ? 'saving' : 'saved')
    const nextSettings = normalizeSettings(nextDocument)

    if (!persist) {
      startTransition(() => {
        setSettings(nextSettings)
        setSettingsDocument(nextDocument)
        setSettingsDraft(formatSettingsJson(nextDocument))
      })
      return
    }

    try {
      const payload = await fetchJson('/api/settings', undefined, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(nextDocument),
      })
      const normalized = normalizeSettings(payload)
      const document = cloneSettingsDocument(payload, normalized)

      startTransition(() => {
        setSettings(normalized)
        setSettingsDocument(document)
        setSettingsDraft(formatSettingsJson(document))
        setRemoteReady(true)
      })
      setSaveState('saved')
    } catch {
      setSaveState('error')
      setSettingsError('Settings save failed. Check the JSON draft and runtime status.')
    }
  }

  async function handleProfileDraftSave() {
    if (profileDraft.hidden && selectedProfileId === defaultProfile.id) {
      setSettingsError('Choose another startup profile before hiding the current default profile.')
      return
    }

    if (profileDraft.hidden && visibleProfileCount <= 1 && !selectedProfile.hidden) {
      setSettingsError('At least one visible profile must remain available.')
      return
    }

    const nextProfileId = profileIdentifier(profileDraft)
    const nextDocument = updateProfileDocument(settingsDocument, selectedProfileId, profileDraft)
    await commitSettings(nextDocument, canConnect)
    setSelectedProfileId(nextProfileId)
  }

  async function handleProfileDraftDefault() {
    if (profileDraft.hidden) {
      setSettingsError('Hidden profiles cannot be used as the startup shell.')
      return
    }

    const nextProfileId = profileIdentifier(profileDraft)
    const nextDocument = {
      ...updateProfileDocument(settingsDocument, selectedProfileId, profileDraft),
      defaultProfile: nextProfileId,
    }

    await commitSettings(nextDocument, canConnect)
    setSelectedProfileId(nextProfileId)
  }

  function handleProfileDraftReset() {
    setProfileDraft(selectedProfile)
  }

  async function handleProfileCreate() {
    const nextProfile = createProfileDraft(profileCatalog)
    const nextDocument = updateProfileDocument(
      settingsDocument,
      profileIdentifier(nextProfile),
      nextProfile,
    )

    await commitSettings(nextDocument, canConnect)
    setSelectedProfileId(profileIdentifier(nextProfile))
  }

  async function handleProfileDuplicate() {
    const nextProfile = duplicateProfileDraft(selectedProfile, profileCatalog)
    const nextDocument = updateProfileDocument(
      settingsDocument,
      profileIdentifier(nextProfile),
      nextProfile,
    )

    await commitSettings(nextDocument, canConnect)
    setSelectedProfileId(profileIdentifier(nextProfile))
  }

  async function handleProfileDelete() {
    if (profileCatalog.length <= 1) {
      setSettingsError('At least one profile must remain available.')
      return
    }

    if (visibleProfileCount <= 1 && !selectedProfile.hidden) {
      setSettingsError('At least one visible profile must remain available.')
      return
    }

    const nextDocument = removeProfileDocument(settingsDocument, selectedProfileId, profileCatalog)
    const nextSettings = normalizeSettings(nextDocument)
    const nextProfileId =
      resolveProfile(nextSettings, nextSettings.defaultProfile).id ??
      profileIdentifier(nextSettings.profiles.list[0])

    await commitSettings(nextDocument, canConnect)
    setSelectedProfileId(nextProfileId)
  }

  async function handleThemeDraftSave() {
    const nextDocument = updateThemeDocument(settingsDocument, selectedThemeName, themeDraft)
    await commitSettings(nextDocument, canConnect)
    setSelectedThemeName(themeDraft.name)
  }

  async function handleThemeDraftApply() {
    const nextDocument = updateThemeSelectionDocument(
      updateThemeDocument(settingsDocument, selectedThemeName, themeDraft),
      settings.theme,
      uiAppearance,
      themeDraft.name,
    )

    await commitSettings(nextDocument, canConnect)
    setSelectedThemeName(themeDraft.name)
  }

  function handleThemeDraftReset() {
    setThemeDraft(selectedTheme)
  }

  async function handleThemeCreate() {
    const nextTheme = createThemeDraft(themeCatalog)
    const nextDocument = updateThemeDocument(settingsDocument, nextTheme.name, nextTheme)

    await commitSettings(nextDocument, canConnect)
    setSelectedThemeName(nextTheme.name)
  }

  async function handleThemeDuplicate() {
    const nextTheme = duplicateThemeDraft(selectedTheme, themeCatalog)
    const nextDocument = updateThemeDocument(settingsDocument, nextTheme.name, nextTheme)

    await commitSettings(nextDocument, canConnect)
    setSelectedThemeName(nextTheme.name)
  }

  async function handleThemeDelete() {
    if (themeCatalog.length <= 1) {
      setSettingsError('At least one theme must remain available.')
      return
    }

    const nextDocument = removeThemeDocument(settingsDocument, selectedThemeName, themeCatalog)
    const nextSettings = normalizeSettings(nextDocument)
    const nextThemeName =
      resolveThemeName(nextSettings.theme, uiAppearance) ??
      nextSettings.themes?.[0]?.name ??
      'Theme'

    await commitSettings(nextDocument, canConnect)
    setSelectedThemeName(nextThemeName)
  }

  function patchThemeDraft(patch: Partial<TerminalTheme>) {
    setThemeDraft((current) => ({ ...current, ...patch }))
  }

  function patchThemeWindow(patch: Partial<NonNullable<TerminalTheme['window']>>) {
    setThemeDraft((current) => ({
      ...current,
      window: {
        ...(current.window ?? {}),
        ...patch,
      },
    }))
  }

  function patchThemeTab(patch: Partial<NonNullable<TerminalTheme['tab']>>) {
    setThemeDraft((current) => ({
      ...current,
      tab: {
        ...(current.tab ?? {}),
        ...patch,
      },
    }))
  }

  function patchThemeTabRow(patch: Partial<NonNullable<TerminalTheme['tabRow']>>) {
    setThemeDraft((current) => ({
      ...current,
      tabRow: {
        ...(current.tabRow ?? {}),
        ...patch,
      },
    }))
  }

  function patchProfileDraft(patch: Partial<TerminalProfile>) {
    setProfileDraft((current) => ({ ...current, ...patch }))
  }

  function insertPromptToken(token: string) {
    setProfileDraft((current) => ({
      ...current,
      promptTemplate: `${current.promptTemplate ?? ''}${token}`,
    }))
  }

  function patchProfileFont(patch: Partial<NonNullable<TerminalProfile['font']>>) {
    setProfileDraft((current) => {
      const nextFont = {
        ...(current.font ?? {}),
        ...patch,
      }

      return {
        ...current,
        font: nextFont,
        fontFace: nextFont.face ?? current.fontFace,
        fontSize: nextFont.size ?? current.fontSize,
        fontWeight: nextFont.weight ?? current.fontWeight,
        cellHeight: nextFont.cellHeight ?? current.cellHeight,
      }
    })
  }

  async function handleSettingsSave() {
    try {
      await commitSettings(parseSettingsDraft(settingsDraft), canConnect)
    } catch {
      setSaveState('error')
      setSettingsError('The settings draft is not valid shared settings JSON.')
    }
  }

  function handleSettingsReset() {
    setSettingsError(null)
    setSaveState('idle')
    setSettingsDraft(formatSettingsJson(settingsDocument))
  }

  function toggleRail() {
    setIsRailCollapsed((current) => !current)
  }

  function revealSettings(section: SettingsSection) {
    openSettingsWorkspace(section)
  }

  const terminalWorkspace = (
    <div className={`workspace-grid workspace-grid-${currentTab.layout}`}>
      {visiblePaneSessions.map((session) => {
        const profile = resolveProfile(settings, session.profileId)
        const scheme = resolveScheme(settings, profile, uiAppearance)
        const viewportScheme = {
          ...scheme,
          background: applyColorOpacity(scheme.background, profile.opacity ?? 100),
        }
        const isFocusedPane = session.id === activeSessionId && activeWorkspace === 'terminal'

        return (
          <section
            key={`${session.id}-${canConnect ? 'live' : 'offline'}`}
            className={`pane-shell ${isFocusedPane ? 'is-active' : ''}`}
            aria-label={`${sessionTitle(session, profile)} pane`}
            style={
              {
                '--pane-terminal-bg': viewportScheme.background,
                '--pane-terminal-blur': profile.useAcrylic ? '18px' : '0px',
              } as CSSProperties
            }
            onMouseDown={() => activateSession(session.id)}
          >
            <div className="pane-frame" aria-hidden="true" />
            <TerminalViewport
              active={isFocusedPane}
              canConnect={canConnect}
              cursorShape={profile.cursorShape}
              fallbackLines={session.previewLines}
              fontFamily={resolveProfileFontFace(profile)}
              fontSize={resolveProfileFontSize(profile)}
              lineHeight={resolveProfileLineHeight(profile)}
              padding={resolveProfilePadding(profile)}
              onConnectionStateChange={handleConnectionStateChange}
              onShortcut={handleShortcut}
              onTranscriptChange={handleTranscriptChange}
              scheme={viewportScheme}
              sessionId={session.id}
            />
          </section>
        )
      })}
    </div>
  )

  const settingsWorkspace = (
    <section className="settings-workspace" aria-label="Settings">
      <div className="drawer-layout settings-layout">
        <nav className="drawer-nav settings-nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`drawer-nav-item ${activeSettingsSection === section.id ? 'is-active' : ''}`}
              onClick={() => setActiveSettingsSection(section.id)}
            >
              <span className="drawer-nav-item-icon" aria-hidden="true">
                <SettingsSectionIcon section={section.id} />
              </span>
              <span className="drawer-nav-item-copy">
                <strong>{section.label}</strong>
                <span>{section.meta}</span>
              </span>
            </button>
          ))}

          <article className="drawer-status-card" aria-label="Studio status">
            <span className="header-label">Studio</span>
            <strong>{settingsSectionMeta.label}</strong>
            <span>{settingsSectionMeta.meta}</span>
            <div className="status-row">
              <span className={`status-pill ${canConnect ? 'is-live' : 'subtle'}`}>
                {runtimeLabel}
              </span>
              <span className={`status-pill ${saveState === 'saved' ? 'is-live' : 'subtle'}`}>
                {saveLabel}
              </span>
            </div>
            <span>
              {activeTabLabel}
              {currentTab.paneIds.length > 1 ? ` · ${currentTab.paneIds.length} panes` : ''}
            </span>
            <span>{runtimeMessage}</span>
          </article>
        </nav>

        <div className="drawer-panel-stack">
          {activeSettingsSection === 'appearance' ? (
            <section className="drawer-panel">
              <div className="section-heading section-heading-with-actions">
                <div>
                  <strong>Theme Studio</strong>
                  <p>
                    Keep the shell black, the tab surfaces white, and the chrome flat while
                    editing the shared theme payload directly.
                  </p>
                </div>
                <div className="field-actions">
                  <button
                    type="button"
                    className="toolbar-button ghost"
                    onClick={() => void handleThemeCreate()}
                  >
                    New theme
                  </button>
                  <button
                    type="button"
                    className="toolbar-button ghost"
                    onClick={() => void handleThemeDuplicate()}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="toolbar-button ghost danger"
                    onClick={() => void handleThemeDelete()}
                    disabled={themeCatalog.length <= 1}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <section className="drawer-overview" aria-label="Appearance overview">
                <article className="summary-card">
                  <span className="header-label">Applied</span>
                  <strong>{themeName}</strong>
                  <span>{uiAppearance} shell</span>
                </article>
                <article className="summary-card">
                  <span className="header-label">Row</span>
                  <strong>{activeTheme?.tabRow?.background ?? '#efefef'}</strong>
                  <span>tab strip</span>
                </article>
                <article className="summary-card">
                  <span className="header-label">Surface</span>
                  <strong>{activeTheme?.tab?.background ?? '#ffffff'}</strong>
                  <span>{activeScheme.name}</span>
                </article>
              </section>

              <section className="drawer-section studio-layout">
                <div className="studio-list" aria-label="Themes">
                  {themeCatalog.map((theme) => {
                    const previewTheme = resolveUiTheme(
                      { ...settings, theme: theme.name },
                      activeProfile,
                      uiAppearance,
                    )
                    const isSelected = theme.name === selectedThemeName
                    const isApplied = theme.name === themeName

                    return (
                      <button
                        key={theme.name}
                        type="button"
                        className={`studio-list-item ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => setSelectedThemeName(theme.name)}
                      >
                        <span
                          className="studio-swatch"
                          style={
                            {
                              '--swatch-accent': previewTheme.tabActive,
                              '--swatch-muted': previewTheme.tabStrip,
                              '--swatch-shell': previewTheme.terminalBackground,
                            } as CSSProperties
                          }
                        />
                        <div className="studio-list-copy">
                          <strong>{theme.name}</strong>
                          <span>{isApplied ? 'active appearance' : 'saved appearance'}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="studio-form">
                  <div className="section-heading">
                    <strong>{themeDraft.name}</strong>
                    <p>
                      These fields write back to the shared `themes[]` payload and keep the shell
                      surface flat.
                    </p>
                  </div>

                  <div
                    className="theme-preview"
                    aria-hidden="true"
                    style={
                      {
                        '--theme-preview-frame': resolveColorReference(
                          themeDraft.window?.frame,
                          activeColorPalette,
                          '#d8d8d8',
                        ),
                        '--theme-preview-unfocused-frame': resolveColorReference(
                          themeDraft.window?.unfocusedFrame,
                          activeColorPalette,
                          '#cfcfcf',
                        ),
                      } as CSSProperties
                    }
                  >
                    <div
                      className="theme-preview-strip"
                      style={{
                        background: resolveColorReference(
                          themeDraft.tabRow?.background,
                          activeColorPalette,
                          '#efefef',
                        ),
                      }}
                    >
                      <span
                        className="theme-preview-tab is-active"
                        style={{
                          background: resolveColorReference(
                            themeDraft.tab?.background,
                            activeColorPalette,
                            '#ffffff',
                          ),
                        }}
                      >
                        selected
                      </span>
                      <span
                        className="theme-preview-tab"
                        style={{
                          background: resolveColorReference(
                            themeDraft.tab?.unfocusedBackground,
                            activeColorPalette,
                            '#f4f4f4',
                          ),
                        }}
                      >
                        idle
                      </span>
                    </div>
                    <div
                      className="theme-preview-terminal"
                      style={{
                        background: activeScheme.background,
                        color: activeScheme.foreground,
                      }}
                    >
                      {composePreviewCommand(
                        activeProfile,
                        normalizePromptCwd(activeSession.cwd),
                        'npm run build',
                      )}
                    </div>
                  </div>

                  <div className="field-grid field-grid-wide">
                    <label className="field-row field-row-span">
                      <span>Theme name</span>
                      <input
                        className="field-input"
                        value={themeDraft.name}
                        onChange={(event) => patchThemeDraft({ name: event.target.value })}
                      />
                    </label>

                    <label className="field-row">
                      <span>App appearance</span>
                      <select
                        className="field-input"
                        value={themeDraft.window?.applicationTheme ?? 'system'}
                        onChange={(event) =>
                          patchThemeWindow({
                            applicationTheme: event.target.value as
                              | 'system'
                              | 'dark'
                              | 'light',
                          })
                        }
                      >
                        <option value="system">system</option>
                        <option value="dark">dark</option>
                        <option value="light">light</option>
                      </select>
                    </label>

                    <ColorField
                      label="Active frame"
                      value={themeDraft.window?.frame}
                      fallback="#d8d8d8"
                      tokenPalette={activeColorPalette}
                      onChange={(nextColor) => patchThemeWindow({ frame: nextColor })}
                      tokens={CHROME_COLOR_TOKENS}
                    />

                    <ColorField
                      label="Inactive frame"
                      value={themeDraft.window?.unfocusedFrame}
                      fallback="#cfcfcf"
                      tokenPalette={activeColorPalette}
                      onChange={(nextColor) =>
                        patchThemeWindow({ unfocusedFrame: nextColor })
                      }
                      tokens={CHROME_COLOR_TOKENS}
                    />

                    <ColorField
                      label="Active tab"
                      value={themeDraft.tab?.background}
                      fallback="#ffffff"
                      tokenPalette={activeColorPalette}
                      onChange={(nextColor) => patchThemeTab({ background: nextColor })}
                      tokens={TAB_COLOR_TOKENS}
                    />

                    <ColorField
                      label="Inactive tab"
                      value={themeDraft.tab?.unfocusedBackground}
                      fallback="#f4f4f4"
                      tokenPalette={activeColorPalette}
                      onChange={(nextColor) =>
                        patchThemeTab({ unfocusedBackground: nextColor })
                      }
                      tokens={TAB_COLOR_TOKENS}
                    />

                    <ColorField
                      label="Tab strip"
                      value={themeDraft.tabRow?.background}
                      fallback="#efefef"
                      tokenPalette={activeColorPalette}
                      onChange={(nextColor) => patchThemeTabRow({ background: nextColor })}
                      tokens={CHROME_COLOR_TOKENS}
                    />

                    <ColorField
                      label="Strip inactive"
                      value={themeDraft.tabRow?.unfocusedBackground}
                      fallback="#e7e7e7"
                      tokenPalette={activeColorPalette}
                      onChange={(nextColor) =>
                        patchThemeTabRow({
                          unfocusedBackground: nextColor,
                        })
                      }
                      tokens={CHROME_COLOR_TOKENS}
                    />

                    <label className="field-row field-row-span">
                      <span>Close button</span>
                      <select
                        className="field-input"
                        value={themeDraft.tab?.showCloseButton ?? 'hover'}
                        onChange={(event) =>
                          patchThemeTab({
                            showCloseButton: event.target.value as
                              | 'always'
                              | 'hover'
                              | 'never'
                              | 'activeOnly',
                          })
                        }
                      >
                        <option value="hover">hover</option>
                        <option value="activeOnly">active only</option>
                        <option value="always">always</option>
                        <option value="never">never</option>
                      </select>
                    </label>

                    <label className="field-row field-row-toggle">
                      <span>Mica tint</span>
                      <input
                        type="checkbox"
                        checked={themeDraft.window?.useMica ?? false}
                        onChange={(event) =>
                          patchThemeWindow({ useMica: event.target.checked })
                        }
                      />
                    </label>
                  </div>

                  <div className="field-actions">
                    <button
                      type="button"
                      className="toolbar-button"
                      onClick={() => void handleThemeDraftSave()}
                    >
                      Save theme
                    </button>
                    <button
                      type="button"
                      className="toolbar-button ghost"
                      onClick={() => void handleThemeDraftApply()}
                    >
                      Use on this shell
                    </button>
                    <button
                      type="button"
                      className="toolbar-button ghost"
                      onClick={handleThemeDraftReset}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </section>
            </section>
          ) : null}

          {activeSettingsSection === 'profiles' ? (
            <section className="drawer-panel">
              <div className="section-heading section-heading-with-actions">
                <div>
                  <strong>Profile Studio</strong>
                  <p>
                    Edit launch command, prompt template, and terminal font behavior
                    without leaving the shell.
                  </p>
                </div>
                <div className="field-actions">
                  <button
                    type="button"
                    className="toolbar-button ghost"
                    onClick={() => void handleProfileCreate()}
                  >
                    New profile
                  </button>
                  <button
                    type="button"
                    className="toolbar-button ghost"
                    onClick={() => void handleProfileDuplicate()}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="toolbar-button ghost danger"
                    onClick={() => void handleProfileDelete()}
                    disabled={profileCatalog.length <= 1}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <section className="drawer-section studio-layout">
                <div className="studio-list" aria-label="Profiles">
                  {profileCatalog.map((profile) => {
                    const isSelected = profile.id === selectedProfileId
                    const isDefault = profile.id === defaultProfile.id

                    return (
                      <button
                        key={profile.id}
                        type="button"
                        className={`studio-list-item ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => setSelectedProfileId(profile.id)}
                      >
                        <ProfileGlyph profile={profile} compact />
                        <div className="studio-list-copy">
                          <strong>{profile.name}</strong>
                          <span>{profile.commandline ?? 'default shell'}</span>
                        </div>
                        <span className="profile-badge">
                          {isDefault ? 'default' : profile.hidden ? 'hidden' : 'live'}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="studio-form">
                  <div className="section-heading">
                    <strong>{profileDraft.name}</strong>
                    <p className="prompt-preview-label">
                      {promptPrefixForProfile(
                        profileDraft,
                        normalizePromptCwd(profileDraft.startingDirectory ?? '~'),
                      )}
                    </p>
                  </div>

                  <section className="profile-preview" aria-label="Profile preview">
                    <div className="profile-preview-header">
                      <div className="profile-preview-identity">
                        <ProfileGlyph profile={profileDraft} />
                        <div className="profile-preview-copy">
                          <strong>{profileDraft.name}</strong>
                          <span>{profileDraft.commandline ?? 'default shell'}</span>
                        </div>
                      </div>
                      <span className="profile-badge">
                        {profileDraft.hidden
                          ? 'hidden'
                          : selectedProfileId === defaultProfile.id
                            ? 'default'
                            : 'ready'}
                      </span>
                    </div>

                    <div
                      className="profile-preview-terminal"
                      style={{
                        background: draftColorPalette.terminalBackground,
                        color: draftColorPalette.terminalForeground,
                      }}
                    >
                      <span>
                        {composePreviewCommand(
                          profileDraft,
                          normalizePromptCwd(profileDraft.startingDirectory ?? '~'),
                          'git status',
                        )}
                      </span>
                      <span>On branch main</span>
                    </div>

                    <div className="profile-preview-swatches" aria-hidden="true">
                      <span
                        className="profile-preview-chip"
                        style={{ '--preview-color': draftColorPalette.accent } as CSSProperties}
                      >
                        tab
                      </span>
                      <span
                        className="profile-preview-chip"
                        style={{ '--preview-color': draftColorPalette.terminalForeground } as CSSProperties}
                      >
                        text
                      </span>
                      <span
                        className="profile-preview-chip"
                        style={{ '--preview-color': draftColorPalette.cursorColor } as CSSProperties}
                      >
                        cursor
                      </span>
                      <span
                        className="profile-preview-chip"
                        style={{ '--preview-color': draftColorPalette.selectionBackground } as CSSProperties}
                      >
                        selection
                      </span>
                    </div>
                  </section>

                  <div className="field-grid field-grid-wide">
                    <label className="field-row">
                      <span>Profile name</span>
                      <input
                        className="field-input"
                        value={profileDraft.name}
                        onChange={(event) => patchProfileDraft({ name: event.target.value })}
                      />
                    </label>

                    <label className="field-row">
                      <span>Icon or badge</span>
                      <input
                        className="field-input"
                        value={profileDraft.icon ?? ''}
                        placeholder="PS"
                        onChange={(event) => patchProfileDraft({ icon: event.target.value })}
                      />
                    </label>

                    <label className="field-row field-row-span">
                      <span>Command line</span>
                      <input
                        className="field-input"
                        value={profileDraft.commandline ?? ''}
                        placeholder="pwsh.exe"
                        onChange={(event) =>
                          patchProfileDraft({ commandline: event.target.value })
                        }
                      />
                    </label>

                    <label className="field-row field-row-span">
                      <span>Starting directory</span>
                      <input
                        className="field-input"
                        value={profileDraft.startingDirectory ?? ''}
                        placeholder="%USERPROFILE%"
                        onChange={(event) =>
                          patchProfileDraft({ startingDirectory: event.target.value })
                        }
                      />
                    </label>

                    <label className="field-row field-row-span">
                      <span>Prompt template</span>
                      <input
                        className="field-input"
                        value={profileDraft.promptTemplate ?? ''}
                        placeholder="{user}@{host}:{cwd}{symbol} "
                        onChange={(event) =>
                          patchProfileDraft({ promptTemplate: event.target.value })
                        }
                      />
                      <span className="field-help">
                        Use tokens to keep the shell prompt profile-aware without falling back to
                        a generic prefix.
                      </span>
                      <div className="field-token-row">
                        {PROMPT_TEMPLATE_TOKENS.map((token) => (
                          <button
                            key={token}
                            type="button"
                            className={`field-token ${
                              (profileDraft.promptTemplate ?? '').includes(token) ? 'is-active' : ''
                            }`}
                            onClick={() => insertPromptToken(token)}
                          >
                            {token}
                          </button>
                        ))}
                      </div>
                    </label>

                    <label className="field-row">
                      <span>Tab title</span>
                      <input
                        className="field-input"
                        value={profileDraft.tabTitle ?? ''}
                        placeholder="Admin"
                        onChange={(event) => patchProfileDraft({ tabTitle: event.target.value })}
                      />
                    </label>

                    <ColorField
                      label="Tab accent"
                      value={profileDraft.tabColor}
                      fallback="#3b78ff"
                      tokenPalette={draftColorPalette}
                      onChange={(nextColor) => patchProfileDraft({ tabColor: nextColor })}
                      tokens={PROFILE_ACCENT_TOKENS}
                    />

                    <label className="field-row">
                      <span>Color scheme</span>
                      <select
                        className="field-input"
                        value={selectedProfileSchemeName}
                        onChange={(event) =>
                          patchProfileDraft({ colorScheme: event.target.value })
                        }
                      >
                        {(settings.schemes ?? []).map((scheme) => (
                          <option key={scheme.name} value={scheme.name}>
                            {scheme.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-row">
                      <span>Font face</span>
                      <input
                        className="field-input"
                        value={resolveProfileFontFace(profileDraft)}
                        placeholder="Cascadia Mono"
                        onChange={(event) => patchProfileFont({ face: event.target.value })}
                      />
                    </label>

                    <label className="field-row">
                      <span>Font size</span>
                      <input
                        type="number"
                        className="field-input"
                        value={resolveProfileFontSize(profileDraft)}
                        onChange={(event) =>
                          patchProfileFont({
                            size: readOptionalNumber(event.target.value),
                          })
                        }
                      />
                    </label>

                    <label className="field-row">
                      <span>Line height</span>
                      <input
                        type="number"
                        step="0.01"
                        className="field-input"
                        value={profileDraft.lineHeight ?? ''}
                        onChange={(event) =>
                          patchProfileDraft({
                            lineHeight: readOptionalNumber(event.target.value),
                          })
                        }
                      />
                    </label>

                    <label className="field-row">
                      <span>Cursor shape</span>
                      <select
                        className="field-input"
                        value={profileDraft.cursorShape ?? 'bar'}
                        onChange={(event) =>
                          patchProfileDraft({
                            cursorShape: event.target.value as TerminalProfile['cursorShape'],
                          })
                        }
                      >
                        <option value="bar">bar</option>
                        <option value="block">block</option>
                        <option value="filledBox">filled box</option>
                        <option value="emptyBox">empty box</option>
                        <option value="doubleUnderscore">double underscore</option>
                        <option value="underline">underline</option>
                        <option value="underscore">underscore</option>
                        <option value="vintage">vintage</option>
                      </select>
                    </label>

                    <RangeField
                      label="Opacity"
                      min={0}
                      max={100}
                      value={profileDraft.opacity ?? 100}
                      onChange={(nextValue) =>
                        patchProfileDraft({
                          opacity: nextValue,
                        })
                      }
                    />

                    <ColorField
                      label="Shell background"
                      value={profileDraft.background}
                      fallback={profileDraftScheme.background}
                      tokenPalette={draftColorPalette}
                      onChange={(nextColor) => patchProfileDraft({ background: nextColor })}
                      tokens={CHROME_COLOR_TOKENS}
                    />

                    <ColorField
                      label="Shell text"
                      value={profileDraft.foreground}
                      fallback={profileDraftScheme.foreground}
                      tokenPalette={draftColorPalette}
                      onChange={(nextColor) => patchProfileDraft({ foreground: nextColor })}
                      tokens={TEXT_COLOR_TOKENS}
                    />

                    <ColorField
                      label="Cursor"
                      value={profileDraft.cursorColor}
                      fallback={profileDraftScheme.cursorColor ?? '#ffffff'}
                      tokenPalette={draftColorPalette}
                      onChange={(nextColor) => patchProfileDraft({ cursorColor: nextColor })}
                      tokens={CURSOR_COLOR_TOKENS}
                    />

                    <ColorField
                      label="Selection"
                      value={profileDraft.selectionBackground}
                      fallback={profileDraftScheme.selectionBackground ?? '#264f78'}
                      tokenPalette={draftColorPalette}
                      onChange={(nextColor) =>
                        patchProfileDraft({ selectionBackground: nextColor })
                      }
                      tokens={SELECTION_COLOR_TOKENS}
                    />

                    <label className="field-row field-row-toggle">
                      <span>Acrylic blur</span>
                      <input
                        type="checkbox"
                        checked={profileDraft.useAcrylic ?? false}
                        onChange={(event) =>
                          patchProfileDraft({ useAcrylic: event.target.checked })
                        }
                      />
                    </label>

                    <label className="field-row field-row-toggle">
                      <span>Hidden</span>
                      <input
                        type="checkbox"
                        checked={profileDraft.hidden ?? false}
                        disabled={visibleProfileCount <= 1 && !selectedProfile.hidden}
                        onChange={(event) => patchProfileDraft({ hidden: event.target.checked })}
                      />
                    </label>
                  </div>

                  <div className="field-actions">
                    <button
                      type="button"
                      className="toolbar-button"
                      onClick={() => void handleProfileDraftSave()}
                    >
                      Save profile
                    </button>
                    <button
                      type="button"
                      className="toolbar-button ghost"
                      onClick={() => void createSession(selectedProfileId)}
                      disabled={profileDraft.hidden === true}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="toolbar-button ghost"
                      onClick={() => void handleProfileDraftDefault()}
                      disabled={profileDraft.hidden === true}
                    >
                      Use at startup
                    </button>
                    <button
                      type="button"
                      className="toolbar-button ghost"
                      onClick={handleProfileDraftReset}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </section>
            </section>
          ) : null}

          {activeSettingsSection === 'json' ? (
            <section className="drawer-panel studio-editor">
              <div className="section-heading">
                <strong>settings.json</strong>
                <p>
                  Comments and trailing commas stay valid in the editor, and unknown keys
                  continue to round-trip.
                </p>
              </div>

              <textarea
                className="settings-editor"
                spellCheck={false}
                value={settingsDraft}
                onChange={(event) => {
                  setSettingsDraft(event.target.value)
                  setSettingsError(null)
                  if (saveState !== 'saving') {
                    setSaveState('idle')
                  }
                }}
              />

              {settingsError ? <p className="settings-error">{settingsError}</p> : null}

              <div className="editor-actions">
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => void handleSettingsSave()}
                  disabled={!isDraftDirty}
                >
                  Save settings
                </button>
                <button
                  type="button"
                  className="toolbar-button ghost"
                  onClick={handleSettingsReset}
                >
                  Reset draft
                </button>
              </div>
            </section>
          ) : null}

          {activeSettingsSection === 'shortcuts' ? (
            <section className="drawer-panel">
              <div className="section-heading">
                <strong>Shortcuts</strong>
                <p>
                  Resolved from the shared `actions[]` payload, including object-form commands.
                </p>
              </div>

              <section className="shortcut-list" aria-label="Keyboard shortcuts">
                {shortcutSummary.map((shortcut) => (
                  <article key={`${shortcut.command}-${shortcut.keys}`} className="shortcut-row">
                    <strong>{shortcut.command}</strong>
                    <span className="shortcut-pill">{shortcut.keys}</span>
                  </article>
                ))}
              </section>
            </section>
          ) : null}
        </div>
      </div>
    </section>
  )

  return (
    <main className="terminal-app" style={themeVars(uiTheme)}>
      <section
        className={`terminal-shell ${isRailCollapsed ? 'is-rail-collapsed' : ''}`}
        data-rail-collapsed={isRailCollapsed}
      >
        <section className="viewport-stage" aria-label="Terminal workspace">
          <div
            className={`terminal-stage ${activeWorkspace === 'settings' ? 'is-settings-workspace' : ''}`}
          >
            {activeWorkspace === 'settings' ? settingsWorkspace : terminalWorkspace}
          </div>
        </section>

        <aside
          className={`session-rail ${isRailCollapsed ? 'is-collapsed' : ''}`}
          data-close-mode={closeButtonMode}
          aria-label="Session rail"
        >
          <div className="rail-head">
            <button
              type="button"
              className="rail-toggle"
              aria-label={isRailCollapsed ? 'Show session rail' : 'Hide session rail'}
              onClick={toggleRail}
              title={isRailCollapsed ? 'Show session rail' : 'Hide session rail'}
            >
              <RailToggleIcon collapsed={isRailCollapsed} />
            </button>

            <button
              type="button"
              className={`rail-action rail-action-settings ${
                activeWorkspace === 'settings' ? 'is-active' : ''
              }`}
              aria-label="Open settings"
              title="Open settings"
              onClick={() => revealSettings('appearance')}
            >
              <SettingsGlyph />
            </button>
          </div>

          <div className="rail-list" role="tablist" aria-label="Workspaces">
            {isSettingsOpen ? (
              <div className={`rail-tab-shell ${activeWorkspace === 'settings' ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="rail-tab rail-tab-settings"
                  role="tab"
                  aria-selected={activeWorkspace === 'settings'}
                  aria-label="Settings tab"
                  title={settingsSectionMeta.label}
                  onClick={() => setActiveWorkspace('settings')}
                >
                  <span className="rail-tab-status rail-tab-status-settings" />
                  <span className="rail-tab-icon">
                    <SettingsGlyph />
                  </span>
                  <span className="rail-tab-copy">settings</span>
                </button>

                {closeButtonMode !== 'never' ? (
                  <button
                    type="button"
                    className="rail-tab-close"
                    onClick={closeSettingsWorkspace}
                    aria-label="Close settings"
                  >
                    <CloseGlyph />
                  </button>
                ) : null}
              </div>
            ) : null}

            {tabs.map((tab) => {
              const primarySession =
                sessions.find((session) => session.id === tab.paneIds[0]) ?? activeSession
              const profile = resolveProfile(settings, primarySession.profileId)
              const tabLabel = tabLabelForTab(tab, sessions, settings)
              const isActive = activeWorkspace === 'terminal' && tab.id === currentTab.id

              return (
                <div
                  key={tab.id}
                  className={`rail-tab-shell ${isActive ? 'is-active' : ''}`}
                  style={{ '--rail-accent': profile.tabColor ?? uiTheme.accent } as CSSProperties}
                >
                  <button
                    type="button"
                    className="rail-tab"
                    role="tab"
                    aria-selected={isActive}
                    aria-label={`${tabLabel} tab`}
                    title={`${tabLabel} · ${profile.name}`}
                    onClick={() => activateSession(tab.paneIds[0])}
                  >
                    <span
                      className={`rail-tab-status rail-tab-status-${primarySession.status}`}
                    />
                    <span className="rail-tab-icon">
                      <ProfileGlyph profile={profile} compact />
                    </span>
                    <span className="rail-tab-copy">{tabLabel}</span>
                    {tab.paneIds.length > 1 ? (
                      <span className="rail-tab-meta">{tab.paneIds.length}</span>
                    ) : null}
                  </button>

                  {closeButtonMode !== 'never' ? (
                    <button
                      type="button"
                      className="rail-tab-close"
                      onClick={() => void closeTab(tab.id)}
                      aria-label={`Close ${tabLabel}`}
                    >
                      <CloseGlyph />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="rail-footer">
            <button
              type="button"
              className="rail-action is-primary"
              aria-label="New tab"
              title="New tab"
              onClick={() => void createSession()}
            >
              <NewTabGlyph />
            </button>
            <button
              type="button"
              className="rail-action"
              aria-label="Split vertical"
              title="Split vertical"
              disabled={!canSplitActiveTab}
              onClick={() => void createSession(activeProfile.id, 'vertical')}
            >
              <SplitVerticalGlyph />
            </button>
            <button
              type="button"
              className="rail-action"
              aria-label="Split horizontal"
              title="Split horizontal"
              disabled={!canSplitActiveTab}
              onClick={() => void createSession(activeProfile.id, 'horizontal')}
            >
              <SplitHorizontalGlyph />
            </button>
            <button
              type="button"
              className={`rail-action ${activeWorkspace === 'settings' ? 'is-active' : ''}`}
              aria-label="Edit settings.json"
              title="Edit settings.json"
              onClick={() => revealSettings('json')}
            >
              <CodeGlyph />
            </button>
          </div>
        </aside>
      </section>
    </main>
  )
}

interface ColorFieldProps {
  label: string
  value: string | undefined
  fallback: string
  onChange: (nextColor: string) => void
  tokens?: readonly string[]
  tokenPalette?: ColorReferencePalette
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
  tokens = [],
  tokenPalette,
}: ColorFieldProps) {
  const previewValue = tokenPalette ? resolveColorReference(value, tokenPalette, fallback) : value
  const swatchValue = resolveColorInputValue(previewValue, fallback)

  return (
    <label className="field-row color-field">
      <span>{label}</span>
      <div className="color-input-row">
        <input
          className="field-input"
          value={value ?? ''}
          placeholder={fallback}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="field-color-shell">
          <span
            className="field-color-chip"
            style={{ '--field-color': swatchValue } as CSSProperties}
            aria-hidden="true"
          />
          <input
            type="color"
            className="field-color"
            value={swatchValue}
            aria-label={`${label} color picker`}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      </div>
      {tokens.length > 0 ? (
        <div className="field-token-row">
          {tokens.map((token) => (
            <button
              key={token}
              type="button"
              className={`field-token ${value === token ? 'is-active' : ''}`}
              onClick={() => onChange(token)}
            >
              {token}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  )
}

interface RangeFieldProps {
  label: string
  min: number
  max: number
  value: number
  onChange: (nextValue: number) => void
}

function RangeField({ label, min, max, value, onChange }: RangeFieldProps) {
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : max))

  return (
    <label className="field-row">
      <span>{label}</span>
      <div className="range-input-row">
        <input
          type="range"
          className="field-range"
          min={min}
          max={max}
          value={clamped}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          type="number"
          min={min}
          max={max}
          className="field-input field-input-compact"
          value={clamped}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </label>
  )
}

function normalizeHealth(payload: unknown): ServerHealth {
  if (!isRecord(payload)) {
    return demoHealth
  }

  return {
    status: asString(payload.status, demoHealth.status),
    message: asString(payload.message, demoHealth.message),
    websocketPath: asString(
      payload.websocketPath ?? payload.websocket_path,
      demoHealth.websocketPath,
    ),
    mode: asString(payload.mode, demoHealth.mode),
    features: asStringArray(payload.features, demoHealth.features),
  }
}

function normalizeSettings(payload: unknown): TerminalSettings {
  if (!isRecord(payload) || !isRecord(payload.profiles) || !Array.isArray(payload.profiles.list)) {
    return demoSettings
  }

  const rawProfiles = payload.profiles.list
    .map((profile) => normalizeProfile(profile))
    .filter((profile): profile is TerminalProfile => profile !== null)

  const normalized: TerminalSettings = {
    $schema: asOptionalString(payload.$schema),
    defaultProfile: asString(
      payload.defaultProfile ?? payload.default_profile,
      demoSettings.defaultProfile,
    ),
    copyFormatting:
      payload.copyFormatting === 'none' ||
      payload.copyFormatting === 'html' ||
      payload.copyFormatting === 'all'
        ? payload.copyFormatting
        : demoSettings.copyFormatting,
    theme: normalizeThemeSelection(payload.theme) ?? demoSettings.theme,
    themes: Array.isArray(payload.themes)
      ? payload.themes
          .filter(isRecord)
          .map((theme) => ({
            name: asString(theme.name, 'Theme'),
            window: isRecord(theme.window)
              ? {
                  applicationTheme:
                    theme.window.applicationTheme === 'light' ||
                    theme.window.applicationTheme === 'dark' ||
                    theme.window.applicationTheme === 'system'
                      ? theme.window.applicationTheme
                      : undefined,
                  useMica: asOptionalBoolean(theme.window.useMica),
                  frame: asOptionalString(theme.window.frame),
                  unfocusedFrame: asOptionalString(theme.window.unfocusedFrame),
                }
              : undefined,
            tab: isRecord(theme.tab)
              ? {
                  background: asOptionalString(theme.tab.background),
                  showCloseButton:
                    theme.tab.showCloseButton === 'always' ||
                    theme.tab.showCloseButton === 'hover' ||
                    theme.tab.showCloseButton === 'never' ||
                    theme.tab.showCloseButton === 'activeOnly'
                      ? theme.tab.showCloseButton
                      : undefined,
                  unfocusedBackground: asOptionalString(theme.tab.unfocusedBackground),
                }
              : undefined,
            tabRow: isRecord(theme.tabRow)
              ? {
                  background: asOptionalString(theme.tabRow.background),
                  unfocusedBackground: asOptionalString(theme.tabRow.unfocusedBackground),
                }
              : undefined,
          }))
      : demoSettings.themes,
    actions: Array.isArray(payload.actions)
      ? payload.actions
          .filter(isRecord)
          .map((action) => ({
            command: asOptionalActionCommand(action.command),
            name: asOptionalString(action.name),
            keys: asStringArray(action.keys, []),
          }))
      : demoSettings.actions,
    profiles: {
      defaults: isRecord(payload.profiles.defaults)
        ? normalizeProfileDefaults(payload.profiles.defaults)
        : demoSettings.profiles.defaults,
      list: rawProfiles.length > 0 ? rawProfiles : demoSettings.profiles.list,
    },
    schemes: Array.isArray(payload.schemes)
      ? payload.schemes
          .filter(isRecord)
          .map((scheme) => ({
            name: asString(scheme.name, 'Custom'),
            background: asString(scheme.background, '#0c0c0c'),
            foreground: asString(scheme.foreground, '#f2f2f2'),
            cursorColor: asOptionalString(scheme.cursorColor),
            selectionBackground: asOptionalString(scheme.selectionBackground),
            black: asOptionalString(scheme.black),
            red: asOptionalString(scheme.red),
            green: asOptionalString(scheme.green),
            yellow: asOptionalString(scheme.yellow),
            blue: asOptionalString(scheme.blue),
            purple: asOptionalString(scheme.purple),
            cyan: asOptionalString(scheme.cyan),
            white: asOptionalString(scheme.white),
            brightBlack: asOptionalString(scheme.brightBlack),
            brightRed: asOptionalString(scheme.brightRed),
            brightGreen: asOptionalString(scheme.brightGreen),
            brightYellow: asOptionalString(scheme.brightYellow),
            brightBlue: asOptionalString(scheme.brightBlue),
            brightPurple: asOptionalString(scheme.brightPurple),
            brightCyan: asOptionalString(scheme.brightCyan),
            brightWhite: asOptionalString(scheme.brightWhite),
          }))
      : demoSettings.schemes,
  }

  return ensureLaunchableDefaultProfile(normalized)
}

function normalizeSessions(payload: unknown): SessionItem[] {
  const source = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.sessions)
      ? payload.sessions
      : []

  return source
    .map((session) => normalizeSession(session))
    .filter((session): session is SessionItem => session !== null)
}

function normalizeCreatedSession(payload: unknown): SessionItem | null {
  if (!isRecord(payload)) {
    return null
  }

  return normalizeSession(payload.session ?? payload)
}

function normalizeSession(payload: unknown): SessionItem | null {
  if (!isRecord(payload)) {
    return null
  }

  const previewLines = Array.isArray(payload.previewLines ?? payload.preview_lines)
    ? asStringArray(payload.previewLines ?? payload.preview_lines, [])
    : []

  return {
    id: asString(payload.id, ''),
    title: asString(payload.title, 'terminal'),
    profileId: asString(payload.profileId ?? payload.profile_id, demoSettings.defaultProfile),
    status: normalizeStatus(payload.status),
    hasActivity: Boolean(payload.hasActivity ?? payload.has_activity),
    lastUsedLabel: asString(payload.lastUsedLabel ?? payload.last_used_label, 'Recent'),
    cwd: asString(payload.cwd, '~'),
    previewLines,
  }
}

function ensureLaunchableDefaultProfile(settings: TerminalSettings): TerminalSettings {
  const launchableProfile =
    settings.profiles.list.find((profile) => profileIdentifier(profile) === settings.defaultProfile && !profile.hidden) ??
    settings.profiles.list.find((profile) => !profile.hidden) ??
    settings.profiles.list[0]

  return {
    ...settings,
    defaultProfile: profileIdentifier(launchableProfile),
  }
}

function normalizeProfile(payload: unknown): TerminalProfile | null {
  if (!isRecord(payload)) {
    return null
  }

  const webpty = isRecord(payload.webpty) ? payload.webpty : undefined
  const font = isRecord(payload.font) ? normalizeFont(payload.font) : undefined

  return {
    id: asOptionalString(payload.id),
    guid: asOptionalString(payload.guid),
    name: asString(payload.name, 'Profile'),
    icon: asOptionalString(payload.icon),
    promptTemplate: asOptionalString(
      webpty?.prompt ?? payload.promptTemplate ?? payload.prompt_template,
    ),
    commandline: asOptionalString(payload.commandline),
    startingDirectory: asOptionalString(payload.startingDirectory ?? payload.starting_directory),
    source: asOptionalString(payload.source),
    hidden: asOptionalBoolean(payload.hidden),
    tabColor: asOptionalString(payload.tabColor ?? payload.tab_color),
    tabTitle: asOptionalString(payload.tabTitle ?? payload.tab_title),
    colorScheme: normalizeSchemeSelection(payload.colorScheme ?? payload.color_scheme),
    font,
    fontFace: asOptionalString(payload.fontFace ?? payload.font_face) ?? font?.face,
    fontSize: asOptionalNumber(payload.fontSize ?? payload.font_size) ?? font?.size,
    fontWeight: asOptionalNumberOrString(payload.fontWeight ?? payload.font_weight) ?? font?.weight,
    cellHeight: asOptionalNumber(payload.cellHeight ?? payload.cell_height) ?? font?.cellHeight,
    lineHeight: asOptionalNumber(payload.lineHeight ?? payload.line_height),
    cursorShape: asOptionalString(payload.cursorShape ?? payload.cursor_shape) as
      | TerminalProfile['cursorShape']
      | undefined,
    opacity: asOptionalNumber(payload.opacity),
    useAcrylic: asOptionalBoolean(payload.useAcrylic ?? payload.use_acrylic),
    foreground: asOptionalString(payload.foreground),
    background: asOptionalString(payload.background),
    cursorColor: asOptionalString(payload.cursorColor ?? payload.cursor_color),
    selectionBackground: asOptionalString(
      payload.selectionBackground ?? payload.selection_background,
    ),
    padding:
      typeof payload.padding === 'string' || typeof payload.padding === 'number'
        ? payload.padding
        : undefined,
  }
}

function normalizeProfileDefaults(payload: Record<string, unknown>) {
  const font = isRecord(payload.font) ? normalizeFont(payload.font) : undefined

  return {
    font,
    fontFace: asOptionalString(payload.fontFace ?? payload.font_face) ?? font?.face,
    fontSize: asOptionalNumber(payload.fontSize ?? payload.font_size) ?? font?.size,
    fontWeight: asOptionalNumberOrString(payload.fontWeight ?? payload.font_weight) ?? font?.weight,
    cellHeight: asOptionalNumber(payload.cellHeight ?? payload.cell_height) ?? font?.cellHeight,
    lineHeight: asOptionalNumber(payload.lineHeight ?? payload.line_height),
    cursorShape: asOptionalString(payload.cursorShape ?? payload.cursor_shape) as
      | TerminalProfile['cursorShape']
      | undefined,
    opacity: asOptionalNumber(payload.opacity),
    useAcrylic: asOptionalBoolean(payload.useAcrylic ?? payload.use_acrylic),
    foreground: asOptionalString(payload.foreground),
    background: asOptionalString(payload.background),
    cursorColor: asOptionalString(payload.cursorColor ?? payload.cursor_color),
    selectionBackground: asOptionalString(
      payload.selectionBackground ?? payload.selection_background,
    ),
    padding:
      typeof payload.padding === 'string' || typeof payload.padding === 'number'
        ? payload.padding
        : undefined,
  }
}

function normalizeFont(payload: Record<string, unknown>) {
  return {
    face: asOptionalString(payload.face),
    size: asOptionalNumber(payload.size),
    weight: asOptionalNumberOrString(payload.weight),
    cellHeight: asOptionalNumber(payload.cellHeight ?? payload.cell_height),
  }
}

function normalizeThemeSelection(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (!isRecord(value)) {
    return undefined
  }

  return {
    dark: asOptionalString(value.dark),
    light: asOptionalString(value.light),
    system: asOptionalString(value.system),
  }
}

function normalizeSchemeSelection(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (!isRecord(value)) {
    return undefined
  }

  return {
    dark: asOptionalString(value.dark),
    light: asOptionalString(value.light),
  }
}

function normalizeStatus(value: unknown): SessionItem['status'] {
  return value === 'idle' || value === 'attention' ? value : 'running'
}

function tabIdForSession(sessionId: string) {
  return `tab-${sessionId}`
}

function buildTabsFromSessions(sessions: SessionItem[]): WorkspaceTab[] {
  if (sessions.length === 0) {
    return []
  }

  return sessions.map((session) => ({
    id: tabIdForSession(session.id),
    paneIds: [session.id],
    layout: 'single',
  }))
}

function syncTabsWithSessions(tabs: WorkspaceTab[], sessions: SessionItem[]): WorkspaceTab[] {
  const sessionIds = new Set(sessions.map((session) => session.id))
  const claimedPaneIds = new Set<string>()
  const nextTabs = tabs
    .map((tab) => {
      const paneIds = tab.paneIds.filter((paneId) => {
        if (!sessionIds.has(paneId) || claimedPaneIds.has(paneId)) {
          return false
        }

        claimedPaneIds.add(paneId)
        return true
      })

      if (paneIds.length === 0) {
        return null
      }

      return {
        ...tab,
        paneIds,
        layout: paneIds.length > 1 ? tab.layout : 'single',
      }
    })
    .filter((tab): tab is WorkspaceTab => tab !== null)

  const orphanSessions = sessions.filter((session) => !claimedPaneIds.has(session.id))

  return [
    ...nextTabs,
    ...orphanSessions.map((session) => ({
      id: tabIdForSession(session.id),
      paneIds: [session.id],
      layout: 'single' as const,
    })),
  ]
}

function findTabByPaneId(tabs: WorkspaceTab[], paneId: string) {
  return tabs.find((tab) => tab.paneIds.includes(paneId))
}

function appendSessionToTabs(
  tabs: WorkspaceTab[],
  activeTabId: string,
  sessionId: string,
  mode: PaneLayout,
): WorkspaceTab[] {
  if (mode === 'single' || tabs.length === 0) {
    return [
      ...tabs,
      {
        id: tabIdForSession(sessionId),
        paneIds: [sessionId],
        layout: 'single',
      },
    ]
  }

  const targetTab = tabs.find((tab) => tab.id === activeTabId)
  if (!targetTab || targetTab.paneIds.length !== 1) {
    return [
      ...tabs,
      {
        id: tabIdForSession(sessionId),
        paneIds: [sessionId],
        layout: 'single',
      },
    ]
  }

  return tabs.map((tab) => {
    if (tab.id !== activeTabId || tab.paneIds.includes(sessionId)) {
      return tab
    }

    return {
      ...tab,
      layout: mode,
      paneIds: [...tab.paneIds, sessionId],
    }
  })
}

function removeSessionFromTabs(tabs: WorkspaceTab[], sessionId: string): WorkspaceTab[] {
  return tabs
    .map((tab) => {
      const paneIds = tab.paneIds.filter((paneId) => paneId !== sessionId)

      if (paneIds.length === 0) {
        return null
      }

      return {
        ...tab,
        paneIds,
        layout: paneIds.length > 1 ? tab.layout : 'single',
      }
    })
    .filter((tab): tab is WorkspaceTab => tab !== null)
}

function preferredActiveSessionId(
  tabs: WorkspaceTab[],
  activeTabId: string,
  sessions: SessionItem[],
  removedSessionId: string,
) {
  const sameTab = tabs.find((tab) => tab.id === activeTabId)

  if (sameTab?.paneIds[0]) {
    return sameTab.paneIds[0]
  }

  if (tabs[0]?.paneIds[0]) {
    return tabs[0].paneIds[0]
  }

  return sessions.find((session) => session.id !== removedSessionId)?.id ?? removedSessionId
}

function tabLabelForTab(
  tab: WorkspaceTab,
  sessions: SessionItem[],
  settings: TerminalSettings,
) {
  const primarySession = sessions.find((session) => session.id === tab.paneIds[0])

  if (!primarySession) {
    return 'terminal'
  }

  const primaryProfile = resolveProfile(settings, primarySession.profileId)
  const primaryLabel = sessionTitle(primarySession, primaryProfile)

  return tab.paneIds.length > 1 ? `${primaryLabel} +${tab.paneIds.length - 1}` : primaryLabel
}

function createFallbackSession(
  profileId: string,
  cwd: string,
  settings: TerminalSettings,
  nextSessionIdRef: MutableRefObject<number>,
): SessionItem {
  const profile = resolveProfile(settings, profileId)
  const displayCwd = normalizePromptCwd(cwd)
  const nextNumber = nextSessionIdRef.current
  nextSessionIdRef.current += 1

  return {
    id: `session-local-${nextNumber}`,
    title: `${profile.name.toLowerCase().replace(/\s+/g, '-')}-${nextNumber}`,
    profileId: profile.id,
    status: 'running',
    hasActivity: false,
    lastUsedLabel: 'Now',
    cwd: displayCwd,
    previewLines: [
      `${promptPrefixForProfile(profile, displayCwd)}webpty --demo`,
      `profile: ${profile.name}`,
      `commandline: ${profile.commandline ?? 'default shell'}`,
      'local fallback session ready',
    ],
  }
}

function promoteSessions(sessions: SessionItem[]) {
  return sessions.map((session) =>
    session.lastUsedLabel === 'Now'
      ? {
          ...session,
          lastUsedLabel: 'Recent',
        }
      : session,
  )
}

function themeVars(uiTheme: UiThemeTokens) {
  return {
    '--app-bg': uiTheme.appBackground,
    '--app-glow': uiTheme.backgroundGlow,
    '--window': uiTheme.window,
    '--chrome': uiTheme.chrome,
    '--chrome-alt': uiTheme.chromeAlt,
    '--chrome-backdrop': uiTheme.chromeBackdrop,
    '--surface': uiTheme.surface,
    '--panel': uiTheme.panel,
    '--terminal-bg': uiTheme.terminalBackground,
    '--terminal-fg': uiTheme.terminalForeground,
    '--tab-active': uiTheme.tabActive,
    '--tab-inactive': uiTheme.tabInactive,
    '--tab-strip': uiTheme.tabStrip,
    '--line': uiTheme.border,
    '--line-strong': uiTheme.borderStrong,
    '--text': uiTheme.text,
    '--text-soft': uiTheme.textSoft,
    '--text-muted': uiTheme.textMuted,
    '--accent': uiTheme.accent,
    '--accent-soft': uiTheme.accentSoft,
    '--signal': uiTheme.signal,
    '--mint': uiTheme.success,
    '--shadow-soft': uiTheme.shadow,
  } as CSSProperties
}

function resolveActionBindings(actions: TerminalAction[] | undefined): ActionBindings {
  const bindings: ActionBindings = { ...DEFAULT_ACTION_BINDINGS }

  for (const action of actions ?? []) {
    const command = normalizeActionCommand(action.command)

    if (!command || !action.keys || action.keys.length === 0) {
      continue
    }

    bindings[command] = action.keys
  }

  return bindings
}

function applyThemeSelection(
  current: TerminalSettings['theme'],
  appearance: 'dark' | 'light',
  nextThemeName: string,
): TerminalSettings['theme'] {
  if (!current || typeof current === 'string') {
    return nextThemeName
  }

  return {
    ...current,
    [appearance]: nextThemeName,
  }
}

function normalizeActionCommand(command: TerminalActionCommand | undefined): SupportedActionCommand | null {
  const rawCommand =
    typeof command === 'string'
      ? command
      : isRecord(command)
        ? asOptionalString(command.action)
        : undefined

  if (!rawCommand) {
    return null
  }

  const normalized = rawCommand.replace(/[-_\s]/g, '').toLowerCase()

  if (normalized === 'newtab') {
    return 'newTab'
  }

  if (normalized === 'closetab') {
    return 'closeTab'
  }

  if (normalized === 'nexttab') {
    return 'nextTab'
  }

  if (normalized === 'prevtab' || normalized === 'previoustab') {
    return 'prevTab'
  }

  if (normalized === 'opensettings') {
    return 'openSettings'
  }

  return null
}

function matchesAction(event: KeyboardEvent, bindings: string[]) {
  return bindings.some((binding) => matchesKeybinding(event, binding))
}

function matchesKeybinding(event: KeyboardEvent, binding: string) {
  const parts = binding
    .split('+')
    .map((part) => normalizeKeyToken(part))
    .filter((part) => part.length > 0)

  if (parts.length === 0) {
    return false
  }

  const key = parts.at(-1)

  if (!key) {
    return false
  }

  const wantsCtrl = parts.includes('ctrl')
  const wantsShift = parts.includes('shift')
  const wantsAlt = parts.includes('alt')
  const wantsMeta = parts.includes('meta')

  return (
    event.ctrlKey === wantsCtrl &&
    event.shiftKey === wantsShift &&
    event.altKey === wantsAlt &&
    event.metaKey === wantsMeta &&
    normalizeKeyToken(event.key) === key
  )
}

function normalizeKeyToken(value: string) {
  const token = value.trim().toLowerCase()

  if (token === 'control') {
    return 'ctrl'
  }

  if (token === 'cmd' || token === 'command' || token === 'win' || token === 'super') {
    return 'meta'
  }

  if (token === 'comma') {
    return ','
  }

  if (token === 'space') {
    return ' '
  }

  if (token === 'escape' || token === 'esc') {
    return 'escape'
  }

  return token
}

function parseSettingsDraft(draft: string) {
  const parsed = JSON5.parse(draft) as unknown

  if (!isRecord(parsed) || !isRecord(parsed.profiles) || !Array.isArray(parsed.profiles.list)) {
    throw new Error('invalid settings payload')
  }

  return cloneSettingsDocument(parsed)
}

function cloneSettingsDocument(
  payload: unknown,
  fallback: TerminalSettings = demoSettings,
): Record<string, unknown> {
  if (isRecord(payload)) {
    return cloneJson(payload)
  }

  return cloneJson(fallback) as unknown as Record<string, unknown>
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function updateProfileDocument(
  document: Record<string, unknown>,
  selectedProfileId: string,
  draft: TerminalProfile,
) {
  const nextDocument = cloneSettingsDocument(document)
  const nextProfiles = ensureProfilesDocument(nextDocument)
  let replaced = false

  nextProfiles.list = nextProfiles.list.map((entry) => {
    const normalized = normalizeProfile(entry)
    if (!normalized || profileIdentifier(normalized) !== selectedProfileId) {
      return entry
    }

    replaced = true
    return serializeProfileRecord(entry, draft)
  })

  if (!replaced) {
    nextProfiles.list.push(serializeProfileRecord({}, draft))
  }

  if (nextDocument.defaultProfile === selectedProfileId) {
    nextDocument.defaultProfile = profileIdentifier(draft)
  }

  nextDocument.profiles = nextProfiles
  return nextDocument
}

function updateThemeDocument(
  document: Record<string, unknown>,
  selectedThemeName: string,
  draft: TerminalTheme,
) {
  const nextDocument = cloneSettingsDocument(document)
  const nextThemes = Array.isArray(nextDocument.themes) ? [...nextDocument.themes] : []
  let replaced = false

  const themes = nextThemes.map((entry) => {
    if (!isRecord(entry) || asString(entry.name, '') !== selectedThemeName) {
      return entry
    }

    replaced = true
    return serializeThemeRecord(entry, draft)
  })

  if (!replaced) {
    themes.push(serializeThemeRecord({}, draft))
  }

  nextDocument.themes = themes
  nextDocument.theme = renameThemeSelection(nextDocument.theme, selectedThemeName, draft.name)
  return nextDocument
}

function updateThemeSelectionDocument(
  document: Record<string, unknown>,
  current: TerminalSettings['theme'],
  appearance: 'dark' | 'light',
  nextThemeName: string,
) {
  return {
    ...cloneSettingsDocument(document),
    theme: applyThemeSelection(current, appearance, nextThemeName),
  }
}

function createThemeDraft(existingThemes: TerminalTheme[]): TerminalTheme {
  return {
    name: nextUniqueLabel(
      existingThemes.map((theme) => theme.name),
      'Theme',
    ),
    window: {
      applicationTheme: 'dark',
      useMica: false,
      frame: '#d8d8d8',
      unfocusedFrame: '#cfcfcf',
    },
    tab: {
      background: '#ffffff',
      unfocusedBackground: '#f4f4f4',
      showCloseButton: 'activeOnly',
    },
    tabRow: {
      background: '#efefef',
      unfocusedBackground: '#e7e7e7',
    },
  }
}

function duplicateThemeDraft(
  source: TerminalTheme,
  existingThemes: TerminalTheme[],
): TerminalTheme {
  return {
    ...cloneJson(source),
    name: nextUniqueLabel(
      existingThemes.map((theme) => theme.name),
      `${source.name} Copy`,
    ),
  }
}

function removeThemeDocument(
  document: Record<string, unknown>,
  themeName: string,
  existingThemes: TerminalTheme[],
) {
  const nextDocument = cloneSettingsDocument(document)
  const nextThemes = (Array.isArray(nextDocument.themes) ? nextDocument.themes : []).filter(
    (entry) => !isRecord(entry) || asString(entry.name, '') !== themeName,
  )
  const fallbackThemeName =
    nextThemes
      .filter(isRecord)
      .map((entry) => asString(entry.name, ''))
      .find((name) => name.length > 0) ??
    existingThemes.find((theme) => theme.name !== themeName)?.name

  nextDocument.themes = nextThemes
  nextDocument.theme = reassignThemeSelection(nextDocument.theme, themeName, fallbackThemeName)
  return nextDocument
}

function createProfileDraft(existingProfiles: ResolvedProfile[]): TerminalProfile {
  const template = existingProfiles[0] ?? resolveProfile(demoSettings, demoSettings.defaultProfile)
  const { id, ...draft } = cloneJson(template)
  void id

  return {
    ...draft,
    guid: generateProfileGuid(),
    name: nextUniqueLabel(
      existingProfiles.map((profile) => profile.name),
      'Profile',
    ),
    hidden: false,
  }
}

function duplicateProfileDraft(
  source: TerminalProfile,
  existingProfiles: ResolvedProfile[],
): TerminalProfile {
  const { id, ...draft } = cloneJson(source)
  void id

  return {
    ...draft,
    guid: generateProfileGuid(),
    name: nextUniqueLabel(
      existingProfiles.map((profile) => profile.name),
      `${source.name} Copy`,
    ),
    hidden: false,
  }
}

function removeProfileDocument(
  document: Record<string, unknown>,
  selectedProfileId: string,
  existingProfiles: ResolvedProfile[],
) {
  const nextDocument = cloneSettingsDocument(document)
  const nextProfiles = ensureProfilesDocument(nextDocument)
  const filteredList = nextProfiles.list.filter((entry) => {
    const normalized = normalizeProfile(entry)
    return !normalized || profileIdentifier(normalized) !== selectedProfileId
  })
  const fallbackProfile =
    filteredList
      .map((entry) => normalizeProfile(entry))
      .find((profile): profile is TerminalProfile => profile !== null) ??
    existingProfiles.find((profile) => profile.id !== selectedProfileId)

  nextProfiles.list = filteredList
  nextDocument.profiles = nextProfiles

  if (nextDocument.defaultProfile === selectedProfileId && fallbackProfile) {
    nextDocument.defaultProfile = profileIdentifier(fallbackProfile)
  }

  return nextDocument
}

function ensureProfilesDocument(document: Record<string, unknown>) {
  const current = isRecord(document.profiles) ? cloneJson(document.profiles) : {}
  return {
    ...current,
    list: Array.isArray(current.list) ? [...current.list] : [],
  }
}

function serializeThemeRecord(existing: unknown, draft: TerminalTheme) {
  const nextTheme = isRecord(existing) ? cloneJson(existing) : {}
  nextTheme.name = draft.name
  assignNestedRecord(nextTheme, 'window', {
    applicationTheme: draft.window?.applicationTheme,
    useMica: draft.window?.useMica,
    frame: draft.window?.frame,
    unfocusedFrame: draft.window?.unfocusedFrame,
  })
  assignNestedRecord(nextTheme, 'tab', {
    background: draft.tab?.background,
    unfocusedBackground: draft.tab?.unfocusedBackground,
    showCloseButton: draft.tab?.showCloseButton,
  })
  assignNestedRecord(nextTheme, 'tabRow', {
    background: draft.tabRow?.background,
    unfocusedBackground: draft.tabRow?.unfocusedBackground,
  })
  return nextTheme
}

function serializeProfileRecord(existing: unknown, draft: TerminalProfile) {
  const nextProfile = isRecord(existing) ? cloneJson(existing) : {}
  const font = draft.font ?? {}

  nextProfile.name = draft.name
  assignOptional(nextProfile, 'guid', draft.guid)
  assignOptional(nextProfile, 'icon', draft.icon)
  assignOptional(nextProfile, 'commandline', draft.commandline)
  assignOptional(nextProfile, 'startingDirectory', draft.startingDirectory)
  assignOptional(nextProfile, 'source', draft.source)
  assignOptional(nextProfile, 'hidden', draft.hidden)
  assignOptional(nextProfile, 'tabColor', draft.tabColor)
  assignOptional(nextProfile, 'tabTitle', draft.tabTitle)
  assignOptional(nextProfile, 'colorScheme', draft.colorScheme)
  assignOptional(nextProfile, 'cursorShape', draft.cursorShape)
  assignOptional(nextProfile, 'lineHeight', draft.lineHeight)
  assignOptional(nextProfile, 'opacity', draft.opacity)
  assignOptional(nextProfile, 'useAcrylic', draft.useAcrylic)
  assignOptional(nextProfile, 'foreground', draft.foreground)
  assignOptional(nextProfile, 'background', draft.background)
  assignOptional(nextProfile, 'cursorColor', draft.cursorColor)
  assignOptional(nextProfile, 'selectionBackground', draft.selectionBackground)
  assignOptional(nextProfile, 'padding', draft.padding)
  assignNestedRecord(nextProfile, 'webpty', {
    prompt: draft.promptTemplate,
  })
  delete nextProfile.promptTemplate

  if (hasOwnValues(font)) {
    assignNestedRecord(nextProfile, 'font', {
      face: font.face ?? draft.fontFace,
      size: font.size ?? draft.fontSize,
      weight: font.weight ?? draft.fontWeight,
      cellHeight: font.cellHeight ?? draft.cellHeight,
    })
    delete nextProfile.fontFace
    delete nextProfile.fontSize
    delete nextProfile.fontWeight
    delete nextProfile.cellHeight
  } else {
    assignOptional(nextProfile, 'fontFace', draft.fontFace)
    assignOptional(nextProfile, 'fontSize', draft.fontSize)
    assignOptional(nextProfile, 'fontWeight', draft.fontWeight)
    assignOptional(nextProfile, 'cellHeight', draft.cellHeight)
    if (isRecord(nextProfile.font) && !hasOwnValues(nextProfile.font)) {
      delete nextProfile.font
    }
  }

  return nextProfile
}

function renameThemeSelection(
  selection: unknown,
  previousName: string,
  nextName: string,
): TerminalSettings['theme'] {
  if (!selection) {
    return undefined
  }

  if (typeof selection === 'string') {
    return selection === previousName ? nextName : selection
  }

  if (!isRecord(selection)) {
    return undefined
  }

  return {
    dark: selection.dark === previousName ? nextName : asOptionalString(selection.dark),
    light: selection.light === previousName ? nextName : asOptionalString(selection.light),
    system:
      selection.system === previousName ? nextName : asOptionalString(selection.system),
  }
}

function reassignThemeSelection(
  selection: unknown,
  removedName: string,
  fallbackName: string | undefined,
): TerminalSettings['theme'] {
  if (!fallbackName) {
    return undefined
  }

  if (!selection) {
    return fallbackName
  }

  if (typeof selection === 'string') {
    return selection === removedName ? fallbackName : selection
  }

  if (!isRecord(selection)) {
    return fallbackName
  }

  return {
    dark: selection.dark === removedName ? fallbackName : asOptionalString(selection.dark),
    light: selection.light === removedName ? fallbackName : asOptionalString(selection.light),
    system:
      selection.system === removedName ? fallbackName : asOptionalString(selection.system),
  }
}

function nextUniqueLabel(existingNames: string[], baseLabel: string) {
  if (!existingNames.includes(baseLabel)) {
    return baseLabel
  }

  let suffix = 2
  while (existingNames.includes(`${baseLabel} ${suffix}`)) {
    suffix += 1
  }

  return `${baseLabel} ${suffix}`
}

function generateProfileGuid() {
  const value =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `webpty-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`

  return `{${value}}`
}

function assignNestedRecord(
  target: Record<string, unknown>,
  key: string,
  patch: Record<string, unknown>,
) {
  const nextValue = isRecord(target[key]) ? cloneJson(target[key]) : {}

  for (const [entryKey, entryValue] of Object.entries(patch)) {
    assignOptional(nextValue, entryKey, entryValue)
  }

  if (hasOwnValues(nextValue)) {
    target[key] = nextValue
  } else {
    delete target[key]
  }
}

function assignOptional(target: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') {
    delete target[key]
    return
  }

  target[key] = cloneJson(value)
}

function hasOwnValues(value: unknown) {
  return isRecord(value) && Object.keys(value).length > 0
}

function schemeSelectionLabel(
  selection: TerminalProfile['colorScheme'],
  appearance: 'dark' | 'light',
) {
  if (!selection) {
    return undefined
  }

  if (typeof selection === 'string') {
    return selection
  }

  return selection[appearance] ?? selection.dark ?? selection.light
}

function readOptionalNumber(value: string) {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (
    target.classList.contains('xterm-helper-textarea') ||
    target.closest('.xterm') !== null
  ) {
    return false
  }

  const tag = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select'
  )
}

function profileBadge(profile: TerminalProfile) {
  if (profile.icon && isBadgeText(profile.icon)) {
    return profile.icon
  }

  return profile.name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function isBadgeText(value: string) {
  const trimmed = value.trim()

  return (
    trimmed.length > 0 &&
    trimmed.length <= 3 &&
    !/[\\/.:]/.test(trimmed) &&
    !/\.(png|svg|ico|jpg|jpeg|webp)$/i.test(trimmed)
  )
}

function ProfileGlyph({
  profile,
  compact = false,
}: {
  profile: TerminalProfile
  compact?: boolean
}) {
  const [didError, setDidError] = useState(false)
  const iconSource = !didError ? resolveProfileIconSource(profile.icon) : null

  return (
    <span className={`profile-glyph ${compact ? 'is-compact' : ''}`}>
      {iconSource ? (
        <img
          src={iconSource}
          alt=""
          loading="lazy"
          onError={() => setDidError(true)}
        />
      ) : (
        profileBadge(profile)
      )}
    </span>
  )
}

function SettingsSectionIcon({
  section,
}: {
  section: SettingsSection
}) {
  if (section === 'appearance') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.75 4.25h10.5M4.25 8h7.5M5.75 11.75h4.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
    )
  }

  if (section === 'profiles') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 8.1a2.35 2.35 0 1 0 0-4.7 2.35 2.35 0 0 0 0 4.7Zm-4.3 4.2a4.3 4.3 0 0 1 8.6 0"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
    )
  }

  if (section === 'json') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M6.25 3.5 3.75 8l2.5 4.5M9.75 3.5 12.25 8l-2.5 4.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.5"
        y="4"
        width="11"
        height="8"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5 7.1h1.2M7.4 7.1h1.2M9.8 7.1H11M5 9.5h3.6M9.4 9.5H11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function RailToggleIcon({
  collapsed,
}: {
  collapsed: boolean
}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={collapsed ? 'M6 3.75 10 8 6 12.25' : 'M10 3.75 6 8l4 4.25'}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 4.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M8 1.9v1.4M8 12.7v1.4M3.6 3.6l1 1M11.4 11.4l1 1M1.9 8h1.4M12.7 8h1.4M3.6 12.4l1-1M11.4 4.6l1-1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m4.5 4.5 7 7m0-7-7 7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  )
}

function NewTabGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 3.4v9.2M3.4 8h9.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function SplitVerticalGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.8"
        y="3.3"
        width="10.4"
        height="9.4"
        rx="1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M8 3.8v8.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function SplitHorizontalGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.8"
        y="3.3"
        width="10.4"
        height="9.4"
        rx="1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.4 8h9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function CodeGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.25 4.2 3.9 8l2.35 3.8M9.75 4.2 12.1 8l-2.35 3.8M8.7 3.5 7.3 12.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </svg>
  )
}

function sessionTitle(session: SessionItem, profile: TerminalProfile) {
  return profile.tabTitle ?? session.title
}

function resolveDraftScheme(
  settings: TerminalSettings,
  profile: TerminalProfile,
  appearance: 'dark' | 'light',
) {
  const defaults = settings.profiles.defaults ?? {}
  const mergedFont =
    defaults.font || profile.font
      ? {
          ...(defaults.font ?? {}),
          ...(profile.font ?? {}),
        }
      : undefined

  return resolveScheme(
    settings,
    {
      ...defaults,
      ...profile,
      font: mergedFont,
      id: profileIdentifier(profile),
    },
    appearance,
  )
}

function resolveProfileIconSource(icon: string | undefined) {
  if (!icon) {
    return null
  }

  const trimmed = icon.trim()
  if (trimmed.length === 0 || isBadgeText(trimmed)) {
    return null
  }

  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed
  }

  return null
}

function applyColorOpacity(value: string, opacity = 100) {
  const normalizedOpacity = Math.min(100, Math.max(0, opacity))
  if (normalizedOpacity >= 100) {
    return value
  }

  const parsed = parseHexColor(value)
  if (!parsed) {
    return value
  }

  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${Number(
    (normalizedOpacity / 100).toFixed(3),
  )})`
}

function normalizePromptCwd(value: string) {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return '~'
  }

  return trimmed
    .replace(/^%userprofile%/i, '~')
    .replace(/^%home%/i, '~')
    .replace(/^\/home\/[^/]+/, '~')
    .replace(/^([A-Za-z]:)?\\Users\\[^\\]+/i, '~')
}

function composePreviewCommand(profile: TerminalProfile, cwd: string, command: string) {
  return `${promptPrefixForProfile(profile, cwd)}${command}`
}

function resolveColorInputValue(value: string | undefined, fallback: string) {
  const candidate = normalizeHexColor(value) ?? normalizeHexColor(fallback)
  return candidate ?? '#000000'
}

function normalizeHexColor(value: string | undefined) {
  if (!value) {
    return null
  }

  const normalized = value.trim()
  const parsed = parseHexColor(normalized)

  if (!parsed) {
    return null
  }

  return `#${toHexChannel(parsed.r)}${toHexChannel(parsed.g)}${toHexChannel(parsed.b)}`
}

function parseHexColor(value: string) {
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

function toHexChannel(value: number) {
  return value.toString(16).padStart(2, '0')
}

function resolveAppearance(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

async function fetchJson(path: string, signal?: AbortSignal, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    signal,
  })

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`)
  }

  return (await response.json()) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asOptionalActionCommand(value: unknown): TerminalActionCommand | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (isRecord(value)) {
    return cloneJson(value)
  }

  return undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function asOptionalNumberOrString(value: unknown): number | string | undefined {
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : fallback
}

export default App
