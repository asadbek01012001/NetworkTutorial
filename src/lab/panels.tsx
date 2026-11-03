import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/context'
import { frameProto, type Engine, type LogEntry, type Proto } from './engine.ts'
import { PROTO_CLASS, PROTO_LABEL, PROTOS, summary, type HistEntry, type Pdu } from './labUtil.ts'
import type { Device } from './model.ts'

// ---------------- simulation events ----------------
interface SimProps {
  log: LogEntry[]
  names: Map<string, Device>
  playing: boolean
  speed: number
  selected: number | null
  filter: Set<Proto>
  onFilter: (p: Proto) => void
  onSelect: (id: number) => void
  onPlay: () => void
  onStep: () => void
  onSpeed: (s: number) => void
}

export function SimPanel({ log, names, playing, speed, selected, filter, onFilter, onSelect, onPlay, onStep, onSpeed }: SimProps) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement>(null)
  const rows = log.filter((r) => filter.has(r.proto)).slice(-200)
  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight)
  }, [rows.length])
  return (
    <div className="bpanel sim">
      <div className="sim-controls">
        <button className="lbtn primary" onClick={onPlay}>
          {playing ? `⏸ ${t.pause}` : `▶ ${t.simPlay}`}
        </button>
        <button className="lbtn" onClick={onStep} disabled={playing}>
          ⏭ {t.stepNext}
        </button>
        <label className="speed">
          {t.speed}
          <input type="range" min={0.25} max={4} step={0.25} value={speed} onChange={(e) => onSpeed(Number(e.target.value))} />
          <b>{speed}×</b>
        </label>
        <span className="filters">
          {t.filters}:
          {PROTOS.map((p) => (
            <label key={p} className={`fchip ${filter.has(p) ? 'on' : ''}`}>
              <input type="checkbox" checked={filter.has(p)} onChange={() => onFilter(p)} />
              <span className={`ptag ${PROTO_CLASS[p]}`}>{PROTO_LABEL[p]}</span>
            </label>
          ))}
        </span>
      </div>
      <div className="sim-list" ref={listRef}>
        {!rows.length && <div className="muted pad">{t.noEvents}</div>}
        {rows.map((r) => (
          <button key={r.id} className={`sim-row ${selected === r.id ? 'sel' : ''}`} onClick={() => onSelect(r.id)}>
            <span className="t">{r.time.toFixed(0)}</span>
            <span>{names.get(r.fromDev)?.name ?? '?'}</span>
            <span>→ {names.get(r.toDev)?.name ?? '?'}</span>
            <span className={`ptag ${PROTO_CLASS[r.proto]}`}>{PROTO_LABEL[r.proto]}</span>
            <span className="info">{summary(r)}</span>
            {r.dropped && <span className="drop">✕ {t.dropReason[r.dropped] ?? t.dropped}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------- realtime statistics ----------------
export function StatsPanel({ eng, pdus }: { eng: Engine; pdus: Pdu[] }) {
  const { t } = useI18n()
  const inflight = eng.inflight()
  const ok = pdus.filter((p) => p.status === 'ok').length
  const bad = pdus.filter((p) => p.status === 'fail').length
  const total = PROTOS.reduce((s, p) => s + eng.stats[p], 0)
  return (
    <div className="bpanel stats">
      <h3>{t.stats}</h3>
      <div className="stat-grid">
        {PROTOS.map((p) => (
          <div key={p} className="stat-box">
            <span className={`ptag ${PROTO_CLASS[p]}`}>{PROTO_LABEL[p]}</span>
            <b>{eng.stats[p]}</b>
            <div className="bar">
              <div className={PROTO_CLASS[p]} style={{ width: `${total ? (eng.stats[p] / total) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
        <div className="stat-box">
          <span>{t.inFlight}</span>
          <b>{inflight.length}</b>
        </div>
        <div className="stat-box">
          <span>{t.droppedFrames}</span>
          <b>{eng.droppedCount}</b>
        </div>
        <div className="stat-box">
          <span className="ok-text">{t.pduOk}</span>
          <b>{ok}</b>
        </div>
        <div className="stat-box">
          <span className="fail-text">{t.pduFail}</span>
          <b>{bad}</b>
        </div>
      </div>
    </div>
  )
}

// ---------------- PDU list ----------------
interface PduProps {
  pdus: Pdu[]
  onFire: (p: Pdu) => void
  onDelete: (num: number) => void
  onDeleteAll: () => void
}

export function PduPanel({ pdus, onFire, onDelete, onDeleteAll }: PduProps) {
  const { t } = useI18n()
  return (
    <div className="bpanel pdus">
      <div className="row-between">
        <h3>{t.pduList}</h3>
        {pdus.length > 0 && (
          <button className="lbtn small" onClick={onDeleteAll}>
            {t.pduDeleteAll}
          </button>
        )}
      </div>
      <div className="pdu-list">
        {!pdus.length && <div className="muted pad">{t.pduEmpty}</div>}
        {[...pdus].reverse().map((p) => (
          <div key={p.num} className={`pdu-row ${p.status}`}>
            <span className="pdu-num">#{p.num}</span>
            <span className="pdu-path">
              {p.srcName} → {p.dstName}
              {p.dstIp && <small> ({p.dstIp})</small>}
            </span>
            <span className={`pdu-status ${p.status}`}>
              {p.status === 'pending' ? t.pduPending : p.status === 'ok' ? `✓ ${t.pduOk}` : `✕ ${p.reason ?? t.pduFail}`}
            </span>
            <button className="lbtn small" onClick={() => onFire(p)} title={t.pduFire}>
              ↻
            </button>
            <button className="lbtn small" onClick={() => onDelete(p.num)} title={t.remove}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------- history ----------------
export function HistoryPanel({ items, onClear, onClose }: { items: HistEntry[]; onClear: () => void; onClose: () => void }) {
  const { t } = useI18n()
  const text = (h: HistEntry) => {
    switch (h.kind) {
      case 'add':
        return t.histAdd(h.dev)
      case 'remove':
        return t.histRemove(h.dev)
      case 'config':
        return t.histConfig(h.dev)
      case 'connect':
        return t.histConnect(h.a, h.b)
      case 'disconnect':
        return t.histDisconnect(h.a, h.b)
      case 'cmd':
        return t.histCmd(h.dev, h.cmd)
      case 'pdu':
        return t.histPdu(h.a, h.b, h.ok)
      case 'example':
        return t.histExample(h.name)
    }
  }
  return (
    <aside className="dpanel hist">
      <div className="dpanel-head">
        <h2>{t.labHistory}</h2>
        <button className="lbtn icon" onClick={onClose} aria-label="✕">
          ✕
        </button>
      </div>
      <div className="dpanel-body">
        {!items.length && <div className="muted">{t.histEmpty}</div>}
        <ol className="hist-items">
          {[...items].reverse().map((h, i) => (
            <li key={i} className={`hist-${h.kind} ${h.kind === 'pdu' ? (h.ok ? 'ok' : 'fail') : ''}`}>
              <time>{new Date(h.at).toLocaleTimeString()}</time>
              <span>{text(h)}</span>
            </li>
          ))}
        </ol>
        {items.length > 0 && (
          <button className="lbtn" onClick={onClear}>
            {t.histClear}
          </button>
        )}
      </div>
    </aside>
  )
}

// ---------------- inspect ----------------
export function InspectPopup({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <div className="inspect">
      <div className="row-between">
        <h3>{title}</h3>
        <button className="lbtn icon" onClick={onClose}>
          ✕
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  )
}

// ---------------- packet details ----------------
export function EventDetails({ e, names, onClose }: { e: LogEntry; names: Map<string, Device>; onClose: () => void }) {
  const { t } = useI18n()
  const f = e.frame
  const ip = f.ip
  const rows: [string, [string, string][]][] = [
    [
      'Layer 2 — Ethernet',
      [
        ['Source MAC', f.srcMac],
        ['Destination MAC', f.dstMac + (f.dstMac === 'ffff.ffff.ffff' ? ' (broadcast)' : '')],
        ['Type', f.arp ? 'ARP (0x0806)' : 'IPv4 (0x0800)'],
      ],
    ],
  ]
  if (f.arp) {
    rows.push([
      'ARP',
      [
        ['Operation', f.arp.op === 'request' ? 'Request (1)' : 'Reply (2)'],
        ['Sender MAC', f.arp.senderMac],
        ['Sender IP', f.arp.senderIp],
        ['Target MAC', f.arp.targetMac],
        ['Target IP', f.arp.targetIp],
      ],
    ])
  }
  if (ip) {
    rows.push([
      'Layer 3 — IPv4',
      [
        ['Source IP', ip.src],
        ['Destination IP', ip.dst],
        ['TTL', String(ip.ttl)],
        ['Protocol', ip.icmp ? 'ICMP (1)' : 'UDP (17)'],
      ],
    ])
    if (ip.icmp) {
      const type = { 'echo-request': 'Echo Request (8)', 'echo-reply': 'Echo Reply (0)', unreachable: 'Destination Unreachable (3)', 'time-exceeded': 'Time Exceeded (11)' }[ip.icmp.type]
      rows.push(['ICMP', [['Type', type], ['Identifier', String(ip.icmp.id)], ['Sequence', String(ip.icmp.seq)]]])
    }
    if (ip.udp) {
      rows.push(['Layer 4 — UDP', [['Source port', String(ip.udp.srcPort)], ['Destination port', String(ip.udp.dstPort)]]])
      const m = ip.udp.dhcp
      if (m) {
        const kv: [string, string][] = [['Message', m.msg], ['Client MAC', m.clientMac]]
        if (m.yiaddr) kv.push(['Your IP', m.yiaddr])
        if (m.serverIp) kv.push(['Server', m.serverIp])
        if (m.mask) kv.push(['Subnet mask', m.mask])
        if (m.gateway) kv.push(['Router', m.gateway])
        if (m.dns) kv.push(['DNS', m.dns])
        rows.push(['DHCP', kv])
      }
      const q = ip.udp.dns
      if (q) rows.push(['DNS', [['Type', q.qr], ['Name', q.name], ['Answer', q.ip ?? (q.qr === 'response' ? 'NXDOMAIN' : '—')]]])
    }
  }
  return (
    <div className="ev-details">
      <div className="row-between">
        <h3>
          {t.details}: {names.get(e.fromDev)?.name} → {names.get(e.toDev)?.name}
        </h3>
        <button className="lbtn icon" onClick={onClose}>
          ✕
        </button>
      </div>
      <span className={`ptag ${PROTO_CLASS[frameProto(f)]}`}>{PROTO_LABEL[frameProto(f)]}</span>
      {e.dropped && <span className="drop"> ✕ {t.dropReason[e.dropped] ?? t.dropped}</span>}
      {rows.map(([title, kv]) => (
        <div key={title} className="layer">
          <h4>{title}</h4>
          {kv.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
