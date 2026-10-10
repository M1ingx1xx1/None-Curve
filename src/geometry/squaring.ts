// Squaring: pushes round contours toward rectangles, deliberately changing the letterform.
// Pure functions in font units; no React, no DOM. Inputs are never modified.
//
// Each contour is normalized to its own bounding box, u = (x − cx) / hx, v = (y − cy) / hy, so the
// box edge is where the square (L∞) radius r∞ = max(|u|, |v|) equals 1. At full amount every point is
// moved radially from the box centre onto the box edge (scale 1 / r∞): a circle, ellipse, or
// superellipse becomes exactly its bounding rectangle, with flat sides and sharp corners. A counter is
// normalized to its own box, so it becomes a smaller concentric rectangle and the stroke thickness at
// the side midpoints — where every point already touches its box — is unchanged. Amount blends
// linearly between the original and the rectangle.

import { ContourLayout } from './contourLayout'
import { addsCrossings, countSelfCrossings, lazy } from './crossings'
import { signedArea } from './flatten'
import type { Point, PolygonContour, PolygonGlyph } from './types'

export type SquaringScope = 'round' | 'all'

export interface SquaringParams {
  /** 0 = off, 1 = round contours become their bounding rectangle. */
  amount: number
  /** 'round' squares only contours close to an ellipse; 'all' squares every contour. */
  scope: SquaringScope
}

/** Mean deviation from the ellipse fitted to the bounding box, below which a contour counts as fully round. */
export const ROUND_FULL = 0.06
/** Mean deviation above which a contour is not treated as round at all. */
export const ROUND_NONE = 0.16

export interface SquaringStats {
  applied: boolean
  /** Contours squared at the full amount. */
  squared: number
  /** Contours squared partly because they are only somewhat round. */
  partial: number
  /** Contours left alone because they are not round (scope 'round'). */
  notRound: number
  /** Contours squared less than asked because the full amount would make them invalid. */
  reduced: number
  /** Contours that kept their previous points because even a small amount was invalid. */
  fallbacks: { reason: SquaringFailure }[]
}

/** Why squaring a contour was invalid; 'contours': it would cross another contour, or leave or enter one. */
export type SquaringFailure = 'collapsed' | 'flipped' | 'crossings' | 'contours'

/** Bisection steps when searching for the largest valid amount, and the smallest share worth using. */
const REDUCE_STEPS = 8
const REDUCE_MIN = 0.05
/**
 * The largest valid share sits right at the edge of validity (the outline almost touches itself), so
 * any later step such as distortion would push it over. Back off to this fraction of it when valid.
 */
const REDUCE_MARGIN = 0.85

export function applySquaring(polygon: PolygonGlyph, params: SquaringParams): { polygon: PolygonGlyph; stats: SquaringStats } {
  const stats: SquaringStats = { applied: false, squared: 0, partial: 0, notRound: 0, reduced: 0, fallbacks: [] }
  const amount = Number.isFinite(params.amount) ? Math.min(1, Math.max(0, params.amount)) : 0
  if (amount === 0) return { polygon, stats }
  stats.applied = true

  const current = polygon.contours.map((c) => c.points)
  const layout = new ContourLayout(current.slice())
  const contours = polygon.contours.map((contour, index): PolygonContour => {
    const box = boundingBox(contour.points)
    if (!box || contour.points.length < 3) return contour
    const weight = params.scope === 'all' ? 1 : roundnessWeight(contour.points, box)
    if (weight === 0) {
      stats.notRound++
      return contour
    }
    const k = amount * weight
    // The contour's own crossings, counted once for all the checks below.
    const crossings = lazy(() => countSelfCrossings(contour.points))
    const check = (after: readonly Point[]) =>
      validate(contour.points, after, crossings) ?? (layout.keeps(current, index, after) ? null : 'contours')
    let points = squareContour(contour.points, box, k)
    const reason = check(points)
    if (reason) {
      // Instead of dropping the whole effect, use the largest share of the amount that stays valid
      // (bisection; the share found is always a valid one), so the letter is still squared, just less.
      let lo = 0
      let hi = 1
      let best: Point[] | null = null
      for (let i = 0; i < REDUCE_STEPS; i++) {
        const mid = (lo + hi) / 2
        const candidate = squareContour(contour.points, box, k * mid)
        if (check(candidate)) hi = mid
        else {
          lo = mid
          best = candidate
        }
      }
      if (!best || lo < REDUCE_MIN) {
        stats.fallbacks.push({ reason })
        return contour
      }
      const safer = squareContour(contour.points, box, k * lo * REDUCE_MARGIN)
      stats.reduced++
      points = check(safer) ? best : safer
    } else if (weight >= 0.999) stats.squared++
    else stats.partial++
    current[index] = points
    return { points, clockwise: signedArea(points) < 0 }
  })

  return { polygon: { ...polygon, contours }, stats }
}

interface Box {
  cx: number
  cy: number
  hx: number
  hy: number
}

function boundingBox(points: readonly Point[]): Box | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const hx = (maxX - minX) / 2
  const hy = (maxY - minY) / 2
  if (!(hx > 1e-6 && hy > 1e-6)) return null
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, hx, hy }
}

/**
 * 1 for contours close to the ellipse that fills their bounding box (like the bowls and counters of
 * O, o, 0), 0 for clearly non-round contours (triangles, stems, S-curves), linear in between. The
 * deviation is the edge-length-weighted mean of |r₂ − 1| in normalized box coordinates.
 */
export function roundnessWeight(points: readonly Point[], box: Box): number {
  const n = points.length
  let sum = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const w = (Math.hypot(p.x - prev.x, p.y - prev.y) + Math.hypot(next.x - p.x, next.y - p.y)) / 2
    const r = Math.hypot((p.x - box.cx) / box.hx, (p.y - box.cy) / box.hy)
    sum += Math.abs(r - 1) * w
    total += w
  }
  const deviation = total > 0 ? sum / total : 1
  return Math.min(1, Math.max(0, (ROUND_NONE - deviation) / (ROUND_NONE - ROUND_FULL)))
}

function squareContour(points: readonly Point[], box: Box, k: number): Point[] {
  const mapped = points.map((p) => {
    const u = (p.x - box.cx) / box.hx
    const v = (p.y - box.cy) / box.hy
    const rInf = Math.max(Math.abs(u), Math.abs(v))
    if (rInf < 1e-9) return { u, v }
    const f = 1 + (1 / rInf - 1) * k
    return { u: u * f, v: v * f }
  })

  // Between a point on a vertical side (|u| ≥ |v|) and the next on a horizontal side of the same
  // quadrant, insert the corner so squares get sharp corners instead of a chamfer. Its distance from
  // the chamfer grows with k, so the corner sharpens gradually.
  const out: Point[] = []
  const toFont = (u: number, v: number) => ({ x: box.cx + u * box.hx, y: box.cy + v * box.hy })
  for (let i = 0; i < mapped.length; i++) {
    const a = mapped[i]
    const b = mapped[(i + 1) % mapped.length]
    out.push(toFont(a.u, a.v))
    const sameQuadrant = Math.sign(a.u) === Math.sign(b.u) && Math.sign(a.v) === Math.sign(b.v)
    const aVertical = Math.abs(a.u) >= Math.abs(a.v)
    const bVertical = Math.abs(b.u) >= Math.abs(b.v)
    if (k > 0 && sameQuadrant && aVertical !== bVertical) {
      const corner = aVertical ? { u: a.u, v: b.v } : { u: b.u, v: a.v }
      const mid = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 }
      const c = { u: mid.u + (corner.u - mid.u) * k, v: mid.v + (corner.v - mid.v) * k }
      const isNew = Math.hypot(c.u - a.u, c.v - a.v) > 1e-6 && Math.hypot(c.u - b.u, c.v - b.v) > 1e-6
      if (isNew) out.push(toFont(c.u, c.v))
    }
  }
  return out
}

function validate(before: readonly Point[], after: readonly Point[], beforeCrossings: () => number): SquaringFailure | null {
  if (after.length < 3) return 'collapsed'
  for (let i = 0; i < after.length; i++) {
    const a = after[i]
    const b = after[(i + 1) % after.length]
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return 'collapsed'
  }
  const a0 = signedArea(before)
  const a1 = signedArea(after)
  if (Math.abs(a1) < 1e-6) return 'collapsed'
  if (Math.sign(a1) !== Math.sign(a0)) return 'flipped'
  if (addsCrossings(after, beforeCrossings)) return 'crossings'
  return null
}
