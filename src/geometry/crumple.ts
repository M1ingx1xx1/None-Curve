// Experimental Crumple: crumples the letter like paper. Pure functions in font units; no React, no DOM,
// no Math.random.
//
// Three triangle meshes are laid over the letter, each a square lattice turned by its own angle from the
// seed, each square split into two triangles along a diagonal also chosen by the seed, so the creases of
// different meshes do not line up. Each lattice point moves by a vector from the seed (all turned by
// Turn), points in between move linearly with their triangle, and the three movements add up (see
// warp.ts). A sum of maps that are linear on each triangle is linear on each piece where the triangles
// overlap, so straight edges stay straight between creases, and the creases are those of the three meshes.
//
// - Large (cells of 2.25 facets): every point moves, so whole strokes tilt and kink as blocks; a long
//   stem bends once or twice instead of zigzagging.
// - Medium (cells of one facet): a few scattered points move, each alone among its neighbours, so a stroke
//   end or a joint bends here and there.
// - Fine (cells of 0.4 facets, never below `minFineCell`): every point moves inside busy stretches, giving
//   small sharp corners along the edge.
// A coarse field from the seed decides where the medium and fine meshes act: busy stretches alternate with
// calm ones, where only the large mesh bends the outline. It is read only at lattice points, so the warp
// stays linear on each triangle. Detail moves strength from the large mesh to the smaller ones and widens
// the busy stretches; at 0 only the large mesh moves.
//
// Each glyph reads the meshes at its own offset, picked from the seed and the glyph, so neighbouring
// letters crumple differently, while every copy of a letter gets the same shape; the middle of its ink box
// stays in place, so letters bend without drifting into each other. Turn changes only where the points
// go, not how far, so the limits below hold at any turn.
//
// Up to 100% Amount the warp is one-to-one. On a triangle of a lattice with cell c whose corners move by
// m0, m1 and m2, the movement changes by (m1 − m0) / c and (m2 − m0) / c along the two legs, so its gradient
// (the most it stretches any direction, as a matrix norm) is at most 2√2 · R / c when no corner moves more
// than R, and √2 · R / c when only one corner moves. The gradients of the three meshes add up, and while
// their sum stays below 1 no piece of the combined mesh flips, so the warp is one-to-one. The large mesh
// takes at most its share of `budget`; each medium and fine point then takes a share of what the coarser
// meshes leave on the triangles near it, measured from their actual moves, so the sum stays within
// `budget` everywhere. Above 100% the points move further along the same directions, pieces flip over
// their neighbours, and the letter folds onto itself; the overlaps are then merged into one outline (see
// overlaps.ts).

import { hashInts } from './distortion'
import type { CrumpleParams, Point } from './types'
import type { Warp } from './warp'

export const CRUMPLE_LIMITS = {
  /**
   * Facet sizes, as fractions of the em. Creases fall about 40% of a cell apart along the outline; the
   * smallest facet keeps the medium mesh's creases about 3% of the em apart or more.
   */
  minFacet: 0.08,
  maxFacet: 1,
  /** Above 1 (the safe range), facets fold over each other. */
  maxAmount: 5,
  /** Detail when older saved settings lack it. */
  defaultDetail: 0.5,
  /** Largest gradient of the whole warp at 100% Amount, summed over the three meshes (below 1: one-to-one). */
  budget: 0.85,
  /** Cells of the large and fine meshes and of the busy/calm field, × the facet size. */
  largeCell: 2.25,
  fineCell: 0.4,
  densityCell: 3,
  /**
   * The fine mesh's smallest cell, × the em: its creases stay about 2% of the em apart or more, so its
   * corners read as corners rather than as a wobbly curve.
   */
  minFineCell: 0.05,
} as const

/** How Detail (0–1) shares the budget and sets the busy stretches. */
const DETAIL = {
  /** Share of the budget the large mesh may take, at Detail 0 and at Detail 1. */
  large: [1, 0.6],
  /** Share of the budget left near a point that a medium and a fine point take, once Detail reaches 50%. */
  medium: 0.8,
  fine: 1,
  /** In busy stretches the large mesh moves this much less (at Detail 50% and above), leaving room for the fine one. */
  quiet: 0.8,
  /** Thresholds on the busy/calm field (0–1) above which the fine mesh acts, at Detail 0 and at Detail 1 (about 70% and 25% calm). */
  calm: [0.6, 0.35],
  /** The medium mesh acts this much below the fine mesh's threshold, so it covers more. */
  mediumAhead: 0.15,
  /** Width of the fade between calm and busy, on the field's scale. */
  fade: 0.12,
} as const

/** Channel numbers keep Crumple's random numbers apart from the other effects' for the same seed. */
const CHANNEL = {
  shift: 105,
  large: { angle: 106, diagonal: 107, direction: 108, distance: 109 },
  medium: { angle: 110, diagonal: 111, direction: 112, distance: 113, pick: 114 },
  fine: { angle: 115, diagonal: 116, direction: 117, distance: 118 },
  density: { angle: 119, value: 120 },
} as const
const UINT = 0x1_0000_0000
/** How far (× the em) the glyph's offset may shift the meshes. */
const SHIFT = 8

export function crumpleIsOn(params: CrumpleParams): boolean {
  return params.enabled && params.amount > 0
}

/** True when Crumple goes beyond its safe range, so the letter folds onto itself. */
export function crumpleFolds(params: CrumpleParams): boolean {
  return crumpleIsOn(params) && params.amount > 1
}

/**
 * The Crumple warp of one glyph (`glyph`: its index) at `scale` × its strength (1 = the safe maximum).
 * `anchor` (the glyph's middle) is held in place: the whole warp is shifted back by its movement, which
 * changes no shape but keeps a letter from drifting into its neighbours.
 */
export function crumpleWarp(params: CrumpleParams, seed: number, unitsPerEm: number, scale = 1, glyph = 0, anchor?: Point): Warp {
  const amount = clamp(finite(params.amount, 0), 0, CRUMPLE_LIMITS.maxAmount) * scale
  const turned = (finite(params.turn, 0) * Math.PI) / 180
  const detail = clamp(finite(params.detail, CRUMPLE_LIMITS.defaultDetail), 0, 1)
  const facet = clamp(finite(params.facet, 0.18), CRUMPLE_LIMITS.minFacet, CRUMPLE_LIMITS.maxFacet) * unitsPerEm
  const random = (...values: number[]) => hashInts(seed, ...values) / UINT
  const shift = { x: random(CHANNEL.shift, glyph, 0) * SHIFT * unitsPerEm, y: random(CHANNEL.shift, glyph, 1) * SHIFT * unitsPerEm }

  const busy = Math.min(1, 2 * detail)
  const largeShare = CRUMPLE_LIMITS.budget * (DETAIL.large[0] + (DETAIL.large[1] - DETAIL.large[0]) * detail)
  const calm = DETAIL.calm[0] + (DETAIL.calm[1] - DETAIL.calm[0]) * detail
  const field = densityField(seed, facet * CRUMPLE_LIMITS.densityCell, shift)
  const fineDensity = (p: Point) => smoothstep((field(p) - calm) / DETAIL.fade)
  const mediumDensity = (p: Point) => smoothstep((field(p) - calm + DETAIL.mediumAhead) / DETAIL.fade)
  /** A movement of length r in the seeded direction for channel `direction` at (i, j), turned by Turn. */
  const toward = (r: number, direction: number, i: number, j: number): Point => {
    const angle = random(direction, i, j) * 2 * Math.PI + turned
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
  }

  // Moves are at 100% Amount; the warp scales them by `amount`, and the budget is measured on them.
  const largeCell = facet * CRUMPLE_LIMITS.largeCell
  const large = lattice(seed, CHANNEL.large, largeCell, shift, false, (i, j, at) => {
    // Uniform over the disc of the largest move that keeps the gradient within the large mesh's share.
    const reach = (largeShare / (2 * Math.SQRT2)) * largeCell * (1 - DETAIL.quiet * busy * fineDensity(at))
    return toward(reach * Math.sqrt(random(CHANNEL.large.distance, i, j)), CHANNEL.large.direction, i, j)
  })
  // A medium point moves only where it ranks first among its eight neighbours, so no two moving points
  // share a triangle: about one point in nine, scattered, each with the steeper single-corner limit.
  const mediumCell = facet
  const ranked = (i: number, j: number) => {
    const rank = hashInts(seed, CHANNEL.medium.pick, i, j)
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) if ((di || dj) && hashInts(seed, CHANNEL.medium.pick, i + di, j + dj) >= rank) return false
    }
    return true
  }
  const medium = lattice(seed, CHANNEL.medium, mediumCell, shift, true, (i, j, at) => {
    const density = busy > 0 && ranked(i, j) ? mediumDensity(at) : 0
    if (density <= 0) return null
    // Every triangle the point is a corner of lies within this distance of it.
    const left = CRUMPLE_LIMITS.budget - large.steepestNear(at, Math.SQRT2 * mediumCell)
    const reach = ((DETAIL.medium * busy * Math.max(0, left)) / Math.SQRT2) * mediumCell * density
    return toward(reach * Math.sqrt(random(CHANNEL.medium.distance, i, j)), CHANNEL.medium.direction, i, j)
  })
  const fineCell = Math.max(facet * CRUMPLE_LIMITS.fineCell, CRUMPLE_LIMITS.minFineCell * unitsPerEm)
  const fine = lattice(seed, CHANNEL.fine, fineCell, shift, true, (i, j, at) => {
    const density = busy > 0 ? fineDensity(at) : 0
    if (density <= 0) return null
    const near = Math.SQRT2 * fineCell
    const left = CRUMPLE_LIMITS.budget - large.steepestNear(at, near) - medium.steepestNear(at, near)
    const reach = ((DETAIL.fine * busy * Math.max(0, left)) / (2 * Math.SQRT2)) * fineCell * density
    // Mostly close to the limit, now and then much less, so the small corners vary in depth.
    return toward(reach * Math.pow(random(CHANNEL.fine.distance, i, j), 0.7), CHANNEL.fine.direction, i, j)
  })
  const meshes = [large, medium, fine]
  const hold = { x: 0, y: 0 }
  if (anchor) for (const mesh of meshes) mesh.add(anchor, -amount, hold)

  return {
    map(p) {
      const out = { x: p.x + hold.x, y: p.y + hold.y }
      for (const mesh of meshes) mesh.add(p, amount, out)
      return out
    },
    creases(a, b) {
      const out: number[] = []
      for (const mesh of meshes) mesh.creases(a, b, out)
      return out.sort((x, y) => x - y)
    },
  }
}

interface Lattice {
  /** Adds the mesh's movement of p, × `amount`, to `out`. */
  add(p: Point, amount: number, out: Point): void
  /** Pushes the parameters t in (0, 1) where a → b crosses a crease of the mesh, unordered. */
  creases(a: Point, b: Point, out: number[]): void
  /** The steepest gradient (matrix norm) of the mesh's movement on any triangle that meets the disc of radius r around p. */
  steepestNear(p: Point, r: number): number
}

/**
 * One triangle mesh: a square lattice of cell `cell`, turned by a seeded angle and shifted by `shift`.
 * `move(i, j, at)` gives the movement of lattice point (i, j), which lies at `at`, or null if it stays.
 * With `sparse`, creases between triangles whose corners all stay are left out: the warp does not bend there.
 */
function lattice(
  seed: number,
  channel: { angle: number; diagonal: number },
  cell: number,
  shift: Point,
  sparse: boolean,
  move: (i: number, j: number, at: Point) => Point | null,
): Lattice {
  // The square lattice looks the same every quarter turn, so a quarter turn of angles covers all.
  const angle = (hashInts(seed, channel.angle) / UINT) * (Math.PI / 2)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const toLattice = (p: Point) => {
    const x = p.x + shift.x
    const y = p.y + shift.y
    return { u: (x * cos + y * sin) / cell, v: (y * cos - x * sin) / cell }
  }
  // Font coordinates fit in 16 bits and cells are at least 1/20 em, so |j| stays far below 2^21 and the key is unique.
  const moves = new Map<number, Point | null>()
  const moveAt = (i: number, j: number) => {
    const key = i * 0x40_0000 + j
    let m = moves.get(key)
    if (m === undefined) {
      const at = { x: (i * cos - j * sin) * cell - shift.x, y: (i * sin + j * cos) * cell - shift.y }
      m = move(i, j, at)
      moves.set(key, m)
    }
    return m
  }
  /** True: the square's diagonal runs from its corner (i, j) to (i + 1, j + 1); false: (i + 1, j) to (i, j + 1). */
  const rising = (i: number, j: number) => (hashInts(seed, channel.diagonal, i, j) & 1) === 0
  /** True when a point of the block from (i0, j0) to (i1, j1) moves. */
  const moving = (i0: number, j0: number, i1: number, j1: number) => {
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (moveAt(i, j)) return true
    return false
  }
  const still = { x: 0, y: 0 }
  // The two triangles of square (i, j) as corner offsets, the right angle first.
  const RISING = [[[1, 0], [0, 0], [1, 1]], [[0, 1], [0, 0], [1, 1]]] as const
  const FALLING = [[[0, 0], [1, 0], [0, 1]], [[1, 1], [0, 1], [1, 0]]] as const

  return {
    add(p, amount, out) {
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
      for (const [ci, cj, w] of corners) {
        const d = w === 0 ? null : moveAt(ci, cj)
        if (!d) continue
        out.x += w * d.x * amount
        out.y += w * d.y * amount
      }
    },

    creases(a, b, out) {
      const pa = toLattice(a)
      const pb = toLattice(b)
      const du = pb.u - pa.u
      const dv = pb.v - pa.v
      // Lattice lines first (whole u or v), then the one diagonal inside each square in between.
      const ts: number[] = []
      latticeLines(pa.u, du, ts)
      const across = ts.length
      latticeLines(pa.v, dv, ts)
      // Where the warp bends at a lattice line: the triangles on both sides lie in the two squares beside
      // it (one row more each way, in case the line is crossed at a lattice point).
      const bends = (k: number) => {
        if (!sparse) return true
        const u = pa.u + du * ts[k]
        const v = pa.v + dv * ts[k]
        if (k < across) {
          const i = Math.round(u)
          return moving(i - 1, Math.floor(v) - 1, i + 1, Math.floor(v) + 2)
        }
        const j = Math.round(v)
        return moving(Math.floor(u) - 1, j - 1, Math.floor(u) + 2, j + 1)
      }
      for (let k = 0; k < ts.length; k++) if (bends(k)) out.push(ts[k])
      ts.sort((x, y) => x - y)
      let t0 = 0
      for (let k = 0; k <= ts.length; k++) {
        const t1 = k < ts.length ? ts[k] : 1
        if (t1 > t0) {
          const mid = (t0 + t1) / 2
          const i = Math.floor(pa.u + du * mid)
          const j = Math.floor(pa.v + dv * mid)
          // Rising diagonal: (u - i) = (v - j). Falling: (u - i) + (v - j) = 1.
          const t = rising(i, j) ? (i - j - pa.u + pa.v) / (du - dv) : (i + j + 1 - pa.u - pa.v) / (du + dv)
          if (t > t0 && t < t1 && (!sparse || moving(i, j, i + 1, j + 1))) out.push(t)
        }
        t0 = t1
      }
    },

    steepestNear(p, r) {
      const { u, v } = toLattice(p)
      const reach = r / cell
      let steepest = 0
      for (let i = Math.floor(u - reach); i <= Math.floor(u + reach); i++) {
        for (let j = Math.floor(v - reach); j <= Math.floor(v + reach); j++) {
          for (const triangle of rising(i, j) ? RISING : FALLING) {
            const [o, a, b] = triangle
            const corner = (c: readonly number[]) => moveAt(i + c[0], j + c[1]) ?? still
            const m0 = corner(o)
            const ma = corner(a)
            const mb = corner(b)
            // The legs o → a and o → b are unit steps along u and v (in some order and sign), which the norm ignores.
            const g = matrixNorm(ma.x - m0.x, mb.x - m0.x, ma.y - m0.y, mb.y - m0.y) / cell
            if (g > steepest && discMeetsTriangle(u - i, v - j, reach, triangle)) steepest = g
          }
        }
      }
      return steepest
    },
  }
}

/**
 * The busy/calm field: smooth value noise in [0, 1] on a coarse turned lattice of cell `cell`. Only ever
 * read at lattice points, so its smoothness never reaches the outline.
 */
function densityField(seed: number, cell: number, shift: Point): (p: Point) => number {
  const angle = (hashInts(seed, CHANNEL.density.angle) / UINT) * 2 * Math.PI
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const value = (i: number, j: number) => hashInts(seed, CHANNEL.density.value, i, j) / UINT
  return (p) => {
    const x = p.x + shift.x
    const y = p.y + shift.y
    const u = (x * cos + y * sin) / cell
    const v = (y * cos - x * sin) / cell
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fu = smoothstep(u - i)
    const fv = smoothstep(v - j)
    const low = value(i, j) * (1 - fu) + value(i + 1, j) * fu
    const high = value(i, j + 1) * (1 - fu) + value(i + 1, j + 1) * fu
    return low * (1 - fv) + high * fv
  }
}

/**
 * The largest singular value of [[a, b], [c, d]]. The legs of a triangle are orthogonal unit steps, so
 * for the movement's changes along them this is the gradient's norm (up to the cell size).
 */
function matrixNorm(a: number, b: number, c: number, d: number): number {
  const sum = a * a + b * b + c * c + d * d
  const det = a * d - b * c
  return Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2)
}

/** True when the disc of radius r around (u, v) meets the triangle (corners in the same units). */
function discMeetsTriangle(u: number, v: number, r: number, corners: readonly (readonly number[])[]): boolean {
  const side = (a: readonly number[], b: readonly number[]) => (b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0])
  const s0 = side(corners[0], corners[1])
  const s1 = side(corners[1], corners[2])
  const s2 = side(corners[2], corners[0])
  if ((s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) return true
  for (let k = 0; k < 3; k++) {
    const a = corners[k]
    const b = corners[(k + 1) % 3]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = clamp(((u - a[0]) * dx + (v - a[1]) * dy) / (dx * dx + dy * dy), 0, 1)
    if (Math.hypot(a[0] + t * dx - u, a[1] + t * dy - v) <= r) return true
  }
  return false
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

function smoothstep(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}
