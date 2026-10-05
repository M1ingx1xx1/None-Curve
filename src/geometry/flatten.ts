// Curve flattening (linearization). Pure functions in font units; no React, no DOM.
//
// Every call rebuilds the polygon from the original curves, so repeated parameter changes never
// accumulate error, and the source glyph is never modified.

import { countSelfCrossings } from './anchors'
import { buildCurveRuns, sampleRun, simplifyRun } from './curveRuns'
import type { FlattenParams, Point, PolygonContour, PolygonGlyph, SourceContour, SourceGlyph } from './types'

/** Hard limits that keep pathological input (huge or degenerate curves) from running away. */
export const FLATTEN_LIMITS = {
  minTolerance: 0.01,
  maxTolerance: 1000,
  minSegments: 1,
  maxSegments: 256,
  /** Adaptive recursion depth: at most 2^12 = 4096 edges per curve. */
  maxDepth: 12,
  /** Sub-curves whose control polygon is shorter than this (font units) are not split further. */
  minLength: 0.01,
} as const

export interface FlattenStats {
  /** Quadratic and cubic segments in the source. */
  curveCount: number
  /** Curves after merging (fixed mode with merging on); null when merging is off. */
  mergedCurveCount: number | null
  /** Contours where the merged result was invalid and the unmerged result was used instead. */
  mergeFallbacks: number
  /** Straight source segments, copied as-is. */
  lineCount: number
  vertexCount: number
  /**
   * Largest distance between a curve and the edge that replaces it, measured at the parametric
   * midpoint of every edge (font units). An estimate, not a strict bound.
   */
  maxDeviation: number
  /** Curves where adaptive subdivision stopped at the depth or length limit before meeting tolerance. */
  limitedCurves: number
  /** Source contours with fewer than three distinct points; they enclose no area and are omitted. */
  droppedContours: number
}

export interface FlattenResult {
  polygon: PolygonGlyph
  stats: FlattenStats
}

export class GeometryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeometryError'
  }
}

type Bezier = readonly Point[] // 3 points (quadratic) or 4 points (cubic)

export function flattenGlyph(source: SourceGlyph, params: FlattenParams): FlattenResult {
  const stats: FlattenStats = {
    curveCount: 0,
    mergedCurveCount: null,
    mergeFallbacks: 0,
    lineCount: 0,
    vertexCount: 0,
    maxDeviation: 0,
    limitedCurves: 0,
    droppedContours: 0,
  }
  const settings = normalizeParams(params)
  const contours: PolygonContour[] = []

  for (const contour of source.contours) {
    const points = flattenContour(contour, settings, stats)
    if (points.length < 3) {
      stats.droppedContours++
      continue
    }
    contours.push({ points, clockwise: signedArea(points) < 0 })
    stats.vertexCount += points.length
  }

  return {
    polygon: { ref: source.ref, metrics: { ...source.metrics }, contours },
    stats,
  }
}

function normalizeParams(params: FlattenParams): FlattenParams {
  const { minTolerance, maxTolerance, minSegments, maxSegments } = FLATTEN_LIMITS
  const tolerance = Number.isFinite(params.tolerance) ? params.tolerance : 1
  const segments = Number.isFinite(params.segmentsPerCurve) ? Math.round(params.segmentsPerCurve) : 1
  const cornerAngle = Number.isFinite(params.cornerAngle) ? Math.min(90, Math.max(0, params.cornerAngle)) : 15
  return {
    mode: params.mode,
    tolerance: Math.min(maxTolerance, Math.max(minTolerance, tolerance)),
    segmentsPerCurve: Math.min(maxSegments, Math.max(minSegments, segments)),
    mergeCurves: Boolean(params.mergeCurves),
    mergeLines: Boolean(params.mergeLines),
    breakAt: params.breakAt === 'corners' ? 'corners' : 'extrema',
    cornerAngle,
  }
}

function flattenContour(contour: SourceContour, params: FlattenParams, stats: FlattenStats): Point[] {
  const out: Point[] = []
  const push = (p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new GeometryError('The glyph contains a non-finite coordinate.')
    }
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push({ x: p.x, y: p.y })
  }

  push(contour.start)

  if (params.mergeCurves) {
    const merged = flattenMerged(contour, params, push)
    const points = closeOut(out)
    // Merging is coarse by design; reject results that collapse, flip, or add self-crossings and
    // fall back to the unmerged result (same mode) for this contour.
    const unmergedStats = emptyStats()
    const unmerged = flattenContour(contour, { ...params, mergeCurves: false }, unmergedStats)
    stats.mergedCurveCount ??= 0
    if (isValidMerge(points, unmerged)) {
      stats.curveCount += merged.curves
      stats.lineCount += merged.lines
      stats.mergedCurveCount += merged.runs
      stats.maxDeviation = Math.max(stats.maxDeviation, merged.deviation)
      return points
    }
    stats.mergeFallbacks++
    stats.curveCount += unmergedStats.curveCount
    stats.lineCount += unmergedStats.lineCount
    stats.mergedCurveCount += unmergedStats.curveCount
    stats.maxDeviation = Math.max(stats.maxDeviation, unmergedStats.maxDeviation)
    return unmerged
  }

  let prev = contour.start
  for (const seg of contour.segments) {
    if (seg.type === 'line') {
      stats.lineCount++
      push(seg.to)
    } else {
      stats.curveCount++
      const curve: Bezier =
        seg.type === 'quad' ? [prev, seg.control, seg.to] : [prev, seg.control1, seg.control2, seg.to]
      if (params.mode === 'segments') flattenFixed(curve, params.segmentsPerCurve, push, stats)
      else flattenAdaptive(curve, params.tolerance, push, stats)
    }
    prev = seg.to
  }

  return closeOut(out)
}

function emptyStats(): FlattenStats {
  return {
    curveCount: 0,
    mergedCurveCount: null,
    mergeFallbacks: 0,
    lineCount: 0,
    vertexCount: 0,
    maxDeviation: 0,
    limitedCurves: 0,
    droppedContours: 0,
  }
}

/** Minimum edges for a merged curve that runs all the way around a smooth, corner-free contour. */
const MIN_LOOP_EDGES = 3

function flattenMerged(contour: SourceContour, params: FlattenParams, push: (p: Point) => void) {
  const items = buildCurveRuns(contour, params.breakAt, params.cornerAngle, params.mergeLines)
  const loop = items.length === 1 && items[0].kind === 'run'
  const result = { curves: 0, lines: 0, runs: 0, deviation: 0 }
  for (const item of items) {
    if (item.kind === 'line') {
      result.lines++
      push(item.to)
    } else {
      result.curves += item.sourceCurves
      result.lines += item.sourceLines
      result.runs++
      const minEdges = loop ? MIN_LOOP_EDGES : 1
      const deviation =
        params.mode === 'segments'
          ? sampleRun(item.pieces, Math.max(minEdges, params.segmentsPerCurve), push)
          : simplifyRun(item.pieces, params.tolerance, minEdges, push)
      result.deviation = Math.max(result.deviation, deviation)
    }
  }
  return result
}

function isValidMerge(points: Point[], unmerged: Point[]): boolean {
  if (points.length < 3 || unmerged.length < 3) return points.length >= 3 || unmerged.length < 3
  const area = signedArea(points)
  if (Math.abs(area) < 1e-6 || Math.sign(area) !== Math.sign(signedArea(unmerged))) return false
  const crossings = countSelfCrossings(points)
  return crossings === 0 || crossings <= countSelfCrossings(unmerged)
}

/** The polygon is closed implicitly; drop an explicit closing point that repeats the start. */
function closeOut(out: Point[]): Point[] {
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (first.x === last.x && first.y === last.y) out.pop()
  }
  return out
}

// ---- Fixed mode: N edges per curve, sampled at t = i / N ----

function flattenFixed(curve: Bezier, n: number, push: (p: Point) => void, stats: FlattenStats) {
  let prev = curve[0]
  for (let i = 1; i <= n; i++) {
    const p = evaluate(curve, i / n)
    recordDeviation(curve, (i - 0.5) / n, prev, p, stats)
    push(p)
    prev = p
  }
}

// ---- Adaptive mode: recursive midpoint subdivision until a flatness bound meets the tolerance ----

/**
 * Upper bound on how far a Bézier curve strays from its chord. A curve lies inside the convex hull of
 * its control points; for a quadratic the bound is half the control point's distance from the chord,
 * for a cubic three quarters of the larger control distance.
 */
export function flatnessBound(curve: Bezier): number {
  const a = curve[0]
  const b = curve[curve.length - 1]
  if (curve.length === 3) return distanceToLine(curve[1], a, b) / 2
  return (3 / 4) * Math.max(distanceToLine(curve[1], a, b), distanceToLine(curve[2], a, b))
}

function flattenAdaptive(curve: Bezier, tolerance: number, push: (p: Point) => void, stats: FlattenStats) {
  let limited = false

  const recurse = (part: Bezier, t0: number, t1: number, depth: number) => {
    const flatEnough = flatnessBound(part) <= tolerance
    const tooSmall = controlPolygonLength(part) < FLATTEN_LIMITS.minLength
    if (flatEnough || tooSmall || depth >= FLATTEN_LIMITS.maxDepth) {
      if (!flatEnough) limited = true
      const start = part[0]
      const end = part[part.length - 1]
      recordDeviation(curve, (t0 + t1) / 2, start, end, stats)
      push(end)
      return
    }
    const [left, right] = split(part)
    const tm = (t0 + t1) / 2
    recurse(left, t0, tm, depth + 1)
    recurse(right, tm, t1, depth + 1)
  }

  recurse(curve, 0, 1, 0)
  if (limited) stats.limitedCurves++
}

// ---- Bézier helpers ----

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** De Casteljau evaluation; also exact at t = 0 and t = 1. */
export function evaluate(curve: Bezier, t: number): Point {
  if (t <= 0) return curve[0]
  if (t >= 1) return curve[curve.length - 1]
  let pts = curve.slice()
  while (pts.length > 1) {
    const next: Point[] = []
    for (let i = 0; i < pts.length - 1; i++) next.push(lerp(pts[i], pts[i + 1], t))
    pts = next
  }
  return pts[0]
}

/** Splits a curve at t = 0.5 into two curves of the same degree. */
function split(curve: Bezier): [Point[], Point[]] {
  const left: Point[] = [curve[0]]
  const right: Point[] = [curve[curve.length - 1]]
  let pts = curve.slice()
  while (pts.length > 1) {
    const next: Point[] = []
    for (let i = 0; i < pts.length - 1; i++) next.push(lerp(pts[i], pts[i + 1], 0.5))
    left.push(next[0])
    right.unshift(next[next.length - 1])
    pts = next
  }
  return [left, right]
}

function controlPolygonLength(curve: Bezier): number {
  let length = 0
  for (let i = 1; i < curve.length; i++) length += Math.hypot(curve[i].x - curve[i - 1].x, curve[i].y - curve[i - 1].y)
  return length
}

function distanceToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function recordDeviation(curve: Bezier, t: number, a: Point, b: Point, stats: FlattenStats) {
  const d = distanceToSegment(evaluate(curve, t), a, b)
  if (d > stats.maxDeviation) stats.maxDeviation = d
}

/** Shoelace area; positive for counter-clockwise contours in y-up font space. */
export function signedArea(points: readonly Point[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}
