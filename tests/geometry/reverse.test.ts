// Reverse on Ripple and Thorn (src/geometry/ripple.ts, src/geometry/thorn.ts). Off, it changes nothing: settings saved
// before it existed (no key) and Reverse off give the very same outline. On, Ripple swaps out and in (its first ring
// moves in, and the petals pull the corners in and push the middle of each side out), and Thorn turns every thorn round
// into the letter: the same picks, each direction exactly negated. Validity of reversed settings, up to the sliders'
// ends, is checked with the other configurations in tests/helpers/invariants.ts.

import { describe, expect, it } from 'vitest'
import { RIPPLE_LIMITS } from '../../src/geometry/limits'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { rippleWarp, type Box } from '../../src/geometry/ripple'
import { applyThorn, ThornAnchors } from '../../src/geometry/thorn'
import type { ExperimentalParams, GeometryParams, Point, RippleParams } from '../../src/geometry/types'
import { describePipeline } from '../../src/geometry/describe'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import { boundsOf, contoursOf, sameContours } from '../helpers/outline'
import { BASE, GEOMETRY, on, paramsWith } from '../helpers/params'

const RIPPLE = on('ripple').ripple!
const THORN = on('thorn').thorn!

/** The settings with the effect's `reverse` key taken out, as saved before Reverse existed. */
function withoutReverse(params: GeometryParams, effect: 'ripple' | 'thorn'): GeometryParams {
  const { reverse: _reverse, ...rest } = params.experimental[effect]
  return { ...params, experimental: { ...params.experimental, [effect]: rest } as ExperimentalParams }
}

describe.each(FIXTURE_FONTS)('Reverse off: %s', (fontName) => {
  it('gives the same outline as settings without the key', async () => {
    const font = await loadFixture(fontName)
    const cases: [string, GeometryParams, 'ripple' | 'thorn'][] = [
      ['Ripple', paramsWith(GEOMETRY.plain, on('ripple', { petals: 1.2, fade: 0.4 })), 'ripple'],
      ['Ripple folding', paramsWith(GEOMETRY.plain, on('ripple', { amount: 2.5 })), 'ripple'],
      ['Thorn', paramsWith(GEOMETRY.plain, on('thorn', { count: 6, canvasReach: 0.3, refraction: 0.4 })), 'thorn'],
    ]
    for (const [name, params, effect] of cases) {
      expect(params.experimental[effect].reverse).toBe(false)
      for (const glyph of sampleGlyphs(font, 'AgQ@&o')) {
        const source = font.getGlyph(glyph.index)
        const a = contoursOf(deriveGeometry(source, params).polygon)
        const b = contoursOf(deriveGeometry(source, withoutReverse(params, effect)).polygon)
        expect(sameContours(a, b), `${name}, "${glyph.char}"`).toBe(true)
      }
    }
  })

  it('changes the outline when on', async () => {
    const font = await loadFixture(fontName)
    for (const [effects, reversed] of [
      [on('ripple', { petals: 1 }), on('ripple', { petals: 1, reverse: true })],
      [on('thorn'), on('thorn', { reverse: true })],
    ] as const) {
      for (const glyph of sampleGlyphs(font, 'Ao')) {
        const source = font.getGlyph(glyph.index)
        const a = contoursOf(deriveGeometry(source, paramsWith(GEOMETRY.plain, effects)).polygon)
        const b = contoursOf(deriveGeometry(source, paramsWith(GEOMETRY.plain, reversed)).polygon)
        expect(sameContours(a, b), `"${glyph.char}"`).toBe(false)
      }
    }
  })
})

describe('Ripple reversed', () => {
  const box: Box = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  const upm = 1000
  const centre = { x: 500, y: 500 }
  const spacing = (RIPPLE.wavelength * upm) / 2
  const half = Math.PI / RIPPLE.sides
  /** How far a point at `distance` from the centre, at `angle`, ends up from it. */
  const moved = (params: RippleParams, angle: number, distance: number) => {
    const p = rippleWarp(params, box, upm).map({
      x: centre.x + distance * Math.cos(angle),
      y: centre.y + distance * Math.sin(angle),
    })
    return Math.hypot(p.x - centre.x, p.y - centre.y)
  }

  it('moves the first ring in where it moved out, by as much', () => {
    // Straight down: the middle of the bottom side, where ring 1 lies one spacing from the centre.
    const down = -Math.PI / 2
    const out = moved(RIPPLE, down, spacing)
    const back = moved({ ...RIPPLE, reverse: true }, down, spacing)
    expect(out).toBeGreaterThan(spacing)
    expect(back).toBeLessThan(spacing)
    expect(out - spacing).toBeCloseTo(spacing - back, 6)
    // Ring 2 the other way round.
    expect(moved({ ...RIPPLE, reverse: true }, down, 2 * spacing)).toBeGreaterThan(2 * spacing)
  })

  it('turns the petals: corners pulled in, the middle of each side pushed out, every ray kept on its side', () => {
    for (const petals of [0.5, 1, RIPPLE_LIMITS.maxPetals]) {
      const depth = petals * RIPPLE_LIMITS.maxPetal
      const params = { ...RIPPLE, amount: 0, petals }
      for (const k of [0, 3]) {
        // A corner ray (between wedges) and the middle of a side (a wedge's middle), a little way along each.
        const corner = -Math.PI / 2 + half + 2 * k * half + 1e-9
        const middle = -Math.PI / 2 + 2 * k * half
        for (const distance of [0.6 * spacing, 2.3 * spacing]) {
          const label = `petals ${petals}, wedge ${k}, ${distance}`
          expect(moved(params, corner, distance) / distance, label).toBeCloseTo(1 + depth, 5)
          expect(moved(params, middle, distance) / distance, label).toBeCloseTo(
            1 - Math.min(depth, RIPPLE_LIMITS.maxPetal),
            5,
          )
          const cornerBack = moved({ ...params, reverse: true }, corner, distance) / distance
          const middleBack = moved({ ...params, reverse: true }, middle, distance) / distance
          expect(cornerBack, label).toBeLessThan(1)
          expect(cornerBack, label).toBeCloseTo(1 - Math.min(depth, RIPPLE_LIMITS.maxPetal), 5)
          expect(cornerBack, label).toBeGreaterThanOrEqual(1 - RIPPLE_LIMITS.maxPetal - 1e-9)
          expect(middleBack, label).toBeGreaterThan(1)
          expect(middleBack, label).toBeCloseTo(1 + depth, 5)
        }
      }
    }
  })
})

describe.each(FIXTURE_FONTS)('Thorn reversed: %s', (fontName) => {
  it('picks the same anchors and grows each thorn exactly the other way, into the letter', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    let thorns = 0
    for (const seed of [1, 7]) {
      for (const glyph of sampleGlyphs(font, 'AHgo&')) {
        const label = `seed ${seed}, "${glyph.char}"`
        const letter = deriveGeometry(font.getGlyph(glyph.index), BASE).polygon
        // No root and no glass: the thorns are only added on, so the two outlines differ only at the tips.
        const params = { ...THORN, count: 6, canvasReach: 0.05, root: 0, refraction: 0 }
        const reversed = { ...params, reverse: true }
        const picks = new ThornAnchors(letter, letter, params, seed, upm).located(letter)
        expect(new ThornAnchors(letter, letter, reversed, seed, upm).located(letter), label).toEqual(picks)
        const out = applyThorn(letter, params, seed, upm)
        const back = applyThorn(letter, reversed, seed, upm)
        expect(back.stats.thorns, label).toBe(out.stats.thorns)
        expect(back.stats.thorns, label).toBe(picks.length)
        const a = contoursOf(out.polygon)
        const b = contoursOf(back.polygon)
        expect(
          b.map((c) => c.length),
          label,
        ).toEqual(a.map((c) => c.length))
        const tips: { contour: number; out: Point; back: Point }[] = []
        a.forEach((points, contour) =>
          points.forEach((p, i) => {
            const q = b[contour][i]
            if (p.x !== q.x || p.y !== q.y) tips.push({ contour, out: p, back: q })
          }),
        )
        expect(tips.length, label).toBe(picks.length)
        for (const tip of tips) {
          // The anchor lies halfway between the two tips, and the reversed one points against the outward normal.
          const anchor = { x: (tip.out.x + tip.back.x) / 2, y: (tip.out.y + tip.back.y) / 2 }
          const pick = picks.find((s) => {
            const p = letter.contours[s.contour].points[s.index]
            return s.contour === tip.contour && Math.hypot(p.x - anchor.x, p.y - anchor.y) < 1e-6 * upm
          })
          expect(pick, label).toBeDefined()
          const along = (p: Point) => (p.x - anchor.x) * pick!.normal.x + (p.y - anchor.y) * pick!.normal.y
          expect(along(tip.out), label).toBeGreaterThan(0)
          expect(along(tip.back), label).toBeLessThan(0)
          thorns++
        }
      }
    }
    expect(thorns).toBeGreaterThan(20)
  })

  it('runs its thorns through the letter and out past the far side, kept as ink by the merge', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    for (const glyph of sampleGlyphs(font, 'HOg')) {
      const params = paramsWith(GEOMETRY.plain, on('thorn', { canvasReach: 0.4, reverse: true }))
      const derived = deriveGeometry(font.getGlyph(glyph.index), params)
      expect(derived.experimental.folds.applied, `"${glyph.char}"`).toBe(true)
      expect(derived.experimental.folds.failed, `"${glyph.char}"`).toBe(false)
      const letter = boundsOf(contoursOf(deriveGeometry(font.getGlyph(glyph.index), BASE).polygon))!
      const drawn = boundsOf(contoursOf(derived.polygon))!
      // Each thorn goes at least 35% of 40% of about 30 em (4 em): far beyond the letter on its other side.
      const beyond = Math.max(
        letter.minX - drawn.minX,
        drawn.maxX - letter.maxX,
        letter.minY - drawn.minY,
        drawn.maxY - letter.maxY,
      )
      expect(beyond, `"${glyph.char}"`).toBeGreaterThan(upm)
      // The letter's own box is the one layout measures, as for thorns out of it.
      expect(derived.polygon.layoutBox, `"${glyph.char}"`).toBeDefined()
    }
  })
})

describe('describePipeline', () => {
  it('says "reversed" for Ripple and Thorn only when Reverse is on', () => {
    const steps = (effects: Parameters<typeof paramsWith>[1]) =>
      describePipeline(paramsWith(GEOMETRY.plain, effects)).join(' | ')
    expect(steps({ ...on('ripple'), ...on('thorn') })).not.toContain('reversed')
    expect(steps({ ...on('ripple', { reverse: true }) })).toMatch(/^.*ripple [^|]*, reversed/)
    expect(steps({ ...on('thorn', { reverse: true }) })).toMatch(/thorn ×3, reversed, reach/)
    const old = paramsWith(GEOMETRY.plain, { ...on('ripple'), ...on('thorn') })
    expect(describePipeline(withoutReverse(withoutReverse(old, 'ripple'), 'thorn')).join(' | ')).not.toContain(
      'reversed',
    )
  })
})
