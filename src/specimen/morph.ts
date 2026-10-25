// Glide's in-between shapes: pairs the anchors of a glyph's outline as shown with those of its new outline, then moves
// each pair along its trajectory (trajectory.ts). Pure: no React, no DOM. The work is done once per new outline
// (planMorph); each animation frame only moves the pairs (morphAt).
//
// Pairing happens where both outlines are most alike: for an effect that knows its own move (Whorl, which turns each
// ring), with that move undone on both sides (Trajectory.straighten); otherwise as they are.
//
// Outlines whose contours cross are paired as the outline of what they fill (overlaps.ts), except on Whorl's path. Many fonts draw a letter as
// overlapping pieces, so a counter is a gap between pieces, not a hole; an effect that merges the letter (Burst) gives
// it a real hole, which would find no partner and grow from its centre while the pieces sank, filling the counter on
// the way. Only the pairing uses the merged outline: the glide still starts and ends on the glyphs themselves.
//
// Contours: each contour of the old outline is paired with one of the new, of the same direction (outlines with
// outlines, holes with holes), the closest pairs first: by the distance between their centres for their size, and how
// alike their areas are. With many contours (Dissolve's islands), each is weighed only against its few nearest. A
// contour left without a partner grows from its centre (a new one) or shrinks to it (one that goes).
//
// Anchors of a paired contour: both outlines get the anchors of both, so their counts never need to agree. First the
// best turn: the share of the way round (arc length) where the new contour starts is chosen so the two, centred, lie
// closest (the least total squared distance over evenly spread samples, a coarse search then a finer one). Then:
// - With as many anchors on both, close to one another in turn (within MORPH_LIMITS.directShare of the contour's size),
//   anchor goes to anchor: the plain case of anchors moving (Distortion, Random anchors, Squaring...).
// - Otherwise each anchor of either contour is placed on the other where it belongs, by the trajectory's
//   correspondence: 'nearest' (the closest point near where arc length puts it, kept in order round the contour), so a
//   new spike grows straight out of its base and a vanishing one sinks back into it; or 'arc' (where arc length puts
//   it), for a future effect whose outlines slide round as a whole.
// Every anchor added this way lies on the other outline's sides, so the shape at the start is exactly the old outline
// and at the end exactly the new one (and morphAt returns the outlines themselves there). Only anchors move; every side
// stays a straight line; nothing is resampled into small steps. A glyph that would need more than MORPH_LIMITS.maxPoints
// anchors is not planned (it changes at once).
//
// A new outline can arrive while the last one is still on its way: the glide goes on from the in-between shape. That
// shape carries the anchors both outlines brought; the ones only the old outline had are dropped wherever they lie
// within MORPH_LIMITS.settleShare of an em of the shape without them (settleInBetween), so a long run of quick changes
// does not pile up anchors.

import { findRingCrossings, findSelfCrossings, ringBox } from '../geometry/crossings'
import { mergeOverlaps } from '../geometry/overlaps'
import type { GlyphMotion, Point, PolygonContour, PolygonGlyph } from '../geometry/types'
import { PLAN_DATA_VERSION, type PlanData, type TrackData } from './planData'
import { meshGlideFrom, planWhorlMesh, preparedFor, type MeshGlide, type MeshPose, type Prepared } from './whorlGlide'
import {
  chooseTrajectory,
  STRAIGHT,
  TRAJECTORY_MODELS,
  WHORL_MODEL,
  whorlTrackPath,
  type Correspondence,
  type TrackPath,
  type TrajectoryModel,
} from './trajectory'

export const MORPH_LIMITS = {
  /** Anchors of an in-between glyph at most; a glyph that would need more changes at once. */
  maxPoints: 12_000,
  /** Samples round a contour weighed for the best turn, and the turns tried before the finer search (fewer on small contours). */
  shiftSamples: 32,
  shiftSteps: 64,
  /** Anchor goes to anchor while none moves further than this share of the contour's size (half its box's diagonal). */
  directShare: 0.35,
  /** With more contours than this on either side, each contour is weighed against its `neighbours` nearest only. */
  manyContours: 48,
  neighbours: 4,
  /** Contours further apart than this many times their sizes added up, or with areas further apart than this ratio, are never paired. */
  reach: 0.5,
  areaRatio: 4,
  /** Paired contours whose centres lie closer than this share of the smaller's size are matched as they lie, not centred. */
  centreShare: 0.5,
  /**
   * A contour without a partner grows out of (or sinks into) the other outline, each anchor from (or to) its closest
   * point there, when those lie within this share of its size on average; otherwise out of (or into) its centre.
   */
  attachShare: 1,
  /** In-between anchors only the old outline had are dropped within this share of an em (settleInBetween)... */
  settleShare: 0.004,
  /** ...or, while they outnumber the next outline's anchors, within up to this share. */
  settleMaxShare: 0.05,
} as const

interface Ring {
  xs: Float64Array
  ys: Float64Array
  /** u[i]: the share of the way round at anchor i; u[n] = 1. */
  u: Float64Array
  n: number
  length: number
  cx: number
  cy: number
  area: number
  /** Half the diagonal of the contour's box, and the box. */
  size: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Which way it winds: by its area, or by its flag when it has none. */
  clockwise: boolean
  contour: PolygonContour
}

function ringOf(contour: PolygonContour): Ring {
  const pts = contour.points
  const n = pts.length
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const u = new Float64Array(n + 1)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i].x
    ys[i] = pts[i].y
    minX = Math.min(minX, xs[i])
    maxX = Math.max(maxX, xs[i])
    minY = Math.min(minY, ys[i])
    maxY = Math.max(maxY, ys[i])
  }
  let length = 0
  let twice = 0
  let ax = 0
  let ay = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    length += Math.hypot(xs[j] - xs[i], ys[j] - ys[i])
    u[i + 1] = length
    const cross = xs[i] * ys[j] - xs[j] * ys[i]
    twice += cross
    ax += (xs[i] + xs[j]) * cross
    ay += (ys[i] + ys[j]) * cross
  }
  if (length > 0) for (let i = 0; i <= n; i++) u[i] /= length
  u[n] = 1
  let cx: number
  let cy: number
  if (Math.abs(twice) > 1e-9 * Math.max(1, (maxX - minX) * (maxY - minY))) {
    cx = ax / (3 * twice)
    cy = ay / (3 * twice)
  } else {
    cx = n > 0 ? xs.reduce((s, x) => s + x, 0) / n : 0
    cy = n > 0 ? ys.reduce((s, y) => s + y, 0) / n : 0
  }
  const size = n > 0 ? Math.hypot(maxX - minX, maxY - minY) / 2 : 0
  const flat = Math.abs(twice) <= 1e-9 * Math.max(1, (maxX - minX) * (maxY - minY))
  const clockwise = flat ? contour.clockwise : twice < 0
  return { xs, ys, u, n, length, cx, cy, area: twice / 2, size, minX, minY, maxX, maxY, clockwise, contour }
}

/** The point the share `t` of the way round `r` (any real; whole turns wrap), into `out`. */
function pointAt(r: Ring, t: number, out: { x: number; y: number }) {
  let f = t - Math.floor(t)
  if (f >= 1) f = 0
  const { u, n } = r
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (u[mid] <= f) lo = mid
    else hi = mid - 1
  }
  const j = lo + 1 < n ? lo + 1 : 0
  const span = u[lo + 1] - u[lo]
  const w = span > 0 ? (f - u[lo]) / span : 0
  out.x = r.xs[lo] + (r.xs[j] - r.xs[lo]) * w
  out.y = r.ys[lo] + (r.ys[j] - r.ys[lo]) * w
}

/** The side of `r` that the share `t` (in [0, 1)) of the way round falls on. */
function sideAt(r: Ring, t: number): number {
  let lo = 0
  let hi = r.n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (r.u[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Where on `b` the start of `a` lies best: the share s of the way round `b` such that a(t) and b(t + s) lie closest over
 * the whole contour: as they are while the two overlap (their centres closer than MORPH_LIMITS.centreShare of the
 * smaller's size), so that a spike or a cut that shifts a contour's centre does not shift the match; otherwise each
 * taken from its centre (a contour that moved as a whole, such as one of Dissolve's islands).
 */
function bestShift(a: Ring, b: Ring): number {
  const centred = Math.hypot(a.cx - b.cx, a.cy - b.cy) > MORPH_LIMITS.centreShare * Math.min(a.size, b.size)
  const acx = centred ? a.cx : 0
  const acy = centred ? a.cy : 0
  const bcx = centred ? b.cx : 0
  const bcy = centred ? b.cy : 0
  // Small contours (Dissolve's islands) need fewer samples and turns: about two per anchor.
  const anchors = Math.max(a.n, b.n)
  const k = Math.min(MORPH_LIMITS.shiftSamples, Math.max(8, anchors))
  const ax = new Float64Array(k)
  const ay = new Float64Array(k)
  const p = { x: 0, y: 0 }
  for (let i = 0; i < k; i++) {
    pointAt(a, i / k, p)
    ax[i] = p.x - acx
    ay[i] = p.y - acy
  }
  const cost = (s: number) => {
    let sum = 0
    for (let i = 0; i < k; i++) {
      pointAt(b, i / k + s, p)
      const dx = p.x - bcx - ax[i]
      const dy = p.y - bcy - ay[i]
      sum += dx * dx + dy * dy
    }
    return sum
  }
  const steps = Math.min(MORPH_LIMITS.shiftSteps, Math.max(16, 2 * anchors))
  let best = 0
  let bestCost = cost(0)
  for (let i = 1; i < steps; i++) {
    const c = cost(i / steps)
    if (c < bestCost) {
      bestCost = c
      best = i / steps
    }
  }
  for (let step = 1 / (2 * steps); step > 1 / (64 * steps); step /= 2) {
    for (const s of [best - step, best + step]) {
      const c = cost(s)
      if (c < bestCost) {
        bestCost = c
        best = s
      }
    }
  }
  return best - Math.floor(best)
}

/**
 * Where the points (xs, ys), in order round their own contour (`shares` of the way round it, from 0 up to 1), belong on
 * `r`, kept in order round it from `start` to `start` + 1: each at its closest point of `r`, as long as those follow one
 * another round `r` (the longest run of them that does); the rest are spread between their neighbours in that run by
 * their own shares. So features only one contour has (a spike, a notch) are skipped over rather than dragging their
 * neighbours along, and no stretch of either contour gathers into one point unless it lies there.
 */
function inOrder(r: Ring, xs: Float64Array, ys: Float64Array, shares: Float64Array, start: number): Float64Array {
  const n = shares.length
  const out = { d: 0 }
  const at = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let v = closestOn(r, xs[k], ys[k], out) + Math.floor(start)
    if (v < start) v += 1
    if (v >= start + 1) v -= 1
    at[k] = v
  }
  // The longest run that keeps its order (patience sorting, non-decreasing).
  const tails: number[] = []
  const previous = new Int32Array(n).fill(-1)
  for (let k = 0; k < n; k++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (at[tails[mid]] <= at[k]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) previous[k] = tails[lo - 1]
    tails[lo] = k
  }
  const inRun = new Uint8Array(n)
  for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = previous[k]) inRun[k] = 1
  const result = new Float64Array(n)
  // Between the run's points (and the ends: share 0 at `start`, share 1 at `start` + 1), by share.
  let lastShare = 0
  let lastV = start
  let k = 0
  while (k < n) {
    let next = k
    while (next < n && !inRun[next]) next++
    const nextShare = next < n ? shares[next] : 1
    const nextV = next < n ? at[next] : start + 1
    for (let m = k; m < next; m++) {
      const w = nextShare > lastShare ? (shares[m] - lastShare) / (nextShare - lastShare) : 0
      result[m] = lastV + (nextV - lastV) * Math.min(1, Math.max(0, w))
    }
    if (next < n) {
      result[next] = nextV
      lastShare = nextShare
      lastV = nextV
    }
    k = next + 1
  }
  return result
}

/** A contour's anchors on their way: from (sx, sy) to (tx, ty). `kept[i]`: the anchor is one of the new outline's. */
interface Track {
  clockwise: boolean
  sx: Float64Array
  sy: Float64Array
  tx: Float64Array
  ty: Float64Array
  kept: Uint8Array
  /** base[i]: the anchor's base is its end (Trajectory.path). */
  base: Uint8Array
  /** Null: the contour does not change (`still` is drawn as it is). */
  path: TrackPath | null
  still: PolygonContour | null
}

export interface MorphPlan {
  from: PolygonGlyph
  to: PolygonGlyph
  /** Which trajectory the anchors follow ('straight', 'whorl'...). */
  trajectory: string
  tracks: Track[]
  /** Anchors of the in-between glyph. */
  points: number
  /** Scratch the tracks write their anchors into, frame by frame (as long as the longest track). */
  xs: Float64Array
  ys: Float64Array
  /** Whorl on its own, glided by its mesh (whorlGlide.ts) instead of by tracks. */
  mesh?: MeshGlide
  /** The plan as data (planData.ts): the tracks and mesh run on it; planMorph and planFromData always set it. */
  data?: PlanData
}

/** Pairs listed as plain arrays while they are built. */
class Pairs {
  sx: number[] = []
  sy: number[] = []
  tx: number[] = []
  ty: number[] = []
  kept: number[] = []
  base: number[] = []
  /** `atEnd`: the anchor's base is its end (see Trajectory.path). */
  push(sx: number, sy: number, tx: number, ty: number, kept: boolean, atEnd: boolean) {
    const n = this.sx.length
    // The same pair twice in a row (an anchor both outlines share) is drawn once.
    if (n > 0 && this.sx[n - 1] === sx && this.sy[n - 1] === sy && this.tx[n - 1] === tx && this.ty[n - 1] === ty) {
      if (kept) this.kept[n - 1] = 1
      return
    }
    this.sx.push(sx)
    this.sy.push(sy)
    this.tx.push(tx)
    this.ty.push(ty)
    this.kept.push(kept ? 1 : 0)
    this.base.push(atEnd ? 1 : 0)
  }
  track(clockwise: boolean): Omit<Track, 'path' | 'still'> {
    return {
      clockwise,
      sx: Float64Array.from(this.sx),
      sy: Float64Array.from(this.sy),
      tx: Float64Array.from(this.tx),
      ty: Float64Array.from(this.ty),
      kept: Uint8Array.from(this.kept),
      base: Uint8Array.from(this.base),
    }
  }
}

function sameContour(a: PolygonContour, b: PolygonContour): boolean {
  if (a === b) return true
  if (a.points.length !== b.points.length || a.clockwise !== b.clockwise) return false
  for (let i = 0; i < a.points.length; i++)
    if (a.points[i].x !== b.points[i].x || a.points[i].y !== b.points[i].y) return false
  return true
}

/**
 * The point the share `t` of the way round `flat` puts on `ring` (into `out`): the same side, the same share along it.
 * `flat` is `ring` in the space the anchors are paired in (Trajectory.straighten), with the same anchors.
 */
function pointOn(ring: Ring, flat: Ring, t: number, out: { x: number; y: number }) {
  if (ring === flat) return pointAt(ring, t, out)
  let f = t - Math.floor(t)
  if (f >= 1) f = 0
  const e = sideAt(flat, f)
  const j = e + 1 < ring.n ? e + 1 : 0
  const span = flat.u[e + 1] - flat.u[e]
  const w = span > 0 ? (f - flat.u[e]) / span : 0
  out.x = ring.xs[e] + (ring.xs[j] - ring.xs[e]) * w
  out.y = ring.ys[e] + (ring.ys[j] - ring.ys[e]) * w
}

/**
 * Anchor to anchor, when both have as many and none moves far (see the top of the file). `a2` and `b2` are the
 * contours in the space they are paired in; the pairs are made of the anchors of `a` and `b`.
 */
function directPairs(a: Ring, b: Ring, a2: Ring, b2: Ring): Pairs | null {
  if (a.n !== b.n) return null
  const limit = MORPH_LIMITS.directShare * Math.max(a2.size, b2.size)
  const limit2 = limit * limit
  /** The summed squared moves with this shift, or Infinity when one goes further than the limit. */
  const tries = (shift: number) => {
    let sum = 0
    for (let i = 0; i < a.n; i++) {
      const j = (i + shift) % b.n
      const dx = b2.xs[j] - a2.xs[i]
      const dy = b2.ys[j] - a2.ys[i]
      const d = dx * dx + dy * dy
      if (d > limit2) return Infinity
      sum += d
    }
    return sum
  }
  // The same start, or the anchor of `b` nearest the start of `a`.
  let nearest = 0
  let nearestD = Infinity
  for (let j = 0; j < b.n; j++) {
    const d = (b2.xs[j] - a2.xs[0]) ** 2 + (b2.ys[j] - a2.ys[0]) ** 2
    if (d < nearestD) {
      nearestD = d
      nearest = j
    }
  }
  // Whichever of the two moves the anchors least (a contour whose start moved by a few anchors keeps its place).
  const same = tries(0)
  const near = nearest !== 0 ? tries(nearest) : Infinity
  if (same === Infinity && near === Infinity) return null
  const shift = near < same ? nearest : 0
  const pairs = new Pairs()
  for (let i = 0; i < a.n; i++) {
    const j = (i + shift) % b.n
    pairs.push(a.xs[i], a.ys[i], b.xs[j], b.ys[j], true, false)
  }
  return pairs
}

/**
 * Both contours' anchors on both, paired by `correspondence` (see the top of the file) in the space of `a2` and `b2`
 * (the contours as Trajectory.straighten gives them: `a` and `b` themselves without it).
 */
function unionPairs(a: Ring, b: Ring, a2: Ring, b2: Ring, correspondence: Correspondence): Pairs {
  const nearest = correspondence === 'nearest'
  const out = { d: 0 }
  // Where the start of the old contour lies on the new one: its closest point, or by the best turn.
  const s0 = nearest ? closestOn(b2, a2.xs[0], a2.ys[0], out) : bestShift(a2, b2)
  const s = s0 - Math.floor(s0)
  type Item = { u: number; v: number; fromA: boolean; i: number }
  const items: Item[] = []
  // The old outline's anchors: where they go on the new one, between s and s + 1 round it, in order.
  const onB = nearest ? inOrder(b2, a2.xs, a2.ys, a2.u.subarray(0, a.n), s) : null
  for (let i = 0; i < a.n; i++) items.push({ u: a2.u[i], v: onB ? onB[i] : a2.u[i] + s, fromA: true, i })
  // The new outline's anchors, in order round it from s: where they come from on the old one, in order too.
  const first = sideAt(b2, s) + (b2.u[sideAt(b2, s)] < s ? 1 : 0)
  const order = new Int32Array(b.n)
  const vs = new Float64Array(b.n)
  const qx = new Float64Array(b.n)
  const qy = new Float64Array(b.n)
  for (let k = 0; k < b.n; k++) {
    const j = (first + k) % b.n
    order[k] = j
    vs[k] = b2.u[j] < s ? b2.u[j] + 1 : b2.u[j]
    qx[k] = b2.xs[j]
    qy[k] = b2.ys[j]
  }
  const shares = vs.map((v) => v - s)
  const onA = nearest ? inOrder(a2, qx, qy, shares, 0) : null
  for (let k = 0; k < b.n; k++) items.push({ u: onA ? onA[k] : shares[k], v: vs[k], fromA: false, i: order[k] })
  items.sort((p, q) => p.u - q.u || p.v - q.v || (p.fromA === q.fromA ? 0 : p.fromA ? 1 : -1))
  // Keep the old anchors' places on the new outline in order between the new outline's own anchors.
  const n = items.length
  const lo = new Float64Array(n)
  const hi = new Float64Array(n)
  let below = s
  for (let k = 0; k < n; k++) {
    if (!items[k].fromA) below = items[k].v
    lo[k] = below
  }
  let above = s + 1
  for (let k = n - 1; k >= 0; k--) {
    if (!items[k].fromA) above = items[k].v
    hi[k] = above
  }
  let last = s
  for (let k = 0; k < n; k++) {
    const item = items[k]
    if (item.fromA) item.v = Math.max(last, Math.min(hi[k], Math.max(lo[k], item.v)))
    last = item.v
  }
  const pairs = new Pairs()
  const p = { x: 0, y: 0 }
  for (const item of items) {
    if (item.fromA) {
      pointOn(b, b2, item.v, p)
      pairs.push(a.xs[item.i], a.ys[item.i], p.x, p.y, false, true)
    } else {
      pointOn(a, a2, item.u, p)
      pairs.push(p.x, p.y, b.xs[item.i], b.ys[item.i], true, false)
    }
  }
  return pairs
}

/** Pairs each contour of `a` with one of `b` (see the top of the file); returns [index in a, index in b] pairs. */
function pairContours(a: Ring[], b: Ring[]): [number, number][] {
  const many = a.length > MORPH_LIMITS.manyContours || b.length > MORPH_LIMITS.manyContours
  const candidates: { i: number; j: number; cost: number }[] = []
  const weigh = (i: number, j: number) => {
    const p = a[i]
    const q = b[j]
    if (p.clockwise !== q.clockwise || p.n === 0 || q.n === 0) return null
    const scale = p.size + q.size
    const d = Math.hypot(p.cx - q.cx, p.cy - q.cy)
    if (d > MORPH_LIMITS.reach * scale) return null
    const ratio = Math.log(
      (Math.abs(p.area) + 1e-9 * scale * scale + 1e-12) / (Math.abs(q.area) + 1e-9 * scale * scale + 1e-12),
    )
    if (Math.abs(ratio) > Math.log(MORPH_LIMITS.areaRatio)) return null
    return (d * d) / (scale * scale || 1) + 0.25 * ratio * ratio
  }
  if (!many) {
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++) {
        const cost = weigh(i, j)
        if (cost !== null) candidates.push({ i, j, cost })
      }
  } else {
    const seen = new Set<number>()
    const near = (from: Ring[], to: Ring[], add: (x: number, y: number) => void) => {
      for (let x = 0; x < from.length; x++) {
        const order = to.map((r, y) => ({ y, d: (r.cx - from[x].cx) ** 2 + (r.cy - from[x].cy) ** 2 }))
        order.sort((p, q) => p.d - q.d)
        for (const { y } of order.slice(0, MORPH_LIMITS.neighbours)) add(x, y)
      }
    }
    const add = (i: number, j: number) => {
      const id = i * b.length + j
      if (seen.has(id)) return
      seen.add(id)
      const cost = weigh(i, j)
      if (cost !== null) candidates.push({ i, j, cost })
    }
    near(a, b, (i, j) => add(i, j))
    near(b, a, (j, i) => add(i, j))
  }
  candidates.sort((p, q) => p.cost - q.cost || p.i - q.i || p.j - q.j)
  const usedA = new Uint8Array(a.length)
  const usedB = new Uint8Array(b.length)
  const pairs: [number, number][] = []
  for (const { i, j } of candidates) {
    if (usedA[i] || usedB[j]) continue
    usedA[i] = 1
    usedB[j] = 1
    pairs.push([i, j])
  }
  return pairs
}

/** Each glyph's outline for pairing (pairingOutline), so a glyph is checked and merged once however often it glides. */
const pairingOutlines = new WeakMap<PolygonGlyph, PolygonGlyph>()

/**
 * The outline a glyph's anchors are paired on: the glyph itself, or, where its contours cross (pieces drawn overlapping,
 * or a contour looping over itself), the outline of what it fills (see the top of the file). A glyph too complex to
 * merge within MORPH_LIMITS.maxPoints is paired as it is.
 */
function pairingOutline(glyph: PolygonGlyph): PolygonGlyph {
  let outline = pairingOutlines.get(glyph)
  if (!outline) {
    outline = crosses(glyph.contours)
      ? mergeOverlaps(glyph, 'nonzero', { maxHot: MORPH_LIMITS.maxPoints }).polygon
      : glyph
    pairingOutlines.set(glyph, outline)
  }
  return outline
}

/** True when a contour crosses itself or another (contours whose boxes lie apart are not compared). */
function crosses(contours: readonly PolygonContour[]): boolean {
  for (const c of contours) if (findSelfCrossings(c.points, 0).length > 0) return true
  const boxes = contours.map((c) => ringBox(c.points))
  for (let i = 0; i < contours.length; i++) {
    for (let j = i + 1; j < contours.length; j++) {
      const p = boxes[i]
      const q = boxes[j]
      if (p.minX > q.maxX || q.minX > p.maxX || p.minY > q.maxY || q.minY > p.maxY) continue
      if (findRingCrossings(contours[i].points, contours[j].points, 0).length > 0) return true
    }
  }
  return false
}

/** The same outline wound the other way round. */
function reversed(c: PolygonContour): PolygonContour {
  return { points: c.points.slice().reverse(), clockwise: !c.clockwise }
}

/**
 * Which way a glyph's outlines wind: the way its largest contour does. A merged outline (overlaps.ts) winds the other
 * way from the font's own, so a glyph whose effects start or stop folding it turns its whole winding over.
 */
function windsClockwise(rings: Ring[]): boolean | null {
  let best: Ring | null = null
  for (const r of rings) if (r.n > 0 && (!best || Math.abs(r.area) > Math.abs(best.area))) best = r
  return best && best.area !== 0 ? best.area < 0 : null
}

/** The share of the way round `r` of its point closest to (px, py), over all its sides; its distance into `out.d`. */
function closestOn(r: Ring, px: number, py: number, out: { d: number }): number {
  let best = 0
  let bestD = Infinity
  for (let e = 0; e < r.n; e++) {
    const j = e + 1 < r.n ? e + 1 : 0
    const x0 = r.xs[e]
    const y0 = r.ys[e]
    const dx = r.xs[j] - x0
    const dy = r.ys[j] - y0
    const len2 = dx * dx + dy * dy
    let w = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0
    w = w < 0 ? 0 : w > 1 ? 1 : w
    const qx = x0 + dx * w - px
    const qy = y0 + dy * w - py
    const d = qx * qx + qy * qy
    if (d < bestD) {
      bestD = d
      best = r.u[e] + (r.u[e + 1] - r.u[e]) * w
    }
  }
  out.d = Math.sqrt(bestD)
  return best
}

/**
 * The anchors of `r` (in the space of pairing `r2`) paired with their closest points on the other outline's contours
 * (`hosts`, `hosts2` in that space), when those lie within MORPH_LIMITS.attachShare of its size on average: `entering`
 * true, `r` is a new contour that grows out of the old outline; false, an old one that sinks into the new outline.
 * Null when they lie further (it grows out of or shrinks into its centre instead).
 */
function attachPairs(r: Ring, r2: Ring, hosts: Ring[], hosts2: Ring[], entering: boolean): Pairs | null {
  if (r.n === 0) return null
  const limit = MORPH_LIMITS.attachShare * r2.size
  const out = { d: 0 }
  const host = new Int32Array(r.n).fill(-1)
  const share = new Float64Array(r.n)
  let sum = 0
  for (let k = 0; k < r.n; k++) {
    const x = r2.xs[k]
    const y = r2.ys[k]
    let best = Infinity
    for (let h = 0; h < hosts2.length; h++) {
      const c = hosts2[h]
      if (c.n < 2) continue
      // The gap to its box: none of its points lies closer than that.
      const gx = Math.max(0, c.minX - x, x - c.maxX)
      const gy = Math.max(0, c.minY - y, y - c.maxY)
      if (gx * gx + gy * gy >= best * best) continue
      const t = closestOn(c, x, y, out)
      if (out.d < best) {
        best = out.d
        host[k] = h
        share[k] = t
      }
    }
    if (host[k] < 0) return null
    sum += best
    if (sum > limit * r.n) return null
  }
  const pairs = new Pairs()
  const p = { x: 0, y: 0 }
  for (let k = 0; k < r.n; k++) {
    pointOn(hosts[host[k]], hosts2[host[k]], share[k], p)
    if (entering) pairs.push(p.x, p.y, r.xs[k], r.ys[k], true, false)
    else pairs.push(r.xs[k], r.ys[k], p.x, p.y, false, true)
  }
  return pairs
}

/**
 * Plans `from` → `to`: null when the glyph should change at once (too many anchors). The plan is built as data first
 * (planData.ts) and run from it (planFromData), so a plan sent from a worker runs the same as one made here.
 */
export function planMorph(from: PolygonGlyph, to: PolygonGlyph, models?: readonly TrajectoryModel[]): MorphPlan | null {
  // Whorl on its own glides by its mesh (whorlGlide.ts).
  if ((models ?? TRAJECTORY_MODELS).includes(WHORL_MODEL)) {
    const mesh = planWhorlMesh(from, to, poseOf(from) ?? undefined, keptAnchors.has(from))
    if (mesh) {
      if (mesh.points > MORPH_LIMITS.maxPoints) return null
      const data: PlanData = {
        version: PLAN_DATA_VERSION,
        trajectory: 'whorl-mesh',
        points: mesh.points,
        longest: mesh.points,
        whorl: null,
        mesh: mesh.data,
        tracks: [],
        settled: null,
      }
      return runPlan(data, from, to, mesh)
    }
  }
  const trajectory = chooseTrajectory(from.motion, to.motion, models)
  // Whorl pairs its own folded rings in its unturned space, so they stay as they are. A contour of a merged `to` is
  // never one of `to`'s own, so it goes as a track of its anchors, not 'still'.
  const merge = !trajectory.straighten
  const toOutline = merge ? pairingOutline(to) : to
  const a = (merge ? pairingOutline(from) : from).contours.map(ringOf)
  let b = toOutline.contours.map(ringOf)
  // The new outline wound the old one's way, so every in-between contour winds one way (see the top of the file).
  const winds = windsClockwise(a)
  const windsTo = windsClockwise(b)
  if (winds !== null && windsTo !== null && winds !== windsTo) b = toOutline.contours.map((c) => ringOf(reversed(c)))
  // The contours in the space their anchors are paired in (Whorl's turns undone), or the contours themselves; each
  // keeps its own winding.
  const { straighten } = trajectory
  const flat = (r: Ring, side: 'from' | 'to'): Ring => {
    // Each point straightened near the one before it, so a contour stays in one piece where Whorl folds.
    const points: Point[] = []
    for (const q of r.contour.points) points.push(straighten!(q.x, q.y, side, points[points.length - 1]))
    return { ...ringOf({ clockwise: r.contour.clockwise, points }), clockwise: r.clockwise }
  }
  const a2 = straighten ? a.map((r) => flat(r, 'from')) : a
  const b2 = straighten ? b.map((r) => flat(r, 'to')) : b
  const built: { pairs: Pairs | null; clockwise: boolean; still: number }[] = []
  let points = 0
  const pairs = pairContours(a2, b2)
  const pairedA = new Uint8Array(a.length)
  const partner = new Int32Array(b.length).fill(-1)
  for (const [i, j] of pairs) {
    pairedA[i] = 1
    partner[j] = i
  }
  for (let j = 0; j < b.length; j++) {
    const q = b[j]
    const i = partner[j]
    if (i >= 0) {
      const p = a[i]
      if (sameContour(p.contour, q.contour)) {
        built.push({ pairs: null, clockwise: q.contour.clockwise, still: j })
        points += q.n
        continue
      }
      if (p.length > 0 && q.length > 0) {
        const paired = directPairs(p, q, a2[i], b2[j]) ?? unionPairs(p, q, a2[i], b2[j], trajectory.correspondence)
        built.push({ pairs: paired, clockwise: q.contour.clockwise, still: -1 })
        points += paired.sx.length
        continue
      }
    }
    // A new contour grows out of the old outline it lies along, or else out of its centre.
    let grow = attachPairs(q, b2[j], a, a2, true)
    if (!grow) {
      grow = new Pairs()
      for (let k = 0; k < q.n; k++) grow.push(q.cx, q.cy, q.xs[k], q.ys[k], true, false)
    }
    built.push({ pairs: grow, clockwise: q.contour.clockwise, still: -1 })
    points += grow.sx.length
  }
  for (let i = 0; i < a.length; i++) {
    if (pairedA[i]) continue
    // A contour that goes sinks into the new outline it lies along, or else shrinks into its centre.
    const p = a[i]
    let shrink = attachPairs(p, a2[i], b, b2, false)
    if (!shrink) {
      shrink = new Pairs()
      for (let k = 0; k < p.n; k++) shrink.push(p.xs[k], p.ys[k], p.cx, p.cy, false, true)
    }
    built.push({ pairs: shrink, clockwise: p.contour.clockwise, still: -1 })
    points += shrink.sx.length
  }
  if (points > MORPH_LIMITS.maxPoints) return null
  let longest = 0
  const tracks: TrackData[] = built.map(({ pairs, clockwise, still }): TrackData => {
    if (!pairs) {
      const contour = b[still].contour
      const kept = new Uint8Array(contour.points.length).fill(1)
      if (contour === to.contours[still]) return { kind: 'still', clockwise, contour: still, kept }
      // The target's contour wound the other way (see windsClockwise): its anchors as a track that stays in place.
      const xs = Float64Array.from(contour.points, (q) => q.x)
      const ys = Float64Array.from(contour.points, (q) => q.y)
      longest = Math.max(longest, xs.length)
      return { kind: 'straight', clockwise, sx: xs, sy: ys, tx: xs, ty: ys, kept, base: new Uint8Array(xs.length) }
    }
    const t = pairs.track(clockwise)
    longest = Math.max(longest, t.sx.length)
    // Contours that grow out of or shrink into their centre go straight whatever the trajectory.
    if (isPoint(t) || !trajectory.whorl) return { kind: 'straight', ...t }
    return { kind: 'whorl', ...t, ...trajectory.whorl.arrays(t.sx, t.sy, t.tx, t.ty, t.base) }
  })
  const data: PlanData = {
    version: PLAN_DATA_VERSION,
    trajectory: trajectory.id,
    points,
    longest,
    whorl: trajectory.whorl?.params ?? null,
    mesh: null,
    tracks,
    settled: null,
  }
  return runPlan(data, from, to)
}

/** True when a track starts or ends in a single point (a contour that grows or shrinks). */
function isPoint(t: { sx: Float64Array; sy: Float64Array; tx: Float64Array; ty: Float64Array }): boolean {
  const single = (xs: Float64Array, ys: Float64Array) => xs.every((x) => x === xs[0]) && ys.every((y) => y === ys[0])
  return t.sx.length > 0 && (single(t.sx, t.sy) || single(t.tx, t.ty))
}

/**
 * The plan a plan's data describes, between `from` and `to` (the outlines it was planned between, or equal ones: a
 * plan sent from a worker runs on the page's own glyphs). With `data.settled`, `from` is the settled shape it holds.
 */
export function planFromData(data: PlanData, from: PolygonGlyph, to: PolygonGlyph): MorphPlan {
  const settled = data.settled
  if (settled) {
    const contours: PolygonContour[] = []
    let at = 0
    settled.counts.forEach((n, c) => {
      const points: Point[] = new Array(n)
      for (let i = 0; i < n; i++, at++) points[i] = { x: settled.points[2 * at], y: settled.points[2 * at + 1] }
      contours.push({ points, clockwise: settled.clockwise[c] === 1 })
    })
    from = { ...from, contours }
  }
  return runPlan(data, from, to)
}

/** The plan run from its data; `mesh` is the mesh glide when it was just made (its letter is prepared already). */
function runPlan(data: PlanData, from: PolygonGlyph, to: PolygonGlyph, mesh?: MeshGlide): MorphPlan {
  const tracks = data.tracks.map((track): Track => {
    if (track.kind === 'still') {
      const none = new Float64Array(0)
      return {
        clockwise: track.clockwise,
        sx: none,
        sy: none,
        tx: none,
        ty: none,
        kept: track.kept,
        base: new Uint8Array(0),
        path: null,
        still: to.contours[track.contour],
      }
    }
    const path =
      track.kind === 'whorl'
        ? whorlTrackPath(track, data.whorl!)
        : STRAIGHT.path(track.sx, track.sy, track.tx, track.ty)
    const { clockwise, sx, sy, tx, ty, kept, base } = track
    return { clockwise, sx, sy, tx, ty, kept, base, path, still: null }
  })
  if (!mesh && data.mesh) {
    const meshData = data.mesh
    let prepared: Prepared | null = null
    mesh = meshGlideFrom(meshData, () => {
      prepared ??= preparedFor(meshData.meshKey, from, to)
      if (!prepared) throw new Error('The outlines do not carry the mesh this glide turns by.')
      return prepared
    })
  }
  const plan: MorphPlan = {
    from,
    to,
    trajectory: data.trajectory,
    tracks,
    points: data.points,
    xs: new Float64Array(data.longest),
    ys: new Float64Array(data.longest),
    data,
  }
  if (mesh) plan.mesh = mesh
  return plan
}

/** An in-between glyph's side tables (which anchors the new outline brought, and the mesh pose), to send it by value. */
export function sideTablesOf(glyph: PolygonGlyph): { kept: Uint8Array[] | null; pose: MeshPose | null } {
  return { kept: keptAnchors.get(glyph) ?? null, pose: poseOf(glyph) }
}

/** Gives a glyph received by value its side tables back, so it settles and glides on as the one it was made from. */
export function registerSideTables(glyph: PolygonGlyph, kept: Uint8Array[] | null, pose: MeshPose | null) {
  if (kept) keptAnchors.set(glyph, kept)
  if (pose) meshPoses.set(glyph, { mesh: null, p: 0, pose })
}

/** Which in-between anchors belong to the new outline, by in-between glyph (settleInBetween). */
const keptAnchors = new WeakMap<PolygonGlyph, Uint8Array[]>()

/** Where Whorl's mesh stands in an in-between glyph of a mesh glide, for a glide that goes on from it. */
const meshPoses = new WeakMap<PolygonGlyph, PoseAt>()

/** The mesh's pose at `p`, worked out the first time a glide goes on from the glyph (most never do). */
interface PoseAt {
  mesh: MeshGlide | null
  p: number
  pose: MeshPose | null
}

function poseOf(glyph: PolygonGlyph): MeshPose | null {
  const at = meshPoses.get(glyph)
  if (!at) return null
  if (!at.pose && at.mesh) at.pose = at.mesh.pose(at.p)
  return at.pose
}

/**
 * The kept flags of a plan's in-between glyphs: the same for every p (the mesh's contours all ones, then each track's),
 * so made once per plan and shared. Nothing writes to them (settleWithin copies before it marks).
 */
const planKept = new WeakMap<MorphPlan, Uint8Array[]>()

function keptOf(plan: MorphPlan): Uint8Array[] {
  let kept = planKept.get(plan)
  if (kept) return kept
  kept = []
  if (plan.mesh) for (const { n } of plan.mesh.contours) kept.push(new Uint8Array(n).fill(1))
  for (const track of plan.tracks) kept.push(track.kept)
  planKept.set(plan, kept)
  return kept
}

/**
 * The last in-between glyph of each plan, by p: a frame drawn again at the same progress (a paused glide, a hover, a
 * pan, a hit test) gets the same glyph back instead of every anchor anew. In-between glyphs are never changed once made,
 * and they outlive the frame (a glide goes on from one; outline caches key on them), so the anchors cannot be reused
 * across different p.
 */
const lastMorph = new WeakMap<MorphPlan, { p: number; glyph: PolygonGlyph }>()

/**
 * The glyph at progress `p` (eased, 0–1) of `plan`: the old outline itself at 0, the new one itself at 1, and in
 * between a glyph like the new one with every anchor on its way.
 */
export function morphAt(plan: MorphPlan, p: number): PolygonGlyph {
  if (!(p > 0)) return plan.from
  if (p >= 1) return plan.to
  const last = lastMorph.get(plan)
  if (last && last.p === p) return last.glyph
  const { xs, ys, mesh } = plan
  const contours: PolygonContour[] = []
  if (mesh) {
    mesh.at(p, xs, ys)
    for (const { start, n, clockwise } of mesh.contours) {
      const points: Point[] = new Array(n)
      for (let i = 0; i < n; i++) points[i] = { x: xs[start + i], y: ys[start + i] }
      contours.push({ points, clockwise })
    }
  }
  for (const track of plan.tracks) {
    if (!track.path) {
      contours.push(track.still!)
      continue
    }
    const n = track.sx.length
    track.path(p, xs, ys)
    const points: Point[] = new Array(n)
    for (let i = 0; i < n; i++) points[i] = { x: xs[i], y: ys[i] }
    contours.push({ points, clockwise: track.clockwise })
  }
  const glyph: PolygonGlyph = { ...plan.to, contours }
  const motion = motionAt(plan.from.motion, plan.to.motion, p)
  if (motion) glyph.motion = motion
  else delete glyph.motion
  keptAnchors.set(glyph, keptOf(plan))
  if (mesh) meshPoses.set(glyph, { mesh, p, pose: null })
  lastMorph.set(plan, { p, glyph })
  return glyph
}

/** The effects' data in between (Whorl's centre and Amount part of the way), so a glide that goes on keeps turning. */
function motionAt(from: GlyphMotion | undefined, to: GlyphMotion | undefined, p: number): GlyphMotion | undefined {
  const a = from?.whorl
  const b = to?.whorl
  if (!a || !b) return to
  const turns = a.turns.length === b.turns.length ? b.turns.map((t, k) => lerp(a.turns[k], t, p)) : b.turns
  return {
    ...to,
    whorl: {
      ...b,
      x: lerp(a.x, b.x, p),
      y: lerp(a.y, b.y, p),
      amount: lerp(a.amount, b.amount, p),
      radius: lerp(a.radius, b.radius, p),
      turns,
    },
  }
}

const lerp = (x: number, y: number, p: number) => x + (y - x) * p

/**
 * An in-between glyph (morphAt) ready to glide on from towards `next`: the anchors only the old outline brought are
 * dropped where they lie within MORPH_LIMITS.settleShare of an em of the outline without them, and contours on their
 * way out once they are that small or that thin. While those anchors still outnumber the anchors of `next` (a run of
 * changes faster than the glides), the tolerance doubles, up to MORPH_LIMITS.settleMaxShare of an em, so anchors never
 * pile up and nothing that still clearly shows is dropped at once. Any other glyph is returned as it is.
 */
export function settleInBetween(glyph: PolygonGlyph, next?: PolygonGlyph): PolygonGlyph {
  const kept = keptAnchors.get(glyph)
  if (!kept) return glyph
  const em = glyph.metrics.unitsPerEm > 0 ? glyph.metrics.unitsPerEm : 1000
  const nextAnchors = next ? next.contours.reduce((n, c) => n + c.points.length, 0) : Infinity
  let tolerance = MORPH_LIMITS.settleShare * em
  let settled = settleWithin(glyph, kept, tolerance)
  while (settled.leaving > nextAnchors && tolerance < MORPH_LIMITS.settleMaxShare * em) {
    tolerance = Math.min(2 * tolerance, MORPH_LIMITS.settleMaxShare * em)
    settled = settleWithin(glyph, kept, tolerance)
  }
  return settled.glyph
}

/** settleInBetween at one tolerance; `leaving`: the anchors only the old outline brought that are left. */
function settleWithin(
  glyph: PolygonGlyph,
  kept: Uint8Array[],
  tolerance: number,
): { glyph: PolygonGlyph; leaving: number } {
  const contours: PolygonContour[] = []
  let changed = false
  let leaving = 0
  glyph.contours.forEach((contour, c) => {
    const flags = kept[c]
    const pts = contour.points
    if (!flags || flags.length !== pts.length) {
      contours.push(contour)
      return
    }
    let anchors = 0
    for (const f of flags) anchors += f
    if (anchors === pts.length) {
      contours.push(contour)
      return
    }
    changed = true
    if (anchors === 0) {
      // On its way out: kept while it still shows (not yet that small, nor that thin).
      const r = ringOf(contour)
      const thickness = r.length > 0 ? (2 * Math.abs(r.area)) / r.length : 0
      if (2 * r.size > 2 * tolerance && thickness > tolerance) {
        contours.push(contour)
        leaving += pts.length
      }
      return
    }
    const keep = Uint8Array.from(flags)
    const anchorsAt: number[] = []
    for (let i = 0; i < pts.length; i++) if (flags[i]) anchorsAt.push(i)
    for (let k = 0; k < anchorsAt.length; k++) {
      const from = anchorsAt[k]
      const to = k + 1 < anchorsAt.length ? anchorsAt[k + 1] : anchorsAt[0] + pts.length
      if (to - from > 1) simplifyRun(pts, from, to, tolerance, keep)
    }
    for (let i = 0; i < pts.length; i++) if (keep[i] && !flags[i]) leaving++
    contours.push({ points: pts.filter((_, i) => keep[i]), clockwise: contour.clockwise })
  })
  return { glyph: changed ? { ...glyph, contours } : glyph, leaving }
}

/** Douglas–Peucker between the kept anchors `from` and `to` (indices may run past the end: they wrap). */
function simplifyRun(pts: Point[], from: number, to: number, tolerance: number, keep: Uint8Array) {
  const n = pts.length
  const at = (i: number) => pts[i % n]
  const a = at(from)
  const b = at(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let worst = -1
  let worstD = tolerance
  for (let i = from + 1; i < to; i++) {
    const p = at(i)
    let w = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
    w = w < 0 ? 0 : w > 1 ? 1 : w
    const d = Math.hypot(a.x + dx * w - p.x, a.y + dy * w - p.y)
    if (d > worstD) {
      worstD = d
      worst = i
    }
  }
  if (worst < 0) return
  keep[worst % n] = 1
  simplifyRun(pts, from, worst, tolerance, keep)
  simplifyRun(pts, worst, to, tolerance, keep)
}
