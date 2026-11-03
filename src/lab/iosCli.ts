// Cisco IOS-style command line for routers and switches (a practical subset).
import { PING_GAP, type Engine } from './engine.ts'
import { ipToInt, maskToPrefix, networkOf, normalizeMask, intToIp } from './net.ts'
import type { Device, Port } from './model.ts'
import type { Out, Running } from './hostCli.ts'

export type IosMode = 'user' | 'priv' | 'config' | 'if'

export interface IosSession {
  mode: IosMode
  iface?: string
}

export const newSession = (): IosSession => ({ mode: 'user' })

export function iosPrompt(d: Device, s: IosSession) {
  switch (s.mode) {
    case 'user':
      return `${d.name}>`
    case 'priv':
      return `${d.name}#`
    case 'config':
      return `${d.name}(config)#`
    case 'if':
      return `${d.name}(config-if)#`
  }
}

/** "g0/0", "gig 0/0", "GigabitEthernet0/0", "fa0/1", "f0/1" -> port */
function findPort(d: Device, words: string[]): Port | undefined {
  const raw = words.join('').toLowerCase()
  const m = raw.match(/^([a-z]+)([\d/]+)$/)
  if (!m) return undefined
  const [, kind, num] = m
  return d.ports.find((p) => {
    const pk = p.name.toLowerCase().replace(/[\d/]+$/, '')
    const pn = p.name.match(/[\d/]+$/)![0]
    return pn === num && pk.startsWith(kind)
  })
}

const INVALID = "% Invalid input detected at '^' marker."
const INCOMPLETE = '% Incomplete command.'

/** Match a typed word against a keyword (IOS accepts unique prefixes). */
const is = (w: string | undefined, kw: string, min = 1) => !!w && w.length >= min && kw.startsWith(w.toLowerCase())

function statusOf(eng: Engine, d: Device, p: Port) {
  if (!p.up) return { status: 'administratively down', proto: 'down' }
  return eng.portUp(d, p) ? { status: 'up', proto: 'up' } : { status: 'down', proto: 'down' }
}

function showIpIntBrief(eng: Engine, d: Device, out: Out) {
  out('Interface              IP-Address      OK? Method Status                Protocol')
  for (const p of d.ports) {
    const s = statusOf(eng, d, p)
    out(
      `${p.name.padEnd(23)}${(p.ip ?? 'unassigned').padEnd(16)}YES ${(p.ip ? 'manual' : 'unset').padEnd(7)}${s.status.padEnd(22)}${s.proto}`,
    )
  }
}

function showIpRoute(eng: Engine, d: Device, out: Out) {
  out('Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP')
  out('       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area')
  out('       * - candidate default, U - per-user static route, o - ODR')
  out('')
  const def = (d.routes ?? []).find((r) => r.network === '0.0.0.0' && maskToPrefix(r.mask) === 0)
  out(def ? `Gateway of last resort is ${def.nextHop} to network 0.0.0.0` : 'Gateway of last resort is not set')
  out('')
  const lines: { key: number; text: string }[] = []
  for (const p of d.ports) {
    if (!p.ip || !p.mask || !eng.portUp(d, p)) continue
    const prefix = maskToPrefix(p.mask)!
    const net = intToIp(networkOf(p.ip, p.mask)!)
    lines.push({ key: networkOf(p.ip, p.mask)!, text: `C       ${net}/${prefix} is directly connected, ${p.name}` })
    lines.push({ key: ipToInt(p.ip)! + 0.5, text: `L       ${p.ip}/32 is directly connected, ${p.name}` })
  }
  for (const r of d.routes ?? []) {
    const prefix = maskToPrefix(r.mask)
    if (prefix === null) continue
    const usable = !!eng.routeLookup(d, r.nextHop)
    if (!usable) continue
    lines.push({ key: ipToInt(r.network) ?? 0, text: `${prefix === 0 ? 'S*' : 'S '}      ${r.network}/${prefix} [1/0] via ${r.nextHop}` })
  }
  lines.sort((a, b) => a.key - b.key).forEach((l) => out(l.text))
}

function showRun(d: Device, out: Out) {
  out('Building configuration...')
  out('')
  out('Current configuration :')
  out('!')
  out(`hostname ${d.name}`)
  out('!')
  for (const p of d.ports) {
    out(`interface ${p.name}`)
    if (d.kind === 'router') {
      out(p.ip && p.mask ? ` ip address ${p.ip} ${p.mask}` : ' no ip address')
    }
    if (!p.up) out(' shutdown')
    out('!')
  }
  for (const r of d.routes ?? []) out(`ip route ${r.network} ${r.mask} ${r.nextHop}`)
  out('!')
  out('end')
}

function showArp(eng: Engine, d: Device, out: Out) {
  out('Protocol  Address          Age (min)  Hardware Addr   Type   Interface')
  for (const p of d.ports) {
    if (p.ip && eng.portUp(d, p)) out(`Internet  ${p.ip.padEnd(17)}-          ${p.mac}  ARPA   ${p.name}`)
  }
  for (const [ip, e] of eng.arpTable(d.id)) {
    const p = d.ports.find((x) => x.id === e.port)
    out(`Internet  ${ip.padEnd(17)}0          ${e.mac}  ARPA   ${p?.name ?? ''}`)
  }
}

function showMac(eng: Engine, d: Device, out: Out) {
  out('          Mac Address Table')
  out('-------------------------------------------')
  out('')
  out('Vlan    Mac Address       Type        Ports')
  out('----    -----------       --------    -----')
  out('')
  for (const [mac, portId] of eng.macTable(d.id)) {
    const p = d.ports.find((x) => x.id === portId)
    out(`   1    ${mac}    DYNAMIC     ${p ? p.name.replace('FastEthernet', 'Fa').replace('GigabitEthernet', 'Gig') : ''}`)
  }
}

function iosPing(eng: Engine, d: Device, target: string, out: Out, done: () => void): Running {
  let stopped = false
  let ok = 0
  const n = 5
  const id = 1 + Math.floor(Math.random() * 60000)
  out('Type escape sequence to abort.')
  out(`Sending ${n}, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`)
  out('', false)
  const one = (seq: number) => {
    if (stopped) return
    if (seq > n) {
      out('')
      out(
        `Success rate is ${Math.round((ok / n) * 100)} percent (${ok}/${n})` + (ok ? ', round-trip min/avg/max = 0/0/1 ms' : ''),
      )
      return done()
    }
    eng.echo(d.id, target, { id, seq }, (r) => {
      if (stopped) return
      if (r.kind === 'reply') {
        ok++
        out('!', true)
      } else if (r.kind === 'unreachable') out('U', true)
      else out('.', true)
      eng.after(PING_GAP, () => one(seq + 1))
    })
  }
  one(1)
  return {
    stop: () => {
      stopped = true
      eng.cancelWaiters(d.id)
      done()
    },
  }
}

function iosTraceroute(eng: Engine, d: Device, target: string, out: Out, done: () => void): Running {
  let stopped = false
  const id = 1 + Math.floor(Math.random() * 60000)
  out('Type escape sequence to abort.')
  out(`Tracing the route to ${target}`)
  out('')
  const hop = (ttl: number) => {
    if (stopped) return
    if (ttl > 30) return done()
    eng.echo(d.id, target, { id, seq: ttl, ttl }, (r) => {
      if (stopped) return
      const n = String(ttl).padStart(3)
      if (r.kind === 'ttl-expired') {
        out(`${n} ${r.from} 0 msec 0 msec 0 msec`)
        eng.after(PING_GAP, () => hop(ttl + 1))
      } else if (r.kind === 'reply') {
        out(`${n} ${r.from} 0 msec 0 msec 0 msec`)
        done()
      } else if (r.kind === 'unreachable') {
        out(`${n} ${r.from} !H  !H  !H`)
        done()
      } else if (r.kind === 'timeout') {
        out(`${n}  *    *    *`)
        eng.after(PING_GAP, () => hop(ttl + 1))
      } else {
        out('% Unrecognized host or address, or protocol not running.')
        done()
      }
    })
  }
  hop(1)
  return {
    stop: () => {
      stopped = true
      eng.cancelWaiters(d.id)
      done()
    },
  }
}

export const IOS_HELP = [
  'enable / disable / exit / end',
  'configure terminal',
  '  hostname <nom>',
  '  interface <g0/0 | fa0/1>',
  '    ip address <ip> <mask>   no ip address',
  '    no shutdown              shutdown',
  '  ip route <tarmoq> <mask> <keyingi-hop>   no ip route ...',
  'show ip interface brief',
  'show ip route',
  'show running-config',
  'show arp',
  'show mac address-table',
  'ping <ip>        traceroute <ip>',
  'do <buyruq>      (config rejimida)',
]

/** Run one IOS command. `s` (the session) is updated in place. */
export function runIos(eng: Engine, devId: string, s: IosSession, line: string, out: Out, done: () => void): Running | null {
  const d = eng.dev(devId)
  if (!d) {
    done()
    return null
  }
  let w = line.trim().split(/\s+/).filter(Boolean)
  const finish = () => {
    done()
    return null
  }
  if (!w.length) return finish()
  if (w[0] === '?' || is(w[0], 'help', 2)) {
    IOS_HELP.forEach((l) => out(l))
    return finish()
  }
  // "do <cmd>" runs an exec command from configuration mode.
  let execFromConfig = false
  if ((s.mode === 'config' || s.mode === 'if') && is(w[0], 'do', 2)) {
    w = w.slice(1)
    execFromConfig = true
  }
  const mode = execFromConfig ? 'priv' : s.mode

  // ---- global exits ----
  if (is(w[0], 'end', 3) && (s.mode === 'config' || s.mode === 'if')) {
    s.mode = 'priv'
    s.iface = undefined
    return finish()
  }
  if (is(w[0], 'exit', 3)) {
    if (s.mode === 'if') s.mode = 'config'
    else if (s.mode === 'config') s.mode = 'priv'
    else s.mode = 'user'
    s.iface = undefined
    return finish()
  }

  // ---- exec modes ----
  if (mode === 'user' || mode === 'priv') {
    if (is(w[0], 'enable', 2) && mode === 'user') {
      s.mode = 'priv'
      return finish()
    }
    if (is(w[0], 'disable', 4)) {
      s.mode = 'user'
      return finish()
    }
    if (is(w[0], 'configure', 4) && mode === 'priv' && !execFromConfig) {
      if (!w[1] || is(w[1], 'terminal', 1)) {
        out('Enter configuration commands, one per line.  End with CNTL/Z.')
        s.mode = 'config'
        return finish()
      }
      out(INVALID)
      return finish()
    }
    if (is(w[0], 'ping', 2)) {
      if (!w[1] || ipToInt(w[1]) === null) {
        out(w[1] ? '% Unrecognized host or address, or protocol not running.' : INCOMPLETE)
        return finish()
      }
      return iosPing(eng, d, w[1], out, done)
    }
    if (is(w[0], 'traceroute', 3)) {
      if (!w[1] || ipToInt(w[1]) === null) {
        out(w[1] ? '% Unrecognized host or address, or protocol not running.' : INCOMPLETE)
        return finish()
      }
      return iosTraceroute(eng, d, w[1], out, done)
    }
    if (is(w[0], 'show', 2)) {
      const a = w.slice(1).map((x) => x.toLowerCase())
      if (is(a[0], 'ip', 2) && is(a[1], 'interface', 3) && is(a[2], 'brief', 1)) showIpIntBrief(eng, d, out)
      else if (is(a[0], 'ip', 2) && is(a[1], 'route', 1) && d.kind === 'router') showIpRoute(eng, d, out)
      else if (is(a[0], 'running-config', 3) && mode === 'priv') showRun(d, out)
      else if (is(a[0], 'arp', 2)) showArp(eng, d, out)
      else if ((is(a[0], 'mac', 2) && is(a[1], 'address-table', 1)) || is(a[0], 'mac-address-table', 4)) {
        if (d.kind === 'switch') showMac(eng, d, out)
        else out(INVALID)
      } else out(a.length ? INVALID : INCOMPLETE)
      return finish()
    }
    if (is(w[0], 'copy', 2) || is(w[0], 'write', 2)) {
      out('Building configuration...')
      out('[OK]')
      return finish()
    }
    out(mode === 'user' && (is(w[0], 'configure', 4) || is(w[0], 'interface', 3)) ? INVALID : '% Unknown command or computer name, or unable to find computer address')
    return finish()
  }

  // ---- global configuration ----
  if (s.mode === 'config') {
    if (is(w[0], 'hostname', 4)) {
      if (!w[1]) out(INCOMPLETE)
      else eng.update(d.id, (x) => (x.name = w[1]))
      return finish()
    }
    if (is(w[0], 'interface', 3)) {
      const p = findPort(d, w.slice(1))
      if (!p) {
        out(w[1] ? INVALID : INCOMPLETE)
        return finish()
      }
      s.mode = 'if'
      s.iface = p.id
      return finish()
    }
    const no = is(w[0], 'no', 2)
    const rw = no ? w.slice(1) : w
    if (is(rw[0], 'ip', 2) && is(rw[1], 'route', 1) && d.kind === 'router') {
      const [net, mask, nh] = rw.slice(2)
      const m = normalizeMask(mask)
      if (!net || !mask || (!nh && !no)) {
        out(INCOMPLETE)
        return finish()
      }
      if (ipToInt(net) === null || !m || maskToPrefix(m)! > 32 || (nh && ipToInt(nh) === null)) {
        out(INVALID)
        return finish()
      }
      if (networkOf(net, m) !== ipToInt(net)) {
        out('%Inconsistent address and mask')
        return finish()
      }
      eng.update(d.id, (x) => {
        const routes = (x.routes ?? []).filter((r) => !(r.network === net && normalizeMask(r.mask) === m && (!nh || r.nextHop === nh)))
        if (!no) routes.push({ network: net, mask: m, nextHop: nh })
        x.routes = routes
      })
      return finish()
    }
    out(INVALID)
    return finish()
  }

  // ---- interface configuration ----
  const port = d.ports.find((p) => p.id === s.iface)!
  const no = is(w[0], 'no', 2)
  const rw = no ? w.slice(1) : w
  if (is(rw[0], 'shutdown', 2)) {
    eng.update(d.id, (x) => (x.ports.find((p) => p.id === port.id)!.up = no))
    if (no) {
      const peerUp = eng.portUp(d, port)
      out(`%LINK-5-CHANGED: Interface ${port.name}, changed state to ${peerUp ? 'up' : 'down'}`)
      if (peerUp) {
        out('')
        out(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port.name}, changed state to up`)
      }
    } else {
      out(`%LINK-5-CHANGED: Interface ${port.name}, changed state to administratively down`)
      out('')
      out(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port.name}, changed state to down`)
    }
    return finish()
  }
  if (is(rw[0], 'ip', 2) && is(rw[1], 'address', 3)) {
    if (d.kind !== 'router') {
      out(INVALID)
      return finish()
    }
    if (no) {
      eng.update(d.id, (x) => {
        const p = x.ports.find((q) => q.id === port.id)!
        p.ip = undefined
        p.mask = undefined
      })
      return finish()
    }
    const [ip, mask] = rw.slice(2)
    if (!ip || !mask) {
      out(INCOMPLETE)
      return finish()
    }
    const m = normalizeMask(mask)
    if (ipToInt(ip) === null || !m) {
      out(INVALID)
      return finish()
    }
    if (maskToPrefix(m)! < 31 && (ipToInt(ip) === networkOf(ip, m) || ((ipToInt(ip)! | (~ipToInt(m)! >>> 0)) >>> 0) === ipToInt(ip))) {
      out(`Bad mask /${maskToPrefix(m)} for address ${ip}`)
      return finish()
    }
    const overlap = d.ports.find((p) => p.id !== port.id && p.ip && p.mask && (networkOf(ip, p.mask) === networkOf(p.ip, p.mask) || networkOf(p.ip, m) === networkOf(ip, m)))
    if (overlap) {
      out(`% ${intToIp(networkOf(ip, m)!)} overlaps with ${overlap.name}`)
      return finish()
    }
    eng.update(d.id, (x) => {
      const p = x.ports.find((q) => q.id === port.id)!
      p.ip = ip
      p.mask = m
    })
    return finish()
  }
  if (is(rw[0], 'description', 3) || is(rw[0], 'duplex', 3) || is(rw[0], 'speed', 2)) return finish()
  out(INVALID)
  return finish()
}
