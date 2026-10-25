// A Google font in every subset (src/font/subsets.ts): the subsets' files bundled into one byte array, which
// parseFont makes one font. Two fixture fonts stand in for two subsets: Roboto (the main one) and STIX Two Text.

import { describe, expect, it } from 'vitest'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { parseFont } from '../../src/font/parse'
import { bundleSubsets, unbundleSubsets } from '../../src/font/subsets'
import { fixtureBytes, loadFixture, localSource } from '../helpers/fonts'
import { BASE } from '../helpers/params'

describe('a font bundled from its subsets', async () => {
  const roboto = await loadFixture('Roboto')
  const stix = await loadFixture('STIXTwoText')
  const files = [fixtureBytes('Roboto'), fixtureBytes('STIXTwoText')]
  const bytes = bundleSubsets(files)
  const font = await parseFont(bytes, localSource('bundle', bytes), new AbortController().signal)
  // A character only the second part has.
  const extra = stix.characters.find((c) => !roboto.hasCharacter(c.unicode!) && c.unicode! > 0x2000)!

  it('bundles and unbundles the files, and knows bytes that are not a bundle', () => {
    expect(unbundleSubsets(bytes)).toEqual(files)
    expect(unbundleSubsets(files[0])).toBeNull()
    expect(unbundleSubsets(bytes.subarray(0, bytes.length - 1))).toBeNull()
  })

  it('lists every character once, from the first part that maps it, with indices running through the parts', () => {
    expect(font.familyName).toBe(roboto.familyName)
    expect(font.glyphCount).toBe(roboto.glyphCount + stix.glyphCount)
    const codes = font.characters.map((c) => c.unicode!)
    expect(codes).toEqual(
      [...new Set([...roboto.characters, ...stix.characters].map((c) => c.unicode!))].sort((a, b) => a - b),
    )
    const a = font.characters.find((c) => c.unicode === 0x41)!
    expect(a.index).toBe(roboto.characters.find((c) => c.unicode === 0x41)!.index)
    const own = font.characters.find((c) => c.unicode === extra.unicode)!
    expect(own.index).toBe(roboto.glyphCount + extra.index)
    expect(font.hasCharacter(extra.unicode!)).toBe(true)
    expect(font.listAllGlyphs()).toHaveLength(font.glyphCount)
  })

  it('reads each glyph from its part, under its own index, and rebuilds it', () => {
    const index = roboto.glyphCount + extra.index
    const glyph = font.getGlyph(index)
    expect(glyph.ref.index).toBe(index)
    expect(glyph.contours).toEqual(stix.getGlyph(extra.index).contours)
    expect(font.getPreviewPath(index)).toBe(stix.getPreviewPath(extra.index))
    expect(deriveGeometry(glyph, BASE).polygon.contours.length).toBeGreaterThan(0)
  })

  it('shapes a line in runs of the part that owns each character, kerned within a part', () => {
    const char = String.fromCodePoint(extra.unicode!)
    const shaped = font.shapeLine(`AV${char}AV`)
    const alone = roboto.shapeLine('AV')
    expect(shaped.map((g) => g.index)).toEqual([
      ...alone.map((g) => g.index),
      ...stix.shapeLine(char).map((g) => roboto.glyphCount + g.index),
      ...alone.map((g) => g.index),
    ])
    expect(shaped[0].xAdvance).toBe(alone[0].xAdvance)
    expect(shaped.some((g) => g.missing)).toBe(false)
  })

  it("keeps each part's kerning, moved to the composed indices", () => {
    const merged = font.kerning()!
    const parts = [roboto.kerning(), stix.kerning()]
    expect(merged.lookups).toHaveLength(parts.reduce((n, k) => n + (k?.lookups.length ?? 0), 0))
    const latin = merged.scripts.find((s) => s.tag === 'latn')
    expect(latin?.lookups.length).toBeGreaterThan(0)
  })
})
