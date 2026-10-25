// SVG import (src/font/svgPath.ts, svgDocument.ts, svgFont.ts): path data, arcs, transforms, which shapes fill, and the
// artwork as a font of one glyph that goes through the geometry pipeline and its effects like a letter.

import { describe, expect, it } from 'vitest'
import { FontLoadError } from '../../src/font/errors'
import { ARTWORK_CODE_POINT, isArtwork, type FontSource } from '../../src/font/model'
import { parseFont } from '../../src/font/parse'
import { MAX_SVG_SEGMENTS, readSvg } from '../../src/font/svgDocument'
import { looksLikeSvg, parseSvgFont, reverseContour } from '../../src/font/svgFont'
import { apply, arcToCubics, parsePathData, parseTransform } from '../../src/font/svgPath'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { Point, SourceContour } from '../../src/geometry/types'
import { BASE, EFFECTS, on, paramsWith } from '../helpers/params'

const SOURCE: FontSource = { kind: 'local', fileName: 'logo.svg', byteSize: 0 }
const bytes = (text: string) => new TextEncoder().encode(text)
const svgFont = (body: string, attrs = 'viewBox="0 0 100 100"') =>
  parseSvgFont(bytes(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`), SOURCE)
const ends = (c: SourceContour) => [c.start, ...c.segments.map((s) => s.to)]
const close = (p: Point, q: Point) => {
  expect(p.x).toBeCloseTo(q.x, 6)
  expect(p.y).toBeCloseTo(q.y, 6)
}
/** Signed area of the contour's end points (positive: counter-clockwise with y up). */
const area = (c: SourceContour) => {
  const p = ends(c)
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x - p[i].x) * (p[j].y + p[i].y)
  return a / 2
}
const failure = (run: () => unknown): FontLoadError => {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(FontLoadError)
    expect((error as FontLoadError).kind).toBe('svg')
    return error as FontLoadError
  }
  throw new Error('expected the import to fail')
}

describe('SVG path data', () => {
  it('reads absolute and relative lines, H and V, and implicit linetos after a moveto', () => {
    const [c] = parsePathData('M10 10 20 10 l0 10 h-10 V10 z')
    expect(ends(c)).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
      { x: 10, y: 10 },
    ])
    expect(c.segments.every((s) => s.type === 'line')).toBe(true)
  })

  it('reads compact numbers: signs, exponents, and decimals that run together', () => {
    const [c] = parsePathData('M0,0L.5.5-1e1-2.5E0')
    expect(ends(c)).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: -10, y: -2.5 },
    ])
  })

  it('reflects the last control point for S and T, and uses the pen without one', () => {
    const [c] = parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 5 30 0 T40 0')
    const [, s, q, t] = c.segments
    expect(s).toEqual({ type: 'cubic', control1: { x: 10, y: -10 }, control2: { x: 20, y: -10 }, to: { x: 20, y: 0 } })
    expect(q.type).toBe('quad')
    expect(t).toEqual({ type: 'quad', control: { x: 35, y: -5 }, to: { x: 40, y: 0 } })
    const [plain] = parsePathData('M0 0 S10 10 20 0')
    expect(plain.segments[0]).toMatchObject({ control1: { x: 0, y: 0 } })
  })

  it('starts each subpath on its own, and a segment after Z starts where that subpath began', () => {
    const contours = parsePathData('M0 0h10v10z m20 0 h5 v5 z l3 3')
    expect(contours).toHaveLength(3)
    expect(contours[1].start).toEqual({ x: 20, y: 0 })
    expect(contours[2].start).toEqual({ x: 20, y: 0 })
    expect(contours[2].segments[0].to).toEqual({ x: 23, y: 3 })
  })

  it('keeps what came before an error, as a browser draws it', () => {
    const contours = parsePathData('M0 0 L10 0 L10 10 X 5 5 L0 10')
    expect(contours).toHaveLength(1)
    expect(contours[0].segments).toHaveLength(2)
    expect(parsePathData('L10 10 nonsense')).toHaveLength(1)
    expect(parsePathData('garbage')).toEqual([])
  })

  it('turns arcs into cubics of at most a quarter turn that stay on the ellipse', () => {
    const half = arcToCubics({ x: 0, y: 0 }, 10, 10, 0, false, true, { x: 20, y: 0 })
    expect(half).toHaveLength(2)
    close(half[1].to, { x: 20, y: 0 })
    for (const s of half) {
      if (s.type !== 'cubic') throw new Error('expected cubics')
      expect(Math.hypot(s.to.x - 10, s.to.y)).toBeCloseTo(10, 6)
    }
    // Sweep 1 turns the positive way, clockwise on screen (y down): from the left end over the top.
    close(half[0].to, { x: 10, y: -10 })
    // Radii too small are scaled up to reach the end point; a zero radius is a line.
    const scaled = arcToCubics({ x: 0, y: 0 }, 1, 1, 0, false, false, { x: 20, y: 0 })
    close(scaled[scaled.length - 1].to, { x: 20, y: 0 })
    expect(arcToCubics({ x: 0, y: 0 }, 0, 5, 0, false, false, { x: 4, y: 4 })).toEqual([
      { type: 'line', to: { x: 4, y: 4 } },
    ])
    expect(arcToCubics({ x: 3, y: 3 }, 5, 5, 0, false, false, { x: 3, y: 3 })).toEqual([])
    // The large-arc flag picks the long way round: three quarters of the circle.
    expect(arcToCubics({ x: 10, y: 0 }, 10, 10, 0, true, true, { x: 0, y: 10 })).toHaveLength(3)
  })

  it('reads compact arc flags', () => {
    const [c] = parsePathData('M0 0a10 10 0 1020 0')
    close(c.segments[c.segments.length - 1].to, { x: 20, y: 0 })
  })
})

describe('SVG transforms', () => {
  it('composes the list right to left, with rotate about a point', () => {
    const m = parseTransform('translate(10, 20) scale(2)')
    expect(apply(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 22 })
    const r = parseTransform('rotate(90 10 10)')
    close(apply(r, { x: 20, y: 10 }), { x: 10, y: 20 })
    expect(apply(parseTransform('matrix(1 0 0 1 5 6)'), { x: 0, y: 0 })).toEqual({ x: 5, y: 6 })
    close(apply(parseTransform('skewX(45)'), { x: 0, y: 10 }), { x: 10, y: 10 })
  })

  it('ignores a transform it cannot read, as a browser does', () => {
    expect(parseTransform('translate(10) bogus(1)')).toEqual([1, 0, 0, 1, 0, 0])
    expect(parseTransform('matrix(1 2 3)')).toEqual([1, 0, 0, 1, 0, 0])
  })
})

describe('reading an SVG document', () => {
  it('reads every basic shape, nested group transforms, and the viewBox frame', () => {
    const doc = readSvg(`<?xml version="1.0"?>
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 110 110" width="64" height="64">
        <!-- a comment -->
        <g transform="translate(10 0)"><g transform="scale(2)"><rect width="5" height="5"/></g></g>
        <rect x="0" y="50" width="20" height="10" rx="3"/>
        <circle cx="50" cy="50" r="10"/><ellipse cx="80" cy="20" rx="10" ry="5"/>
        <polygon points="0,90 10,90 5,100"/><polyline points="20 90 30 90 25 100"/>
        <path d="M60 60h10v10z"/>
      </svg>`)
    expect(doc.frame).toEqual({ x: -5, y: -5, width: 110, height: 110 })
    expect(doc.shapes).toHaveLength(7)
    expect(ends(doc.shapes[0].contours[0])).toContainEqual({ x: 20, y: 10 })
    expect(doc.shapes[1].contours[0].segments.some((s) => s.type === 'cubic')).toBe(true)
  })

  it('skips comments and @-rules in a style sheet, and reads the rules after them', () => {
    const doc = readSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <style>/* .a { fill: none } */ @import url(x.css); @media print { .a { fill: none } } .b { fill: none }</style>
      <rect class="a" width="1" height="1"/><rect class="b" width="1" height="1"/></svg>`)
    expect(doc.shapes).toHaveLength(1)
  })

  it('fills by presentation attributes, style rules and style attributes, and inherits fill and fill-rule', () => {
    const doc = readSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <style><![CDATA[ .hole { fill-rule: evenodd } #gone, .off { display: none } path.thin { fill: none; stroke: #000 } ]]></style>
      <g fill="none"><rect width="1" height="1"/><rect width="1" height="1" fill="#f00"/></g>
      <g class="hole"><path d="M0 0h1v1z"/></g>
      <rect id="gone" width="1" height="1"/><rect class="x off" width="1" height="1"/>
      <path class="thin" d="M0 0h5v5z"/>
      <rect width="1" height="1" style="fill: none"/>
      <rect width="1" height="1" fill-opacity="0"/>
      <rect width="1" height="1" visibility="hidden"/>
      <defs><rect id="r" width="2" height="2"/></defs>
      <use href="#r" x="5"/><use xlink:href="#r" y="5"/><use href="#missing"/>
      <text x="0" y="5">Hi</text>
    </svg>`)
    expect(doc.shapes.map((s) => s.rule)).toEqual(['nonzero', 'evenodd', 'nonzero', 'nonzero'])
    expect(ends(doc.shapes[2].contours[0])[0]).toEqual({ x: 5, y: 0 })
    expect(doc.strokedOnly).toBe(1)
    expect(doc.texts).toBe(1)
  })

  it('leaves out editor data, clip paths, masks and symbols that are not used', () => {
    const doc = readSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="x" viewBox="0 0 10 10">
      <sodipodi:namedview><rect width="1" height="1"/></sodipodi:namedview>
      <clipPath id="c"><rect width="9" height="9"/></clipPath><mask id="m"><rect width="9" height="9"/></mask>
      <symbol id="s" viewBox="0 0 1 1"><rect width="1" height="1"/></symbol>
      <use href="#s" width="4" height="4"/>
    </svg>`)
    expect(doc.shapes).toHaveLength(1)
    // The symbol's 1-unit viewBox is mapped into the use's 4-unit box.
    expect(ends(doc.shapes[0].contours[0])).toContainEqual({ x: 4, y: 4 })
  })

  it('does not follow a use that refers to itself', () => {
    const doc = readSvg(`<svg viewBox="0 0 10 10"><g id="a"><rect width="1" height="1"/><use href="#a"/></g></svg>`)
    expect(doc.shapes.length).toBeGreaterThan(0)
    expect(doc.shapes.length).toBeLessThan(40)
  })
})

describe('the artwork as a font of one glyph', () => {
  it('is an SVG, mapped to its one character', () => {
    const font = svgFont('<rect width="100" height="100"/>')
    expect(isArtwork(font)).toBe(true)
    expect(font.format).toBe('svg')
    expect(font.familyName).toBe('logo')
    expect(font.characters).toEqual([{ index: 1, name: 'artwork', unicode: ARTWORK_CODE_POINT }])
    const [glyph] = font.shapeLine(String.fromCodePoint(ARTWORK_CODE_POINT))
    expect(glyph).toMatchObject({ index: 1, missing: false, xAdvance: 1000 })
    expect(font.shapeLine('A')[0].missing).toBe(true)
    expect(font.getPreviewPath(1)).toMatch(/^M/)
  })

  it('scales the frame to 1000 units high, its bottom on the baseline, with y up', () => {
    const font = svgFont('<path d="M0 0H10V10Z"/>', 'viewBox="0 0 20 10"')
    const glyph = font.getGlyph(1)
    expect(glyph.metrics.advanceWidth).toBe(2000)
    // The SVG's top-left corner (0, 0) is at the top of the frame: y 1000.
    expect(ends(glyph.contours[0])).toContainEqual({ x: 0, y: 1000 })
    expect(ends(glyph.contours[0])).toContainEqual({ x: 1000, y: 0 })
    // Without a viewBox, width and height frame it; without either, the shapes' own bounds.
    expect(svgFont('<rect width="5" height="5"/>', 'width="10" height="5"').getGlyph(1).metrics.advanceWidth).toBe(2000)
    const bare = svgFont('<rect x="50" y="50" width="10" height="20"/>', '').getGlyph(1)
    expect(bare.metrics.advanceWidth).toBeCloseTo(500)
    expect(Math.min(...ends(bare.contours[0]).map((p) => p.y))).toBeCloseTo(0)
  })

  it('turns even-odd holes against their outlines, and a nonzero shape so its ink winds positively', () => {
    const ring = svgFont('<path fill-rule="evenodd" d="M0 0H100V100H0Z M25 25H75V75H25Z"/>').getGlyph(1)
    expect(Math.sign(area(ring.contours[0]))).toBe(1)
    expect(Math.sign(area(ring.contours[1]))).toBe(-1)
    // Both drawn the same way round: by nonzero the hole would fill, so it stays as drawn.
    const solid = svgFont('<path d="M0 0H100V100H0Z M25 25H75V75H25Z"/>').getGlyph(1)
    expect(Math.sign(area(solid.contours[0]))).toBe(Math.sign(area(solid.contours[1])))
    expect(area(solid.contours[0])).toBeGreaterThan(0)
  })

  it('reverses a contour exactly, ending where it starts', () => {
    const [c] = parsePathData('M0 0 L10 0 C10 5 5 10 0 10')
    const r = reverseContour(c)
    expect(r.start).toEqual({ x: 0, y: 0 })
    expect(r.segments[0]).toEqual({ type: 'line', to: { x: 0, y: 10 } })
    expect(r.segments[1]).toEqual({
      type: 'cubic',
      control1: { x: 5, y: 10 },
      control2: { x: 10, y: 5 },
      to: { x: 10, y: 0 },
    })
    expect(r.segments[2].to).toEqual({ x: 0, y: 0 })
  })

  it('is what parseFont opens for SVG bytes, in the page and in the worker alike', async () => {
    expect(looksLikeSvg(bytes('﻿  \n<svg/>'))).toBe(true)
    expect(looksLikeSvg(new Uint8Array([0, 1, 0, 0]))).toBe(false)
    const font = await parseFont(
      bytes('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>'),
      SOURCE,
      new AbortController().signal,
    )
    expect(font.format).toBe('svg')
  })
})

describe('SVG files that cannot be used', () => {
  it('says what is wrong with broken XML, a file that is not an SVG, and one with nothing to fill', () => {
    expect(failure(() => svgFont('<g><rect width="1" height="1"/>')).message).toMatch(/not well-formed/)
    expect(failure(() => parseSvgFont(bytes('<html><body/></html>'), SOURCE)).message).toMatch(/not an SVG/)
    expect(failure(() => parseSvgFont(bytes('<svg><a></b></svg>'), SOURCE)).message).toMatch(/does not close/)
    expect(failure(() => svgFont('<path d="M0 0L10 10" fill="none" stroke="black"/>')).message).toMatch(
      /only has strokes/,
    )
    expect(failure(() => svgFont('<line x1="0" y1="0" x2="5" y2="5" stroke="black"/>')).message).toMatch(/strokes/)
    expect(failure(() => svgFont('<text>Logo</text>')).message).toMatch(/only has text/)
    expect(failure(() => svgFont('')).message).toMatch(/no filled shapes/)
  })

  it('refuses files and artworks too large to rebuild', () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x20)
    big[0] = 0x3c
    expect(failure(() => parseSvgFont(big, SOURCE)).message).toMatch(/larger than 10 MB/)
    const d = 'M0 0' + 'l1 0'.repeat(MAX_SVG_SEGMENTS + 1)
    expect(failure(() => svgFont(`<path d="${d}"/>`)).message).toMatch(/segments/)
  })

  it('stops nested <use> that repeats a small file without end, before drawing it all', () => {
    // Eight levels, each using the one below ten times: 10^8 rectangles from under a kilobyte.
    const levels = Array.from({ length: 8 }, (_, i) => {
      const uses = Array.from({ length: 10 }, () => `<use href="#l${i}"/>`).join('')
      return `<g id="l${i + 1}">${uses}</g>`
    })
    const body = `<defs><rect id="l0" width="1" height="1"/>${levels.join('')}</defs><use href="#l8"/>`
    const started = performance.now()
    expect(failure(() => svgFont(body)).message).toMatch(/segments|too many times/)
    expect(performance.now() - started).toBeLessThan(2000)
    const empty = `<defs><g id="l0"/>${levels.join('')}</defs><use href="#l8"/><rect width="1" height="1"/>`
    expect(failure(() => svgFont(empty)).message).toMatch(/too many times/)
  })

  it('reads a long style sheet with no rules in linear time, and refuses too many rules', () => {
    const started = performance.now()
    readSvg(`<svg><style>${'a'.repeat(200_000)}${'@x'.repeat(50_000)}${'/*'.repeat(50_000)}</style></svg>`)
    expect(performance.now() - started).toBeLessThan(500)
    const rules = Array.from({ length: 1001 }, (_, i) => `.c${i} { fill: none }`).join('')
    expect(failure(() => svgFont(`<style>${rules}</style><rect width="1" height="1"/>`)).message).toMatch(/style rules/)
  })
})

describe('the artwork through the pipeline', () => {
  const font = svgFont(
    '<path fill-rule="evenodd" d="M50 5a45 45 0 1 1 0 90a45 45 0 1 1 0-90zM50 30a20 20 0 1 0 0 40a20 20 0 1 0 0-40z"/>' +
      '<rect x="10" y="80" width="80" height="15" rx="5"/>',
  )
  const source = font.getGlyph(1)

  it('comes out as straight segments with its hole, plain and under every effect', () => {
    const plain = deriveGeometry(source, BASE)
    expect(plain.polygon.contours.length).toBeGreaterThanOrEqual(2)
    expect(plain.polygon.contours.some((c) => c.clockwise !== plain.polygon.contours[0].clockwise)).toBe(true)
    for (const effect of EFFECTS) {
      const derived = deriveGeometry(source, paramsWith({}, on(effect)))
      expect(derived.polygon.contours.length, effect).toBeGreaterThan(0)
      for (const c of derived.polygon.contours)
        for (const p of c.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y), effect).toBe(true)
    }
  })
})
