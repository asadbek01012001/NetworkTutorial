import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** Top-left corner of the view in world units, and pixels per world unit. */
export interface Cam {
  x: number
  y: number
  z: number
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3
const clampZ = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/**
 * Zoom and pan for the lab canvas. The SVG viewBox always has the same aspect
 * as its box (no letterboxing), so world → screen is simply (p - cam) * z.
 * Mouse wheel zooms around the cursor; the view fits the network on first show.
 */
export function useCamera(wrapRef: RefObject<HTMLDivElement | null>, bounds: () => Box | null) {
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, z: 1 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const sizeRef = useRef(size)
  const boundsRef = useRef(bounds)
  const fitted = useRef(false)
  useEffect(() => {
    boundsRef.current = bounds
  })

  const fitTo = useCallback((w: number, h: number) => {
    const b = boundsRef.current()
    if (!w || !h) return
    if (!b) {
      setCam({ x: 0, y: 0, z: 1 })
      return
    }
    const pad = 90
    const bw = b.maxX - b.minX + pad * 2
    const bh = b.maxY - b.minY + pad * 2
    const z = clampZ(Math.min(w / bw, h / bh, 1.25))
    setCam({ x: (b.minX + b.maxX) / 2 - w / 2 / z, y: (b.minY + b.maxY) / 2 - h / 2 / z, z })
  }, [])

  const fit = useCallback(() => fitTo(sizeRef.current.w, sizeRef.current.h), [fitTo])

  // Track the box size; keep the view centre when it changes.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      const h = entry.contentRect.height
      const old = sizeRef.current
      sizeRef.current = { w, h }
      setSize({ w, h })
      if (!fitted.current && w > 0 && h > 0) {
        fitted.current = true
        fitTo(w, h)
      } else if (old.w && old.h) {
        setCam((c) => ({ ...c, x: c.x + (old.w - w) / 2 / c.z, y: c.y + (old.h - h) / 2 / c.z }))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [wrapRef, fitTo])

  /** Zoom by a factor keeping the screen point (sx, sy) — relative to the box — fixed. */
  const zoomAt = useCallback((factor: number, sx?: number, sy?: number) => {
    const px = sx ?? sizeRef.current.w / 2
    const py = sy ?? sizeRef.current.h / 2
    setCam((c) => {
      const z = clampZ(c.z * factor)
      const wx = c.x + px / c.z
      const wy = c.y + py / c.z
      return { x: wx - px / z, y: wy - py / z, z }
    })
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const h = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const k = e.ctrlKey ? 0.01 : 0.0015
      zoomAt(Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [wrapRef, zoomAt])

  const viewBox = `${cam.x} ${cam.y} ${Math.max(1, size.w) / cam.z} ${Math.max(1, size.h) / cam.z}`
  return { cam, setCam, size, viewBox, zoomAt, fit }
}
