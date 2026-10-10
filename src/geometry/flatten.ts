// Curve flattening (linearization). Pure functions in font units; no React, no DOM.
//
// Every call rebuilds the polygon from the original curves, so repeated parameter changes never
// accumulate error, and the source glyph is never modified. The result is checked against a much
// finer flattening that stands in for the source curves: where an edge cuts across a stroke thinner
// than the tolerance, so the outline crosses itself or another contour, the curves involved are
// flattened again more finely.

import { ContourLayout } from './contourLayout'
import { addsCrossings, countSelfCrossings, findRingCrossings, findSelfCrossings, lazy } from './crossings'
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
  /**
   * Rounds of finer flattening for curves whose edges cross the outline where the source does not;
   * each round divides their tolerance by 4 (adaptive) or doubles their edges (fixed).
   */
  maxRefinements: 6,
} as const

/** Tolerance of the reference flattening that stands in for the source curves, per unit of em size. */
const REFERENCE_TOLERANCE_PER_EM = 1 / 5000
/** Contours with less area than this (square font units) enclose nothing and are left out. */
const MIN_AREA = 1e-6

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
  /** Curves flattened more finely than asked, so the outline does not cross itself or another contour. */
  refinedCurves: number
  /** Contours that still cross themselves or another contour at the finest flattening tried. */
  unresolvedContours: number
  /** Source contours with fewer than three distinct points or no area; they enclose nothing and are omitted. */
  droppedContours: number
}

export interface FlattenResult {
  polygon: PolygonGlyph
  /** The source contour each polygon contour comes from (dropped contours are skipped). */
  sources: number[]
  stats: FlattenStats
}

export class GeometryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeometryError'
  }
}

type Bezier = readonly Point[] // 3 points (quadratic) or 4 points (cubic)

/** What flattening a curve measures: the largest deviation, and curves that hit the subdivision limit. */
type Measure = Pick<FlattenStats, 'maxDeviation' | 'limitedCurves'>

/** One contour flattened without merging, with the source segment behind every edge. */
interface Flattened extends Measure {
  points: Point[]
  /** owners[i]: the source segment that produced points[i] (-1 for the start point). */
  owners: number[]
  /** The source segment that produced the closing edge, or -1 when the contour closes with an implied line. */
  closingOwner: number
  curves: number
  lines: number
}

export function flattenGlyph(source: SourceGlyph, params: FlattenParams): FlattenResult {
  const stats: FlattenStats = {
    curveCount: 0,
    mergedCurveCount: null,
    mergeFallbacks: 0,
    lineCount: 0,
    vertexCount: 0,
    maxDeviation: 0,
    limitedCurves: 0,
    refinedCurves: 0,
    unresolvedContours: 0,
    droppedContours: 0,
  }
  const settings = normalizeParams(params)
  const sourceContours = source.contours
  // Refinement level of every source segment; each level flattens that curve more finely.
  const levels = sourceContours.map((c) => new Uint8Array(c.segments.length))
  const runs = sourceContours.map((c, i) => flattenPlain(c, settings, levels[i]))

  const reference = lazy(() => {
    const tolerance = Math.max(FLATTEN_LIMITS.minTolerance, source.metrics.unitsPerEm * REFERENCE_TOLERANCE_PER_EM)
    return sourceContours.map((c) => flattenPlain(c, { ...settings, mode: 'adaptive', tolerance }, null).points)
  })
  const layout = lazy(() => new ContourLayout(reference()))
  const referenceCrossings = sourceContours.map((_, i) => lazy(() => countSelfCrossings(reference()[i])))
  // A contour without area in the source is dropped; one that only lost its area to coarse flattening is refined.
  const isEmpty = sourceContours.map((_, i) => lazy(() => !enclosesArea(reference()[i])))

  for (let round = 0; ; round++) {
    const damage = findDamage(runs, layout, referenceCrossings, isEmpty)
    stats.unresolvedContours = damage.size
    if (damage.size === 0 || round === FLATTEN_LIMITS.maxRefinements) break
    let refined = false
    for (const [i, segments] of damage) {
      const contour = sourceContours[i]
      let changed = false
      for (const s of segments === 'all' ? contour.segments.keys() : segments) {
        if (contour.segments[s].type !== 'line' && levels[i][s] < FLATTEN_LIMITS.maxRefinements) {
          levels[i][s]++
          changed = true
        }
      }
      if (changed) runs[i] = flattenPlain(contour, settings, levels[i])
      refined ||= changed
    }
    if (!refined) break
  }

  const kept = runs.flatMap((run, i) => (enclosesArea(run.points) ? [i] : []))
  stats.droppedContours = sourceContours.length - kept.length
  // Contours as they stand, by source index (null: dropped); merged contours replace them one by one.
  const current: (Point[] | null)[] = runs.map((run, i) => (kept.includes(i) ? run.points : null))
  if (settings.mergeCurves) stats.mergedCurveCount = 0
  for (const i of kept) {
    const run = runs[i]
    stats.refinedCurves += levels[i].reduce((n, level) => n + (level > 0 ? 1 : 0), 0)
    stats.curveCount += run.curves
    stats.lineCount += run.lines
    if (settings.mergeCurves) {
      // Merging is coarse by design; a merged contour that collapses, flips, crosses itself, or
      // disturbs another contour falls back to the unmerged result (same mode).
      const merged = flattenMerged(sourceContours[i], settings)
      if (isValidMerge(merged.points, run.points, referenceCrossings[i]) && layout().keeps(current, i, merged.points)) {
        current[i] = merged.points
        stats.mergedCurveCount! += merged.runs
        stats.maxDeviation = Math.max(stats.maxDeviation, merged.deviation)
        continue
      }
      stats.mergeFallbacks++
      stats.mergedCurveCount! += run.curves
    }
    stats.maxDeviation = Math.max(stats.maxDeviation, run.maxDeviation)
    stats.limitedCurves += run.limitedCurves
  }

  const contours: PolygonContour[] = kept.map((i) => {
    const points = current[i]!
    stats.vertexCount += points.length
    return { points, clockwise: signedArea(points) < 0 }
  })
  return {
    polygon: { ref: source.ref, metrics: { ...source.metrics }, contours },
    sources: kept,
    stats,
  }
}

/**
 * Contours whose flattening damaged the outline, with the source segments to flatten more finely
 * ('all' when no particular edge is to blame): crossings the source does not have, within a contour or
 * between two, a contour that moved into or out of another, and contours that lost all their area.
 */
function findDamage(
  runs: readonly Flattened[],
  layout: () => ContourLayout,
  referenceCrossings: readonly (() => number)[],
  isEmpty: readonly (() => boolean)[],
): Map<number, Set<number> | 'all'> {
  const damage = new Map<number, Set<number> | 'all'>()
  const blame = (i: number, edge: number) => {
    const run = runs[i]
    const owner = edge + 1 < run.points.length ? run.owners[edge + 1] : run.closingOwner
    const segments = damage.get(i) ?? new Set<number>()
    if (segments === 'all') return
    if (owner >= 0) segments.add(owner)
    damage.set(i, segments)
  }
  const live: number[] = []
  runs.forEach((run, i) => {
    if (!enclosesArea(run.points)) {
      if (!isEmpty[i]()) damage.set(i, 'all')
      return
    }
    live.push(i)
    if (addsCrossings(run.points, referenceCrossings[i])) {
      for (const c of findSelfCrossings(run.points)) {
        blame(i, c.i)
        blame(i, c.j)
      }
    }
  })
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) {
      const i = live[a]
      const j = live[b]
      if (layout().pairKept(i, j, runs[i].points, runs[j].points)) continue
      const found = findRingCrossings(runs[i].points, runs[j].points)
      if (found.length === 0) {
        damage.set(i, 'all')
        damage.set(j, 'all')
      }
      for (const c of found) {
        blame(i, c.i)
        blame(j, c.j)
      }
    }
  }
  return damage
}

const enclosesArea = (points: readonly Point[]) => points.length >= 3 && Math.abs(signedArea(points)) >= MIN_AREA

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

/** Collects a contour's points, skipping repeats; non-finite coordinates are an error. */
function collector() {
  const points: Point[] = []
  const push = (p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new GeometryError('The glyph contains a non-finite coordinate.')
    }
    const last = points[points.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) {
      points.push({ x: p.x, y: p.y })
      return true
    }
    return false
  }
  return { points, push }
}

/**
 * Flattens every curve of the contour on its own. `levels` refines single curves: each level divides
 * the tolerance by 4 (adaptive) or doubles the edges (fixed).
 */
function flattenPlain(contour: SourceContour, params: FlattenParams, levels: Uint8Array | null): Flattened {
  const { points, push } = collector()
  const owners: number[] = []
  let owner = -1
  const add = (p: Point) => {
    if (push(p)) owners.push(owner)
  }
  const result: Flattened = { points, owners, closingOwner: -1, curves: 0, lines: 0, maxDeviation: 0, limitedCurves: 0 }

  add(contour.start)
  let prev = contour.start
  contour.segments.forEach((seg, s) => {
    owner = s
    if (seg.type === 'line') {
      result.lines++
      add(seg.to)
    } else {
      result.curves++
      const level = levels?.[s] ?? 0
      const curve: Bezier =
        seg.type === 'quad' ? [prev, seg.control, seg.to] : [prev, seg.control1, seg.control2, seg.to]
      if (params.mode === 'segments') {
        flattenFixed(curve, Math.min(FLATTEN_LIMITS.maxSegments, params.segmentsPerCurve * 2 ** level), add, result)
      } else {
        flattenAdaptive(curve, Math.max(FLATTEN_LIMITS.minTolerance, params.tolerance / 4 ** level), add, result)
      }
    }
    prev = seg.to
  })

  // The polygon is closed implicitly; drop an explicit closing point that repeats the start.
  if (closeOut(points)) result.closingOwner = owners.pop()!
  return result
}

/** Minimum edges for a merged curve that runs all the way around a smooth, corner-free contour. */
const MIN_LOOP_EDGES = 3

function flattenMerged(contour: SourceContour, params: FlattenParams) {
  const { points, push } = collector()
  push(contour.start)
  const items = buildCurveRuns(contour, params.breakAt, params.cornerAngle, params.mergeLines)
  const loop = items.length === 1 && items[0].kind === 'run'
  const result = { points, runs: 0, deviation: 0 }
  for (const item of items) {
    if (item.kind === 'line') {
      push(item.to)
    } else {
      result.runs++
      const minEdges = loop ? MIN_LOOP_EDGES : 1
      const deviation =
        params.mode === 'segments'
          ? sampleRun(item.pieces, Math.max(minEdges, params.segmentsPerCurve), push)
          : simplifyRun(item.pieces, params.tolerance, minEdges, push)
      result.deviation = Math.max(result.deviation, deviation)
    }
  }
  closeOut(points)
  return result
}

function isValidMerge(points: Point[], unmerged: Point[], referenceCrossings: () => number): boolean {
  if (!enclosesArea(points)) return false
  if (Math.sign(signedArea(points)) !== Math.sign(signedArea(unmerged))) return false
  return !addsCrossings(points, referenceCrossings)
}

/** Drops an explicit closing point that repeats the start; true when one was dropped. */
function closeOut(out: Point[]): boolean {
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (first.x === last.x && first.y === last.y) {
      out.pop()
      return true
    }
  }
  return false
}

// ---- Fixed mode: N edges per curve, sampled at t = i / N ----

function flattenFixed(curve: Bezier, n: number, push: (p: Point) => void, stats: Measure) {
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

function flattenAdaptive(curve: Bezier, tolerance: number, push: (p: Point) => void, stats: Measure) {
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

function recordDeviation(curve: Bezier, t: number, a: Point, b: Point, stats: Measure) {
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
