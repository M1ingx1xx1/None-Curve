// The canvas renderers' hit testing (src/render/hitTest.ts) against what the SVG canvas gives the browser
// (tests/specimen/glyphTarget.test.ts): the advance by the line plus the drawn outlines; with thorns, the advance and
// the click outline only; with Fill off, the outline's stroke band; the topmost glyph first; slant and the Free drag
// undone; missing boxes reported but not selectable; the text block as Free position's handle.

import { beforeAll, describe, expect, it } from 'vitest'
import type { LoadedFont } from '../../src/font/model'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { GeometryParams, PolygonGlyph } from '../../src/geometry/types'
import { hitScene, STROKE_HIT_PX, type HitOptions } from '../../src/render/hitTest'
import type { SpecimenScene } from '../../src/specimen/scene'
import { loadFixture } from '../helpers/fonts'
import { winding } from '../helpers/outline'
import { BASE, on, paramsWith, THORN_FARTHEST } from '../helpers/params'
import { fontSource, sceneOf, square, squareSource } from './fixtures'

let font: LoadedFont
beforeAll(async () => {
  font = await loadFixture('Roboto')
})

const glyphIndex = (char: string) => font.characters.find((c) => c.unicode === char.codePointAt(0))!.index
const advanceOf = (char: string) => font.getGlyph(glyphIndex(char)).metrics.advanceWidth

function options(patch: Partial<HitOptions> = {}): HitOptions {
  return {
    outline: 'flattened',
    fill: true,
    showSkeleton: false,
    showVertices: false,
    showMarkers: false,
    markerRadius: 4,
    u: 1,
    ascender: font?.metrics.ascender ?? 900,
    descender: font?.metrics.descender ?? -250,
    freeMove: false,
    offsetX: 0,
    offsetY: 0,
    source: font ? fontSource(font) : () => squareSource(),
    ...patch,
  }
}

/** One real glyph at the origin. */
function realScene(char: string, params: GeometryParams | null): { scene: SpecimenScene; polygon: PolygonGlyph | null } {
  const index = glyphIndex(char)
  const polygon = params ? deriveGeometry(font.getGlyph(index), params).polygon : null
  return { scene: sceneOf([[{ index, text: char, x: 0, y: 0, advance: advanceOf(char), polygon }]]), polygon }
}

/** A point in a glyph's own units (y up) to scene units, for a glyph at (x, y) with the scene's slant. */
function toScene(x: number, y: number, slant: number, gx: number, gy: number): [number, number] {
  const skew = Math.tan((-slant * Math.PI) / 180)
  return [x + gx - skew * gy, y - gy]
}

describe('glyph hits without thorns', () => {
  it('are the advance by the line, and nothing beside it where no ink is', () => {
    const { scene } = realScene('l', BASE)
    const adv = advanceOf('l')
    expect(hitScene(scene, adv / 2, -100, options())).toMatchObject({ kind: 'glyph', index: glyphIndex('l'), occurrence: 0 })
    expect(hitScene(scene, adv / 2, -font.metrics.ascender + 1, options())).toMatchObject({ kind: 'glyph' })
    expect(hitScene(scene, adv + 200, -100, options())).toBeNull()
    expect(hitScene(scene, adv / 2, -font.metrics.ascender - 50, options())).toBeNull()
  })

  it('take the drawn outline beyond the advance: Ripple petals hit where they fill (nonzero), as in SVG', () => {
    const { scene, polygon } = realScene('o', paramsWith({}, on('ripple', { petals: 1.5 })))
    const adv = advanceOf('o')
    const contours = polygon!.contours.map((c) => c.points)
    let outside = 0
    for (let gx = -600; gx <= adv + 600; gx += 37) {
      for (let gy = -600; gy <= 1300; gy += 41) {
        if (gx >= 0 && gx <= adv && gy >= font.metrics.descender && gy <= font.metrics.ascender) continue
        const hit = hitScene(scene, gx, -gy, options())
        const inside = winding(contours, { x: gx, y: gy }) !== 0
        expect(hit !== null, `(${gx}, ${gy})`).toBe(inside)
        if (inside) outside++
      }
    }
    expect(outside).toBeGreaterThan(5)
  })

  it('are the advance alone while the polygon is still on its way', () => {
    const { scene } = realScene('l', null)
    expect(hitScene(scene, advanceOf('l') / 2, -100, options())).toMatchObject({ kind: 'glyph' })
    expect(hitScene(scene, -100, -100, options())).toBeNull()
  })
})

describe('glyph hits with thorns', () => {
  it('are the advance and the click outline, never the thorns', () => {
    const { scene, polygon } = realScene('l', paramsWith({}, THORN_FARTHEST))
    const adv = advanceOf('l')
    expect(polygon!.clickOutline).toBeDefined()
    expect(hitScene(scene, adv / 2, -100, options())).toMatchObject({ kind: 'glyph' })
    const far = polygon!.contours.flatMap((c) => c.points).filter((p) => p.x < -100 || p.x > adv + 100)
    expect(far.length).toBeGreaterThan(10)
    for (const p of far) expect(hitScene(scene, p.x, -p.y, options()), `(${p.x}, ${p.y})`).toBeNull()
    // Fill off and Compare do not bring the thorns back.
    for (const p of far.slice(0, 20)) {
      expect(hitScene(scene, p.x, -p.y, options({ fill: false }))).toBeNull()
      expect(hitScene(scene, p.x, -p.y, options({ outline: 'compare' }))).toBeNull()
    }
  })

  it('are the same in the Original view', () => {
    const { scene, polygon } = realScene('l', paramsWith({}, THORN_FARTHEST))
    const far = polygon!.contours.flatMap((c) => c.points).filter((p) => p.x > advanceOf('l') + 100)
    expect(hitScene(scene, advanceOf('l') / 2, -100, options({ outline: 'source' }))).toMatchObject({ kind: 'glyph' })
    for (const p of far.slice(0, 20)) expect(hitScene(scene, p.x, -p.y, options({ outline: 'source' }))).toBeNull()
  })
})

describe('glyph hits on hand-built glyphs', () => {
  // A square entirely left of its advance box: only its drawn outline can be hit there.
  const left = square(-400, 0, -100, 300)
  const sceneWith = (slant = 0) => sceneOf([[{ index: 1, polygon: left }]], slant)
  const plain = (patch: Partial<HitOptions> = {}) => options({ source: () => squareSource(), ascender: 900, descender: -250, ...patch })

  it('with Fill off take the stroke band only, 1.5 px either side of the outline', () => {
    const scene = sceneWith()
    expect(hitScene(scene, -250, -150, plain())).toMatchObject({ kind: 'glyph' })
    expect(hitScene(scene, -250, -150, plain({ fill: false }))).toBeNull()
    expect(hitScene(scene, -400, -150, plain({ fill: false }))).toMatchObject({ kind: 'glyph' })
    expect(hitScene(scene, -400 - (STROKE_HIT_PX - 0.1), -150, plain({ fill: false }))).toMatchObject({ kind: 'glyph' })
    expect(hitScene(scene, -400 - (STROKE_HIT_PX + 0.5), -150, plain({ fill: false }))).toBeNull()
    // The band is in screen pixels: twice the font units at u = 2.
    expect(hitScene(scene, -400 - 2 * (STROKE_HIT_PX - 0.1), -150, plain({ fill: false, u: 2 }))).toMatchObject({ kind: 'glyph' })
  })

  it('go to the topmost (last drawn) glyph where two overlap', () => {
    const scene = sceneOf([[{ index: 1 }, { index: 2, x: 300 }]])
    expect(hitScene(scene, 400, -100, plain())).toMatchObject({ index: 2, occurrence: 1 })
    expect(hitScene(scene, 200, -100, plain())).toMatchObject({ index: 1, occurrence: 0 })
  })

  it('undo the slant and the Free drag', () => {
    const slant = 45
    // A thin bar left of the advance box, leaning right by as much as it is high.
    const scene = sceneOf([[{ index: 1, polygon: square(-400, 0, -350, 300) }]], slant)
    const [sx, sy] = toScene(0, 0, slant, -375, 250)
    expect(sx).toBeCloseTo(-125, 9)
    expect(hitScene(scene, sx, sy, plain())).toMatchObject({ kind: 'glyph' })
    // Unslanted, the same glyph point lies elsewhere: there is nothing.
    expect(hitScene(scene, -375, -250, plain())).toBeNull()
    expect(hitScene(sceneOf([[{ index: 1, polygon: square(-400, 0, -350, 300) }]]), sx, sy, plain())).toBeNull()
    expect(hitScene(scene, sx + 1000, sy + 40, plain({ offsetX: 1000, offsetY: 40 }))).toMatchObject({ kind: 'glyph' })
    expect(hitScene(scene, sx, sy, plain({ offsetX: 1000, offsetY: 40 }))).toBeNull()
  })

  it('count occurrences over every glyph in reading order, spaces and missing ones included', () => {
    const scene = sceneOf([[{ index: 3 }, { index: 0, missing: true, text: 'x' }], [{ index: 3 }, { index: 5 }]])
    expect(hitScene(scene, 900, 1100, plain())).toMatchObject({ index: 5, occurrence: 3 })
  })

  it('report missing boxes, which cannot be selected', () => {
    const scene = sceneOf([[{ index: 0, missing: true, text: '\u{2603}' }]])
    expect(hitScene(scene, 300, -300, plain())).toEqual({ kind: 'missing', text: '\u{2603}' })
    expect(hitScene(scene, 10, -300, plain())).toBeNull()
  })

  it('skip a glyph without a source outline, as the SVG canvas draws none', () => {
    const scene = sceneOf([[{ index: 1 }]])
    expect(hitScene(scene, 300, -100, plain({ source: () => null }))).toBeNull()
  })
})

describe('the text block with Free position', () => {
  const scene = sceneOf([[{ index: 1 }, { index: 1 }, { index: 1 }], [{ index: 1 }]])
  const plain = (patch: Partial<HitOptions> = {}) => options({ source: () => squareSource(), ascender: 900, descender: -250, ...patch })

  it('is a handle between the glyphs, behind them', () => {
    expect(hitScene(scene, 1500, 1100, plain({ freeMove: true }))).toEqual({ kind: 'block' })
    expect(hitScene(scene, 300, 1100, plain({ freeMove: true }))).toMatchObject({ kind: 'glyph' })
    expect(hitScene(scene, 1500, 1100, plain())).toBeNull()
    expect(hitScene(scene, 2500, 1100, plain({ freeMove: true }))).toBeNull()
  })

  it('moves with the drag', () => {
    expect(hitScene(scene, 2500, 1100, plain({ freeMove: true, offsetX: 1000 }))).toEqual({ kind: 'block' })
  })
})
