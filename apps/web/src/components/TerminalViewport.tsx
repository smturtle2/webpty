import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useEffectEvent, useRef } from 'react'
import type { TerminalCursorShape, WindowsTerminalColorScheme } from '../types'

interface TerminalViewportProps {
  active: boolean
  sessionId: string
  fallbackLines: string[]
  canConnect: boolean
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorShape: TerminalCursorShape | undefined
  scheme: WindowsTerminalColorScheme
  onConnectionStateChange: (state: 'connecting' | 'live' | 'offline') => void
  onTranscriptChange: (sessionId: string, transcript: string) => void
}

export function TerminalViewport({
  active,
  sessionId,
  fallbackLines,
  canConnect,
  fontFamily,
  fontSize,
  lineHeight,
  cursorShape,
  scheme,
  onConnectionStateChange,
  onTranscriptChange,
}: TerminalViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const transcriptRef = useRef('')

  const reportConnectionState = useEffectEvent((state: 'connecting' | 'live' | 'offline') => {
    onConnectionStateChange(state)
  })

  const reportTranscript = useEffectEvent((nextSessionId: string, transcript: string) => {
    onTranscriptChange(nextSessionId, transcript)
  })

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

  const applyOutput = useEffectEvent((nextSessionId: string, payload: string) => {
    const term = termRef.current

    if (!term) {
      return
    }

    const currentTranscript = transcriptRef.current

    if (!currentTranscript) {
      transcriptRef.current = payload
      term.write(payload)
      reportTranscript(nextSessionId, transcriptRef.current)
      return
    }

    if (payload.startsWith(currentTranscript)) {
      const delta = payload.slice(currentTranscript.length)

      if (delta.length > 0) {
        term.write(delta)
        transcriptRef.current = payload
        reportTranscript(nextSessionId, transcriptRef.current)
      }

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

    const term = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorInactiveStyle: 'outline',
      fontFamily: 'Cascadia Mono',
      fontSize: 13,
      lineHeight: 1.22,
      letterSpacing: 0.1,
      scrollback: 2000,
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
      syncSize()
    })

    resizeObserver.observe(hostRef.current)
    syncSize()

    return () => {
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

    term.options.theme = toXtermTheme(scheme)
    term.options.fontFamily = fontFamily
    term.options.fontSize = fontSize
    term.options.lineHeight = lineHeight
    term.options.cursorStyle = mapCursorShape(cursorShape)
    syncSize()
  }, [cursorShape, fontFamily, fontSize, lineHeight, scheme])

  useEffect(() => {
    const term = termRef.current

    if (!term) {
      return
    }

    socketRef.current?.close()
    socketRef.current = null
    term.reset()
    transcriptRef.current = ''

    if (!canConnect) {
      const transcript = `${fallbackLines.join('\r\n')}\r\n`
      transcriptRef.current = transcript
      term.write(transcript)
      reportTranscript(sessionId, transcript)
      reportConnectionState('offline')
      syncSize()
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
        applyOutput(sessionId, message.data)
      }
    }

    const handleClose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null
        reportConnectionState('offline')
      }
    }

    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose)
    socket.addEventListener('error', handleClose)

    return () => {
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      socket.removeEventListener('error', handleClose)

      if (socketRef.current === socket) {
        socketRef.current = null
      }

      socket.close()
    }
  }, [canConnect, fallbackLines, sessionId])

  useEffect(() => {
    if (active) {
      termRef.current?.focus()
    }
  }, [active])

  return <div ref={hostRef} className="terminal-viewport" />
}

function mapCursorShape(shape: TerminalCursorShape | undefined): 'block' | 'bar' | 'underline' {
  if (shape === 'bar') {
    return 'bar'
  }

  if (shape === 'underscore' || shape === 'underline') {
    return 'underline'
  }

  return 'block'
}

function buildSocketUrl(sessionId: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/${encodeURIComponent(sessionId)}`
}

function parseMessage(value: string): { type: string; data?: string } | null {
  try {
    return JSON.parse(value) as { type: string; data?: string }
  } catch {
    return null
  }
}

function toXtermTheme(scheme: WindowsTerminalColorScheme) {
  return {
    background: scheme.background,
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
