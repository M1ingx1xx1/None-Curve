// Anchor control on flattened polygons: spacing (subdivide edges) and reduction (RDP simplification).
// Pure functions in font units; no React, no DOM. Inputs are never modified.

import { ContourLayout } from './contourLayout'
import { addsCrossings, countSelfCrossings } from './crossings'
import { signedArea } from './flatten'
import type { AnchorParams, Point, PolygonContour, PolygonGlyph } from './types'

export const ANCHOR_LIMITS = {
  /** Spacing below this (font units) is raised to it. */
  minSpacing: 1,
  /** Spacing is skipped for a glyph if it would produce more vertices than this. */
  maxVertices: 50_000,
} as const

export interface AnchorStats {
  /** Vertices coming out of flattening. */
  flattenedVertices: number
  /** Vertices after spacing (equal to flattenedVertices when spacing is off or skipped). */
  spacedVertices: number
  /** Vertices after reduction: the final polygon. */
  finalVertices: number
  spacingApplied: boolean
  /** Spacing was requested but would exceed ANCHOR_LIMITS.maxVertices, so it was skipped. */
  spacingSkipped: boolean
  reductionApplied: boolean
  /** Largest distance from a removed vertex to the simplified outline (font units). */
  reductionMaxDeviation: number
  /**
   * Contours whose simplified version was invalid (collapsed, flipped, crossed itself, or moved across
   * another contour) and was replaced by the unsimplified contour.
   */
  reductionFallbacks: number
  /**
   * Contours that already cross themselves in the font. Reduction may keep, but not add, crossings
   * on these contours.
   */
  selfCrossingContours: number
}

/** Runs spacing, then reduction, on a flattened polygon. Order is fixed. */
export function applyAnchorControls(polygon: PolygonGlyph, params: AnchorParams): { polygon: PolygonGlyph; stats: AnchorStats } {
  const flattenedVertices = countVertices(polygon)
  const stats: AnchorStats = {
    flattenedVertices,
    spacedVertices: flattenedVertices,
    finalVertices: flattenedVertices,
    spacingApplied: false,
    spacingSkipped: false,
    reductionApplied: false,
    reductionMaxDeviation: 0,
    reductionFallbacks: 0,
    selfCrossingContours: 0,
  }

  let contours = polygon.contours
  const spacing = Number.isFinite(params.spacing) ? params.spacing : 0
  if (spacing > 0) {
    const target = Math.max(ANCHOR_LIMITS.minSpacing, spacing)
    const predicted = contours.reduce((sum, c) => sum + predictSpacedCount(c.points, target), 0)
    if (predicted > ANCHOR_LIMITS.maxVertices) {
      stats.spacingSkipped = true
    } else {
      contours = contours.map((c) => withPoints(c, subdivide(c.points, target)))
      stats.spacingApplied = true
      stats.spacedVertices = countPoints(contours)
    }
  }

  const tolerance = Number.isFinite(params.simplify) ? params.simplify : 0
  if (tolerance > 0) {
    // Simplified contours must also sit against the other contours as before (counters stay inside).
    const current = contours.map((c) => c.points)
    const layout = new ContourLayout(current.slice())
    contours = contours.map((c, i) => {
      // Spacing only adds points on existing edges, so the flattened contour has the same crossings
      // and is cheaper to check.
      const baseline = () => {
        const count = countSelfCrossings(polygon.contours[i].points)
        if (count > 0) stats.selfCrossingContours++
        return count
      }
      const result = simplifyClosed(c.points, tolerance, baseline)
      if (!result.valid || !layout.keeps(current, i, result.points)) {
        stats.reductionFallbacks++
        return c
      }
      stats.reductionMaxDeviation = Math.max(stats.reductionMaxDeviation, result.maxDeviation)
      current[i] = result.points
      return withPoints(c, result.points)
    })
    stats.reductionApplied = true
  }

  stats.finalVertices = countPoints(contours)
  return { polygon: { ...polygon, contours }, stats }
}

function withPoints(contour: PolygonContour, points: Point[]): PolygonContour {
  return { points, clockwise: signedArea(points) < 0 }
}

const countPoints = (contours: readonly PolygonContour[]) => contours.reduce((n, c) => n + c.points.length, 0)
const countVertices = (polygon: PolygonGlyph) => countPoints(polygon.contours)

// ---- Anchor spacing ----

function edgeDivisions(a: Point, b: Point, spacing: number): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  // The small epsilon keeps an edge of exactly `spacing` from being split in two by rounding.
  return length === 0 ? 0 : Math.max(1, Math.ceil(length / spacing - 1e-9))
}

function predictSpacedCount(points: readonly Point[], spacing: number): number {
  let count = 0
  for (let i = 0; i < points.length; i++) count += edgeDivisions(points[i], points[(i + 1) % points.length], spacing)
  return count
}

/**
 * Splits every edge, including the closing edge back to the start, into equal parts no longer than
 * `spacing`. New points lie on the original edge; the start point stays first and is not repeated.
 */
export function subdivide(points: readonly Point[], spacing: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    out.push({ x: a.x, y: a.y })
    const parts = edgeDivisions(a, b, spacing)
    for (let k = 1; k < parts; k++) {
      const t = k / parts
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

// ---- Anchor reduction (Ramer–Douglas–Peucker on a closed ring) ----

export interface SimplifyResult {
  points: Point[]
  valid: boolean
  maxDeviation: number
}

/**
 * RDP for a closed contour. The ring is split at the start point (kept, so the contour still starts
 * where it did) and at the vertex farthest from it, giving two open chains whose ends both stay fixed.
 * This keeps detail at the closing edge that an open-polyline RDP would lose. The result must keep
 * at least three distinct points, the same winding direction, and no more self-crossings than the
 * input (`baselineCrossings`, computed only when needed); otherwise the caller keeps the unsimplified
 * contour.
 */
export function simplifyClosed(
  points: readonly Point[],
  tolerance: number,
  baselineCrossings: () => number = () => countSelfCrossings(points),
): SimplifyResult {
  const n = points.length
  if (n <= 3) return { points: points.slice(), valid: true, maxDeviation: 0 }

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
  let maxDeviation = 0
  // Chain A: 0 → far. Chain B: far → n (index n wraps to 0).
  for (const [from, to] of [
    [0, far],
    [far, n],
  ] as const) {
    maxDeviation = Math.max(maxDeviation, rdpChain(points, from, to, tolerance, keep))
  }

  const simplified: Point[] = []
  for (let i = 0; i < n; i++) if (keep[i]) simplified.push({ x: points[i].x, y: points[i].y })

  const originalArea = signedArea(points)
  const area = signedArea(simplified)
  const valid =
    simplified.length >= 3 &&
    distinctCount(simplified) === simplified.length &&
    Math.sign(area) === Math.sign(originalArea) &&
    Math.abs(area) > 1e-6 &&
    !addsCrossings(simplified, baselineCrossings)

  return { points: valid ? simplified : points.slice(), valid, maxDeviation: valid ? maxDeviation : 0 }
}

/** Iterative RDP over points[from..to] (to may equal points.length, meaning index 0). */
function rdpChain(points: readonly Point[], from: number, to: number, tolerance: number, keep: Uint8Array): number {
  const at = (i: number) => points[i % points.length]
  let accepted = 0
  const stack: [number, number][] = [[from, to]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let index = -1
    let dist = -1
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(at(i), at(a), at(b))
      if (d > dist) {
        dist = d
        index = i
      }
    }
    if (index === -1) continue
    if (dist > tolerance) {
      keep[index % points.length] = 1
      stack.push([a, index], [index, b])
    } else {
      accepted = Math.max(accepted, dist)
    }
  }
  return accepted
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function distinctCount(points: readonly Point[]): number {
  return new Set(points.map((p) => `${p.x},${p.y}`)).size
}

