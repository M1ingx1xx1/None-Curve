// The crossing searches against a brute-force check of every pair: SegmentSweep may sweep along y or a diagonal
// instead of x (combs, Slipstream streaks), and must still find exactly what a sweep along x finds, in the same order.

import { describe, expect, it } from 'vitest'
import {
  findRingCrossings,
  findSelfCrossings,
  insideRing,
  RingIndex,
  SegmentSweep,
  type Crossing,
} from '../../src/geometry/crossings'
import type { Point } from '../../src/geometry/types'
import { seededRandom } from '../helpers/outline'

// ---- The brute-force reference: every pair, in the order a sweep along x meets them ----

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const orient = (a: Point, b: Point, c: Point) => {
  const v = cross(a, b, c)
  return Math.abs(v) < 1e-9 ? 0 : Math.sign(v)
}
const within = (a: Point, b: Point, p: Point) =>
  Math.min(a.x, b.x) - 1e-9 <= p.x &&
  p.x <= Math.max(a.x, b.x) + 1e-9 &&
  Math.min(a.y, b.y) - 1e-9 <= p.y &&
  p.y <= Math.max(a.y, b.y) + 1e-9

/** Where two segments cross or touch, as crossings.ts defines it (the same tolerances), or null. */
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

interface Segment {
  a: Point
  b: Point
  /** The ring (0 or 1) and the segment's index in it. */
  ring: number
  i: number
}

const segmentsOf = (points: readonly Point[], ring: number): Segment[] =>
  points.map((a, i) => ({ a, b: points[(i + 1) % points.length], ring, i }))

const boxesOverlap = (s: Segment, t: Segment) =>
  Math.max(s.a.x, s.b.x) >= Math.min(t.a.x, t.b.x) &&
  Math.max(t.a.x, t.b.x) >= Math.min(s.a.x, s.b.x) &&
  Math.max(s.a.y, s.b.y) >= Math.min(t.a.y, t.b.y) &&
  Math.max(t.a.y, t.b.y) >= Math.min(s.a.y, s.b.y)

/** Pairs of segments (by their place in the list), first by the one that starts further left, ties in list order. */
function pairsInXOrder(segments: Segment[], accept: (s: Segment, t: Segment) => boolean): [Segment, Segment][] {
  const ranked = segments.map((s, k) => ({ s, k, x0: Math.min(s.a.x, s.b.x) })).sort((p, q) => p.x0 - q.x0 || p.k - q.k)
  const pairs: [Segment, Segment][] = []
  for (let p = 0; p < ranked.length; p++) {
    for (let q = p + 1; q < ranked.length; q++) {
      const s = ranked[p].s
      const t = ranked[q].s
      if (boxesOverlap(s, t) && accept(s, t)) pairs.push([s, t])
    }
  }
  return pairs
}

function bruteSelf(points: readonly Point[]): Crossing[] {
  const n = points.length
  if (n < 4) return []
  const found: Crossing[] = []
  for (const [s, t] of pairsInXOrder(segmentsOf(points, 0), () => true)) {
    const i = Math.min(s.i, t.i)
    const j = Math.max(s.i, t.i)
    if (j - i < 2 || (i === 0 && j === n - 1)) continue
    const at = meet(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])
    if (at) found.push({ i, j, at })
  }
  return found
}

function bruteRings(a: readonly Point[], b: readonly Point[]): Crossing[] {
  const found: Crossing[] = []
  for (const [s, t] of pairsInXOrder([...segmentsOf(a, 0), ...segmentsOf(b, 1)], (s, t) => s.ring !== t.ring)) {
    const [p, q] = s.ring === 0 ? [s, t] : [t, s]
    const at = meet(p.a, p.b, q.a, q.b)
    if (at) found.push({ i: p.i, j: q.i, at })
  }
  return found
}

// ---- Shapes ----

const turn = (points: Point[], angle: number): Point[] =>
  points.map((p) => ({
    x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
    y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
  }))

/** Points scattered on a small integer grid: many crossings, touches and repeated points. */
const scatter = (random: () => number, n: number, size = 50): Point[] =>
  Array.from({ length: n }, () => ({ x: Math.round(random() * size), y: Math.round(random() * size) }))

/** A comb of long parallel teeth (each end on one side or the other), some of them nudged, turned by `angle`. */
function comb(random: () => number, n: number, angle: number): Point[] {
  const points: Point[] = []
  for (let i = 0; i < n; i++) points.push({ x: random() < 0.5 ? 0 : 1000, y: i * 3 + (random() < 0.3 ? 1 : 0) })
  return turn(points, angle)
}

/** A long thin zigzag along a diagonal, from far-apart integer points. */
const diagonal = (random: () => number, n: number, angle: number): Point[] =>
  turn(
    Array.from({ length: n }, () => ({ x: Math.round(random() * 1e6), y: Math.round(random() * 20) })),
    angle,
  )

const ANGLES = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, 1.1, 2.9]

function shapes(): { name: string; points: Point[] }[] {
  const random = seededRandom(99)
  const out: { name: string; points: Point[] }[] = []
  for (const n of [5, 40, 120, 300]) out.push({ name: `scatter ${n}`, points: scatter(random, n) })
  for (const angle of ANGLES)
    for (const n of [80, 400]) out.push({ name: `comb ${n} at ${angle.toFixed(2)}`, points: comb(random, n, angle) })
  for (const angle of [Math.PI / 4, -Math.PI / 4])
    out.push({ name: `diagonal at ${angle.toFixed(2)}`, points: diagonal(random, 200, angle) })
  return out
}

describe('crossing searches equal a brute-force check', () => {
  const all = shapes()

  it('sweeps along x and turned (both are exercised)', () => {
    const frames = new Set(all.map((s) => new SegmentSweep(s.points).alongX))
    expect(frames).toEqual(new Set([true, false]))
  })

  it.each(all)('findSelfCrossings: $name', ({ points }) => {
    const expected = bruteSelf(points)
    expect(findSelfCrossings(points)).toEqual(expected)
    for (const limit of [0, 2])
      expect(findSelfCrossings(points, limit).length).toBe(Math.min(expected.length, limit + 1))
  })

  it('findRingCrossings, with and without indexes', () => {
    let compared = 0
    for (let k = 0; k < all.length; k++) {
      const a = all[k].points
      const b = all[(k * 7 + 3) % all.length].points
      const expected = bruteRings(a, b)
      compared += expected.length
      expect(findRingCrossings(a, b), `${all[k].name} with ${all[(k * 7 + 3) % all.length].name}`).toEqual(expected)
      expect(findRingCrossings(a, b, Infinity, new RingIndex(a), new RingIndex(b))).toEqual(expected)
      for (const limit of [0, 2])
        expect(findRingCrossings(a, b, limit).length).toBe(Math.min(expected.length, limit + 1))
    }
    expect(compared).toBeGreaterThan(1000)
  })

  it('SegmentSweep compares every pair that meets, and only pairs whose boxes overlap', () => {
    for (const { name, points } of all) {
      const segments = segmentsOf(points, 0)
      const sweep = new SegmentSweep(points)
      const { order, u0, u1, v0, v1 } = sweep
      const compared = new Set<number>()
      for (let p = 0; p < order.length; p++) {
        const s = order[p]
        for (let q = p + 1; q < order.length; q++) {
          const t = order[q]
          if (u0[t] > u1[s]) break
          if (v0[t] > v1[s] || v1[t] < v0[s] || !sweep.boxesMeet(s, t)) continue
          compared.add(Math.min(s, t) * points.length + Math.max(s, t))
        }
      }
      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          const key = i * points.length + j
          const overlap = boxesOverlap(segments[i], segments[j])
          if (!overlap)
            expect(compared.has(key), `${name}: ${i} ${j} compared though their boxes are apart`).toBe(false)
          else if (meet(segments[i].a, segments[i].b, segments[j].a, segments[j].b))
            expect(compared.has(key), `${name}: ${i} ${j} meet but were not compared`).toBe(true)
        }
      }
    }
  })
})

describe('RingIndex', () => {
  it('finds the segments near a box and the points inside, as a plain search does', () => {
    const random = seededRandom(7)
    for (const { name, points } of shapes()) {
      const index = new RingIndex(points)
      const xs = points.map((p) => p.x)
      const ys = points.map((p) => p.y)
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      const at = (lo: number, hi: number) => lo + (hi - lo) * (random() * 1.2 - 0.1)
      for (let k = 0; k < 40; k++) {
        const x = [at(minX, maxX), at(minX, maxX)].sort((p, q) => p - q)
        const y = [at(minY, maxY), at(minY, maxY)].sort((p, q) => p - q)
        const expected = segmentsOf(points, 0)
          .filter(
            (s) =>
              !(
                Math.max(s.a.x, s.b.x) < x[0] ||
                Math.min(s.a.x, s.b.x) > x[1] ||
                Math.max(s.a.y, s.b.y) < y[0] ||
                Math.min(s.a.y, s.b.y) > y[1]
              ),
          )
          .map((s) => s.i)
        expect(index.segmentsIn(x[0], x[1], y[0], y[1]), `${name}: segments in a box`).toEqual(expected)
        const p = { x: x[0], y: y[1] }
        expect(index.contains(p), `${name}: contains ${p.x} ${p.y}`).toBe(insideRing(p, points))
      }
    }
  })
})
