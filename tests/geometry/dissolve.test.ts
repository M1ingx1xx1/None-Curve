// Experimental Dissolve (src/geometry/dissolve.ts): off, it leaves every outline as it was; on, it follows the seed
// alone, and its contours are valid for export (no crossings or touches, no zero-length edges, ink on the left of
// every edge and none on the right, so nonzero and even-odd fill alike and every hole lies in its island) and stay
// within the glyph's vertex budget. And no island, ring, hole or speck reads as a curve: edges are long next to the
// facet length, no run of gentle turns along short edges bends like an arc, and small specks have few corners.

import { describe, expect, it } from 'vitest'
import { applyDissolve } from '../../src/geometry/dissolve'
import { DISSOLVE_LIMITS, dissolveIsOn, EXPERIMENTAL_LIMITS } from '../../src/geometry/limits'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { DerivedGeometry, DissolveParams, GeometryParams, Point } from '../../src/geometry/types'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import {
  allFinite,
  contoursOf,
  outlineCrossings,
  polygonOf,
  rect,
  sameContours,
  signedArea2,
  winding,
} from '../helpers/outline'
import { ALL_DEFAULT, ALL_MAX, BASE, GEOMETRY, on, paramsWith, SLIDER_MAX, withoutEffects } from '../helpers/params'

const DISSOLVE = on('dissolve').dissolve!

/** Settings across the sliders: the defaults, each end that changes the shapes most, and the slider max of all. */
const SETTINGS: [string, Partial<DissolveParams>][] = [
  ['default', {}],
  ['facets 0%', { facets: 0 }],
  ['facets 100%', { facets: 1 }],
  ['finest grain, facets 0%', { grain: DISSOLVE_LIMITS.minGrain, facets: 0 }],
  ['coarsest grain', { grain: DISSOLVE_LIMITS.maxGrain }],
  ['amount 0%, curl 0%', { amount: 0, curl: 0 }],
  ['amount, spread, specks and curl at max', { amount: 1, spread: DISSOLVE_LIMITS.maxSpread, specks: 1, curl: 1 }],
  ['slider max', SLIDER_MAX.dissolve.dissolve!],
]

const withDissolve = (patch: Partial<DissolveParams>, seed = 1): GeometryParams =>
  paramsWith(GEOMETRY.plain, on('dissolve', patch), seed)

/** How far the ring turns at each vertex, in degrees (positive to the left), and the edge from it. */
function shape(ring: readonly Point[]) {
  const n = ring.length
  const turns = ring.map((b, k) => {
    const a = ring[(k - 1 + n) % n]
    const c = ring[(k + 1) % n]
    const ux = b.x - a.x
    const uy = b.y - a.y
    const vx = c.x - b.x
    const vy = c.y - b.y
    return (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI
  })
  const edges = ring.map((a, k) => Math.hypot(ring[(k + 1) % n].x - a.x, ring[(k + 1) % n].y - a.y))
  return { turns, edges }
}

/** What reads as a curve, or breaks export, in one dissolved glyph (empty when nothing does). */
function problems(derived: DerivedGeometry, label: string): string[] {
  const out: string[] = []
  const contours = contoursOf(derived.polygon)
  const { facet } = derived.experimental.dissolve
  if (!allFinite(contours)) out.push(`${label}: non-finite coordinate`)
  const { cross, touch, pinch } = outlineCrossings(contours)
  if (cross + touch + pinch > 0) out.push(`${label}: ${cross} crossings, ${touch} touches, ${pinch} pinches`)
  let short = 0
  let edgeCount = 0
  for (const [c, ring] of contours.entries()) {
    const { turns, edges } = shape(ring)
    const n = ring.length
    edgeCount += n
    if (n < 3) out.push(`${label}: contour ${c} has ${n} points`)
    if (derived.polygon.contours[c].clockwise !== signedArea2(ring) < 0)
      out.push(`${label}: contour ${c} has the wrong direction flag`)
    for (let k = 0; k < n; k++) {
      // No edge shorter than a tenth of a facet; one shorter than half is rare (see below).
      if (edges[k] < 0.1 * facet)
        out.push(`${label}: contour ${c} has an edge of ${edges[k].toFixed(2)} u (facet ${facet.toFixed(1)} u)`)
      if (edges[k] < 0.5 * facet) short++
      // An arc: three vertices in a row turning the same way, each by less than 40°, along edges under 1.25 facets.
      const gentle = (j: number) =>
        Math.abs(turns[j % n]) < 40 && edges[j % n] < 1.25 * facet && edges[(j - 1 + n) % n] < 1.25 * facet
      if (
        n > 3 &&
        gentle(k) &&
        gentle(k + 1) &&
        gentle(k + 2) &&
        Math.sign(turns[k]) === Math.sign(turns[(k + 1) % n]) &&
        Math.sign(turns[k]) === Math.sign(turns[(k + 2) % n])
      ) {
        out.push(
          `${label}: contour ${c} bends like an arc at ${k} (turns ${[0, 1, 2].map((j) => turns[(k + j) % n].toFixed(0)).join(', ')}°)`,
        )
      }
    }
    // A small speck is a triangle, quadrilateral, pentagon or hexagon.
    const area = signedArea2(ring) / 2
    if (area > 0 && area < 0.5 * facet * facet && n > 6) out.push(`${label}: speck ${c} has ${n} corners`)
  }
  if (short > Math.max(2, 0.003 * edgeCount))
    out.push(`${label}: ${short} of ${edgeCount} edges shorter than half a facet`)
  // Ink on the left of every edge and none on the right (a sample of edges): winding 1 and 0, never anything else.
  const eps = 1e-3
  for (const ring of contours) {
    for (let k = 0; k < ring.length; k += 5) {
      const a = ring[k]
      const b = ring[(k + 1) % ring.length]
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      const nx = (-(b.y - a.y) / length) * eps
      const ny = ((b.x - a.x) / length) * eps
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const left = winding(contours, { x: m.x + nx, y: m.y + ny })
      const right = winding(contours, { x: m.x - nx, y: m.y - ny })
      if (left !== 1 || right !== 0) {
        out.push(`${label}: winding ${left} | ${right} across an edge`)
        return out
      }
    }
  }
  return out
}

describe('dissolveIsOn', () => {
  it('is on when enabled, at any setting, and off when disabled or missing', () => {
    expect(dissolveIsOn(DISSOLVE)).toBe(true)
    expect(dissolveIsOn({ ...DISSOLVE, amount: 0, specks: 0, spread: 0 })).toBe(true)
    expect(dissolveIsOn({ ...DISSOLVE, enabled: false })).toBe(false)
    expect(dissolveIsOn(undefined)).toBe(false)
  })
})

describe('applyDissolve', () => {
  it('rebuilds a square, crossing outlines read by the nonzero rule, and leaves an empty glyph alone', () => {
    const square = polygonOf([rect(0, 0, 400, 400)])
    const result = applyDissolve(square, DISSOLVE, 1, 1000)
    expect(result.stats.applied).toBe(true)
    expect(result.stats.islands).toBeGreaterThan(0)
    expect(
      problems({ polygon: result.polygon, experimental: { dissolve: result.stats } } as DerivedGeometry, 'square'),
    ).toEqual([])
    // Two overlapping squares the same way round fill like their union: the result does not cross either.
    const overlapping = applyDissolve(polygonOf([rect(0, 0, 300, 300), rect(150, 150, 450, 450)]), DISSOLVE, 1, 1000)
    expect(outlineCrossings(contoursOf(overlapping.polygon)).cross).toBe(0)
    const empty = polygonOf([])
    expect(applyDissolve(empty, DISSOLVE, 1, 1000).polygon).toBe(empty)
    expect(applyDissolve(square, { ...DISSOLVE, enabled: false }, 1, 1000).polygon).toBe(square)
  })
})

describe.each(FIXTURE_FONTS)('Dissolve: %s', (fontName) => {
  it('leaves every outline as it was while off, also with the other effects on and in settings saved before it', async () => {
    const font = await loadFixture(fontName)
    for (const effects of [{}, ALL_DEFAULT]) {
      const off = withoutEffects(paramsWith(GEOMETRY.plain, effects))
      const others = {
        ...off,
        experimental: {
          ...off.experimental,
          ...effects,
          dissolve: { ...DISSOLVE, enabled: false, amount: 0.9, grain: 0.2 },
        },
      }
      // Older saved settings have no Dissolve at all.
      const { dissolve: _, ...older } = others.experimental
      const without = { ...others, experimental: { ...older, dissolve: undefined } } as unknown as GeometryParams
      for (const g of sampleGlyphs(font, 'agQ@')) {
        const reference = contoursOf(
          deriveGeometry(font.getGlyph(g.index), {
            ...others,
            experimental: { ...others.experimental, dissolve: { ...DISSOLVE, enabled: false } },
          }).polygon,
        )
        expect(
          sameContours(contoursOf(deriveGeometry(font.getGlyph(g.index), others).polygon), reference),
          g.char,
        ).toBe(true)
        const derived = deriveGeometry(font.getGlyph(g.index), without)
        expect(sameContours(contoursOf(derived.polygon), reference), g.char).toBe(true)
        expect(derived.experimental.dissolve.applied).toBe(false)
      }
    }
  })

  it('follows the seed: the same seed gives the same outline, another seed another', async () => {
    const font = await loadFixture(fontName)
    for (const g of sampleGlyphs(font, 'aQ8')) {
      const a = contoursOf(deriveGeometry(font.getGlyph(g.index), withDissolve({}, 1)).polygon)
      expect(
        sameContours(contoursOf(deriveGeometry(font.getGlyph(g.index), withDissolve({}, 1)).polygon), a),
        g.char,
      ).toBe(true)
      expect(
        sameContours(contoursOf(deriveGeometry(font.getGlyph(g.index), withDissolve({}, 2)).polygon), a),
        g.char,
      ).toBe(false)
    }
  })

  it('makes islands, holes and specks of straight facets, valid for export, at every setting', async () => {
    const font = await loadFixture(fontName)
    const found: string[] = []
    for (const [name, patch] of SETTINGS) {
      for (const g of sampleGlyphs(font, 'aegnoAQ@&8')) {
        const derived = deriveGeometry(font.getGlyph(g.index), withDissolve(patch))
        const { dissolve } = derived.experimental
        expect(dissolve.applied).toBe(true)
        expect(dissolve.islands).toBeGreaterThan(0)
        found.push(...problems(derived, `${name} "${g.char}"`))
      }
    }
    expect(found).toEqual([])
  })

  // Glyphs the slow audit caught: two short-edge ends merged into one point whose new edges crossed the edges beside
  // them in a bow tie.
  const BOW_TIES: Record<string, Record<'dense' | 'heavy', number[]>> = {
    Roboto: { dense: [591], heavy: [100, 167] },
    STIXTwoText: { dense: [1754, 1784], heavy: [351, 1490] },
  }

  it('stays valid on dense and heavy Geometry after all six effects, where merged short edges once crossed', async () => {
    const font = await loadFixture(fontName)
    const found: string[] = []
    for (const geometry of ['dense', 'heavy'] as const) {
      for (const index of BOW_TIES[fontName]?.[geometry] ?? []) {
        found.push(
          ...problems(
            deriveGeometry(font.getGlyph(index), paramsWith(GEOMETRY[geometry], ALL_DEFAULT)),
            `${geometry} #${index}`,
          ),
        )
      }
    }
    expect(found).toEqual([])
  })

  it('has rings and specks: holes in its islands, and islands outside the letter', async () => {
    const font = await loadFixture(fontName)
    const g = sampleGlyphs(font, 'o')[0]
    const derived = deriveGeometry(font.getGlyph(g.index), withDissolve({}))
    const plain = contoursOf(deriveGeometry(font.getGlyph(g.index), BASE).polygon)
    const contours = contoursOf(derived.polygon)
    expect(derived.experimental.dissolve.holes).toBeGreaterThan(5)
    // Specks: islands whose first point lies off the letter.
    const outside = contours.filter((ring) => signedArea2(ring) > 0 && winding(plain, ring[0]) === 0)
    expect(outside.length).toBeGreaterThan(3)
  })

  it('stays within the vertex budget: at slider max alone, and after all six effects at slider max', async () => {
    const font = await loadFixture(fontName)
    for (const effects of [SLIDER_MAX.dissolve, ALL_MAX]) {
      const params = paramsWith(GEOMETRY.plain, effects)
      for (const g of sampleGlyphs(font, 'gQ@')) {
        const before = deriveGeometry(font.getGlyph(g.index), withoutEffects(params)).vertexCount
        const derived = deriveGeometry(font.getGlyph(g.index), params)
        expect(derived.vertexCount, g.char).toBeLessThanOrEqual(before + EXPERIMENTAL_LIMITS.maxAddedVertices)
        expect(problems(derived, `"${g.char}"`)).toEqual([])
      }
    }
    // The defaults stay well within it, without coarser facets.
    for (const g of sampleGlyphs(font, 'gQ@'))
      expect(deriveGeometry(font.getGlyph(g.index), withDissolve({})).experimental.dissolve.reduced, g.char).toBe(false)
  })
})
