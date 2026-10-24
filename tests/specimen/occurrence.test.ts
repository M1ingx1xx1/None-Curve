// Occurrences (src/specimen/scene.ts, placePolygons): the polygon lookup is told which occurrence of the text it is
// placing, counted over every glyph in reading order (lines, then glyphs; spaces and missing glyphs included), from
// 0 to glyphCount − 1. The live scheduler's letters (src/sound/letters.ts) count the same way, so a letter that
// reacts to Sound by its own amount gets its own polygon.

import { describe, expect, it } from 'vitest'
import type { PolygonGlyph } from '../../src/geometry/types'
import { placePolygons, shapeSpecimen } from '../../src/specimen/scene'
import { loadFixture } from '../helpers/fonts'

/** Two lines with a space, a blank line, and a character Roboto does not have (U+1F600). */
const TEXT = 'Ab c\n\nd\u{1F600}e'

const polygon = (index: number, occurrence: number): PolygonGlyph => ({
  ref: { index, name: String(occurrence), unicode: null },
  metrics: {
    unitsPerEm: 2048,
    advanceWidth: 1000,
    leftSideBearing: 0,
    rightSideBearing: 0,
    ascender: 1900,
    descender: -500,
  },
  contours: [],
})

describe('placePolygons occurrences', async () => {
  const font = await loadFixture('Roboto')
  const shaped = shapeSpecimen(font, TEXT)
  const flat = shaped.lines.flatMap((line) => line.glyphs)

  it('counts every glyph in reading order, missing glyphs included', () => {
    expect(flat.map((g) => g.text)).toEqual(['A', 'b', ' ', 'c', 'd', '\u{1F600}', 'e'])
    expect(flat.map((g) => g.missing)).toEqual([false, false, false, false, false, true, false])
    expect(shaped.glyphCount).toBe(flat.length)

    const calls: [number, number][] = []
    placePolygons(shaped, (index, occurrence) => {
      calls.push([index, occurrence])
      return null
    })
    // A missing glyph is never looked up, but it keeps its number.
    expect(calls).toEqual(flat.flatMap((g, k) => (g.missing ? [] : [[g.index, k]])))
    expect(calls.map(([, occurrence]) => occurrence)).toEqual([0, 1, 2, 3, 4, 6])
  })

  it('places the polygon the lookup gives for each occurrence', () => {
    const scene = placePolygons(shaped, (index, occurrence) => ({ polygon: polygon(index, occurrence) }))
    const placed = scene.lines.flatMap((line) => line.glyphs)
    expect(placed.map((g) => g.polygon?.ref.name ?? null)).toEqual(['0', '1', '2', '3', '4', null, '6'])
    expect(placed.every((g) => g.polygon === null || g.polygon.ref.index === g.index)).toBe(true)
  })
})
