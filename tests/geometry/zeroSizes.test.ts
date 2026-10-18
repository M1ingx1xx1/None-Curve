// The Experimental sliders that run down to 0 (Reset experimental clears them there): Crumple's Facet size, Ripple's
// Wavelength, Slipstream's Gust size, Thorn's Anchors, Burst's Anchors and Flute width. At 0 each leaves its part out
// exactly, the same outline as without it; below its old minimum (the finest lattice, rings, bands or strips) the size
// stays there and its part fades out in proportion; the pipeline stays valid all the way down.

import { beforeAll, describe, expect, it } from 'vitest'
import { CRUMPLE_LIMITS, crumpleFolds, crumpleIsOn } from '../../src/geometry/crumple'
import { describePipeline } from '../../src/geometry/describe'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { RIPPLE_LIMITS, rippleFolds, rippleIsOn } from '../../src/geometry/ripple'
import { SLIPSTREAM_LIMITS, slipstreamFolds, slipstreamIsOn } from '../../src/geometry/slipstream'
import { THORN_LIMITS, thornIsOn } from '../../src/geometry/thorn'
import type { GeometryParams } from '../../src/geometry/types'
import type { LoadedFont } from '../../src/font/model'
import { SLIDER_RANGES } from '../../src/state/sliderScales'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import { allFinite, contoursOf, outlineCrossings, sameContours } from '../helpers/outline'
import { BASE, GEOMETRY, on, paramsWith } from '../helpers/params'

const TEXT = 'aBg8&'

describe('sliders that reach 0', () => {
  it('start at 0, and the old minimums are the finest sizes', () => {
    for (const id of [
      'experimental.crumple.facet',
      'experimental.ripple.wavelength',
      'experimental.slipstream.gust',
      'experimental.thorn.count',
      'experimental.thorn.flute',
      'experimental.thorn.spikes',
    ] as const) {
      expect(SLIDER_RANGES[id].min, id).toBe(0)
    }
    expect([CRUMPLE_LIMITS.finestFacet, RIPPLE_LIMITS.shortestWavelength, SLIPSTREAM_LIMITS.smallestGust, THORN_LIMITS.finestFlute]).toEqual([0.08, 0.08, 0.06, 0.04])
    // No "nothing" at 0 for these: they keep their minimum.
    expect(SLIDER_RANGES['experimental.ripple.sides'].min).toBe(3)
    expect(SLIDER_RANGES['experimental.whorl.rings'].min).toBe(2)
    expect(SLIDER_RANGES['experimental.whorl.sides'].min).toBe(3)
    expect(SLIDER_RANGES['experimental.dissolve.grain'].min).toBe(0.15)
  })

  it('turn their part off at 0', () => {
    const crumple = on('crumple', { amount: 3, facet: 0 }).crumple!
    expect([crumpleIsOn(crumple), crumpleFolds(crumple)]).toEqual([false, false])
    const ripple = on('ripple', { amount: 3, wavelength: 0, petals: 0 }).ripple!
    expect([rippleIsOn(ripple), rippleFolds(ripple)]).toEqual([false, false])
    // Petals still shapes the letter without waves, and never folds.
    const petals = { ...ripple, petals: 1 }
    expect([rippleIsOn(petals), rippleFolds(petals)]).toEqual([true, false])
    // Only Slip: nothing slips without gusts.
    expect(slipstreamIsOn(on('slipstream', { strength: 0, slip: 0.5, gust: 0, cuts: 0, trails: 0 }).slipstream!)).toBe(false)
    // A steady stream never blows backwards, whatever Gustiness says.
    const steady = on('slipstream', { strength: 1, gustiness: 2, gust: 0 }).slipstream!
    expect([slipstreamIsOn(steady), slipstreamFolds(steady)]).toEqual([true, false])
    expect(thornIsOn(on('thorn', { count: 0 }).thorn)).toBe(false)
    expect(thornIsOn(on('thorn', { count: 0, burst: true, spikes: 1 }).thorn)).toBe(true)
    expect(thornIsOn(on('thorn', { count: 3, burst: true, spikes: 0 }).thorn)).toBe(false)
    expect(thornIsOn(on('thorn', { count: 1 }).thorn)).toBe(true)
    // The status line leaves out the parts that do nothing.
    const status = (patch: Parameters<typeof paramsWith>[1]) => describePipeline(paramsWith({}, patch)).join(' | ')
    expect(status(on('crumple', { facet: 0 }))).not.toContain('crumple')
    expect(status(on('thorn', { count: 0 }))).not.toContain('thorn')
    expect(status(on('thorn', { refraction: 1, flute: 0 }))).not.toContain('refraction')
    expect(status(on('thorn', { refraction: 1, flute: 0.04 }))).toContain('refraction 100% (flutes 4% em)')
  })
})

describe.each(FIXTURE_FONTS)('sizes at and below the old minimums: %s', (fontName) => {
  let font: LoadedFont
  let glyphs: { index: number; char: string }[]
  beforeAll(async () => {
    font = await loadFixture(fontName)
    glyphs = sampleGlyphs(font, TEXT)
  })

  const outline = (index: number, params: GeometryParams) => contoursOf(deriveGeometry(font.getGlyph(index), params).polygon)
  const plain = paramsWith(GEOMETRY.plain, {})

  /** Settings whose outline must be exactly the one without the part (or without the effect). */
  const NO_OPS: [string, GeometryParams, GeometryParams][] = [
    ['Crumple, Facet size 0', paramsWith({}, on('crumple', { amount: 3, facet: 0 })), plain],
    ['Ripple, Wavelength 0', paramsWith({}, on('ripple', { amount: 3, wavelength: 0, fade: 0.5 })), plain],
    ['Ripple, Wavelength 0 with Petals', paramsWith({}, on('ripple', { amount: 3, wavelength: 0, petals: 1 })), paramsWith({}, on('ripple', { amount: 0, wavelength: 0.08, petals: 1 }))],
    ['Slipstream, Gust size 0, only Slip', paramsWith({}, on('slipstream', { strength: 0, slip: 0.6, gust: 0, cuts: 0, trails: 0 })), plain],
    [
      'Slipstream, Gust size 0',
      paramsWith({}, on('slipstream', { strength: 0.8, gustiness: 2, slip: 0.6, gust: 0, cuts: 2, trails: 2 })),
      paramsWith({}, on('slipstream', { strength: 0.8, gustiness: 0, slip: 0, gust: 0.06, cuts: 2, trails: 2 })),
    ],
    ['Thorn, Anchors 0', paramsWith({}, on('thorn', { count: 0, refraction: 1, canvasReach: 0.2 })), plain],
    ['Burst, Anchors 0', paramsWith({}, on('thorn', { count: 3, burst: true, spikes: 0, refraction: 1, canvasReach: 0.2 })), plain],
    ['Thorn, Flute width 0', paramsWith({}, on('thorn', { refraction: 1, flute: 0 })), paramsWith({}, on('thorn', { refraction: 0, flute: 0.1 }))],
    ['Burst, Flute width 0', paramsWith({}, on('thorn', { burst: true, refraction: 1, flute: 0 })), paramsWith({}, on('thorn', { burst: true, refraction: 0, flute: 0.1 }))],
  ]

  it.each(NO_OPS)('%s: exactly the outline without it', (_name, params, without) => {
    for (const g of glyphs) expect(sameContours(outline(g.index, params), outline(g.index, without)), `"${g.char}"`).toBe(true)
  })

  /** Halfway below the old minimum: the finest size, its part at half strength (each half is exact in binary). */
  const HALVES: [string, GeometryParams, GeometryParams][] = [
    ['Crumple, Facet size 4%', paramsWith({}, on('crumple', { amount: 0.7, facet: 0.04 })), paramsWith({}, on('crumple', { amount: 0.35, facet: 0.08 }))],
    ['Ripple, Wavelength 4%', paramsWith({}, on('ripple', { amount: 0.5, wavelength: 0.04 })), paramsWith({}, on('ripple', { amount: 0.25, wavelength: 0.08 }))],
    [
      'Slipstream, Gust size 3%',
      paramsWith({}, on('slipstream', { strength: 0.5, gustiness: 1, slip: 0.5, gust: 0.03 })),
      paramsWith({}, on('slipstream', { strength: 0.5, gustiness: 0.5, slip: 0.25, gust: 0.06 })),
    ],
    ['Thorn, Flute width 2%', paramsWith({}, on('thorn', { refraction: 1, flute: 0.02 })), paramsWith({}, on('thorn', { refraction: 0.5, flute: 0.04 }))],
  ]

  it.each(HALVES)('%s: the finest size at half strength', (_name, params, same) => {
    for (const g of glyphs) expect(sameContours(outline(g.index, params), outline(g.index, same)), `"${g.char}"`).toBe(true)
  })

  /** Every new low value on its own and all at once, at full strength: finite, closed, merged where they cross. */
  const LOW: [string, GeometryParams][] = [
    ...[0.01, 0.05].map((v): [string, GeometryParams] => [
      `every size at ${v}`,
      paramsWith(GEOMETRY.plain, {
        ...on('crumple', { amount: 5, facet: v }),
        ...on('ripple', { amount: 4, wavelength: v, petals: 3 }),
        ...on('slipstream', { strength: 8, gustiness: 2, slip: 0.6, gust: v, cuts: 8, trails: 8 }),
        ...on('thorn', { count: 1, refraction: 1, flute: v }),
      }),
    ]),
    ['one burst spike, fine flutes', paramsWith(GEOMETRY.plain, on('thorn', { burst: true, spikes: 1, refraction: 1, flute: 0.01, canvasReach: 0.3 }))],
    ['two burst spikes', paramsWith(GEOMETRY.plain, on('thorn', { burst: true, spikes: 2 }))],
    ['every effect on at 0', { ...BASE, experimental: { ...BASE.experimental, ...on('crumple', { facet: 0 }), ...on('ripple', { wavelength: 0 }), ...on('slipstream', { gust: 0 }), ...on('thorn', { count: 0, flute: 0 }), ...on('whorl'), ...on('dissolve') } }],
  ]

  it.each(LOW)('%s: valid outlines', (_name, params) => {
    const problems: string[] = []
    for (const g of glyphs) {
      const derived = deriveGeometry(font.getGlyph(g.index), params)
      const contours = contoursOf(derived.polygon)
      const label = `"${g.char}"`
      if (contours.length === 0) problems.push(`${label}: no contours`)
      if (!allFinite(contours)) problems.push(`${label}: non-finite coordinate`)
      if (contours.some((c) => c.length < 3)) problems.push(`${label}: degenerate contour`)
      const folds = derived.experimental.folds
      const { cross } = outlineCrossings(contours)
      if (cross > 0 && folds.applied && !folds.failed && !folds.tooComplex) problems.push(`${label}: ${cross} crossings after a merge`)
    }
    expect(problems).toEqual([])
  })
})
