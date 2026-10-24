// The vertex budget of the Experimental effects. Pure functions in font units; no React, no DOM, no Math.random.
//
// Dense settings multiply: every warp adds a vertex wherever its mesh creases the outline, Thorn's refraction warps
// each strip of the letter again, and every merge adds one wherever outlines cross. Together they can turn a letter of
// a hundred vertices into a hundred thousand, which takes seconds to merge and draw. So each glyph has a budget. It
// depends only on the glyph and the parameters, never on time, so the canvas, the preview, and the exported files agree.
// - After each effect, a glyph with more vertices than the limit is simplified to fit (see reduceToLimit): every contour
//   by Ramer–Douglas–Peucker with one shared tolerance, doubled from the warps' drift limit until the glyph fits, and
//   contours no larger than the tolerance are left out. Each contour keeps a subset of its vertices, so every edge stays
//   straight, and runs the simplification leaves looking like a curve are broken up (see breakRuns). The outlines may
//   then cross, so they are merged afterwards. A warp that would make many times the limit (a long tangle through a fine
//   mesh) is left out instead, before its costly tidying.
// - A merge with more grid points (vertices and crossings) than its limit stops before its costly steps (see
//   mergeOverlaps). The glyph is then simplified more coarsely, to at most half the vertices of the try before, and
//   merged again, until it fits. Only if even the coarsest simplification does not fit is the glyph left unmerged
//   (stats.tooComplex), simplified that far: by the nonzero rule it fills the same, and with few vertices left it is
//   still quick to draw and export.

import { rdpChain } from './anchors'
import { countSelfCrossings, lazy } from './crossings'
import { mergeOverlaps, type FillRule, type OverlapStats } from './overlaps'
import { signedArea } from './primitives'
import type { Point, PolygonContour, PolygonGlyph } from './types'
import { breakRuns, WARP_LIMITS } from './warp'

const BUDGET_LIMITS = {
  /**
   * A warp may make at most this many times the vertex limit, before it is simplified back. Beyond that (a long tangle
   * through a fine mesh), the warp is left out of the glyph (see applyWarp).
   */
  warpFactor: 16,
  /**
   * The simplification's tolerance starts at the warps' drift limit (WARP_LIMITS.maxDrift × the em) and doubles at most
   * this many times (to about 40 em, more than the effects spread a letter's body; a thorn can reach further, up to
   * 256 em, but adds only its tip and base), leaving out every contour smaller than the tolerance but never all of them,
   * so a glyph can nearly always be simplified until it fits. Only the strongest settings need more than a few
   * doublings, and the letter then turns into a few broad strokes.
   */
  maxDoublings: 12,
} as const

export interface BudgetStats {
  /** The glyph was simplified to stay within the budget. */
  applied: boolean
  /** The largest tolerance it was simplified with (font units): detail smaller than this was left out. */
  tolerance: number
  /** Vertices before the largest simplification. */
  before: number
}

const emptyBudgetStats = (): BudgetStats => ({ applied: false, tolerance: 0, before: 0 })

const countVertices = (contours: readonly PolygonContour[]) => contours.reduce((n, c) => n + c.points.length, 0)

/** One glyph's budget on its way through the Experimental effects. */
export class GlyphBudget {
  readonly stats = emptyBudgetStats()
  /** How many times the glyph was simplified: when this grows, its outlines may cross until they are merged. */
  reductions = 0

  constructor(
    /** Most vertices after any effect. */
    readonly maxVertices: number,
    /** Most grid points (vertices and crossings) per merge (see MergeOptions). */
    readonly maxHot: number,
    readonly unitsPerEm: number,
  ) {}

  /** Most points a warp may make (see applyWarp). */
  get maxWarpPoints(): number {
    return this.maxVertices * BUDGET_LIMITS.warpFactor
  }

  /** The glyph itself when it has at most `limit` vertices; otherwise simplified to fit (see reduceToLimit). */
  fit(polygon: PolygonGlyph, limit = this.maxVertices): PolygonGlyph {
    const reduced = reduceToLimit(polygon, limit, this.unitsPerEm)
    if (reduced.polygon !== polygon) this.record(reduced.tolerance, countVertices(polygon.contours))
    return reduced.polygon
  }

  /**
   * The glyph merged by `rule` (see mergeOverlaps) within the merge's limit. When it is too complex, it is simplified
   * more coarsely, to at most half the vertices of the try before, and merged again, until it fits; if even the
   * coarsest simplification is too complex, that one comes back unmerged, with stats.tooComplex.
   */
  merge(polygon: PolygonGlyph, rule: FillRule = 'nonzero'): { polygon: PolygonGlyph; stats: OverlapStats } {
    const options = { maxHot: this.maxHot }
    const merged = mergeOverlaps(polygon, rule, options)
    if (!merged.stats.tooComplex) return merged
    const vertices = countVertices(polygon.contours)
    let tried = vertices
    let last: { result: { polygon: PolygonGlyph; stats: OverlapStats }; tolerance: number } | null = null
    const attempt = ({ contours, tolerance }: Reduction) => {
      tried = countVertices(contours)
      last = { result: mergeOverlaps(finish(polygon, contours, this.unitsPerEm), rule, options), tolerance }
      return !last.result.stats.tooComplex
    }
    // The coarsest simplification so far that was not tried: it is tried last, if nothing before it fits.
    let untried: Reduction | null = null
    let fits = false
    for (const reduction of reductions(polygon, this.unitsPerEm)) {
      // Each try has at most half the vertices of the one before.
      if (countVertices(reduction.contours) > tried / 2) {
        untried = reduction
        continue
      }
      untried = null
      if ((fits = attempt(reduction))) break
    }
    if (!fits && untried && countVertices(untried.contours) < tried) attempt(untried)
    if (!last) return merged
    const { result, tolerance } = last
    this.record(tolerance, vertices)
    return result
  }

  private record(tolerance: number, before: number) {
    this.stats.applied = true
    this.stats.tolerance = Math.max(this.stats.tolerance, tolerance)
    this.stats.before = Math.max(this.stats.before, before)
    this.reductions++
  }
}

/**
 * The glyph with at most `limit` vertices: every contour simplified with one shared tolerance, doubled from the warps'
 * drift limit until the glyph fits (see BUDGET_LIMITS.maxDoublings), and contours no larger than the tolerance left
 * out, but never all of them. Unchecked: the outlines may cross afterwards.
 */
function reduceToLimit(
  polygon: PolygonGlyph,
  limit: number,
  unitsPerEm: number,
): { polygon: PolygonGlyph; tolerance: number } {
  if (countVertices(polygon.contours) <= limit) return { polygon, tolerance: 0 }
  let last: Reduction | null = null
  for (const reduction of reductions(polygon, unitsPerEm)) {
    last = reduction
    if (countVertices(reduction.contours) <= limit) break
  }
  return last
    ? { polygon: finish(polygon, last.contours, unitsPerEm), tolerance: last.tolerance }
    : { polygon, tolerance: 0 }
}

/** The glyph's contours simplified with one tolerance (see simplifyContours). */
interface Reduction {
  contours: PolygonContour[]
  tolerance: number
}

/**
 * The glyph's contours simplified with each tolerance in turn, from the warps' drift limit, doubling (see
 * BUDGET_LIMITS.maxDoublings), as long as any contour is left.
 */
function* reductions(polygon: PolygonGlyph, unitsPerEm: number): Generator<Reduction> {
  const shapes = polygon.contours.map((contour) => ({
    contour,
    extent: extent(contour.points),
    width: width(contour.points),
    simple: lazy(() => countSelfCrossings(contour.points, 0) === 0),
  }))
  for (let doubling = 0; doubling <= BUDGET_LIMITS.maxDoublings; doubling++) {
    const tolerance = WARP_LIMITS.maxDrift * unitsPerEm * 2 ** doubling
    const contours = simplifyContours(shapes, tolerance)
    // Every contour smaller than the tolerance: the glyph before was the coarsest.
    if (contours.length === 0) return
    yield { contours, tolerance }
  }
}

/**
 * The glyph with the simplified contours. Leaving out vertices can leave gentle turns between short edges, which read
 * as a curve: such runs are broken up (see breakRuns).
 */
function finish(polygon: PolygonGlyph, contours: readonly PolygonContour[], unitsPerEm: number): PolygonGlyph {
  const shortEdge = WARP_LIMITS.shortEdge * unitsPerEm
  return {
    ...polygon,
    contours: contours.map((c) =>
      breakRuns(
        c,
        c.points.map(() => true),
        shortEdge,
      ),
    ),
  }
}

/** A contour with what decides whether it is left out (see simplifyContours). */
interface Shape {
  contour: PolygonContour
  /** The larger side of its box. */
  extent: number
  /** Twice its area over its perimeter: how wide it is on average. */
  width: number
  /** It does not cross itself. */
  simple: () => boolean
}

/**
 * Every contour simplified with `tolerance`, unchecked. Contours no larger than the tolerance are left out, and so are
 * those that collapse. So are slivers thinner than the tolerance on average: simplifying both sides of one would draw a
 * wider, wrong one. (A triangle stays as it is, and a contour that crosses itself can be much wider than its area says,
 * so both are kept.)
 */
function simplifyContours(shapes: readonly Shape[], tolerance: number): PolygonContour[] {
  const out: PolygonContour[] = []
  for (const { contour, extent, width, simple } of shapes) {
    if (extent <= tolerance || (width < tolerance && contour.points.length > 3 && simple())) continue
    const points = simplifyRing(contour.points, tolerance)
    const area = points.length >= 3 ? signedArea(points) : 0
    if (area !== 0) out.push({ points, clockwise: area < 0 })
  }
  return out
}

/**
 * RDP on a closed contour, split like simplifyClosed (see anchors.ts) at its first vertex and at the vertex farthest
 * from it, without its checks: a subset of the contour's vertices.
 */
function simplifyRing(points: Point[], tolerance: number): Point[] {
  const n = points.length
  if (n <= 3) return points
  let far = 1
  let farDist = -1
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y)
    if (d > farDist) {
      farDist = d
      far = i
    }
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[far] = 1
  rdpChain(points, 0, far, tolerance, keep)
  rdpChain(points, far, n, tolerance, keep)
  const out: Point[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}

function width(points: readonly Point[]): number {
  let perimeter = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    perimeter += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return perimeter > 0 ? (2 * Math.abs(signedArea(points))) / perimeter : 0
}

function extent(points: readonly Point[]): number {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  return Math.max(maxX - minX, maxY - minY)
}
