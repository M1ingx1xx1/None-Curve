// Thorn's Reach on the canvas (src/geometry/thorn.ts): the canvas diagonal in em, how long the thorns it gives are, the
// letter's box that layout measures instead of the thorns (PolygonGlyph.layoutBox), the letter kept by the merge
// however long and thin its thorns, and refraction that covers only the letter, so its points do not grow with Reach.

import { describe, expect, it } from 'vitest'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { applyThorn, canvasDiagonalEm, THORN_LIMITS, thornIsOn } from '../../src/geometry/thorn'
import type { GeometryParams, Point, PolygonGlyph, ThornParams } from '../../src/geometry/types'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import { boundsOf, contoursOf, winding } from '../helpers/outline'
import { BASE, GEOMETRY, on, paramsWith, SLIDER_MAX, THORN_FARTHEST } from '../helpers/params'

const THORN = on('thorn').thorn!
const FARTHEST = THORN_FARTHEST.thorn!

/** The same settings with Thorn off. */
const withoutThorn = (params: GeometryParams): GeometryParams => ({
  ...params,
  experimental: { ...params.experimental, thorn: { ...params.experimental.thorn, enabled: false } },
})

describe('canvasDiagonalEm', () => {
  it('measures the canvas diagonal in em, to 0.01 em', () => {
    expect(canvasDiagonalEm(1200, 800, 48)).toBeCloseTo(30.04, 1)
    expect(THORN_LIMITS.defaultCanvasEm).toBe(canvasDiagonalEm(1200, 800, 48))
    expect(canvasDiagonalEm(300, 400, 100)).toBe(5)
    expect(canvasDiagonalEm(1234, 567, 89)).toBe(15.26)
    expect(canvasDiagonalEm(4000, 4000, 4)).toBe(1414.21)
  })

  it('falls back to the default canvas for sizes that are not finite and positive', () => {
    for (const [width, height, size] of [
      [NaN, 800, 48],
      [1200, Infinity, 48],
      [1200, 800, 0],
      [1200, 800, -48],
      [0, 800, 48],
      [1200, -800, 48],
      [1200, 800, NaN],
    ]) {
      expect(canvasDiagonalEm(width, height, size), `${width} × ${height} at ${size}`).toBe(THORN_LIMITS.defaultCanvasEm)
    }
  })
})

describe('thornIsOn', () => {
  it('is on with some Reach, and off at none', () => {
    expect(thornIsOn(THORN)).toBe(true)
    expect(thornIsOn({ ...THORN, canvasReach: 0 })).toBe(false)
    expect(thornIsOn({ ...THORN, canvasReach: NaN })).toBe(false)
    expect(thornIsOn({ ...THORN, enabled: false })).toBe(false)
  })
})

/** The farthest any point of the outline lies outside the box. */
function farthestOutside(polygon: PolygonGlyph, box: { minX: number; minY: number; maxX: number; maxY: number }): number {
  let farthest = 0
  for (const c of polygon.contours) {
    for (const p of c.points) {
      const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX)
      const dy = Math.max(box.minY - p.y, 0, p.y - box.maxY)
      farthest = Math.max(farthest, Math.hypot(dx, dy))
    }
  }
  return farthest
}

describe.each(FIXTURE_FONTS)('Thorn on the canvas: %s', (fontName) => {
  it('makes thorns a share of the canvas diagonal long, up to the safety cap', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    const cases: [Partial<ThornParams>, number][] = [
      [{ canvasReach: 1 }, THORN_LIMITS.defaultCanvasEm],
      [{ canvasReach: 0.5, canvasEm: 100 }, 50],
      [{ canvasReach: 1, canvasEm: 1000 }, THORN_LIMITS.maxReachEm],
      [{ canvasReach: 3, canvasEm: 10 }, 10],
      [{ canvasReach: 0.25, canvasEm: -5 }, 0.25 * THORN_LIMITS.defaultCanvasEm],
    ]
    for (const glyph of sampleGlyphs(font, 'HOg')) {
      for (const [patch, em] of cases) {
        const label = `"${glyph.char}" ${JSON.stringify(patch)}`
        const params = paramsWith(GEOMETRY.plain, on('thorn', { count: 12, root: 0, refraction: 0, ...patch }))
        const derived = deriveGeometry(font.getGlyph(glyph.index), params)
        const { longest, thorns } = derived.experimental.thorn
        const budget = em * upm
        expect(thorns, label).toBeGreaterThan(0)
        expect(longest, label).toBeLessThanOrEqual(budget * (1 + 1e-12))
        expect(longest, label).toBeGreaterThanOrEqual(THORN_LIMITS.minShare * budget)
        // Each tip lands its thorn's length from an anchor of the letter (which the letter's box holds).
        const box = derived.polygon.layoutBox!
        const reach = farthestOutside(derived.polygon, box)
        expect(reach, label).toBeLessThanOrEqual(longest * (1 + 1e-9))
        expect(reach, label).toBeGreaterThan(longest - Math.hypot(box.maxX - box.minX, box.maxY - box.minY))
      }
    }
  })

  it('gives the letter its box before Thorn, carried through the merge, and none without Thorn', async () => {
    const font = await loadFixture(fontName)
    for (const [name, effects] of [
      ['Thorn at slider max, 256 em', THORN_FARTHEST],
      ['Thorn default', on('thorn')],
      ['Ripple and Thorn', { ...on('ripple'), ...on('thorn', { canvasReach: 0.5, refraction: 0.5 }) }],
    ] as const) {
      const params = paramsWith(GEOMETRY.plain, effects)
      for (const glyph of sampleGlyphs(font, 'AgQ@&W8o')) {
        const label = `${name}, "${glyph.char}"`
        const derived = deriveGeometry(font.getGlyph(glyph.index), params)
        const before = deriveGeometry(font.getGlyph(glyph.index), withoutThorn(params))
        expect(derived.experimental.folds.applied, label).toBe(true)
        expect(derived.polygon.layoutBox, label).toEqual(boundsOf(contoursOf(before.polygon)))
        expect(before.polygon.layoutBox, label).toBeUndefined()
      }
    }
    for (const glyph of sampleGlyphs(font, 'Ag')) expect(deriveGeometry(font.getGlyph(glyph.index), BASE).polygon.layoutBox).toBeUndefined()
  })

  it('refracts only the letter: its points and the budget do not grow with Reach', async () => {
    const font = await loadFixture(fontName)
    const glyphs = sampleGlyphs(font, 'AgQ@&W8o')
    const run = (effects: Parameters<typeof paramsWith>[1]) => {
      let vertices = 0
      for (const glyph of glyphs) {
        const derived = deriveGeometry(font.getGlyph(glyph.index), paramsWith(GEOMETRY.plain, effects))
        expect(derived.experimental.budget.applied, `"${glyph.char}"`).toBe(false)
        vertices += derived.vertexCount
      }
      return vertices
    }
    // Reach across the default canvas (about 30 em) and the farthest it goes (256 em).
    expect(run(THORN_FARTHEST)).toBeLessThan(1.1 * run(SLIDER_MAX.thorn))
  })

  it('keeps the letter however long and thin its thorns are', async () => {
    // At Width 0 thorns are hair-thin, and 120 em or more of them make the letter's outline narrow on average (twice its
    // area over its perimeter): the merge used to leave out the whole letter as a sliver (STIX "ilst." came out empty).
    const font = await loadFixture(fontName)
    for (const glyph of sampleGlyphs(font, 'ilst.·')) {
      const letter = contoursOf(deriveGeometry(font.getGlyph(glyph.index), BASE).polygon)
      const box = boundsOf(letter)!
      const inside: Point[] = []
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 30; j++) {
          const p = { x: box.minX + ((box.maxX - box.minX) * (i + 0.5)) / 30, y: box.minY + ((box.maxY - box.minY) * (j + 0.5)) / 30 }
          if (winding(letter, p) !== 0) inside.push(p)
        }
      }
      // The share of points inside the letter that are still ink, with thorns reaching `canvasEm`.
      const kept = (root: number, canvasEm: number) => {
        const params = paramsWith(GEOMETRY.plain, on('thorn', { count: 3, canvasReach: 1, canvasEm, root, width: 0, refraction: 0 }))
        const contours = contoursOf(deriveGeometry(font.getGlyph(glyph.index), params).polygon)
        return inside.filter((p) => winding(contours, p) !== 0).length / inside.length
      }
      for (const root of [0, 0.3]) {
        // As much of it as with thorns 2 em long (Root takes some of the letter into the root, whatever the Reach).
        const near = kept(root, 2)
        if (root === 0) expect(near, `"${glyph.char}"`).toBeGreaterThan(0.99)
        for (const canvasEm of [120, 256]) expect(kept(root, canvasEm), `"${glyph.char}" Root ${root}, ${canvasEm} em`).toBeGreaterThan(near - 0.01)
      }
    }
  })

  it('leaves the thorns beyond the glass where they are', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    let far = 0
    for (const glyph of sampleGlyphs(font, 'AgQ@&W8o')) {
      const letter = deriveGeometry(font.getGlyph(glyph.index), BASE).polygon
      const box = boundsOf(contoursOf(letter))!
      // Points well to either side of the letter: the glass covers it and a strip (at most 0.3 em) either side, and the
      // roots move it by less than 0.5 em.
      const beyond = (polygon: PolygonGlyph) =>
        polygon.contours
          .flatMap((c) => c.points)
          .filter((p: Point) => p.x < box.minX - 2 * upm || p.x > box.maxX + 2 * upm)
          .map((p) => `${p.x},${p.y}`)
          .sort()
      const plain = beyond(applyThorn(letter, { ...FARTHEST, refraction: 0 }, 1, upm).polygon)
      const glass = beyond(applyThorn(letter, FARTHEST, 1, upm).polygon)
      expect(glass, `"${glyph.char}"`).toEqual(plain)
      far += plain.length
    }
    expect(far).toBeGreaterThan(0)
  })
})

describe.each(FIXTURE_FONTS)('Thorn layout hull: %s', (fontName) => {
  it('gives the letter its convex hull before Thorn, carried through the merge, and none without Thorn', async () => {
    const font = await loadFixture(fontName)
    const turn = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    for (const [name, effects] of [
      ['Thorn at slider max, 256 em', THORN_FARTHEST],
      ['Thorn default', on('thorn')],
      ['Ripple and Thorn', { ...on('ripple'), ...on('thorn', { canvasReach: 0.5, refraction: 0.5 }) }],
    ] as const) {
      const params = paramsWith(GEOMETRY.plain, effects)
      for (const glyph of sampleGlyphs(font, 'AgQ@&W8o')) {
        const label = `${name}, "${glyph.char}"`
        const derived = deriveGeometry(font.getGlyph(glyph.index), params)
        const before = deriveGeometry(font.getGlyph(glyph.index), withoutThorn(params))
        const hull = derived.polygon.layoutHull!
        const letter = contoursOf(before.polygon).flat()
        expect(derived.experimental.folds.applied, label).toBe(true)
        expect(before.polygon.layoutHull, label).toBeUndefined()
        // Its corners are points of the letter, turning left at every one, with the whole letter inside.
        expect(boundsOf([hull]), label).toEqual(derived.polygon.layoutBox)
        const points = new Set(letter.map((p) => `${p.x},${p.y}`))
        expect(hull.every((p) => points.has(`${p.x},${p.y}`)), label).toBe(true)
        hull.forEach((p, i) => {
          const next = hull[(i + 1) % hull.length]
          expect(turn(p, next, hull[(i + 2) % hull.length]), label).toBeGreaterThan(0)
          const length = Math.hypot(next.x - p.x, next.y - p.y)
          expect(Math.min(...letter.map((q) => turn(p, next, q) / length)), label).toBeGreaterThan(-1e-6)
        })
        // So, slanted any way, it reaches exactly as far as the letter.
        for (const shear of [Math.tan((12 * Math.PI) / 180), -Math.tan((20 * Math.PI) / 180), 50]) {
          const reach = (ps: Point[]) => ps.map((p) => p.x + shear * p.y)
          expect(Math.min(...reach(hull)), label).toBe(Math.min(...reach(letter)))
          expect(Math.max(...reach(hull)), label).toBe(Math.max(...reach(letter)))
        }
      }
    }
    for (const glyph of sampleGlyphs(font, 'Ag')) expect(deriveGeometry(font.getGlyph(glyph.index), BASE).polygon.layoutHull).toBeUndefined()
  })
})
