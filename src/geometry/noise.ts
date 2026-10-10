// Experimental Noise: crumples the letter like paper. Pure functions in font units; no React, no DOM,
// no Math.random.
//
// The mesh is a square lattice with cells of the facet size (a fraction of the em), turned by an angle from the seed, each
// square split into two triangles along a diagonal also chosen by the seed (so the creases do not
// line up in a grid). Every lattice point moves by its own random vector from the seed; points in
// between move linearly with their triangle (see warp.ts). The lattice is fixed in glyph coordinates,
// so every copy of a letter gets the same shape.
//
// No lattice point moves more than 30% of the cell size. A triangle whose corners each move less
// than that keeps about 15% of its area or more and cannot flip, so the warp is always one-to-one:
// Noise never needs to be weakened to keep the letter valid.

import { hashInts } from './distortion'
import type { NoiseParams, Point } from './types'
import type { Warp } from './warp'

export const NOISE_LIMITS = {
  /**
   * Facet sizes, as fractions of the em. Creases fall about 40% of a facet apart along the outline, so
   * the smallest facet keeps them about 3% of the em apart or more: far enough to read as corners
   * rather than as a wobbly curve at any text size.
   */
  minFacet: 0.08,
  maxFacet: 0.6,
  /** Largest lattice-point movement at 100% Amount, as a fraction of the facet size. */
  maxMove: 0.3,
} as const

/** Channel numbers keep Noise's random numbers apart from the other effects' for the same seed. */
const CHANNEL = { angle: 101, direction: 102, distance: 103, diagonal: 104 } as const
const UINT = 0x1_0000_0000

export function noiseIsOn(params: NoiseParams): boolean {
  return params.enabled && params.amount > 0
}

/** The Noise warp at `scale` × its strength. */
export function noiseWarp(params: NoiseParams, seed: number, unitsPerEm: number, scale = 1): Warp {
  const size = clamp(finite(params.facet, 0.18), NOISE_LIMITS.minFacet, NOISE_LIMITS.maxFacet) * unitsPerEm
  const reach = clamp(finite(params.amount, 0), 0, 1) * NOISE_LIMITS.maxMove * size * scale
  // The square lattice looks the same every quarter turn, so a quarter turn of angles covers all.
  const angle = (hashInts(seed, CHANNEL.angle) / UINT) * (Math.PI / 2)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const toLattice = (p: Point) => ({ u: (p.x * cos + p.y * sin) / size, v: (p.y * cos - p.x * sin) / size })
  // Uniform over the disc of radius `reach`.
  const move = (i: number, j: number) => {
    const turn = (hashInts(seed, CHANNEL.direction, i, j) / UINT) * 2 * Math.PI
    const r = reach * Math.sqrt(hashInts(seed, CHANNEL.distance, i, j) / UINT)
    return { x: r * Math.cos(turn), y: r * Math.sin(turn) }
  }
  /** True: the square's diagonal runs from its corner (i, j) to (i + 1, j + 1); false: (i + 1, j) to (i, j + 1). */
  const rising = (i: number, j: number) => (hashInts(seed, CHANNEL.diagonal, i, j) & 1) === 0

  return {
    map(p) {
      const { u, v } = toLattice(p)
      const i = Math.floor(u)
      const j = Math.floor(v)
      const fu = u - i
      const fv = v - j
      // The triangle holding p, as three corners with their barycentric weights.
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
      let x = p.x
      let y = p.y
      for (const [ci, cj, w] of corners) {
        if (w === 0) continue
        const d = move(ci, cj)
        x += w * d.x
        y += w * d.y
      }
      return { x, y }
    },

    creases(a, b) {
      const pa = toLattice(a)
      const pb = toLattice(b)
      const du = pb.u - pa.u
      const dv = pb.v - pa.v
      // Lattice lines first (whole u or v), then the one diagonal inside each square in between.
      const ts: number[] = []
      latticeLines(pa.u, du, ts)
      latticeLines(pa.v, dv, ts)
      ts.sort((x, y) => x - y)
      const out: number[] = []
      let t0 = 0
      for (let k = 0; k <= ts.length; k++) {
        const t1 = k < ts.length ? ts[k] : 1
        if (t1 > t0) {
          const mid = (t0 + t1) / 2
          const i = Math.floor(pa.u + du * mid)
          const j = Math.floor(pa.v + dv * mid)
          // Rising diagonal: (u - i) = (v - j). Falling: (u - i) + (v - j) = 1.
          const t = rising(i, j) ? (i - j - pa.u + pa.v) / (du - dv) : (i + j + 1 - pa.u - pa.v) / (du + dv)
          if (t > t0 && t < t1) out.push(t)
        }
        if (k < ts.length) out.push(t1)
        t0 = t1
      }
      return out
    },
  }
}

/** Parameters in (0, 1) where start + t × delta is a whole number. */
function latticeLines(start: number, delta: number, out: number[]) {
  if (delta === 0) return
  const end = start + delta
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  for (let k = Math.floor(lo) + 1; k < hi; k++) {
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
