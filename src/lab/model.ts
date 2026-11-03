// Topology model: devices with ports, links between ports, device settings.
import { newMac } from './net.ts'

export type DeviceKind = 'pc' | 'laptop' | 'server' | 'switch' | 'router'

export interface Port {
  id: string
  name: string
  mac: string
  /** Administrative state ("no shutdown"). Router ports start down, like real routers. */
  up: boolean
  ip?: string
  mask?: string
  linkId?: string
}

export interface StaticRoute {
  network: string
  mask: string
  nextHop: string
}

export interface DnsRecord {
  name: string
  ip: string
}

export interface DhcpPool {
  enabled: boolean
  start: string
  count: number
  mask: string
  gateway: string
  dns: string
}

export interface Device {
  id: string
  kind: DeviceKind
  name: string
  x: number
  y: number
  ports: Port[]
  // hosts (pc, laptop, server)
  gateway?: string
  dns?: string
  dhcp?: boolean
  /** Server that gave the current DHCP lease (shown by ipconfig /all). */
  dhcpServer?: string
  // router
  routes?: StaticRoute[]
  // server services
  dnsEnabled?: boolean
  dnsRecords?: DnsRecord[]
  dhcpPool?: DhcpPool
}

export interface LinkEnd {
  device: string
  port: string
}

export interface Link {
  id: string
  a: LinkEnd
  b: LinkEnd
}

export interface Topology {
  devices: Device[]
  links: Link[]
}

export const isHost = (k: DeviceKind) => k === 'pc' || k === 'laptop' || k === 'server'

let idCounter = 0
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`

const NAME_PREFIX: Record<DeviceKind, string> = { pc: 'PC', laptop: 'Laptop', server: 'Server', switch: 'Switch', router: 'Router' }

export function nextName(topo: Topology, kind: DeviceKind) {
  const used = new Set(topo.devices.map((d) => d.name))
  for (let i = 0; ; i++) {
    const n = `${NAME_PREFIX[kind]}${i}`
    if (!used.has(n)) return n
  }
}

export function makeDevice(kind: DeviceKind, name: string, x: number, y: number): Device {
  const port = (id: string, name: string, up = true): Port => ({ id, name, mac: newMac(), up })
  switch (kind) {
    case 'pc':
    case 'laptop':
    case 'server':
      return {
        id: newId('d'), kind, name, x, y,
        ports: [port('fa0', 'FastEthernet0')],
        gateway: '', dns: '', dhcp: false,
        ...(kind === 'server'
          ? {
              dnsEnabled: false,
              dnsRecords: [],
              dhcpPool: { enabled: false, start: '', count: 50, mask: '255.255.255.0', gateway: '', dns: '' },
            }
          : {}),
      }
    case 'switch':
      return {
        id: newId('d'), kind, name, x, y,
        ports: Array.from({ length: 12 }, (_, i) => port(`fa0/${i + 1}`, `FastEthernet0/${i + 1}`)),
      }
    case 'router':
      return {
        id: newId('d'), kind, name, x, y,
        ports: [0, 1, 2].map((i) => port(`g0/${i}`, `GigabitEthernet0/${i}`, false)),
        routes: [],
      }
  }
}

export const shortPort = (name: string) =>
  name.replace('GigabitEthernet', 'Gig').replace('FastEthernet', 'Fa')

/** Build a topology from a compact description (used by the examples). */
function build(
  devices: { kind: DeviceKind; name: string; x: number; y: number; cfg?: (d: Device) => void }[],
  links: [string, string, string, string][],
) {
  const topo: Topology = { devices: [], links: [] }
  for (const s of devices) {
    const d = makeDevice(s.kind, s.name, s.x, s.y)
    s.cfg?.(d)
    topo.devices.push(d)
  }
  const byName = (n: string) => topo.devices.find((d) => d.name === n)!
  for (const [da, pa, db, pb] of links) {
    const A = byName(da)
    const B = byName(db)
    const id = newId('l')
    A.ports.find((p) => p.id === pa)!.linkId = id
    B.ports.find((p) => p.id === pb)!.linkId = id
    topo.links.push({ id, a: { device: A.id, port: pa }, b: { device: B.id, port: pb } })
  }
  return topo
}

const host = (ip: string, mask: string, gw = '', dns = '') => (d: Device) => {
  d.ports[0].ip = ip
  d.ports[0].mask = mask
  d.gateway = gw
  d.dns = dns
}

const routerPorts = (...cfg: [string, string][]) => (d: Device) => {
  cfg.forEach(([ip, mask], i) => {
    if (!ip) return
    d.ports[i].ip = ip
    d.ports[i].mask = mask
    d.ports[i].up = true
  })
}

export type ExampleId = 'empty' | 'lan' | 'router' | 'dhcp' | 'tworouters'

export const EXAMPLES: ExampleId[] = ['lan', 'router', 'tworouters', 'dhcp', 'empty']

export function example(id: ExampleId): Topology {
  const M24 = '255.255.255.0'
  switch (id) {
    case 'empty':
      return { devices: [], links: [] }
    case 'lan':
      return build(
        [
          { kind: 'switch', name: 'Switch0', x: 520, y: 220 },
          { kind: 'pc', name: 'PC0', x: 260, y: 420, cfg: host('192.168.1.10', M24, '192.168.1.1') },
          { kind: 'pc', name: 'PC1', x: 520, y: 470, cfg: host('192.168.1.11', M24, '192.168.1.1') },
          { kind: 'laptop', name: 'Laptop0', x: 780, y: 420, cfg: host('192.168.1.12', M24, '192.168.1.1') },
        ],
        [
          ['PC0', 'fa0', 'Switch0', 'fa0/1'],
          ['PC1', 'fa0', 'Switch0', 'fa0/2'],
          ['Laptop0', 'fa0', 'Switch0', 'fa0/3'],
        ],
      )
    case 'router':
      return build(
        [
          { kind: 'router', name: 'Router0', x: 560, y: 160, cfg: routerPorts(['192.168.1.1', M24], ['192.168.2.1', M24]) },
          { kind: 'switch', name: 'Switch0', x: 300, y: 320 },
          { kind: 'switch', name: 'Switch1', x: 820, y: 320 },
          { kind: 'pc', name: 'PC0', x: 180, y: 500, cfg: host('192.168.1.10', M24, '192.168.1.1') },
          { kind: 'pc', name: 'PC1', x: 420, y: 500, cfg: host('192.168.1.11', M24, '192.168.1.1') },
          { kind: 'pc', name: 'PC2', x: 700, y: 500, cfg: host('192.168.2.10', M24, '192.168.2.1') },
          { kind: 'laptop', name: 'Laptop0', x: 940, y: 500, cfg: host('192.168.2.11', M24, '192.168.2.1') },
        ],
        [
          ['Router0', 'g0/0', 'Switch0', 'fa0/1'],
          ['Router0', 'g0/1', 'Switch1', 'fa0/1'],
          ['PC0', 'fa0', 'Switch0', 'fa0/2'],
          ['PC1', 'fa0', 'Switch0', 'fa0/3'],
          ['PC2', 'fa0', 'Switch1', 'fa0/2'],
          ['Laptop0', 'fa0', 'Switch1', 'fa0/3'],
        ],
      )
    case 'tworouters':
      return build(
        [
          {
            kind: 'router', name: 'Router0', x: 380, y: 160,
            cfg: (d) => {
              routerPorts(['192.168.1.1', M24], ['10.0.0.1', '255.255.255.252'])(d)
              d.routes = [{ network: '192.168.2.0', mask: M24, nextHop: '10.0.0.2' }]
            },
          },
          {
            kind: 'router', name: 'Router1', x: 760, y: 160,
            cfg: (d) => {
              routerPorts(['192.168.2.1', M24], ['10.0.0.2', '255.255.255.252'])(d)
              d.routes = [{ network: '192.168.1.0', mask: M24, nextHop: '10.0.0.1' }]
            },
          },
          { kind: 'pc', name: 'PC0', x: 260, y: 420, cfg: host('192.168.1.10', M24, '192.168.1.1') },
          { kind: 'pc', name: 'PC1', x: 880, y: 420, cfg: host('192.168.2.10', M24, '192.168.2.1') },
        ],
        [
          ['Router0', 'g0/1', 'Router1', 'g0/1'],
          ['PC0', 'fa0', 'Router0', 'g0/0'],
          ['PC1', 'fa0', 'Router1', 'g0/0'],
        ],
      )
    case 'dhcp':
      return build(
        [
          { kind: 'switch', name: 'Switch0', x: 540, y: 260 },
          {
            kind: 'server', name: 'Server0', x: 540, y: 80,
            cfg: (d) => {
              host('192.168.1.2', M24, '192.168.1.1', '192.168.1.2')(d)
              d.dhcpPool = { enabled: true, start: '192.168.1.100', count: 50, mask: M24, gateway: '192.168.1.1', dns: '192.168.1.2' }
              d.dnsEnabled = true
              d.dnsRecords = [
                { name: 'server.local', ip: '192.168.1.2' },
                { name: 'router.local', ip: '192.168.1.1' },
              ]
            },
          },
          { kind: 'router', name: 'Router0', x: 860, y: 120, cfg: routerPorts(['192.168.1.1', M24]) },
          { kind: 'pc', name: 'PC0', x: 280, y: 460, cfg: (d) => (d.dhcp = true) },
          { kind: 'pc', name: 'PC1', x: 540, y: 500, cfg: (d) => (d.dhcp = true) },
          { kind: 'laptop', name: 'Laptop0', x: 800, y: 460, cfg: (d) => (d.dhcp = true) },
        ],
        [
          ['Server0', 'fa0', 'Switch0', 'fa0/1'],
          ['Router0', 'g0/0', 'Switch0', 'fa0/2'],
          ['PC0', 'fa0', 'Switch0', 'fa0/3'],
          ['PC1', 'fa0', 'Switch0', 'fa0/4'],
          ['Laptop0', 'fa0', 'Switch0', 'fa0/5'],
        ],
      )
  }
}
