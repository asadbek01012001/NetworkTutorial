import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPE } from 'react'
import { useI18n } from '../i18n/context'
import { DevicePanel } from './DevicePanel.tsx'
import { Engine, type EchoResult, type Proto } from './engine.ts'
import { runHost } from './hostCli.ts'
import { DeviceIcon, PaletteIcon } from './icons.tsx'
import { newSession, runIos } from './iosCli.ts'
import { PROTO_CLASS, PROTOS, type HistEntry, type Pdu } from './labUtil.ts'
import { EXAMPLES, example, isHost, shortPort, type Device, type DeviceKind, type ExampleId, type LinkEnd, type Topology } from './model.ts'
import { inSubnet } from './net.ts'
import { EventDetails, HistoryPanel, InspectPopup, PduPanel, SimPanel, StatsPanel } from './panels.tsx'
import { MAX_ZOOM, MIN_ZOOM, useCamera } from './useCamera.ts'
import type { TermStore } from './termStore.ts'
import './lab.css'

/** How far devices may be dragged from the origin. */
const WORLD = 5000
/** Simulation units per real second. */
const REAL_RATE = 7
const SIM_RATE = 2
const HISTORY_MAX = 500

type NewEntry = HistEntry extends infer E ? (E extends HistEntry ? Omit<E, 'at'> : never) : never
const stamp = (h: NewEntry) => ({ ...h, at: Date.now() }) as HistEntry

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore (private mode, quota)
  }
}

const ECHO_REASON: Record<Exclude<EchoResult['kind'], 'reply'>, string> = {
  timeout: 'Request timed out',
  unreachable: 'Destination host unreachable',
  'ttl-expired': 'TTL expired in transit',
  general: 'General failure',
}

type Tool = 'select' | 'cable' | 'pdu' | 'inspect' | 'delete'

export function Lab({ onClose, username }: { onClose: () => void; username: string }) {
  const { t } = useI18n()
  // Every account keeps its own workspace and history in this browser.
  const topoKey = `network-lab-v1:${username}`
  const histKey = `network-lab-history:${username}`

  const eng = useMemo(() => {
    const saved = readJson<Topology>(topoKey)
    const ok = saved && Array.isArray(saved.devices) && Array.isArray(saved.links)
    const e = new Engine(ok ? saved : example('router'))
    e.reset()
    return e
  }, [topoKey])
  useSyncExternalStore(eng.subscribe, eng.getVersion)

  const [mode, setMode] = useState<'real' | 'sim'>('real')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<string | null>(null)
  const [cableFrom, setCableFrom] = useState<LinkEnd | null>(null)
  const [pduFrom, setPduFrom] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ dev: string } | null>(null)
  const [eventSel, setEventSel] = useState<number | null>(null)
  const [filter, setFilter] = useState<Set<Proto>>(() => new Set(PROTOS))
  const [pdus, setPdus] = useState<Pdu[]>([])
  const [history, setHistory] = useState<HistEntry[]>(() => readJson<HistEntry[]>(histKey) ?? [])
  const [showHistory, setShowHistory] = useState(false)
  const [inspect, setInspect] = useState<{ title: string; text: string } | null>(null)
  const [terms] = useState(() => new Map<string, TermStore>())
  const stepTarget = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Small screens start with the bottom panel folded to give the map room.
  const [bottomOpen, setBottomOpen] = useState(() => window.innerWidth > 760 && window.innerHeight > 640)
  const { cam, setCam, size, viewBox, zoomAt, fit } = useCamera(wrapRef, () => {
    const ds = eng.topo.devices
    if (!ds.length) return null
    return {
      minX: Math.min(...ds.map((d) => d.x)) - 50,
      minY: Math.min(...ds.map((d) => d.y)) - 45,
      maxX: Math.max(...ds.map((d) => d.x)) + 50,
      maxY: Math.max(...ds.map((d) => d.y)) + 80,
    }
  })
  // Background drag pans the view; two fingers pinch-zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pan = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null)
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pduSeq = useRef(1)

  const record = useCallback(
    (h: NewEntry) =>
      setHistory((old) => {
        const next = [...old, stamp(h)].slice(-HISTORY_MAX)
        writeJson(histKey, next)
        return next
      }),
    [histKey],
  )

  // Every change made through the engine goes into the history.
  useEffect(() => {
    return eng.listen((a) => {
      if (a.type === 'connect' || a.type === 'disconnect') record({ kind: a.type, a: a.a, b: a.b })
      else record({ kind: a.type, dev: a.dev })
    })
  }, [eng, record])

  // ---- clock ----
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const running = mode === 'real' || playing || stepTarget.current !== null
      if (running) {
        let target = eng.now + dt * (mode === 'real' ? REAL_RATE : SIM_RATE * speed)
        if (stepTarget.current !== null && mode === 'sim' && !playing && target >= stepTarget.current) {
          target = stepTarget.current
          stepTarget.current = null
        }
        eng.advance(target)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [eng, mode, playing, speed])

  // ---- autosave ----
  useEffect(() => {
    const id = window.setTimeout(() => writeJson(topoKey, eng.topo), 600)
    return () => window.clearTimeout(id)
  })

  const cancelPending = () => {
    setPicker(null)
    setCableFrom(null)
    setPduFrom(null)
  }

  // ---- keys ----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === 'Escape') {
        if (picker || cableFrom || pduFrom) {
          setPicker(null)
          setCableFrom(null)
          setPduFrom(null)
        } else if (inspect) setInspect(null)
        else if (eventSel !== null) setEventSel(null)
        else if (showHistory) setShowHistory(false)
        else if (selected) setSelected(null)
        else onClose()
      } else if (!typing && (e.key === '+' || e.key === '=')) zoomAt(1.2)
      else if (!typing && e.key === '-') zoomAt(1 / 1.2)
      else if (!typing && e.key === '0') fit()
      else if (e.key === 'Delete' && !typing && selected) {
        eng.removeDevice(selected)
        setSelected(null)
      }
    }
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = ''
    }
  }, [eng, picker, cableFrom, pduFrom, inspect, eventSel, showHistory, selected, onClose, zoomAt, fit])

  const toSvg = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }, [])

  const addDevice = (kind: DeviceKind) => {
    // Nearest free grid spot to the middle of the current view.
    const cx = Math.round((cam.x + size.w / 2 / cam.z) / 20) * 20
    const cy = Math.round((cam.y + size.h / 2 / cam.z) / 20) * 20
    let spot = { x: cx, y: cy }
    search: for (let ring = 0; ring < 12; ring++) {
      for (let i = -ring; i <= ring; i++) {
        for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
          const x = cx + dx * 140
          const y = cy + dy * 130
          if (eng.topo.devices.every((o) => Math.hypot(o.x - x, o.y - y) > 110)) {
            spot = { x, y }
            break search
          }
        }
      }
    }
    const d = eng.addDevice(kind, spot.x, spot.y)
    setTool('select')
    setSelected(d.id)
  }

  const examples: Record<ExampleId, string> = { lan: t.exLan, router: t.exRouter, tworouters: t.exTwoRouters, dhcp: t.exDhcp, empty: t.exEmpty }
  const loadExample = (id: ExampleId) => {
    terms.clear()
    eng.replaceTopology(example(id))
    requestAnimationFrame(fit)
    setSelected(null)
    cancelPending()
    setEventSel(null)
    setPdus([])
    record({ kind: 'example', name: examples[id] })
  }

  // ---- simple PDU: one ICMP echo chosen with the mouse ----
  /** Address to ping on a device: a host's IP, or the router port facing the sender. */
  const targetIp = (src: Device, dst: Device): string | undefined => {
    if (isHost(dst.kind)) return eng.hostConfig(dst)?.ip
    if (dst.kind !== 'router') return undefined
    const ports = dst.ports.filter((p) => p.ip && p.mask && eng.portUp(dst, p))
    const srcIp = isHost(src.kind) ? eng.hostConfig(src)?.ip : undefined
    return (srcIp ? ports.find((p) => inSubnet(srcIp, p.ip!, p.mask!)) : undefined)?.ip ?? ports[0]?.ip
  }
  const sourceHasIp = (d: Device) => (isHost(d.kind) ? !!eng.hostConfig(d) : d.kind === 'router' && d.ports.some((p) => p.ip))

  const firePdu = (p: Pdu) => {
    const patch = (x: Partial<Pdu>) => setPdus((list) => list.map((q) => (q.num === p.num ? { ...q, ...x } : q)))
    const src = eng.dev(p.src)
    const dst = eng.dev(p.dst)
    const ip = src && dst ? targetIp(src, dst) : undefined
    if (!src || !dst || !ip || !sourceHasIp(src)) {
      patch({ status: 'fail', reason: t.pduNoIp, dstIp: ip })
      record({ kind: 'pdu', a: p.srcName, b: p.dstName, ok: false })
      return
    }
    patch({ status: 'pending', reason: undefined, dstIp: ip })
    eng.echo(src.id, ip, { id: 3000 + p.num, seq: p.num }, (r) => {
      const ok = r.kind === 'reply'
      patch({ status: ok ? 'ok' : 'fail', reason: r.kind === 'reply' ? undefined : ECHO_REASON[r.kind] })
      record({ kind: 'pdu', a: p.srcName, b: `${p.dstName} (${ip})`, ok })
    })
  }
  const newPdu = (srcId: string, dstId: string) => {
    const src = eng.dev(srcId)
    const dst = eng.dev(dstId)
    if (!src || !dst) return
    const p: Pdu = { num: pduSeq.current++, src: srcId, dst: dstId, srcName: src.name, dstName: dst.name, status: 'pending' }
    setPdus((list) => [...list, p])
    firePdu(p)
  }

  // ---- inspect: a device's tables, as its own commands print them ----
  const capture = (d: Device) => {
    const lines: string[] = []
    const out = (s: string, inline?: boolean) => {
      if (inline && lines.length) lines[lines.length - 1] += s
      else lines.push(...s.split('\n'))
    }
    const noop = () => {}
    if (isHost(d.kind)) {
      for (const c of ['ipconfig', 'arp -a']) {
        lines.push(`C:\\>${c}`)
        runHost(eng, d.id, c, out, noop)
        lines.push('')
      }
    } else {
      const s = { ...newSession(), mode: 'priv' as const }
      const cmds = d.kind === 'router' ? ['show ip interface brief', 'show ip route', 'show arp'] : ['show mac address-table']
      for (const c of cmds) {
        lines.push(`${d.name}#${c}`)
        runIos(eng, d.id, s, c, out, noop)
        lines.push('')
      }
    }
    return lines.join('\n').trimEnd()
  }

  const freePorts = (d: Device) => d.ports.filter((p) => !p.linkId)
  const pickPort = (devId: string, portId: string) => {
    setPicker(null)
    if (!cableFrom) {
      setCableFrom({ device: devId, port: portId })
      return
    }
    if (cableFrom.device !== devId) eng.connect(cableFrom, { device: devId, port: portId })
    setCableFrom(null)
  }

  const onDeviceDown = (e: RPE, d: Device) => {
    e.stopPropagation()
    if (tool === 'delete') {
      eng.removeDevice(d.id)
      if (selected === d.id) setSelected(null)
      return
    }
    if (tool === 'cable') {
      if (cableFrom?.device === d.id) return
      const free = freePorts(d)
      if (!free.length) return
      if (free.length === 1) pickPort(d.id, free[0].id)
      else setPicker({ dev: d.id })
      return
    }
    if (tool === 'pdu') {
      if (!pduFrom) setPduFrom(d.id)
      else if (pduFrom !== d.id) {
        newPdu(pduFrom, d.id)
        setPduFrom(null)
      }
      return
    }
    if (tool === 'inspect') {
      setInspect({ title: t.inspectTitle(d.name), text: capture(d) })
      return
    }
    const p = toSvg(e)
    drag.current = { id: d.id, dx: p.x - d.x, dy: p.y - d.y, moved: false }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onBgDown = (e: RPE) => {
    setPicker(null)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z }
      pan.current = null
      return
    }
    pan.current = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false }
  }
  const onMove = (e: RPE) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pz = pinch.current
    if (pz && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const r = wrapRef.current!.getBoundingClientRect()
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (pz.z * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, pz.d)))
      zoomAt(target / cam.z, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top)
      return
    }
    const pn = pan.current
    if (pn) {
      const dx = e.clientX - pn.sx
      const dy = e.clientY - pn.sy
      if (Math.abs(dx) + Math.abs(dy) > 4) pn.moved = true
      if (pn.moved) setCam((c) => ({ ...c, x: pn.cx - dx / c.z, y: pn.cy - dy / c.z }))
      return
    }
    const g = drag.current
    if (!g) return
    const p = toSvg(e)
    g.moved = true
    eng.moveDevice(g.id, Math.max(-WORLD, Math.min(WORLD, p.x - g.dx)), Math.max(-WORLD, Math.min(WORLD, p.y - g.dy)))
  }
  const onUp = (e: RPE) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const pn = pan.current
    if (pn) {
      pan.current = null
      if (!pn.moved && tool === 'select') setSelected(null)
      return
    }
    const g = drag.current
    drag.current = null
    if (g && !g.moved) {
      setShowHistory(false)
      setSelected(g.id)
    }
  }

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(eng.topo, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'tarmoq-laboratoriyasi.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importFile = async (f: File) => {
    try {
      const topo = JSON.parse(await f.text()) as Topology
      if (!Array.isArray(topo.devices) || !Array.isArray(topo.links)) throw new Error('bad')
      terms.clear()
      eng.replaceTopology(topo)
      requestAnimationFrame(fit)
      setSelected(null)
      setPdus([])
    } catch {
      // ignore invalid files
    }
  }

  const step = () => {
    stepTarget.current = eng.nextFrameTime() ?? eng.nextEventTime()
  }

  const byId = new Map(eng.topo.devices.map((d) => [d.id, d]))
  const inflight = mode === 'sim' ? eng.inflight().filter((f) => filter.has(f.proto)) : eng.inflight()
  const selEvent = eventSel !== null ? eng.log.find((l) => l.id === eventSel) : undefined
  const pickerDev = picker ? byId.get(picker.dev) : undefined
  const cableName = () => {
    const d = cableFrom && byId.get(cableFrom.device)
    return d ? `${d.name} (${shortPort(d.ports.find((p) => p.id === cableFrom.port)?.name ?? '')}) → …` : t.cableHint
  }
  const hint =
    tool === 'cable'
      ? cableName()
      : tool === 'pdu'
        ? pduFrom
          ? t.pduHint2(byId.get(pduFrom)?.name ?? '')
          : t.pduHint
        : tool === 'inspect'
          ? t.inspectHint
          : tool === 'delete'
            ? t.deleteHint
            : !eng.topo.devices.length
              ? t.emptyHint
              : ''

  const kinds: [DeviceKind, string][] = [
    ['pc', t.devPc],
    ['laptop', t.devLaptop],
    ['server', t.devServer],
    ['switch', t.devSwitch],
    ['router', t.devRouter],
  ]
  const tools: [Tool, string, string][] = [
    ['select', '↖', t.toolSelect],
    ['cable', '⌁', t.toolCable],
    ['pdu', '✉', t.toolPdu],
    ['inspect', '⌕', t.toolInspect],
    ['delete', '✕', t.toolDelete],
  ]

  return (
    <div className="lab" role="dialog" aria-modal="true" aria-label={t.labTitle}>
      <header className="lab-bar">
        <h1>{t.labTitle}</h1>
        <div className="lab-group palette">
          {kinds.map(([k, label]) => (
            <button key={k} className="pal" onClick={() => addDevice(k)} title={label}>
              <PaletteIcon kind={k} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="lab-group seg-tools">
          {tools.map(([k, icon, label]) => (
            <button
              key={k}
              className={`lbtn ${tool === k ? 'active' : ''}`}
              title={label}
              onClick={() => {
                setTool(k)
                cancelPending()
              }}
            >
              <span className="ic">{icon}</span>
              <span className="lbl">{label}</span>
            </button>
          ))}
        </div>
        <div className="lab-group lab-actions">
          <select className="lsel" value="" onChange={(e) => e.target.value && loadExample(e.target.value as ExampleId)} aria-label={t.examples}>
            <option value="">{t.examples} ▾</option>
            {EXAMPLES.map((id) => (
              <option key={id} value={id}>
                {examples[id]}
              </option>
            ))}
          </select>
          <button className={`lbtn ${showHistory ? 'active' : ''}`} onClick={() => setShowHistory((v) => !v)} title={t.history}>
            <span className="ic">🕘</span>
            <span className="lbl">{t.history}</span>
          </button>
          <button className="lbtn" onClick={exportFile} title={t.exportFile}>
            <span className="ic">⤓</span>
            <span className="lbl">{t.exportFile}</span>
          </button>
          <button className="lbtn" onClick={() => fileRef.current?.click()} title={t.importFile}>
            <span className="ic">⤒</span>
            <span className="lbl">{t.importFile}</span>
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <button className="lbtn" onClick={() => eng.reset()} title={t.resetNet}>
            ↻
          </button>
        </div>
        <button className="lbtn icon close" onClick={onClose} aria-label="✕">
          ✕
        </button>
      </header>

      <div className="lab-main">
        <div ref={wrapRef} className={`canvas-wrap tool-${tool}`}>
          {hint && <div className="lab-hint">{hint}</div>}
          <svg
            ref={svgRef}
            className="canvas"
            viewBox={viewBox}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerDown={onBgDown}
          >
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0H0V40" className="grid-line" />
              </pattern>
            </defs>
            <rect x={-WORLD * 2} y={-WORLD * 2} width={WORLD * 4} height={WORLD * 4} fill="url(#grid)" />

            {eng.topo.links.map((l) => {
              const A = byId.get(l.a.device)
              const B = byId.get(l.b.device)
              if (!A || !B) return null
              const pa = A.ports.find((p) => p.id === l.a.port)!
              const pb = B.ports.find((p) => p.id === l.b.port)!
              const dot = (D: Device, p: typeof pa, toward: Device) => {
                const k = 46 / Math.max(1, Math.hypot(toward.x - D.x, toward.y - D.y))
                const blocked = eng.blocked.has(`${D.id}|${p.id}`)
                const cls = blocked ? 'stp' : eng.portUp(D, p) ? 'up' : 'down'
                const x = D.x + (toward.x - D.x) * k
                const y = D.y + (toward.y - D.y) * k
                return (
                  <g>
                    <circle cx={x} cy={y} r={7} className={`ldot ${cls}`} />
                    <text x={x} y={y - 12} className="plabel">
                      {shortPort(p.name)}
                    </text>
                  </g>
                )
              }
              return (
                <g
                  key={l.id}
                  className="link"
                  onPointerDown={(e) => {
                    if (tool === 'delete') {
                      e.stopPropagation()
                      eng.disconnect(l.id)
                    }
                  }}
                >
                  <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="lhit" />
                  <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="lline" />
                  {dot(A, pa, B)}
                  {dot(B, pb, A)}
                </g>
              )
            })}

            {eng.topo.devices.map((d) => {
              const ip = isHost(d.kind) ? d.ports[0].ip : undefined
              const marked = cableFrom?.device === d.id || pduFrom === d.id
              return (
                <g
                  key={d.id}
                  className={`dev ${selected === d.id ? 'sel' : ''} ${marked ? 'cable-from' : ''}`}
                  transform={`translate(${d.x},${d.y})`}
                  onPointerDown={(e) => onDeviceDown(e, d)}
                >
                  <rect x={-46} y={-40} width={92} height={80} rx={14} className="dev-hit" />
                  <DeviceIcon kind={d.kind} />
                  <text y={52} className="dname">
                    {d.name}
                  </text>
                  {ip && (
                    <text y={74} className="dip">
                      {ip}
                    </text>
                  )}
                </g>
              )
            })}

            {inflight.map((f) => {
              const A = byId.get(f.from.device)
              const B = byId.get(f.to.device)
              if (!A || !B) return null
              const x = A.x + (B.x - A.x) * f.progress
              const y = A.y + (B.y - A.y) * f.progress
              return (
                <g
                  key={`${f.id}`}
                  transform={`translate(${x},${y})`}
                  className={`pkt ${PROTO_CLASS[f.proto]} ${eventSel === f.id ? 'hl' : ''}`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setEventSel(f.id)
                  }}
                >
                  <rect x={-16} y={-11} width={32} height={22} rx={3} />
                  <path d="M-16 -11 L0 2 L16 -11" />
                </g>
              )
            })}
          </svg>

          {pickerDev && (
            <div className="port-picker" style={{ left: (pickerDev.x - cam.x) * cam.z, top: (pickerDev.y - cam.y) * cam.z }}>
              <strong>
                {pickerDev.name}: {t.choosePort}
              </strong>
              {freePorts(pickerDev).length ? (
                freePorts(pickerDev).map((p) => (
                  <button key={p.id} className="lbtn" onClick={() => pickPort(pickerDev.id, p.id)}>
                    {p.name}
                  </button>
                ))
              ) : (
                <em>{t.noFreePort}</em>
              )}
            </div>
          )}
          <div className="zoom-ctl">
            <button className="lbtn icon" onClick={() => zoomAt(1 / 1.25)} title={t.zoomOut} aria-label={t.zoomOut}>
              −
            </button>
            <button className="lbtn zoom-val" onClick={() => zoomAt(1 / cam.z)} title="100%">
              {Math.round(cam.z * 100)}%
            </button>
            <button className="lbtn icon" onClick={() => zoomAt(1.25)} title={t.zoomIn} aria-label={t.zoomIn}>
              +
            </button>
            <button className="lbtn icon" onClick={fit} title={t.zoomFit} aria-label={t.zoomFit}>
              ⤢
            </button>
          </div>
          {inspect && <InspectPopup title={inspect.title} text={inspect.text} onClose={() => setInspect(null)} />}
        </div>

        {showHistory ? (
          <HistoryPanel
            items={history}
            onClose={() => setShowHistory(false)}
            onClear={() => {
              setHistory([])
              writeJson(histKey, [])
            }}
          />
        ) : (
          selected &&
          byId.get(selected) && (
            <DevicePanel
              key={selected}
              eng={eng}
              devId={selected}
              terms={terms}
              onClose={() => setSelected(null)}
              onCommand={(dev, cmd) => record({ kind: 'cmd', dev, cmd })}
            />
          )
        )}
      </div>

      <div className="bottom-bar">
        <button className="bottom-toggle" onClick={() => setBottomOpen((v) => !v)} aria-expanded={bottomOpen}>
          {bottomOpen ? '▾' : '▴'} {mode === 'sim' ? t.events : t.stats} · {t.pduList}
        </button>
          <div className="lab-group seg-tools mode-switch">
            <button className={`lbtn ${mode === 'real' ? 'active' : ''}`} onClick={() => setMode('real')} title={t.modeRealtime}>
              <span className="ic">⏱</span>
              <span className="lbl">{t.modeRealtime}</span>
            </button>
            <button
              className={`lbtn ${mode === 'sim' ? 'active' : ''}`}
              title={t.modeSim}
              onClick={() => {
                setMode('sim')
                setPlaying(false)
              }}
            >
              <span className="ic">⏯</span>
              <span className="lbl">{t.modeSim}</span>
            </button>
          </div>
      </div>
      <div className={`lab-bottom ${bottomOpen ? '' : 'closed'}`}>
        {mode === 'sim' ? (
          <SimPanel
            log={eng.log}
            names={byId}
            playing={playing}
            speed={speed}
            selected={eventSel}
            filter={filter}
            onFilter={(p) =>
              setFilter((f) => {
                const n = new Set(f)
                if (n.has(p)) n.delete(p)
                else n.add(p)
                return n
              })
            }
            onSelect={setEventSel}
            onPlay={() => setPlaying((p) => !p)}
            onStep={step}
            onSpeed={setSpeed}
          />
        ) : (
          <StatsPanel eng={eng} pdus={pdus} />
        )}
        <PduPanel pdus={pdus} onFire={firePdu} onDelete={(num) => setPdus((l) => l.filter((x) => x.num !== num))} onDeleteAll={() => setPdus([])} />
      </div>
      {selEvent && <EventDetails e={selEvent} names={byId} onClose={() => setEventSel(null)} />}
    </div>
  )
}
