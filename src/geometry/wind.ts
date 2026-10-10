// Experimental Wind: letters pulled out in the wind's direction, ragged where gusts drag them further.
// Pure functions in font units; no React, no DOM, no Math.random.
//
// Every point moves along the wind by Strength × its band's gust × its distance downwind of the
// glyph's upwind edge: the upwind edge stays put and stays crisp, and the letter is drawn out more the
// further downwind it reaches. Bands run with the wind, one Gust size apart, anchored at the glyph
// origin (so with a level wind every letter on a line shares the same gusts); each band's gust is a
// random share of the full strength, from the seed, varied by Gustiness. The bands are cut into square
// cells, each split into two triangles along a diagonal chosen by the seed, and points move linearly
// with their triangle (see warp.ts).
//
// No triangle can flip: gusts are never negative and the movement only grows downwind, so every
// triangle is stretched along the wind, never squeezed. The warp is one-to-one at any strength.

import { hashInts } from './distortion'
import type { Box } from './ripple'
import type { Point, WindParams } from './types'
import type { Warp } from './warp'

export const WIND_LIMITS = {
  /** Strength: extra length per unit of distance downwind at a full gust (1 = up to twice as long). */
  maxStrength: 1,
  /** Band (gust) sizes, as fractions of the em. */
  minGust: 0.06,
  maxGust: 0.5,
} as const

/** Channel numbers keep Wind's random numbers apart from the other effects' for the same seed. */
const CHANNEL = { gust: 201, diagonal: 202 } as const
const UINT = 0x1_0000_0000

export function windIsOn(params: WindParams): boolean {
  return params.enabled && params.strength > 0
}

/** The Wind warp for a glyph with this ink box, at `scale` × its strength. */
export function windWarp(params: WindParams, seed: number, box: Box, unitsPerEm: number, scale = 1): Warp {
  const angle = (finite(params.direction, 0) * Math.PI) / 180
  const wx = Math.cos(angle)
  const wy = Math.sin(angle)
  const size = clamp(finite(params.gust, 0.12), WIND_LIMITS.minGust, WIND_LIMITS.maxGust) * unitsPerEm
  const strength = clamp(finite(params.strength, 0), 0, WIND_LIMITS.maxStrength) * scale
  const gustiness = clamp(finite(params.gustiness, 0.6), 0, 1)
  // The glyph's upwind edge: the smallest distance along the wind over the ink box.
  const upwind = Math.min(...[box.minX, box.maxX].flatMap((x) => [box.minY, box.maxY].map((y) => x * wx + y * wy)))

  /** Lattice coordinates: u counts cells downwind of the upwind edge, v counts bands across the wind. */
  const toLattice = (p: Point) => ({ u: (p.x * wx + p.y * wy - upwind) / size, v: (p.y * wx - p.x * wy) / size })
  const gust = (band: number) => 1 - gustiness * (hashInts(seed, CHANNEL.gust, band) / UINT)
  /** How far lattice point (i, j) moves along the wind: nothing upwind, then growing with the distance downwind. */
  const move = (i: number, j: number) => (i <= 0 ? 0 : strength * gust(j) * i * size)
  /** True: the cell's diagonal runs from its corner (i, j) to (i + 1, j + 1); false: (i + 1, j) to (i, j + 1). */
  const rising = (i: number, j: number) => (hashInts(seed, CHANNEL.diagonal, i, j) & 1) === 0

  return {
    map(p) {
      const { u, v } = toLattice(p)
      if (u <= 0) return p
      const i = Math.floor(u)
      const j = Math.floor(v)
      const fu = u - i
      const fv = v - j
      let corners: [number, number, number][]
      if (rising(i, j)) {
        corners =
          fu >= fv
            ? [[i, j, 1 - fu], [i + 1, j, fu - fv], [i + 1, j + 1, fv]]
            : [[i, j, 1 - fv], [i, j + 1, fv - fu], [i + 1, j + 1, fu]]
      } else {
        corners =
          fu + fv <= 1
            ? [[i, j, 1 - fu - fv], [i + 1, j, fu], [i, j + 1, fv]]
            : [[i + 1, j + 1, fu + fv - 1], [i + 1, j, 1 - fv], [i, j + 1, 1 - fu]]
      }
      let d = 0
      for (const [ci, cj, w] of corners) if (w !== 0) d += w * move(ci, cj)
      return { x: p.x + d * wx, y: p.y + d * wy }
    },

    creases(a, b) {
      const pa = toLattice(a)
      const pb = toLattice(b)
      const du = pb.u - pa.u
      const dv = pb.v - pa.v
      // Upwind of the edge nothing moves, so only lines where u >= 0 are creases.
      const downwind = (t: number) => pa.u + du * t >= 0
      const ts: number[] = []
      latticeLines(pa.u, du, ts, 0)
      const bands: number[] = []
      latticeLines(pa.v, dv, bands)
      for (const t of bands) if (downwind(t)) ts.push(t)
      ts.sort((x, y) => x - y)
      const out: number[] = []
      let t0 = 0
      for (let k = 0; k <= ts.length; k++) {
        const t1 = k < ts.length ? ts[k] : 1
        if (t1 > t0) {
          const mid = (t0 + t1) / 2
          const i = Math.floor(pa.u + du * mid)
          const j = Math.floor(pa.v + dv * mid)
          if (i >= 0) {
            // Rising diagonal: (u - i) = (v - j). Falling: (u - i) + (v - j) = 1.
            const t = rising(i, j) ? (i - j - pa.u + pa.v) / (du - dv) : (i + j + 1 - pa.u - pa.v) / (du + dv)
            if (t > t0 && t < t1) out.push(t)
          }
        }
        if (k < ts.length) out.push(t1)
        t0 = t1
      }
      return out
    },
  }
}

/** Parameters in (0, 1) where start + t × delta is a whole number (no smaller than `min`, if given). */
function latticeLines(start: number, delta: number, out: number[], min = -Infinity) {
  if (delta === 0) return
  const end = start + delta
  const lo = Math.max(Math.min(start, end), min - 1)
  const hi = Math.max(start, end)
  for (let k = Math.max(Math.floor(lo) + 1, min); k < hi; k++) {
    const t = (k - start) / delta
    if (t > 0 && t < 1) out.push(t)
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}
