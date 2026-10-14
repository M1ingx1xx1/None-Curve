// Font export (src/export/fontFile.ts) on the fixture fonts, read back independently: an OpenType/CFF file of
// straight outlines only, with the source's pair kerning (GPOS) laid out the same, and its line spacing written as
// the typographic metrics with USE_TYPO_METRICS set.

import type { Font } from 'fontkit'
import { describe, expect, it } from 'vitest'
import { buildFontFile, planFontExport, type FontExportResult } from '../../src/export/fontFile'
import type { GeometryParams } from '../../src/geometry/types'
import { FIXTURE_FONTS, fixtureBytes, LATIN_SAMPLE, loadFixture, type FixtureFont } from '../helpers/fonts'
import { ALL_DEFAULT, BASE, GEOMETRY, paramsWith } from '../helpers/params'
import { signature, table, tableDirectory } from '../helpers/sfnt'

/** Letters and marks that kern with each other in most Latin fonts. */
const KERNING_CHARS = 'AVWYTLPFKROvwyaoe.,'
const TEXT = `${LATIN_SAMPLE} ${KERNING_CHARS}`

async function openWithFontkit(bytes: Uint8Array): Promise<Font> {
  const fontkit = await import('fontkit')
  const parsed = fontkit.create(bytes as unknown as Buffer)
  if ('fonts' in parsed) throw new Error('a collection')
  return parsed
}

const builds = new Map<string, Promise<FontExportResult>>()

/** The fixture exported with these settings (built once per test file). */
function exported(name: FixtureFont, params: GeometryParams, label: string): Promise<FontExportResult> {
  const key = `${name} ${label}`
  let build = builds.get(key)
  if (!build) {
    build = loadFixture(name).then((font) =>
      buildFontFile(font, planFontExport(font, 'specimen', null, TEXT), params, label, { familyName: 'Test Straight', styleName: 'Regular' }, new AbortController().signal, () => {}, {
        cache: false,
        sliceMs: Infinity,
      }),
    )
    builds.set(key, build)
  }
  return build
}

describe.each(FIXTURE_FONTS)('font export: %s', (name) => {
  for (const [label, params] of [
    ['Experimental off', BASE],
    ['all five effects', paramsWith(GEOMETRY.plain, ALL_DEFAULT)],
  ] as const) {
    it(`writes OpenType/CFF with straight outlines only (${label})`, async () => {
      const result = await exported(name, params, label)
      const bytes = new Uint8Array(result.bytes)
      expect(signature(bytes)).toBe('OTTO')
      const tables = tableDirectory(bytes)
      expect(tables.has('CFF ')).toBe(true)
      expect(tables.has('glyf')).toBe(false)
      expect(result.excluded).toEqual([])
      const font = await openWithFontkit(bytes)
      expect(font.numGlyphs).toBe(result.glyphCount)
      const commands = new Set<string>()
      let contours = 0
      for (let id = 1; id < font.numGlyphs; id++) {
        for (const { command } of font.getGlyph(id).path.commands) {
          commands.add(command)
          if (command === 'moveTo') contours++
        }
      }
      expect([...commands].filter((c) => c !== 'moveTo' && c !== 'lineTo' && c !== 'closePath')).toEqual([])
      expect(contours).toBe(result.contourCount)
    })
  }

  it('keeps the pair kerning: every pair lays out with the same advances as in the source', async () => {
    const result = await exported(name, BASE, 'Experimental off')
    expect(result.kerning).toBe(true)
    const bytes = new Uint8Array(result.bytes)
    expect(tableDirectory(bytes).has('GPOS')).toBe(true)
    const source = await openWithFontkit(fixtureBytes(name))
    const written = await openWithFontkit(bytes)
    const features = ['kern']
    let kerned = 0
    const differences: string[] = []
    for (const first of KERNING_CHARS) {
      for (const second of KERNING_CHARS) {
        const pair = first + second
        const want = source.layout(pair, features).positions.map((p) => p.xAdvance)
        const got = written.layout(pair, features).positions.map((p) => p.xAdvance)
        if (want[0] !== source.layout(first, features).positions[0].xAdvance) kerned++
        if (want.join() !== got.join()) differences.push(`${pair}: ${want} in the source, ${got} exported`)
      }
    }
    expect(differences).toEqual([])
    expect(kerned).toBeGreaterThan(20)
  })

  it('sets USE_TYPO_METRICS, with the typographic metrics equal to hhea', async () => {
    const result = await exported(name, BASE, 'Experimental off')
    const bytes = new Uint8Array(result.bytes)
    const os2 = table(bytes, 'OS/2')!
    const hhea = table(bytes, 'hhea')!
    expect(os2.getUint16(0)).toBeGreaterThanOrEqual(4)
    expect(os2.getUint16(62) & (1 << 7)).not.toBe(0)
    const typo = [os2.getInt16(68), os2.getInt16(70), os2.getInt16(72)]
    expect(typo).toEqual([hhea.getInt16(4), hhea.getInt16(6), hhea.getInt16(8)])
    // The line spacing is the source's (hhea), as the canvas sets it.
    const sourceHhea = table(fixtureBytes(name), 'hhea')!
    expect(typo).toEqual([sourceHhea.getInt16(4), sourceHhea.getInt16(6), sourceHhea.getInt16(8)])
  })
})
