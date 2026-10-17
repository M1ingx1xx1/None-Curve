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
// into contours. These are then drawn again through the input's own points and the exact crossings,
// where that keeps them apart (the grid moved every point a little, which would turn a run of short
// edges into a wobble of small turns that reads as a curve). Only straight edges come out, with new
// vertices only where outlines crossed (and, where contours come within a grid cell, rounded ones).

import { relate } from './contourLayout'
import { findRingCrossings, findSelfCrossings, insideRing, ringBox } from './crossings'
import { signedArea } from './flatten'
import type { Point, PolygonContour, PolygonGlyph } from './types'
import { curveLikeRuns, WARP_LIMITS } from './warp'

export const OVERLAP_LIMITS = {
  /** Grid cells per em, at least: whole font units unless the em has fewer units than this. */
  minGridPerEm: 1000,
  /** Contours smaller than this many square grid cells are too small to show, and are left out. */
  minArea: 4,
  /** Likewise contours narrower on average (twice the area over the perimeter) than this many cells. */
  minWidth: 1,
  /** Coordinates (in grid cells) beyond this are not merged: the glyph is left as it is. */
  maxCoordinate: 2 ** 19,
  /** Rounds of sending vertices back to the grid where the exact contours cross (step 7), before all of them go back. */
  exactRounds: 8,
  /** Vertices this close (font units) to the straight line between their neighbours are left out, unless the input has them. */
  straight: 1e-6,
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

/**
 * Which regions are ink, by how many times the outlines wind around them: 'nonzero' (how fonts fill), or
 * 'positive' (only where they wind counter-clockwise on balance), which lets clockwise contours added to a
 * glyph whose ink winds exactly once cut holes into it.
 */
export type FillRule = 'nonzero' | 'positive'

/** The glyph redrawn as non-crossing contours around what the fill rule (by default nonzero) fills. */
export function mergeOverlaps(polygon: PolygonGlyph, rule: FillRule = 'nonzero'): { polygon: PolygonGlyph; stats: OverlapStats } {
  const unitsPerEm = polygon.metrics.unitsPerEm > 0 ? polygon.metrics.unitsPerEm : 1000
  const scale = Math.max(1, Math.ceil(OVERLAP_LIMITS.minGridPerEm / unitsPerEm))
  const stats: OverlapStats = { ...emptyOverlapStats(), applied: true, contoursIn: polygon.contours.length }

  // ---- 1. Segments on the grid ----
  const ax: number[] = []
  const ay: number[] = []
  const bx: number[] = []
  const by: number[] = []
  /** Each segment's ends as the input has them (font units), for drawing the result there again (step 7). */
  const starts: Point[] = []
  const ends: Point[] = []
  /** Each segment's contour, the input vertex it starts at, and the contour's next segment. */
  const segmentContour: number[] = []
  const segmentStart: number[] = []
  const following: number[] = []
  for (const [k, contour] of polygon.contours.entries()) {
    const n = contour.points.length
    if (n < 3) continue
    const first = ax.length
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
      starts.push(contour.points[i])
      ends.push(contour.points[(i + 1) % n])
      segmentContour.push(k)
      segmentStart.push(i)
      following.push(ax.length)
    }
    if (ax.length > first) following[ax.length - 1] = first
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
  /** The hot pixels at each segment's ends. */
  const startPixel = new Int32Array(count)
  const endPixel = new Int32Array(count)
  for (let s = 0; s < count; s++) {
    startPixel[s] = addHot(ax[s], ay[s])
    endPixel[s] = addHot(bx[s], by[s])
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
  /** The segment each grid edge comes from (-1 when several run along it). */
  const owner = new Map<number, number>()
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
      const before = owner.get(key)
      if (before !== s) owner.set(key, before === undefined ? s : -1)
    }
  }

  // ---- 4. Planar graph: half-edges sorted around each vertex ----
  // Half-edge 2e runs from edge e's lower end to its higher end, 2e + 1 back; `wind` is how much the
  // winding number rises from its right side to its left.
  const from: number[] = []
  const to: number[] = []
  const wind: number[] = []
  const segment: number[] = []
  for (const [key, c] of net) {
    if (c === 0) continue
    const lo = Math.floor(key / hx.length)
    const hi = key - lo * hx.length
    from.push(lo, hi)
    to.push(hi, lo)
    wind.push(c, -c)
    const s = owner.get(key)!
    segment.push(s, s)
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
  const ink = rule === 'positive' ? (f: number) => (faceWinding[f] ?? 0) > 0 : (f: number) => (faceWinding[f] ?? 0) !== 0
  const kept = new Uint8Array(halves)
  for (let h = 0; h < halves; h++) if (ink(face[h]) && !ink(face[twin(h)])) kept[h] = 1
  const used = new Uint8Array(halves)
  const loops: Loop[] = []
  for (let h = 0; h < halves; h++) {
    if (!kept[h] || used[h]) continue
    // The half-edges in order: each one starts at the vertex after the one before.
    const loop: number[] = []
    for (let g = h, guard = 0; !used[g] && guard <= halves; guard++) {
      used[g] = 1
      loop.push(g)
      // Round the vertex through inked faces to the next boundary edge, so that where two inked
      // regions touch at a point each keeps its own contour.
      let c = next(g)
      for (let turn = 0; !kept[c] && turn < halves; turn++) c = next(twin(c))
      g = c
    }
    const points = dropStraight(loop.map((g) => ({ x: hx[from[g]], y: hy[from[g]] })))
    if (points.length < 3) continue
    const area = Math.abs(signedArea(points))
    if (area < OVERLAP_LIMITS.minArea || (2 * area) / perimeter(points) < OVERLAP_LIMITS.minWidth) {
      stats.removed++
      continue
    }
    const corners = loop.map((g, k) => corner(loop[(k - 1 + loop.length) % loop.length], g))
    loops.push({ grid: points.map((p) => ({ x: p.x / scale, y: p.y / scale })), corners })
  }

  /**
   * The vertex where half-edge `into` ends and `out` starts. Where both edges come from input segments that end
   * there, at the same input vertex, that vertex is where it lies exactly (or the input vertices, if consecutive
   * segments of a contour leave out a few in this grid cell); where both come from two segments passing through,
   * it lies where those cross. Where both come from one segment passing through, it is a detour.
   */
  function corner(into: number, out: number): Corner {
    const v = from[out]
    const grid = { x: hx[v] / scale, y: hy[v] / scale }
    const s = segment[into]
    const t = segment[out]
    if (s < 0 || t < 0) return { grid, exact: [], own: false, detour: false }
    const a = startPixel[s] === v ? starts[s] : endPixel[s] === v ? ends[s] : null
    const b = startPixel[t] === v ? starts[t] : endPixel[t] === v ? ends[t] : null
    if (a && b) {
      // Consecutive segments of a contour, run forwards or backwards: the input vertices between them.
      if (endPixel[s] === v && startPixel[t] === v && following[s] === t) return { grid, exact: between(s, t), own: true, detour: false }
      if (startPixel[s] === v && endPixel[t] === v && following[t] === s) return { grid, exact: between(t, s).reverse(), own: true, detour: false }
      const same = a.x === b.x && a.y === b.y
      return { grid, exact: same ? [a] : [], own: same, detour: false }
    }
    if (a || b || s === t) return { grid, exact: [], own: false, detour: !a && !b }
    const at = meetingPoint(starts[s], ends[s], starts[t], ends[t])
    const near = at !== null && Math.abs(at.x * scale - hx[v]) <= 1 && Math.abs(at.y * scale - hy[v]) <= 1
    return { grid, exact: near ? [at] : [], own: false, detour: false }
  }

  /** The input vertices after where segment u starts, up to where segment w (later in the same contour) starts. */
  function between(u: number, w: number): Point[] {
    const points = polygon.contours[segmentContour[u]].points
    const n = points.length
    const out: Point[] = []
    for (let i = (segmentStart[u] + 1) % n; out.length < n; i = (i + 1) % n) {
      out.push(points[i])
      if (i === segmentStart[w]) break
    }
    return out
  }

  const exact = exactContours(loops, OVERLAP_LIMITS.minArea / 2 / (scale * scale), 1 / scale, WARP_LIMITS.shortEdge * unitsPerEm)
  const contours: PolygonContour[] = exact.map((points) => ({ points, clockwise: signedArea(points) < 0 }))
  stats.contoursOut = contours.length
  return { polygon: { ...polygon, contours }, stats }
}

/** A vertex of a merged contour (font units). See `corner` in mergeOverlaps. */
interface Corner {
  grid: Point
  /** Where it lies exactly (more than one point where a few input vertices share its grid cell), or none when that is not clear. */
  exact: Point[]
  /** It is the input's vertices (not where input edges cross): kept even on a straight line, as the input has them. */
  own: boolean
  /** Snap rounding routed an edge through this grid point only because it passed close by. */
  detour: boolean
}

interface Loop {
  /** The contour on the grid, without vertices on a straight line between their neighbours. */
  grid: Point[]
  corners: Corner[]
}

/**
 * ---- 7. Back to the input's own points ----
 * Rounding to the grid moves every vertex by up to half a cell, which turns a run of short edges (a densely
 * divided outline, the font's flattened curves) into a wobble of small, random turns, and adds the detours.
 * So each contour is drawn again through the exact points: the input's own vertices, and the exact places
 * where input edges cross; detours are left out. Where that makes contours cross or touch (they can lie a
 * cell apart), or turns a sliver inside out, the vertices of the edges involved go back to the grid, detours
 * included, until none does; so do points of a contour that come closer than a cell to the point after next
 * (rounding could join them and fold up the point between). Then, where a vertex that is not the input's own (on the grid, or where edges
 * cross) makes a curve-like run long enough (see curveLikeRuns: an outline joined where it crossed can go on
 * turning gently), the one that turns least is left out if that moves the outline by at most a grid cell,
 * and checked the same way. The grid result is valid, so this always ends there at worst.
 */
function exactContours(loops: readonly Loop[], minArea: number, cell: number, shortEdge: number): Point[][] {
  const pinned = loops.map((loop) => new Uint8Array(loop.corners.length))
  /** Corners left out to break a run, and corners that may not be, because leaving them out made contours cross. */
  const dropped = loops.map((loop) => new Uint8Array(loop.corners.length))
  const needed = loops.map((loop) => new Uint8Array(loop.corners.length))
  const whole = new Uint8Array(loops.length)
  /** How pairs of contours sit on the grid, by k × loops.length + m. */
  const onGrid: ReturnType<typeof relate>[] = []
  let valid: Point[][] | null = null
  for (let round = 0; round < OVERLAP_LIMITS.exactRounds; round++) {
    // Each contour as it stands, and for each of its points the corner it comes from.
    const rings: Point[][] = []
    const sources: (number[] | null)[] = []
    let changed = false
    loops.forEach((loop, k) => {
      if (!whole[k]) {
        const points: Point[] = []
        const source: number[] = []
        loop.corners.forEach((c, i) => {
          if (dropped[k][i]) return
          const at = pinned[k][i] || c.exact.length === 0 ? (c.detour && !pinned[k][i] ? [] : [c.grid]) : c.exact
          for (const p of at) {
            points.push(p)
            source.push(i)
          }
        })
        dropStraightNear(points, source, (i) => loop.corners[i].own && !pinned[k][i])
        const area = points.length >= 3 ? signedArea(points) : 0
        if (Math.abs(area) >= minArea && area < 0 === signedArea(loop.grid) < 0) {
          rings.push(points)
          sources.push(source)
          return
        }
        whole[k] = 1
        changed = true
      }
      rings.push(loop.grid)
      sources.push(null)
    })
    /**
     * Sends the corners of contour k from the one point p comes from to the one point q comes from back to the
     * grid, and those left out between them back in for good; false when nothing changes.
     */
    const pin = (k: number, p: number, q: number): boolean => {
      const source = sources[k]
      if (!source) return false
      const n = loops[k].corners.length
      const last = source[q]
      let any = false
      for (let i = source[p]; ; i = (i + 1) % n) {
        if (!pinned[k][i] || dropped[k][i]) {
          pinned[k][i] = 1
          if (dropped[k][i]) needed[k][i] = 1
          dropped[k][i] = 0
          any = true
        }
        if (i === last) return any
      }
    }
    /** The same for the edge from point e of contour k to the next. */
    const pinEdge = (k: number, e: number): boolean => pin(k, e, (e + 1) % rings[k].length)
    for (let k = 0; k < rings.length; k++) {
      for (const c of findSelfCrossings(rings[k])) {
        const a = pinEdge(k, c.i)
        const b = pinEdge(k, c.j)
        changed ||= a || b
      }
      // A point within a grid cell of the point after next can be joined to it by rounding (an export to whole
      // units), which folds up the point between and can turn the contour inside out; on the grid they lie a
      // cell apart at least.
      if (sources[k]) {
        const ring = rings[k]
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 2) % ring.length
          if (Math.abs(ring[i].x - ring[j].x) >= cell || Math.abs(ring[i].y - ring[j].y) >= cell) continue
          const a = pin(k, i, i)
          const b = pin(k, j, j)
          changed ||= a || b
        }
      }
      for (let m = k + 1; m < rings.length; m++) {
        if (!sources[k] && !sources[m]) continue
        const crossings = findRingCrossings(rings[k], rings[m])
        for (const c of crossings) {
          const a = pinEdge(k, c.i)
          const b = pinEdge(m, c.j)
          changed ||= a || b
        }
        if (crossings.length > 0) continue
        // Apart, or one inside the other, as on the grid (where they may touch at a point instead).
        const before = (onGrid[k * loops.length + m] ??= relate(loops[k].grid, loops[m].grid))
        if (!before.meet && (inside(rings[k], rings[m]) !== before.aInB || inside(rings[m], rings[k]) !== before.bInA)) {
          whole[k] = whole[m] = 1
          changed = true
        }
      }
    }
    if (changed) continue
    valid = rings
    if (!breakRuns(rings, sources)) return rings
  }
  return valid ?? loops.map((loop) => loop.grid)

  /** Leaves out a corner from each curve-like run that corners other than the input's own make long enough; false when none. */
  function breakRuns(rings: readonly Point[][], sources: readonly (number[] | null)[]): boolean {
    let any = false
    rings.forEach((ring, k) => {
      const source = sources[k]
      if (!source) return
      const corners = loops[k].corners
      const own = (j: number) => corners[source[j]].own && !pinned[k][source[j]]
      const n = ring.length
      const taken = new Set<number>()
      for (const run of curveLikeRuns(ring, shortEdge)) {
        if (run.filter(own).length >= WARP_LIMITS.curveRun) continue
        let weakest = -1
        for (const j of run) {
          if (own(j) || needed[k][source[j]] || distanceToSegment(ring[j], ring[(j - 1 + n) % n], ring[(j + 1) % n]) > cell) continue
          if (weakest < 0 || run.turn(j) < run.turn(weakest)) weakest = j
        }
        // Never two neighbours at once: each is measured against the other's place.
        if (weakest < 0 || taken.has((weakest + 1) % n) || taken.has((weakest - 1 + n) % n)) continue
        taken.add(weakest)
        dropped[k][source[weakest]] = 1
        any = true
      }
    })
    return any
  }
}

/** True when ring a, which does not meet ring b, lies inside it. */
function inside(a: readonly Point[], b: readonly Point[]): boolean {
  const boxA = ringBox(a)
  const boxB = ringBox(b)
  return boxB.minX <= boxA.minX && boxB.maxX >= boxA.maxX && boxB.minY <= boxA.minY && boxB.maxY >= boxA.maxY && insideRing(a[0], b)
}

/**
 * Leaves out repeated points, and points on the straight line between their neighbours (see `straight`) unless
 * `own` says the input has them, with their sources.
 */
function dropStraightNear(points: Point[], sources: number[], own: (source: number) => boolean) {
  for (let changed = true; changed && points.length >= 3; ) {
    changed = false
    let kept = 0
    const n = points.length
    for (let i = 0; i < n; i++) {
      const prev = kept > 0 ? points[kept - 1] : points[n - 1]
      const p = points[i]
      const after = points[(i + 1) % n]
      const length = Math.hypot(after.x - prev.x, after.y - prev.y)
      const off = Math.abs((p.x - prev.x) * (after.y - prev.y) - (p.y - prev.y) * (after.x - prev.x))
      if ((p.x === prev.x && p.y === prev.y) || (off <= OVERLAP_LIMITS.straight * length && !own(sources[i]))) {
        changed = true
        continue
      }
      points[kept] = p
      sources[kept] = sources[i]
      kept++
    }
    points.length = kept
    sources.length = kept
  }
}

/** Where segments a1–a2 and b1–b2 cross, or null when they do not (or are parallel). */
function meetingPoint(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const dx = a2.x - a1.x
  const dy = a2.y - a1.y
  const ex = b2.x - b1.x
  const ey = b2.y - b1.y
  const d = dx * ey - dy * ex
  if (d === 0) return null
  const t = ((b1.x - a1.x) * ey - (b1.y - a1.y) * ex) / d
  const u = ((b1.x - a1.x) * dy - (b1.y - a1.y) * dx) / d
  if (!(t >= 0 && t <= 1 && u >= 0 && u <= 1)) return null
  return { x: a1.x + t * dx, y: a1.y + t * dy }
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

/**
 * True when segment (x0, y0)–(x1, y1) meets the cell of pixel (px, py): the points within half a grid unit
 * of it, its left and bottom sides included and its right and top sides not (they belong to the next cells),
 * as Math.round rounds. So a segment through a cell corner passes only the one cell that holds the corner,
 * not all four: routed through two cells beside its way at the same distance along it, it would zigzag
 * across a segment through the same corner the other way, and the two would cross.
 */
function passes(x0: number, y0: number, x1: number, y1: number, px: number, py: number): boolean {
  // Doubled coordinates keep the cell's corners whole.
  const [ax, ay, bx, by] = [2 * x0, 2 * y0, 2 * x1, 2 * y1]
  const [l, r, b, t] = [2 * px - 1, 2 * px + 1, 2 * py - 1, 2 * py + 1]
  if (Math.max(ax, bx) < l || Math.min(ax, bx) > r || Math.max(ay, by) < b || Math.min(ay, by) > t) return false
  const s1 = Math.sign(cross(ax, ay, bx, by, l, b))
  const s2 = Math.sign(cross(ax, ay, bx, by, r, b))
  const s3 = Math.sign(cross(ax, ay, bx, by, r, t))
  const s4 = Math.sign(cross(ax, ay, bx, by, l, t))
  if ((s1 > 0 && s2 > 0 && s3 > 0 && s4 > 0) || (s1 < 0 && s2 < 0 && s3 < 0 && s4 < 0)) return false
  // Touching the cell at a single corner (the line runs through it, all other corners on one side; segments
  // run between pixels, so never along a side): only the bottom-left corner belongs to the cell.
  const side = s1 + s2 + s3 + s4
  return Math.abs(side) !== 3 || s1 === 0
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

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
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
