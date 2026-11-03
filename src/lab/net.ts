// IPv4 helpers. Addresses are kept as dotted strings in the model and
// converted to unsigned 32-bit numbers for calculations.

export function ipToInt(s: string | undefined): number | null {
  if (!s) return null
  const parts = s.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function prefixToMask(prefix: number): string {
  return intToIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0)
}

/** Accepts "255.255.255.0", "/24" or "24". Returns the prefix length or null. */
export function maskToPrefix(mask: string | undefined): number | null {
  if (!mask) return null
  const m = mask.trim()
  const short = m.match(/^\/?(\d{1,2})$/)
  if (short) {
    const p = Number(short[1])
    return p >= 0 && p <= 32 ? p : null
  }
  const n = ipToInt(m)
  if (n === null) return null
  // Ones must be contiguous from the left.
  const inv = ~n >>> 0
  if ((inv & (inv + 1)) !== 0) return null
  let p = 0
  for (let b = 31; b >= 0 && (n >>> b) & 1; b--) p++
  return p
}

export function normalizeMask(mask: string | undefined): string | null {
  const p = maskToPrefix(mask)
  return p === null ? null : prefixToMask(p)
}

function maskInt(prefix: number) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

export function networkOf(ip: string, mask: string): number | null {
  const a = ipToInt(ip)
  const p = maskToPrefix(mask)
  if (a === null || p === null) return null
  return (a & maskInt(p)) >>> 0
}

export function broadcastOf(ip: string, mask: string): number | null {
  const a = ipToInt(ip)
  const p = maskToPrefix(mask)
  if (a === null || p === null) return null
  return (a | ~maskInt(p)) >>> 0
}

export function inSubnet(ip: string, netIp: string, mask: string): boolean {
  const a = networkOf(ip, mask)
  const b = networkOf(netIp, mask)
  return a !== null && a === b
}

/** Problems with a host address on a subnet, or null if it is usable. */
export function hostAddressProblem(ip: string, mask: string): 'ip' | 'mask' | 'network' | 'broadcast' | null {
  const a = ipToInt(ip)
  const p = maskToPrefix(mask)
  if (a === null) return 'ip'
  if (p === null || p === 0) return 'mask'
  if (p <= 30) {
    if (a === networkOf(ip, mask)) return 'network'
    if (a === broadcastOf(ip, mask)) return 'broadcast'
  }
  return null
}

export function isBroadcastIp(ip: string) {
  return ip === '255.255.255.255'
}

let macCounter = Math.floor(Math.random() * 0xffffff)
/** A new unique MAC in Cisco notation, e.g. 00e0.f7a1.2b3c. */
export function newMac(): string {
  macCounter = (macCounter + 1) & 0xffffff
  const bytes = [0x00, 0xe0, 0xf7, (macCounter >>> 16) & 255, (macCounter >>> 8) & 255, macCounter & 255]
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`
}

export const BROADCAST_MAC = 'ffff.ffff.ffff'

/** Windows style: 00-E0-F7-A1-2B-3C */
export function macWindows(mac: string) {
  const h = mac.replace(/\./g, '')
  return h.match(/../g)!.join('-').toUpperCase()
}

/** arp -a style: 00-e0-f7-a1-2b-3c */
export function macLower(mac: string) {
  return macWindows(mac).toLowerCase()
}
