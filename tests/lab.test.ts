// Scenario tests for the network lab simulator. Run: node tests/lab.test.ts
import { Engine } from '../src/lab/engine.ts'
import { example, type Topology } from '../src/lab/model.ts'
import { runHost } from '../src/lab/hostCli.ts'
import { newSession, runIos } from '../src/lab/iosCli.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '\n      ' + detail.replace(/\n/g, '\n      ')}`)
}

function run(eng: Engine, devName: string, line: string, limit = 2000): string {
  const d = eng.devByName(devName)!
  const lines: string[] = ['']
  let finished = false
  const out = (t: string, inline?: boolean) => {
    if (inline) lines[lines.length - 1] += t
    else for (const l of t.split('\n')) lines.push(l)
  }
  runHost(eng, d.id, line, out, () => (finished = true))
  for (let t = eng.now; !finished && t < eng.now + limit; ) {
    t += 0.5
    eng.advance(t)
  }
  return lines.join('\n')
}
function ios(eng: Engine, devName: string, cmds: string[], limit = 2000): string {
  const d = eng.devByName(devName)!
  const s = newSession()
  const lines: string[] = ['']
  const out = (t: string, inline?: boolean) => {
    if (inline) lines[lines.length - 1] += t
    else for (const l of t.split('\n')) lines.push(l)
  }
  for (const c of cmds) {
    let finished = false
    runIos(eng, d.id, s, c, out, () => (finished = true))
    for (let t = eng.now; !finished && t < eng.now + limit; ) {
      t += 0.5
      eng.advance(t)
    }
  }
  return lines.join('\n')
}
const settle = (eng: Engine, units = 100) => {
  for (let i = 0; i < units * 2; i++) eng.advance(eng.now + 0.5)
}
const fresh = (t: Topology) => {
  const e = new Engine(t)
  e.reset()
  settle(e)
  return e
}
const count = (s: string, needle: string) => s.split(needle).length - 1

// 1. One LAN
{
  const e = fresh(example('lan'))
  const o = run(e, 'PC0', 'ping 192.168.1.11')
  check('LAN ping: 4 replies TTL=128', count(o, 'Reply from 192.168.1.11: bytes=32 time<1ms TTL=128') === 4, o)
  check('LAN ping stats', o.includes('Sent = 4, Received = 4, Lost = 0 (0% loss)'), o)
  const a = run(e, 'PC0', 'arp -a')
  check('ARP learned', a.includes('192.168.1.11') && a.includes('dynamic'), a)
  const m = ios(e, 'Switch0', ['enable', 'show mac address-table'])
  check('Switch learned MACs', count(m, 'DYNAMIC') >= 2, m)
  const u = run(e, 'PC0', 'ping 192.168.1.99')
  check('Missing host: Destination host unreachable from self', count(u, 'Reply from 192.168.1.10: Destination host unreachable.') === 4, u)
  check('Windows counts unreachable as received', u.includes('Received = 4, Lost = 0'), u)
  const self = run(e, 'PC0', 'ping 192.168.1.10')
  check('Ping own address', count(self, 'Reply from 192.168.1.10') === 4, self)
}

// 2. Router between two networks
{
  const e = fresh(example('router'))
  const o = run(e, 'PC0', 'ping 192.168.2.10')
  check('Routed ping: TTL=127', count(o, 'Reply from 192.168.2.10: bytes=32 time<1ms TTL=127') === 4, o)
  const t = run(e, 'PC0', 'tracert 192.168.2.10')
  check('tracert: 2 hops via gateway', /1\s+<1 ms.*192\.168\.1\.1/.test(t) && /2\s+<1 ms.*192\.168\.2\.10/.test(t) && t.includes('Trace complete.'), t)
  const r = run(e, 'PC0', 'ping 192.168.2.1')
  check('Ping far router interface', count(r, 'Reply from 192.168.2.1: bytes=32 time<1ms TTL=255') === 4, r)
  const to = run(e, 'PC0', 'ping 192.168.2.99')
  check('Missing remote host: timeouts', count(to, 'Request timed out.') === 4 && to.includes('Lost = 4 (100% loss)'), to)
  e.update(e.devByName('PC1')!.id, (d) => (d.gateway = ''))
  const g = run(e, 'PC1', 'ping 192.168.2.10')
  check('No gateway: General failure', count(g, 'PING: transmit failed. General failure.') === 4, g)
  const g2 = run(e, 'PC1', 'ping 192.168.1.11')
  check('No gateway but same subnet still works', count(g2, 'Reply from 192.168.1.11') === 4, g2)
  // Wrong mask on PC2 puts the gateway outside its subnet.
  e.update(e.devByName('PC2')!.id, (d) => (d.ports[0].mask = '255.255.255.252'))
  const w = run(e, 'PC2', 'ping 192.168.1.10')
  check('Gateway outside subnet: General failure', w.includes('General failure'), w)
  // Shut the router port.
  ios(e, 'Router0', ['enable', 'conf t', 'int g0/0', 'shutdown', 'end'])
  const s = run(e, 'PC0', 'ping 192.168.1.1')
  // The PC still has the gateway in its ARP cache, so (like real Windows) it times out.
  check('Router port shut: gateway no longer answers', count(s, 'Request timed out.') === 4, s)
  run(e, 'PC0', 'arp -d')
  const s2 = run(e, 'PC0', 'ping 192.168.1.1')
  check('After arp -d: Destination host unreachable', count(s2, 'Reply from 192.168.1.10: Destination host unreachable.') === 4, s2)
}

// 3. Two routers with static routes
{
  const e = fresh(example('tworouters'))
  const o = run(e, 'PC0', 'ping 192.168.2.10')
  check('Two routers: TTL=126', count(o, 'Reply from 192.168.2.10: bytes=32 time<1ms TTL=126') === 4, o)
  const t = run(e, 'PC0', 'tracert 192.168.2.10')
  check('tracert: 3 hops', /1\s+<1 ms.*192\.168\.1\.1/.test(t) && /2\s+<1 ms.*10\.0\.0\.2/.test(t) && /3\s+<1 ms.*192\.168\.2\.10/.test(t), t)
  const rt = ios(e, 'Router0', ['enable', 'show ip route'])
  check('show ip route has C, L and S', rt.includes('C       192.168.1.0/24') && rt.includes('L       192.168.1.1/32') && rt.includes('S       192.168.2.0/24 [1/0] via 10.0.0.2'), rt)
  ios(e, 'Router0', ['enable', 'conf t', 'no ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end'])
  const u = run(e, 'PC0', 'ping 192.168.2.10')
  check('No route on first router: unreachable from gateway', count(u, 'Reply from 192.168.1.1: Destination host unreachable.') === 4, u)
  ios(e, 'Router0', ['enable', 'conf t', 'ip route 0.0.0.0 0.0.0.0 10.0.0.2', 'end'])
  const dr = run(e, 'PC0', 'ping 192.168.2.10')
  check('Default route works', count(dr, 'TTL=126') === 4, dr)
  const gl = ios(e, 'Router0', ['enable', 'show ip route'])
  check('Gateway of last resort shown', gl.includes('Gateway of last resort is 10.0.0.2 to network 0.0.0.0') && gl.includes('S*'), gl)
  ios(e, 'Router1', ['enable', 'conf t', 'no ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end'])
  const back = run(e, 'PC0', 'ping 192.168.2.10')
  check('No return route: request timed out', count(back, 'Request timed out.') === 4, back)
  const rp = ios(e, 'Router0', ['enable', 'ping 10.0.0.2'])
  check('Router ping: !!!!!', rp.includes('!!!!!') && rp.includes('Success rate is 100 percent (5/5)'), rp)
}

// 4. DHCP and DNS
{
  const e = fresh(example('dhcp'))
  const ip = run(e, 'PC0', 'ipconfig /all')
  check('DHCP lease received', /IPv4 Address[. ]*: 192\.168\.1\.1\d\d\(Preferred\)/.test(ip) && ip.includes('Default Gateway . . . . . . . . . : 192.168.1.1') && ip.includes('DHCP Server . . . . . . . . . . . : 192.168.1.2'), ip)
  const ips = ['PC0', 'PC1', 'Laptop0'].map((n) => e.devByName(n)!.ports[0].ip)
  check('Unique DHCP addresses', new Set(ips).size === 3 && ips.every(Boolean), String(ips))
  const ns = run(e, 'PC0', 'nslookup server.local')
  check('nslookup', ns.includes('Name:    server.local') && ns.includes('Address:  192.168.1.2'), ns)
  const nx = run(e, 'PC0', 'nslookup nothing.local')
  check('nslookup NXDOMAIN', nx.includes("can't find nothing.local: Non-existent domain"), nx)
  const pn = run(e, 'PC1', 'ping router.local')
  check('ping by name', pn.includes('Pinging router.local [192.168.1.1]') && count(pn, 'Reply from 192.168.1.1') === 4, pn)
  e.update(e.devByName('Server0')!.id, (d) => (d.dhcpPool!.enabled = false))
  const rn = run(e, 'Laptop0', 'ipconfig /renew')
  check('No DHCP server: renew fails, APIPA', rn.includes('unable to contact your DHCP server') && /169\.254\./.test(e.devByName('Laptop0')!.ports[0].ip ?? ''), rn)
}

// 5. Switching loop is broken by spanning tree
{
  const t = example('lan')
  const e = new Engine(t)
  const sw1 = e.addDevice('switch', 800, 200)
  const sw0 = e.devByName('Switch0')!
  e.connect({ device: sw0.id, port: 'fa0/10' }, { device: sw1.id, port: 'fa0/1' })
  e.connect({ device: sw0.id, port: 'fa0/11' }, { device: sw1.id, port: 'fa0/2' })
  check('STP blocks one redundant port', e.blocked.size === 1, [...e.blocked].join(','))
  const o = run(e, 'PC0', 'ping 192.168.1.12')
  check('Ping works with a loop', count(o, 'Reply from 192.168.1.12') === 4, o)
  settle(e, 50)
  check('No broadcast storm (network goes quiet)', !e.busy)
}

// 6. Cable unplugged
{
  const e = fresh(example('lan'))
  const pc = e.devByName('PC1')!
  e.disconnect(pc.ports[0].linkId!)
  const ip = run(e, 'PC1', 'ipconfig')
  check('ipconfig: Media disconnected', ip.includes('Media disconnected'), ip)
  const p = run(e, 'PC1', 'ping 192.168.1.10')
  check('Unplugged ping: General failure', count(p, 'General failure') === 4, p)
}

// 7. IOS interface configuration
{
  const e = fresh(example('empty'))
  const r = e.addDevice('router', 100, 100)
  const pc = e.addDevice('pc', 300, 100)
  e.connect({ device: r.id, port: 'g0/0' }, { device: pc.id, port: 'fa0' })
  e.update(pc.id, (d) => {
    d.ports[0].ip = '10.1.1.10'
    d.ports[0].mask = '/24'
    d.gateway = '10.1.1.1'
  })
  check('Mask "/24" normalised', pc.ports[0].mask === '255.255.255.0', String(pc.ports[0].mask))
  const before = run(e, pc.name, 'ping 10.1.1.1')
  // Router ports start shut down, so the directly cabled PC has no link.
  check('Router port down by default (no link on PC)', count(before, 'General failure') === 4 && run(e, pc.name, 'ipconfig').includes('Media disconnected'), before)
  const o = ios(e, r.name, ['enable', 'configure terminal', 'interface gigabitEthernet0/0', 'ip address 10.1.1.1 255.255.255.0', 'no shutdown', 'end', 'show ip interface brief'])
  check('no shutdown messages', o.includes('changed state to up'), o)
  check('show ip int brief', /GigabitEthernet0\/0\s+10\.1\.1\.1\s+YES manual up\s+up/.test(o), o)
  const after = run(e, pc.name, 'ping 10.1.1.1')
  check('Ping router after configuration', count(after, 'Reply from 10.1.1.1: bytes=32 time<1ms TTL=255') === 4, after)
  const bad = ios(e, r.name, ['enable', 'conf t', 'int g0/1', 'ip address 10.1.1.5 255.255.255.0'])
  check('Overlapping subnet rejected', bad.includes('overlaps with GigabitEthernet0/0'), bad)
  const bad2 = ios(e, r.name, ['enable', 'conf t', 'int g0/1', 'ip address 10.2.2.0 255.255.255.0'])
  check('Network address rejected', bad2.includes('Bad mask'), bad2)
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
