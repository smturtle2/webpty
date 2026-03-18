import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type FontWeight } from '@xterm/xterm'
import { useEffect, useEffectEvent, useRef, type CSSProperties } from 'react'
import type { TerminalColorScheme, TerminalCursorShape } from '../types'

interface TerminalViewportProps {
  active: boolean
  sessionId: string
  fallbackLines: string[]
  canConnect: boolean
  fontFamily: string
  fontSize: number
  fontWeight: number | string
  lineHeight: number
  padding?: string
  opacity?: number
  cursorShape: TerminalCursorShape | undefined
  scheme: TerminalColorScheme
  onConnectionStateChange: (
    sessionId: string,
    state: 'connecting' | 'live' | 'offline',
  ) => void
  onShortcut: (event: KeyboardEvent) => boolean
  onTranscriptChange: (sessionId: string, transcript: string) => void
}

export function TerminalViewport({
  active,
  sessionId,
  fallbackLines,
  canConnect,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  padding,
  opacity,
  cursorShape,
  scheme,
  onConnectionStateChange,
  onShortcut,
  onTranscriptChange,
}: TerminalViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const transcriptRef = useRef('')
  const fallbackTranscriptRef = useRef(`${fallbackLines.join('\r\n')}\r\n`)
  const resizeTimerRef = useRef<number | null>(null)
  const deferredFitTimersRef = useRef<number[]>([])
  const deferredFitFramesRef = useRef<number[]>([])
  const initialViewportOptionsRef = useRef({
    cursorShape,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
  })

  const reportConnectionState = useEffectEvent((nextState: 'connecting' | 'live' | 'offline') => {
    onConnectionStateChange(sessionId, nextState)
  })

  const reportTranscript = useEffectEvent((nextSessionId: string, transcript: string) => {
    onTranscriptChange(nextSessionId, transcript)
  })

  const dispatchShortcut = useEffectEvent((event: KeyboardEvent) => onShortcut(event))

  useEffect(() => {
    fallbackTranscriptRef.current = `${fallbackLines.join('\r\n')}\r\n`
  }, [fallbackLines])

  const syncSize = useEffectEvent(() => {
    const fitAddon = fitRef.current
    const term = termRef.current
    const host = hostRef.current

    if (!fitAddon || !term || !host || host.clientWidth === 0 || host.clientHeight === 0) {
      return
    }

    try {
      fitAddon.fit()
    } catch {
      return
    }

    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }),
      )
    }
  })

  const scheduleSyncSize = useEffectEvent(() => {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current)
    }

    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null
      syncSize()
    }, 48)
  })

  const clearDeferredFits = useEffectEvent(() => {
    if (deferredFitFramesRef.current.length > 0) {
      for (const frameId of deferredFitFramesRef.current) {
        window.cancelAnimationFrame(frameId)
      }
      deferredFitFramesRef.current = []
    }

    if (deferredFitTimersRef.current.length > 0) {
      for (const timerId of deferredFitTimersRef.current) {
        window.clearTimeout(timerId)
      }
      deferredFitTimersRef.current = []
    }
  })

  const queueFitPasses = useEffectEvent(() => {
    clearDeferredFits()
    scheduleSyncSize()

    const firstFrame = window.requestAnimationFrame(() => {
      scheduleSyncSize()

      const secondFrame = window.requestAnimationFrame(() => {
        scheduleSyncSize()
      })
      deferredFitFramesRef.current.push(secondFrame)
    })
    deferredFitFramesRef.current.push(firstFrame)

    for (const delay of [120, 320, 720]) {
      const timerId = window.setTimeout(() => {
        scheduleSyncSize()
      }, delay)
      deferredFitTimersRef.current.push(timerId)
    }

    if (typeof document !== 'undefined' && 'fonts' in document) {
      void document.fonts.ready
        .then(() => {
          scheduleSyncSize()
        })
        .catch(() => {
          // ignore font-loading failures and keep the current terminal geometry
        })
    }
  })

  const applyOutput = useEffectEvent((nextSessionId: string, payload: string) => {
    const term = termRef.current

    if (!term || payload.length === 0) {
      return
    }

    transcriptRef.current += payload
    term.write(payload)
    reportTranscript(nextSessionId, transcriptRef.current)
  })

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const initialViewportOptions = initialViewportOptionsRef.current
    const term = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorInactiveStyle: 'outline',
      cursorStyle: mapCursorShape(initialViewportOptions.cursorShape),
      fontFamily: initialViewportOptions.fontFamily,
      fontSize: initialViewportOptions.fontSize,
      fontWeight: normalizeFontWeight(initialViewportOptions.fontWeight),
      lineHeight: initialViewportOptions.lineHeight,
      letterSpacing: 0.1,
      scrollback: 2000,
    })
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true
      }

      if (dispatchShortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
        return false
      }

      return true
    })
    const fitAddon = new FitAddon()
    const inputDisposable = term.onData((data) => {
      const socket = socketRef.current

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })

    term.loadAddon(fitAddon)
    term.open(hostRef.current)
    termRef.current = term
    fitRef.current = fitAddon

    const resizeObserver = new ResizeObserver(() => {
      scheduleSyncSize()
    })

    resizeObserver.observe(hostRef.current)
    queueFitPasses()

    const handleViewportResize = () => {
      queueFitPasses()
    }

    window.addEventListener('resize', handleViewportResize)
    window.visualViewport?.addEventListener('resize', handleViewportResize)

    return () => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
      }
      clearDeferredFits()
      window.removeEventListener('resize', handleViewportResize)
      window.visualViewport?.removeEventListener('resize', handleViewportResize)
      resizeObserver.disconnect()
      inputDisposable.dispose()
      socketRef.current?.close()
      socketRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current

    if (!term) {
      return
    }

    term.options.theme = toXtermTheme(scheme, opacity)
    term.options.fontFamily = fontFamily
    term.options.fontSize = fontSize
    term.options.fontWeight = normalizeFontWeight(fontWeight)
    term.options.lineHeight = lineHeight
    term.options.cursorStyle = mapCursorShape(cursorShape)
    queueFitPasses()
  }, [cursorShape, fontFamily, fontSize, fontWeight, lineHeight, opacity, padding, scheme])

  useEffect(() => {
    if (!active) {
      return
    }

    termRef.current?.focus()
  }, [active])

  useEffect(() => {
    const term = termRef.current

    if (!term) {
      return
    }

    socketRef.current?.close()
    socketRef.current = null
    term.clear()
    transcriptRef.current = ''

    if (!canConnect) {
      const transcript = fallbackTranscriptRef.current
      transcriptRef.current = transcript
      term.write(transcript)
      reportTranscript(sessionId, transcript)
      reportConnectionState('offline')
      scheduleSyncSize()
      return
    }

    reportConnectionState('connecting')

    const socket = new WebSocket(buildSocketUrl(sessionId))
    socketRef.current = socket

    const handleMessage = (event: MessageEvent<string>) => {
      const message = parseMessage(event.data)

      if (!message || !termRef.current) {
        return
      }

      if (message.type === 'ready') {
        reportConnectionState('live')
        return
      }

      if (message.type === 'output' && typeof message.data === 'string') {
        reportConnectionState('live')
        applyOutput(sessionId, message.data)
        return
      }

      if (
        message.type === 'resized' &&
        typeof message.cols === 'number' &&
        typeof message.rows === 'number'
      ) {
        scheduleSyncSize()
      }
    }

    const handleClose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null
        reportConnectionState('offline')
      }
    }

    const handleOpen = () => {
      reportConnectionState('live')
    }

    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose)
    socket.addEventListener('error', handleClose)

    return () => {
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      socket.removeEventListener('error', handleClose)

      if (socketRef.current === socket) {
        socketRef.current = null
      }

      socket.close()
    }
  }, [canConnect, sessionId])

  useEffect(() => {
    if (active) {
      termRef.current?.focus()
      queueFitPasses()
    }
  }, [active])

  return (
    <div
      ref={hostRef}
      className="terminal-viewport"
      style={{ '--terminal-padding': padding ?? '16px 18px 18px' } as CSSProperties}
    />
  )
}

function mapCursorShape(shape: TerminalCursorShape | undefined): 'block' | 'bar' | 'underline' {
  if (shape === 'bar') {
    return 'bar'
  }

  if (shape === 'underscore' || shape === 'underline' || shape === 'doubleUnderscore') {
    return 'underline'
  }

  return 'block'
}

function normalizeFontWeight(value: number | string): FontWeight {
  if (typeof value === 'number') {
    return value
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'normal' || normalized === 'bold') {
    return normalized
  }

  if (/^[1-9]00$/.test(normalized)) {
    return normalized as FontWeight
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 'normal'
}

function buildSocketUrl(sessionId: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host

  return `${protocol}//${host}/ws/${encodeURIComponent(sessionId)}`
}

function parseMessage(
  value: string,
): { type: string; data?: string; cols?: number; rows?: number } | null {
  try {
    return JSON.parse(value) as {
      type: string
      data?: string
      cols?: number
      rows?: number
    }
  } catch {
    return null
  }
}

function toXtermTheme(scheme: TerminalColorScheme, opacity?: number) {
  return {
    background: applyOpacity(scheme.background, opacity),
    foreground: scheme.foreground,
    cursor: scheme.cursorColor ?? scheme.foreground,
    cursorAccent: scheme.background,
    selectionBackground: scheme.selectionBackground ?? '#264f78',
    black: scheme.black ?? '#0c0c0c',
    red: scheme.red ?? '#c50f1f',
    green: scheme.green ?? '#13a10e',
    yellow: scheme.yellow ?? '#c19c00',
    blue: scheme.blue ?? '#0037da',
    magenta: scheme.purple ?? '#881798',
    cyan: scheme.cyan ?? '#3a96dd',
    white: scheme.white ?? '#cccccc',
    brightBlack: scheme.brightBlack ?? '#767676',
    brightRed: scheme.brightRed ?? '#e74856',
    brightGreen: scheme.brightGreen ?? '#16c60c',
    brightYellow: scheme.brightYellow ?? '#f9f1a5',
    brightBlue: scheme.brightBlue ?? '#3b78ff',
    brightMagenta: scheme.brightPurple ?? '#b4009e',
    brightCyan: scheme.brightCyan ?? '#61d6d6',
    brightWhite: scheme.brightWhite ?? '#f2f2f2',
  }
}

function applyOpacity(color: string, opacity = 100) {
  if (opacity >= 100) {
    return color
  }

  const normalized = color.trim()
  const value = Math.min(100, Math.max(0, opacity)) / 100

  if (normalized.startsWith('#')) {
    const parsed = parseHex(normalized)

    if (!parsed) {
      return color
    }

    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${value})`
  }

  return color
}

function parseHex(color: string) {
  const hex = color.slice(1)

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
