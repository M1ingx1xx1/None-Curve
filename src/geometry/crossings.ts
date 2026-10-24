// Crossing tests for closed polygons. Every geometry step checks that it did not make a contour cross
// itself or another contour, often several times per contour (retries, simplified copies), and
// contours can have thousands of points (Anchor spacing 1), so the search sweeps segments sorted by x
// (or along whichever direction suits them, see SegmentSweep) and compares only pairs whose boxes
// overlap, and stops as soon as the answer is known.

import type { Point } from './types'

export interface Crossing {
  /** The two crossing segments start at these points (i < j). */
  i: number
  j: number
  /** Where they meet. */
  at: Point
}

/**
 * Every pair of non-adjacent segments of the closed ring that cross or touch, with where they meet.
 * With `limit`, the search stops once more than `limit` crossings are found (which ones it found by then may vary:
 * only how many tells anything).
 */
export function findSelfCrossings(points: readonly Point[], limit = Infinity): Crossing[] {
  const n = points.length
  const found: Crossing[] = []
  if (n < 4) return found
  const sweep = new SegmentSweep(points)
  const { order, u0, u1, v0, v1 } = sweep
  const pairs: number[] = []
  search: for (let a = 0; a < n; a++) {
    const s = order[a]
    for (let b = a + 1; b < n; b++) {
      const t = order[b]
      if (u0[t] > u1[s]) break
      if (v0[t] > v1[s] || v1[t] < v0[s] || !sweep.boxesMeet(s, t)) continue
      const i = Math.min(s, t)
      const j = Math.max(s, t)
      if (j - i < 2 || (i === 0 && j === n - 1)) continue // neighbouring segments share a point
      const at = meet(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])
      if (at) {
        found.push({ i, j, at })
        if (!sweep.alongX) pairs.push(s, t)
        if (found.length > limit) break search
      }
    }
  }
  return sweep.inXOrder(found, pairs)
}

/**
 * Number of non-adjacent segment pairs of the closed ring that cross or touch. With `limit`, counting
 * stops at limit + 1 (enough to tell "more than limit").
 */
export function countSelfCrossings(points: readonly Point[], limit = Infinity): number {
  return findSelfCrossings(points, limit).length
}

/**
 * True when `after` crosses itself more often than the contour it came from. `before` gives that
 * contour's count (pass a cached function: it is only called when `after` crosses itself at all).
 */
export function addsCrossings(after: readonly Point[], before: () => number): boolean {
  if (countSelfCrossings(after, 0) === 0) return false
  const baseline = before()
  return countSelfCrossings(after, baseline) > baseline
}

/**
 * Pairs of segments, one from ring `a` and one from ring `b`, that cross or touch: `i` indexes `a`'s
 * segments and `j` `b`'s. With `limit`, the search stops once more than `limit` are found (only how many
 * tells anything then). Indexes of either ring (see RingIndex) only make it faster.
 */
export function findRingCrossings(
  a: readonly Point[],
  b: readonly Point[],
  limit = Infinity,
  indexA?: RingIndex,
  indexB?: RingIndex,
): Crossing[] {
  const found: Crossing[] = []
  const boxA = ringBox(a)
  const boxB = ringBox(b)
  // Only segments inside the overlap of the two boxes can meet.
  const minX = Math.max(boxA.minX, boxB.minX)
  const maxX = Math.min(boxA.maxX, boxB.maxX)
  const minY = Math.max(boxA.minY, boxB.minY)
  const maxY = Math.min(boxA.maxY, boxB.maxY)
  if (minX > maxX || minY > maxY) return found
  // The segments of both rings in one list, the first `inA` of them `a`'s: each one's index in its ring, and its ends.
  let inA = 0
  const index: number[] = []
  const ax: number[] = []
  const ay: number[] = []
  const bx: number[] = []
  const by: number[] = []
  for (const [r, points, lookup] of [
    [0, a, indexA],
    [1, b, indexB],
  ] as const) {
    const n = points.length
    const near = lookup?.points === points ? lookup.segmentsIn(minX, maxX, minY, maxY) : null
    for (let k = 0; k < (near ? near.length : n); k++) {
      const i = near ? near[k] : k
      const p = points[i]
      const q = points[(i + 1) % n]
      if (
        Math.max(p.x, q.x) < minX ||
        Math.min(p.x, q.x) > maxX ||
        Math.max(p.y, q.y) < minY ||
        Math.min(p.y, q.y) > maxY
      )
        continue
      index.push(i)
      ax.push(p.x)
      ay.push(p.y)
      bx.push(q.x)
      by.push(q.y)
    }
    if (r === 0) inA = index.length
  }
  const sweep = new SegmentSweep({ ax, ay, bx, by })
  const { order, u0, u1, v0, v1 } = sweep
  const pairs: number[] = []
  search: for (let u = 0; u < order.length; u++) {
    const s = order[u]
    for (let v = u + 1; v < order.length; v++) {
      const t = order[v]
      if (u0[t] > u1[s]) break
      if (t < inA === s < inA || v0[t] > v1[s] || v1[t] < v0[s] || !sweep.boxesMeet(s, t)) continue
      const [sa, sb] = s < inA ? [index[s], index[t]] : [index[t], index[s]]
      const at = meet(a[sa], a[(sa + 1) % a.length], b[sb], b[(sb + 1) % b.length])
      if (at) {
        found.push({ i: sa, j: sb, at })
        if (!sweep.alongX) pairs.push(s, t)
        if (found.length > limit) break search
      }
    }
  }
  return sweep.inXOrder(found, pairs)
}

/** Directions a sweep can run along (cos, sin): x, the rising diagonal, y, the falling diagonal. */
const SWEEPS = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
] as const

/**
 * How much wider boxes are made off the axes (font units, plus a little per unit of the coordinates for rounding the
 * turned points): more than the distance at which `meet` still counts a touch (its tests allow 1e-9, which near very
 * short segments comes to about 6e-5), so they never leave out a pair whose boxes along x and y overlap.
 */
const TURNED_SLACK = 1e-4
/** Fewer segments than this are swept along x: turning costs more than it could save. */
const TURN_FROM = 64

/** Segments by the coordinates of their ends: segment i runs from (ax[i], ay[i]) to (bx[i], by[i]). */
export interface SegmentEnds {
  ax: readonly number[]
  ay: readonly number[]
  bx: readonly number[]
  by: readonly number[]
}

/**
 * Segments ready for a sweep that compares the pairs whose boxes overlap or touch. A sweep along x compares the
 * segments whose x ranges overlap, so long edges side by side along x (a comb, the streaks Slipstream draws) would
 * compare nearly every pair: the sweep runs along y or a diagonal instead when the segments are less than half as
 * long in total that way. Off x it compares pairs in another order, so what it finds is put back in the order of a
 * sweep along x (`inXOrder`): callers that act on crossings one by one do the same as ever.
 */
export class SegmentSweep {
  /** Segments by where their boxes start along the sweep. */
  readonly order: number[]
  /** Each segment's range along the sweep (u) and across it (v). */
  readonly u0: number[]
  readonly u1: number[]
  readonly v0: number[]
  readonly v1: number[]
  readonly alongX: boolean
  private readonly x0: number[] = []
  private readonly x1: number[] = []
  private readonly y0: number[] = []
  private readonly y1: number[] = []

  /** `segments`: a closed ring's (segment i from point i to the next), or the ends of each. */
  constructor(segments: readonly Point[] | SegmentEnds) {
    const ring = Array.isArray(segments) ? (segments as readonly Point[]) : null
    const ends = ring ? null : (segments as SegmentEnds)
    const n = ring ? ring.length : ends!.ax.length
    const { x0, x1, y0, y1 } = this
    // How long the segments are in total along each direction (see SWEEPS).
    let lengthX = 0
    let lengthRising = 0
    let lengthY = 0
    let lengthFalling = 0
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1
      const xa = ring ? ring[i].x : ends!.ax[i]
      const ya = ring ? ring[i].y : ends!.ay[i]
      const xb = ring ? ring[j].x : ends!.bx[i]
      const yb = ring ? ring[j].y : ends!.by[i]
      x0.push(Math.min(xa, xb))
      x1.push(Math.max(xa, xb))
      y0.push(Math.min(ya, yb))
      y1.push(Math.max(ya, yb))
      const dx = xb - xa
      const dy = yb - ya
      lengthX += Math.abs(dx)
      lengthRising += Math.abs(dx + dy) * Math.SQRT1_2
      lengthY += Math.abs(dy)
      lengthFalling += Math.abs(dy - dx) * Math.SQRT1_2
    }
    const lengths = [lengthX, lengthRising, lengthY, lengthFalling]
    let best = 1
    for (let d = 2; d < SWEEPS.length; d++) if (lengths[d] < lengths[best]) best = d
    this.alongX = n < TURN_FROM || !(2 * lengths[best] < lengthX)
    if (this.alongX) {
      this.u0 = x0
      this.u1 = x1
      this.v0 = y0
      this.v1 = y1
    } else {
      const { ax, ay, bx, by } = ends ?? {
        ax: ring!.map((p) => p.x),
        ay: ring!.map((p) => p.y),
        bx: ring!.map((_, i) => ring![(i + 1) % n].x),
        by: ring!.map((_, i) => ring![(i + 1) % n].y),
      }
      const [c, s] = SWEEPS[best]
      let extent = 0
      for (let i = 0; i < n; i++)
        extent = Math.max(extent, Math.abs(ax[i]), Math.abs(ay[i]), Math.abs(bx[i]), Math.abs(by[i]))
      // Along y the turned coordinates are exact.
      const slack = best === 2 ? 0 : TURNED_SLACK + 1e-12 * extent
      const u0: number[] = (this.u0 = [])
      const u1: number[] = (this.u1 = [])
      const v0: number[] = (this.v0 = [])
      const v1: number[] = (this.v1 = [])
      for (let i = 0; i < n; i++) {
        const ua = ax[i] * c + ay[i] * s
        const ub = bx[i] * c + by[i] * s
        const va = ay[i] * c - ax[i] * s
        const vb = by[i] * c - bx[i] * s
        u0.push(Math.min(ua, ub) - slack)
        u1.push(Math.max(ua, ub) + slack)
        v0.push(Math.min(va, vb) - slack)
        v1.push(Math.max(va, vb) + slack)
      }
    }
    this.order = SegmentSweep.sorted(this.u0)
  }

  /** True when the boxes of segments s and t overlap or touch along x and y (always, for pairs a sweep along x compares). */
  boxesMeet(s: number, t: number): boolean {
    return (
      this.alongX ||
      !(this.x0[t] > this.x1[s] || this.x1[t] < this.x0[s] || this.y0[t] > this.y1[s] || this.y1[t] < this.y0[s])
    )
  }

  /**
   * What the sweep found, in the order a sweep along x finds it: by the first of its two segments in that sweep, then
   * the second. `pairs` holds each item's two segments.
   */
  inXOrder<T>(found: T[], pairs: readonly number[]): T[] {
    if (this.alongX || found.length < 2) return found
    const rank: number[] = []
    SegmentSweep.sorted(this.x0).forEach((s, k) => (rank[s] = k))
    const first = found.map((_, k) => Math.min(rank[pairs[2 * k]], rank[pairs[2 * k + 1]]))
    const second = found.map((_, k) => Math.max(rank[pairs[2 * k]], rank[pairs[2 * k + 1]]))
    return found
      .map((_, k) => k)
      .sort((k, m) => first[k] - first[m] || second[k] - second[m])
      .map((k) => found[k])
  }

  /**
   * Indices by `start`, ties in index order. A merge sort that compares inline: two to four times as fast as sorting
   * with a comparator, which matters for the many small rings each step checks.
   */
  private static sorted(start: readonly number[]): number[] {
    const n = start.length
    let order: number[] = []
    for (let i = 0; i < n; i++) order.push(i)
    // Runs of 8 by insertion, then merged in pairs, wider each round.
    for (let lo = 0; lo < n; lo += 8) {
      const hi = Math.min(lo + 8, n)
      for (let i = lo + 1; i < hi; i++) {
        const k = order[i]
        let j = i
        for (; j > lo && start[order[j - 1]] > start[k]; j--) order[j] = order[j - 1]
        order[j] = k
      }
    }
    let merged = order.slice()
    for (let width = 8; width < n; width *= 2) {
      for (let lo = 0; lo < n; lo += 2 * width) {
        const mid = Math.min(lo + width, n)
        const hi = Math.min(lo + 2 * width, n)
        let i = lo
        let j = mid
        let k = lo
        while (i < mid && j < hi) merged[k++] = start[order[j]] < start[order[i]] ? order[j++] : order[i++]
        while (i < mid) merged[k++] = order[i++]
        while (j < hi) merged[k++] = order[j++]
      }
      const done = merged
      merged = order
      order = done
    }
    return order
  }
}

/** True when `p` lies inside the closed ring (even-odd rule; a point on the outline may go either way). */
export function insideRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (rayCrosses(p, ring[i], ring[j])) inside = !inside
  return inside
}

/** True when the ray from p to the right crosses the edge between a and b (half-open in y). */
function rayCrosses(p: Point, a: Point, b: Point): boolean {
  return a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
}

/**
 * A ring's segments by horizontal strips, to find those near a box or a point without looking at all of them: when
 * strong effects are merged, one contour can have tens of thousands of points and thousands of others inside it.
 * Segment i runs from point i to the next. The ring must not change.
 */
export class RingIndex {
  private readonly low: number
  private readonly height: number
  private readonly strips: number
  /** The segments in strip k: segments[start[k]] up to segments[start[k + 1]]. */
  private readonly start: Int32Array
  private readonly segments: Int32Array
  private readonly seen: Int32Array
  private visits = 0

  constructor(readonly points: readonly Point[]) {
    const n = points.length
    const box = ringBox(points)
    this.strips = Math.max(1, Math.ceil(Math.sqrt(n)))
    this.low = box.minY
    this.height = (box.maxY - box.minY) / this.strips
    this.start = new Int32Array(this.strips + 1)
    for (let i = 0; i < n; i++) for (let k = this.stripOf(i, 0); k <= this.stripOf(i, 1); k++) this.start[k + 1]++
    for (let k = 0; k < this.strips; k++) this.start[k + 1] += this.start[k]
    this.segments = new Int32Array(this.start[this.strips])
    const filled = this.start.slice(0, this.strips)
    for (let i = 0; i < n; i++)
      for (let k = this.stripOf(i, 0); k <= this.stripOf(i, 1); k++) this.segments[filled[k]++] = i
    this.seen = new Int32Array(n)
  }

  /** The segments whose boxes overlap or touch the box, in index order. */
  segmentsIn(minX: number, maxX: number, minY: number, maxY: number): number[] {
    const out: number[] = []
    const box = ringBox(this.points)
    if (box.maxX < minX || box.minX > maxX || box.maxY < minY || box.minY > maxY) return out
    const visit = ++this.visits
    const n = this.points.length
    for (let k = this.strip(Math.max(minY, this.low)); k <= this.strip(Math.min(maxY, box.maxY)); k++) {
      for (let e = this.start[k]; e < this.start[k + 1]; e++) {
        const i = this.segments[e]
        if (this.seen[i] === visit) continue
        this.seen[i] = visit
        const p = this.points[i]
        const q = this.points[(i + 1) % n]
        if (
          Math.max(p.x, q.x) < minX ||
          Math.min(p.x, q.x) > maxX ||
          Math.max(p.y, q.y) < minY ||
          Math.min(p.y, q.y) > maxY
        )
          continue
        out.push(i)
      }
    }
    return out.sort((i, j) => i - j)
  }

  /** insideRing(p, points), from the segments in p's strip (the only ones a ray from p can cross). */
  contains(p: Point): boolean {
    const box = ringBox(this.points)
    if (!(p.y >= box.minY && p.y <= box.maxY)) return false
    const n = this.points.length
    const k = this.strip(p.y)
    let inside = false
    for (let e = this.start[k]; e < this.start[k + 1]; e++) {
      const i = this.segments[e]
      if (rayCrosses(p, this.points[(i + 1) % n], this.points[i])) inside = !inside
    }
    return inside
  }

  private strip(y: number): number {
    return this.height > 0 ? Math.min(this.strips - 1, Math.max(0, Math.floor((y - this.low) / this.height))) : 0
  }

  /** The strip of segment i's lower (end 0) or upper (end 1) end. */
  private stripOf(i: number, end: 0 | 1): number {
    const a = this.points[i].y
    const b = this.points[(i + 1) % this.points.length].y
    return this.strip(end === 0 ? Math.min(a, b) : Math.max(a, b))
  }
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const boxes = new WeakMap<readonly Point[], Box>()

/** Bounding box of a ring, cached per points array (rings are never modified in place). */
export function ringBox(points: readonly Point[]): Box {
  let box = boxes.get(points)
  if (!box) {
    box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const p of points) {
      if (p.x < box.minX) box.minX = p.x
      if (p.x > box.maxX) box.maxX = p.x
      if (p.y < box.minY) box.minY = p.y
      if (p.y > box.maxY) box.maxY = p.y
    }
    boxes.set(points, box)
  }
  return box
}

/** Caches a value computed on first use, such as a contour's crossing count. */
export function lazy<T>(compute: () => T): () => T {
  let done = false
  let value: T
  return () => {
    if (!done) {
      value = compute()
      done = true
    }
    return value
  }
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function orient(a: Point, b: Point, c: Point): number {
  const v = cross(a, b, c)
  return Math.abs(v) < 1e-9 ? 0 : Math.sign(v)
}

/** Slack for points that lie on a segment up to floating-point noise (font units). */
const ON_SEGMENT = 1e-9

const within = (a: Point, b: Point, p: Point) =>
  Math.min(a.x, b.x) - ON_SEGMENT <= p.x &&
  p.x <= Math.max(a.x, b.x) + ON_SEGMENT &&
  Math.min(a.y, b.y) - ON_SEGMENT <= p.y &&
  p.y <= Math.max(a.y, b.y) + ON_SEGMENT

/** Where segments a1–a2 and b1–b2 cross or touch, or null. */
function meet(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const o1 = orient(a1, a2, b1)
  const o2 = orient(a1, a2, b2)
  const o3 = orient(b1, b2, a1)
  const o4 = orient(b1, b2, a2)
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) {
    const t = cross(b1, b2, a1) / (cross(b1, b2, a1) - cross(b1, b2, a2))
    return { x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t }
  }
  if (o1 === 0 && within(a1, a2, b1)) return b1
  if (o2 === 0 && within(a1, a2, b2)) return b2
  if (o3 === 0 && within(b1, b2, a1)) return a1
  if (o4 === 0 && within(b1, b2, a2)) return a2
  return null
}
