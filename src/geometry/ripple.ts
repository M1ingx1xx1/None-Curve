// Experimental Ripple: polygonal waves spreading from a point. Pure functions in font units; no React,
// no DOM, no Math.random.
//
// The mesh is a set of concentric regular polygons (Sides) around a centre placed in the glyph's ink
// box, one ring every half wavelength, measured across the sides, with a flat side at the bottom.
// Rays from the centre through the polygon corners cut the rings into cells, and each cell is split
// into two triangles along a diagonal. Every ring moves outward or inward as a whole, in turn, so it
// stays a regular polygon and each ray carries a zigzag (a triangle wave); points in between move
// linearly with their triangle (see warp.ts). The amplitude can fade with distance from the centre.
// The ring just outside the glyph stays put.
//
// Petals bend every ring into a flower with one petal per side: each side is cut by three more rays,
// and every ray scales the rings along it by its own factor: out by the full depth at the corners
// (the petal tips), by 70% of it at the shoulders, and in at the middle of the sides (the notches
// between petals), where the rings keep at least 10% of their distance. Corners only ever move along
// their own ray and stay on the same side of the centre, so the rays keep their order and the rings
// their order along each ray: Petals is one-to-one at any depth. Beyond the last ring the same scaling
// goes on, linear in each slice, so the plane stays continuous.
//
// Reverse swaps out and in: the rings that moved out move in and the other way round, and the petal profile is
// negated, so the corners and shoulders are pulled in (the corners keep at least 10% of their distance, the shoulders
// 37%) and the middle of each side is pushed out by the full depth: the petal tips sit mid-side. Every factor stays
// positive, so reversed Petals is one-to-one too, and the ring movements are as large as before.
//
// Up to 100% Amount, rings never pass each other (each moves less than 45% of the ring spacing, so
// neighbouring rings stay at least 10% of it apart), which keeps every triangle the same way round:
// the warp is one-to-one, so Ripple never needs to be weakened to keep the letter valid. Above 100%
// rings overtake their neighbours (the innermost can pass through the centre and turn inside out),
// folding the letter onto itself; the overlaps are then merged into one outline (see overlaps.ts).

import type { Point, PolygonGlyph, RippleParams } from './types'
import type { Warp } from './warp'

export const RIPPLE_LIMITS = {
  /** Wavelengths, as fractions of the em: rings fall half a wavelength apart. */
  minWavelength: 0.08,
  maxWavelength: 2,
  minSides: 3,
  maxSides: 12,
  /** Centre, as a fraction of the glyph's ink box; it may lie outside the letter. */
  minCenter: -0.5,
  maxCenter: 1.5,
  /** Above 1 (the safe range), rings pass each other and fold. */
  maxAmount: 4,
  /**
   * Largest ring movement at 100% Amount, as a fraction of the ring spacing (half a wavelength). Rings
   * stay apart below 0.5; at 0.45 neighbouring rings come within 10% of the spacing of each other.
   * Closer still, strokes between them get thinner than a font unit and no longer survive rounding
   * for font export.
   */
  maxMove: 0.45,
  /**
   * Petal depth at 100%: the tips reach out 90% further, the notches keep 10% of their distance. Above
   * 100% the tips keep growing while the notches stay at 10%.
   */
  maxPetal: 0.9,
  maxPetals: 3,
} as const

/**
 * When petals are on, the rays along each side from one corner to the next: the tip, a shoulder, the
 * notch, a shoulder. How far out each moves, as a share of the depth (the notch moves in).
 */
const PETAL_PROFILE = [1, 0.7, -1, 0.7] as const

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function rippleIsOn(params: RippleParams): boolean {
  return params.enabled && (params.amount > 0 || petalsOf(params) > 0)
}

/** True when Ripple goes beyond its safe range, so the letter folds onto itself (Petals never folds). */
export function rippleFolds(params: RippleParams): boolean {
  return rippleIsOn(params) && params.amount > 1
}

/** The Petals setting (0 when missing, as in settings saved before it existed). */
function petalsOf(params: RippleParams): number {
  return clamp(finite(params.petals, 0), 0, RIPPLE_LIMITS.maxPetals)
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
  const amplitude = clamp(finite(params.amount, 0), 0, RIPPLE_LIMITS.maxAmount) * RIPPLE_LIMITS.maxMove * spacing * scale
  const fade = clamp(finite(params.fade, 0), 0, 1)
  // Older saved settings have no Reverse; off runs exactly the expressions it always did.
  const reverse = params.reverse === true
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
  const depth = petalsOf(params) * RIPPLE_LIMITS.maxPetal * scale
  // Without petals each wedge is one slice; with them, one slice per step of the profile, cut by rays
  // through points evenly spaced along the side. Slice i lies between x = slope[i] × s and slope[i + 1] × s.
  const slices = depth > 0 ? PETAL_PROFILE.length : 1
  const slope = Array.from({ length: slices + 1 }, (_, i) => -1 + (2 * i) / slices)
  // Reversed, the profile is negated: in at the corners and shoulders, out at the middle of each side.
  const profile = reverse ? PETAL_PROFILE.map((v) => -v) : PETAL_PROFILE
  /** How far the rings along the ray at slope[i] are scaled: out at tips and shoulders, in at the notch. */
  const petal = slope.map((_, i) => {
    const share = profile[i % profile.length]
    return 1 + share * (share > 0 ? depth : Math.min(depth, RIPPLE_LIMITS.maxPetal))
  })

  /** How far ring k moves outward, across its sides (negative: inward). The centre and the last ring stay put. */
  const shift = (k: number) => {
    if (k <= 0 || k >= last) return 0
    const size = amplitude * Math.max(0, 1 - (fade * k * spacing) / reach)
    // Odd rings move out and even rings in; reversed, the other way round.
    return (k % 2 === 1) !== reverse ? size : -size
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
  /** The slice of its wedge that (s, x) lies in. */
  const sliceOf = (s: number, x: number) => (s > 0 ? Math.min(slices - 1, Math.max(0, Math.floor(((x / s + 1) * slices) / 2))) : 0)
  /** A mesh corner: ring r on the ray at slope[i], and where it goes (ring and ray scaling applied). */
  const corner = (r: number, i: number): Corner => {
    const to = level(r) * petal[i]
    return [r, slope[i] * r, to, slope[i] * to]
  }

  return {
    map(p) {
      if (p.x === centre.x && p.y === centre.y) return p
      const j = wedgeOf(p)
      const { s, x } = toWedge(j, p)
      const i = sliceOf(s, x)
      if (s >= last) {
        // Beyond the rings: only the rays' scaling, linear in the slice.
        if (depth === 0) return p
        const across = (x - slope[i] * s) / (slope[i + 1] - slope[i])
        const along = s - across
        return fromWedge(j, along * petal[i] + across * petal[i + 1], along * petal[i] * slope[i] + across * petal[i + 1] * slope[i + 1])
      }
      const k = Math.floor(s)
      // The cell's corners: ring k on the slice's two rays, ring k + 1 on them; the diagonal runs from
      // ring k on the first ray to ring k + 1 on the second (at the centre, ring 0 is a single point).
      const a = corner(k, i)
      const b = corner(k, i + 1)
      const c = corner(k + 1, i + 1)
      const d = corner(k + 1, i)
      const [t1, t2, t3] = k === 0 ? [a, c, d] : x >= diagonal(k, i, s) ? [a, b, c] : [a, c, d]
      const w = barycentric(s, x, t1, t2, t3)
      return fromWedge(j, w[0] * t1[2] + w[1] * t2[2] + w[2] * t3[2], w[0] * t1[3] + w[1] * t2[3] + w[2] * t3[3])
    },

    creases(a, b) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      // Rays first: they split the segment into pieces that each lie in one slice.
      const ts: number[] = []
      for (let j = 0; j < sides; j++) {
        const { mx, my } = frames[j]
        for (let i = 0; i < slices; i++) {
          // The ray at slope[i] in wedge j: along the wedge's middle, turned across by slope × tan(half).
          const across = slope[i] * tanHalf
          const ux = mx - my * across
          const uy = my + mx * across
          const denominator = dx * uy - dy * ux
          if (denominator === 0) continue
          const ax = centre.x - a.x
          const ay = centre.y - a.y
          const t = (ax * uy - ay * ux) / denominator
          const along = (ax * dy - ay * dx) / denominator
          if (t > 0 && t < 1 && along > 0) ts.push(t)
        }
      }
      // A segment through the centre crosses every ray there at once: split it at the centre, so that
      // each side lies in one slice.
      const length2 = dx * dx + dy * dy
      const tc = length2 > 0 ? ((centre.x - a.x) * dx + (centre.y - a.y) * dy) / length2 : -1
      if (tc > 0 && tc < 1 && Math.hypot(a.x + dx * tc - centre.x, a.y + dy * tc - centre.y) <= 1e-9 * Math.sqrt(length2)) ts.push(tc)
      ts.sort((p, q) => p - q)

      const out: number[] = []
      let t0 = 0
      for (let n = 0; n <= ts.length; n++) {
        const t1 = n < ts.length ? ts[n] : 1
        if (t1 > t0) sliceCreases(t0, t1)
        if (n < ts.length) out.push(t1)
        t0 = t1
      }
      return out

      /** Ring sides and cell diagonals crossed between t0 and t1, which lie in one slice. */
      function sliceCreases(from: number, to: number) {
        const mid = (from + to) / 2
        const j = wedgeOf({ x: a.x + dx * mid, y: a.y + dy * mid })
        const pa = toWedge(j, a)
        const pb = toWedge(j, b)
        const ds = pb.s - pa.s
        const dxw = pb.x - pa.x
        const i = sliceOf(pa.s + ds * mid, pa.x + dxw * mid)
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
        for (let n = 0; n <= rings.length; n++) {
          const r1 = n < rings.length ? rings[n] : to
          const k = Math.floor(pa.s + ds * ((r0 + r1) / 2))
          if (k >= 1 && k < last) {
            // Diagonal of cell k in slice i, solved along the segment.
            const rise = (k + 1) * slope[i + 1] - k * slope[i]
            const slant = dxw - rise * ds
            const t = slant === 0 ? NaN : (k * slope[i] + (pa.s - k) * rise - pa.x) / slant
            if (t > r0 && t < r1) out.push(t)
          }
          if (n < rings.length) out.push(r1)
          r0 = r1
        }
      }
    },
  }

  /** The diagonal of cell k in slice i at ring position s: from ring k on its first ray to ring k + 1 on its second. */
  function diagonal(k: number, i: number, s: number): number {
    return k * slope[i] + (s - k) * ((k + 1) * slope[i + 1] - k * slope[i])
  }
}

/** A mesh corner in wedge coordinates (ring index s, across position x) and where it goes (s, x). */
type Corner = [number, number, number, number]

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
