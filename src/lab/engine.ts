// Discrete-event network simulator. Frames travel over links with a fixed
// delay; devices react like real ones: hosts (IP stack with ARP, ICMP,
// DHCP client, DNS client), switches (MAC learning, flooding, STP) and
// routers (connected + static routes, TTL, ICMP errors).
import {
  BROADCAST_MAC, broadcastOf, inSubnet, intToIp, ipToInt, isBroadcastIp, maskToPrefix, networkOf,
  normalizeMask,
} from './net.ts'
import {
  isHost, makeDevice, newId, nextName, type Device, type DeviceKind, type Link, type LinkEnd, type Port,
  type Topology,
} from './model.ts'

// ---- timing (simulation time units; one unit = one link hop) ----
export const LINK_DELAY = 1
const ARP_TIMEOUT = 12
const PING_TIMEOUT = 30
const DHCP_TIMEOUT = 16
const DNS_TIMEOUT = 16
export const PING_GAP = 2
const HOST_TTL = 128
const ROUTER_TTL = 255

// ---- frames ----
export interface ArpPayload {
  op: 'request' | 'reply'
  senderMac: string
  senderIp: string
  targetMac: string
  targetIp: string
}
export interface IcmpPayload {
  type: 'echo-request' | 'echo-reply' | 'unreachable' | 'time-exceeded'
  id: number
  seq: number
}
export interface DhcpPayload {
  msg: 'DISCOVER' | 'OFFER' | 'REQUEST' | 'ACK'
  xid: number
  clientMac: string
  yiaddr?: string
  serverIp?: string
  mask?: string
  gateway?: string
  dns?: string
}
export interface DnsPayload {
  qr: 'query' | 'response'
  id: number
  name: string
  ip?: string
}
export interface IpPacket {
  src: string
  dst: string
  ttl: number
  icmp?: IcmpPayload
  udp?: { srcPort: number; dstPort: number; dhcp?: DhcpPayload; dns?: DnsPayload }
}
export interface Frame {
  id: number
  srcMac: string
  dstMac: string
  arp?: ArpPayload
  ip?: IpPacket
}
export type Proto = 'arp' | 'icmp' | 'dhcp' | 'dns'
export const frameProto = (f: Frame): Proto =>
  f.arp ? 'arp' : f.ip?.icmp ? 'icmp' : f.ip?.udp?.dhcp ? 'dhcp' : 'dns'

// ---- events ----
interface FrameEv {
  kind: 'frame'
  t: number
  seq: number
  depart: number
  link: string
  from: LinkEnd
  to: LinkEnd
  frame: Frame
  logId: number
}
interface TimerEv {
  kind: 'timer'
  t: number
  seq: number
  fn: () => void
  cancelled?: boolean
}
type Ev = FrameEv | TimerEv

export interface LogEntry {
  id: number
  time: number
  fromDev: string
  toDev: string
  proto: Proto
  frame: Frame
  /** Set when the receiving device dropped the frame. */
  dropped?: string
}

/** Things a person did in the lab, for the history panel. */
export type LabAction =
  | { type: 'add'; dev: string }
  | { type: 'remove'; dev: string }
  | { type: 'connect'; a: string; b: string }
  | { type: 'disconnect'; a: string; b: string }
  | { type: 'config'; dev: string }

export interface InFlight {
  id: number
  link: string
  from: LinkEnd
  to: LinkEnd
  progress: number
  proto: Proto
}

// ---- runtime state ----
interface ArpEntry {
  mac: string
  port: string
}
interface PendingArp {
  packets: { pkt: IpPacket; onFail?: () => void }[]
  timer: TimerEv
}
interface DevState {
  arp: Map<string, ArpEntry>
  pending: Map<string, PendingArp>
  mac: Map<string, string>
  leases: Map<string, string>
  dhcpXid?: number
  dhcpDone?: (ok: boolean) => void
}

export type EchoResult =
  | { kind: 'reply'; from: string; ttl: number }
  | { kind: 'unreachable'; from: string }
  | { kind: 'ttl-expired'; from: string }
  | { kind: 'timeout' }
  | { kind: 'general' }

interface Waiter {
  cb: (r: EchoResult) => void
  timer: TimerEv
}

export class Engine {
  topo: Topology
  now = 0
  log: LogEntry[] = []
  /** Switch ports blocked by spanning tree: "deviceId|portId". */
  blocked = new Set<string>()
  /** Frames sent per protocol and frames dropped, since the last reset. */
  stats: Record<Proto, number> = { arp: 0, icmp: 0, dhcp: 0, dns: 0 }
  droppedCount = 0
  /** Called for every change a person makes (not for traffic). */
  onAction?: (a: LabAction) => void

  /** Sets the action listener; returns a function that removes it. */
  listen(fn: (a: LabAction) => void) {
    this.onAction = fn
    return () => {
      if (this.onAction === fn) this.onAction = undefined
    }
  }

  private q: Ev[] = []
  private seq = 0
  private frameId = 0
  private logSeq = 0
  private state = new Map<string, DevState>()
  private waiters = new Map<string, Waiter>()
  private dnsWaiters = new Map<number, { cb: (ip: string | null, why?: 'timeout' | 'nx') => void; timer: TimerEv }>()
  private listeners = new Set<() => void>()
  version = 0

  constructor(topo: Topology) {
    this.topo = topo
    this.recomputeStp()
  }

  // ---------- change notification ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version
  emit() {
    this.version++
    this.listeners.forEach((l) => l())
  }

  // ---------- lookups ----------
  dev(id: string) {
    return this.topo.devices.find((d) => d.id === id)
  }
  devByName(name: string) {
    return this.topo.devices.find((d) => d.name.toLowerCase() === name.toLowerCase())
  }
  port(dev: Device, portId: string) {
    return dev.ports.find((p) => p.id === portId)
  }
  link(id: string | undefined) {
    return id ? this.topo.links.find((l) => l.id === id) : undefined
  }
  peerOf(dev: Device, port: Port): { dev: Device; port: Port } | null {
    const l = this.link(port.linkId)
    if (!l) return null
    const other = l.a.device === dev.id && l.a.port === port.id ? l.b : l.a
    const d = this.dev(other.device)
    const p = d && this.port(d, other.port)
    return d && p ? { dev: d, port: p } : null
  }
  /** Link light: both ends administratively up and cabled. */
  portUp(dev: Device, port: Port) {
    if (!port.up) return false
    const peer = this.peerOf(dev, port)
    return !!peer && peer.port.up
  }
  private st(devId: string): DevState {
    let s = this.state.get(devId)
    if (!s) {
      s = { arp: new Map(), pending: new Map(), mac: new Map(), leases: new Map() }
      this.state.set(devId, s)
    }
    return s
  }
  arpTable(devId: string) {
    return [...this.st(devId).arp.entries()]
  }
  macTable(devId: string) {
    return [...this.st(devId).mac.entries()]
  }

  // ---------- topology editing ----------
  addDevice(kind: DeviceKind, x: number, y: number) {
    const d = makeDevice(kind, nextName(this.topo, kind), x, y)
    this.topo.devices.push(d)
    this.changed()
    this.onAction?.({ type: 'add', dev: d.name })
    return d
  }
  moveDevice(id: string, x: number, y: number) {
    const d = this.dev(id)
    if (!d) return
    d.x = x
    d.y = y
    this.emit()
  }
  removeDevice(id: string) {
    const name = this.dev(id)?.name
    for (const l of this.topo.links.filter((l) => l.a.device === id || l.b.device === id)) this.disconnect(l.id, false)
    this.topo.devices = this.topo.devices.filter((d) => d.id !== id)
    this.state.delete(id)
    this.changed()
    if (name) this.onAction?.({ type: 'remove', dev: name })
  }
  connect(a: LinkEnd, b: LinkEnd) {
    const A = this.dev(a.device)
    const B = this.dev(b.device)
    const pa = A && this.port(A, a.port)
    const pb = B && this.port(B, b.port)
    if (!A || !B || !pa || !pb || A === B || pa.linkId || pb.linkId) return null
    const link: Link = { id: newId('l'), a, b }
    pa.linkId = link.id
    pb.linkId = link.id
    this.topo.links.push(link)
    this.flushSwitches()
    this.changed()
    this.onAction?.({ type: 'connect', a: `${A.name} ${pa.name}`, b: `${B.name} ${pb.name}` })
    // A host set to DHCP asks for an address as soon as it is cabled.
    for (const d of [A, B]) if (isHost(d.kind) && d.dhcp && !d.ports[0].ip) this.after(1, () => this.dhcpRequest(d.id))
    return link
  }
  disconnect(linkId: string, notify = true) {
    const l = this.link(linkId)
    if (!l) return
    const an = this.dev(l.a.device)?.name ?? '?'
    const bn = this.dev(l.b.device)?.name ?? '?'
    for (const end of [l.a, l.b]) {
      const d = this.dev(end.device)
      const p = d && this.port(d, end.port)
      if (p) p.linkId = undefined
      if (d) this.st(d.id).arp.clear()
    }
    this.topo.links = this.topo.links.filter((x) => x.id !== linkId)
    this.flushSwitches()
    if (notify) {
      this.changed()
      this.onAction?.({ type: 'disconnect', a: an, b: bn })
    }
  }
  /** Apply a settings change to a device; caches that depend on it are cleared. */
  update(id: string, fn: (d: Device) => void, record = true) {
    const d = this.dev(id)
    if (!d) return
    fn(d)
    if (record) this.onAction?.({ type: 'config', dev: d.name })
    for (const p of d.ports) if (p.mask) p.mask = normalizeMask(p.mask) ?? p.mask
    this.st(id).arp.clear()
    this.flushSwitches()
    this.changed()
  }
  replaceTopology(topo: Topology) {
    this.topo = topo
    this.reset()
  }
  /** Clear all runtime state (caches, packets in flight, log). */
  reset() {
    this.q = []
    this.state.clear()
    this.waiters.clear()
    this.dnsWaiters.clear()
    this.log = []
    this.now = 0
    this.stats = { arp: 0, icmp: 0, dhcp: 0, dns: 0 }
    this.droppedCount = 0
    this.changed()
    for (const d of this.topo.devices) if (isHost(d.kind) && d.dhcp && !d.ports[0].ip) this.after(1, () => this.dhcpRequest(d.id))
  }
  private changed() {
    this.recomputeStp()
    this.emit()
  }
  private flushSwitches() {
    for (const d of this.topo.devices) if (d.kind === 'switch') this.st(d.id).mac.clear()
  }

  /** Spanning tree among switches: keep a loop-free tree, block the rest. */
  private recomputeStp() {
    this.blocked.clear()
    const switches = this.topo.devices.filter((d) => d.kind === 'switch')
    const bridgeId = (d: Device) => d.ports[0].mac
    const seen = new Set<string>()
    const sorted = [...switches].sort((a, b) => (bridgeId(a) < bridgeId(b) ? -1 : 1))
    for (const root of sorted) {
      if (seen.has(root.id)) continue
      seen.add(root.id)
      const queue = [root]
      const usedLinks = new Set<string>()
      while (queue.length) {
        const sw = queue.shift()!
        for (const p of sw.ports) {
          const l = this.link(p.linkId)
          if (!l || usedLinks.has(l.id)) continue
          const peer = this.peerOf(sw, p)
          if (!peer || peer.dev.kind !== 'switch') continue
          usedLinks.add(l.id)
          if (seen.has(peer.dev.id)) {
            // Redundant link: block it on the side farther from the root.
            this.blocked.add(`${peer.dev.id}|${peer.port.id}`)
          } else {
            seen.add(peer.dev.id)
            queue.push(peer.dev)
          }
        }
      }
    }
  }

  // ---------- event queue ----------
  private push(ev: Ev) {
    let i = this.q.length
    while (i > 0 && (this.q[i - 1].t > ev.t || (this.q[i - 1].t === ev.t && this.q[i - 1].seq > ev.seq))) i--
    this.q.splice(i, 0, ev)
  }
  after(delay: number, fn: () => void): TimerEv {
    const ev: TimerEv = { kind: 'timer', t: this.now + delay, seq: this.seq++, fn }
    this.push(ev)
    return ev
  }
  nextEventTime(): number | null {
    const ev = this.q.find((e) => e.kind === 'frame' || !e.cancelled)
    return ev ? ev.t : null
  }
  /** Time of the next frame arrival (for step-by-step mode). */
  nextFrameTime(): number | null {
    const ev = this.q.find((e) => e.kind === 'frame')
    return ev ? ev.t : null
  }
  get busy() {
    return this.q.some((e) => e.kind === 'frame' || !e.cancelled)
  }
  /** Process everything up to time t. */
  advance(t: number) {
    let changed = false
    while (this.q.length && this.q[0].t <= t) {
      const ev = this.q.shift()!
      this.now = ev.t
      if (ev.kind === 'timer') {
        if (!ev.cancelled) ev.fn()
      } else {
        this.deliver(ev)
      }
      changed = true
    }
    this.now = Math.max(this.now, t)
    if (changed || this.q.some((e) => e.kind === 'frame')) this.emit()
  }
  inflight(): InFlight[] {
    return this.q
      .filter((e): e is FrameEv => e.kind === 'frame' && e.depart <= this.now)
      .map((e) => ({
        id: e.logId,
        link: e.link,
        from: e.from,
        to: e.to,
        progress: Math.min(1, Math.max(0, (this.now - e.depart) / (e.t - e.depart))),
        proto: frameProto(e.frame),
      }))
  }

  // ---------- link layer ----------
  private transmit(dev: Device, port: Port, frame: Omit<Frame, 'id'>) {
    if (!this.portUp(dev, port)) return
    if (this.blocked.has(`${dev.id}|${port.id}`)) return
    const l = this.link(port.linkId)!
    const peer = this.peerOf(dev, port)!
    const full: Frame = { ...frame, id: this.frameId++ }
    this.stats[frameProto(full)]++
    const entry: LogEntry = {
      id: this.logSeq++,
      time: this.now,
      fromDev: dev.id,
      toDev: peer.dev.id,
      proto: frameProto(full),
      frame: structuredClone(full),
    }
    this.log.push(entry)
    if (this.log.length > 2000) this.log.splice(0, 500)
    this.push({
      kind: 'frame',
      t: this.now + LINK_DELAY,
      seq: this.seq++,
      depart: this.now,
      link: l.id,
      from: { device: dev.id, port: port.id },
      to: { device: peer.dev.id, port: peer.port.id },
      frame: full,
      logId: entry.id,
    })
  }
  private drop(ev: FrameEv, reason: string) {
    this.droppedCount++
    const e = this.log.find((x) => x.id === ev.logId)
    if (e) e.dropped = reason
  }
  private deliver(ev: FrameEv) {
    const dev = this.dev(ev.to.device)
    const port = dev && this.port(dev, ev.to.port)
    if (!dev || !port || !port.up || port.linkId !== ev.link) return
    if (this.blocked.has(`${dev.id}|${port.id}`)) return this.drop(ev, 'stp')
    if (dev.kind === 'switch') return this.switchReceive(dev, port, ev)
    const f = ev.frame
    if (f.dstMac !== port.mac && f.dstMac !== BROADCAST_MAC) return this.drop(ev, 'not-mine')
    if (f.arp) return this.arpReceive(dev, port, f.arp, ev)
    if (f.ip) return dev.kind === 'router' ? this.routerReceive(dev, port, f.ip, ev) : this.hostReceive(dev, port, f.ip, ev)
  }

  private switchReceive(sw: Device, inPort: Port, ev: FrameEv) {
    const st = this.st(sw.id)
    const f = ev.frame
    st.mac.set(f.srcMac, inPort.id)
    const out = f.dstMac !== BROADCAST_MAC ? st.mac.get(f.dstMac) : undefined
    if (out) {
      if (out === inPort.id) return this.drop(ev, 'same-port')
      const p = this.port(sw, out)
      if (p) this.transmit(sw, p, { srcMac: f.srcMac, dstMac: f.dstMac, arp: f.arp, ip: f.ip })
      return
    }
    for (const p of sw.ports) {
      if (p.id === inPort.id || !p.linkId) continue
      this.transmit(sw, p, { srcMac: f.srcMac, dstMac: f.dstMac, arp: f.arp, ip: f.ip })
    }
  }

  // ---------- ARP ----------
  /** IP addresses owned by a device on a given port (valid ones only). */
  private portIp(port: Port) {
    return port.ip && ipToInt(port.ip) !== null && maskToPrefix(port.mask) !== null ? port.ip : null
  }
  private arpReceive(dev: Device, port: Port, a: ArpPayload, ev: FrameEv) {
    const myIp = this.portIp(port)
    const st = this.st(dev.id)
    if (a.op === 'request') {
      if (!myIp || a.targetIp !== myIp) return this.drop(ev, 'arp-not-mine')
      st.arp.set(a.senderIp, { mac: a.senderMac, port: port.id })
      this.flushPending(dev, port.id, a.senderIp)
      this.transmit(dev, port, {
        srcMac: port.mac,
        dstMac: a.senderMac,
        arp: { op: 'reply', senderMac: port.mac, senderIp: myIp, targetMac: a.senderMac, targetIp: a.senderIp },
      })
    } else {
      if (!myIp || a.targetIp !== myIp) return this.drop(ev, 'arp-not-mine')
      st.arp.set(a.senderIp, { mac: a.senderMac, port: port.id })
      this.flushPending(dev, port.id, a.senderIp)
    }
  }
  private flushPending(dev: Device, portId: string, ip: string) {
    const st = this.st(dev.id)
    const key = `${portId}|${ip}`
    const pend = st.pending.get(key)
    if (!pend) return
    st.pending.delete(key)
    pend.timer.cancelled = true
    const port = this.port(dev, portId)
    const entry = st.arp.get(ip)
    if (!port || !entry) return
    for (const { pkt } of pend.packets) this.transmit(dev, port, { srcMac: port.mac, dstMac: entry.mac, ip: pkt })
  }
  /** Send an IP packet to a next hop on a port, resolving its MAC with ARP first. */
  private sendVia(dev: Device, port: Port, nextHop: string, pkt: IpPacket, onFail?: () => void) {
    const st = this.st(dev.id)
    const cached = st.arp.get(nextHop)
    if (cached && cached.port === port.id) {
      this.transmit(dev, port, { srcMac: port.mac, dstMac: cached.mac, ip: pkt })
      return
    }
    const key = `${port.id}|${nextHop}`
    const pend = st.pending.get(key)
    if (pend) {
      pend.packets.push({ pkt, onFail })
      return
    }
    const myIp = this.portIp(port)!
    const timer = this.after(ARP_TIMEOUT, () => {
      const p = st.pending.get(key)
      if (!p) return
      st.pending.delete(key)
      p.packets.forEach((x) => x.onFail?.())
    })
    st.pending.set(key, { packets: [{ pkt, onFail }], timer })
    this.transmit(dev, port, {
      srcMac: port.mac,
      dstMac: BROADCAST_MAC,
      arp: { op: 'request', senderMac: port.mac, senderIp: myIp, targetMac: '0000.0000.0000', targetIp: nextHop },
    })
  }

  // ---------- hosts ----------
  hostConfig(d: Device) {
    const p = d.ports[0]
    const ip = this.portIp(p)
    return ip ? { ip, mask: normalizeMask(p.mask)!, port: p } : null
  }
  /** Why a host can't send to dst right now, or null. */
  private hostRoute(d: Device, dst: string): { port: Port; nextHop: string; src: string } | null {
    const cfg = this.hostConfig(d)
    if (!cfg || !this.portUp(d, cfg.port)) return null
    if (inSubnet(dst, cfg.ip, cfg.mask)) return { port: cfg.port, nextHop: dst, src: cfg.ip }
    const gw = d.gateway
    if (!gw || ipToInt(gw) === null || !inSubnet(gw, cfg.ip, cfg.mask)) return null
    return { port: cfg.port, nextHop: gw, src: cfg.ip }
  }
  private hostReceive(d: Device, port: Port, pkt: IpPacket, ev: FrameEv) {
    const cfg = this.hostConfig(d)
    const toMe = cfg && pkt.dst === cfg.ip
    const bcast = isBroadcastIp(pkt.dst) || (cfg && ipToInt(pkt.dst) === broadcastOf(cfg.ip, cfg.mask))
    if (!toMe && !bcast) return this.drop(ev, 'not-mine')
    if (pkt.icmp) {
      if (!toMe) return
      if (pkt.icmp.type === 'echo-request') {
        this.originate(d, { src: cfg!.ip, dst: pkt.src, ttl: HOST_TTL, icmp: { ...pkt.icmp, type: 'echo-reply' } })
      } else {
        this.resolveWaiter(d.id, pkt)
      }
      return
    }
    const udp = pkt.udp
    if (udp?.dhcp) return this.dhcpReceive(d, port, pkt, udp.dhcp, ev)
    if (udp?.dns) return this.dnsReceive(d, pkt, udp.dns)
  }

  // ---------- routers ----------
  private routerIps(r: Device) {
    return r.ports.filter((p) => this.portIp(p) && this.portUp(r, p)).map((p) => p.ip!)
  }
  /** Longest-prefix match over connected networks and static routes. */
  routeLookup(r: Device, dst: string): { port: Port; nextHop: string } | null {
    const d = ipToInt(dst)
    if (d === null) return null
    const connected = r.ports.filter((p) => this.portIp(p) && this.portUp(r, p))
    let best: { port: Port; nextHop: string; prefix: number } | null = null
    for (const p of connected) {
      const prefix = maskToPrefix(p.mask)!
      if (networkOf(dst, p.mask!) === networkOf(p.ip!, p.mask!) && (!best || prefix > best.prefix)) {
        best = { port: p, nextHop: dst, prefix }
      }
    }
    for (const rt of r.routes ?? []) {
      const prefix = maskToPrefix(rt.mask)
      const net = ipToInt(rt.network)
      if (prefix === null || net === null) continue
      if (networkOf(dst, rt.mask) !== networkOf(rt.network, rt.mask)) continue
      if (best && best.prefix >= prefix) continue
      const via = connected.find((p) => inSubnet(rt.nextHop, p.ip!, p.mask!))
      if (via) best = { port: via, nextHop: rt.nextHop, prefix }
    }
    return best
  }
  private routerReceive(r: Device, inPort: Port, pkt: IpPacket, ev: FrameEv) {
    if (!this.portIp(inPort)) return this.drop(ev, 'no-ip')
    if (this.routerIps(r).includes(pkt.dst)) {
      if (pkt.icmp?.type === 'echo-request') {
        this.originate(r, { src: pkt.dst, dst: pkt.src, ttl: ROUTER_TTL, icmp: { ...pkt.icmp, type: 'echo-reply' } })
      } else if (pkt.icmp) {
        this.resolveWaiter(r.id, pkt)
      }
      return
    }
    // Broadcasts (e.g. DHCP) stay in their network: routers don't forward them.
    if (isBroadcastIp(pkt.dst) || ipToInt(pkt.dst) === broadcastOf(inPort.ip!, inPort.mask!)) return this.drop(ev, 'broadcast')
    if (pkt.ttl <= 1) {
      this.drop(ev, 'ttl')
      if (pkt.icmp?.type === 'echo-request') {
        this.originate(r, { src: inPort.ip!, dst: pkt.src, ttl: ROUTER_TTL, icmp: { ...pkt.icmp, type: 'time-exceeded' } })
      }
      return
    }
    const route = this.routeLookup(r, pkt.dst)
    if (!route) {
      this.drop(ev, 'no-route')
      if (pkt.icmp?.type === 'echo-request') {
        this.originate(r, { src: inPort.ip!, dst: pkt.src, ttl: ROUTER_TTL, icmp: { ...pkt.icmp, type: 'unreachable' } })
      }
      return
    }
    this.sendVia(r, route.port, route.nextHop, { ...pkt, ttl: pkt.ttl - 1 })
  }

  /** Send a packet created by this device (host or router). */
  private originate(d: Device, pkt: IpPacket, onFail?: (why: 'general' | 'arp') => void) {
    if (d.kind === 'router') {
      const route = this.routeLookup(d, pkt.dst)
      if (!route) return onFail?.('general')
      this.sendVia(d, route.port, route.nextHop, pkt, () => onFail?.('arp'))
      return
    }
    const route = this.hostRoute(d, pkt.dst)
    if (!route) return onFail?.('general')
    this.sendVia(d, route.port, route.nextHop, pkt, () => onFail?.('arp'))
  }

  // ---------- ICMP echo (ping / traceroute) ----------
  private waiterKey(devId: string, id: number, seq: number) {
    return `${devId}:${id}:${seq}`
  }
  private resolveWaiter(devId: string, pkt: IpPacket) {
    const ic = pkt.icmp!
    const w = this.waiters.get(this.waiterKey(devId, ic.id, ic.seq))
    if (!w) return
    this.waiters.delete(this.waiterKey(devId, ic.id, ic.seq))
    w.timer.cancelled = true
    if (ic.type === 'echo-reply') w.cb({ kind: 'reply', from: pkt.src, ttl: pkt.ttl })
    else if (ic.type === 'unreachable') w.cb({ kind: 'unreachable', from: pkt.src })
    else if (ic.type === 'time-exceeded') w.cb({ kind: 'ttl-expired', from: pkt.src })
  }
  /** Source address a device would use towards dst (for messages). */
  sourceFor(d: Device, dst: string): string | null {
    if (d.kind === 'router') {
      const r = this.routeLookup(d, dst)
      return r ? r.port.ip! : null
    }
    return this.hostRoute(d, dst)?.src ?? null
  }
  echo(devId: string, dst: string, opts: { ttl?: number; id: number; seq: number }, cb: (r: EchoResult) => void) {
    const d = this.dev(devId)
    if (!d) return cb({ kind: 'general' })
    const ownIps = d.kind === 'router' ? this.routerIps(d) : [this.hostConfig(d)?.ip].filter(Boolean)
    if (ownIps.includes(dst) || dst.startsWith('127.')) {
      this.after(LINK_DELAY, () => cb({ kind: 'reply', from: dst, ttl: d.kind === 'router' ? ROUTER_TTL : HOST_TTL }))
      return
    }
    const src = this.sourceFor(d, dst)
    if (!src) {
      this.after(0, () => cb({ kind: 'general' }))
      return
    }
    const key = this.waiterKey(devId, opts.id, opts.seq)
    const timer = this.after(PING_TIMEOUT, () => {
      if (this.waiters.delete(key)) cb({ kind: 'timeout' })
    })
    this.waiters.set(key, { cb, timer })
    const ttl = opts.ttl ?? (d.kind === 'router' ? ROUTER_TTL : HOST_TTL)
    this.originate(d, { src, dst, ttl, icmp: { type: 'echo-request', id: opts.id, seq: opts.seq } }, (why) => {
      const w = this.waiters.get(key)
      if (!w) return
      this.waiters.delete(key)
      w.timer.cancelled = true
      // Windows reports a failed ARP as "Destination host unreachable" from itself.
      cb(why === 'arp' ? (d.kind === 'router' ? { kind: 'timeout' } : { kind: 'unreachable', from: src }) : { kind: 'general' })
    })
  }
  cancelWaiters(devId: string) {
    for (const [k, w] of this.waiters) {
      if (k.startsWith(`${devId}:`)) {
        w.timer.cancelled = true
        this.waiters.delete(k)
      }
    }
  }

  // ---------- DHCP ----------
  dhcpRequest(devId: string, onDone?: (ok: boolean) => void) {
    const d = this.dev(devId)
    if (!d || !isHost(d.kind)) return onDone?.(false)
    const p = d.ports[0]
    const st = this.st(devId)
    p.ip = undefined
    p.mask = undefined
    d.gateway = ''
    d.dns = ''
    d.dhcpServer = undefined
    st.arp.clear()
    this.emit()
    if (!this.portUp(d, p)) {
      this.after(0, () => onDone?.(false))
      return
    }
    const xid = Math.floor(Math.random() * 0x7fffffff)
    st.dhcpXid = xid
    const finish = (ok: boolean) => {
      if (st.dhcpXid !== xid) return
      st.dhcpXid = undefined
      if (!ok) {
        // No server answered: Windows falls back to an APIPA address.
        p.ip = `169.254.${1 + Math.floor(Math.random() * 253)}.${1 + Math.floor(Math.random() * 253)}`
        p.mask = '255.255.0.0'
        this.emit()
      }
      onDone?.(ok)
    }
    st.dhcpDone = finish
    this.after(DHCP_TIMEOUT * 2, () => finish(false))
    this.broadcastUdp(d, 68, 67, { dhcp: { msg: 'DISCOVER', xid, clientMac: p.mac } }, '0.0.0.0')
  }
  private broadcastUdp(d: Device, srcPort: number, dstPort: number, payload: { dhcp?: DhcpPayload; dns?: DnsPayload }, src: string) {
    const p = d.ports[0]
    this.transmit(d, p, {
      srcMac: p.mac,
      dstMac: BROADCAST_MAC,
      ip: { src, dst: '255.255.255.255', ttl: HOST_TTL, udp: { srcPort, dstPort, ...payload } },
    })
  }
  private dhcpReceive(d: Device, port: Port, pkt: IpPacket, m: DhcpPayload, ev: FrameEv) {
    const st = this.st(d.id)
    const pool = d.dhcpPool
    const cfg = this.hostConfig(d)
    // ---- server side ----
    if (pkt.udp!.dstPort === 67) {
      if (d.kind !== 'server' || !pool?.enabled || !cfg) return this.drop(ev, 'no-dhcp')
      if (m.msg === 'DISCOVER') {
        const ip = this.dhcpPick(d, m.clientMac)
        if (!ip) return this.drop(ev, 'pool-full')
        // Reserve the offered address so parallel clients get different ones.
        st.leases.set(m.clientMac, ip)
        this.broadcastUdp(d, 67, 68, {
          dhcp: { msg: 'OFFER', xid: m.xid, clientMac: m.clientMac, yiaddr: ip, serverIp: cfg.ip, mask: normalizeMask(pool.mask) ?? '255.255.255.0', gateway: pool.gateway, dns: pool.dns },
        }, cfg.ip)
      } else if (m.msg === 'REQUEST' && m.serverIp === cfg.ip && m.yiaddr) {
        st.leases.set(m.clientMac, m.yiaddr)
        this.broadcastUdp(d, 67, 68, {
          dhcp: { msg: 'ACK', xid: m.xid, clientMac: m.clientMac, yiaddr: m.yiaddr, serverIp: cfg.ip, mask: normalizeMask(pool.mask) ?? '255.255.255.0', gateway: pool.gateway, dns: pool.dns },
        }, cfg.ip)
      }
      return
    }
    // ---- client side ----
    if (m.clientMac !== port.mac || st.dhcpXid !== m.xid) return this.drop(ev, 'not-mine')
    if (m.msg === 'OFFER') {
      this.broadcastUdp(d, 68, 67, { dhcp: { msg: 'REQUEST', xid: m.xid, clientMac: port.mac, yiaddr: m.yiaddr, serverIp: m.serverIp } }, '0.0.0.0')
    } else if (m.msg === 'ACK') {
      port.ip = m.yiaddr
      port.mask = m.mask
      d.gateway = m.gateway ?? ''
      d.dns = m.dns ?? ''
      d.dhcpServer = m.serverIp
      st.arp.clear()
      this.emit()
      st.dhcpDone?.(true)
    }
  }
  private dhcpPick(server: Device, clientMac: string): string | null {
    const pool = server.dhcpPool!
    const st = this.st(server.id)
    const existing = st.leases.get(clientMac)
    if (existing) return existing
    const start = ipToInt(pool.start)
    const mask = normalizeMask(pool.mask)
    if (start === null || !mask) return null
    const taken = new Set<string>([...st.leases.values()])
    for (const d of this.topo.devices) for (const p of d.ports) if (p.ip && p.mac !== clientMac) taken.add(p.ip)
    if (pool.gateway) taken.add(pool.gateway)
    for (let i = 0; i < Math.max(0, pool.count); i++) {
      const ip = intToIp((start + i) >>> 0)
      if (!taken.has(ip) && inSubnet(ip, pool.start, mask)) return ip
    }
    return null
  }

  // ---------- DNS ----------
  resolveName(devId: string, name: string, cb: (ip: string | null, why?: 'timeout' | 'nx' | 'nodns') => void) {
    if (ipToInt(name) !== null) return this.after(0, () => cb(name))
    const d = this.dev(devId)
    const dns = d?.dns
    if (!d || !dns || ipToInt(dns) === null) return this.after(0, () => cb(null, 'nodns'))
    const id = Math.floor(Math.random() * 65535)
    const timer = this.after(DNS_TIMEOUT, () => {
      if (this.dnsWaiters.delete(id)) cb(null, 'timeout')
    })
    this.dnsWaiters.set(id, { cb, timer })
    const src = this.sourceFor(d, dns)
    if (!src) {
      this.dnsWaiters.delete(id)
      timer.cancelled = true
      return this.after(0, () => cb(null, 'timeout'))
    }
    this.originate(d, { src, dst: dns, ttl: HOST_TTL, udp: { srcPort: 49152 + (id % 1000), dstPort: 53, dns: { qr: 'query', id, name } } })
  }
  private dnsReceive(d: Device, pkt: IpPacket, m: DnsPayload) {
    if (m.qr === 'query') {
      if (d.kind !== 'server' || !d.dnsEnabled) return
      const rec = d.dnsRecords?.find((r) => r.name.trim().toLowerCase() === m.name.trim().toLowerCase())
      this.originate(d, { src: pkt.dst, dst: pkt.src, ttl: HOST_TTL, udp: { srcPort: 53, dstPort: pkt.udp!.srcPort, dns: { qr: 'response', id: m.id, name: m.name, ip: rec?.ip } } })
      return
    }
    const w = this.dnsWaiters.get(m.id)
    if (!w) return
    this.dnsWaiters.delete(m.id)
    w.timer.cancelled = true
    w.cb(m.ip ?? null, m.ip ? undefined : 'nx')
  }
}

