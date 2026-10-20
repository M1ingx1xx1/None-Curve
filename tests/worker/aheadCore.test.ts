// The precompute window in the worker (src/geometry/aheadCore.ts, NOCUR-82): the 'ahead' cache tier reads the
// canvas's caches without changing them, and a release drops the chain states and glyphs behind the playhead.

import { describe, expect, it } from 'vitest'
import { AheadCore } from '../../src/geometry/aheadCore'
import { glyphGeometry, isCached, paramsKey } from '../../src/geometry/cache'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { loadFixture, sampleGlyphs } from '../helpers/fonts'
import { burst } from '../helpers/planCases'
import { BASE } from '../helpers/params'

describe('the ahead store', async () => {
  const font = await loadFixture('Roboto')
  const glyphs = sampleGlyphs(font).map((g) => g.index)

  it("the 'ahead' tier never inserts into the main or live caches, but reads what they hold", () => {
    const params = burst(41)
    const key = paramsKey(params)
    const fresh = glyphGeometry(font, glyphs[0], params, key, true, 'ahead')
    expect(fresh.polygon).toEqual(deriveGeometry(font.getGlyph(glyphs[0]), params).polygon)
    expect(isCached(font, glyphs[0], key)).toBe(false)
    // Computed again: not kept, so a new object.
    expect(glyphGeometry(font, glyphs[0], params, key, true, 'ahead')).not.toBe(fresh)
    // What the canvas computed is read as it is.
    const shown = glyphGeometry(font, glyphs[1], params, key)
    expect(glyphGeometry(font, glyphs[1], params, key, true, 'ahead')).toBe(shown)
    const live = glyphGeometry(font, glyphs[2], params, key, true)
    expect(glyphGeometry(font, glyphs[2], params, key, true, 'ahead')).toBe(live)
  })

  const entry = (index: number, params = BASE) => {
    const { source: _source, ...geometry } = deriveGeometry(font.getGlyph(index), params)
    return { geometry }
  }

  it('release drops the chain states and glyphs of commits behind, keeping what newer commits use', () => {
    const core = new AheadCore()
    core.begin('roboto', 1)
    const k1 = paramsKey(burst(1))
    const k2 = paramsKey(burst(2))
    core.put(k1, glyphs[0], entry(glyphs[0], burst(1)), 1)
    core.put(k2, glyphs[0], entry(glyphs[0], burst(2)), 2)
    core.put(k1, glyphs[1], entry(glyphs[1], burst(1)), 1)
    // Commit 3 shows glyph 1 under k1 again: reserved before the release reaches it.
    core.reserve([{ seq: 3, key: k1, index: glyphs[1] }])
    core.step(1, 0, 10, -1, glyphs[0], k1, 150)
    core.step(2, 33, 11, 10, glyphs[0], k2, 150)
    expect(core.size).toMatchObject({ glyphs: 3, chains: 2 })
    core.release(2)
    // Lineage 10's commit is behind, but 11 (commit 2) names it as its parent: both stay. Glyph 0 under k1 goes.
    expect(core.size).toMatchObject({ glyphs: 2, chains: 2 })
    expect(core.get(k1, glyphs[0])).toBeUndefined()
    expect(core.get(k1, glyphs[1])).toBeDefined()
    core.release(3)
    expect(core.size).toMatchObject({ glyphs: 1, chains: 0 })
    core.release(Number.MAX_SAFE_INTEGER)
    expect(core.size).toMatchObject({ glyphs: 0, chains: 0 })
  })

  it('a new generation drops the chains and keeps the glyphs; a new font starts afresh', () => {
    const core = new AheadCore()
    core.begin('roboto', 1)
    const k = paramsKey(BASE)
    core.put(k, glyphs[0], entry(glyphs[0]), 1)
    core.step(1, 0, 1, -1, glyphs[0], k, 150)
    core.begin('roboto', 2)
    expect(core.size).toMatchObject({ glyphs: 1, chains: 0 })
    core.begin('stix', 2)
    expect(core.size).toMatchObject({ glyphs: 0, chains: 0 })
  })

  it('a step whose parent is gone, or whose glyph is not stored, leaves the pairing to the page', () => {
    const core = new AheadCore()
    core.begin('roboto', 1)
    const k = paramsKey(BASE)
    core.put(k, glyphs[0], entry(glyphs[0]), 1)
    expect(core.step(2, 33, 5, 4, glyphs[0], k, 150)).toEqual({ lineage: 5, from: { kind: 'value' }, data: null })
    core.step(1, 0, 6, -1, glyphs[0], k, 150)
    expect(core.step(2, 33, 7, 6, glyphs[1], k, 150)).toEqual({ lineage: 7, from: { kind: 'value' }, data: null })
  })
})
