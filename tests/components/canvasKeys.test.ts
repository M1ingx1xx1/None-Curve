// The canvas's keyboard selection (stepGlyph, src/components/useTextDrag.ts: Shift+← / Shift+→ step through the text)
// and the renderer's lost WebGL contexts (tooManyLosses, src/components/useGlyphRenderer.ts: a third loss within a
// minute falls back to Canvas2D, fewer are restored).

import { describe, expect, it } from 'vitest'
import { LOSS_WINDOW_MS, tooManyLosses } from '../../src/components/useGlyphRenderer'
import { stepGlyph } from '../../src/components/useTextDrag'
import type { SpecimenScene } from '../../src/specimen/scene'

/** A scene of `lines`, each character its own glyph index (its code point); '?' is missing from the font. */
function sceneOf(...lines: string[]): SpecimenScene {
  return {
    lines: lines.map((text) => ({
      glyphs: [...text].map((ch) => ({ index: ch.codePointAt(0)!, text: ch, missing: ch === '?' })),
    })),
  } as unknown as SpecimenScene
}

const code = (ch: string) => ch.codePointAt(0)!

describe('stepGlyph', () => {
  it('starts at the first letter going right and the last going left', () => {
    const scene = sceneOf('abc')
    expect(stepGlyph(scene, null, null, 1)).toBe(0)
    expect(stepGlyph(scene, null, null, -1)).toBe(2)
  })

  it('skips spaces, missing glyphs and copies of the selected glyph, across lines', () => {
    const scene = sceneOf('hel', 'l ?o')
    // 0 h, 1 e, 2 l, 3 l, 4 space, 5 ?, 6 o
    expect(stepGlyph(scene, code('e'), 1, 1)).toBe(2)
    expect(stepGlyph(scene, code('l'), 2, 1)).toBe(6)
    expect(stepGlyph(scene, code('o'), 6, -1)).toBe(3)
  })

  it('steps from the given occurrence of the selected glyph, else its first one', () => {
    const scene = sceneOf('abab')
    expect(stepGlyph(scene, code('a'), 2, 1)).toBe(3)
    // A stale occurrence (another glyph selected by a click since): from the first 'a'.
    expect(stepGlyph(scene, code('a'), 1, 1)).toBe(1)
  })

  it('stops at the ends of the text', () => {
    const scene = sceneOf('ab')
    expect(stepGlyph(scene, code('b'), 1, 1)).toBeNull()
    expect(stepGlyph(scene, code('a'), 0, -1)).toBeNull()
    expect(stepGlyph(sceneOf(''), null, null, 1)).toBeNull()
  })
})

describe('tooManyLosses', () => {
  it('restores the first two losses and gives up on the third within a minute', () => {
    const losses: number[] = []
    expect(tooManyLosses(losses, 0)).toBe(false)
    expect(tooManyLosses(losses, 1000)).toBe(false)
    expect(tooManyLosses(losses, 2000)).toBe(true)
  })

  it('forgets losses older than the window', () => {
    const losses: number[] = []
    tooManyLosses(losses, 0)
    tooManyLosses(losses, 1000)
    expect(tooManyLosses(losses, LOSS_WINDOW_MS + 500)).toBe(false)
    expect(losses).toEqual([1000, LOSS_WINDOW_MS + 500])
  })
})
