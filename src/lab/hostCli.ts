// Windows-style command prompt for PCs, laptops and servers.
import { PING_GAP, type Engine, type EchoResult } from './engine.ts'
import { ipToInt, macLower, macWindows } from './net.ts'
import type { Device } from './model.ts'

export type Out = (text: string, inline?: boolean) => void
export interface Running {
  stop: () => void
}

const ADAPTER = 'Ethernet0'

function adapterBlock(eng: Engine, d: Device, all: boolean): string[] {
  const p = d.ports[0]
  const lines = [`Ethernet adapter ${ADAPTER}:`, '']
  if (!eng.portUp(d, p)) {
    lines.push('   Media State . . . . . . . . . . . : Media disconnected')
    lines.push('   Connection-specific DNS Suffix  . :')
    if (all) {
      lines.push('   Description . . . . . . . . . . . : Intel(R) Ethernet Connection')
      lines.push(`   Physical Address. . . . . . . . . : ${macWindows(p.mac)}`)
      lines.push(`   DHCP Enabled. . . . . . . . . . . : ${d.dhcp ? 'Yes' : 'No'}`)
    }
    return lines
  }
  lines.push('   Connection-specific DNS Suffix  . :')
  if (all) {
    lines.push('   Description . . . . . . . . . . . : Intel(R) Ethernet Connection')
    lines.push(`   Physical Address. . . . . . . . . : ${macWindows(p.mac)}`)
    lines.push(`   DHCP Enabled. . . . . . . . . . . : ${d.dhcp ? 'Yes' : 'No'}`)
    lines.push('   Autoconfiguration Enabled . . . . : Yes')
  }
  const apipa = p.ip?.startsWith('169.254.')
  if (p.ip) {
    const label = apipa ? '   Autoconfiguration IPv4 Address. . : ' : '   IPv4 Address. . . . . . . . . . . : '
    lines.push(label + p.ip + (all ? '(Preferred)' : ''))
    lines.push(`   Subnet Mask . . . . . . . . . . . : ${p.mask ?? ''}`)
  }
  lines.push(`   Default Gateway . . . . . . . . . : ${d.gateway ?? ''}`)
  if (all) {
    if (d.dhcp && d.dhcpServer) lines.push(`   DHCP Server . . . . . . . . . . . : ${d.dhcpServer}`)
    if (d.dns) lines.push(`   DNS Servers . . . . . . . . . . . : ${d.dns}`)
  }
  return lines
}

function ipconfig(eng: Engine, d: Device, all: boolean): string {
  const head = ['', 'Windows IP Configuration', '']
  if (all) {
    head.push(
      `   Host Name . . . . . . . . . . . . : ${d.name}`,
      '   Primary Dns Suffix  . . . . . . . :',
      '   Node Type . . . . . . . . . . . . : Hybrid',
      '   IP Routing Enabled. . . . . . . . : No',
      '   WINS Proxy Enabled. . . . . . . . : No',
      '',
    )
  } else head.push('')
  return [...head, ...adapterBlock(eng, d, all)].join('\n')
}

const pingStats = (ip: string, sent: number, received: number, rtts: number[]) => {
  const lost = sent - received
  const lines = [
    '',
    `Ping statistics for ${ip}:`,
    `    Packets: Sent = ${sent}, Received = ${received}, Lost = ${lost} (${sent ? Math.round((lost / sent) * 100) : 0}% loss),`,
  ]
  if (rtts.length) {
    const min = Math.min(...rtts)
    const max = Math.max(...rtts)
    const avg = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length)
    lines.push('Approximate round trip times in milli-seconds:', `    Minimum = ${min}ms, Maximum = ${max}ms, Average = ${avg}ms`)
  }
  return lines.join('\n')
}

function ping(eng: Engine, d: Device, target: string, count: number, out: Out, done: () => void): Running {
  let stopped = false
  let sent = 0
  let received = 0
  const rtts: number[] = []
  let ipShown = target
  const id = 1 + Math.floor(Math.random() * 60000)

  const finish = () => {
    out(pingStats(ipShown, sent, received, rtts))
    done()
  }
  const one = (ip: string, seq: number) => {
    if (stopped) return
    if (seq > count) return finish()
    sent++
    eng.echo(d.id, ip, { id, seq }, (r: EchoResult) => {
      if (stopped) return
      switch (r.kind) {
        case 'reply':
          received++
          rtts.push(0) // a LAN round trip is shown as <1ms, like real Windows
          out(`Reply from ${r.from}: bytes=32 time<1ms TTL=${r.ttl}`)
          break
        case 'unreachable':
          received++
          out(`Reply from ${r.from}: Destination host unreachable.`)
          break
        case 'ttl-expired':
          received++
          out(`Reply from ${r.from}: TTL expired in transit.`)
          break
        case 'timeout':
          out('Request timed out.')
          break
        case 'general':
          out('PING: transmit failed. General failure.')
          break
      }
      eng.after(PING_GAP, () => one(ip, seq + 1))
    })
  }

  eng.resolveName(d.id, target, (ip, why) => {
    if (stopped) return
    if (!ip) {
      out(
        why === 'nodns' || why === 'nx' || why === 'timeout'
          ? `Ping request could not find host ${target}. Please check the name and try again.`
          : `Ping request could not find host ${target}.`,
      )
      return done()
    }
    ipShown = ip
    out('')
    out(`Pinging ${ip === target ? ip : `${target} [${ip}]`} with 32 bytes of data:`)
    one(ip, 1)
  })
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      eng.cancelWaiters(d.id)
      out('Control-C')
      if (sent) out(pingStats(ipShown, sent, received, rtts))
      out('^C')
      done()
    },
  }
}

function tracert(eng: Engine, d: Device, target: string, out: Out, done: () => void): Running {
  let stopped = false
  const id = 1 + Math.floor(Math.random() * 60000)
  const hop = (ip: string, ttl: number) => {
    if (stopped) return
    if (ttl > 30) {
      out('')
      out('Trace complete.')
      return done()
    }
    eng.echo(d.id, ip, { id, seq: ttl, ttl }, (r) => {
      if (stopped) return
      const n = String(ttl).padStart(3)
      const times = '    <1 ms    <1 ms    <1 ms  '
      switch (r.kind) {
        case 'ttl-expired':
          out(`${n}${times}${r.from}`)
          return eng.after(PING_GAP, () => hop(ip, ttl + 1))
        case 'reply':
          out(`${n}${times}${r.from}`)
          out('')
          out('Trace complete.')
          return done()
        case 'unreachable':
          out(`${n}  ${r.from}  reports: Destination host unreachable.`)
          out('')
          out('Trace complete.')
          return done()
        case 'timeout':
          out(`${n}     *        *        *     Request timed out.`)
          return eng.after(PING_GAP, () => hop(ip, ttl + 1))
        case 'general':
          out('Transmit error: code 1231.')
          return done()
      }
    })
  }
  eng.resolveName(d.id, target, (ip) => {
    if (stopped) return
    if (!ip) {
      out(`Unable to resolve target system name ${target}.`)
      return done()
    }
    out('')
    out(`Tracing route to ${ip === target ? ip : `${target} [${ip}]`}`)
    out('over a maximum of 30 hops:')
    out('')
    hop(ip, 1)
  })
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      eng.cancelWaiters(d.id)
      out('^C')
      done()
    },
  }
}

function nslookup(eng: Engine, d: Device, name: string, out: Out, done: () => void) {
  const dns = d.dns && ipToInt(d.dns) !== null ? d.dns : null
  if (!dns) {
    out('*** Default servers are not available')
    out('Server:  UnKnown')
    out('Address:  127.0.0.1')
    out('')
    out(`*** UnKnown can't find ${name}: No response from server`)
    return done()
  }
  out('Server:  UnKnown')
  out(`Address:  ${dns}`)
  out('')
  eng.resolveName(d.id, name, (ip, why) => {
    if (ip) {
      out('Name:    ' + name)
      out('Address:  ' + ip)
    } else if (why === 'nx') {
      out(`*** UnKnown can't find ${name}: Non-existent domain`)
    } else {
      out('DNS request timed out.')
      out('    timeout was 2 seconds.')
      out(`*** Request to UnKnown timed-out`)
    }
    out('')
    done()
  })
}

function arp(eng: Engine, d: Device, args: string[], out: Out) {
  if (args[0] === '-d') {
    eng.update(d.id, () => {}, false)
    return
  }
  const cfg = eng.hostConfig(d)
  const entries = eng.arpTable(d.id)
  if (!cfg || !entries.length) return out('No ARP Entries Found.')
  out('')
  out(`Interface: ${cfg.ip} --- 0x3`)
  out('  Internet Address      Physical Address      Type')
  for (const [ip, e] of entries) out(`  ${ip.padEnd(22)}${macLower(e.mac).padEnd(22)}dynamic`)
}

export const HOST_HELP = [
  'ipconfig            - IP sozlamalari / IP configuration',
  'ipconfig /all       - batafsil / detailed',
  'ipconfig /renew     - DHCP orqali IP olish / get IP via DHCP',
  'ipconfig /release   - DHCP IP ni bo‘shatish / release',
  'ping <ip|nom> [-n N]',
  'tracert <ip|nom>',
  'arp -a              - ARP jadvali',
  'arp -d              - ARP jadvalini tozalash',
  'nslookup <nom>',
  'hostname',
  'cls',
]

/** Run one command line. Returns a handle while the command keeps running. */
export function runHost(eng: Engine, devId: string, line: string, out: Out, done: () => void): Running | null {
  const d = eng.dev(devId)
  if (!d) {
    done()
    return null
  }
  const words = line.trim().split(/\s+/).filter(Boolean)
  const cmd = (words[0] ?? '').toLowerCase()
  const args = words.slice(1)
  const finish = () => {
    done()
    return null
  }
  switch (cmd) {
    case '':
      return finish()
    case 'help':
    case '?':
      HOST_HELP.forEach((l) => out(l))
      return finish()
    case 'hostname':
      out(d.name)
      return finish()
    case 'ipconfig': {
      const opt = (args[0] ?? '').toLowerCase()
      if (opt === '/all') {
        out(ipconfig(eng, d, true))
        return finish()
      }
      if (opt === '/renew' || opt === '/release') {
        if (!eng.portUp(d, d.ports[0])) {
          out('')
          out('Windows IP Configuration')
          out('')
          out(`No operation can be performed on ${ADAPTER} while it has its media disconnected.`)
          return finish()
        }
        if (!d.dhcp) {
          out('')
          out('Windows IP Configuration')
          out('')
          out(`The operation failed as no adapter is in the state permissible for this operation.`)
          return finish()
        }
        if (opt === '/release') {
          eng.update(d.id, (x) => {
            x.ports[0].ip = undefined
            x.ports[0].mask = undefined
            x.gateway = ''
            x.dns = ''
            x.dhcpServer = undefined
          })
          out(ipconfig(eng, d, false))
          return finish()
        }
        eng.dhcpRequest(d.id, (ok) => {
          if (!ok) {
            out('')
            out('Windows IP Configuration')
            out('')
            out(`An error occurred while renewing interface ${ADAPTER} : unable to contact your DHCP server. Request has timed out.`)
          } else out(ipconfig(eng, d, false))
          done()
        })
        return { stop: () => done() }
      }
      out(ipconfig(eng, d, false))
      return finish()
    }
    case 'ping': {
      let count = 4
      let target = ''
      for (let i = 0; i < args.length; i++) {
        if (args[i].toLowerCase() === '-n' && args[i + 1]) count = Math.max(1, Math.min(100, Number(args[++i]) || 4))
        else if (args[i].toLowerCase() === '-t') count = 1000
        else target = args[i]
      }
      if (!target) {
        out('Usage: ping [-t] [-n count] target_name')
        return finish()
      }
      return ping(eng, d, target, count, out, done)
    }
    case 'tracert':
      if (!args[0]) {
        out('Usage: tracert target_name')
        return finish()
      }
      return tracert(eng, d, args[0], out, done)
    case 'nslookup':
      if (!args[0]) {
        out('Usage: nslookup <name>')
        return finish()
      }
      nslookup(eng, d, args[0], out, done)
      return { stop: () => done() }
    case 'arp':
      if (!args.length) out('Usage: arp -a | arp -d')
      else arp(eng, d, args.map((a) => a.toLowerCase()), out)
      return finish()
    default:
      out(`'${words[0]}' is not recognized as an internal or external command,`)
      out('operable program or batch file.')
      return finish()
  }
}
