// The glyph cache's point budget (src/geometry/cache.ts): a result counts every point it keeps, Whorl's outline of the
// letter (the motion Glide reads) included, so a budget that holds two glyphs by their outlines alone holds one.

import { afterEach, describe, expect, it } from 'vitest'
import { glyphGeometry, isCached, shareCacheLimits } from '../../src/geometry/cache'
import { paramsKey } from '../../src/geometry/paramsKey'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { loadFixture, sampleGlyphs } from '../helpers/fonts'
import { whorl } from '../helpers/planCases'

/** The cache's own limits per font (cache.ts MAX_POINTS_PER_FONT, MAX_ENTRIES_PER_FONT). */
const MAX_POINTS = 1_000_000
const MAX_ENTRIES = 4000

describe('the glyph cache', async () => {
  const font = await loadFixture('Roboto')
  const [a, b] = sampleGlyphs(font, 'Ag').map((g) => g.index)

  afterEach(() => shareCacheLimits(1))

  it('counts Whorl’s outline among the points a result keeps', () => {
    const params = whorl(0.6)
    const key = paramsKey(params)
    const of = (index: number) => deriveGeometry(font.getGlyph(index), params)
    const outline = of(a).polygon.motion?.whorl?.outline
    expect(outline?.length).toBeGreaterThan(0)
    // A budget with just room for both glyphs' outlines, without Whorl's copies of the letters.
    const vertices = of(a).vertexCount + of(b).vertexCount
    const parts = Math.floor(MAX_POINTS / (vertices + 1))
    // Room for both by their count (cache.ts MAX_ENTRIES_PER_FONT), so only the points decide.
    expect(Math.ceil(MAX_ENTRIES / parts)).toBeGreaterThanOrEqual(2)
    shareCacheLimits(parts)
    glyphGeometry(font, a, params, key)
    glyphGeometry(font, b, params, key)
    expect(isCached(font, b, key)).toBe(true)
    expect(isCached(font, a, key)).toBe(false)
  })
})
