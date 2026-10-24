// Fitting a glyph into what a font file can store (src/export/fitGlyph.ts): outlines that reach past the window are
// cut off flat at its edge, with straight edges only; outlines inside it are left exactly as they are.

import { describe, expect, it } from 'vitest'
import { FONT_BOX_LIMITS, fitToFontBox, glyphFontBox, type FontBox } from '../../src/export/fitGlyph'
import { signedArea } from '../../src/geometry/primitives'
import type { Point, PolygonGlyph } from '../../src/geometry/types'

const METRICS = { unitsPerEm: 2048, advanceWidth: 1200, leftSideBearing: 0, rightSideBearing: 0, ascender: 1900, descender: -500 }

function glyph(...contours: [number, number][][]): PolygonGlyph {
  return {
    ref: { index: 1, name: 'A', unicode: 65 },
    metrics: METRICS,
    contours: contours.map((c) => {
      const points = c.map(([x, y]) => ({ x, y }))
      return { points, clockwise: signedArea(points) < 0 }
    }),
  }
}

const bounds = (points: Point[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxX: Math.max(...points.map((p) => p.x)),
  maxY: Math.max(...points.map((p) => p.y)),
})
const allPoints = (polygon: PolygonGlyph) => polygon.contours.flatMap((c) => c.points)
const inBox = (box: FontBox) => (p: Point) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY

/** A body from 0 to 1000 with a spike from its right side out to x = 245000, counter-clockwise. */
const SPIKE: [number, number][] = [[0, 0], [1000, 0], [245000, 500], [1000, 1000], [0, 1000]]

describe('glyphFontBox', () => {
  it('is the glyph’s own extent when it fits', () => {
    expect(glyphFontBox(glyph([[10.5, -20], [900, -20], [900, 700]]))).toEqual({ minX: 10.5, minY: -20, maxX: 900, maxY: 700 })
  })

  it('is 32,766 units across, with whole-number edges, where the glyph reaches further', () => {
    const box = glyphFontBox(glyph([[-100000, -100000], [100000, -100000], [100000, 100000], [-100000, 100000]]))
    expect(box.maxX - box.minX).toBe(FONT_BOX_LIMITS.span)
    expect(box.maxY - box.minY).toBe(FONT_BOX_LIMITS.span)
    for (const v of Object.values(box)) {
      expect(Number.isInteger(v)).toBe(true)
      expect(Math.abs(v)).toBeLessThanOrEqual(FONT_BOX_LIMITS.maxCoordinate)
    }
    // Centred on the em box: half the advance across, halfway between ascender and descender up.
    expect((box.minX + box.maxX) / 2).toBeCloseTo(METRICS.advanceWidth / 2, 0)
    expect((box.minY + box.maxY) / 2).toBeCloseTo((METRICS.ascender + METRICS.descender) / 2, 0)
  })

  it('moves the window inside the glyph’s extent', () => {
    const box = glyphFontBox(glyph(SPIKE))
    expect(box).toEqual({ minX: 0, minY: 0, maxX: FONT_BOX_LIMITS.span, maxY: 1000 })
  })
})

describe('fitToFontBox', () => {
  it('leaves a glyph inside the window exactly as it is', () => {
    const polygon = glyph([[0, 0], [1000, 0], [1000, 1000], [0, 1000]], [[200, 200], [200, 800], [800, 800], [800, 200]])
    const fitted = fitToFontBox(polygon, glyphFontBox(polygon))
    expect(fitted.trimmed).toBe(false)
    expect(fitted.polygon).toBe(polygon)
  })

  it('cuts a spike flat, exactly on the edge', () => {
    const polygon = glyph(SPIKE)
    const box = glyphFontBox(polygon)
    const fitted = fitToFontBox(polygon, box)
    expect(fitted.trimmed).toBe(true)
    expect(fitted.polygon.contours).toHaveLength(1)
    const points = fitted.polygon.contours[0].points
    expect(points.every(inBox(box))).toBe(true)
    const onEdge = points.filter((p) => p.x === box.maxX)
    expect(onEdge).toHaveLength(2)
    // The cut runs along the edge, between the spike's two sides where they cross it.
    const t = (box.maxX - 1000) / (245000 - 1000)
    expect(onEdge.map((p) => p.y).sort((a, b) => a - b)).toEqual([expect.closeTo(500 * t, 6), expect.closeTo(1000 - 500 * t, 6)])
    expect(bounds(points)).toEqual({ minX: 0, minY: 0, maxX: box.maxX, maxY: 1000 })
  })

  it('keeps each contour’s direction', () => {
    for (const contour of [SPIKE, SPIKE.slice().reverse()]) {
      const polygon = glyph(contour)
      const fitted = fitToFontBox(polygon, glyphFontBox(polygon))
      expect(Math.sign(signedArea(fitted.polygon.contours[0].points))).toBe(Math.sign(signedArea(polygon.contours[0].points)))
      expect(fitted.polygon.contours[0].clockwise).toBe(polygon.contours[0].clockwise)
    }
  })

  it('drops a contour entirely outside the window', () => {
    const square: [number, number][] = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]
    const polygon = glyph(square, [[100000, 0], [101000, 0], [101000, 1000], [100000, 1000]])
    const fitted = fitToFontBox(polygon, glyphFontBox(polygon))
    expect(fitted.trimmed).toBe(true)
    expect(fitted.polygon.contours).toHaveLength(1)
    const key = (p: Point) => `${p.x},${p.y}`
    expect(fitted.polygon.contours[0].points.map(key).sort()).toEqual(square.map(([x, y]) => `${x},${y}`).sort())
  })

  it('turns a contour around the whole window into the window', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const fitted = fitToFontBox(glyph([[-500, -500], [600, -500], [600, 600], [-500, 600]]), box)
    expect(fitted.trimmed).toBe(true)
    expect(fitted.polygon.contours).toHaveLength(1)
    const points = fitted.polygon.contours[0].points
    expect(points).toHaveLength(4)
    expect(bounds(points)).toEqual(box)
    expect(signedArea(points)).toBe(100 * 100)
  })

  it('leaves no edge of no width where a contour leaves the window and comes back', () => {
    // A U whose bottom lies below the window: clipped alone, its two arms would be joined along the edge, there and back.
    const u: [number, number][] = [[0, -500], [1000, -500], [1000, 1000], [800, 1000], [800, -200], [200, -200], [200, 1000], [0, 1000]]
    const box = { minX: -5000, minY: 0, maxX: 5000, maxY: 5000 }
    const fitted = fitToFontBox(glyph(u), box)
    expect(fitted.trimmed).toBe(true)
    const arms = fitted.polygon.contours.map((c) => bounds(c.points)).sort((a, b) => a.minX - b.minX)
    expect(arms).toEqual([
      { minX: 0, minY: 0, maxX: 200, maxY: 1000 },
      { minX: 800, minY: 0, maxX: 1000, maxY: 1000 },
    ])
    for (const contour of fitted.polygon.contours) {
      expect(signedArea(contour.points)).toBe(200 * 1000)
      expect(contour.points).toHaveLength(4)
    }
  })

  it('makes straight, finite, closed contours only', () => {
    const polygon = glyph(SPIKE, [[-300000, 400], [-200, 400], [-200, 600]])
    const fitted = fitToFontBox(polygon, glyphFontBox(polygon))
    for (const p of allPoints(fitted.polygon)) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    const box = glyphFontBox(polygon)
    expect(allPoints(fitted.polygon).every(inBox(box))).toBe(true)
    expect(box.maxX - box.minX).toBeLessThanOrEqual(FONT_BOX_LIMITS.span)
  })
})
