// Experimental Slipstream: letters caught in a stream. Bands across the stream slide past each other, the stream
// drags the letters out, a few trails stream off their downwind side, and thin wedge-shaped cuts run into them along
// the stream. Pure functions in font units; no React, no DOM, no Math.random.
//
// The warp (slipstreamWarp) moves every point along the stream by two amounts:
// - Slip, a shear: an offset that depends only on where the point lies across the stream. Sway bands a few Gust
//   sizes wide each slide by their own seeded share of Slip, and most bands one Gust size wide add a smaller share
//   of their own (turbulence), so a few large steps stand out among finer ones. The offset is constant inside a band
//   and changes only in a thin zone at its edges, so the bands slide past each other like slices.
// - Stretch: Strength × its band's gust × its distance downwind of the glyph's upwind edge, so the upwind edge stays
//   put and the letter is drawn out more the further downwind it reaches. Each band's gust is a random share of the
//   full strength, from the seed, varied by Gustiness. The bands are cut into square cells, each split into two
//   triangles along a diagonal chosen by the seed, and points move linearly with their triangle (see warp.ts).
// All bands run with the stream, anchored at the glyph origin, so with a level stream every letter on a line shares
// the same bands.
//
// Why the warp cannot fold within the safe range: in stream coordinates (u along, v across) it maps (u, v) to
// (u + d(u, v), v), whose Jacobian determinant is 1 + ∂d/∂u. Slip depends on v alone, so it adds nothing to ∂d/∂u:
// a shear keeps every triangle the same way round at any amount. Up to 100% Gustiness the gusts are never negative
// and the stretch only grows downwind (∂d/∂u ≥ 0), so the determinant stays at least 1 and the warp is one-to-one at
// any strength. Above 100% some gusts blow backwards: their bands are pushed back through the letter, tearing it
// and folding it onto itself; the overlaps are then merged into one outline (see overlaps.ts).
//
// Trails, after the warp: a few thin, tapering streaks grow downwind out of the downwind-facing edges of the
// letter's outside, at seeded places, as long as Strength makes them. One that would cross or come close to the
// letter or another trail is tried elsewhere or left out, so trails never need merging.
//
// Cuts, last, so they slice the trails too: a few long, thin wedges along the stream enter the letter from its
// upwind or downwind side, widest where they enter and tapering to a sharp tip inside a stroke; a few go right
// through it. They are cut out exactly: the outline is first redrawn by the nonzero rule (overlaps.ts), so the ink
// winds once and everything else not at all; then the wedges are added the other way round, and the outline is
// redrawn around what still winds positively.
//
// Gust size 0 means no gusts: the stream blows steadily (every band at full strength, so Gustiness does nothing) and
// nothing slips. Below the smallest band (smallestGust) the bands keep that size and Gustiness and Slip fade out
// instead, in proportion, so the slider runs down to a steady stream without ever cutting the bands finer.

import type { GlyphBudget } from './budget'
import { insideRing } from './crossings'
import { hashInts } from './distortion'
import { mergeOverlaps, type FillRule, type OverlapStats } from './overlaps'
import { clamp, distanceToSegment, lerp, signedArea } from './primitives'
import type { Box } from './ripple'
import type { Point, PolygonGlyph, SlipstreamParams } from './types'
import { emptyWarpStats, type Warp, type WarpStats } from './warp'

export const SLIPSTREAM_LIMITS = {
  /** Strength: extra length per unit of distance downwind at a full gust (1 = up to twice as long). */
  maxStrength: 8,
  /**
   * No point moves further than this (× the em), however far downwind it lies: beyond it the letter
   * is carried along without stretching further. This keeps strong streams and backward gusts within
   * the coordinates a font file can store.
   */
  maxReach: 4,
  /** Above 1 (the safe range), some gusts blow backwards. */
  maxGustiness: 2,
  /** Band (gust) sizes, as fractions of the em; 0: no gusts (see the header). */
  minGust: 0,
  maxGust: 0.5,
  /** The narrowest band: smaller gust sizes keep it and fade Gustiness and Slip out. */
  smallestGust: 0.06,
  /** Slip: how far apart the sway bands may slide, as a fraction of the em. Safe at any amount (a shear). */
  maxSlip: 0.6,
  /** Cuts and trails per letter. */
  maxCuts: 8,
  maxTrails: 8,
} as const

/** How the slip is laid out, in bands one Gust size wide. */
const SLIP = {
  /** A sway band spans this many bands, give or take one at each end (2–6, mostly 3–5). */
  swayBands: 4,
  /** Each band's own slide (turbulence), as a share of Slip. */
  turbulence: 0.3,
  /** Share of bands without turbulence of their own, so the fine steps come irregularly. */
  calm: 0.4,
  /** Half the zone where the offset changes from one sway band to the next: thin, so the bands slide like slices. */
  swayRamp: 0.06,
  /** Half the zone where the turbulence changes from one band to the next. */
  turbulenceRamp: 0.05,
} as const

/** How trails are drawn; lengths and widths as fractions of the em. */
const TRAIL = {
  /** Longest trail at Strength 0, added per unit of Strength, and at most. Each is a seeded `minShare`–100% of it. */
  reach: 0.15,
  perStrength: 0.5,
  maxReach: 2,
  minShare: 0.45,
  /** Width where the trail leaves the letter. */
  minWidth: 0.02,
  maxWidth: 0.05,
  /**
   * A trail narrows fast, then runs out thin: at `shoulder` of its length it is `neck` of its width wide, so it
   * reads as a streak dragged off the letter rather than a thorn.
   */
  shoulder: 0.25,
  neck: 0.3,
  /** Only edges whose outward normal lies within about 53° of the stream (its cosine at least this) grow trails. */
  minFacing: 0.6,
  /** Seeded turn away from the stream, either way, in degrees. */
  turn: 4,
  /** A trail keeps at least this far from every edge but its own, so it survives rounding for export. */
  clearance: 0.006,
  /** Places tried per trail. */
  attempts: 3,
} as const

/** How cuts are drawn; lengths as fractions of the em. */
const CUT = {
  /** Cuts keep this share of the letter's extent across the stream free at either side. */
  margin: 0.06,
  /** The wedge opens this far outside the first stroke it enters. */
  lead: 0.03,
  /** Half its width at the opening: its length × a seeded taper in this range, then kept within min–max. */
  minTaper: 0.035,
  maxTaper: 0.075,
  minHalf: 0.006,
  maxHalf: 0.022,
  /** Share of cuts that go right through the letter. */
  through: 0.25,
  /** Share of the others that end in the second stroke they meet instead of the first. */
  second: 0.3,
  /** How deep into its stroke the tip lies: a seeded share in this range. */
  minDepth: 0.35,
  maxDepth: 0.85,
  /** A cut through the letter runs on past it by this share of its length, plus `past`. */
  overrun: 0.25,
  past: 0.02,
  /** Places tried per cut. */
  attempts: 3,
} as const

/** Channel numbers keep Slipstream's random numbers apart from the other effects' for the same seed. */
const CHANNEL = { gust: 201, diagonal: 202, sway: 203, swayEdge: 204, turbulence: 205, trail: 206, cut: 207 } as const
const UINT = 0x1_0000_0000

export interface SlipstreamStats extends WarpStats {
  /** Trails drawn out of the letter. */
  trails: number
  /** Cuts made into it. */
  cuts: number
}

export const emptySlipstreamStats = (): SlipstreamStats => ({ ...emptyWarpStats(), trails: 0, cuts: 0 })

export function slipstreamIsOn(params: SlipstreamParams): boolean {
  return (
    params.enabled &&
    (finite(params.strength, 0) > 0 || finite(params.slip, 0) * gustFade(params) > 0 || count(params.cuts, SLIPSTREAM_LIMITS.maxCuts) > 0 || count(params.trails, SLIPSTREAM_LIMITS.maxTrails) > 0)
  )
}

/**
 * True when Slipstream goes beyond its safe range (gusts blowing backwards), so the letter can fold onto itself. Only the
 * stretch can fold: without Strength, Slip is a shear and never does.
 */
export function slipstreamFolds(params: SlipstreamParams): boolean {
  return slipstreamIsOn(params) && finite(params.strength, 0) > 0 && params.gustiness * gustFade(params) > 1
}

/** The gust size (× the em), from 0 (no gusts) up. */
function gustOf(params: SlipstreamParams): number {
  return clamp(finite(params.gust, 0.12), SLIPSTREAM_LIMITS.minGust, SLIPSTREAM_LIMITS.maxGust)
}

/** How much of Gustiness and Slip is left: 1 from the smallest band up, falling to 0 at gust size 0. */
function gustFade(params: SlipstreamParams): number {
  return Math.min(gustOf(params) / SLIPSTREAM_LIMITS.smallestGust, 1)
}

/** The band size Slipstream uses (× the em) and how much of Gustiness and Slip is left there (0–1; 0: steady). */
export function slipstreamBands(params: SlipstreamParams): { gust: number; fade: number } {
  return { gust: Math.max(gustOf(params), SLIPSTREAM_LIMITS.smallestGust), fade: gustFade(params) }
}

/** True when Slipstream redraws the outline to make its cuts (see slipstreamTrailsAndCuts). */
export function slipstreamMerges(params: SlipstreamParams): boolean {
  return slipstreamIsOn(params) && count(params.cuts, SLIPSTREAM_LIMITS.maxCuts) > 0
}

/** The Slipstream warp for a glyph with this ink box, at `scale` × its strength and slip. */
export function slipstreamWarp(params: SlipstreamParams, seed: number, box: Box, unitsPerEm: number, scale = 1): Warp {
  const { wx, wy } = streamOf(params)
  const size = Math.max(gustOf(params), SLIPSTREAM_LIMITS.smallestGust) * unitsPerEm
  const fade = gustFade(params)
  const strength = clamp(finite(params.strength, 0), 0, SLIPSTREAM_LIMITS.maxStrength) * scale
  const gustiness = clamp(finite(params.gustiness, 0.6), 0, SLIPSTREAM_LIMITS.maxGustiness) * fade
  const slip = clamp(finite(params.slip, 0), 0, SLIPSTREAM_LIMITS.maxSlip) * fade * unitsPerEm * scale
  const shear = slip > 0 ? slipShear(seed, slip) : null
  /** Gust size 0: no gusts and no slip, a steady stream. */
  const steady = fade === 0
  // The glyph's upwind edge: the smallest distance along the stream over the ink box.
  const upwind = Math.min(...[box.minX, box.maxX].flatMap((x) => [box.minY, box.maxY].map((y) => x * wx + y * wy)))

  /** Lattice coordinates: u counts cells downwind of the upwind edge, v counts bands across the stream. */
  const toLattice = (p: Point) => ({ u: (p.x * wx + p.y * wy - upwind) / size, v: (p.y * wx - p.x * wy) / size })
  const gust = (band: number) => 1 - gustiness * (hashInts(seed, CHANNEL.gust, band) / UINT)
  const reach = SLIPSTREAM_LIMITS.maxReach * unitsPerEm
  /**
   * How far lattice point (i, j) moves along the stream: nothing upwind, then growing with the distance
   * downwind, up to the reach. Capping keeps the movement from ever shrinking downwind (for gusts that
   * blow forward), so it still stretches every triangle and never squeezes one.
   */
  const move = (i: number, j: number) => (i <= 0 ? 0 : clamp(strength * gust(j) * i * size, -reach, reach))
  /** True: the cell's diagonal runs from its corner (i, j) to (i + 1, j + 1); false: (i + 1, j) to (i, j + 1). */
  const rising = (i: number, j: number) => (hashInts(seed, CHANNEL.diagonal, i, j) & 1) === 0

  return {
    map(p) {
      const { u, v } = toLattice(p)
      let d = shear ? shear.offset(v) : 0
      if (u <= 0) return d === 0 ? p : { x: p.x + d * wx, y: p.y + d * wy }
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
      for (const [ci, cj, w] of corners) if (w !== 0) d += w * move(ci, cj)
      return { x: p.x + d * wx, y: p.y + d * wy }
    },

    creases(a, b) {
      const pa = toLattice(a)
      const pb = toLattice(b)
      const du = pb.u - pa.u
      const dv = pb.v - pa.v
      // Upwind of the edge nothing stretches, so only lines where u >= 0 are creases of the stretch.
      const downwind = (t: number) => pa.u + du * t >= 0
      const ts: number[] = []
      latticeLines(pa.u, du, ts, 0)
      // Gust size 0: every band blows alike and nothing slips, so the stretch changes only from one column of cells
      // to the next; band lines and diagonals bend nothing.
      if (steady) return ts.sort((x, y) => x - y)
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
      if (!shear || dv === 0) return out
      // The slip bends wherever the edge enters or leaves a zone where the offset changes.
      for (const bend of shear.bends(pa.v, pb.v)) {
        const t = (bend - pa.v) / dv
        if (t > 0 && t < 1) out.push(t)
      }
      out.sort((x, y) => x - y)
      return out.filter((t, k) => k === 0 || t > out[k - 1])
    },
  }
}

/**
 * The slip: for each place across the stream (v, in bands one Gust size wide), how far it slides along it (font
 * units), and where that offset bends. Sway band k runs from edge(k) to edge(k + 1); both its offset and each
 * band's turbulence hold steady inside the band and change linearly across a thin zone centred on its edges.
 */
function slipShear(seed: number, amount: number) {
  const { swayBands, turbulence, calm, swayRamp, turbulenceRamp } = SLIP
  const edge = (k: number) => swayBands * k + (hashInts(seed, CHANNEL.swayEdge, k) % 3) - 1
  // An edge lies at most one band from swayBands × k, so v's sway band is the nearest one or a neighbour.
  const swayBand = (v: number) => {
    const k = Math.floor(v / swayBands)
    return v < edge(k) ? k - 1 : v >= edge(k + 1) ? k + 1 : k
  }
  const sway = (k: number) => hashInts(seed, CHANNEL.sway, k) / UINT - 0.5
  const turb = (j: number) => {
    const r = hashInts(seed, CHANNEL.turbulence, j) / UINT
    return r < calm ? 0 : turbulence * ((r - calm) / (1 - calm) - 0.5)
  }
  /** The value at v in a band from lo to hi: its own, blended halfway into a neighbour's at either edge. */
  const steady = (v: number, lo: number, hi: number, ramp: number, before: number, own: number, after: number) => {
    if (v - lo < ramp) return before + (own - before) * (0.5 + (v - lo) / (2 * ramp))
    if (hi - v < ramp) return own + (after - own) * (0.5 - (hi - v) / (2 * ramp))
    return own
  }
  return {
    offset(v: number): number {
      const k = swayBand(v)
      const j = Math.floor(v)
      const s = steady(v, edge(k), edge(k + 1), swayRamp, sway(k - 1), sway(k), sway(k + 1))
      const t = steady(v, j, j + 1, turbulenceRamp, turb(j - 1), turb(j), turb(j + 1))
      return amount * (s + t)
    },
    /** Every v strictly between va and vb where the offset bends, in no particular order. */
    bends(va: number, vb: number): number[] {
      const lo = Math.min(va, vb)
      const hi = Math.max(va, vb)
      const out: number[] = []
      const add = (bend: number) => {
        if (bend > lo && bend < hi) out.push(bend)
      }
      for (let j = Math.ceil(lo - turbulenceRamp); j <= Math.floor(hi + turbulenceRamp); j++) {
        // Between two calm bands the turbulence does not change, so it does not bend there.
        if (turb(j - 1) === turb(j)) continue
        add(j - turbulenceRamp)
        add(j + turbulenceRamp)
      }
      for (let k = swayBand(lo - swayRamp), last = swayBand(hi + swayRamp) + 1; k <= last; k++) {
        add(edge(k) - swayRamp)
        add(edge(k) + swayRamp)
      }
      return out
    },
  }
}

/**
 * Slipstream's trails, then its cuts, on the warped glyph. `merge` describes how the outline was redrawn for the
 * cuts (null when it was not: no cuts, or the glyph lies too far out to merge); the redrawn outline is clean, with
 * any folds already merged. When the redraw broke down or was too complex (merge.applied false, with failed or
 * tooComplex), the glyph comes back with its trails but without cuts, unmerged (and, when too complex, simplified).
 * `budget` keeps the merges within the glyph's vertex budget (see budget.ts).
 */
export function slipstreamTrailsAndCuts(
  polygon: PolygonGlyph,
  params: SlipstreamParams,
  seed: number,
  unitsPerEm: number,
  budget?: GlyphBudget,
): { polygon: PolygonGlyph; trails: number; cuts: number; merge: OverlapStats | null } {
  const trailed = addTrails(polygon, params, seed, unitsPerEm)
  const merge = (glyph: PolygonGlyph, rule: FillRule) => (budget ? budget.merge(glyph, rule) : mergeOverlaps(glyph, rule))
  const cut = addCuts(trailed.polygon, params, seed, unitsPerEm, merge)
  return { polygon: cut.polygon, trails: trailed.count, cuts: cut.count, merge: cut.merge }
}

interface Trail {
  contour: number
  /** Where it leaves the outline and where its base begins, as distances along the contour from its first vertex. */
  root: number
  from: number
  half: number
  /** The edges holding either end of its base (edge i runs from vertex i to i + 1); the vertices between go. */
  first: number
  last: number
  points: Point[]
}

/** A contour with the distance along it to each vertex, so trail bases can span several edges. */
interface Ring {
  points: readonly Point[]
  /** Distance along the contour to each vertex, and the perimeter at the end. */
  at: number[]
}

/** Thin streaks growing downwind out of the downwind-facing edges of the letter's outside (see the header). */
function addTrails(polygon: PolygonGlyph, params: SlipstreamParams, seed: number, unitsPerEm: number): { polygon: PolygonGlyph; count: number } {
  const wanted = count(params.trails, SLIPSTREAM_LIMITS.maxTrails)
  if (wanted === 0) return { polygon, count: 0 }
  const { wx, wy } = streamOf(params)
  const glyph = polygon.ref.index | 0
  const clearance = TRAIL.clearance * unitsPerEm
  const contours = polygon.contours.map((c) => c.points)
  const rings: Ring[] = contours.map((points) => {
    const at = [0]
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length]
      at.push(at[i] + Math.hypot(q.x - p.x, q.y - p.y))
    })
    return { points, at }
  })

  // Every edge, for the clearance checks, and the edges trails may grow from, laid end to end.
  const segments: { contour: number; edge: number; a: Point; b: Point }[] = []
  const hosts: { contour: number; edge: number; length: number; start: number }[] = []
  let total = 0
  contours.forEach((points, contour) => {
    const n = points.length
    if (n < 3) return
    const outside = isOutside(contours, contour)
    // Counter-clockwise (positive area): the inside lies to the left of each edge, so outward is to its right.
    const side = signedArea(points) > 0 ? 1 : -1
    for (let edge = 0; edge < n; edge++) {
      const a = points[edge]
      const b = points[(edge + 1) % n]
      segments.push({ contour, edge, a, b })
      const dx = b.x - a.x
      const dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      if (!outside || length === 0 || (side * (dy * wx - dx * wy)) / length < TRAIL.minFacing) continue
      hosts.push({ contour, edge, length, start: total })
      total += length
    }
  })
  if (total === 0) return { polygon, count: 0 }

  const strength = clamp(finite(params.strength, 0), 0, SLIPSTREAM_LIMITS.maxStrength)
  const reach = Math.min(TRAIL.maxReach, TRAIL.reach + TRAIL.perStrength * strength) * unitsPerEm
  const trails: Trail[] = []
  const sides: [Point, Point][] = []

  for (let k = 0; k < wanted; k++) {
    for (let attempt = 0; attempt < TRAIL.attempts; attempt++) {
      const random = (field: number) => hashInts(seed, CHANNEL.trail, glyph, k, attempt, field) / UINT
      // Spread out: trail k grows somewhere in the k-th of `wanted` equal stretches of the facing edges.
      const at = ((k + random(0)) / wanted) * total
      const host = hosts.find((h) => at < h.start + h.length) ?? hosts[hosts.length - 1]
      const ring = rings[host.contour]
      const perimeter = ring.at[ring.points.length]
      const half = (unitsPerEm * (TRAIL.minWidth + (TRAIL.maxWidth - TRAIL.minWidth) * random(1))) / 2
      if (perimeter < 4 * (half + clearance)) continue
      const root = ring.at[host.edge] + clamp(at - host.start, 0, host.length)
      const apart = (t: Trail) => {
        const gap = Math.abs(t.root - root) % perimeter
        return Math.min(gap, perimeter - gap) >= t.half + half + clearance
      }
      if (!trails.every((t) => t.contour !== host.contour || apart(t))) continue
      const from = (((root - half) % perimeter) + perimeter) % perimeter
      const base = pointOn(ring, from)
      const end = pointOn(ring, root + half)
      const centre = pointOn(ring, root).point
      const length = reach * (TRAIL.minShare + (1 - TRAIL.minShare) * random(2))
      const turn = ((random(3) - 0.5) * 2 * TRAIL.turn * Math.PI) / 180
      const tip = {
        x: centre.x + length * (wx * Math.cos(turn) - wy * Math.sin(turn)),
        y: centre.y + length * (wx * Math.sin(turn) + wy * Math.cos(turn)),
      }
      const shoulder = (p: Point) => ({
        x: centre.x + TRAIL.shoulder * (tip.x - centre.x) + TRAIL.neck * (p.x - centre.x),
        y: centre.y + TRAIL.shoulder * (tip.y - centre.y) + TRAIL.neck * (p.y - centre.y),
      })
      const points = [base.point, shoulder(base.point), tip, shoulder(end.point), end.point]
      if (!clearOf(points, ring, segments, sides, host.contour, root, half, base, end, clearance)) continue
      trails.push({ contour: host.contour, root, from, half, first: base.edge, last: end.edge, points })
      sides.push(...points.slice(1).map((p, i): [Point, Point] => [points[i], p]))
      break
    }
  }
  if (trails.length === 0) return { polygon, count: 0 }

  const result = polygon.contours.map((contour, index) => {
    const mine = trails.filter((t) => t.contour === index).sort((s, t) => s.from - t.from)
    if (mine.length === 0) return contour
    const n = contour.points.length
    const gone = new Uint8Array(n)
    for (const t of mine) for (let v = (t.first + 1) % n, stop = (t.last + 1) % n; t.first !== t.last && v !== stop; v = (v + 1) % n) gone[v] = 1
    const points: Point[] = []
    contour.points.forEach((p, i) => {
      if (!gone[i]) points.push(p)
      for (const t of mine) if (t.first === i) points.push(...t.points)
    })
    // A base end that falls exactly on a vertex would repeat it.
    const distinct = points.filter((p, i) => {
      const q = points[(i + 1) % points.length]
      return p.x !== q.x || p.y !== q.y
    })
    return { points: distinct, clockwise: signedArea(distinct) < 0 }
  })
  return { polygon: { ...polygon, contours: result }, count: trails.length }
}

/**
 * True when a trail (its points from one end of the base to the other) keeps clear of the letter and of the trails
 * so far. Its base replaces the outline from `base` to `end`. The edges of its own contour near the base meet it
 * there (what is left of the edges holding the base's ends included), so they must only not cross it, and its
 * shoulders and tip keep the clearance from them; every other edge keeps the clearance from all of it.
 */
function clearOf(
  points: readonly Point[],
  ring: Ring,
  segments: readonly { contour: number; edge: number; a: Point; b: Point }[],
  sides: readonly [Point, Point][],
  contour: number,
  root: number,
  half: number,
  base: { point: Point; edge: number },
  end: { point: Point; edge: number },
  clearance: number,
): boolean {
  const n = ring.points.length
  const perimeter = ring.at[n]
  const edges = points.slice(1).map((p, i): [Point, Point] => [points[i], p])
  const middle = points.slice(1, -1)
  const cyclic = (d: number) => {
    const g = ((d % perimeter) + perimeter) % perimeter
    return Math.min(g, perimeter - g)
  }
  const window = half + 3 * clearance
  const near = (edge: number) => (root >= ring.at[edge] && root <= ring.at[edge + 1]) || Math.min(cyclic(ring.at[edge] - root), cyclic(ring.at[edge + 1] - root)) <= window
  // Edges wholly inside the base go.
  const inner = (edge: number) => base.edge !== end.edge && ((edge - base.edge + n) % n) > 0 && ((edge - base.edge + n) % n) < ((end.edge - base.edge + n) % n)
  // The trail's box, grown by the clearance: segments outside it are clear without measuring.
  const minX = Math.min(...points.map((p) => p.x)) - clearance
  const minY = Math.min(...points.map((p) => p.y)) - clearance
  const maxX = Math.max(...points.map((p) => p.x)) + clearance
  const maxY = Math.max(...points.map((p) => p.y)) + clearance
  const apart = (a: Point, b: Point) => Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY
  const meets = (a: Point, b: Point) => edges.every(([p, q]) => !crosses(p, q, a, b)) && middle.every((p) => distanceToSegment(p, a, b) > clearance)
  const keepsClear = (a: Point, b: Point) => edges.every(([p, q]) => segmentGap(p, q, a, b) > clearance)
  for (const s of segments) {
    if (apart(s.a, s.b)) continue
    if (s.contour !== contour || !near(s.edge)) {
      if (!keepsClear(s.a, s.b)) return false
      continue
    }
    if (inner(s.edge)) continue
    const parts: [Point, Point][] =
      s.edge === base.edge && s.edge === end.edge
        ? [[s.a, base.point], [end.point, s.b]]
        : s.edge === base.edge
          ? [[s.a, base.point]]
          : s.edge === end.edge
            ? [[end.point, s.b]]
            : [[s.a, s.b]]
    if (!parts.every(([a, b]) => meets(a, b))) return false
  }
  return sides.every(([a, b]) => apart(a, b) || keepsClear(a, b))
}

/** The point at a distance along a ring (wrapping round), and the edge it lies on. */
function pointOn(ring: Ring, distance: number): { point: Point; edge: number } {
  const n = ring.points.length
  const perimeter = ring.at[n]
  const d = ((distance % perimeter) + perimeter) % perimeter
  // The last vertex whose distance is at most d.
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ring.at[mid] <= d) lo = mid
    else hi = mid - 1
  }
  const length = ring.at[lo + 1] - ring.at[lo]
  const point = length > 0 ? lerp(ring.points[lo], ring.points[(lo + 1) % n], (d - ring.at[lo]) / length) : ring.points[lo]
  return { point, edge: lo }
}

/** Long, thin wedges cut into the letter along the stream (see the header), merging the outline with `merge`. */
function addCuts(
  polygon: PolygonGlyph,
  params: SlipstreamParams,
  seed: number,
  unitsPerEm: number,
  merge: (glyph: PolygonGlyph, rule: FillRule) => { polygon: PolygonGlyph; stats: OverlapStats },
): { polygon: PolygonGlyph; count: number; merge: OverlapStats | null } {
  const wanted = count(params.cuts, SLIPSTREAM_LIMITS.maxCuts)
  if (wanted === 0) return { polygon, count: 0, merge: null }
  // Redrawn by the nonzero rule: the ink winds once (outer contours counter-clockwise, holes clockwise).
  const clean = merge(polygon, 'nonzero')
  // Too complex to merge: the glyph as the budget simplified it for its last try (see GlyphBudget.merge).
  if (!clean.stats.applied) return { polygon: clean.polygon, count: 0, merge: clean.stats.failed || clean.stats.tooComplex ? clean.stats : null }
  const { wx, wy } = streamOf(params)
  const glyph = clean.polygon.ref.index | 0
  const contours = clean.polygon.contours.map((c) => c.points)
  let low = Infinity
  let high = -Infinity
  for (const points of contours) {
    for (const p of points) {
      const v = p.y * wx - p.x * wy
      low = Math.min(low, v)
      high = Math.max(high, v)
    }
  }
  if (!(high > low)) return { polygon: clean.polygon, count: 0, merge: clean.stats }

  const wedges: Point[][] = []
  for (let k = 0; k < wanted; k++) {
    for (let attempt = 0; attempt < CUT.attempts; attempt++) {
      const random = (field: number) => hashInts(seed, CHANNEL.cut, glyph, k, attempt, field) / UINT
      // Spread out across the stream like the trails; then which side it enters from.
      const v = low + (high - low) * (CUT.margin + (1 - 2 * CUT.margin) * ((k + random(0)) / wanted))
      const way = random(1) < 0.5 ? 1 : -1
      // Strokes on the cut's line, as distances along the cut (s = way × u), in the order the cut meets them.
      const strokes = inkAlong(contours, v, wx, wy)
        .map(([a, b]) => (way > 0 ? [a, b] : [-b, -a]))
        .sort((x, y) => x[0] - y[0])
      if (strokes.length === 0) continue
      const start = strokes[0][0] - CUT.lead * unitsPerEm
      let tip: number
      if (random(2) < CUT.through) {
        const far = strokes[strokes.length - 1][1]
        tip = far + CUT.overrun * (far - strokes[0][0]) + CUT.past * unitsPerEm
      } else {
        const [near, far] = strokes[strokes.length > 1 && random(3) < CUT.second ? 1 : 0]
        tip = near + (CUT.minDepth + (CUT.maxDepth - CUT.minDepth) * random(4)) * (far - near)
      }
      const taper = CUT.minTaper + (CUT.maxTaper - CUT.minTaper) * random(5)
      const half = clamp((tip - start) * taper, CUT.minHalf * unitsPerEm, CUT.maxHalf * unitsPerEm)
      // Back to the plane: u along the stream, v across it.
      const plane = (s: number, across: number): Point => {
        const u = way * s
        return { x: u * wx - across * wy, y: u * wy + across * wx }
      }
      const wedge = [plane(start, v + half), plane(tip, v), plane(start, v - half)]
      // Clockwise, against the ink: inside the wedge the winding drops to zero or below.
      if (signedArea(wedge) > 0) wedge.reverse()
      wedges.push(wedge)
      break
    }
  }
  if (wedges.length === 0) return { polygon: clean.polygon, count: 0, merge: clean.stats }
  const contoursWithCuts = [...clean.polygon.contours, ...wedges.map((points) => ({ points, clockwise: true }))]
  const cut = merge({ ...clean.polygon, contours: contoursWithCuts }, 'positive')
  // Without the cuts, the redrawn outline stays; why the cut merge did not apply goes along.
  if (!cut.stats.applied) return { polygon: clean.polygon, count: 0, merge: { ...clean.stats, failed: cut.stats.failed, tooComplex: cut.stats.tooComplex } }
  return {
    polygon: cut.polygon,
    count: wedges.length,
    merge: {
      applied: true,
      crossings: clean.stats.crossings + cut.stats.crossings,
      contoursIn: clean.stats.contoursIn,
      contoursOut: cut.stats.contoursOut,
      removed: clean.stats.removed + cut.stats.removed,
      failed: false,
      tooComplex: false,
    },
  }
}

/** Where the line at v across the stream runs through ink, as intervals along it (u), for contours that do not cross. */
function inkAlong(contours: readonly (readonly Point[])[], v: number, wx: number, wy: number): [number, number][] {
  const us: number[] = []
  for (const points of contours) {
    const n = points.length
    for (let i = 0; i < n; i++) {
      const a = points[i]
      const b = points[(i + 1) % n]
      const va = a.y * wx - a.x * wy
      const vb = b.y * wx - b.x * wy
      if (va <= v === vb <= v) continue
      const p = lerp(a, b, (v - va) / (vb - va))
      us.push(p.x * wx + p.y * wy)
    }
  }
  us.sort((x, y) => x - y)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < us.length; i += 2) if (us[i + 1] > us[i]) out.push([us[i], us[i + 1]])
  return out
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

/** The unit vector the stream flows along. */
function streamOf(params: SlipstreamParams): { wx: number; wy: number } {
  const angle = (finite(params.direction, 0) * Math.PI) / 180
  return { wx: Math.cos(angle), wy: Math.sin(angle) }
}

/** True when the contour's first anchor lies inside an even number of the other contours (it bounds ink from outside). */
function isOutside(contours: readonly (readonly Point[])[], contour: number): boolean {
  const p = contours[contour][0]
  let depth = 0
  contours.forEach((other, i) => {
    if (i !== contour && other.length >= 3 && insideRing(p, other)) depth++
  })
  return depth % 2 === 0
}

/** The shortest distance between segments a1–a2 and b1–b2 (0 when they cross). */
function segmentGap(a1: Point, a2: Point, b1: Point, b2: Point): number {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = side(a1, a2, b1)
  const d2 = side(a1, a2, b2)
  const d3 = side(b1, b2, a1)
  const d4 = side(b1, b2, a2)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(distanceToSegment(b1, a1, a2), distanceToSegment(b2, a1, a2), distanceToSegment(a1, b1, b2), distanceToSegment(a2, b1, b2))
}

/** True when segments a1–a2 and b1–b2 cross at a point inside both. */
function crosses(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return side(a1, a2, b1) * side(a1, a2, b2) < 0 && side(b1, b2, a1) * side(b1, b2, a2) < 0
}

/** A whole count from 0 to max (0 when missing, as in older saved settings). */
function count(value: number, max: number): number {
  return Math.round(clamp(finite(value, 0), 0, max))
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}
