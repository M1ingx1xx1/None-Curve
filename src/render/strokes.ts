// Outlines for the Canvas2D renderer's strokes, built in screen space. The SVG canvas strokes with
// vector-effect: non-scaling-stroke, so an outline is 1.5 CSS px wide at any zoom and under any slant. A canvas stroke
// is measured in the current transform, so instead the outline's points go through the glyph's whole transform here
// and the path is stroked under the plain device-pixel transform: exactly non-scaling, skew included. Polygons stay
// straight segments (moveTo, lineTo, closePath); the font's own outlines keep their curves (affine maps keep a Bézier a
// Bézier), as the Original and Compare views draw them. Pure: the path comes in as a sink.

import type { PolygonContour, SourceGlyph } from '../geometry/types'

/** A 2D affine transform as canvas setTransform takes it: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** m · n (n applied first). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

/**
 * A glyph's transform from its own font units (y up) to the view's: SpecimenView's and drawArtboard's
 * `translate(x y) skewX(-slant) scale(1 -1)` after `view`.
 */
export function glyphMatrix(view: Matrix, x: number, y: number, slant: number): Matrix {
  const skew = slant ? Math.tan((-slant * Math.PI) / 180) : 0
  // translate · [1 skew; 0 1] · [1 0; 0 -1] = [1, 0, -skew, -1, x, y]
  return multiply(view, [1, 0, -skew, -1, x, y])
}

/** Where a polygon's straight outline is written. */
export interface LineSink {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
}

/** Where a font outline (with curves) is written. */
export interface CurveSink extends LineSink {
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
}

/** Every contour as moveTo, lineTo… closePath, each point through `m`. */
export function tracePolygon(sink: LineSink, contours: readonly PolygonContour[], m: Matrix = IDENTITY): void {
  const [a, b, c, d, e, f] = m
  for (const { points } of contours) {
    if (points.length === 0) continue
    const p0 = points[0]
    sink.moveTo(a * p0.x + c * p0.y + e, b * p0.x + d * p0.y + f)
    for (let i = 1; i < points.length; i++) {
      const p = points[i]
      sink.lineTo(a * p.x + c * p.y + e, b * p.x + d * p.y + f)
    }
    sink.closePath()
  }
}

/** The font's outline with its curves, every point (controls included) through `m`. */
export function traceSource(sink: CurveSink, source: SourceGlyph, m: Matrix = IDENTITY): void {
  const [a, b, c, d, e, f] = m
  const X = (p: { x: number; y: number }) => a * p.x + c * p.y + e
  const Y = (p: { x: number; y: number }) => b * p.x + d * p.y + f
  for (const contour of source.contours) {
    sink.moveTo(X(contour.start), Y(contour.start))
    for (const seg of contour.segments) {
      if (seg.type === 'line') sink.lineTo(X(seg.to), Y(seg.to))
      else if (seg.type === 'quad') sink.quadraticCurveTo(X(seg.control), Y(seg.control), X(seg.to), Y(seg.to))
      else sink.bezierCurveTo(X(seg.control1), Y(seg.control1), X(seg.control2), Y(seg.control2), X(seg.to), Y(seg.to))
    }
    sink.closePath()
  }
}

/** Applies `m` to a point. */
export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}
