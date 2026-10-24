// Placing the text on the artboard when Thorn reaches across the canvas (src/specimen/scene.ts, artboard.ts): the
// text is placed, fitted, dragged and warned about by its letters (SpecimenScene.body), never by its thorns, and
// without a layout box (Thorn off) everything measures the ink exactly as before. Slanted, the letters are measured
// by their convex hull (PolygonGlyph.layoutHull), so switching Thorn on moves nothing.

import { describe, expect, it } from 'vitest'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { GeometryParams, Point, PolygonContour, PolygonGlyph } from '../../src/geometry/types'
import {
  DEFAULT_ARTBOARD,
  DEFAULT_TYPOGRAPHY,
  fitTextSize,
  freeFromLayout,
  layoutArtboard,
  moveFreeText,
  TEXT_ANCHORS,
  textBox,
  TYPOGRAPHY_LIMITS,
  textOverflows,
  type TextPosition,
  type TypographyParams,
} from '../../src/specimen/artboard'
import {
  placePolygons,
  PLAIN_LAYOUT,
  shapeSpecimen,
  type ShapedSpecimen,
  type SpecimenScene,
} from '../../src/specimen/scene'
import { loadFixture } from '../helpers/fonts'
import { BASE, on, paramsWith } from '../helpers/params'

const UPM = 1000
const ASCENDER = 800
const DESCENDER = -200
const BODY = { minX: 50, minY: 0, maxX: 650, maxY: 700 }

const rect = (minX: number, minY: number, maxX: number, maxY: number): PolygonContour => ({
  points: [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ],
  clockwise: false,
})

/** A thin spike from the letter's right side to (x, y). */
const spike = (x: number, y: number): PolygonContour => ({
  points: [
    { x: 600, y: 300 },
    { x: 600, y: 400 },
    { x, y },
  ],
  clockwise: false,
})

function polygon(
  contours: PolygonContour[],
  layoutBox: PolygonGlyph['layoutBox'] | null = null,
  layoutHull: Point[] | null = null,
): PolygonGlyph {
  return {
    ref: { index: 0, name: '', unicode: null },
    metrics: {
      unitsPerEm: UPM,
      advanceWidth: 700,
      leftSideBearing: 50,
      rightSideBearing: 50,
      ascender: ASCENDER,
      descender: DESCENDER,
    },
    contours,
    ...(layoutBox ? { layoutBox } : {}),
    ...(layoutHull ? { layoutHull } : {}),
  }
}

/** "HI" on one line: glyph 1 (advance 700) and glyph 2 (advance 300), or a second line below. */
function shaped(slant = 0, lines = 1): ShapedSpecimen {
  return {
    lines: Array.from({ length: lines }, (_, l) => ({
      glyphs: [
        { index: 1, text: 'H', x: 0, y: l * 1000, advance: 700, missing: false },
        { index: 2, text: 'I', x: 700, y: l * 1000, advance: 300, missing: false },
      ],
      width: 1000,
      baseline: l * 1000,
    })),
    indices: [1, 2],
    lineHeight: 1000,
    ascender: ASCENDER,
    descender: DESCENDER,
    capHeight: 700,
    blockWidth: 1000,
    slant,
    missingCharacters: [],
    glyphCount: 2 * lines,
    truncated: false,
    kerning: false,
  }
}

const H = polygon([rect(BODY.minX, BODY.minY, BODY.maxX, BODY.maxY)])
const I = polygon([rect(50, 0, 250, 700)])

/** H with thorns: one far to the right, one far up and to the left, each `reach` font units long. With a layout
    box (the letter before the thorns) as Thorn sets it, or with null, none (as if another effect had grown them). */
const thorned = (reach: number, layoutBox: PolygonGlyph['layoutBox'] | null = BODY) =>
  polygon(
    [rect(BODY.minX, BODY.minY, BODY.maxX, BODY.maxY), spike(600 + reach, 350), spike(600 - reach, 350 + reach)],
    layoutBox,
  )

function scene(h: PolygonGlyph, options: { slant?: number; lines?: number } = {}): SpecimenScene {
  return placePolygons(shaped(options.slant, options.lines), (index) => ({ polygon: index === 1 ? h : I }))
}

const typography = (patch: Partial<TypographyParams> = {}): TypographyParams => ({ ...DEFAULT_TYPOGRAPHY, ...patch })
const POSITIONS: TextPosition[] = [...TEXT_ANCHORS, 'free']
/** The default canvas diagonal in font units at `size` pixels per em: how far a thorn at full Reach goes. */
const diagonal = (size: number) => (Math.hypot(DEFAULT_ARTBOARD.width, DEFAULT_ARTBOARD.height) / size) * UPM

describe('scene body', () => {
  it('equals the ink exactly when no glyph has a layout box', () => {
    for (const slant of [0, 12, -20]) {
      const plain = scene(H, { slant })
      expect(plain.body).toEqual(plain.ink)
      // A polygon that reaches past its advance without a layout box still counts in full (other effects).
      const wide = scene(thorned(5000, null), { slant })
      expect(wide.body).toEqual(wide.ink)
      expect(wide.ink!.maxX).toBeGreaterThan(5000)
    }
  })

  it('leaves the thorns out, and keeps them in the ink', () => {
    const plain = scene(H)
    const spiky = scene(thorned(30_000))
    expect(spiky.body).toEqual(plain.body)
    expect(spiky.ink!.maxX).toBeGreaterThan(30_000)
    expect(spiky.ink!.minX).toBeLessThan(-29_000)
    expect(spiky.ink!.minY).toBeLessThan(-30_000)
  })

  it('slants the layout box like the outlines, so the slanted letter stays inside it', () => {
    for (const slant of [15, -25]) {
      const plain = scene(H, { slant })
      const spiky = scene(thorned(30_000), { slant })
      const body = spiky.body!
      const ink = plain.ink!
      expect(body.minX).toBeLessThanOrEqual(ink.minX)
      expect(body.maxX).toBeGreaterThanOrEqual(ink.maxX)
      expect(body.minY).toBeLessThanOrEqual(ink.minY)
      expect(body.maxY).toBeGreaterThanOrEqual(ink.maxY)
      expect(body.maxX - body.minX).toBeLessThan(2 * UPM)
    }
  })

  it('slants the letter by its layout hull, exactly, where the corners of its box reach too far', () => {
    // An A-like triangle, apex at the top centre: slanted, its box's corners reach past it on the side it leans to.
    const corners = [
      { x: BODY.minX, y: BODY.minY },
      { x: BODY.maxX, y: BODY.minY },
      { x: (BODY.minX + BODY.maxX) / 2, y: BODY.maxY },
    ]
    const letter: PolygonContour = { points: corners, clockwise: false }
    const outline = [letter, spike(30_000, 350), spike(-30_000, 30_000)]
    // The glyph's body on its own (the other glyph not computed yet).
    const body = (h: PolygonGlyph, slant = 0) =>
      placePolygons(shaped(slant), (index) => (index === 1 ? { polygon: h } : null)).body!
    const plain = polygon([letter])
    const spiky = polygon(outline, BODY, corners)
    const noHull = polygon(outline, BODY)
    for (const slant of [12, -20]) {
      expect(body(spiky, slant)).toEqual(body(plain, slant))
      // Without a hull, or with one that cannot be measured, the box's slanted corners stand in: wider than the letter.
      const box = body(noHull, slant)
      expect(box.maxX - box.minX).toBeGreaterThan(body(plain, slant).maxX - body(plain, slant).minX + 100)
      expect(body(polygon(outline, BODY, [{ x: NaN, y: 0 }]), slant)).toEqual(box)
    }
    // Unslanted, the box is exact, so the hull changes nothing.
    expect(body(spiky)).toEqual(body(noHull))
    expect(body(spiky)).toEqual(body(plain))
  })

  it('ignores a layout box it cannot measure', () => {
    const broken = scene(thorned(30_000, { minX: NaN, minY: 0, maxX: 650, maxY: 700 }))
    expect(broken.body).toEqual(broken.ink)
  })

  it('gives each glyph and line its drawn extent, thorns included, for culling', () => {
    const spiky = scene(thorned(30_000), { lines: 2 })
    const [first, second] = spiky.lines
    expect(first.glyphs[0].ink!.maxX).toBeGreaterThan(30_000)
    expect(first.glyphs[1].ink).toEqual({ minX: 750, minY: -700, maxX: 950, maxY: 0 })
    expect(second.glyphs[0].ink!.minY).toBeLessThan(1000 - 30_000)
    expect(second.ink).toEqual({
      minX: Math.min(second.glyphs[0].ink!.minX, second.glyphs[1].ink!.minX),
      minY: Math.min(second.glyphs[0].ink!.minY, second.glyphs[1].ink!.minY),
      maxX: Math.max(second.glyphs[0].ink!.maxX, second.glyphs[1].ink!.maxX),
      maxY: Math.max(second.glyphs[0].ink!.maxY, second.glyphs[1].ink!.maxY),
    })
    // Glyphs not computed yet are not drawn, so they have no ink.
    const pending = placePolygons(shaped(), (index) => (index === 1 ? { polygon: H } : null))
    expect(pending.lines[0].glyphs[1].ink).toBeNull()
    expect(pending.lines[0].ink).toEqual(pending.lines[0].glyphs[0].ink)
  })
})

describe('artboard placement', () => {
  it('places the block by its letters whatever the thorns, at every anchor and in Free', () => {
    const plain = scene(H)
    for (const size of [24, 48, 200]) {
      const spiky = scene(thorned(diagonal(size)))
      for (const position of POSITIONS) {
        const t = typography({ size, position, freeX: 0.3, freeY: 0.8 })
        expect(layoutArtboard(spiky, t, DEFAULT_ARTBOARD, UPM)).toEqual(layoutArtboard(plain, t, DEFAULT_ARTBOARD, UPM))
      }
    }
  })

  it('places the block by the ink without a layout box, as before', () => {
    const wide = scene(thorned(5000, null))
    const layout = layoutArtboard(wide, typography({ position: 'left' }), DEFAULT_ARTBOARD, UPM)
    expect(layout.x).toBe(wide.ink!.minX - 25 * layout.unitsPerPx)
    expect(textBox(wide)).toEqual({
      minX: wide.ink!.minX,
      minY: wide.ink!.minY,
      width: wide.ink!.maxX - wide.ink!.minX,
      height: wide.ink!.maxY - wide.ink!.minY,
    })
  })

  it('falls back to the lines when nothing is drawn', () => {
    const empty = placePolygons(shaped(), () => null)
    expect(empty.ink).toBeNull()
    expect(empty.body).toBeNull()
    expect(textBox(empty)).toEqual({ minX: 0, minY: -ASCENDER, width: 1000, height: ASCENDER - DESCENDER })
  })

  it('keeps Free text draggable when the thorns are larger than the canvas', () => {
    const plain = scene(H)
    const spiky = scene(thorned(diagonal(48)))
    const t = typography({ position: 'left' })
    const layout = layoutArtboard(spiky, t, DEFAULT_ARTBOARD, UPM)
    const free = freeFromLayout(spiky, layout)
    expect(free).toEqual(freeFromLayout(plain, layoutArtboard(plain, t, DEFAULT_ARTBOARD, UPM)))
    expect(free.freeX).toBeGreaterThan(0)
    expect(free.freeX).toBeLessThan(0.05)
    const moved = moveFreeText(free, 100 * layout.unitsPerPx, -50 * layout.unitsPerPx, spiky, layout)
    expect(moved.freeX).toBeGreaterThan(0)
    expect(moved.freeY).toBeLessThan(free.freeY)
  })
})

describe('Fit text', () => {
  it('returns the size the letters alone fit at, and keeps it on a second click', () => {
    const plain = scene(H, { lines: 3 })
    const start = 48
    const fitted = fitTextSize(plain, typography({ size: start }), DEFAULT_ARTBOARD, UPM)
    // The thorns' length in font units follows the canvas diagonal at the current size (Reach is canvas-relative),
    // so each click recomputes them; the letters, and so the size, stay.
    const atStart = scene(thorned(diagonal(start)), { lines: 3 })
    expect(fitTextSize(atStart, typography({ size: start }), DEFAULT_ARTBOARD, UPM)).toBe(fitted)
    const atFitted = scene(thorned(diagonal(fitted)), { lines: 3 })
    expect(fitTextSize(atFitted, typography({ size: fitted }), DEFAULT_ARTBOARD, UPM)).toBe(fitted)
    expect(fitted).toBeGreaterThan(TYPOGRAPHY_LIMITS.minSize)
  })

  it('still counts the whole ink without a layout box', () => {
    const wide = scene(thorned(5000, null))
    const { minX, minY, maxX, maxY } = wide.ink!
    const size = fitTextSize(wide, typography(), DEFAULT_ARTBOARD, UPM)
    expect(size).toBe(
      Math.floor(
        Math.min(
          ((DEFAULT_ARTBOARD.width - 50) * UPM) / (maxX - minX),
          ((DEFAULT_ARTBOARD.height - 50) * UPM) / (maxY - minY),
        ),
      ),
    )
  })
})

describe('overflow warning', () => {
  it('ignores thorns past the canvas edge', () => {
    const spiky = scene(thorned(diagonal(48)))
    const layout = layoutArtboard(spiky, typography(), DEFAULT_ARTBOARD, UPM)
    expect(spiky.ink!.maxX).toBeGreaterThan(layout.x + layout.width)
    expect(textOverflows(spiky, layout)).toBe(false)
  })

  it('warns when the letters themselves run past the edge', () => {
    const small = { ...DEFAULT_ARTBOARD, width: 600, height: 400 }
    const spiky = scene(thorned(diagonal(1000)))
    expect(textOverflows(spiky, layoutArtboard(spiky, typography({ size: 1000 }), small, UPM))).toBe(true)
    expect(textOverflows(spiky, layoutArtboard(spiky, typography({ size: 200 }), small, UPM))).toBe(false)
  })

  it('measures the ink without a layout box, as before', () => {
    const plain = scene(H)
    const t = typography({ position: 'top-left' })
    const layout = layoutArtboard(plain, t, DEFAULT_ARTBOARD, UPM)
    expect(textOverflows(plain, layout)).toBe(false)
    // The same placement with a glyph that reaches 30 em to the right, and no layout box: past the edge.
    const wide = scene(polygon([rect(BODY.minX, BODY.minY, BODY.maxX, BODY.maxY), spike(30_000, 350)]))
    expect(textOverflows(wide, layout)).toBe(true)
    expect(
      textOverflows(
        placePolygons(shaped(), () => null),
        layout,
      ),
    ).toBe(false)
  })
})

describe('Thorn on a real font, slanted', () => {
  it('places, fits and warns about the text exactly as with Thorn off', async () => {
    const font = await loadFixture('Roboto')
    const upm = font.metrics.unitsPerEm
    // Apexes and rounds at the ends (A, V, O), where a box's slanted corners reach past the letters.
    const sceneOf = (slant: number, params: GeometryParams) => {
      const shaped = shapeSpecimen(font, 'OVA', { ...PLAIN_LAYOUT, slant })
      const polygons = new Map(shaped.indices.map((i) => [i, deriveGeometry(font.getGlyph(i), params).polygon]))
      return placePolygons(shaped, (i) => ({ polygon: polygons.get(i)! }))
    }
    // Thorns too short to see, so only the measuring changes.
    const thorn = paramsWith({}, on('thorn', { canvasReach: 0.001 }))
    for (const slant of [12, -20, 0]) {
      const plain = sceneOf(slant, BASE)
      const spiky = sceneOf(slant, thorn)
      expect(spiky.ink, `${slant}°`).not.toEqual(plain.ink)
      expect(spiky.body, `${slant}°`).toEqual(plain.body)
      for (const size of [48, 200]) {
        for (const position of POSITIONS) {
          const t = typography({ size, position, freeX: 0.3, freeY: 0.8 })
          expect(layoutArtboard(spiky, t, DEFAULT_ARTBOARD, upm), `${slant}°, ${position} at ${size}`).toEqual(
            layoutArtboard(plain, t, DEFAULT_ARTBOARD, upm),
          )
        }
      }
      const fitted = fitTextSize(plain, typography(), DEFAULT_ARTBOARD, upm)
      expect(fitTextSize(spiky, typography(), DEFAULT_ARTBOARD, upm), `${slant}°`).toBe(fitted)
      // Fitted with Thorn off and left in Free: switching Thorn on raises no warning.
      const t = typography({ size: fitted, position: 'free', freeX: 0.5, freeY: 0.5 })
      expect(textOverflows(spiky, layoutArtboard(spiky, t, DEFAULT_ARTBOARD, upm)), `${slant}°`).toBe(false)
    }
  })
})
