// Fitting a glyph into what a font file can store. CFF outlines are written as steps from point to point, each at
// most 32,767 font units along either axis, and every coordinate lies within ±32,767. A glyph that reaches
// further (long Thorn tips) is cut off at the edge of a window 32,766 units across, placed around the letter's
// body: each contour is clipped against the window's sides, which only ever adds straight edges. Pure functions
// in font units (y up); no React, no DOM.

import { signedArea } from '../geometry/primitives'
import { mergeOverlaps } from '../geometry/overlaps'
import type { Point, PolygonContour, PolygonGlyph } from '../geometry/types'

export const FONT_BOX_LIMITS = {
  /** Every coordinate in the file lies within ±this. */
  maxCoordinate: 32767,
  /** The most a glyph spans along either axis: one unit under the longest step, so whole-unit edges keep every step storable. */
  span: 32766,
} as const

/** A window in font units, in glyph space (y up). */
export interface FontBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * The window a glyph must fit in. Per axis it is the glyph's own extent, limited to ±32,767; where that is wider
 * than 32,766 units, it is the 32,766 units centred on the em box (half the advance across, halfway between
 * ascender and descender up), moved inside the glyph's extent as far as needed, with whole-number edges.
 */
export function glyphFontBox(polygon: PolygonGlyph): FontBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const contour of polygon.contours) {
    for (const p of contour.points) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  const { advanceWidth, ascender, descender } = polygon.metrics
  const [x0, x1] = window(minX, maxX, advanceWidth / 2)
  const [y0, y1] = window(minY, maxY, (ascender + descender) / 2)
  return { minX: x0, minY: y0, maxX: x1, maxY: y1 }
}

function window(min: number, max: number, centre: number): [number, number] {
  const { maxCoordinate: limit, span } = FONT_BOX_LIMITS
  if (!(min <= max)) return [-limit, limit]
  const lo = Math.min(Math.max(min, -limit), limit)
  const hi = Math.min(Math.max(max, -limit), limit)
  if (hi - lo <= span) return [lo, hi]
  const middle = Number.isFinite(centre) ? centre : (lo + hi) / 2
  const start = Math.round(Math.min(Math.max(middle - span / 2, lo), hi - span))
  return [start, start + span]
}

type Side = { axis: 'x' | 'y'; max: boolean }
const SIDES: Side[] = [
  { axis: 'x', max: false },
  { axis: 'x', max: true },
  { axis: 'y', max: false },
  { axis: 'y', max: true },
]

const edgeOf = (side: Side, box: FontBox) => (side.axis === 'x' ? (side.max ? box.maxX : box.minX) : side.max ? box.maxY : box.minY)
const inside = (p: Point, side: Side, at: number) => (side.max ? p[side.axis] <= at : p[side.axis] >= at)

/**
 * The glyph cut off at the window's edges. A glyph already inside comes back as it is (the same object). Otherwise
 * each contour is clipped against each side the glyph crosses (Sutherland–Hodgman), with the new points exactly on
 * the edge; contours left with fewer than three points or no area are dropped. A contour that leaves the window
 * and comes back along the same edge is joined there by a run of edge with no width, so the clipped glyph is
 * redrawn by what it fills (nonzero, as fonts fill), with its largest contour turning the way it did; if that
 * breaks down, the clipped contours are kept as they are. Non-finite points are left for the export to reject.
 */
export function fitToFontBox(polygon: PolygonGlyph, box: FontBox): { polygon: PolygonGlyph; trimmed: boolean } {
  const points = polygon.contours.flatMap((c) => c.points)
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { polygon, trimmed: false }
  const sides = SIDES.filter((side) => points.some((p) => !inside(p, side, edgeOf(side, box))))
  if (!sides.length) return { polygon, trimmed: false }

  const contours: PolygonContour[] = []
  for (const contour of polygon.contours) {
    let ring = contour.points
    for (const side of sides) ring = clipRing(ring, side, edgeOf(side, box))
    ring = withoutRepeats(ring)
    const area = ring.length >= 3 ? signedArea(ring) : 0
    if (area !== 0) contours.push({ points: ring, clockwise: area < 0 })
  }
  const clipped: PolygonGlyph = { ...polygon, contours }
  if (!contours.length) return { polygon: clipped, trimmed: true }

  const merged = mergeOverlaps(clipped, 'nonzero')
  // The merge may move a point to a whole unit; the edges it was cut at are whole units already.
  const [x0, x1, y0, y1] = [Math.floor(box.minX), Math.ceil(box.maxX), Math.floor(box.minY), Math.ceil(box.maxY)]
  const within = (p: Point) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
  if (merged.stats.failed || !merged.polygon.contours.length || !merged.polygon.contours.every((c) => c.points.every(within))) {
    return { polygon: clipped, trimmed: true }
  }
  if (largestTurn(merged.polygon.contours) === largestTurn(contours)) return { polygon: merged.polygon, trimmed: true }
  // Keep each contour's first point, so the outline starts where it did; holes stay holes.
  const reversed = merged.polygon.contours.map((c) => ({ points: [c.points[0], ...c.points.slice(1).reverse()], clockwise: !c.clockwise }))
  return { polygon: { ...merged.polygon, contours: reversed }, trimmed: true }
}

/** One Sutherland–Hodgman pass: the ring on the inner side of one edge. */
function clipRing(points: Point[], side: Side, at: number): Point[] {
  const out: Point[] = []
  const along = side.axis === 'x' ? 'y' : 'x'
  for (let i = 0; i < points.length; i++) {
    const a = points[i === 0 ? points.length - 1 : i - 1]
    const b = points[i]
    const bIn = inside(b, side, at)
    if (inside(a, side, at) !== bIn) {
      // Interpolated from the lower end, so an edge shared by two contours is cut at the same point both ways.
      const [p, q] = a[side.axis] < b[side.axis] ? [a, b] : [b, a]
      const t = (at - p[side.axis]) / (q[side.axis] - p[side.axis])
      const cut = p[along] + t * (q[along] - p[along])
      out.push(side.axis === 'x' ? { x: at, y: cut } : { x: cut, y: at })
    }
    if (bIn) out.push(b)
  }
  return out
}

/** The ring without points equal to the one before them (the last point comes before the first). */
function withoutRepeats(points: Point[]): Point[] {
  return points.filter((p, i) => {
    const prev = points[i === 0 ? points.length - 1 : i - 1]
    return p.x !== prev.x || p.y !== prev.y
  })
}

/** Whether the contour with the most area runs clockwise. */
function largestTurn(contours: PolygonContour[]): boolean {
  let largest = 0
  let clockwise = false
  for (const c of contours) {
    const area = signedArea(c.points)
    if (Math.abs(area) > largest) {
      largest = Math.abs(area)
      clockwise = area < 0
    }
  }
  return clockwise
}
