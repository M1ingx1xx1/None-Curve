// The artboard's glyph paths (src/export/svg.ts, specimenPaths): path data is built once per polygon, not once per
// glyph id. Occurrences of a glyph that share one polygon (every glyph today, and every letter at the shared level
// of a live frame) give the same strings as before; occurrences with polygons of their own (letters that react to
// Sound by their own amount) each get their own path.

import { describe, expect, it } from 'vitest'
import { specimenPaths, specimenToSvg, type SvgPathCache } from '../../src/export/svg'
import type { PolygonContour, PolygonGlyph } from '../../src/geometry/types'
import type { ArtboardLayout } from '../../src/specimen/artboard'
import { placePolygons, type ShapedSpecimen } from '../../src/specimen/scene'

const rect = (minX: number, minY: number, maxX: number, maxY: number): PolygonContour => ({
  points: [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ],
  clockwise: false,
})

const polygon = (index: number, ...contours: PolygonContour[]): PolygonGlyph => ({
  ref: { index, name: '', unicode: null },
  metrics: { unitsPerEm: 1000, advanceWidth: 700, leftSideBearing: 50, rightSideBearing: 50, ascender: 800, descender: -200 },
  contours,
})

/** "HIH" on one line: glyph 1 (advance 700), glyph 2 (advance 300), glyph 1 again. */
const shaped: ShapedSpecimen = {
  lines: [
    {
      glyphs: [
        { index: 1, text: 'H', x: 0, y: 0, advance: 700, missing: false },
        { index: 2, text: 'I', x: 700, y: 0, advance: 300, missing: false },
        { index: 1, text: 'H', x: 1000, y: 0, advance: 700, missing: false },
      ],
      width: 1700,
      baseline: 0,
    },
  ],
  indices: [1, 2],
  lineHeight: 1000,
  ascender: 800,
  descender: -200,
  capHeight: 700,
  blockWidth: 1700,
  slant: 0,
  missingCharacters: [],
  glyphCount: 3,
  truncated: false,
  kerning: false,
}

const LAYOUT: ArtboardLayout = { unitsPerPx: 2, x: -100, y: -900, width: 1000, height: 600 }
const H = polygon(1, rect(50, 0, 650, 700))
const I = polygon(2, rect(50, 0, 250, 700))
/** H as a letter that reacts more: wider, with a second contour. */
const WIDE_H = polygon(1, rect(20, 0, 680, 700), rect(300, 750, 400, 800))

describe('specimenPaths', () => {
  it('gives occurrences that share a polygon the same path, exactly as before', () => {
    const scene = placePolygons(shaped, (index) => ({ polygon: index === 1 ? H : I }))
    const paths = specimenPaths(scene, LAYOUT, 2)
    expect(paths).toEqual({
      transform: 'scale(0.5) translate(100 900)',
      paths: [
        { transform: 'translate(0 0) scale(1 -1)', d: 'M50 0L650 0L650 700L50 700Z' },
        { transform: 'translate(700 0) scale(1 -1)', d: 'M50 0L250 0L250 700L50 700Z' },
        { transform: 'translate(1000 0) scale(1 -1)', d: 'M50 0L650 0L650 700L50 700Z' },
      ],
      vertices: 12,
    })
  })

  it('gives an occurrence with a polygon of its own its own path', () => {
    const scene = placePolygons(shaped, (index, occurrence) => ({ polygon: index === 2 ? I : occurrence === 2 ? WIDE_H : H }))
    const cache: SvgPathCache = new WeakMap()
    const paths = specimenPaths(scene, LAYOUT, 2, cache)
    expect(paths.paths.map((p) => p.d)).toEqual(['M50 0L650 0L650 700L50 700Z', 'M50 0L250 0L250 700L50 700Z', 'M20 0L680 0L680 700L20 700ZM300 750L400 750L400 800L300 800Z'])
    expect(paths.vertices).toBe(4 + 4 + 8)
    // Each polygon is rounded once and cached by itself.
    expect(cache.get(H)?.d).toBe(paths.paths[0].d)
    expect(cache.get(WIDE_H)?.d).toBe(paths.paths[2].d)
    // The SVG export writes the same paths.
    const svg = specimenToSvg(scene, LAYOUT, { width: 1000, height: 600 }, 2, { fontName: 'Test', subject: 'HIH', pipeline: [] }, {
      ink: '#000',
      paper: '#fff',
      background: false,
      blur: 0,
    }).svg
    for (const path of paths.paths) expect(svg).toContain(`<path transform="${path.transform}" d="${path.d}"/>`)
  })
})
