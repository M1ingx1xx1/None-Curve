// The fixture fonts (tests/fixtures/fonts, SIL Open Font License) opened through the app's own parser.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FontSource, LoadedFont } from '../../src/font/model'
import { parseFont } from '../../src/font/parse'

/** STIX Two Text: TrueType, variable (wght), with overlapping contours in many glyphs. Roboto: TrueType, static. */
export const FIXTURE_FONTS = ['STIXTwoText', 'Roboto'] as const
export type FixtureFont = (typeof FIXTURE_FONTS)[number]

export function fixturePath(name: FixtureFont): string {
  return fileURLToPath(new URL(`../fixtures/fonts/${name}.ttf`, import.meta.url))
}

export function fixtureBytes(name: FixtureFont): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)))
}

export function localSource(fileName: string, bytes: Uint8Array, face?: number): FontSource {
  return { kind: 'local', fileName, byteSize: bytes.length, ...(face === undefined ? {} : { face }) }
}

const opened = new Map<FixtureFont, Promise<LoadedFont>>()

/** The fixture font, parsed once per test file. */
export function loadFixture(name: FixtureFont): Promise<LoadedFont> {
  let font = opened.get(name)
  if (!font) {
    const bytes = fixtureBytes(name)
    font = parseFont(bytes, localSource(`${name}.ttf`, bytes), new AbortController().signal)
    opened.set(name, font)
  }
  return font
}

/** The characters the geometry tests run on: Latin letters, figures, and a few marks, accents and symbols. */
export const LATIN_SAMPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&@?%éÅßą'

/** The sample's glyphs in the font (each glyph once, .notdef left out). */
export function sampleGlyphs(font: LoadedFont, text = LATIN_SAMPLE): { index: number; char: string }[] {
  const seen = new Set<number>()
  const glyphs: { index: number; char: string }[] = []
  for (const char of text) {
    const ref = font.characters.find((c) => c.unicode === char.codePointAt(0))
    if (!ref || ref.index === 0 || seen.has(ref.index)) continue
    seen.add(ref.index)
    glyphs.push({ index: ref.index, char })
  }
  return glyphs
}
