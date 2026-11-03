import { useEffect, useRef } from 'react'

// Home page background: a slowly turning "internet globe" in the middle of the
// screen — nodes on a sphere, links to their nearest neighbours and packets
// hopping from link to link. Nodes near the cursor light up. Plain 2D canvas.

const NODES = 420
const LINKS_PER_NODE = 3
const PACKETS = 26
const COLORS = ['#22e1ff', '#3dffa0', '#9b7bff', '#ffb547']

type Vec = [number, number, number]

function buildSphere() {
  // Fibonacci lattice gives an even spread of points over the sphere.
  const pts: Vec[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < NODES; i++) {
    const y = 1 - (i / (NODES - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const a = i * golden
    pts.push([Math.cos(a) * r, y, Math.sin(a) * r])
  }
  const seen = new Set<string>()
  const edges: [number, number][] = []
  const adj: number[][] = pts.map(() => [])
  pts.forEach((p, i) => {
    const near = pts
      .map((q, j) => [j, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2] as const)
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, LINKS_PER_NODE)
    for (const [j] of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push([i, j])
      adj[i].push(j)
      adj[j].push(i)
    }
  })
  return { pts, edges, adj }
}

interface Packet {
  from: number
  to: number
  t: number
  speed: number
  color: string
}

export function GlobeBackground() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { pts, edges, adj } = buildSphere()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let W = 0
    let H = 0
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Cursor position (screen) and a smoothed tilt that follows it.
    let mx = -1e4
    let my = -1e4
    let tiltX = 0
    let tiltY = 0
    const onMove = (e: PointerEvent) => {
      mx = e.clientX
      my = e.clientY
    }
    const onLeave = () => {
      mx = -1e4
      my = -1e4
    }

    const randomPacket = (): Packet => {
      const from = Math.floor(Math.random() * NODES)
      const to = adj[from][Math.floor(Math.random() * adj[from].length)]
      return {
        from,
        to,
        t: Math.random(),
        speed: 0.012 + Math.random() * 0.018,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }
    }
    const packets = Array.from({ length: PACKETS }, randomPacket)

    const proj = new Float32Array(NODES * 3) // screen x, y and depth (-1 back .. 1 front)
    const glow = new Float32Array(NODES) // smoothed cursor highlight per node
    let angle = 0
    let raf = 0

    const frame = () => {
      ctx.clearRect(0, 0, W, H)
      const R = Math.min(W * 0.36, H * 0.42, 460)
      const cx = W / 2
      const cy = H / 2 + 50

      if (!still) angle += 0.0012
      // Lean the globe a little toward the cursor.
      const wantX = mx > -1e3 ? ((my - cy) / H) * 0.5 : 0
      const wantY = mx > -1e3 ? ((mx - cx) / W) * 0.6 : 0
      tiltX += (wantX - tiltX) * 0.04
      tiltY += (wantY - tiltY) * 0.04

      const ay = angle + tiltY
      const ax = 0.35 + tiltX
      const sy = Math.sin(ay), cyy = Math.cos(ay), sx = Math.sin(ax), cxx = Math.cos(ax)
      const persp = 3.2
      for (let i = 0; i < NODES; i++) {
        const [x, y, z] = pts[i]
        const x1 = x * cyy + z * sy
        const z1 = -x * sy + z * cyy
        const y2 = y * cxx - z1 * sx
        const z2 = y * sx + z1 * cxx
        const k = persp / (persp - z2)
        const px = cx + x1 * R * k
        const py = cy + y2 * R * k
        proj[i * 3] = px
        proj[i * 3 + 1] = py
        proj[i * 3 + 2] = z2
        const d = Math.hypot(px - mx, py - my)
        const target = z2 > -0.2 && d < 170 ? (1 - d / 170) ** 1.4 : 0
        glow[i] += (target - glow[i]) * 0.12
      }

      // Links: back ones faint, front ones brighter, lit ones cyan.
      ctx.lineWidth = 1
      for (const [a, b] of edges) {
        const z = (proj[a * 3 + 2] + proj[b * 3 + 2]) / 2
        const g = Math.max(glow[a], glow[b])
        const alpha = 0.03 + (z + 1) * 0.07 + g * 0.5
        ctx.strokeStyle = g > 0.05 ? `rgba(34,225,255,${alpha})` : `rgba(110,140,255,${alpha})`
        ctx.beginPath()
        ctx.moveTo(proj[a * 3], proj[a * 3 + 1])
        ctx.lineTo(proj[b * 3], proj[b * 3 + 1])
        ctx.stroke()
      }

      // Nodes.
      for (let i = 0; i < NODES; i++) {
        const z = (proj[i * 3 + 2] + 1) / 2
        const g = glow[i]
        const r = 0.7 + z * 1.6 + g * 2
        ctx.fillStyle =
          g > 0.05
            ? `rgba(180,245,255,${0.4 + g * 0.6})`
            : `rgba(${130 + z * 70},${170 + z * 60},255,${0.15 + z * 0.6})`
        ctx.beginPath()
        ctx.arc(proj[i * 3], proj[i * 3 + 1], r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Packets hop from node to node like traffic being routed.
      for (const p of packets) {
        if (!still) p.t += p.speed
        if (p.t >= 1) {
          const next = adj[p.to].filter((n) => n !== p.from)
          p.from = p.to
          p.to = next.length ? next[Math.floor(Math.random() * next.length)] : adj[p.to][0]
          p.t = 0
        }
        const z = (proj[p.from * 3 + 2] + proj[p.to * 3 + 2]) / 2
        if (z < -0.15) continue
        const x = proj[p.from * 3] + (proj[p.to * 3] - proj[p.from * 3]) * p.t
        const y = proj[p.from * 3 + 1] + (proj[p.to * 3 + 1] - proj[p.from * 3 + 1]) * p.t
        ctx.shadowColor = p.color
        ctx.shadowBlur = 12
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(x, y, 2.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.shadowBlur = 0

      if (!still) raf = requestAnimationFrame(frame)
    }

    const redraw = () => {
      resize()
      if (still) frame()
    }
    frame()
    window.addEventListener('resize', redraw)
    window.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', redraw)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <canvas ref={ref} className="globe-bg" aria-hidden />
}
