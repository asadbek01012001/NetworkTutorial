import type { LogEntry, Proto } from './engine.ts'

export const PROTOS: Proto[] = ['arp', 'icmp', 'dhcp', 'dns']
export const PROTO_CLASS: Record<Proto, string> = { arp: 'p-arp', icmp: 'p-icmp', dhcp: 'p-dhcp', dns: 'p-dns' }
export const PROTO_LABEL: Record<Proto, string> = { arp: 'ARP', icmp: 'ICMP', dhcp: 'DHCP', dns: 'DNS' }

/** One-line description of a frame for the event list. */
export function summary(r: LogEntry): string {
  const f = r.frame
  if (f.arp) return f.arp.op === 'request' ? `Who has ${f.arp.targetIp}? Tell ${f.arp.senderIp}` : `${f.arp.senderIp} is at ${f.arp.senderMac}`
  const ip = f.ip!
  if (ip.icmp) return `${ip.src} → ${ip.dst}  ${ip.icmp.type}  TTL=${ip.ttl}`
  if (ip.udp?.dhcp) return `DHCP ${ip.udp.dhcp.msg}${ip.udp.dhcp.yiaddr ? ' ' + ip.udp.dhcp.yiaddr : ''}`
  if (ip.udp?.dns) return `DNS ${ip.udp.dns.qr} ${ip.udp.dns.name}${ip.udp.dns.ip ? ' = ' + ip.udp.dns.ip : ''}`
  return ''
}

/** A simple PDU: one ICMP echo from a device to another, as in the PDU list. */
export interface Pdu {
  num: number
  src: string
  dst: string
  srcName: string
  dstName: string
  dstIp?: string
  status: 'pending' | 'ok' | 'fail'
  reason?: string
}

export type HistEntry =
  | { at: number; kind: 'add' | 'remove' | 'config'; dev: string }
  | { at: number; kind: 'connect' | 'disconnect'; a: string; b: string }
  | { at: number; kind: 'cmd'; dev: string; cmd: string }
  | { at: number; kind: 'pdu'; a: string; b: string; ok: boolean }
  | { at: number; kind: 'example'; name: string }
