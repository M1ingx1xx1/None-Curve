// Merging overlaps: redraws a glyph whose outlines cross or overlap as the outline of exactly what
// they fill. Pure functions in font units; no React, no DOM, no Math.random.
//
// Beyond their safe ranges the Experimental effects fold the plane over itself: parts of a letter land
// on other parts and outlines cross themselves. Fonts fill by the nonzero rule (a point is ink when
// the outlines wind around it a nonzero number of times), so such a letter still has a definite shape,
// but crossing outlines do not survive rounding for export, and font tools reject them. This step
// draws that shape anew, as contours that neither cross nor overlap: outer contours counter-clockwise,
// holes clockwise (y up), touching at most at single points.
//
// It works by snap rounding on a grid of whole font units (finer for small ems): every vertex and
// every crossing becomes a grid point, and each edge is routed through every grid point whose cell it
// passes. Rounded this way, edges meet only at their ends, so the arithmetic is exact from there on.
// Each region between edges gets its winding number, and the edges between ink and no ink are joined
// into contours. Only straight edges come out, with new vertices only where outlines crossed (and
// detours under half a grid cell), so nothing reads as a curve.

import { signedArea } from './flatten'
import type { Point, PolygonContour, PolygonGlyph } from './types'

export const OVERLAP_LIMITS = {
  /** Grid cells per em, at least: whole font units unless the em has fewer units than this. */
  minGridPerEm: 1000,
  /** Contours smaller than this many square grid cells are too small to show, and are left out. */
  minArea: 4,
  /** Likewise contours narrower on average (twice the area over the perimeter) than this many cells. */
  minWidth: 1,
  /** Coordinates (in grid cells) beyond this are not merged: the glyph is left as it is. */
  maxCoordinate: 2 ** 19,
} as const

export interface OverlapStats {
  applied: boolean
  /** Places where outlines crossed. */
  crossings: number
  contoursIn: number
  contoursOut: number
  /** Contours left out as too small to show. */
  removed: number
}

export const emptyOverlapStats = (): OverlapStats => ({ applied: false, crossings: 0, contoursIn: 0, contoursOut: 0, removed: 0 })

/** The glyph redrawn as non-crossing contours around what the nonzero rule fills. */
export function mergeOverlaps(polygon: PolygonGlyph): { polygon: PolygonGlyph; stats: OverlapStats } {
  const unitsPerEm = polygon.metrics.unitsPerEm > 0 ? polygon.metrics.unitsPerEm : 1000
  const scale = Math.max(1, Math.ceil(OVERLAP_LIMITS.minGridPerEm / unitsPerEm))
  const stats: OverlapStats = { ...emptyOverlapStats(), applied: true, contoursIn: polygon.contours.length }

  // ---- 1. Segments on the grid ----
  const ax: number[] = []
  const ay: number[] = []
  const bx: number[] = []
  const by: number[] = []
  for (const contour of polygon.contours) {
    const n = contour.points.length
    if (n < 3) continue
    const grid = contour.points.map((p) => ({ x: Math.round(p.x * scale), y: Math.round(p.y * scale) }))
    for (const p of grid) {
      if (!(Math.abs(p.x) < OVERLAP_LIMITS.maxCoordinate && Math.abs(p.y) < OVERLAP_LIMITS.maxCoordinate)) {
        return { polygon, stats: { ...stats, applied: false } }
      }
    }
    for (let i = 0; i < n; i++) {
      const a = grid[i]
      const b = grid[(i + 1) % n]
      if (a.x === b.x && a.y === b.y) continue
      ax.push(a.x)
      ay.push(a.y)
      bx.push(b.x)
      by.push(b.y)
    }
  }
  const count = ax.length
  if (count === 0) return { polygon: { ...polygon, contours: [] }, stats: { ...stats, contoursOut: 0 } }

  // ---- 2. Hot pixels: every vertex and every crossing, rounded to the grid ----
  const hot = new Map<number, number>()
  const hx: number[] = []
  const hy: number[] = []
  const addHot = (x: number, y: number) => {
    const key = pointKey(x, y)
    let id = hot.get(key)
    if (id === undefined) {
      id = hx.length
      hot.set(key, id)
      hx.push(x)
      hy.push(y)
    }
    return id
  }
  for (let s = 0; s < count; s++) {
    addHot(ax[s], ay[s])
    addHot(bx[s], by[s])
  }
  // Crossings: only proper ones add points (a touch happens at a vertex, which is already hot).
  const order = Array.from({ length: count }, (_, s) => s).sort((s, t) => Math.min(ax[s], bx[s]) - Math.min(ax[t], bx[t]))
  for (let i = 0; i < count; i++) {
    const s = order[i]
    const sx1 = Math.max(ax[s], bx[s])
    const sy0 = Math.min(ay[s], by[s])
    const sy1 = Math.max(ay[s], by[s])
    for (let j = i + 1; j < count; j++) {
      const t = order[j]
      if (Math.min(ax[t], bx[t]) > sx1) break
      if (Math.min(ay[t], by[t]) > sy1 || Math.max(ay[t], by[t]) < sy0) continue
      const d1 = cross(ax[s], ay[s], bx[s], by[s], ax[t], ay[t])
      const d2 = cross(ax[s], ay[s], bx[s], by[s], bx[t], by[t])
      if (d1 === 0 || d2 === 0 || d1 > 0 === d2 > 0) continue
      const d3 = cross(ax[t], ay[t], bx[t], by[t], ax[s], ay[s])
      const d4 = cross(ax[t], ay[t], bx[t], by[t], bx[s], by[s])
      if (d3 === 0 || d4 === 0 || d3 > 0 === d4 > 0) continue
      const f = d1 / (d1 - d2)
      addHot(Math.round(ax[t] + (bx[t] - ax[t]) * f), Math.round(ay[t] + (by[t] - ay[t]) * f))
      stats.crossings++
    }
  }

  // ---- 3. Route every segment through the hot pixels whose cells it passes ----
  const pixels = new PixelIndex(hx, hy)
  /** Net number of times the outlines run along each grid edge, from its lower to its higher end. */
  const net = new Map<number, number>()
  const edgeEnds = new Map<number, [number, number]>()
  const stamp = new Int32Array(hx.length).fill(-1)
  for (let s = 0; s < count; s++) {
    const on: number[] = []
    pixels.visit(ax[s], ay[s], bx[s], by[s], (h) => {
      if (stamp[h] === s) return
      stamp[h] = s
      if (passes(ax[s], ay[s], bx[s], by[s], hx[h], hy[h])) on.push(h)
    })
    const dx = bx[s] - ax[s]
    const dy = by[s] - ay[s]
    const along = (h: number) => (hx[h] - ax[s]) * dx + (hy[h] - ay[s]) * dy
    on.sort((g, h) => along(g) - along(h) || hx[g] - hx[h] || hy[g] - hy[h])
    for (let k = 0; k + 1 < on.length; k++) {
      const u = on[k]
      const v = on[k + 1]
      if (u === v) continue
      const [lo, hi] = u < v ? [u, v] : [v, u]
      const key = lo * hx.length + hi
      net.set(key, (net.get(key) ?? 0) + (u < v ? 1 : -1))
      edgeEnds.set(key, [lo, hi])
    }
  }

  // ---- 4. Planar graph: half-edges sorted around each vertex ----
  // Half-edge 2e runs from edge e's lower end to its higher end, 2e + 1 back; `wind` is how much the
  // winding number rises from its right side to its left.
  const from: number[] = []
  const to: number[] = []
  const wind: number[] = []
  for (const [key, c] of net) {
    if (c === 0) continue
    const [lo, hi] = edgeEnds.get(key)!
    from.push(lo, hi)
    to.push(hi, lo)
    wind.push(c, -c)
  }
  const halves = from.length
  if (halves === 0) return { polygon: { ...polygon, contours: [] }, stats: { ...stats, contoursOut: 0 } }
  const twin = (h: number) => h ^ 1
  const outgoing: number[][] = hx.map(() => [])
  for (let h = 0; h < halves; h++) outgoing[from[h]].push(h)
  const position = new Int32Array(halves)
  for (const list of outgoing) {
    list.sort((g, h) => compareAngle(hx[to[g]] - hx[from[g]], hy[to[g]] - hy[from[g]], hx[to[h]] - hx[from[h]], hy[to[h]] - hy[from[h]]))
    list.forEach((h, k) => (position[h] = k))
  }
  /** The next half-edge around the face on h's left: at h's end, the first one clockwise from h's twin. */
  const next = (h: number) => {
    const list = outgoing[to[h]]
    return list[(position[twin(h)] - 1 + list.length) % list.length]
  }

  // ---- 5. Faces and their winding numbers ----
  const face = new Int32Array(halves).fill(-1)
  const faceEdges: number[][] = []
  for (let h = 0; h < halves; h++) {
    if (face[h] >= 0) continue
    const id = faceEdges.length
    const edges: number[] = []
    for (let g = h, guard = 0; face[g] < 0 && guard <= halves; g = next(g), guard++) {
      face[g] = id
      edges.push(g)
    }
    faceEdges.push(edges)
  }
  // Connected pieces of the graph, each started from the face around it, whose winding number a ray
  // to the left of the piece's leftmost vertex gives.
  const parent = hx.map((_, k) => k)
  const root = (k: number): number => (parent[k] === k ? k : (parent[k] = root(parent[k])))
  for (let h = 0; h < halves; h += 2) parent[root(from[h])] = root(to[h])
  const leftmost = new Map<number, number>()
  for (let h = 0; h < halves; h++) {
    const v = from[h]
    const r = root(v)
    const best = leftmost.get(r)
    if (best === undefined || hx[v] < hx[best] || (hx[v] === hx[best] && hy[v] < hy[best])) leftmost.set(r, v)
  }
  const faceWinding = new Array<number | undefined>(faceEdges.length)
  for (const v of leftmost.values()) {
    // The face left of v: the wedge from the last edge pointing up (or right) round to the next edge.
    const list = outgoing[v]
    let k = list.length - 1
    for (let i = 0; i < list.length; i++) if (upper(hx[to[list[i]]] - hx[v], hy[to[list[i]]] - hy[v])) k = i
    const outer = face[list[k]]
    if (faceWinding[outer] !== undefined) continue
    faceWinding[outer] = windingLeftOf(v)
    const queue = [outer]
    while (queue.length > 0) {
      const f = queue.pop()!
      for (const h of faceEdges[f]) {
        const g = face[twin(h)]
        if (faceWinding[g] === undefined) {
          faceWinding[g] = faceWinding[f]! - wind[h]
          queue.push(g)
        }
      }
    }
  }
  /** Winding number just left of vertex v: edges crossing the ray from v to the left (half-open in y). */
  function windingLeftOf(v: number): number {
    const x = hx[v]
    const y = hy[v]
    let w = 0
    for (let h = 0; h < halves; h += 2) {
      const p = from[h]
      const q = to[h]
      if (hy[p] > y === hy[q] > y) continue
      const [lo, hi] = hy[p] < hy[q] ? [p, q] : [q, p]
      // The crossing lies left of v when v is right of the upward edge.
      if (cross(hx[lo], hy[lo], hx[hi], hy[hi], x, y) >= 0) continue
      const up = hy[q] > hy[p]
      w += up ? -wind[h] : wind[h]
    }
    return w
  }

  // ---- 6. Contours: half-edges with ink on the left and none on the right ----
  const ink = (f: number) => (faceWinding[f] ?? 0) !== 0
  const kept = new Uint8Array(halves)
  for (let h = 0; h < halves; h++) if (ink(face[h]) && !ink(face[twin(h)])) kept[h] = 1
  const used = new Uint8Array(halves)
  const loops: Point[][] = []
  for (let h = 0; h < halves; h++) {
    if (!kept[h] || used[h]) continue
    const loop: number[] = []
    for (let g = h, guard = 0; !used[g] && guard <= halves; guard++) {
      used[g] = 1
      loop.push(from[g])
      // Round the vertex through inked faces to the next boundary edge, so that where two inked
      // regions touch at a point each keeps its own contour.
      let c = next(g)
      for (let turn = 0; !kept[c] && turn < halves; turn++) c = next(twin(c))
      g = c
    }
    const points = dropStraight(loop.map((v) => ({ x: hx[v], y: hy[v] })))
    if (points.length < 3) continue
    const area = Math.abs(signedArea(points))
    if (area < OVERLAP_LIMITS.minArea || (2 * area) / perimeter(points) < OVERLAP_LIMITS.minWidth) {
      stats.removed++
      continue
    }
    loops.push(points.map((p) => ({ x: p.x / scale, y: p.y / scale })))
  }

  const contours: PolygonContour[] = loops.map((points) => ({ points, clockwise: signedArea(points) < 0 }))
  stats.contoursOut = contours.length
  return { polygon: { ...polygon, contours }, stats }
}

/** Hot pixels by square buckets, so each segment visits only the pixels near it. */
class PixelIndex {
  private static readonly SIZE = 16
  private buckets = new Map<number, number[]>()

  constructor(xs: readonly number[], ys: readonly number[]) {
    const size = PixelIndex.SIZE
    for (let h = 0; h < xs.length; h++) {
      // A pixel's cell reaches half a grid unit around it, so it can lie in up to four buckets.
      for (let i = Math.floor((xs[h] - 0.5) / size); i <= Math.floor((xs[h] + 0.5) / size); i++) {
        for (let j = Math.floor((ys[h] - 0.5) / size); j <= Math.floor((ys[h] + 0.5) / size); j++) {
          const key = pointKey(i, j)
          const bucket = this.buckets.get(key)
          if (bucket) bucket.push(h)
          else this.buckets.set(key, [h])
        }
      }
    }
  }

  /** Calls `visit` for every pixel in a bucket the segment may pass (a pixel can come more than once). */
  visit(x0: number, y0: number, x1: number, y1: number, visit: (h: number) => void) {
    const size = PixelIndex.SIZE
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0)
    // Walk the buckets along the longer axis; across it, cover the segment's span in each column.
    const [a0, b0, a1, b1] = steep ? [y0, x0, y1, x1] : [x0, y0, x1, y1]
    const lo = Math.min(a0, a1)
    const hi = Math.max(a0, a1)
    const slope = a1 === a0 ? 0 : (b1 - b0) / (a1 - a0)
    for (let i = Math.floor(lo / size); i <= Math.floor(hi / size); i++) {
      const c0 = Math.max(lo, i * size)
      const c1 = Math.min(hi, (i + 1) * size)
      const e0 = b0 + (c0 - a0) * slope
      const e1 = b0 + (c1 - a0) * slope
      for (let j = Math.floor((Math.min(e0, e1) - 1) / size); j <= Math.floor((Math.max(e0, e1) + 1) / size); j++) {
        const bucket = this.buckets.get(steep ? pointKey(j, i) : pointKey(i, j))
        if (bucket) for (const h of bucket) visit(h)
      }
    }
  }
}

/** True when segment (x0, y0)–(x1, y1) meets the closed cell of half a grid unit around pixel (px, py). */
function passes(x0: number, y0: number, x1: number, y1: number, px: number, py: number): boolean {
  // Doubled coordinates keep the cell's corners whole.
  const [ax, ay, bx, by] = [2 * x0, 2 * y0, 2 * x1, 2 * y1]
  const [l, r, b, t] = [2 * px - 1, 2 * px + 1, 2 * py - 1, 2 * py + 1]
  if (Math.max(ax, bx) < l || Math.min(ax, bx) > r || Math.max(ay, by) < b || Math.min(ay, by) > t) return false
  const s1 = Math.sign(cross(ax, ay, bx, by, l, b))
  const s2 = Math.sign(cross(ax, ay, bx, by, r, b))
  const s3 = Math.sign(cross(ax, ay, bx, by, r, t))
  const s4 = Math.sign(cross(ax, ay, bx, by, l, t))
  return !((s1 > 0 && s2 > 0 && s3 > 0 && s4 > 0) || (s1 < 0 && s2 < 0 && s3 < 0 && s4 < 0))
}

/** True for directions in the upper half-turn: angles from 0 (included) to 180° (excluded). */
function upper(dx: number, dy: number): boolean {
  return dy > 0 || (dy === 0 && dx > 0)
}

/** Orders directions counter-clockwise from the positive x axis, exactly. */
function compareAngle(ux: number, uy: number, vx: number, vy: number): number {
  const hu = upper(ux, uy) ? 0 : 1
  const hv = upper(vx, vy) ? 0 : 1
  if (hu !== hv) return hu - hv
  return -Math.sign(ux * vy - uy * vx)
}

/** Twice the signed area of triangle a, b, c: positive when c lies left of a → b. */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/** One number per grid point (coordinates within ±2^20). */
function pointKey(x: number, y: number): number {
  return (x + 0x10_0000) * 0x20_0000 + (y + 0x10_0000)
}

/** Leaves out vertices on the straight line between their neighbours. */
function dropStraight(points: Point[]): Point[] {
  let out = points
  for (let changed = true; changed && out.length >= 3; ) {
    changed = false
    const kept: Point[] = []
    for (let i = 0; i < out.length; i++) {
      const prev = kept.length > 0 ? kept[kept.length - 1] : out[out.length - 1]
      const p = out[i]
      const after = out[(i + 1) % out.length]
      if (cross(prev.x, prev.y, p.x, p.y, after.x, after.y) === 0) {
        changed = true
        continue
      }
      kept.push(p)
    }
    out = kept
  }
  return out
}

function perimeter(points: readonly Point[]): number {
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}
