import { useState } from 'react'
import { useI18n } from '../i18n/context'
import type { Engine } from './engine.ts'
import { DeviceIcon } from './icons.tsx'
import { isHost, shortPort, type Device, type DnsRecord, type Port, type StaticRoute } from './model.ts'
import { hostAddressProblem, inSubnet, ipToInt, maskToPrefix, normalizeMask } from './net.ts'
import { Terminal } from './Terminal.tsx'
import { TermStore } from './termStore.ts'

interface Props {
  eng: Engine
  devId: string
  terms: Map<string, TermStore>
  onClose: () => void
  onCommand?: (dev: string, line: string) => void
}

type Tab = 'config' | 'terminal' | 'services' | 'ports'

export function DevicePanel({ eng, devId, terms, onClose, onCommand }: Props) {
  const { t } = useI18n()
  const d = eng.dev(devId)
  const [tab, setTab] = useState<Tab>('config')
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  const note = (text: string, ok = true) => {
    setToast({ text, ok })
    window.setTimeout(() => setToast(null), 2500)
  }
  if (!d) return null
  const host = isHost(d.kind)
  const tabs: [Tab, string][] = host
    ? [['config', t.tabConfig], ...(d.kind === 'server' ? ([['services', t.tabServices]] as [Tab, string][]) : []), ['terminal', t.tabTerminal]]
    : d.kind === 'router'
      ? [['config', t.tabConfig], ['terminal', t.tabCli]]
      : [['ports', t.tabPorts], ['terminal', t.tabCli]]
  const active = tabs.some(([k]) => k === tab) ? tab : tabs[0][0]

  let term = terms.get(devId)
  if (!term) {
    term = new TermStore(host ? t.termHint : t.iosHint)
    terms.set(devId, term)
  }

  return (
    <aside className="dpanel">
      <div className="dpanel-head">
        <svg viewBox="-40 -34 80 68" className="dpanel-ico" aria-hidden>
          <DeviceIcon kind={d.kind} />
        </svg>
        <h2>{d.name}</h2>
        <button className="lbtn icon" onClick={onClose} aria-label="✕">
          ✕
        </button>
      </div>
      <div className="dtabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={k === active ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="dpanel-body">
        {active === 'config' && host && (
          <HostConfig key={`${d.id}|${d.ports[0].ip}|${d.ports[0].mask}|${d.gateway}|${d.dns}|${d.dhcp}`} eng={eng} d={d} note={note} />
        )}
        {active === 'config' && d.kind === 'router' && <RouterConfig eng={eng} d={d} note={note} />}
        {active === 'services' && <ServerServices key={d.id} eng={eng} d={d} note={note} />}
        {active === 'ports' && <SwitchPorts eng={eng} d={d} />}
        {active === 'terminal' && <Terminal eng={eng} devId={d.id} store={term} stopLabel={t.stop} onCommand={(line) => onCommand?.(d.name, line)} />}
      </div>
      {toast && <div className={`toast ${toast.ok ? 'ok' : 'warn'}`}>{toast.text}</div>}
    </aside>
  )
}

function Field({ label, value, onChange, error, placeholder }: { label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string }) {
  return (
    <label className={`field ${error ? 'bad' : ''}`}>
      <span>{label}</span>
      <input value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      {error && <em>{error}</em>}
    </label>
  )
}

function NameField({ eng, d }: { eng: Engine; d: Device }) {
  const { t } = useI18n()
  const [name, setName] = useState(d.name)
  return (
    <Field
      label={t.name}
      value={name}
      onChange={(v) => {
        setName(v)
        if (v.trim()) eng.update(d.id, (x) => (x.name = v.trim().slice(0, 24)))
      }}
    />
  )
}

function LinkChip({ eng, d, p }: { eng: Engine; d: Device; p: Port }) {
  const { t } = useI18n()
  const up = eng.portUp(d, p)
  return <span className={`chip ${up ? 'ok' : 'off'}`}>{up ? t.linkUp : t.linkDown}</span>
}

// ---------------- hosts ----------------
type Note = (text: string, ok?: boolean) => void

function HostConfig({ eng, d, note }: { eng: Engine; d: Device; note: Note }) {
  const { t } = useI18n()
  const p = d.ports[0]
  const [dhcp, setDhcp] = useState(!!d.dhcp)
  const [ip, setIp] = useState(p.ip ?? '')
  const [mask, setMask] = useState(p.mask ?? '')
  const [gw, setGw] = useState(d.gateway ?? '')
  const [dns, setDns] = useState(d.dns ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = () => {
    if (dhcp) {
      eng.update(d.id, (x) => (x.dhcp = true))
      eng.dhcpRequest(d.id)
      note(t.saved)
      return
    }
    const e: Record<string, string> = {}
    const prob = hostAddressProblem(ip, mask)
    if (prob === 'ip') e.ip = t.errIp
    else if (prob === 'mask') e.mask = t.errMask
    else if (prob === 'network') e.ip = t.errNetwork
    else if (prob === 'broadcast') e.ip = t.errBroadcast
    if (gw && (ipToInt(gw) === null || (!e.ip && !e.mask && !inSubnet(gw, ip, mask)))) e.gw = t.errGateway
    if (dns && ipToInt(dns) === null) e.dns = t.errIp
    setErrors(e)
    if (Object.keys(e).length) return
    eng.update(d.id, (x) => {
      x.dhcp = false
      x.dhcpServer = undefined
      x.ports[0].ip = ip.trim()
      x.ports[0].mask = normalizeMask(mask)!
      x.gateway = gw.trim()
      x.dns = dns.trim()
    })
    const dup = eng.topo.devices.find((o) => o.id !== d.id && o.ports.some((q) => q.ip === ip.trim()))
    note(dup ? t.errDuplicate(dup.name) : t.saved, !dup)
  }

  return (
    <div className="form">
      <NameField eng={eng} d={d} />
      <div className="row-between">
        <strong>{shortPort(p.name)}</strong>
        <LinkChip eng={eng} d={d} p={p} />
      </div>
      <div className="seg">
        <span>{t.ipMode}</span>
        <div>
          <button className={!dhcp ? 'active' : ''} onClick={() => setDhcp(false)}>
            {t.static}
          </button>
          <button className={dhcp ? 'active' : ''} onClick={() => setDhcp(true)}>
            {t.dhcp}
          </button>
        </div>
      </div>
      {dhcp ? (
        <div className="readonly">
          <div>
            {t.ipAddress}: <b>{p.ip ?? '—'}</b>
          </div>
          <div>
            {t.subnetMask}: <b>{p.mask ?? '—'}</b>
          </div>
          <div>
            {t.gateway}: <b>{d.gateway || '—'}</b>
          </div>
          <div>
            {t.dnsServer}: <b>{d.dns || '—'}</b>
          </div>
        </div>
      ) : (
        <>
          <Field label={t.ipAddress} value={ip} onChange={setIp} error={errors.ip} placeholder="192.168.1.10" />
          <Field label={t.subnetMask} value={mask} onChange={setMask} error={errors.mask} placeholder="255.255.255.0" />
          <Field label={t.gateway} value={gw} onChange={setGw} error={errors.gw} placeholder="192.168.1.1" />
          <Field label={t.dnsServer} value={dns} onChange={setDns} error={errors.dns} />
        </>
      )}
      <button className="lbtn primary" onClick={save}>
        {t.apply}
      </button>
      <ArpView eng={eng} d={d} />
    </div>
  )
}

function ArpView({ eng, d }: { eng: Engine; d: Device }) {
  const { t } = useI18n()
  const rows = eng.arpTable(d.id)
  return (
    <div className="mini-table">
      <h3>{t.arpTable}</h3>
      {rows.length ? (
        rows.map(([ip, e]) => (
          <div key={ip}>
            <span>{ip}</span>
            <span>{e.mac}</span>
          </div>
        ))
      ) : (
        <div className="muted">{t.empty}</div>
      )}
    </div>
  )
}

// ---------------- router ----------------
function RouterConfig({ eng, d, note }: { eng: Engine; d: Device; note: Note }) {
  const { t } = useI18n()
  return (
    <div className="form">
      <NameField eng={eng} d={d} />
      {d.ports.map((p) => (
        <RouterPort key={`${p.id}|${p.ip}|${p.mask}`} eng={eng} d={d} p={p} note={note} />
      ))}
      <Routes eng={eng} d={d} />
      <h3 className="sub">{t.arpTable}</h3>
      <ArpView eng={eng} d={d} />
    </div>
  )
}

function RouterPort({ eng, d, p, note }: { eng: Engine; d: Device; p: Port; note: Note }) {
  const { t } = useI18n()
  const [ip, setIp] = useState(p.ip ?? '')
  const [mask, setMask] = useState(p.mask ?? '')
  const [err, setErr] = useState<Record<string, string>>({})
  const save = () => {
    const e: Record<string, string> = {}
    if (ip || mask) {
      const prob = hostAddressProblem(ip, mask)
      if (prob === 'ip') e.ip = t.errIp
      else if (prob === 'mask') e.mask = t.errMask
      else if (prob === 'network') e.ip = t.errNetwork
      else if (prob === 'broadcast') e.ip = t.errBroadcast
    }
    setErr(e)
    if (Object.keys(e).length) return
    eng.update(d.id, (x) => {
      const q = x.ports.find((z) => z.id === p.id)!
      q.ip = ip.trim() || undefined
      q.mask = ip.trim() ? normalizeMask(mask)! : undefined
    })
    note(t.saved)
  }
  return (
    <div className="port-card">
      <div className="row-between">
        <strong>{p.name}</strong>
        <LinkChip eng={eng} d={d} p={p} />
      </div>
      <label className="check">
        <input type="checkbox" checked={p.up} onChange={(e) => eng.update(d.id, (x) => (x.ports.find((z) => z.id === p.id)!.up = e.target.checked))} />
        {t.portOn}
      </label>
      <div className="two">
        <Field label={t.ipAddress} value={ip} onChange={setIp} error={err.ip} />
        <Field label={t.subnetMask} value={mask} onChange={setMask} error={err.mask} />
      </div>
      <button className="lbtn" onClick={save}>
        {t.apply}
      </button>
    </div>
  )
}

function Routes({ eng, d }: { eng: Engine; d: Device }) {
  const { t } = useI18n()
  const [n, setN] = useState({ network: '', mask: '', nextHop: '' })
  const [err, setErr] = useState('')
  const add = () => {
    const m = normalizeMask(n.mask)
    if (ipToInt(n.network) === null || ipToInt(n.nextHop) === null) return setErr(t.errIp)
    if (!m || maskToPrefix(m) === null) return setErr(t.errMask)
    const r: StaticRoute = { network: n.network.trim(), mask: m, nextHop: n.nextHop.trim() }
    eng.update(d.id, (x) => (x.routes = [...(x.routes ?? []), r]))
    setN({ network: '', mask: '', nextHop: '' })
    setErr('')
  }
  return (
    <div className="port-card">
      <strong>{t.staticRoutes}</strong>
      {(d.routes ?? []).map((r, i) => (
        <div key={i} className="route-row">
          <span>
            {r.network} / {maskToPrefix(r.mask)} → {r.nextHop}
          </span>
          <button className="lbtn small" onClick={() => eng.update(d.id, (x) => (x.routes = x.routes!.filter((_, j) => j !== i)))}>
            {t.remove}
          </button>
        </div>
      ))}
      <div className="three">
        <Field label={t.network} value={n.network} onChange={(v) => setN({ ...n, network: v })} placeholder="192.168.2.0" />
        <Field label={t.subnetMask} value={n.mask} onChange={(v) => setN({ ...n, mask: v })} placeholder="255.255.255.0" />
        <Field label={t.nextHop} value={n.nextHop} onChange={(v) => setN({ ...n, nextHop: v })} placeholder="10.0.0.2" />
      </div>
      {err && <div className="note warn">{err}</div>}
      <button className="lbtn" onClick={add}>
        {t.add}
      </button>
    </div>
  )
}

// ---------------- server services ----------------
function ServerServices({ eng, d, note }: { eng: Engine; d: Device; note: Note }) {
  const { t } = useI18n()
  const pool = d.dhcpPool!
  const [pf, setPf] = useState({ ...pool, count: String(pool.count) })
  const [rec, setRec] = useState<DnsRecord>({ name: '', ip: '' })
  const [recErr, setRecErr] = useState('')
  const savePool = () => {
    if ((pf.start && ipToInt(pf.start) === null) || (pf.gateway && ipToInt(pf.gateway) === null) || (pf.dns && ipToInt(pf.dns) === null)) return note(t.errIp, false)
    if (!normalizeMask(pf.mask)) return note(t.errMask, false)
    eng.update(d.id, (x) => (x.dhcpPool = { ...pf, mask: normalizeMask(pf.mask)!, count: Math.max(1, Math.min(1000, Number(pf.count) || 1)) }))
    note(t.saved)
  }
  return (
    <div className="form">
      <div className="port-card">
        <div className="row-between">
          <strong>{t.dhcpService}</strong>
          <label className="check">
            <input type="checkbox" checked={pf.enabled} onChange={(e) => setPf({ ...pf, enabled: e.target.checked })} />
            {t.enabled}
          </label>
        </div>
        <div className="two">
          <Field label={t.poolStart} value={pf.start} onChange={(v) => setPf({ ...pf, start: v })} placeholder="192.168.1.100" />
          <Field label={t.poolCount} value={pf.count} onChange={(v) => setPf({ ...pf, count: v })} />
          <Field label={t.subnetMask} value={pf.mask} onChange={(v) => setPf({ ...pf, mask: v })} />
          <Field label={t.gateway} value={pf.gateway} onChange={(v) => setPf({ ...pf, gateway: v })} />
          <Field label={t.dnsServer} value={pf.dns} onChange={(v) => setPf({ ...pf, dns: v })} />
        </div>
        <button className="lbtn" onClick={savePool}>
          {t.apply}
        </button>
      </div>
      <div className="port-card">
        <div className="row-between">
          <strong>{t.dnsService}</strong>
          <label className="check">
            <input type="checkbox" checked={!!d.dnsEnabled} onChange={(e) => eng.update(d.id, (x) => (x.dnsEnabled = e.target.checked))} />
            {t.enabled}
          </label>
        </div>
        {(d.dnsRecords ?? []).map((r, i) => (
          <div key={i} className="route-row">
            <span>
              {r.name} → {r.ip}
            </span>
            <button className="lbtn small" onClick={() => eng.update(d.id, (x) => (x.dnsRecords = x.dnsRecords!.filter((_, j) => j !== i)))}>
              {t.remove}
            </button>
          </div>
        ))}
        <div className="two">
          <Field label={t.dnsName} value={rec.name} onChange={(v) => setRec({ ...rec, name: v })} placeholder="site.local" />
          <Field label={t.ipAddress} value={rec.ip} onChange={(v) => setRec({ ...rec, ip: v })} placeholder="192.168.1.5" />
        </div>
        {recErr && <div className="note warn">{recErr}</div>}
        <button
          className="lbtn"
          onClick={() => {
            if (!rec.name.trim() || ipToInt(rec.ip) === null) return setRecErr(t.errIp)
            eng.update(d.id, (x) => (x.dnsRecords = [...(x.dnsRecords ?? []), { name: rec.name.trim(), ip: rec.ip.trim() }]))
            setRec({ name: '', ip: '' })
            setRecErr('')
          }}
        >
          {t.add}
        </button>
      </div>
    </div>
  )
}

// ---------------- switch ----------------
function SwitchPorts({ eng, d }: { eng: Engine; d: Device }) {
  const { t } = useI18n()
  const macs = eng.macTable(d.id)
  return (
    <div className="form">
      <NameField eng={eng} d={d} />
      <div className="mini-table">
        <h3>{t.tabPorts}</h3>
        {d.ports.map((p) => {
          const peer = eng.peerOf(d, p)
          const blocked = eng.blocked.has(`${d.id}|${p.id}`)
          return (
            <div key={p.id}>
              <span>{shortPort(p.name)}</span>
              <span>{peer ? `${peer.dev.name} (${shortPort(peer.port.name)})` : '—'}</span>
              <span className={`chip ${blocked ? 'stp' : eng.portUp(d, p) ? 'ok' : 'off'}`}>
                {blocked ? 'STP' : eng.portUp(d, p) ? t.linkUp : t.linkDown}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mini-table">
        <h3>{t.macTable}</h3>
        {macs.length ? (
          macs.map(([mac, portId]) => (
            <div key={mac}>
              <span>{mac}</span>
              <span>{shortPort(d.ports.find((p) => p.id === portId)?.name ?? '')}</span>
            </div>
          ))
        ) : (
          <div className="muted">{t.empty}</div>
        )}
      </div>
    </div>
  )
}
