import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

interface TerminalViewportProps {
  active: boolean
  accent: string
  lines: string[]
}

export function TerminalViewport({
  active,
  accent,
  lines,
}: TerminalViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const term = new Terminal({
      convertEol: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      disableStdin: true,
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0.2,
      theme: {
        background: '#101318',
        foreground: '#ebf0f4',
        selectionBackground: '#274b68',
        black: '#0a0d10',
        red: '#ff7a59',
        green: '#7ce2ad',
        yellow: '#f7c76a',
        blue: '#71c6ff',
        magenta: '#dba3ff',
        cyan: '#5ed8d8',
        white: '#f3f7fa',
        brightBlack: '#64717f',
        brightRed: '#ff9a7c',
        brightGreen: '#a2f8c8',
        brightYellow: '#ffe1a0',
        brightBlue: '#9edcff',
        brightMagenta: '#e5bdfc',
        brightCyan: '#97f0ee',
        brightWhite: '#ffffff',
      },
    })
    const fitAddon = new FitAddon()

    term.loadAddon(fitAddon)
    term.open(hostRef.current)

    termRef.current = term
    fitRef.current = fitAddon

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })

    resizeObserver.observe(hostRef.current)
    fitAddon.fit()

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    const fitAddon = fitRef.current

    if (!term || !fitAddon) {
      return
    }

    term.reset()
    fitAddon.fit()

    lines.forEach((line) => {
      term.writeln(line)
    })
  }, [lines])

  useEffect(() => {
    const term = termRef.current

    if (!term) {
      return
    }

    hostRef.current?.style.setProperty('--pane-accent', accent)
    if (active) {
      term.focus()
    }
  }, [accent, active])

  return <div ref={hostRef} className="terminal-viewport" />
}
