// Geometric constraints on the reduced polygon: grid snapping, then angle lock.
// Pure functions in font units; no React, no DOM. Inputs are never modified.

import { countSelfCrossings } from './anchors'
import { signedArea } from './flatten'
import type { GridParams, Point, PolygonContour, PolygonGlyph } from './types'

export const ANGLE_STEPS = [90, 45, 30, 15] as const

/** Edges shorter than this after angle lock (font units) make the contour fall back. */
const MIN_EDGE = 0.5

export type FallbackReason = 'collapsed' | 'flipped' | 'crossings' | 'unsolvable'

export interface ConstraintStats {
  snapApplied: boolean
  /** Vertices merged because snapping moved neighbours onto the same grid point. */
  snapMerged: number
  /** Largest distance a vertex moved while snapping (font units). */
  snapMaxShift: number
  angleApplied: boolean
  /** Largest distance a vertex moved under angle lock (font units). */
  angleMaxShift: number
  /** Contours that kept their pre-step points, by step and reason. */
  fallbacks: { step: 'snap' | 'angle'; reason: FallbackReason }[]
}

export function applyConstraints(polygon: PolygonGlyph, params: GridParams): { polygon: PolygonGlyph; stats: ConstraintStats } {
  const stats: ConstraintStats = {
    snapApplied: false,
    snapMerged: 0,
    snapMaxShift: 0,
    angleApplied: false,
    angleMaxShift: 0,
    fallbacks: [],
  }
  let contours = polygon.contours

  const size = Number.isFinite(params.size) ? params.size : 0
  if (params.snap && size > 0) {
    stats.snapApplied = true
    contours = contours.map((c) => {
      const result = snapContour(c.points, size)
      const reason = result.points ? validate(c.points, result.points) : 'collapsed'
      if (reason) {
        stats.fallbacks.push({ step: 'snap', reason })
        return c
      }
      stats.snapMerged += result.merged
      stats.snapMaxShift = Math.max(stats.snapMaxShift, result.maxShift)
      return withPoints(result.points!)
    })
  }

  const step = ANGLE_STEPS.includes(params.angleStep as (typeof ANGLE_STEPS)[number]) ? params.angleStep : 45
  if (params.angleLock) {
    stats.angleApplied = true
    contours = contours.map((c) => {
      const result = lockAngles(c.points, step)
      const reason = result.points ? validate(c.points, result.points) : result.reason
      if (reason) {
        stats.fallbacks.push({ step: 'angle', reason })
        return c
      }
      stats.angleMaxShift = Math.max(stats.angleMaxShift, maxShift(c.points, result.points!))
      return withPoints(result.points!)
    })
  }

  return { polygon: { ...polygon, contours }, stats }
}

function withPoints(points: Point[]): PolygonContour {
  return { points, clockwise: signedArea(points) < 0 }
}

/**
 * A constrained contour is valid when it keeps at least three distinct points, the same winding
 * direction with non-zero area, and no more self-crossings than before the step.
 */
function validate(before: readonly Point[], after: readonly Point[]): FallbackReason | null {
  if (after.length < 3 || new Set(after.map((p) => `${p.x},${p.y}`)).size !== after.length) return 'collapsed'
  const a0 = signedArea(before)
  const a1 = signedArea(after)
  if (Math.abs(a1) < 1e-6) return 'collapsed'
  if (Math.sign(a1) !== Math.sign(a0)) return 'flipped'
  const crossings = countSelfCrossings(after)
  if (crossings > 0 && crossings > countSelfCrossings(before)) return 'crossings'
  return null
}

function maxShift(a: readonly Point[], b: readonly Point[]): number {
  let max = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) max = Math.max(max, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y))
  return max
}

// ---- Grid snapping ----

/** Rounds to the nearest multiple of `size`; exact halves round toward +∞ (Math.round). */
export function snapValue(v: number, size: number): number {
  const snapped = Math.round(v / size) * size
  // Clean floating noise such as 0.30000000000000004 so equal grid points compare equal.
  return Number(snapped.toFixed(6)) + 0
}

/**
 * Snaps every vertex to the grid anchored at the glyph origin (0, 0), so the baseline and the left
 * edge of the advance box are grid lines. Consecutive vertices that land on the same grid point are
 * merged; the first vertex stays first, and a last vertex equal to it is dropped.
 */
function snapContour(points: readonly Point[], size: number): { points: Point[] | null; merged: number; maxShift: number } {
  const out: Point[] = []
  let maxShift = 0
  for (const p of points) {
    const q = { x: snapValue(p.x, size), y: snapValue(p.y, size) }
    maxShift = Math.max(maxShift, Math.hypot(q.x - p.x, q.y - p.y))
    const last = out[out.length - 1]
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q)
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop()
  return { points: out.length >= 3 ? out : null, merged: points.length - out.length, maxShift }
}

// ---- Angle lock ----

/**
 * Nearest allowed direction for an angle in degrees. Allowed directions are multiples of `step`
 * measured counter-clockwise from +x in y-up font space. An exact tie rounds up (counter-clockwise).
 */
export function nearestAllowedAngle(degrees: number, step: number): number {
  const normalized = ((degrees % 360) + 360) % 360
  return (Math.round(normalized / step) * step) % 360
}

/**
 * Turns every edge to its nearest allowed direction, then adjusts edge lengths (never directions)
 * so the contour closes again. The adjustment is the weighted least-squares change of lengths that
 * makes the edge vectors sum to zero, with each edge weighted by its length so long edges absorb
 * more of the correction. The start vertex is the fixed reference; all other vertices follow from
 * the adjusted edges, so neighbouring edges stay connected and the contour stays closed.
 */
function lockAngles(points: readonly Point[], step: number): { points: Point[] | null; reason: FallbackReason | null } {
  const n = points.length
  if (n < 3) return { points: null, reason: 'collapsed' }

  const dirs: Point[] = []
  const lengths: number[] = []
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const angle = (nearestAllowedAngle((Math.atan2(dy, dx) * 180) / Math.PI, step) * Math.PI) / 180
    const u = { x: Math.cos(angle), y: Math.sin(angle) }
    dirs.push(u)
    // Projection onto the locked direction; positive because the turn is at most step / 2 ≤ 45°.
    lengths.push(dx * u.x + dy * u.y)
  }

  // Residual r = Σ lᵢuᵢ; solve (Σ wᵢuᵢuᵢᵀ) λ = r and set lᵢ' = lᵢ − wᵢ (uᵢ·λ).
  let rx = 0
  let ry = 0
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const { x, y } = dirs[i]
    const w = Math.max(lengths[i], 0)
    rx += lengths[i] * x
    ry += lengths[i] * y
    sxx += w * x * x
    sxy += w * x * y
    syy += w * y * y
  }
  const det = sxx * syy - sxy * sxy
  let lambda = { x: 0, y: 0 }
  if (Math.hypot(rx, ry) > 1e-9) {
    // All edges parallel: no length change can close the contour.
    if (Math.abs(det) < 1e-9) return { points: null, reason: 'unsolvable' }
    lambda = { x: (syy * rx - sxy * ry) / det, y: (sxx * ry - sxy * rx) / det }
  }

  const out: Point[] = [{ x: points[0].x, y: points[0].y }]
  for (let i = 0; i < n; i++) {
    const w = Math.max(lengths[i], 0)
    const length = lengths[i] - w * (dirs[i].x * lambda.x + dirs[i].y * lambda.y)
    // A non-positive or tiny length would reverse or collapse the edge.
    if (length < MIN_EDGE) return { points: null, reason: 'unsolvable' }
    if (i < n - 1) {
      const p = out[i]
      out.push({ x: p.x + length * dirs[i].x, y: p.y + length * dirs[i].y })
    }
  }
  return { points: out, reason: null }
}
