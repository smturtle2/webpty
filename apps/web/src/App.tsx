import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from 'react'
import './App.css'
import { TerminalViewport } from './components/TerminalViewport'
import { demoHealth, demoSessions, demoSettings } from './data/demo'
import {
  actionLabel,
  buildPreviewLines,
  formatSettingsJson,
  profileIdentifier,
  resolveProfile,
  resolveScheme,
  resolveTheme,
  resolveThemeName,
  resolveUiTheme,
  resolveWindowAppearance,
  sessionLabel,
} from './lib/windowsTerminal'
import type {
  ServerHealth,
  SessionItem,
  UiThemeTokens,
  WindowsTerminalAction,
  WindowsTerminalProfile,
  WindowsTerminalSettings,
} from './types'

type ConnectionState = 'connecting' | 'live' | 'offline'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type PaneLayout = 'single' | 'vertical' | 'horizontal'
type SupportedActionCommand = 'newTab' | 'closeTab' | 'nextTab' | 'prevTab' | 'openSettings'
type ActionBindings = Record<SupportedActionCommand, string[]>

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

function App() {
  const [settings, setSettings] = useState<WindowsTerminalSettings>(demoSettings)
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState(formatSettingsJson(demoSettings))
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [isBooting, setIsBooting] = useState(true)
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
  const activeTabLabel = tabLabelForTab(currentTab, sessions, settings)
  const visibleProfiles = settings.profiles.list
    .filter((profile) => profile.hidden !== true)
    .map((profile) => resolveProfile(settings, profileIdentifier(profile)))
  const actionBindings = resolveActionBindings(settings.actions)
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

      startTransition(() => {
        setServerHealth(nextHealth)
        setSettings(nextSettings)
        setSettingsDocument(nextSettingsDocument)
        setSettingsDraft(formatSettingsJson(nextSettingsDocument))
        setSessions(nextVisibleSessions)
        setTabs(nextTabs)
        setActiveSessionId(nextTabs[0].paneIds[0])
        setActiveTabId(nextTabs[0].id)
        setRemoteReady(ready)
      })

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

  function activateSession(sessionId: string) {
    const owner = findTabByPaneId(tabs, sessionId)

    startTransition(() => {
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

  function cycleSession(direction: 1 | -1) {
    if (tabs.length <= 1) {
      return
    }

    const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId)
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length
    const nextTab = tabs[nextIndex]

    setActiveTabId(nextTab.id)
    activateSession(nextTab.paneIds[0])
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

  const handleWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape' && isSettingsOpen) {
      event.preventDefault()
      setIsSettingsOpen(false)
      return
    }

    if (isTypingTarget(event.target)) {
      return
    }

    if (matchesAction(event, actionBindings.prevTab)) {
      event.preventDefault()
      cycleSession(-1)
      return
    }

    if (matchesAction(event, actionBindings.nextTab)) {
      event.preventDefault()
      cycleSession(1)
      return
    }

    if (matchesAction(event, actionBindings.newTab)) {
      event.preventDefault()
      void createSession()
      return
    }

    if (matchesAction(event, actionBindings.closeTab)) {
      event.preventDefault()
      void closeTab(activeTabId)
      return
    }

    if (matchesAction(event, actionBindings.openSettings)) {
      event.preventDefault()
      setIsSettingsOpen((current) => !current)
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleWindowKeyDown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
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
      setSettingsError('Settings 저장에 실패했습니다. JSON 형식과 서버 상태를 확인하세요.')
    }
  }

  async function handleThemeApply(nextThemeName: string) {
    await commitSettings({ ...settingsDocument, theme: nextThemeName }, canConnect)
  }

  async function handleDefaultProfileSelect(profileId: string) {
    await commitSettings({ ...settingsDocument, defaultProfile: profileId }, canConnect)
  }

  async function handleSettingsSave() {
    try {
      await commitSettings(parseSettingsDraft(settingsDraft), canConnect)
    } catch {
      setSaveState('error')
      setSettingsError('settings.json 초안이 유효한 WT 호환 JSON이 아닙니다.')
    }
  }

  function handleSettingsReset() {
    setSettingsError(null)
    setSaveState('idle')
    setSettingsDraft(formatSettingsJson(settingsDocument))
  }

  return (
    <main className="terminal-app" style={themeVars(uiTheme)}>
      <section className="terminal-shell">
        <section className="viewport-stage" aria-label="Terminal workspace">
          <div className="terminal-stage">
            <div className={`workspace-grid workspace-grid-${currentTab.layout}`}>
              {visiblePaneSessions.map((session) => {
                const profile = resolveProfile(settings, session.profileId)
                const scheme = resolveScheme(settings, profile, uiAppearance)
                const isFocusedPane = session.id === activeSessionId && !isSettingsOpen

                return (
                  <section
                    key={`${session.id}-${canConnect ? 'live' : 'offline'}`}
                    className={`pane-shell ${isFocusedPane ? 'is-active' : ''}`}
                    aria-label={`${sessionTitle(session, profile)} pane`}
                    onMouseDown={() => activateSession(session.id)}
                  >
                    <div className="pane-frame" aria-hidden="true" />
                    <div
                      className={`pane-badge ${currentTab.paneIds.length > 1 ? 'is-visible' : ''}`}
                    >
                      <span>{profileBadge(profile)}</span>
                      <small>{sessionTitle(session, profile)}</small>
                    </div>
                    <TerminalViewport
                      active={isFocusedPane}
                      canConnect={canConnect}
                      cursorShape={profile.cursorShape}
                      fallbackLines={session.previewLines}
                      fontFamily={profile.fontFace ?? 'Cascadia Mono'}
                      fontSize={profile.fontSize ?? 13}
                      lineHeight={profile.lineHeight ?? 1.22}
                      onConnectionStateChange={handleConnectionStateChange}
                      onTranscriptChange={handleTranscriptChange}
                      scheme={scheme}
                      sessionId={session.id}
                    />
                  </section>
                )
              })}
            </div>

            <button
              type="button"
              className={`settings-scrim ${isSettingsOpen ? 'is-open' : ''}`}
              aria-hidden={!isSettingsOpen}
              tabIndex={isSettingsOpen ? 0 : -1}
              onClick={() => setIsSettingsOpen(false)}
            />

            <aside
              className={`settings-drawer ${isSettingsOpen ? 'is-open' : ''}`}
              aria-label="Settings"
            >
              <div className="drawer-header">
                <div>
                  <span className="header-label">Terminal settings</span>
                  <strong>Profiles, themes, JSON</strong>
                  <p>{runtimeMessage}</p>
                </div>
                <div className="drawer-header-actions">
                  <span className={`status-pill ${canConnect ? 'is-live' : 'subtle'}`}>
                    {runtimeLabel}
                  </span>
                  <span className={`status-pill ${saveState === 'saved' ? 'is-live' : 'subtle'}`}>
                    {saveLabel}
                  </span>
                  <button
                    type="button"
                    className="toolbar-button ghost"
                    onClick={() => setIsSettingsOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <section className="drawer-overview" aria-label="Studio overview">
                <article className="summary-card">
                  <span className="header-label">Default</span>
                  <strong>{defaultProfile.name}</strong>
                  <span>{defaultProfile.commandline ?? 'default shell'}</span>
                </article>
                <article className="summary-card">
                  <span className="header-label">Theme</span>
                  <strong>{themeName}</strong>
                  <span>{activeScheme.name}</span>
                </article>
                <article className="summary-card">
                  <span className="header-label">Focused</span>
                  <strong>{activeTabLabel}</strong>
                  <span>
                    {currentTab.paneIds.length > 1
                      ? `${currentTab.paneIds.length} panes · ${activeSession.cwd}`
                      : activeSession.cwd}
                  </span>
                </article>
              </section>

              <section className="drawer-section">
                <div className="section-heading">
                  <strong>Appearance</strong>
                  <p>Keep the terminal dark, the rail bright, and the chrome flat like a native shell.</p>
                </div>

                <div className="theme-grid">
                  {settings.themes?.map((theme) => {
                    const previewTheme = resolveUiTheme(
                      { ...settings, theme: theme.name },
                      activeProfile,
                      uiAppearance,
                    )

                    return (
                      <button
                        key={theme.name}
                        type="button"
                        className={`theme-chip ${theme.name === themeName ? 'is-active' : ''}`}
                        style={
                          {
                            '--chip-accent': previewTheme.chrome,
                            '--chip-tone': previewTheme.panel,
                          } as CSSProperties
                        }
                        onClick={() => void handleThemeApply(theme.name)}
                      >
                        <span className="theme-chip-swatch" />
                        <span>{theme.name}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="drawer-section">
                <div className="section-heading">
                  <strong>Profiles</strong>
                  <p>Launch immediately or promote a profile to the WT-compatible default.</p>
                </div>

                <div className="profile-grid">
                  {visibleProfiles.map((profile) => {
                    const isDefault = profile.id === defaultProfile.id

                    return (
                      <article
                        key={profile.id}
                        className={`profile-card ${isDefault ? 'is-default' : ''}`}
                      >
                        <div className="profile-card-head">
                          <div>
                            <strong>{profile.name}</strong>
                            <p>{profile.commandline ?? 'Default commandline'}</p>
                          </div>
                          <span className="profile-badge">
                            {isDefault ? 'default' : profile.cursorShape ?? 'bar'}
                          </span>
                        </div>
                        <span>
                          {profile.startingDirectory ?? '~'} · {profile.fontFace ?? 'Cascadia Mono'}
                        </span>

                        <div className="profile-card-actions">
                          <button
                            type="button"
                            className="toolbar-button"
                            onClick={() => void createSession(profile.id)}
                          >
                            Launch
                          </button>
                          <button
                            type="button"
                            className="toolbar-button ghost"
                            onClick={() => void handleDefaultProfileSelect(profile.id)}
                            disabled={isDefault}
                          >
                            Set default
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>

              <section className="drawer-section studio-editor">
                <div className="section-heading">
                  <strong>settings.json</strong>
                  <p>Round-trip preserves unknown keys while the UI edits the supported Windows Terminal subset.</p>
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

              <section className="drawer-shortcuts" aria-label="Keyboard shortcuts">
                {shortcutSummary.map((shortcut) => (
                  <span key={`${shortcut.command}-${shortcut.keys}`} className="shortcut-pill">
                    {shortcut.command}: {shortcut.keys}
                  </span>
                ))}
              </section>
            </aside>
          </div>
        </section>

        <aside
          className="session-rail"
          data-close-mode={closeButtonMode}
          aria-label="Session rail"
        >
          <div className="rail-head">
            <button
              type="button"
              className="rail-brand"
              onClick={() => setIsSettingsOpen((current) => !current)}
              aria-label="Open settings"
            >
              <span className="rail-brand-mark">WT</span>
              <span className="rail-brand-copy">shell</span>
            </button>
            <div className="rail-status" aria-label="Runtime status">
              <span className={`rail-connection is-${connectionState}`} aria-hidden="true" />
              <span>{runtimeLabel}</span>
            </div>
          </div>

          <div className="rail-caption" aria-label="Session count">
            <strong>{tabs.length}</strong>
            <span>tabs</span>
          </div>

          <div className="rail-list" role="tablist" aria-label="Sessions">
            {tabs.map((tab) => {
              const primarySession =
                sessions.find((session) => session.id === tab.paneIds[0]) ?? activeSession
              const profile = resolveProfile(settings, primarySession.profileId)
              const tabLabel = tabLabelForTab(tab, sessions, settings)
              const isActive = tab.id === currentTab.id
              const tabMeta =
                tab.paneIds.length > 1
                  ? `${tab.paneIds.length} panes`
                  : sessionLabel(primarySession, activeSession.id)

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
                    onClick={() => {
                      setActiveTabId(tab.id)
                      activateSession(tab.paneIds[0])
                    }}
                  >
                    <span
                      className={`rail-tab-status rail-tab-status-${primarySession.status}`}
                    />
                    <span className="rail-tab-icon">{profileBadge(profile)}</span>
                    <span className="rail-tab-copy">
                      <strong>{tabLabel}</strong>
                      <span>{profile.name}</span>
                    </span>
                    <span className="rail-tab-meta">{tabMeta}</span>
                  </button>

                  {closeButtonMode !== 'never' ? (
                    <button
                      type="button"
                      className="rail-tab-close"
                      onClick={() => void closeTab(tab.id)}
                      aria-label={`${tabLabel} 닫기`}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="rail-footer">
            <button
              type="button"
              className="rail-action"
              aria-label="New session"
              onClick={() => void createSession()}
            >
              <span>+</span>
              <small>new</small>
            </button>
            <button
              type="button"
              className={`rail-action ${isSettingsOpen ? 'is-active' : ''}`}
              aria-label="Open settings"
              onClick={() => setIsSettingsOpen((current) => !current)}
            >
              <span>cfg</span>
              <small>set</small>
            </button>
          </div>
        </aside>
      </section>
    </main>
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

function normalizeSettings(payload: unknown): WindowsTerminalSettings {
  if (!isRecord(payload) || !isRecord(payload.profiles) || !Array.isArray(payload.profiles.list)) {
    return demoSettings
  }

  const rawProfiles = payload.profiles.list
    .map((profile) => normalizeProfile(profile))
    .filter((profile): profile is WindowsTerminalProfile => profile !== null)

  return {
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
                }
              : undefined,
            tab: isRecord(theme.tab)
              ? {
                  background: asOptionalString(theme.tab.background),
                  showCloseButton:
                    theme.tab.showCloseButton === 'always' ||
                    theme.tab.showCloseButton === 'hover' ||
                    theme.tab.showCloseButton === 'never'
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
            command: asOptionalString(action.command),
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

function normalizeProfile(payload: unknown): WindowsTerminalProfile | null {
  if (!isRecord(payload)) {
    return null
  }

  return {
    id: asOptionalString(payload.id),
    guid: asOptionalString(payload.guid),
    name: asString(payload.name, 'Profile'),
    icon: asOptionalString(payload.icon),
    commandline: asOptionalString(payload.commandline),
    startingDirectory: asOptionalString(payload.startingDirectory ?? payload.starting_directory),
    source: asOptionalString(payload.source),
    hidden: asOptionalBoolean(payload.hidden),
    tabColor: asOptionalString(payload.tabColor ?? payload.tab_color),
    tabTitle: asOptionalString(payload.tabTitle ?? payload.tab_title),
    colorScheme: normalizeSchemeSelection(payload.colorScheme ?? payload.color_scheme),
    fontFace: asOptionalString(payload.fontFace ?? payload.font_face),
    fontSize: asOptionalNumber(payload.fontSize ?? payload.font_size),
    lineHeight: asOptionalNumber(payload.lineHeight ?? payload.line_height),
    cursorShape: asOptionalString(payload.cursorShape ?? payload.cursor_shape) as
      | WindowsTerminalProfile['cursorShape']
      | undefined,
    opacity: asOptionalNumber(payload.opacity),
    useAcrylic: asOptionalBoolean(payload.useAcrylic ?? payload.use_acrylic),
  }
}

function normalizeProfileDefaults(payload: Record<string, unknown>) {
  return {
    fontFace: asOptionalString(payload.fontFace ?? payload.font_face),
    fontSize: asOptionalNumber(payload.fontSize ?? payload.font_size),
    lineHeight: asOptionalNumber(payload.lineHeight ?? payload.line_height),
    cursorShape: asOptionalString(payload.cursorShape ?? payload.cursor_shape) as
      | WindowsTerminalProfile['cursorShape']
      | undefined,
    opacity: asOptionalNumber(payload.opacity),
    useAcrylic: asOptionalBoolean(payload.useAcrylic ?? payload.use_acrylic),
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
  settings: WindowsTerminalSettings,
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
  settings: WindowsTerminalSettings,
  nextSessionIdRef: MutableRefObject<number>,
): SessionItem {
  const profile = resolveProfile(settings, profileId)
  const nextNumber = nextSessionIdRef.current
  nextSessionIdRef.current += 1

  return {
    id: `session-local-${nextNumber}`,
    title: `${profile.name.toLowerCase().replace(/\s+/g, '-')}-${nextNumber}`,
    profileId: profile.id,
    status: 'running',
    hasActivity: false,
    lastUsedLabel: 'Now',
    cwd,
    previewLines: [
      '$ webpty --demo',
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

function resolveActionBindings(actions: WindowsTerminalAction[] | undefined): ActionBindings {
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

function normalizeActionCommand(command: string | undefined): SupportedActionCommand | null {
  if (!command) {
    return null
  }

  const normalized = command.replace(/[-_\s]/g, '').toLowerCase()

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
  const parsed = JSON.parse(draft) as unknown

  if (!isRecord(parsed) || !isRecord(parsed.profiles) || !Array.isArray(parsed.profiles.list)) {
    throw new Error('invalid settings payload')
  }

  return cloneSettingsDocument(parsed)
}

function cloneSettingsDocument(
  payload: unknown,
  fallback: WindowsTerminalSettings = demoSettings,
): Record<string, unknown> {
  if (isRecord(payload)) {
    return cloneJson(payload)
  }

  return cloneJson(fallback) as unknown as Record<string, unknown>
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
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

function profileBadge(profile: WindowsTerminalProfile) {
  if (profile.icon) {
    return profile.icon
  }

  return profile.name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function sessionTitle(session: SessionItem, profile: WindowsTerminalProfile) {
  return profile.tabTitle ?? session.title
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

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
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
