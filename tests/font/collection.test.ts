// Font collections (.ttc): a collection built here from both fixture fonts opens through src/font, lists its faces,
// opens the face asked for (or the default one), and records it in the source so the geometry worker opens the same.

import { describe, expect, it } from 'vitest'
import { parseFont } from '../../src/font/parse'
import { sniffFontFormat } from '../../src/font/sniff'
import { fixtureBytes, loadFixture, localSource } from '../helpers/fonts'
import { makeCollection, signature } from '../helpers/sfnt'

const bytes = makeCollection([fixtureBytes('STIXTwoText'), fixtureBytes('Roboto')])
const open = (face?: number) => parseFont(bytes, localSource('Both.ttc', bytes, face), new AbortController().signal)

/** The outline of "A" as the font's own glyph reader gives it. */
function outlineOfA(font: Awaited<ReturnType<typeof open>>) {
  const ref = font.characters.find((c) => c.unicode === 0x41)!
  return font.getGlyph(ref.index).contours
}

describe('font collections', () => {
  it('is recognised as a collection', () => {
    expect(signature(bytes)).toBe('ttcf')
    expect(sniffFontFormat(bytes)).toBe('ttc')
  })

  it('lists both faces and opens the default one', async () => {
    const font = await open()
    expect(font.format).toBe('ttc')
    expect(font.faces?.map((f) => [f.index, f.family])).toEqual([
      [0, 'STIX Two Text'],
      [1, 'Roboto'],
    ])
    // Both are upright Regular faces: the first one wins.
    expect(font.face).toBe(0)
    expect(font.source).toMatchObject({ kind: 'local', face: 0 })
    expect(font.familyName).toBe('STIX Two Text')
  })

  it('opens the face asked for, the same as the font file on its own', async () => {
    const font = await open(1)
    expect(font.face).toBe(1)
    expect(font.source).toMatchObject({ face: 1 })
    expect(font.familyName).toBe('Roboto')
    const alone = await loadFixture('Roboto')
    expect(font.glyphCount).toBe(alone.glyphCount)
    expect(outlineOfA(font)).toEqual(outlineOfA(alone))
    expect(font.hasKerning).toBe(alone.hasKerning)
  })

  it('falls back to the default face for a face that is not there', async () => {
    for (const face of [2, -1, 0.5]) expect((await open(face)).face).toBe(0)
  })
})
