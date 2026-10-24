// Independent checks on polygon outlines: written apart from src/geometry so a bug there cannot hide itself.

import type { Point, PolygonGlyph } from '../../src/geometry/types'

export type Contours = Point[][]

export const contoursOf = (polygon: PolygonGlyph): Contours => polygon.contours.map((c) => c.points)

export const vertexCount = (contours: Contours) => contours.reduce((n, c) => n + c.length, 0)

export function sameContours(a: Contours, b: Contours): boolean {
  return a.length === b.length && a.every((c, k) => c.length === b[k].length && c.every((p, i) => p.x === b[k][i].x && p.y === b[k][i].y))
}

export function allFinite(contours: Contours): boolean {
  return contours.every((c) => c.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
}

/** The box around every point of the contours, or null when there are none. */
export function boundsOf(contours: Contours): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null
  for (const p of contours.flat()) {
    box = box
      ? { minX: Math.min(box.minX, p.x), minY: Math.min(box.minY, p.y), maxX: Math.max(box.maxX, p.x), maxY: Math.max(box.maxY, p.y) }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
  }
  return box
}

function segDist2(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = dx * dx + dy * dy
  const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0
  const ex = p.x - a.x - t * dx
  const ey = p.y - a.y - t * dy
  return ex * ex + ey * ey
}

const side = (a: Point, b: Point, q: Point) => (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)

/**
 * Proper crossings between non-adjacent edges (each edge strictly crosses the other's line), and touches: pairs within
 * `eps` that do not cross, counted apart from pinches (two parts of an outline meeting at one shared vertex).
 */
export function outlineCrossings(contours: Contours, eps = 1e-6): { cross: number; touch: number; pinch: number } {
  const edges: { a: Point; b: Point; c: number; i: number; n: number; x0: number; x1: number; y0: number; y1: number }[] = []
  contours.forEach((ring, c) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      edges.push({ a, b, c, i, n: ring.length, x0: Math.min(a.x, b.x) - eps, x1: Math.max(a.x, b.x) + eps, y0: Math.min(a.y, b.y) - eps, y1: Math.max(a.y, b.y) + eps })
    }
  })
  edges.sort((p, q) => p.x0 - q.x0)
  const e2 = eps * eps
  const eq = (m: Point, k: Point) => m.x === k.x && m.y === k.y
  let cross = 0
  let touch = 0
  let pinch = 0
  for (let s = 0; s < edges.length; s++) {
    const u = edges[s]
    for (let t = s + 1; t < edges.length && edges[t].x0 <= u.x1; t++) {
      const v = edges[t]
      if (v.y0 > u.y1 || v.y1 < u.y0) continue
      if (u.c === v.c && ((u.i + 1) % u.n === v.i || (v.i + 1) % v.n === u.i)) continue
      const { a, b } = u
      const { a: p, b: q } = v
      if (side(a, b, p) * side(a, b, q) < 0 && side(p, q, a) * side(p, q, b) < 0) {
        cross++
        continue
      }
      if (segDist2(a, b, p) <= e2 || segDist2(a, b, q) <= e2 || segDist2(p, q, a) <= e2 || segDist2(p, q, b) <= e2) {
        const shared = eq(a, p) || eq(a, q) || eq(b, p) || eq(b, q)
        if (shared && segDist2(a, b, eq(a, p) || eq(b, p) ? q : p) > e2 && segDist2(p, q, eq(a, p) || eq(a, q) ? b : a) > e2) pinch++
        else touch++
      }
    }
  }
  return { cross, touch, pinch }
}

/** Twice the signed area of a ring (positive counter-clockwise, y up). */
export function signedArea2(ring: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum
}

/** Winding number of the contours around p (nonzero rule: ink where it is not 0). */
export function winding(contours: Contours, p: Point): number {
  let w = 0
  for (const ring of contours) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (a.y <= p.y) {
        if (b.y > p.y && side(a, b, p) > 0) w++
      } else if (b.y <= p.y && side(a, b, p) < 0) w--
    }
  }
  return w
}

/** Area of what the contours fill by the nonzero rule, summed over `lines` scanlines (good to well under 1%). */
export function inkArea(contours: Contours, lines = 1500): number {
  let y0 = Infinity
  let y1 = -Infinity
  for (const ring of contours) {
    for (const p of ring) {
      y0 = Math.min(y0, p.y)
      y1 = Math.max(y1, p.y)
    }
  }
  if (!(y1 > y0)) return 0
  const h = (y1 - y0) / lines
  let area = 0
  for (let k = 0; k < lines; k++) {
    const y = y0 + (k + 0.5) * h
    const hits: [number, number][] = []
    for (const ring of contours) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        if (a.y <= y === b.y <= y) continue
        hits.push([a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), b.y > a.y ? 1 : -1])
      }
    }
    hits.sort((p, q) => p[0] - q[0])
    let w = 0
    for (let i = 0; i < hits.length; i++) {
      if (w !== 0) area += (hits[i][0] - hits[i - 1][0]) * h
      w += hits[i][1]
    }
  }
  return area
}

/** A glyph-shaped polygon around these contours (y up, 1000 units per em). */
export function polygonOf(contours: Contours, unitsPerEm = 1000): PolygonGlyph {
  return {
    ref: { index: 1, name: 'test', unicode: 0x41 },
    metrics: { unitsPerEm, advanceWidth: unitsPerEm, leftSideBearing: 0, rightSideBearing: 0, ascender: 0.8 * unitsPerEm, descender: -0.2 * unitsPerEm },
    contours: contours.map((points) => ({ points, clockwise: signedArea2(points) < 0 })),
  }
}

/** An axis-aligned rectangle, counter-clockwise (y up). */
export const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

/** A seeded uniform generator in [0, 1) (mulberry32), so every random case can be repeated. */
export function seededRandom(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
