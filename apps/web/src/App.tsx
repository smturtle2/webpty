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
} from './lib/windowsTerminal'
import type {
  ServerHealth,
  SessionItem,
  UiThemeTokens,
  WindowsTerminalProfile,
  WindowsTerminalSettings,
} from './types'

type ConnectionState = 'connecting' | 'live' | 'offline'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function App() {
  const [settings, setSettings] = useState(demoSettings)
  const [sessions, setSessions] = useState(demoSessions)
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
  const activeScheme = resolveScheme(settings, activeProfile, appearance)
  const themeName = resolveThemeName(settings.theme, appearance) ?? 'System'
  const uiTheme = resolveUiTheme(settings, activeProfile, appearance)
  const visibleProfiles = settings.profiles.list
    .filter((profile) => !profile.hidden)
    .map((profile) => resolveProfile(settings, profileIdentifier(profile)))
  const shortcuts =
    settings.actions
      ?.map((action) => ({
        command: action.command ?? 'action',
        keys: actionLabel(action.keys),
      }))
      .filter((action) => action.keys.length > 0)
      .slice(0, 5) ??
    []
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
              message: 'Rust server unavailable, running local demo shell',
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
    if (canConnect) {
      try {
        const payload = await fetchJson('/api/sessions', undefined, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            profileId,
            cwd: activeSession.cwd,
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

    const fallback = createFallbackSession(profileId, activeSession.cwd, settings, nextSessionIdRef)

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
    const command = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (!command) {
      return
    }

    if (key === 'tab') {
      event.preventDefault()
      cycleSession(event.shiftKey ? -1 : 1)
      return
    }

    if (key === 't') {
      event.preventDefault()
      void createSession()
      return
    }

    if (key === 'w') {
      event.preventDefault()
      void closeSession(activeSessionId)
      return
    }

    if (key === ',') {
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
    <main className={`terminal-app ${isSettingsOpen ? 'is-studio-open' : ''}`} style={themeVars(uiTheme)}>
      <div className="backdrop-orbit" />

      <section className="terminal-window">
        <header className="window-topbar">
          <div className="app-title">
            <span className="app-mark">wt</span>
            <div>
              <strong>webpty</strong>
              <p>Windows Terminal compatible shell studio</p>
            </div>
          </div>

          <div className="topbar-status">
            <span className={`status-pill ${canConnect ? 'is-live' : ''}`}>
              {canConnect ? 'server online' : 'demo mode'}
            </span>
            <span className={`status-pill ${connectionState === 'live' ? 'is-accent' : 'subtle'}`}>
              {connectionState === 'live' ? 'websocket live' : connectionState}
            </span>
            <span className="status-pill subtle">{themeName}</span>
          </div>

          <div className="topbar-actions">
            <button type="button" className="toolbar-button" onClick={() => void createSession()}>
              New tab
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => setIsSettingsOpen((current) => !current)}
            >
              Settings
            </button>
          </div>
        </header>

        <section className="workbench">
          <div className="terminal-column">
            <div className="tab-strip" role="tablist" aria-label="Sessions">
              <div className="tab-list">
                {sessions.map((session) => {
                  const profile = resolveProfile(settings, session.profileId)
                  const isActive = session.id === activeSession.id

                  return (
                    <div
                      key={session.id}
                      className={`tab-shell ${isActive ? 'is-active' : ''}`}
                      style={{ '--tab-accent': profile.tabColor ?? uiTheme.accent } as CSSProperties}
                    >
                      <button
                        type="button"
                        className="tab-button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => activateSession(session.id)}
                      >
                        <span className={`tab-status tab-status-${session.status}`} aria-hidden="true" />
                        <span className="tab-copy">
                          <strong>{session.title}</strong>
                          <span>{profile.name}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="tab-close"
                        onClick={() => void closeSession(session.id)}
                        aria-label={`${session.title} 닫기`}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>

              <button
                type="button"
                className="tab-add"
                aria-label="New session"
                onClick={() => void createSession()}
              >
                +
              </button>
            </div>

            <div className="terminal-header">
              <div className="header-block">
                <span className="header-label">Session</span>
                <strong>{activeSession.title}</strong>
                <p>{activeProfile.commandline ?? 'Default shell'}</p>
              </div>

              <div className="header-block">
                <span className="header-label">Theme</span>
                <strong>{themeName}</strong>
                <p>
                  {activeScheme.name} · {Math.round(activeProfile.opacity ?? 100)}% opacity
                </p>
              </div>

              <div className="header-block">
                <span className="header-label">Working directory</span>
                <strong>{activeSession.cwd}</strong>
                <p>{serverHealth.websocketPath}</p>
              </div>
            </div>

            <div className="profile-launcher" aria-label="Profiles">
              {visibleProfiles.map((profile) => {
                const selected = profile.id === activeProfile.id

                return (
                  <button
                    key={profile.id}
                    type="button"
                    className={`profile-pill ${selected ? 'is-selected' : ''}`}
                    onClick={() => void createSession(profile.id)}
                  >
                    <span className="profile-pill-icon">{profile.icon ?? profile.name.slice(0, 2)}</span>
                    <span className="profile-pill-copy">
                      <strong>{profile.name}</strong>
                      <span>{profile.commandline ?? 'Default commandline'}</span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="terminal-frame">
              <TerminalViewport
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
            </div>

            <footer className="terminal-statusbar">
              <span>{serverHealth.message}</span>
              {shortcuts.length > 0
                ? shortcuts.map((shortcut) => (
                    <span key={`${shortcut.command}-${shortcut.keys}`}>
                      {shortcut.command}: {shortcut.keys}
                    </span>
                  ))
                : null}
            </footer>
          </div>

          <aside className={`settings-studio ${isSettingsOpen ? 'is-open' : ''}`} aria-label="Settings studio">
            <div className="studio-header">
              <div>
                <span className="header-label">Settings</span>
                <strong>WT-compatible settings.json</strong>
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

            <section className="studio-section">
              <div className="section-heading">
                <strong>Appearance</strong>
                <p>Windows Terminal theme definitions are applied to the shell chrome immediately.</p>
              </div>

              <div className="theme-grid">
                {settings.themes?.map((theme) => (
                  <button
                    key={theme.name}
                    type="button"
                    className={`theme-chip ${theme.name === themeName ? 'is-active' : ''}`}
                    onClick={() => void handleThemeApply(theme.name)}
                  >
                    <span className="theme-chip-swatch" />
                    <span>{theme.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="studio-section">
              <div className="section-heading">
                <strong>Profiles</strong>
                <p>Profile launchers mirror `profiles.list` from the compatible settings file.</p>
              </div>

              <div className="profile-grid">
                {visibleProfiles.map((profile) => (
                  <article key={profile.id} className="profile-card">
                    <div className="profile-card-head">
                      <strong>{profile.name}</strong>
                      <span>{profile.cursorShape ?? 'bar'}</span>
                    </div>
                    <p>{profile.commandline ?? 'Default commandline'}</p>
                    <span>{profile.startingDirectory ?? '~'}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="studio-section studio-editor">
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
                <button type="button" className="toolbar-button ghost" onClick={handleSettingsReset}>
                  Reset draft
                </button>
              </div>
            </section>
          </aside>
        </section>
      </section>

      <div className="floating-summary">
        <span>{isBooting ? 'Loading runtime contracts…' : `${sessions.length} sessions`}</span>
        <span>{activeProfile.name}</span>
        <span>{activeSession.status}</span>
      </div>
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
    defaultProfile: asString(payload.defaultProfile ?? payload.default_profile, demoSettings.defaultProfile),
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
                  useMica: Boolean(theme.window.useMica),
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
      defaults: isRecord(payload.profiles.defaults) ? normalizeProfileDefaults(payload.profiles.defaults) : demoSettings.profiles.defaults,
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
    hidden: Boolean(payload.hidden),
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
  return normalizeProfile(payload) ?? demoSettings.profiles.defaults
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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback
}

export default App
