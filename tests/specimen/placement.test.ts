// Which scene places the text block while Sound drives the letters (src/specimen/artboard.ts, placementScene, as
// useGeometry uses it): the sliders' own letters once they are all computed, so live frames never move the block;
// while they are being computed, the sliders' letters last set in full for the same shaped text; with neither, the
// live scene (as before). Without Sound, the scene shown, exactly as before.

import { describe, expect, it } from 'vitest'
import type { PolygonContour, PolygonGlyph } from '../../src/geometry/types'
import {
  DEFAULT_ARTBOARD,
  DEFAULT_TYPOGRAPHY,
  layoutArtboard,
  placementScene,
  TEXT_ANCHORS,
  type TextPosition,
  type TypographyParams,
} from '../../src/specimen/artboard'
import { placePolygons, type PolygonLookup, type ShapedSpecimen, type SpecimenScene } from '../../src/specimen/scene'

const UPM = 1000

const rect = (minX: number, minY: number, maxX: number, maxY: number): PolygonContour => ({
  points: [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ],
  clockwise: false,
})

const polygon = (...contours: PolygonContour[]): PolygonGlyph => ({
  ref: { index: 0, name: '', unicode: null },
  metrics: {
    unitsPerEm: UPM,
    advanceWidth: 700,
    leftSideBearing: 50,
    rightSideBearing: 50,
    ascender: 800,
    descender: -200,
  },
  contours,
})

/** "HI" on two lines: glyph 1 (advance 700) and glyph 2 (advance 300). */
function shaped(slant = 0): ShapedSpecimen {
  return {
    lines: [0, 1].map((l) => ({
      glyphs: [
        { index: 1, text: 'H', x: 0, y: l * 1000, advance: 700, missing: false },
        { index: 2, text: 'I', x: 700, y: l * 1000, advance: 300, missing: false },
      ],
      width: 1000,
      baseline: l * 1000,
    })),
    indices: [1, 2],
    lineHeight: 1000,
    ascender: 800,
    descender: -200,
    capHeight: 700,
    blockWidth: 1000,
    slant,
    missingCharacters: [],
    glyphCount: 4,
    truncated: false,
    kerning: false,
  }
}

/** The sliders' letters. */
const H = polygon(rect(50, 0, 650, 700))
const I = polygon(rect(50, 0, 250, 700))
/** Live frames: the letters warped by different amounts, seeds and levels (bigger, smaller, shifted, torn). */
const LIVE: [PolygonGlyph, PolygonGlyph][] = [
  [polygon(rect(-40, -60, 760, 790)), I],
  [polygon(rect(120, 30, 600, 650)), polygon(rect(20, -90, 300, 820))],
  [polygon(rect(50, 0, 650, 700), rect(640, 300, 1400, 360)), polygon(rect(-300, 0, 250, 700))],
  [H, polygon(rect(50, 0, 250, 700), rect(100, -400, 200, 0))],
]

const scene = (s: ShapedSpecimen, [h, i]: [PolygonGlyph, PolygonGlyph]) =>
  placePolygons(s, (index) => ({ polygon: index === 1 ? h : i }))
/** The sliders' letters with glyph 2 missing, stale (an earlier shape standing in), or failed. */
const partial = (s: ShapedSpecimen, two: ReturnType<PolygonLookup>) =>
  placePolygons(s, (index) => (index === 1 ? { polygon: H } : two))

const typography = (patch: Partial<TypographyParams> = {}): TypographyParams => ({ ...DEFAULT_TYPOGRAPHY, ...patch })
const POSITIONS: TextPosition[] = [...TEXT_ANCHORS, 'free']
const place = (placed: SpecimenScene, t: TypographyParams) => layoutArtboard(placed, t, DEFAULT_ARTBOARD, UPM)

describe('placementScene', () => {
  it('places the block by the scene shown without Sound, as before', () => {
    const s = shaped()
    const shown = scene(s, [H, I])
    const other = scene(s, LIVE[0])
    expect(placementScene(shown, false, s, other, { shaped: s, scene: other })).toBe(shown)
    expect(placementScene(shown, false, s, null, null)).toBe(shown)
  })

  it("places the block by the sliders' letters while Sound drives them, so live frames never move it", () => {
    for (const slant of [0, 14, -20]) {
      const s = shaped(slant)
      const slider = scene(s, [H, I])
      for (const position of POSITIONS) {
        for (const size of [48, 187, 400]) {
          const t = typography({ position, size, freeX: 0.3, freeY: 0.7 })
          // Without Sound, the sliders' letters are the scene shown: Sound starting or stopping moves nothing either.
          const still = place(slider, t)
          let moved = 0
          for (const frame of LIVE) {
            const live = scene(s, frame)
            const placed = placementScene(live, true, s, slider, null)
            expect(placed, `${slant}°, ${position} at ${size}`).toBe(slider)
            expect(place(placed, t)).toEqual(still)
            const own = place(live, t)
            if (own.x !== still.x || own.y !== still.y) moved++
          }
          // Placed by their own outlines, the live frames would have moved the block.
          expect(moved, `${slant}°, ${position} at ${size}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('counts a glyph that failed for the sliders as computed', () => {
    const s = shaped()
    const slider = partial(s, { error: 'too slow' })
    expect(slider.failedGlyphs).toBe(2)
    expect(placementScene(scene(s, LIVE[1]), true, s, slider, null)).toBe(slider)
  })

  it("keeps the sliders' letters last set for the same shaped text while new ones are computed", () => {
    const s = shaped()
    const last = { shaped: s, scene: scene(s, [H, I]) }
    const live = scene(s, LIVE[2])
    // Missing, or an earlier shape standing in: pending either way.
    for (const two of [null, { polygon: I, stale: true }]) {
      const pending = partial(s, two)
      expect(pending.pendingGlyphs).toBeGreaterThan(0)
      expect(placementScene(live, true, s, pending, last)).toBe(last.scene)
    }
    expect(placementScene(live, true, s, null, last)).toBe(last.scene)
  })

  it("falls back to the live scene with no sliders' letters for this shaped text", () => {
    const s = shaped()
    const live = scene(s, LIVE[3])
    const pending = partial(s, null)
    // Set for another text (or the same text set with other typography): its lines differ, so it does not stand in.
    const elsewhere = shaped(10)
    const last = { shaped: elsewhere, scene: scene(elsewhere, [H, I]) }
    expect(placementScene(live, true, s, pending, last)).toBe(live)
    expect(placementScene(live, true, s, pending, null)).toBe(live)
    expect(placementScene(live, true, s, null, null)).toBe(live)
  })
})
