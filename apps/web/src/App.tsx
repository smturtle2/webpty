import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react'
import './App.css'
import { TerminalViewport } from './components/TerminalViewport'
import { demoHealth, profiles, sessions as seededSessions } from './data/demo'
import type { ServerHealth, SessionItem } from './types'

function App() {
  const [sessions, setSessions] = useState(seededSessions)
  const [activeSessionId, setActiveSessionId] = useState(seededSessions[0].id)
  const [serverHealth, setServerHealth] = useState<ServerHealth>(demoHealth)
  const nextSessionIdRef = useRef(seededSessions.length + 1)

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const activeProfile = profileById(activeSession.profileId)

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 1400)

    void fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('health check failed')
        }

        return (await response.json()) as ServerHealth
      })
      .then((payload) => {
        setServerHealth(payload)
      })
      .catch(() => {
        setServerHealth(demoHealth)
      })

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [])

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
              lastUsedLabel: 'moments ago',
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

  function createSession() {
    const profile = activeProfile ?? profiles[0]
    const number = nextSessionIdRef.current
    const newSession: SessionItem = {
      id: `session-${number}`,
      title: `terminal-${number}`,
      profileId: profile.id,
      status: 'running',
      hasActivity: false,
      lastUsedLabel: 'Now',
      cwd: '~/projects/webpty',
      previewLines: [
        `new session ${number}`,
        '',
        `$ ${profile.shell}`,
        '',
        'This is a placeholder shell until the PTY layer is connected.',
        '',
        `profile: ${profile.name}`,
        `cwd: ~/projects/webpty`,
      ],
    }

    nextSessionIdRef.current += 1

    startTransition(() => {
      setSessions((currentSessions) => [
        ...currentSessions.map((session) =>
          session.lastUsedLabel === 'Now'
            ? {
                ...session,
                lastUsedLabel: 'moments ago',
              }
            : session,
        ),
        newSession,
      ])
      setActiveSessionId(newSession.id)
    })
  }

  function closeActiveSession() {
    if (sessions.length <= 1) {
      return
    }

    const currentIndex = sessions.findIndex((session) => session.id === activeSessionId)
    const nextIndex = currentIndex === 0 ? 1 : currentIndex - 1
    const nextSession = sessions[nextIndex]

    startTransition(() => {
      setSessions((currentSessions) =>
        currentSessions.filter((session) => session.id !== activeSessionId),
      )
      setActiveSessionId(nextSession.id)
    })
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
      createSession()
      return
    }

    if (key === 'w') {
      event.preventDefault()
      closeActiveSession()
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleWindowKeyDown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  }, [])

  return (
    <main className="terminal-app">
      <section className="terminal-window">
        <header className="window-topbar">
          <div className="app-title">
            <span className="app-mark">wt</span>
            <div>
              <strong>webpty</strong>
              <p>{activeSession.title}</p>
            </div>
          </div>

          <div className="topbar-status">
            <span className={`status-pill ${serverHealth.status === 'ok' ? 'is-live' : ''}`}>
              {serverHealth.status === 'ok' ? 'server online' : 'demo mode'}
            </span>
            <span className="status-pill subtle">{serverHealth.mode}</span>
          </div>

          <div className="topbar-actions">
            <button type="button" className="toolbar-button" onClick={createSession}>
              New
            </button>
            <button type="button" className="toolbar-button" onClick={closeActiveSession}>
              Close
            </button>
          </div>
        </header>

        <div className="window-body">
          <section className="terminal-stage">
            <div className="terminal-header">
              <div>
                <span className="header-label">Session</span>
                <strong>{activeSession.title}</strong>
              </div>
              <div>
                <span className="header-label">Profile</span>
                <strong>{activeProfile.name}</strong>
              </div>
              <div>
                <span className="header-label">Working directory</span>
                <strong>{activeSession.cwd}</strong>
              </div>
            </div>

            <div className="terminal-frame">
              <TerminalViewport
                active={true}
                accent={activeProfile.accent}
                lines={activeSession.previewLines}
              />
            </div>

            <footer className="terminal-statusbar">
              <span>{activeProfile.shell}</span>
              <span>{serverHealth.websocketPath}</span>
              <span>Ctrl+Tab switch</span>
              <span>Ctrl+T new</span>
              <span>Ctrl+W close</span>
            </footer>
          </section>

          <aside className="session-rail" aria-label="Sessions">
            <div className="session-rail-header">
              <strong>Sessions</strong>
              <span>{sessions.length}</span>
            </div>

            <div className="session-list">
              {sessions.map((session) => {
                const profile = profileById(session.profileId)

                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`session-item ${
                      session.id === activeSession.id ? 'is-active' : ''
                    }`}
                    onClick={() => activateSession(session.id)}
                  >
                    <span
                      className="session-accent"
                      style={{ backgroundColor: profile.accent }}
                    />
                    <div className="session-copy">
                      <div className="session-title-row">
                        <strong>{session.title}</strong>
                        {session.hasActivity ? <span className="session-badge">alert</span> : null}
                      </div>
                      <span>{profile.name}</span>
                      <span>{session.lastUsedLabel}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}

function profileById(profileId: string) {
  return profiles.find((profile) => profile.id === profileId) ?? profiles[0]
}

export default App
