// Ripple with one or two sides (src/geometry/ripple.ts): the rings are straight level lines. Points move only up or
// down, lines stay in order up to 100% Amount (one-to-one), and creases fall on the lines.
// Validity on real glyphs, also folded, is checked with the other configurations in tests/helpers/invariants.ts.

import { describe, expect, it } from 'vitest'
import { rippleWarp, type Box } from '../../src/geometry/ripple'
import { on } from '../helpers/params'

const RIPPLE = on('ripple').ripple!
const box: Box = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
const upm = 1000
const spacing = (RIPPLE.wavelength * upm) / 2

describe.each([1, 2])('Ripple with %i side(s)', (sides) => {
  const warp = rippleWarp({ ...RIPPLE, sides, amount: 1, centerX: 0.5, centerY: 0.5 }, box, upm)
  const at = (y: number) => warp.map({ x: 300, y })

  it('moves points only up or down, keeps them in order, and leaves the centre line put', () => {
    let previous = -Infinity
    for (let y = -200; y <= 1200; y += 7) {
      const p = at(y)
      expect(p.x).toBe(300)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(p.y).toBeGreaterThan(previous)
      previous = p.y
    }
    expect(at(500).y).toBeCloseTo(500, 9)
  })

  it('moves the first lines down with one side and away from the centre with two', () => {
    const below = at(500 - spacing).y - (500 - spacing)
    const above = at(500 + spacing).y - (500 + spacing)
    expect(below).toBeLessThan(0)
    if (sides === 1) expect(above).toBeCloseTo(below, 9)
    else expect(above).toBeCloseTo(-below, 9)
  })

  it('creases a vertical segment exactly on the lines', () => {
    const ts = warp.creases({ x: 0, y: 500 - 2.5 * spacing }, { x: 0, y: 500 + 2.5 * spacing })
    expect(ts.map((t) => Math.round(t * 50))).toEqual([5, 15, 25, 35, 45])
    expect(warp.creases({ x: 0, y: 500 }, { x: 900, y: 500 })).toEqual([])
  })
})
