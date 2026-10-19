// The canvas's shared outlines (src/components/sharedOutlines.ts): one path per distinct outline for SpecimenView's
// <defs>, which every copy of a glyph draws with <use>. Copies with the same polygon share one id; a copy with another
// polygon (mid-glide, or a letter reacting to Sound by its own amount) gets the next id of its glyph; the font's own
// outline and the click outline (with thorns) are shared the same way.

import { describe, expect, it } from 'vitest'
import { sharedOutlines } from '../../src/components/sharedOutlines'
import { contoursToPath, polygonGlyphToPath } from '../../src/geometry/sourcePath'
import type { SourceGlyph } from '../../src/geometry/types'
import { polygonOf, rect } from '../helpers/outline'

const H = polygonOf([rect(50, 0, 650, 700)])
const WIDE_H = polygonOf([rect(20, 0, 680, 700)])
const I = polygonOf([rect(50, 0, 250, 700)])

describe('sharedOutlines', () => {
  it('gives every copy with the same polygon one id, written once', () => {
    const shared = sharedOutlines('v')
    const ids = [shared.polygon(1, H), shared.polygon(2, I), shared.polygon(1, H), shared.polygon(1, H)]
    expect(ids).toEqual(['v-g1-0', 'v-g2-0', 'v-g1-0', 'v-g1-0'])
    expect(shared.defs).toEqual([
      { id: 'v-g1-0', d: polygonGlyphToPath(H) },
      { id: 'v-g2-0', d: polygonGlyphToPath(I) },
    ])
  })

  it('numbers the other outlines of a glyph in order of first use', () => {
    const shared = sharedOutlines('v')
    expect([shared.polygon(1, H), shared.polygon(1, WIDE_H), shared.polygon(1, H), shared.polygon(1, WIDE_H)]).toEqual([
      'v-g1-0',
      'v-g1-1',
      'v-g1-0',
      'v-g1-1',
    ])
    expect(shared.defs.map((d) => d.id)).toEqual(['v-g1-0', 'v-g1-1'])
  })

  it('keeps the ids of a frame whose outlines all changed, so unchanged places need no new props', () => {
    const before = sharedOutlines('v')
    const after = sharedOutlines('v')
    expect([before.polygon(1, H), before.polygon(2, I)]).toEqual([after.polygon(1, WIDE_H), after.polygon(2, I)])
  })

  it('shares the click outline beside its polygon, and has none without thorns', () => {
    const thorned = { ...H, clickOutline: [{ points: rect(0, 0, 10, 10), clockwise: false }] }
    const shared = sharedOutlines('v')
    expect(shared.click(1, H)).toBeNull()
    expect(shared.click(3, thorned)).toBe('v-c3-0')
    expect(shared.polygon(3, thorned)).toBe('v-g3-0')
    expect(shared.defs).toContainEqual({ id: 'v-c3-0', d: contoursToPath(thorned.clickOutline) })
    expect(shared.defs.filter((d) => d.id === 'v-c3-0')).toHaveLength(1)
  })

  it('writes the font outline of a glyph once', () => {
    const source = { contours: [] } as unknown as SourceGlyph
    const shared = sharedOutlines('v')
    expect([shared.source(4, source), shared.source(4, source)]).toEqual(['v-s4', 'v-s4'])
    expect(shared.defs.map((d) => d.id)).toEqual(['v-s4'])
  })
})
