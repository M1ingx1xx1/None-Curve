// Self-crossing tests for closed polygons. Every geometry step checks that it did not make a contour
// cross itself, often several times per contour (retries, simplified copies), and contours can have
// thousands of points (Anchor spacing 1), so the search sweeps segments sorted by x and compares
// only pairs whose boxes overlap, and stops as soon as the answer is known.

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

const within = (a: Point, b: Point, p: Point) =>
  Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)

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
