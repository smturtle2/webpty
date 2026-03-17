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
  resolveThemeName,
  resolveUiTheme,
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
type SupportedActionCommand = 'newTab' | 'closeTab' | 'nextTab' | 'prevTab' | 'openSettings'
type ActionBindings = Record<SupportedActionCommand, string[]>

const DEFAULT_ACTION_BINDINGS: ActionBindings = {
  newTab: ['ctrl+t'],
  closeTab: ['ctrl+w'],
  nextTab: ['ctrl+tab'],
  prevTab: ['ctrl+shift+tab'],
  openSettings: ['ctrl+,'],
}

function App() {
  const [settings, setSettings] = useState<WindowsTerminalSettings>(demoSettings)
  const [sessions, setSessions] = useState<SessionItem[]>(demoSessions)
  const [activeSessionId, setActiveSessionId] = useState(demoSessions[0].id)
  const [serverHealth, setServerHealth] = useState<ServerHealth>(demoHealth)
  const [remoteReady, setRemoteReady] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>('offline')
  const [appearance, setAppearance] = useState<'dark' | 'light'>(resolveAppearance())
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState(formatSettingsJson(demoSettings))
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [isBooting, setIsBooting] = useState(true)
  const nextSessionIdRef = useRef(demoSessions.length + 1)

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? demoSessions[0]
  const activeProfile = resolveProfile(settings, activeSession.profileId)
  const defaultProfile = resolveProfile(settings, settings.defaultProfile)
  const activeScheme = resolveScheme(settings, activeProfile, appearance)
  const themeName = resolveThemeName(settings.theme, appearance) ?? 'System'
  const uiTheme = resolveUiTheme(settings, activeProfile, appearance)
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
  const isDraftDirty = settingsDraft !== formatSettingsJson(settings)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => {
      setAppearance(mediaQuery.matches ? 'light' : 'dark')
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
      const nextSessions =
        sessionsResult.status === 'fulfilled'
          ? normalizeSessions(sessionsResult.value)
          : demoSessions
      const ready =
        healthResult.status === 'fulfilled' &&
        settingsResult.status === 'fulfilled' &&
        sessionsResult.status === 'fulfilled' &&
        nextSessions.length > 0

      startTransition(() => {
        setServerHealth(nextHealth)
        setSettings(nextSettings)
        setSettingsDraft(formatSettingsJson(nextSettings))
        setSessions(nextSessions.length > 0 ? nextSessions : demoSessions)
        setActiveSessionId((currentId) =>
          nextSessions.some((session) => session.id === currentId)
            ? currentId
            : nextSessions[0]?.id ?? demoSessions[0].id,
        )
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

    if (!sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id)
    }
  }, [activeSessionId, sessions])

  function activateSession(sessionId: string) {
    startTransition(() => {
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
    if (sessions.length <= 1) {
      return
    }

    const currentIndex = sessions.findIndex((session) => session.id === activeSessionId)
    const nextIndex = (currentIndex + direction + sessions.length) % sessions.length
    activateSession(sessions[nextIndex].id)
  }

  async function createSession(profileId = activeProfile.id) {
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
          startTransition(() => {
            setSessions((currentSessions) => [...promoteSessions(currentSessions), created])
            setActiveSessionId(created.id)
          })
          return
        }
      } catch {
        setRemoteReady(false)
      }
    }

    const fallback = createFallbackSession(profileId, nextCwd, settings, nextSessionIdRef)

    startTransition(() => {
      setSessions((currentSessions) => [...promoteSessions(currentSessions), fallback])
      setActiveSessionId(fallback.id)
    })
  }

  async function closeSession(sessionId: string) {
    if (sessions.length <= 1) {
      return
    }

    const currentIndex = sessions.findIndex((session) => session.id === sessionId)
    const nextIndex = currentIndex <= 0 ? 1 : currentIndex - 1
    const nextSession = sessions[nextIndex]

    if (canConnect) {
      void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      }).catch(() => {
        setRemoteReady(false)
      })
    }

    startTransition(() => {
      setSessions((currentSessions) =>
        currentSessions.filter((session) => session.id !== sessionId),
      )

      if (sessionId === activeSessionId) {
        setActiveSessionId(nextSession.id)
      }
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

  function handleConnectionStateChange(nextState: ConnectionState) {
    setConnectionState(nextState)
  }

  const handleWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
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
      void closeSession(activeSessionId)
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

  async function commitSettings(nextSettings: WindowsTerminalSettings, persist: boolean) {
    setSettingsError(null)
    setSaveState(persist ? 'saving' : 'saved')

    if (!persist) {
      startTransition(() => {
        setSettings(nextSettings)
        setSettingsDraft(formatSettingsJson(nextSettings))
      })
      return
    }

    try {
      const payload = await fetchJson('/api/settings', undefined, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(nextSettings),
      })
      const normalized = normalizeSettings(payload)

      startTransition(() => {
        setSettings(normalized)
        setSettingsDraft(formatSettingsJson(normalized))
        setRemoteReady(true)
      })
      setSaveState('saved')
    } catch {
      setSaveState('error')
      setSettingsError('Settings 저장에 실패했습니다. JSON 형식과 서버 상태를 확인하세요.')
    }
  }

  async function handleThemeApply(nextThemeName: string) {
    const nextSettings: WindowsTerminalSettings = {
      ...settings,
      theme: nextThemeName,
    }

    await commitSettings(nextSettings, canConnect)
  }

  async function handleDefaultProfileSelect(profileId: string) {
    const nextSettings: WindowsTerminalSettings = {
      ...settings,
      defaultProfile: profileId,
    }

    await commitSettings(nextSettings, canConnect)
  }

  async function handleSettingsSave() {
    try {
      const parsed = JSON.parse(settingsDraft) as WindowsTerminalSettings
      const normalized = normalizeSettings(parsed)

      await commitSettings(normalized, canConnect)
    } catch {
      setSaveState('error')
      setSettingsError('settings.json 초안이 유효한 JSON이 아닙니다.')
    }
  }

  function handleSettingsReset() {
    setSettingsError(null)
    setSaveState('idle')
    setSettingsDraft(formatSettingsJson(settings))
  }

  return (
    <main
      className={`terminal-app ${isSettingsOpen ? 'is-studio-open' : ''}`}
      style={themeVars(uiTheme)}
    >
      <div className="shell-noise" />

      <section className="terminal-shell">
        <section className="viewport-stage">
          <div className="terminal-stage">
            <TerminalViewport
              key={`${activeSession.id}-${canConnect ? 'live' : 'offline'}`}
              active={true}
              canConnect={canConnect}
              cursorShape={activeProfile.cursorShape}
              fallbackLines={activeSession.previewLines}
              fontFamily={activeProfile.fontFace ?? 'Cascadia Mono'}
              fontSize={activeProfile.fontSize ?? 13}
              lineHeight={activeProfile.lineHeight ?? 1.22}
              onConnectionStateChange={handleConnectionStateChange}
              onTranscriptChange={handleTranscriptChange}
              scheme={activeScheme}
              sessionId={activeSession.id}
            />

            <header className="stage-toolbar">
              <div className="stage-cluster">
                <div className="stage-brand">
                  <span className="app-mark">wt</span>
                  <div>
                    <strong>webpty</strong>
                    <p>
                      {activeSession.title} · {activeProfile.name}
                    </p>
                  </div>
                </div>

                <div className="toolbar-copy">
                  <span className={`status-pill ${canConnect ? 'is-live' : 'subtle'}`}>
                    {canConnect ? 'pty online' : 'local fallback'}
                  </span>
                  <span
                    className={`status-pill ${
                      connectionState === 'live' ? 'is-accent' : 'subtle'
                    }`}
                  >
                    {connectionState === 'live' ? 'streaming' : connectionState}
                  </span>
                  <span className="status-pill subtle">{themeName}</span>
                </div>
              </div>

              <div className="toolbar-group">
                <button type="button" className="toolbar-button" onClick={() => void createSession()}>
                  New
                </button>
                <button
                  type="button"
                  className="toolbar-button ghost"
                  onClick={() => setIsSettingsOpen((current) => !current)}
                >
                  {isSettingsOpen ? 'Hide studio' : 'Studio'}
                </button>
              </div>
            </header>

            <div className="stage-banner" aria-label="Session summary">
              <div className="banner-block">
                <span className="header-label">Session</span>
                <strong>{activeSession.title}</strong>
                <span>{activeProfile.commandline ?? 'Default shell'}</span>
              </div>

              <div className="banner-block">
                <span className="header-label">Theme</span>
                <strong>{themeName}</strong>
                <span>
                  {activeScheme.name} · {Math.round(activeProfile.opacity ?? 100)}% opacity
                </span>
              </div>

              <div className="banner-block">
                <span className="header-label">Working directory</span>
                <strong>{activeSession.cwd}</strong>
                <span>{serverHealth.websocketPath}</span>
              </div>
            </div>

            <footer className="stage-footer">
              <div className="footer-copy">
                <span>{isBooting ? 'Syncing runtime contracts…' : serverHealth.message}</span>
                <span>{`${sessions.length} tabs`}</span>
                <span>{activeSession.status}</span>
              </div>

              <div className="footer-shortcuts">
                {shortcutSummary.map((shortcut) => (
                  <span key={`${shortcut.command}-${shortcut.keys}`} className="shortcut-pill">
                    {shortcut.command}: {shortcut.keys}
                  </span>
                ))}
              </div>
            </footer>

            <aside
              className={`settings-drawer ${isSettingsOpen ? 'is-open' : ''}`}
              aria-label="Settings studio"
            >
              <div className="drawer-header">
                <div>
                  <span className="header-label">Studio</span>
                  <strong>Windows Terminal settings</strong>
                  <p>Theme, profile, and settings.json controls stay compatible with the WT subset.</p>
                </div>
                <span className={`status-pill ${saveState === 'saved' ? 'is-live' : 'subtle'}`}>
                  {saveState === 'saving'
                    ? 'saving'
                    : saveState === 'saved'
                      ? 'saved'
                      : saveState === 'error'
                        ? 'error'
                        : 'idle'}
                </span>
              </div>

              <section className="drawer-section">
                <div className="section-heading">
                  <strong>Appearance</strong>
                  <p>Apply WT `themes[]` live to the shell chrome, rail, and stage overlay.</p>
                </div>

                <div className="theme-grid">
                  {settings.themes?.map((theme) => {
                    const previewTheme = resolveUiTheme(
                      { ...settings, theme: theme.name },
                      activeProfile,
                      appearance,
                    )

                    return (
                      <button
                        key={theme.name}
                        type="button"
                        className={`theme-chip ${theme.name === themeName ? 'is-active' : ''}`}
                        style={
                          {
                            '--chip-accent': previewTheme.accent,
                            '--chip-tone': previewTheme.chromeAlt,
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
                  <p>Launch profiles immediately or promote one as the WT-compatible default profile.</p>
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
                            {isDefault ? 'default' : profile.cursorShape ?? 'block'}
                          </span>
                        </div>
                        <span>{profile.startingDirectory ?? '~'}</span>

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
                  <p>
                    Supported subset: `defaultProfile`, `profiles`, `schemes`, `themes`, `actions`,
                    `copyFormatting`
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
            </aside>
          </div>
        </section>

        <aside className="session-rail" aria-label="Session rail">
          <div className="rail-top">
            <button
              type="button"
              className="rail-emblem"
              onClick={() => setIsSettingsOpen((current) => !current)}
              aria-label="Open settings studio"
            >
              WT
            </button>
            <span className="rail-caption">Sessions</span>
          </div>

          <div className="rail-list" role="tablist" aria-label="Sessions">
            {sessions.map((session) => {
              const profile = resolveProfile(settings, session.profileId)
              const isActive = session.id === activeSession.id

              return (
                <div
                  key={session.id}
                  className={`rail-tab-shell ${isActive ? 'is-active' : ''}`}
                  style={{ '--rail-accent': profile.tabColor ?? uiTheme.accent } as CSSProperties}
                >
                  <button
                    type="button"
                    className="rail-tab"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => activateSession(session.id)}
                  >
                    <span className={`rail-tab-status rail-tab-status-${session.status}`} />
                    <span className="rail-tab-icon">{profileBadge(profile)}</span>
                    <span className="rail-tab-copy">
                      <strong>{session.title}</strong>
                      <span>{profile.name}</span>
                    </span>
                    <span className="rail-tab-meta">{sessionLabel(session, activeSession.id)}</span>
                  </button>

                  <button
                    type="button"
                    className="rail-tab-close"
                    onClick={() => void closeSession(session.id)}
                    aria-label={`${session.title} 닫기`}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>

          <div className="rail-launchers" aria-label="Profile launcher">
            {visibleProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`rail-profile ${profile.id === activeProfile.id ? 'is-current' : ''}`}
                onClick={() => void createSession(profile.id)}
                title={`New ${profile.name} tab`}
              >
                <span>{profileBadge(profile)}</span>
                <small>{profile.name}</small>
              </button>
            ))}
          </div>

          <div className="rail-actions">
            <button
              type="button"
              className="rail-action"
              aria-label="New session"
              onClick={() => void createSession()}
            >
              +
            </button>
            <button
              type="button"
              className="rail-action"
              aria-label="Open settings"
              onClick={() => setIsSettingsOpen((current) => !current)}
            >
              ⚙
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

  if (token === 'escape') {
    return 'esc'
  }

  return token
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
