// A huge glyph (a square 2,000 em across, solid or a ring, as a font with a broken unitsPerEm can give) stays quick under
// the effects: their grids and lattices have at most so many cells however large the glyph, so the work does not grow
// with it. Before they did, Dissolve took over 30 s on it and Burst over 3 minutes, past the worker's 60 s watchdog.

import { describe, expect, it } from 'vitest'
import { applyExperimental } from '../../src/geometry/experimental'
import type { ExperimentalParams, PolygonGlyph } from '../../src/geometry/types'
import { allFinite, contoursOf, polygonOf, rect } from '../helpers/outline'
import { ALL_MAX, BURST_MAX, GEOMETRY, on, paramsWith, type EffectPatch } from '../helpers/params'

const SIDE = 2_000_000
const HUGE = polygonOf([rect(0, 0, SIDE, SIDE), rect(0.1 * SIDE, 0.1 * SIDE, 0.9 * SIDE, 0.9 * SIDE).reverse()])
const SOLID = polygonOf([rect(0, 0, SIDE, SIDE)])

/** Well under the worker's 60 s watchdog, and far below what these took before, even on a slow, busy machine. */
const QUICK_MS = 15_000

// The solid square, where Dissolve was slowest; both under Burst, which costs little; the ring under all six.
const CASES: [string, EffectPatch, PolygonGlyph[]][] = [
  ['Dissolve', on('dissolve'), [SOLID]],
  ['Burst at slider max', BURST_MAX, [HUGE, SOLID]],
  ['all six at slider max', ALL_MAX, [HUGE]],
]

const experimental = (patch: EffectPatch): ExperimentalParams => paramsWith(GEOMETRY.plain, patch).experimental

describe('a glyph 2,000 em across', () => {
  it.each(CASES)('stays quick under %s', (_, patch, glyphs) => {
    for (const glyph of glyphs) {
      const start = performance.now()
      const { polygon } = applyExperimental(glyph, experimental(patch))
      expect(performance.now() - start).toBeLessThan(QUICK_MS)
      expect(allFinite(contoursOf(polygon))).toBe(true)
    }
  })
})
