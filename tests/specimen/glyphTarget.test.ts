// What catches clicks and Free drags on a glyph of the canvas (SpecimenGlyph in src/components/SpecimenView.tsx and
// .glyph-box in styles.css). Without thorns, exactly as before Thorn reached across the canvas: the advance by the line
// plus the drawn outlines, so a zero-width mark is hit only on its own ink, and Ripple petals or Slipstream streaks never
// grow a box over the neighbouring letters. With thorns, the drawn outlines ignore the pointer and an invisible copy of
// the font's own outline, flattened (PolygonGlyph.clickOutline), takes the letter's clicks: straight segments only, like
// everything the canvas draws, and never a box grown from the polygon.

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { SpecimenGlyph } from '../../src/components/SpecimenView'
import type { LoadedFont } from '../../src/font/model'
import { flattenGlyph } from '../../src/geometry/flatten'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { contoursToPath } from '../../src/geometry/sourcePath'
import type { GeometryParams, PolygonGlyph, SourceGlyph } from '../../src/geometry/types'
import type { OutlineView, ViewParams } from '../../src/state/types'
import { loadFixture } from '../helpers/fonts'
import { winding } from '../helpers/outline'
import { BASE, on, paramsWith, THORN_FARTHEST } from '../helpers/params'

let font: LoadedFont
beforeAll(async () => {
  font = await loadFixture('Roboto')
})

const view = (outline: OutlineView = 'flattened'): ViewParams => ({
  outline,
  showFill: true,
  showSkeleton: false,
  showVertices: false,
  showMetrics: false,
  zoom: 1,
  panX: 0,
  panY: 0,
})

const glyphIndex = (char: string) => font.characters.find((c) => c.unicode === char.codePointAt(0))!.index

function render(char: string, params: GeometryParams | null, advance: number, outline?: OutlineView) {
  const index = glyphIndex(char)
  const source = font.getGlyph(index)
  const polygon = params ? deriveGeometry(source, params).polygon : null
  const { ascender, descender } = font.metrics
  const markup = renderToStaticMarkup(
    createElement(
      'svg',
      null,
      createElement(SpecimenGlyph, {
        index,
        text: char,
        x: 0,
        y: 0,
        advance,
        skew: '',
        ascender,
        descender,
        source,
        polygon,
        view: view(outline),
        markerRadius: 4,
        showMarkers: false,
        selected: false,
        onSelect: () => {},
      }),
    ),
  )
  const group = /<g class="([^"]*)"/.exec(markup)![1].split(' ')
  const rects = [...markup.matchAll(/<rect class="glyph-box" x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"/g)].map((m) => m.slice(1).map(Number))
  const paths = [...markup.matchAll(/<path class="glyph-box" d="([^"]*)"/g)].map((m) => m[1])
  return { source, polygon, group, rects, paths, column: [0, descender, advance, ascender - descender] }
}

const width = (polygon: PolygonGlyph) => {
  const xs = polygon.contours.flatMap((c) => c.points.map((p) => p.x))
  return Math.max(...xs) - Math.min(...xs)
}

const advanceOf = (char: string) => font.getGlyph(glyphIndex(char)).metrics.advanceWidth

/** The font's own outline of the letter, as Curve flattening draws it. */
const flattenedPath = (source: SourceGlyph) => contoursToPath(flattenGlyph(source, BASE.flatten).polygon.contours)

describe('glyph click targets without thorns', () => {
  it('are the advance by the line, and the drawn outlines keep the pointer', () => {
    const glyph = render('l', BASE, advanceOf('l'))
    expect(glyph.group).toEqual(['specimen-glyph'])
    expect(glyph.rects).toEqual([glyph.column])
    expect(glyph.paths).toEqual([])
  })

  it('never grow over the neighbours from Ripple petals', () => {
    const glyph = render('o', paramsWith({}, on('ripple', { petals: 1.5 })), advanceOf('o'))
    expect(width(glyph.polygon!)).toBeGreaterThan(advanceOf('o') * 1.2)
    expect(glyph.group).toEqual(['specimen-glyph'])
    expect(glyph.rects).toEqual([glyph.column])
    expect(glyph.paths).toEqual([])
  })

  it('give a zero-width mark no line-tall column over the letter it sits on', () => {
    const glyph = render('́', BASE, 0)
    expect(glyph.group).toEqual(['specimen-glyph'])
    expect(glyph.rects).toEqual([[0, font.metrics.descender, 0, font.metrics.ascender - font.metrics.descender]])
    expect(glyph.paths).toEqual([])
  })

  it('are the advance alone while the polygon is still on its way', () => {
    const glyph = render('l', null, advanceOf('l'))
    expect(glyph.group).toEqual(['specimen-glyph'])
    expect(glyph.rects).toEqual([glyph.column])
  })
})

describe('glyph click targets with thorns', () => {
  const thorns = () => paramsWith({}, THORN_FARTHEST)

  it('are the advance by the line and the font\'s own outline, flattened, never the thorns', () => {
    const glyph = render('l', thorns(), advanceOf('l'))
    expect(glyph.polygon!.layoutBox).toBeDefined()
    expect(width(glyph.polygon!)).toBeGreaterThan(advanceOf('l') * 4)
    expect(glyph.group).toEqual(['specimen-glyph', 'specimen-glyph-thorned'])
    expect(glyph.rects).toEqual([glyph.column])
    expect(glyph.paths).toEqual([contoursToPath(glyph.polygon!.clickOutline!)])
    expect(glyph.paths).toEqual([flattenedPath(glyph.source)])
  })

  it('are straight segments only, in every view', () => {
    for (const outline of ['flattened', 'source', 'compare'] as const) {
      for (const char of 'lo@́') {
        const glyph = render(char, thorns(), advanceOf(char), outline)
        expect(glyph.paths.length, `${outline} "${char}"`).toBe(1)
        for (const d of glyph.paths) expect(d, `${outline} "${char}"`).toMatch(/^M[MLZ0-9 .-]+Z$/)
      }
    }
  })

  it('leave the petals Ripple drew out of the letter to whatever lies behind them, like the thorns', () => {
    const glyph = render('o', paramsWith({}, { ...on('ripple', { petals: 1.5 }), ...THORN_FARTHEST }), advanceOf('o'))
    expect(glyph.paths).toEqual([contoursToPath(glyph.polygon!.clickOutline!)])
    expect(glyph.paths).toEqual([flattenedPath(glyph.source)])
    // The petals reach past the advance, over the neighbouring letters; the click target does not.
    const outline = glyph.polygon!.clickOutline!.map((c) => c.points)
    const petals = render('o', paramsWith({}, on('ripple', { petals: 1.5 })), advanceOf('o')).polygon!
    const out = petals.contours.flatMap((c) => c.points).filter((p) => p.x < -50 || p.x > advanceOf('o') + 50)
    expect(out.length).toBeGreaterThan(10)
    for (const p of out) expect(winding(outline, p)).toBe(0)
  })

  it('give a zero-width mark its own shape and no line-tall column', () => {
    const glyph = render('́', thorns(), 0)
    expect(glyph.group).toContain('specimen-glyph-thorned')
    expect(glyph.rects.every(([, , w]) => w === 0)).toBe(true)
    expect(glyph.paths).toEqual([contoursToPath(glyph.polygon!.clickOutline!)])
  })

  it('are the same in the Original view, where the polygon is not drawn and the outline drawn is the font\'s own', () => {
    const glyph = render('l', thorns(), advanceOf('l'), 'source')
    expect(glyph.rects).toEqual([glyph.column])
    expect(glyph.paths).toEqual([flattenedPath(glyph.source)])
  })
})

describe('the outlines ignore the pointer only on glyphs with thorns', () => {
  it('in styles.css', () => {
    const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, selector, body]) => selector.includes('specimen-glyph') && /pointer-events:\s*none/.test(body))
    expect(rules.length).toBeGreaterThan(0)
    for (const [, selector] of rules) {
      for (const part of selector.split(',')) expect(part).toContain('.specimen-glyph-thorned')
    }
  })
})
