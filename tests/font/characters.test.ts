// A font's character map (src/font/parse.ts): the characters list every mapped code point but the controls, sorted,
// and hasCharacter knows every mapped code point (controls included) and nothing else.

import { describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fonts'

describe('the character map', async () => {
  const font = await loadFixture('Roboto')

  it('lists the mapped characters in order, and hasCharacter agrees with them', () => {
    const codes = font.characters.map((c) => c.unicode!)
    expect(codes.length).toBeGreaterThan(100)
    expect(codes).toEqual([...codes].sort((a, b) => a - b))
    for (const code of codes) expect(font.hasCharacter(code)).toBe(true)
    expect(font.characters.find((c) => c.unicode === 0x41)?.index).toBeGreaterThan(0)
    // A code point the font does not map is not there, and controls are never listed.
    expect(font.hasCharacter(0xe000)).toBe(false)
    expect(codes.includes(0x09)).toBe(false)
  })
})
