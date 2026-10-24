// PNG export's size (src/export/png.ts): the canvas at its export scale, scaled down to what a browser can draw.

import { describe, expect, it } from 'vitest'
import { PNG_LIMITS, pngSize } from '../../src/export/png'
import { ARTBOARD_LIMITS } from '../../src/specimen/artboard'

describe('pngSize', () => {
  it('is the canvas at its scale while that fits', () => {
    expect(pngSize(1200, 800, 2)).toEqual({ width: 2400, height: 1600, capped: false })
    expect(pngSize(4000, 4000, 2)).toEqual({ width: 8000, height: 8000, capped: false })
  })

  it('scales the largest canvas down to what a browser can draw, keeping its shape', () => {
    for (const scale of ARTBOARD_LIMITS.scales) {
      const size = pngSize(ARTBOARD_LIMITS.max, ARTBOARD_LIMITS.max / 2, scale)
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(PNG_LIMITS.maxSide)
      expect(size.width * size.height).toBeLessThanOrEqual(PNG_LIMITS.maxPixels)
      expect(size.width / size.height).toBeCloseTo(2, 2)
    }
    expect(pngSize(10000, 10000, 4).capped).toBe(true)
  })

  it('caps a long thin canvas by its side, not its area', () => {
    expect(pngSize(10000, 100, 4)).toEqual({ width: PNG_LIMITS.maxSide, height: 163, capped: true })
  })
})
