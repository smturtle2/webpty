import type {
  PaletteAction,
  PaneSummary,
  ProfileDefinition,
  ResearchPillar,
  ServerHealth,
  SettingsSection,
  TabSummary,
} from '../types'

export const profiles: ProfileDefinition[] = [
  {
    id: 'shell',
    name: 'Design Shell',
    subtitle: 'Primary workspace',
    accent: '#ff9b54',
    icon: 'DS',
    shell: 'zsh --login',
  },
  {
    id: 'ops',
    name: 'Ops Stream',
    subtitle: 'Deploy and diagnostics',
    accent: '#73e0a9',
    icon: 'OP',
    shell: 'fish',
  },
  {
    id: 'notes',
    name: 'Release Notes',
    subtitle: 'Reference and snippets',
    accent: '#71c6ff',
    icon: 'RN',
    shell: 'markdown-preview',
  },
]

export const panes: Record<string, PaneSummary> = {
  'pane-shell': {
    id: 'pane-shell',
    sessionId: 'session-shell',
    profileId: 'shell',
    cwd: '~/projects/webpty',
    title: 'design-shell',
    status: 'running',
    cols: 118,
    rows: 34,
    previewLines: [
      'webpty :: shell',
      '',
      '$ cargo run --manifest-path apps/server/Cargo.toml',
      '   Compiling server v0.1.0',
      '   Listening on http://127.0.0.1:3001',
      '',
      '$ npm run dev:web',
      '  VITE v8.0.0  ready in 284 ms',
      '',
      'palette: tabs, panes, search, settings',
      'focus: active pane metrics and overlay choreography',
      '',
      'user@design-shell ~/projects/webpty %',
    ],
  },
  'pane-logs': {
    id: 'pane-logs',
    sessionId: 'session-logs',
    profileId: 'ops',
    cwd: '~/projects/webpty/logs',
    title: 'deploy-stream',
    status: 'attention',
    cols: 64,
    rows: 18,
    previewLines: [
      'ops stream',
      '',
      '[12:14:02] web socket upgraded: session-shell',
      '[12:14:07] palette opened from keyboard',
      '[12:14:11] search overlay attached to pane-shell',
      '[12:14:22] theme preview swapped to ember / slate',
      '[12:14:38] alert: deploy-staging tab reported bell',
      '',
      'tail -f runtime.log',
    ],
  },
  'pane-metrics': {
    id: 'pane-metrics',
    sessionId: 'session-metrics',
    profileId: 'notes',
    cwd: '~/projects/webpty/docs',
    title: 'ux-priority',
    status: 'idle',
    cols: 64,
    rows: 15,
    previewLines: [
      'ux targets',
      '',
      '1. tab state readable at a glance',
      '2. overlays centered and predictable',
      '3. settings searchable before editable',
      '4. no modal should orphan keyboard focus',
      '',
      'prototype status: shell-ready',
    ],
  },
  'pane-ops': {
    id: 'pane-ops',
    sessionId: 'session-ops',
    profileId: 'ops',
    cwd: '~/deploy/staging',
    title: 'deploy-staging',
    status: 'running',
    cols: 120,
    rows: 36,
    previewLines: [
      'staging deploy',
      '',
      '$ kubectl get pods',
      'api-7d4bf6cd7-ptfsw     1/1 Running',
      'worker-5dd87c8d7-v9kgv  1/1 Running',
      'ws-6f479cb4cc-gbr7j    1/1 Running',
      '',
      '$ cargo test',
      'running 12 tests',
      'test websocket_ping ... ok',
      'test blueprint_contract ... ok',
      '',
      'deploy@staging %',
    ],
  },
  'pane-notes': {
    id: 'pane-notes',
    sessionId: 'session-notes',
    profileId: 'notes',
    cwd: '~/projects/webpty/docs',
    title: 'release-notes',
    status: 'idle',
    cols: 98,
    rows: 36,
    previewLines: [
      '# release note staging',
      '',
      '- app shell mirrors Windows Terminal information density',
      '- command palette and tab switcher share one overlay frame',
      '- search remains anchored to the active pane',
      '- settings studio is navigable without touching raw JSON',
      '',
      'next: wire live PTY transport',
    ],
  },
}

export const tabs: TabSummary[] = [
  {
    id: 'tab-workspace',
    title: 'workspace-shell',
    profileId: 'shell',
    accent: '#ff9b54',
    hasBell: false,
    isDirty: true,
    lastUsedLabel: 'Now',
    primaryPaneId: 'pane-shell',
    layout: {
      type: 'split',
      axis: 'vertical',
      ratio: 0.66,
      children: [
        { type: 'pane', paneId: 'pane-shell' },
        {
          type: 'split',
          axis: 'horizontal',
          ratio: 0.56,
          children: [
            { type: 'pane', paneId: 'pane-logs' },
            { type: 'pane', paneId: 'pane-metrics' },
          ],
        },
      ],
    },
  },
  {
    id: 'tab-ops',
    title: 'deploy-staging',
    profileId: 'ops',
    accent: '#73e0a9',
    hasBell: true,
    isDirty: false,
    lastUsedLabel: '2m ago',
    primaryPaneId: 'pane-ops',
    layout: { type: 'pane', paneId: 'pane-ops' },
  },
  {
    id: 'tab-notes',
    title: 'release-notes',
    profileId: 'notes',
    accent: '#71c6ff',
    hasBell: false,
    isDirty: false,
    lastUsedLabel: '12m ago',
    primaryPaneId: 'pane-notes',
    layout: { type: 'pane', paneId: 'pane-notes' },
  },
]

export const paletteActions: PaletteAction[] = [
  {
    id: 'open-settings',
    title: 'Open settings studio',
    subtitle: 'Launch the navigation-driven configuration surface',
    shortcut: 'Ctrl+,',
    accent: '#f6c177',
  },
  {
    id: 'open-search',
    title: 'Find in active pane',
    subtitle: 'Attach search controls to the pane currently in focus',
    shortcut: 'Ctrl+Shift+F',
    accent: '#71c6ff',
  },
  {
    id: 'open-tab-switcher',
    title: 'Open MRU tab switcher',
    subtitle: 'Reuse the command palette shell for recent tab jumps',
    shortcut: 'Ctrl+Tab',
    accent: '#a2f8c8',
  },
  {
    id: 'new-review-tab',
    title: 'New tab with release notes',
    subtitle: 'Create or refocus a reference tab for rollout context',
    shortcut: 'Ctrl+Shift+N',
    accent: '#ff9b54',
  },
  {
    id: 'toggle-focus-mode',
    title: 'Toggle focus mode',
    subtitle: 'Collapse supporting chrome and spotlight the active pane',
    shortcut: 'Alt+Shift+F',
    accent: '#d6adff',
  },
]

export const settingsSections: SettingsSection[] = [
  {
    id: 'launch',
    label: 'Launch',
    description: 'Startup profile, landing layout, and initial workspace behavior.',
    fields: [
      {
        label: 'Default profile',
        value: 'Design Shell',
        note: 'Start in the shell profile used for main product work.',
      },
      {
        label: 'Startup layout',
        value: 'Restored workspace',
        note: 'Reuse the last tab and pane map where possible.',
      },
      {
        label: 'Window chrome',
        value: 'Custom web title area',
        note: 'Keep the top strip dense and information-rich.',
      },
    ],
  },
  {
    id: 'interaction',
    label: 'Interaction',
    description: 'Keyboard behavior, copy semantics, and palette switching.',
    fields: [
      {
        label: 'Tab switcher mode',
        value: 'MRU order',
        note: 'Match the Windows Terminal advanced switcher behavior.',
      },
      {
        label: 'Copy on select',
        value: 'Off',
        note: 'Preserve deliberate clipboard actions in the browser.',
      },
      {
        label: 'Focus follow mouse',
        value: 'Preview only',
        note: 'Enabled in the prototype chrome, not yet wired to PTY focus.',
      },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, terminal chrome contrast, and type system previews.',
    fields: [
      {
        label: 'Theme',
        value: 'Ember / Slate',
        note: 'Warm signal accents over a steel-toned workspace.',
      },
      {
        label: 'Terminal font',
        value: 'IBM Plex Mono 13px',
        note: 'Readable, utilitarian, and suitable for dense panes.',
      },
      {
        label: 'Background treatment',
        value: 'Layered gradients + grain',
        note: 'Replaces native acrylic with a web-safe atmospheric surface.',
      },
    ],
  },
  {
    id: 'actions',
    label: 'Actions',
    description: 'Palette-discoverable actions and keyboard dispatch.',
    fields: [
      {
        label: 'Command palette',
        value: 'Action + tab modes',
        note: 'One overlay frame handles commands and tab switching.',
      },
      {
        label: 'Nested actions',
        value: 'Planned',
        note: 'Reserved for pane navigation and contextual tab actions.',
      },
      {
        label: 'Open JSON',
        value: 'Deferred',
        note: 'Keep the primary path visual until schema stabilizes.',
      },
    ],
  },
  {
    id: 'new-tab-menu',
    label: 'New Tab Menu',
    description: 'Profile curation and hierarchy for fast session creation.',
    fields: [
      {
        label: 'Pinned entries',
        value: 'Design Shell, Ops Stream, Release Notes',
        note: 'Profiles should be launchable from one dense control.',
      },
      {
        label: 'Icon strategy',
        value: 'Two-letter profile marks',
        note: 'Readable at tab-row scale even before custom icon upload.',
      },
      {
        label: 'Pane shortcuts',
        value: 'Visible in tooltip',
        note: 'Reveal split destinations without opening settings.',
      },
    ],
  },
]

export const researchPillars: ResearchPillar[] = [
  {
    title: 'Tabs as control hub',
    body: 'The tab row is not just navigation. It exposes new-tab branching, profile identity, and session alerts.',
  },
  {
    title: 'Shared overlay grammar',
    body: 'Command palette and advanced tab switcher should feel like two modes of the same control, not separate widgets.',
  },
  {
    title: 'Settings as studio',
    body: 'Navigation, search, and previews matter more than raw JSON when the product is trying to teach its own model.',
  },
]

export const demoHealth: ServerHealth = {
  status: 'offline',
  message: 'Demo mode',
  websocketPath: '/ws/:session_id',
  mode: 'mock',
  features: ['prototype-ui', 'layout-state', 'palette-interactions'],
}
