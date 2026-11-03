import { useCallback, useEffect, useRef, useState } from 'react'
import type { Engine } from './engine.ts'
import { runHost } from './hostCli.ts'
import { iosPrompt, runIos } from './iosCli.ts'
import type { TermStore } from './termStore.ts'

interface Props {
  eng: Engine
  devId: string
  store: TermStore
  stopLabel: string
  /** Called with every command typed (for the history). */
  onCommand?: (line: string) => void
}

export function Terminal({ eng, devId, store, stopLabel, onCommand }: Props) {
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])
  const [input, setInput] = useState('')
  const [histPos, setHistPos] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dev = eng.dev(devId)
  const isIos = dev?.kind === 'router' || dev?.kind === 'switch'
  const prompt = dev ? (isIos ? iosPrompt(dev, store.session) : 'C:\\>') : ''

  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight)
  })
  useEffect(() => {
    inputRef.current?.focus()
  }, [devId])

  const stop = useCallback(() => {
    store.running?.stop()
    store.setRunning(null)
    rerender()
  }, [store, rerender])

  // Ctrl+C anywhere stops a running command, like a real console.
  const running = !!store.running
  useEffect(() => {
    if (!running) return
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        stop()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [running, stop])

  if (!dev) return null

  const out = (text: string, inline?: boolean) => {
    store.print(text, inline)
    rerender()
  }

  const submit = () => {
    const line = input
    setInput('')
    setHistPos(-1)
    out(prompt + line)
    store.remember(line)
    if (line.trim()) onCommand?.(line.trim())
    if (line.trim().toLowerCase() === 'cls' && !isIos) {
      store.clear()
      rerender()
      return
    }
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      store.setRunning(null)
      if (!isIos) out('')
      rerender()
      setTimeout(() => inputRef.current?.focus(), 0)
    }
    const r = isIos ? runIos(eng, devId, store.session, line, out, done) : runHost(eng, devId, line, out, done)
    if (!finished) store.setRunning(r)
    rerender()
  }

  return (
    <div className="term" onClick={() => inputRef.current?.focus()}>
      <div className="term-out" ref={box}>
        {store.lines.map((l, i) => (
          <div key={i} className="term-line">
            {l || '\u00a0'}
          </div>
        ))}
        {!running && (
          <div className="term-input-row">
            <span>{prompt}</span>
            <input
              ref={inputRef}
              value={input}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  const p = Math.min(histPos + 1, store.history.length - 1)
                  if (p >= 0) {
                    setHistPos(p)
                    setInput(store.history[p])
                  }
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  const p = histPos - 1
                  setHistPos(Math.max(-1, p))
                  setInput(p >= 0 ? store.history[p] : '')
                }
              }}
            />
          </div>
        )}
      </div>
      {running && (
        <button className="term-stop" onClick={stop}>
          ■ {stopLabel} (Ctrl+C)
        </button>
      )}
    </div>
  )
}
