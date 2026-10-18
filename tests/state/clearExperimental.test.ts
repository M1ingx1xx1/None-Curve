// Reset experimental (src/state/clearExperimental.ts): every Experimental field of the default settings is cleared,
// switches to false and sliders to their lowest (0 where the range holds it) except the few kept at their starting
// value (Ripple's centre, Dissolve's Grain), the seed is kept, and the "already
// cleared" check matches. The cleared values are valid for the pipeline: each effect switched on at them, and with
// its strength then raised, gives finite outlines that do not cross themselves.

import { beforeAll, describe, expect, it } from 'vitest'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { THORN_LIMITS } from '../../src/geometry/thorn'
import type { ExperimentalParams, GeometryParams } from '../../src/geometry/types'
import type { LoadedFont } from '../../src/font/model'
import { clearedExperimental, clearedSliderValue, isClearedExperimental } from '../../src/state/clearExperimental'
import { initialState } from '../../src/state/editorState'
import { reachFromSlider, SLIDER_RANGES, THORN_REACH, type SliderId } from '../../src/state/sliderScales'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import { allFinite, contoursOf, outlineCrossings } from '../helpers/outline'
import { BASE, EFFECTS, type Effect } from '../helpers/params'

const DEFAULTS = initialState.params.experimental

/** Sliders Reset experimental leaves at their starting value: Ripple's centre (a position) and Dissolve's Grain (cost). */
const KEPT_AT_DEFAULT = new Set(['experimental.ripple.centerX', 'experimental.ripple.centerY', 'experimental.dissolve.grain'])

/** The lowest value the control for this field can give. */
function controlMinimum(id: string): number {
  if (id === 'experimental.thorn.canvasReach') return reachFromSlider(THORN_REACH.slider.min)
  return SLIDER_RANGES[id as SliderId].min
}

describe('clearedExperimental', () => {
  it('keeps the seed', () => {
    expect(clearedExperimental(42).seed).toBe(42)
    expect(clearedExperimental(0).seed).toBe(0)
  })

  it('turns every switch off and puts every slider at its lowest, or 0 where its range holds 0, or kept at its start', () => {
    const cleared = clearedExperimental(1)
    for (const effect of Object.keys(DEFAULTS).filter((k) => k !== 'seed') as Effect[]) {
      const fields = Object.entries(DEFAULTS[effect])
      expect(Object.keys(cleared[effect]).sort(), effect).toEqual(fields.map(([k]) => k).sort())
      for (const [key, value] of fields) {
        const got = (cleared[effect] as unknown as Record<string, unknown>)[key]
        const id = `experimental.${effect}.${key}`
        if (typeof value === 'boolean') {
          expect(got, id).toBe(false)
        } else if (KEPT_AT_DEFAULT.has(id)) {
          expect(got, id).toBe(value)
          expect(got, id).toBe(clearedSliderValue(id))
        } else {
          const min = controlMinimum(id)
          expect(got, id).toBe(min > 0 ? min : 0)
          expect(got, id).toBe(clearedSliderValue(id))
        }
      }
    }
  })

  it('clears to the documented values', () => {
    const { seed: _seed, ...cleared } = clearedExperimental(1)
    expect(cleared).toEqual({
      crumple: { enabled: false, amount: 0, facet: SLIDER_RANGES['experimental.crumple.facet'].min, turn: 0 },
      ripple: {
        enabled: false,
        amount: 0,
        wavelength: SLIDER_RANGES['experimental.ripple.wavelength'].min,
        sides: SLIDER_RANGES['experimental.ripple.sides'].min,
        centerX: 0.5,
        centerY: 0.5,
        fade: 0,
        petals: 0,
        reverse: false,
      },
      whorl: { enabled: false, amount: 0, rings: SLIDER_RANGES['experimental.whorl.rings'].min, sides: SLIDER_RANGES['experimental.whorl.sides'].min, pinned: false },
      slipstream: { enabled: false, direction: 0, strength: 0, gust: SLIDER_RANGES['experimental.slipstream.gust'].min, gustiness: 0, slip: 0, cuts: 0, trails: 0 },
      thorn: {
        enabled: false,
        count: THORN_LIMITS.minCount,
        canvasReach: 0,
        spread: 0,
        width: 0,
        root: 0,
        refraction: 0,
        flute: THORN_LIMITS.minFlute,
        reverse: false,
        burst: false,
        spikes: THORN_LIMITS.minSpikes,
        dent: 0,
      },
      dissolve: { enabled: false, amount: 0, grain: DEFAULTS.dissolve.grain, spread: 0, specks: 0, curl: 0, facets: 0 },
    })
  })

  it('gives a fresh object each time', () => {
    const a = clearedExperimental(1)
    a.thorn.enabled = true
    expect(clearedExperimental(1).thorn.enabled).toBe(false)
  })
})

describe('isClearedExperimental', () => {
  it('is true once cleared, with any seed or a derived canvasEm', () => {
    expect(isClearedExperimental(clearedExperimental(7))).toBe(true)
    const withEm = clearedExperimental(3)
    expect(isClearedExperimental({ ...withEm, thorn: { ...withEm.thorn, canvasEm: 30 } })).toBe(true)
  })

  it('is false for the defaults, older settings missing an effect, and any one field changed', () => {
    expect(isClearedExperimental(DEFAULTS)).toBe(false)
    const { dissolve: _dissolve, ...older } = clearedExperimental(1)
    expect(isClearedExperimental(older as ExperimentalParams)).toBe(false)
    const cleared = clearedExperimental(1)
    for (const effect of EFFECTS) {
      for (const [key, value] of Object.entries(cleared[effect])) {
        const changed = typeof value === 'boolean' ? !value : value + 1
        expect(isClearedExperimental({ ...cleared, [effect]: { ...cleared[effect], [key]: changed } }), `${effect}.${key}`).toBe(false)
      }
    }
  })
})

describe.each(FIXTURE_FONTS)('cleared values in the pipeline: %s', (fontName) => {
  const cleared = clearedExperimental(1)
  let font: LoadedFont
  let glyphs: { index: number; char: string }[]
  /** Each glyph's proper crossings and contacts with every effect off (fonts may overlap their own contours). */
  const baseline = new Map<number, { cross: number; contacts: number }>()
  beforeAll(async () => {
    font = await loadFixture(fontName)
    glyphs = sampleGlyphs(font)
    const off: GeometryParams = { ...BASE, experimental: cleared }
    for (const g of glyphs) {
      const { cross, touch, pinch } = outlineCrossings(contoursOf(deriveGeometry(font.getGlyph(g.index), off).polygon))
      baseline.set(g.index, { cross, contacts: touch + pinch })
    }
  })

  /** Each effect switched on at the cleared values, then with the slider that gives it strength raised. */
  const CASES: [string, Partial<ExperimentalParams>][] = [
    ...EFFECTS.map((effect): [string, Partial<ExperimentalParams>] => [`${effect} on`, { [effect]: { ...cleared[effect], enabled: true } }]),
    ['crumple amount', { crumple: { ...cleared.crumple, enabled: true, amount: 0.7 } }],
    ['ripple amount', { ripple: { ...cleared.ripple, enabled: true, amount: 0.5 } }],
    ['whorl amount', { whorl: { ...cleared.whorl, enabled: true, amount: 0.6 } }],
    ['slipstream strength', { slipstream: { ...cleared.slipstream, enabled: true, strength: 0.5 } }],
    ['thorn reach', { thorn: { ...cleared.thorn, enabled: true, canvasReach: 0.1 } }],
    ['thorn reach, reverse', { thorn: { ...cleared.thorn, enabled: true, canvasReach: 0.1, reverse: true } }],
    ['burst on', { thorn: { ...cleared.thorn, enabled: true, burst: true } }],
    ['burst reach', { thorn: { ...cleared.thorn, enabled: true, burst: true, canvasReach: 0.1 } }],
    ['dissolve amount', { dissolve: { ...cleared.dissolve, enabled: true, amount: 0.5 } }],
  ]

  // As the geometry invariants check: finite, no new crossings where the letter had none, none after a merge.
  it.each(CASES)('%s: valid outlines', (_name, patch) => {
    const params: GeometryParams = { ...BASE, experimental: { ...cleared, ...patch } }
    const problems: string[] = []
    for (const g of glyphs) {
      const derived = deriveGeometry(font.getGlyph(g.index), params)
      const contours = contoursOf(derived.polygon)
      const label = `"${g.char}"`
      if (contours.length === 0) problems.push(`${label}: no contours`)
      if (!allFinite(contours)) problems.push(`${label}: non-finite coordinate`)
      if (contours.some((c) => c.length < 3)) problems.push(`${label}: degenerate contour`)
      const { cross } = outlineCrossings(contours)
      const base = baseline.get(g.index)!
      const folds = derived.experimental.folds
      if (cross > 0 && base.cross === 0 && base.contacts === 0) problems.push(`${label}: ${cross} new crossings`)
      if (cross > 0 && folds.applied && !folds.failed && !folds.tooComplex) problems.push(`${label}: ${cross} crossings after a merge`)
    }
    expect(problems).toEqual([])
  })
})
