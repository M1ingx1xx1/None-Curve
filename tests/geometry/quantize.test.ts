// Rounding for export (quantizePolygon) on a glyph with very many contours (report item #4c): the layout checks used
// to keep a Map entry per pair of contours, which ran past the Map size limit at a few thousand contours. Also a
// contour that crosses itself hundreds of thousands of times (an unmerged tangle), which used to take minutes.

import { describe, expect, it } from 'vitest'
import { quantizePolygon } from '../../src/export/quantize'
import type { PolygonGlyph } from '../../src/geometry/types'
import { outlineCrossings, polygonOf, rect } from '../helpers/outline'

/** `count` squares 20 units wide on a 30 unit pitch, 100 to a row, off the grid by 0.3 so rounding moves every point. */
function squares(count: number): PolygonGlyph {
  return polygonOf(
    Array.from({ length: count }, (_, k) => {
      const x = (k % 100) * 30 + 0.3
      const y = Math.floor(k / 100) * 30 + 0.3
      return rect(x, y, x + 20, y + 20)
    }),
    2048,
  )
}

describe('quantizePolygon with many contours (#4c)', () => {
  it.each([1000, 6000, 20000])('rounds %i contours, all kept, without crossings', (count) => {
    const polygon = squares(count)
    const start = performance.now()
    const rounded = quantizePolygon(polygon, 0, 'many')
    const elapsed = performance.now() - start
    expect(rounded.length).toBe(count)
    expect(rounded.every((ring) => ring.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)))).toBe(true)
    expect(outlineCrossings(rounded).cross).toBe(0)
    // Linear-ish: well under a second even for 20 000 contours on a slow CI machine.
    expect(elapsed).toBeLessThan(count >= 20000 ? 5000 : 2000)
  })

  it('keeps nested contours (holes inside outlines) at precision 0 and 2', () => {
    const contours = []
    for (let k = 0; k < 3000; k++) {
      const x = (k % 60) * 50 + 0.37
      const y = Math.floor(k / 60) * 50 + 0.37
      contours.push(rect(x, y, x + 40, y + 40), rect(x + 10, y + 10, x + 30, y + 30).reverse())
    }
    const polygon = polygonOf(contours, 1000)
    for (const decimals of [0, 2]) expect(quantizePolygon(polygon, decimals, 'nested').length).toBe(contours.length)
  })
})

describe('quantizePolygon on a tangle', () => {
  it('rounds a star polygon with about 500 000 self-crossings in seconds', () => {
    // The star polygon {1001/500}: one contour of 1001 points, off the grid so rounding moves every point.
    const points = Array.from({ length: 1001 }, (_, i) => {
      const angle = (2 * Math.PI * i * 500) / 1001
      return { x: 500 + 800 * Math.cos(angle) + 0.123, y: 400 + 800 * Math.sin(angle) + 0.0456 }
    })
    const polygon = polygonOf([points], 1000)
    for (const decimals of [0, 2]) {
      const start = performance.now()
      const rounded = quantizePolygon(polygon, decimals, 'tangle')
      expect(rounded.length).toBe(1)
      expect(rounded[0].length).toBe(1001)
      expect(performance.now() - start).toBeLessThan(5000)
    }
  })
})
