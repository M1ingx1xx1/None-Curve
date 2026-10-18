// Glide's in-between shapes: pairs the anchors of a glyph's outline as shown with those of its new outline, then moves
// each pair along its trajectory (trajectory.ts). Pure: no React, no DOM. The work is done once per new outline
// (planMorph); each animation frame only moves the pairs (morphAt).
//
// Pairing happens where both outlines are most alike: for an effect that knows its own move (Whorl, which turns each
// ring), with that move undone on both sides (Trajectory.straighten); otherwise as they are.
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

import type { GlyphMotion, Point, PolygonContour, PolygonGlyph } from '../geometry/types'
import { chooseTrajectory, type Correspondence, type TrackPath, type TrajectoryModel } from './trajectory'

export const MORPH_LIMITS = {
  /** Anchors of an in-between glyph at most; a glyph that would need more changes at once. */
  maxPoints: 12_000,
  /** Samples round a contour weighed for the best turn, and the turns tried before the finer search (fewer on small contours). */
  shiftSamples: 32,
  shiftSteps: 64,
  /** 'nearest' looks this share of the way round either side of where arc length puts an anchor... */
  window: 0.15,
  /** ...over at most this many sides either side. */
  windowSides: 8,
  /** Anchor goes to anchor while none moves further than this share of the contour's size (half its box's diagonal). */
  directShare: 0.35,
  /** With more contours than this on either side, each contour is weighed against its `neighbours` nearest only. */
  manyContours: 48,
  neighbours: 4,
  /** Contours further apart than this many times their sizes added up are never paired. */
  reach: 1.5,
  /** In-between anchors only the old outline had are dropped within this share of an em (settleInBetween). */
  settleShare: 0.004,
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
  /** Half the diagonal of the contour's box. */
  size: number
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
  return { xs, ys, u, n, length, cx, cy, area: twice / 2, size, clockwise: contour.clockwise, contour }
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
 * Where on `b` the start of `a` lies best: the share s of the way round `b` such that a(t) and b(t + s), each taken from
 * its centre, lie closest over the whole contour.
 */
function bestShift(a: Ring, b: Ring): number {
  // Small contours (Dissolve's islands) need fewer samples and turns: about two per anchor.
  const anchors = Math.max(a.n, b.n)
  const k = Math.min(MORPH_LIMITS.shiftSamples, Math.max(8, anchors))
  const ax = new Float64Array(k)
  const ay = new Float64Array(k)
  const p = { x: 0, y: 0 }
  for (let i = 0; i < k; i++) {
    pointAt(a, i / k, p)
    ax[i] = p.x - a.cx
    ay[i] = p.y - a.cy
  }
  const cost = (s: number) => {
    let sum = 0
    for (let i = 0; i < k; i++) {
      pointAt(b, i / k + s, p)
      const dx = p.x - b.cx - ax[i]
      const dy = p.y - b.cy - ay[i]
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
 * The closest point of `r` to (px, py) among the sides near the share `guess` of the way round: its share of the way
 * round, unwrapped to lie near `guess` (so it may be below 0 or above 1).
 */
function nearestOn(r: Ring, px: number, py: number, guess: number): number {
  const base = Math.floor(guess)
  const side = sideAt(r, guess - base)
  const reach = Math.min(MORPH_LIMITS.windowSides, Math.ceil(r.n * MORPH_LIMITS.window), Math.floor((r.n - 1) / 2))
  let best = guess
  let bestD = Infinity
  for (let o = -reach; o <= reach; o++) {
    const idx = side + o
    const turns = Math.floor(idx / r.n)
    const e = idx - turns * r.n
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
    const t = base + turns + r.u[e] + (r.u[e + 1] - r.u[e]) * w
    if (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && Math.abs(t - guess) < Math.abs(best - guess))) {
      bestD = d
      best = t
    }
  }
  return best
}

/** A contour's anchors on their way: from (sx, sy) to (tx, ty). `kept[i]`: the anchor is one of the new outline's. */
interface Track {
  clockwise: boolean
  sx: Float64Array
  sy: Float64Array
  tx: Float64Array
  ty: Float64Array
  kept: Uint8Array
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
}

/** Pairs listed as plain arrays while they are built. */
class Pairs {
  sx: number[] = []
  sy: number[] = []
  tx: number[] = []
  ty: number[] = []
  kept: number[] = []
  push(sx: number, sy: number, tx: number, ty: number, kept: boolean) {
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
  }
  track(clockwise: boolean): Omit<Track, 'path' | 'still'> {
    return {
      clockwise,
      sx: Float64Array.from(this.sx),
      sy: Float64Array.from(this.sy),
      tx: Float64Array.from(this.tx),
      ty: Float64Array.from(this.ty),
      kept: Uint8Array.from(this.kept),
    }
  }
}

function sameContour(a: PolygonContour, b: PolygonContour): boolean {
  if (a === b) return true
  if (a.points.length !== b.points.length || a.clockwise !== b.clockwise) return false
  for (let i = 0; i < a.points.length; i++) if (a.points[i].x !== b.points[i].x || a.points[i].y !== b.points[i].y) return false
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
  const tries = (shift: number) => {
    for (let i = 0; i < a.n; i++) {
      const j = (i + shift) % b.n
      const dx = b2.xs[j] - a2.xs[i]
      const dy = b2.ys[j] - a2.ys[i]
      if (dx * dx + dy * dy > limit2) return false
    }
    return true
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
  const shift = tries(0) ? 0 : nearest !== 0 && tries(nearest) ? nearest : -1
  if (shift < 0) return null
  const pairs = new Pairs()
  for (let i = 0; i < a.n; i++) {
    const j = (i + shift) % b.n
    pairs.push(a.xs[i], a.ys[i], b.xs[j], b.ys[j], true)
  }
  return pairs
}

/**
 * Both contours' anchors on both, paired by `correspondence` (see the top of the file) in the space of `a2` and `b2`
 * (the contours as Trajectory.straighten gives them: `a` and `b` themselves without it).
 */
function unionPairs(a: Ring, b: Ring, a2: Ring, b2: Ring, correspondence: Correspondence): Pairs {
  const s = bestShift(a2, b2)
  const nearest = correspondence === 'nearest'
  type Item = { u: number; v: number; fromA: boolean; i: number }
  const items: Item[] = []
  // The old outline's anchors: where they go on the new one, between s and s + 1 round it.
  for (let i = 0; i < a.n; i++) {
    const guess = a2.u[i] + s
    const v = nearest ? nearestOn(b2, a2.xs[i], a2.ys[i], guess) : guess
    items.push({ u: a2.u[i], v: Math.min(s + 1, Math.max(s, v)), fromA: true, i })
  }
  // The new outline's anchors, in order round it from s: where they come from on the old one, in order too.
  const first = sideAt(b2, s) + (b2.u[sideAt(b2, s)] < s ? 1 : 0)
  let floor = 0
  for (let k = 0; k < b.n; k++) {
    const j = (first + k) % b.n
    const v = b2.u[j] < s ? b2.u[j] + 1 : b2.u[j]
    const guess = v - s
    let u = nearest ? nearestOn(a2, b2.xs[j], b2.ys[j], guess) : guess
    u = Math.min(1, Math.max(floor, u))
    floor = u
    items.push({ u, v, fromA: false, i: j })
  }
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
      pairs.push(a.xs[item.i], a.ys[item.i], p.x, p.y, false)
    } else {
      pointOn(a, a2, item.u, p)
      pairs.push(p.x, p.y, b.xs[item.i], b.ys[item.i], true)
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
    const ratio = Math.log((Math.abs(p.area) + 1e-9 * scale * scale + 1e-12) / (Math.abs(q.area) + 1e-9 * scale * scale + 1e-12))
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

/** Plans plans `from` → `to`: null when the glyph should change at once (too many anchors). */
export function planMorph(from: PolygonGlyph, to: PolygonGlyph, models?: readonly TrajectoryModel[]): MorphPlan | null {
  const trajectory = chooseTrajectory(from.motion, to.motion, models)
  const a = from.contours.map(ringOf)
  const b = to.contours.map(ringOf)
  // The contours in the space their anchors are paired in (Whorl's turns undone), or the contours themselves.
  const { straighten } = trajectory
  const flat = (contour: PolygonContour, side: 'from' | 'to') =>
    ringOf({ clockwise: contour.clockwise, points: contour.points.map((q) => straighten!(q.x, q.y, side)) })
  const a2 = straighten ? from.contours.map((c) => flat(c, 'from')) : a
  const b2 = straighten ? to.contours.map((c) => flat(c, 'to')) : b
  const built: { pairs: Pairs | null; clockwise: boolean; still: PolygonContour | null }[] = []
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
        built.push({ pairs: null, clockwise: q.clockwise, still: q.contour })
        points += q.n
        continue
      }
      if (p.length > 0 && q.length > 0) {
        const paired = directPairs(p, q, a2[i], b2[j]) ?? unionPairs(p, q, a2[i], b2[j], trajectory.correspondence)
        built.push({ pairs: paired, clockwise: q.clockwise, still: null })
        points += paired.sx.length
        continue
      }
    }
    // A new contour grows out of its centre.
    const grow = new Pairs()
    for (let k = 0; k < q.n; k++) grow.push(q.cx, q.cy, q.xs[k], q.ys[k], true)
    built.push({ pairs: grow, clockwise: q.clockwise, still: null })
    points += q.n
  }
  for (let i = 0; i < a.length; i++) {
    if (pairedA[i]) continue
    // A contour that goes shrinks into its centre.
    const p = a[i]
    const shrink = new Pairs()
    for (let k = 0; k < p.n; k++) shrink.push(p.xs[k], p.ys[k], p.cx, p.cy, false)
    built.push({ pairs: shrink, clockwise: p.clockwise, still: null })
    points += p.n
  }
  if (points > MORPH_LIMITS.maxPoints) return null
  const tracks: Track[] = built.map(({ pairs, clockwise, still }) => {
    if (!pairs) {
      const n = still!.points.length
      return { clockwise, sx: new Float64Array(0), sy: new Float64Array(0), tx: new Float64Array(0), ty: new Float64Array(0), kept: new Uint8Array(n).fill(1), path: null, still }
    }
    const t = pairs.track(clockwise)
    // Contours that grow or shrink go straight to or from their centre whatever the trajectory.
    const path = (pairs.kept.every((k) => k === 1) || pairs.kept.every((k) => k === 0)) && isPoint(t) ? straightPath(t) : chooseFor(t)
    return { ...t, path, still: null }
  })
  return { from, to, trajectory: trajectory.id, tracks, points }

  function chooseFor(t: Omit<Track, 'path' | 'still'>): TrackPath {
    return trajectory.path(t.sx, t.sy, t.tx, t.ty)
  }
}

/** True when a track starts or ends in a single point (a contour that grows or shrinks). */
function isPoint(t: Omit<Track, 'path' | 'still'>): boolean {
  const single = (xs: Float64Array, ys: Float64Array) => xs.every((x) => x === xs[0]) && ys.every((y) => y === ys[0])
  return t.sx.length > 0 && (single(t.sx, t.sy) || single(t.tx, t.ty))
}

function straightPath(t: Omit<Track, 'path' | 'still'>): TrackPath {
  const { sx, sy, tx, ty } = t
  return (p, xs, ys) => {
    for (let i = 0; i < sx.length; i++) {
      xs[i] = sx[i] + (tx[i] - sx[i]) * p
      ys[i] = sy[i] + (ty[i] - sy[i]) * p
    }
  }
}

/** Which in-between anchors belong to the new outline, by in-between glyph (settleInBetween). */
const keptAnchors = new WeakMap<PolygonGlyph, Uint8Array[]>()

/**
 * The glyph at progress `p` (eased, 0–1) of `plan`: the old outline itself at 0, the new one itself at 1, and in
 * between a glyph like the new one with every anchor on its way.
 */
export function morphAt(plan: MorphPlan, p: number): PolygonGlyph {
  if (!(p > 0)) return plan.from
  if (p >= 1) return plan.to
  const xs = new Float64Array(plan.points)
  const ys = new Float64Array(plan.points)
  const contours: PolygonContour[] = []
  const kept: Uint8Array[] = []
  for (const track of plan.tracks) {
    if (!track.path) {
      contours.push(track.still!)
      kept.push(track.kept)
      continue
    }
    const n = track.sx.length
    const tx = xs.subarray(0, n)
    const ty = ys.subarray(0, n)
    track.path(p, tx, ty)
    const points: Point[] = new Array(n)
    for (let i = 0; i < n; i++) points[i] = { x: tx[i], y: ty[i] }
    contours.push({ points, clockwise: track.clockwise })
    kept.push(track.kept)
  }
  const glyph: PolygonGlyph = { ...plan.to, contours }
  const motion = motionAt(plan.from.motion, plan.to.motion, p)
  if (motion) glyph.motion = motion
  else delete glyph.motion
  keptAnchors.set(glyph, kept)
  return glyph
}

/** The effects' data in between (Whorl's centre and Amount part of the way), so a glide that goes on keeps turning. */
function motionAt(from: GlyphMotion | undefined, to: GlyphMotion | undefined, p: number): GlyphMotion | undefined {
  const a = from?.whorl
  const b = to?.whorl
  if (!a || !b) return to
  const lerp = (x: number, y: number) => x + (y - x) * p
  const turns = a.turns.length === b.turns.length ? b.turns.map((t, k) => lerp(a.turns[k], t)) : b.turns
  return { ...to, whorl: { ...b, x: lerp(a.x, b.x), y: lerp(a.y, b.y), amount: lerp(a.amount, b.amount), radius: lerp(a.radius, b.radius), turns } }
}

/**
 * An in-between glyph (morphAt) ready to glide on from towards `next`: the anchors only the old outline brought are
 * dropped where they lie within MORPH_LIMITS.settleShare of an em of the outline without them, and contours on their
 * way out once they are that small; when they outnumber the anchors of `next`, all of them are dropped, so a run of
 * changes faster than the glides never piles anchors up. Any other glyph is returned as it is.
 */
export function settleInBetween(glyph: PolygonGlyph, next?: PolygonGlyph): PolygonGlyph {
  const kept = keptAnchors.get(glyph)
  if (!kept) return glyph
  const em = glyph.metrics.unitsPerEm > 0 ? glyph.metrics.unitsPerEm : 1000
  // More anchors on their way out than the next outline has (quick changes faster than the glides): all of them go.
  let leaving = 0
  for (const flags of kept) for (const f of flags) leaving += 1 - f
  const nextAnchors = next ? next.contours.reduce((n, c) => n + c.points.length, 0) : Infinity
  const tolerance = leaving > nextAnchors ? Infinity : MORPH_LIMITS.settleShare * em
  const contours: PolygonContour[] = []
  let changed = false
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
      // On its way out: kept while it still shows.
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const { x, y } of pts) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      if (Math.hypot(maxX - minX, maxY - minY) > 2 * tolerance) contours.push(contour)
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
    contours.push({ points: pts.filter((_, i) => keep[i]), clockwise: contour.clockwise })
  })
  return changed ? { ...glyph, contours } : glyph
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
