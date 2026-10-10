// Experimental Ripple: polygonal waves spreading from a point. Pure functions in font units; no React,
// no DOM, no Math.random.
//
// The mesh is a set of concentric regular polygons (Sides) around a centre placed in the glyph's ink
// box, one ring every half wavelength, measured across the sides, with a flat side at the bottom.
// Rays from the centre through the polygon corners cut the rings into cells, and each cell is split
// into two triangles along a diagonal. Every ring moves outward or inward as a whole, in turn, so it
// stays a regular polygon and each ray carries a zigzag (a triangle wave); points in between move
// linearly with their triangle (see warp.ts). The amplitude can fade with distance from the centre.
// The ring just outside the glyph stays put and everything beyond it is left alone.
//
// Rings never pass each other (each moves less than 40% of the ring spacing, so neighbouring rings
// stay at least 20% of it apart), which keeps every triangle the same way round: the warp is always
// one-to-one, so Ripple never needs to be weakened to keep the letter valid.

import type { Point, PolygonGlyph, RippleParams } from './types'
import type { Warp } from './warp'

export const RIPPLE_LIMITS = {
  /** Wavelengths, as fractions of the em: rings fall half a wavelength apart. */
  minWavelength: 0.08,
  maxWavelength: 1,
  minSides: 3,
  maxSides: 12,
  /** Centre, as a fraction of the glyph's ink box; it may lie outside the letter. */
  minCenter: -0.5,
  maxCenter: 1.5,
  /** Largest ring movement at 100% Amount, as a fraction of the ring spacing (half a wavelength). */
  maxMove: 0.4,
} as const

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function rippleIsOn(params: RippleParams): boolean {
  return params.enabled && params.amount > 0
}

/** The bounding box of every contour, or null for a glyph without outlines. */
export function inkBox(polygon: PolygonGlyph): Box | null {
  let box: Box | null = null
  for (const contour of polygon.contours) {
    for (const p of contour.points) {
      if (!box) box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
      else {
        box.minX = Math.min(box.minX, p.x)
        box.minY = Math.min(box.minY, p.y)
        box.maxX = Math.max(box.maxX, p.x)
        box.maxY = Math.max(box.maxY, p.y)
      }
    }
  }
  return box
}

/** The Ripple warp for a glyph with this ink box, at `scale` × its strength. */
export function rippleWarp(params: RippleParams, box: Box, unitsPerEm: number, scale = 1): Warp {
  const spacing = (clamp(finite(params.wavelength, 0.3), RIPPLE_LIMITS.minWavelength, RIPPLE_LIMITS.maxWavelength) * unitsPerEm) / 2
  const sides = Math.round(clamp(finite(params.sides, 8), RIPPLE_LIMITS.minSides, RIPPLE_LIMITS.maxSides))
  const amplitude = clamp(finite(params.amount, 0), 0, 1) * RIPPLE_LIMITS.maxMove * spacing * scale
  const fade = clamp(finite(params.fade, 0), 0, 1)
  const centre = {
    x: box.minX + (box.maxX - box.minX) * clamp(finite(params.centerX, 0.5), RIPPLE_LIMITS.minCenter, RIPPLE_LIMITS.maxCenter),
    y: box.minY + (box.maxY - box.minY) * clamp(finite(params.centerY, 0.5), RIPPLE_LIMITS.minCenter, RIPPLE_LIMITS.maxCenter),
  }
  // Farthest point of the glyph from the centre; the last ring lies beyond it and stays put.
  const reach = Math.max(
    ...[box.minX, box.maxX].flatMap((x) => [box.minY, box.maxY].map((y) => Math.hypot(x - centre.x, y - centre.y))),
    spacing,
  )
  const half = Math.PI / sides
  const tanHalf = Math.tan(half)
  const last = Math.ceil(reach / spacing) + 1
  // Ray j points at angle first + j × 2·half; wedge j lies between rays j and j + 1. With this first
  // angle, one wedge is centred straight down, so the polygons sit on a flat side.
  const first = -Math.PI / 2 + half

  /** How far ring k moves outward, across its sides (negative: inward). The centre and the last ring stay put. */
  const shift = (k: number) => {
    if (k <= 0 || k >= last) return 0
    const size = amplitude * Math.max(0, 1 - (fade * k * spacing) / reach)
    return k % 2 === 1 ? size : -size
  }
  /** Ring k after moving, as a ring index: k + its shift in ring spacings. */
  const level = (k: number) => k + shift(k) / spacing

  // Wedge coordinates: s is the ring index (ring k's side is the line s = k) and x runs across the
  // wedge (its rays are x = -s and x = s). Both are linear in the point, so the mesh edges are lines.
  const frames = Array.from({ length: sides }, (_, j) => {
    const mid = first + (2 * j + 1) * half
    return { mx: Math.cos(mid), my: Math.sin(mid) }
  })
  const toWedge = (j: number, p: Point) => {
    const { mx, my } = frames[j]
    const dx = p.x - centre.x
    const dy = p.y - centre.y
    return { s: (mx * dx + my * dy) / spacing, x: (mx * dy - my * dx) / (spacing * tanHalf) }
  }
  const fromWedge = (j: number, s: number, x: number): Point => {
    const { mx, my } = frames[j]
    const along = s * spacing
    const across = x * spacing * tanHalf
    return { x: centre.x + mx * along - my * across, y: centre.y + my * along + mx * across }
  }
  const wedgeOf = (p: Point) => {
    const turn = (Math.atan2(p.y - centre.y, p.x - centre.x) - first) / (2 * half)
    return ((Math.floor(turn) % sides) + sides) % sides
  }

  return {
    map(p) {
      if (p.x === centre.x && p.y === centre.y) return p
      const j = wedgeOf(p)
      const { s, x } = toWedge(j, p)
      if (s >= last) return p
      const k = Math.floor(s)
      // The cell's corners: ring k on rays j and j + 1, ring k + 1 on rays j + 1 and j; the diagonal
      // runs from ring k on ray j to ring k + 1 on ray j + 1 (at the centre, ring 0 is a single point).
      const a: Corner = [k, -k, level(k)]
      const b: Corner = [k, k, level(k)]
      const c: Corner = [k + 1, k + 1, level(k + 1)]
      const d: Corner = [k + 1, -(k + 1), level(k + 1)]
      const diagonal = -k + (2 * k + 1) * (s - k)
      const [t1, t2, t3] = k === 0 ? [a, c, d] : x >= diagonal ? [a, b, c] : [a, c, d]
      const w = barycentric(s, x, t1, t2, t3)
      // A corner (ring index r, across position ±r) moves to (level, ±level): the ring scales as a whole.
      const scaled = (t: Corner) => (t[0] === 0 ? 0 : t[2] / t[0])
      const s2 = w[0] * t1[2] + w[1] * t2[2] + w[2] * t3[2]
      const x2 = w[0] * t1[1] * scaled(t1) + w[1] * t2[1] * scaled(t2) + w[2] * t3[1] * scaled(t3)
      return fromWedge(j, s2, x2)
    },

    creases(a, b) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      // Rays first: they split the segment into pieces that each lie in one wedge.
      const ts: number[] = []
      for (let j = 0; j < sides; j++) {
        const angle = first + 2 * j * half
        const ux = Math.cos(angle)
        const uy = Math.sin(angle)
        const denominator = dx * uy - dy * ux
        if (denominator === 0) continue
        const ax = centre.x - a.x
        const ay = centre.y - a.y
        const t = (ax * uy - ay * ux) / denominator
        const along = (ax * dy - ay * dx) / denominator
        if (t > 0 && t < 1 && along > 0) ts.push(t)
      }
      // A segment through the centre crosses every ray there at once: split it at the centre, so that
      // each side lies in one wedge.
      const length2 = dx * dx + dy * dy
      const tc = length2 > 0 ? ((centre.x - a.x) * dx + (centre.y - a.y) * dy) / length2 : -1
      if (tc > 0 && tc < 1 && Math.hypot(a.x + dx * tc - centre.x, a.y + dy * tc - centre.y) <= 1e-9 * Math.sqrt(length2)) ts.push(tc)
      ts.sort((p, q) => p - q)

      const out: number[] = []
      let t0 = 0
      for (let i = 0; i <= ts.length; i++) {
        const t1 = i < ts.length ? ts[i] : 1
        if (t1 > t0) wedgeCreases(t0, t1)
        if (i < ts.length) out.push(t1)
        t0 = t1
      }
      return out

      /** Ring sides and cell diagonals crossed between t0 and t1, which lie in one wedge. */
      function wedgeCreases(from: number, to: number) {
        const mid = (from + to) / 2
        const j = wedgeOf({ x: a.x + dx * mid, y: a.y + dy * mid })
        const pa = toWedge(j, a)
        const pb = toWedge(j, b)
        const ds = pb.s - pa.s
        const dxw = pb.x - pa.x
        const rings: number[] = []
        if (ds !== 0) {
          const lo = Math.min(pa.s + ds * from, pa.s + ds * to)
          const hi = Math.max(pa.s + ds * from, pa.s + ds * to)
          for (let k = Math.max(1, Math.floor(lo) + 1); k < hi && k <= last; k++) {
            const t = (k - pa.s) / ds
            if (t > from && t < to) rings.push(t)
          }
          rings.sort((p, q) => p - q)
        }
        let r0 = from
        for (let i = 0; i <= rings.length; i++) {
          const r1 = i < rings.length ? rings[i] : to
          const k = Math.floor(pa.s + ds * ((r0 + r1) / 2))
          if (k >= 1 && k < last) {
            // Diagonal of cell k: x = -k + (2k + 1)(s - k), solved along the segment.
            const slope = dxw - (2 * k + 1) * ds
            const t = slope === 0 ? NaN : ((2 * k + 1) * (pa.s - k) - k - pa.x) / slope
            if (t > r0 && t < r1) out.push(t)
          }
          if (i < rings.length) out.push(r1)
          r0 = r1
        }
      }
    },
  }
}

/** A mesh corner in wedge coordinates: ring index s, across position x, and its ring's level after moving. */
type Corner = [number, number, number]

/** Barycentric weights of (s, x) in the triangle t1, t2, t3. */
function barycentric(s: number, x: number, t1: Corner, t2: Corner, t3: Corner): [number, number, number] {
  const area = (t2[0] - t1[0]) * (t3[1] - t1[1]) - (t3[0] - t1[0]) * (t2[1] - t1[1])
  const w2 = ((s - t1[0]) * (t3[1] - t1[1]) - (t3[0] - t1[0]) * (x - t1[1])) / area
  const w3 = ((t2[0] - t1[0]) * (x - t1[1]) - (s - t1[0]) * (t2[1] - t1[1])) / area
  return [1 - w2 - w3, w2, w3]
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}
