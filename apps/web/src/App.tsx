import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, ReactNode } from 'react'
import './App.css'
import {
  demoHealth,
  paletteActions,
  panes,
  profiles,
  researchPillars,
  settingsSections,
  tabs as seededTabs,
} from './data/demo'
import { TerminalViewport } from './components/TerminalViewport'
import type {
  LayoutNode,
  OverlayState,
  PaneSummary,
  ServerHealth,
  TabSummary,
} from './types'

type SearchDirection = 'up' | 'down'

interface PaletteItem {
  id: string
  title: string
  subtitle: string
  shortcut: string
  accent: string
  type: 'action' | 'tab'
  tabId?: string
}

const releaseTabTemplate: TabSummary = {
  id: 'tab-release-brief',
  title: 'release-brief',
  profileId: 'notes',
  accent: '#71c6ff',
  hasBell: false,
  isDirty: false,
  lastUsedLabel: 'New',
  primaryPaneId: 'pane-notes',
  layout: { type: 'pane', paneId: 'pane-notes' },
}

function App() {
  const [tabs, setTabs] = useState(seededTabs)
  const [activeTabId, setActiveTabId] = useState(seededTabs[0].id)
  const [activePaneId, setActivePaneId] = useState(seededTabs[0].primaryPaneId)
  const [mruTabIds, setMruTabIds] = useState(seededTabs.map((tab) => tab.id))
  const [overlay, setOverlay] = useState<OverlayState>('none')
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [settingsSectionId, setSettingsSectionId] = useState(settingsSections[0].id)
  const [settingsSearch, setSettingsSearch] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const [serverHealth, setServerHealth] = useState<ServerHealth>(demoHealth)
  const [searchQuery, setSearchQuery] = useState('deploy')
  const [searchDirection, setSearchDirection] = useState<SearchDirection>('down')
  const [caseSensitive, setCaseSensitive] = useState(false)

  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const settingsInputRef = useRef<HTMLInputElement | null>(null)

  const deferredPaletteQuery = useDeferredValue(paletteQuery)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const activePane = panes[activePaneId]

  const paletteItems: PaletteItem[] =
    overlay === 'tab-switcher'
      ? mruTabIds
          .map((tabId) => tabs.find((tab) => tab.id === tabId))
          .filter((tab): tab is TabSummary => Boolean(tab))
          .map((tab, index) => ({
            id: `tab-${tab.id}`,
            title: tab.title,
            subtitle: `${profileLabel(tab.profileId)} · ${tab.lastUsedLabel}`,
            shortcut: index < 9 ? `${index + 1}` : 'MRU',
            accent: tab.accent,
            type: 'tab',
            tabId: tab.id,
          }))
      : paletteActions.map((action) => ({
          id: action.id,
          title: action.title,
          subtitle: action.subtitle,
          shortcut: action.shortcut,
          accent: action.accent,
          type: 'action',
        }))

  const filteredPaletteItems = paletteItems.filter((item) => {
    const query = deferredPaletteQuery.trim().toLowerCase()

    if (!query) {
      return true
    }

    return (
      item.title.toLowerCase().includes(query) ||
      item.subtitle.toLowerCase().includes(query)
    )
  })

  const settingsMatches = settingsSections.filter((section) => {
    const query = settingsSearch.trim().toLowerCase()

    if (!query) {
      return true
    }

    return (
      section.label.toLowerCase().includes(query) ||
      section.description.toLowerCase().includes(query)
    )
  })

  const currentPaletteIndex =
    filteredPaletteItems.length === 0
      ? 0
      : Math.min(paletteIndex, filteredPaletteItems.length - 1)

  const activeSettingsSection =
    settingsMatches.find((section) => section.id === settingsSectionId) ??
    settingsMatches[0] ??
    settingsSections[0]

  const searchResultCount = countMatches(activePane, searchQuery, caseSensitive)

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

  useEffect(() => {
    if (overlay === 'palette' || overlay === 'tab-switcher') {
      paletteInputRef.current?.focus()
    }

    if (overlay === 'search') {
      searchInputRef.current?.focus()
    }

    if (overlay === 'settings') {
      settingsInputRef.current?.focus()
    }
  }, [overlay])

  function openOverlay(nextOverlay: OverlayState) {
    startTransition(() => {
      setOverlay(nextOverlay)
      setPaletteQuery('')
      setPaletteIndex(0)
    })
  }

  function closeOverlay() {
    startTransition(() => {
      setOverlay('none')
      setPaletteQuery('')
    })
  }

  function commitPaletteItem(item: PaletteItem) {
    if (item.type === 'tab' && item.tabId) {
      activateTab(item.tabId)
      closeOverlay()
      return
    }

    switch (item.id) {
      case 'open-settings':
        setOverlay('settings')
        break
      case 'open-search':
        setOverlay('search')
        break
      case 'open-tab-switcher':
        setOverlay('tab-switcher')
        break
      case 'new-review-tab': {
        const existing = tabs.find((tab) => tab.id === releaseTabTemplate.id)

        if (existing) {
          activateTab(existing.id)
        } else {
          setTabs((currentTabs) => [...currentTabs, releaseTabTemplate])
          activateTab(releaseTabTemplate.id, releaseTabTemplate.primaryPaneId)
        }
        setOverlay('none')
        break
      }
      case 'toggle-focus-mode':
        setFocusMode((current) => !current)
        setOverlay('none')
        break
      default:
        setOverlay('none')
    }
  }

  function activateTab(tabId: string, nextPaneId?: string) {
    const nextTab = tabs.find((tab) => tab.id === tabId)

    if (!nextTab && tabId !== releaseTabTemplate.id) {
      return
    }

    const targetPaneId =
      nextPaneId ?? nextTab?.primaryPaneId ?? releaseTabTemplate.primaryPaneId

    setActiveTabId(tabId)
    setActivePaneId(targetPaneId)
    setMruTabIds((current) => [tabId, ...current.filter((id) => id !== tabId)])
  }

  const handleWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const command = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (command && event.shiftKey && key === 'p') {
      event.preventDefault()
      openOverlay('palette')
      return
    }

    if (command && key === 'tab') {
      event.preventDefault()
      openOverlay('tab-switcher')
      return
    }

    if (command && event.shiftKey && key === 'f') {
      event.preventDefault()
      openOverlay('search')
      return
    }

    if (command && key === ',') {
      event.preventDefault()
      openOverlay('settings')
      return
    }

    if (event.key === 'Escape' && overlay !== 'none') {
      event.preventDefault()
      closeOverlay()
      return
    }

    if ((overlay === 'palette' || overlay === 'tab-switcher') && filteredPaletteItems.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPaletteIndex((current) => (current + 1) % filteredPaletteItems.length)
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setPaletteIndex((current) =>
          current === 0 ? filteredPaletteItems.length - 1 : current - 1,
        )
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const item = filteredPaletteItems[currentPaletteIndex]

        if (item) {
          commitPaletteItem(item)
        }
      }
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleWindowKeyDown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  }, [])

  function renderLayout(node: LayoutNode): ReactNode {
    if (node.type === 'pane') {
      const pane = panes[node.paneId]
      const profile = profileById(pane.profileId)

      return (
        <button
          key={pane.id}
          type="button"
          className={`pane-card ${pane.id === activePaneId ? 'is-active' : ''}`}
          onClick={() => setActivePaneId(pane.id)}
        >
          <div className="pane-header">
            <div>
              <span className="pane-kicker">{profile.name}</span>
              <strong>{pane.title}</strong>
            </div>
            <div className="pane-meta">
              <span className={`state-dot state-${pane.status}`} />
              <span>
                {pane.cols}×{pane.rows}
              </span>
            </div>
          </div>

          <div className="pane-subheader">
            <span>{pane.cwd}</span>
            <span>{profile.shell}</span>
          </div>

          <TerminalViewport
            active={pane.id === activePaneId}
            accent={profile.accent}
            lines={pane.previewLines}
          />
        </button>
      )
    }

    const [first, second] = node.children
    const firstBasis = `${Math.round(node.ratio * 100)}%`
    const secondBasis = `${Math.round((1 - node.ratio) * 100)}%`

    return (
      <div className={`split split-${node.axis}`}>
        <div className="split-child" style={{ flexBasis: firstBasis }}>
          {renderLayout(first)}
        </div>
        <div className="split-child" style={{ flexBasis: secondBasis }}>
          {renderLayout(second)}
        </div>
      </div>
    )
  }

  return (
    <main className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
      <aside className="mission-rail">
        <div className="rail-brand">
          <p className="eyebrow">Rust-backed web terminal</p>
          <h1>webpty</h1>
          <p className="rail-copy">
            A UI/UX-first terminal workspace modeled after the strongest workflows in
            Windows Terminal, then rebuilt for browser constraints.
          </p>
        </div>

        <section className="rail-panel">
          <div className="panel-label">Research pillars</div>
          <div className="pillar-stack">
            {researchPillars.map((pillar) => (
              <article key={pillar.title} className="pillar-card">
                <h2>{pillar.title}</h2>
                <p>{pillar.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rail-panel compact">
          <div className="panel-label">Quick controls</div>
          <div className="chip-row">
            <button type="button" className="rail-chip" onClick={() => openOverlay('palette')}>
              Palette
            </button>
            <button
              type="button"
              className="rail-chip"
              onClick={() => openOverlay('tab-switcher')}
            >
              Switcher
            </button>
            <button type="button" className="rail-chip" onClick={() => openOverlay('search')}>
              Search
            </button>
            <button type="button" className="rail-chip" onClick={() => openOverlay('settings')}>
              Settings
            </button>
          </div>
        </section>
      </aside>

      <section className="workspace-shell">
        <header className="workspace-header">
          <div className="header-block">
            <p className="eyebrow">Prototype shell</p>
            <strong>Shared overlay grammar, pane-aware search, settings studio</strong>
          </div>

          <div className="header-pills">
            <span className={`runtime-pill is-${serverHealth.status}`}>
              {serverHealth.status === 'ok' ? 'Server online' : 'Demo mode'}
            </span>
            <span className="runtime-pill subtle">{serverHealth.mode}</span>
            <span className="runtime-pill subtle">{serverHealth.websocketPath}</span>
          </div>
        </header>

        <div className="window-frame">
          <div className="window-titlebar">
            <div className="window-title">
              <span className="title-badge">WT</span>
              <div>
                <strong>workspace / webpty</strong>
                <p>{serverHealth.message}</p>
              </div>
            </div>

            <div className="window-actions">
              <button type="button" className="ghost-button" onClick={() => setFocusMode((current) => !current)}>
                {focusMode ? 'Exit Focus' : 'Focus Mode'}
              </button>
              <button type="button" className="ghost-button" onClick={() => openOverlay('settings')}>
                Settings
              </button>
            </div>
          </div>

          <div className="tab-row">
            <div className="tab-strip">
              {tabs.map((tab) => {
                const profile = profileById(tab.profileId)

                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`tab-pill ${tab.id === activeTabId ? 'is-active' : ''}`}
                    onClick={() => activateTab(tab.id)}
                    style={{ '--tab-accent': tab.accent } as CSSProperties}
                  >
                    <span className="tab-icon">{profile.icon}</span>
                    <span className="tab-title">{tab.title}</span>
                    {tab.hasBell ? <span className="tab-marker bell">Bell</span> : null}
                    {tab.isDirty ? <span className="tab-marker dirty">Live</span> : null}
                  </button>
                )
              })}
            </div>

            <button type="button" className="new-tab-button" onClick={() => openOverlay('palette')}>
              + New / Split
            </button>
          </div>

          <div className="workspace-meta">
            <div>
              <span className="meta-label">Active tab</span>
              <strong>{activeTab.title}</strong>
            </div>
            <div>
              <span className="meta-label">Active pane</span>
              <strong>{activePane.title}</strong>
            </div>
            <div>
              <span className="meta-label">Shortcuts</span>
              <strong>Ctrl+Shift+P / Ctrl+Tab / Ctrl+Shift+F</strong>
            </div>
          </div>

          <div className="workspace-canvas">{renderLayout(activeTab.layout)}</div>

          <footer className="workspace-statusbar">
            <span>profiles {profiles.length}</span>
            <span>tabs {tabs.length}</span>
            <span>active overlay {overlay}</span>
            <span>focus {focusMode ? 'spotlight' : 'multi-pane'}</span>
          </footer>
        </div>
      </section>

      {(overlay === 'palette' || overlay === 'tab-switcher') && (
        <div className="overlay-scrim" onClick={closeOverlay}>
          <section
            className="command-palette"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="palette-header">
              <p className="eyebrow">
                {overlay === 'palette' ? 'Command palette' : 'Advanced tab switcher'}
              </p>
              <strong>
                {overlay === 'palette'
                  ? 'Action mode for workspace control'
                  : 'MRU mode for fast tab traversal'}
              </strong>
            </div>

            <input
              ref={paletteInputRef}
              className="palette-input"
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder={
                overlay === 'palette'
                  ? 'Search commands, settings, and launch actions'
                  : 'Filter tabs by profile, title, or recency'
              }
            />

            <div className="palette-list" role="listbox" aria-label="Palette results">
              {filteredPaletteItems.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`palette-item ${
                    index === currentPaletteIndex ? 'is-selected' : ''
                  }`}
                  onMouseEnter={() => setPaletteIndex(index)}
                  onClick={() => commitPaletteItem(item)}
                  style={{ '--item-accent': item.accent } as CSSProperties}
                >
                  <div className="palette-index">{item.shortcut}</div>
                  <div className="palette-copy">
                    <strong>{item.title}</strong>
                    <span>{item.subtitle}</span>
                  </div>
                  <div className="palette-kind">{item.type === 'tab' ? 'Tab' : 'Action'}</div>
                </button>
              ))}

              {!filteredPaletteItems.length ? (
                <div className="palette-empty">
                  No matches. The final product should keep tab and action search in one overlay
                  grammar.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {overlay === 'search' && (
        <div className="search-overlay">
          <div className="search-card">
            <div className="search-header">
              <div>
                <p className="eyebrow">Find in active pane</p>
                <strong>{activePane.title}</strong>
              </div>
              <button type="button" className="icon-button" onClick={closeOverlay}>
                ✕
              </button>
            </div>

            <input
              ref={searchInputRef}
              className="search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search the active terminal preview"
            />

            <div className="search-controls">
              <button
                type="button"
                className={`toggle-chip ${searchDirection === 'up' ? 'is-on' : ''}`}
                onClick={() => setSearchDirection('up')}
              >
                Up
              </button>
              <button
                type="button"
                className={`toggle-chip ${searchDirection === 'down' ? 'is-on' : ''}`}
                onClick={() => setSearchDirection('down')}
              >
                Down
              </button>
              <button
                type="button"
                className={`toggle-chip ${caseSensitive ? 'is-on' : ''}`}
                onClick={() => setCaseSensitive((current) => !current)}
              >
                Aa
              </button>
            </div>

            <div className="search-results">
              <span>{searchResultCount} matches</span>
              <span>{searchDirection} from current selection</span>
            </div>
          </div>
        </div>
      )}

      {overlay === 'settings' && (
        <div className="overlay-scrim" onClick={closeOverlay}>
          <section className="settings-sheet" onClick={(event) => event.stopPropagation()}>
            <aside className="settings-nav">
              <div className="settings-nav-header">
                <p className="eyebrow">Settings studio</p>
                <strong>Globals and profiles</strong>
              </div>

              <input
                ref={settingsInputRef}
                className="settings-search"
                value={settingsSearch}
                onChange={(event) => setSettingsSearch(event.target.value)}
                placeholder="Search settings"
              />

              <nav className="settings-nav-list">
                {settingsMatches.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`settings-nav-item ${
                      section.id === activeSettingsSection.id ? 'is-active' : ''
                    }`}
                    onClick={() => setSettingsSectionId(section.id)}
                  >
                    <strong>{section.label}</strong>
                    <span>{section.description}</span>
                  </button>
                ))}
              </nav>
            </aside>

            <div className="settings-content">
              <header className="settings-content-header">
                <div>
                  <p className="eyebrow">Section</p>
                  <strong>{activeSettingsSection.label}</strong>
                </div>
                <button type="button" className="ghost-button" onClick={closeOverlay}>
                  Close
                </button>
              </header>

              <p className="settings-description">{activeSettingsSection.description}</p>

              <div className="settings-preview">
                <div className="theme-swatch ember" />
                <div className="theme-swatch mint" />
                <div className="theme-swatch ice" />
              </div>

              <div className="settings-grid">
                {activeSettingsSection.fields.map((field) => (
                  <article key={field.label} className="setting-card">
                    <span className="setting-label">{field.label}</span>
                    <strong>{field.value}</strong>
                    <p>{field.note}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function countMatches(
  pane: PaneSummary | undefined,
  query: string,
  caseSensitive: boolean,
) {
  if (!pane || !query.trim()) {
    return 0
  }

  const haystack = pane.previewLines.join('\n')
  const source = caseSensitive ? haystack : haystack.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()

  return source.split(needle).length - 1
}

function profileById(profileId: string) {
  return profiles.find((profile) => profile.id === profileId) ?? profiles[0]
}

function profileLabel(profileId: string) {
  return profileById(profileId).name
}

export default App
