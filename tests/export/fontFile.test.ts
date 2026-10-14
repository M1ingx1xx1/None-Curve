// Font export (src/export/fontFile.ts) on the fixture fonts, read back independently: an OpenType/CFF file of
// straight outlines only, with the source's pair kerning (GPOS) laid out the same, and its line spacing written as
// the typographic metrics with USE_TYPO_METRICS set. Outlines reaching further than a font stores (long Thorn tips)
// are trimmed to fit, and the file's bounding boxes cover exactly what it holds.

import type { Font } from 'fontkit'
import { describe, expect, it } from 'vitest'
import { FONT_BOX_LIMITS, glyphFontBox } from '../../src/export/fitGlyph'
import { buildFontFile, planFontExport, type FontExportResult, type KnownGlyph } from '../../src/export/fontFile'
import { signedArea } from '../../src/geometry/flatten'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { GeometryParams, Point, PolygonGlyph } from '../../src/geometry/types'
import { FIXTURE_FONTS, fixtureBytes, LATIN_SAMPLE, loadFixture, type FixtureFont } from '../helpers/fonts'
import { ALL_DEFAULT, BASE, GEOMETRY, on, paramsWith } from '../helpers/params'
import { cffFontBBox, charStringProblems, signature, table, tableDirectory } from '../helpers/sfnt'

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

/** The fixture exported with these settings (built once per test file), with `known` glyphs used as they are. */
function exported(name: FixtureFont, params: GeometryParams, label: string, text = TEXT, known?: (index: number) => KnownGlyph | undefined): Promise<FontExportResult> {
  const key = `${name} ${label}`
  let build = builds.get(key)
  if (!build) {
    build = loadFixture(name).then((font) =>
      buildFontFile(font, planFontExport(font, 'specimen', null, text), params, label, { familyName: 'Test Straight', styleName: 'Regular' }, new AbortController().signal, () => {}, {
        known,
        cache: false,
        sliceMs: Infinity,
      }),
    )
    builds.set(key, build)
  }
  return build
}

/** Every glyph's outline as read back (only moveTo / lineTo / closePath expected), by glyph id. */
function readBack(font: Font): { commands: Set<string>; outlines: Point[][] } {
  const commands = new Set<string>()
  const outlines: Point[][] = []
  for (let id = 0; id < font.numGlyphs; id++) {
    const points: Point[] = []
    for (const { command, args } of font.getGlyph(id).path.commands) {
      commands.add(command)
      if (args.length >= 2) points.push({ x: args[args.length - 2], y: args[args.length - 1] })
    }
    outlines.push(points)
  }
  return { commands, outlines }
}

function extent(points: Point[]) {
  let [xMin, yMin, xMax, yMax] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of points) {
    xMin = Math.min(xMin, p.x)
    yMin = Math.min(yMin, p.y)
    xMax = Math.max(xMax, p.x)
    yMax = Math.max(yMax, p.y)
  }
  return { xMin, yMin, xMax, yMax }
}

/**
 * What every export must hold, however far its outlines reach: only straight-line charstrings (checked byte by
 * byte), every glyph within ±32767 and at most 32,766 units across, and head's bounding box and the CFF FontBBox
 * both the union of every glyph's points, .notdef included.
 */
async function expectStorable(result: FontExportResult) {
  const bytes = new Uint8Array(result.bytes)
  expect(charStringProblems(bytes)).toEqual([])
  const { commands, outlines } = readBack(await openWithFontkit(bytes))
  expect([...commands].filter((c) => c !== 'moveTo' && c !== 'lineTo' && c !== 'closePath')).toEqual([])
  for (const points of outlines.filter((o) => o.length)) {
    const e = extent(points)
    expect(Math.max(-e.xMin, -e.yMin, e.xMax, e.yMax)).toBeLessThanOrEqual(FONT_BOX_LIMITS.maxCoordinate)
    expect(Math.max(e.xMax - e.xMin, e.yMax - e.yMin)).toBeLessThanOrEqual(FONT_BOX_LIMITS.span)
  }
  const union = extent(outlines.flat())
  const head = table(bytes, 'head')!
  const headBox = [head.getInt16(36), head.getInt16(38), head.getInt16(40), head.getInt16(42)]
  expect(headBox).toEqual([union.xMin, union.yMin, union.xMax, union.yMax])
  expect(headBox[0]).toBeLessThanOrEqual(headBox[2])
  expect(headBox[1]).toBeLessThanOrEqual(headBox[3])
  expect(cffFontBBox(bytes)).toEqual(headBox)
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
      expect(result.trimmed).toEqual([])
      await expectStorable(result)
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

describe('font export: outlines beyond what a font stores', () => {
  /** “A” with a thin spike from below its baseline to (245000, -245000); “B” with an advance of 40,000 units. */
  async function farReaching() {
    const font = await loadFixture('Roboto')
    const index = (char: string) => font.characters.find((c) => c.unicode === char.codePointAt(0))!.index
    const base = (char: string) => deriveGeometry(font.getGlyph(index(char)), BASE).polygon
    const spike: Point[] = [{ x: 500, y: -10 }, { x: 245000, y: -245000 }, { x: 700, y: -10 }]
    const a = base('A')
    const withSpike: PolygonGlyph = { ...a, contours: [...a.contours, { points: spike, clockwise: signedArea(spike) < 0 }] }
    const b = base('B')
    const wide: PolygonGlyph = { ...b, metrics: { ...b.metrics, advanceWidth: 40000 } }
    const known = (i: number): KnownGlyph | undefined => (i === index('A') ? { polygon: withSpike } : i === index('B') ? { polygon: wide } : undefined)
    const result = await exported('Roboto', BASE, 'far-reaching outlines', 'ABC', known)
    return { result, withSpike }
  }

  it('trims a glyph reaching past the font’s limits to fit, instead of leaving it out', async () => {
    const { result, withSpike } = await farReaching()
    expect(result.excluded.map((e) => e.label)).toEqual(['“B”'])
    expect(result.trimmed).toEqual(['“A”'])
    const font = await openWithFontkit(new Uint8Array(result.bytes))
    const a = extent(readBack(font).outlines[font.glyphForCodePoint(65).id])
    // Cut off flat at the bottom of its window, 32,766 units tall around the em box.
    const box = glyphFontBox(withSpike)
    expect(box.maxY - box.minY).toBe(FONT_BOX_LIMITS.span)
    expect(a.yMin).toBe(box.minY)
    await expectStorable(result)
  })

  it('leaves out an advance wider than a font stores, with the reason, without failing the export', async () => {
    const { result } = await farReaching()
    expect(result.excluded).toEqual([{ label: '“B”', reason: expect.stringMatching(/advance width \(40000\)/) }])
    expect(result.characterCount).toBe(2)
  })

  it.each(FIXTURE_FONTS)('exports every glyph of %s with Thorn reaching across a 120 em canvas', async (name) => {
    const params = paramsWith(GEOMETRY.plain, on('thorn', { canvasReach: 1, canvasEm: 120 }))
    const result = await exported(name, params, 'Thorn across the canvas')
    expect(result.excluded).toEqual([])
    expect(result.trimmed.length).toBeGreaterThan(0)
    await expectStorable(result)
  }, 120_000)
})
