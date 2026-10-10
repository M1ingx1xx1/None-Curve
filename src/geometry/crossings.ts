// Crossing tests for closed polygons. Every geometry step checks that it did not make a contour cross
// itself or another contour, often several times per contour (retries, simplified copies), and
// contours can have thousands of points (Anchor spacing 1), so the search sweeps segments sorted by x
// and compares only pairs whose boxes overlap, and stops as soon as the answer is known.

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
 * With `limit`, the search stops once more than `limit` crossings are found.
 */
export function findSelfCrossings(points: readonly Point[], limit = Infinity): Crossing[] {
  const n = points.length
  const found: Crossing[] = []
  if (n < 4) return found
  const x0 = new Float64Array(n)
  const x1 = new Float64Array(n)
  const y0 = new Float64Array(n)
  const y1 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    x0[i] = Math.min(a.x, b.x)
    x1[i] = Math.max(a.x, b.x)
    y0[i] = Math.min(a.y, b.y)
    y1[i] = Math.max(a.y, b.y)
  }
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  order.sort((a, b) => x0[a] - x0[b])
  for (let a = 0; a < n; a++) {
    const s = order[a]
    for (let b = a + 1; b < n; b++) {
      const t = order[b]
      if (x0[t] > x1[s]) break
      if (y0[t] > y1[s] || y1[t] < y0[s]) continue
      const i = Math.min(s, t)
      const j = Math.max(s, t)
      if (j - i < 2 || (i === 0 && j === n - 1)) continue // neighbouring segments share a point
      const at = meet(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])
      if (at) {
        found.push({ i, j, at })
        if (found.length > limit) return found
      }
    }
  }
  return found
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
 * segments and `j` `b`'s. With `limit`, the search stops once more than `limit` are found.
 */
export function findRingCrossings(a: readonly Point[], b: readonly Point[], limit = Infinity): Crossing[] {
  const found: Crossing[] = []
  const boxA = ringBox(a)
  const boxB = ringBox(b)
  // Only segments inside the overlap of the two boxes can meet.
  const minX = Math.max(boxA.minX, boxB.minX)
  const maxX = Math.min(boxA.maxX, boxB.maxX)
  const minY = Math.max(boxA.minY, boxB.minY)
  const maxY = Math.min(boxA.maxY, boxB.maxY)
  if (minX > maxX || minY > maxY) return found
  const segments: { ring: 0 | 1; i: number; x0: number; x1: number; y0: number; y1: number }[] = []
  for (const [ring, points] of [
    [0, a],
    [1, b],
  ] as const) {
    const n = points.length
    for (let i = 0; i < n; i++) {
      const p = points[i]
      const q = points[(i + 1) % n]
      const x0 = Math.min(p.x, q.x)
      const x1 = Math.max(p.x, q.x)
      const y0 = Math.min(p.y, q.y)
      const y1 = Math.max(p.y, q.y)
      if (x1 < minX || x0 > maxX || y1 < minY || y0 > maxY) continue
      segments.push({ ring, i, x0, x1, y0, y1 })
    }
  }
  segments.sort((s, t) => s.x0 - t.x0)
  for (let u = 0; u < segments.length; u++) {
    const s = segments[u]
    for (let v = u + 1; v < segments.length; v++) {
      const t = segments[v]
      if (t.x0 > s.x1) break
      if (t.ring === s.ring || t.y0 > s.y1 || t.y1 < s.y0) continue
      const [sa, sb] = s.ring === 0 ? [s, t] : [t, s]
      const at = meet(a[sa.i], a[(sa.i + 1) % a.length], b[sb.i], b[(sb.i + 1) % b.length])
      if (at) {
        found.push({ i: sa.i, j: sb.i, at })
        if (found.length > limit) return found
      }
    }
  }
  return found
}

/** True when `p` lies inside the closed ring (even-odd rule; a point on the outline may go either way). */
export function insideRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
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
