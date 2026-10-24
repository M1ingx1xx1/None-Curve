// Thorn's Burst (src/geometry/thorn.ts): off, it changes nothing (settings saved before it existed give the very same
// outline); on, it grows Anchors (4–80) spikes per letter round every contour, those on a counter pointing into it and
// staying inside, every edge straight and no run of short edges reading as a curve; it is seeded, keeps within the
// glyph's vertex budget, and Reverse turns it round. Validity of the merged outlines, up to the sliders' ends, is checked
// with the other configurations in tests/helpers/invariants.ts.

import { describe, expect, it } from 'vitest'
import { GlyphBudget } from '../../src/geometry/budget'
import { describePipeline } from '../../src/geometry/describe'
import { BURST_REACH, THORN_LIMITS } from '../../src/geometry/limits'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { applyThorn, thornBursts } from '../../src/geometry/thorn'
import type { ExperimentalParams, GeometryParams, Point, ThornParams } from '../../src/geometry/types'
import { curveLikeRuns, WARP_LIMITS } from '../../src/geometry/warp'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import { contoursOf, outlineCrossings, polygonOf, rect, sameContours, vertexCount, winding } from '../helpers/outline'
import { GEOMETRY, on, paramsWith } from '../helpers/params'

const THORN = on('thorn').thorn!
const BURST: ThornParams = { ...THORN, burst: true }

/** The settings with Thorn's Burst keys taken out, as saved before Burst existed. */
function withoutBurst(params: GeometryParams): GeometryParams {
  const { burst: _burst, spikes: _spikes, dent: _dent, ...rest } = params.experimental.thorn
  return { ...params, experimental: { ...params.experimental, thorn: rest } as ExperimentalParams }
}

const burst = (patch: Partial<ThornParams> = {}, seed = 1) => paramsWith(GEOMETRY.plain, on('thorn', { burst: true, ...patch }), seed)

/** The distance from `p` to the nearest edge of `contours`. */
function distanceToEdges(contours: Point[][], p: Point): number {
  let best = Infinity
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i]
      const b = c[(i + 1) % c.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l = dx * dx + dy * dy
      const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0
      best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y))
    }
  }
  return best
}

/** The vertices of `plain` that are neither ink in `contours` nor within `near` of their outline. */
const lostVertices = (plain: Point[][], contours: Point[][], near: number) =>
  plain.flat().filter((p) => winding(contours, p) === 0 && distanceToEdges(contours, p) > near)

/** How many vertices sit in runs that read as curves (see curveLikeRuns), over every contour. */
const curvedVertices = (contours: Point[][], unitsPerEm: number) =>
  contours.reduce((n, c) => n + curveLikeRuns(c, WARP_LIMITS.shortEdge * unitsPerEm).reduce((m, run) => m + run.length, 0), 0)

describe.each(FIXTURE_FONTS)('Burst off: %s', (fontName) => {
  it('gives the same outline as settings without its keys, whatever Anchors and Dent hold for it', async () => {
    const font = await loadFixture(fontName)
    const cases: [string, GeometryParams][] = [
      ['Thorn', paramsWith(GEOMETRY.plain, on('thorn', { count: 6, canvasReach: 0.3, refraction: 0.4 }))],
      ['Thorn reversed', paramsWith(GEOMETRY.plain, on('thorn', { reverse: true }))],
    ]
    for (const [name, params] of cases) {
      expect(params.experimental.thorn.burst).toBe(false)
      const other = { ...params, experimental: { ...params.experimental, thorn: { ...params.experimental.thorn, spikes: 80, dent: 0.1 } } }
      for (const glyph of sampleGlyphs(font, 'AgQ@&o')) {
        const source = font.getGlyph(glyph.index)
        const a = contoursOf(deriveGeometry(source, params).polygon)
        expect(sameContours(a, contoursOf(deriveGeometry(source, withoutBurst(params)).polygon)), `${name}, "${glyph.char}"`).toBe(true)
        expect(sameContours(a, contoursOf(deriveGeometry(source, other).polygon)), `${name}, "${glyph.char}", other Burst sliders`).toBe(true)
      }
    }
  })
})

describe.each(FIXTURE_FONTS)('Burst on: %s', (fontName) => {
  it('grows Anchors spikes per letter, up to 80, and changes the outline', async () => {
    const font = await loadFixture(fontName)
    for (const glyph of sampleGlyphs(font, 'aHo8')) {
      const source = font.getGlyph(glyph.index)
      const plain = contoursOf(deriveGeometry(source, paramsWith(GEOMETRY.plain, on('thorn'))).polygon)
      for (const spikes of [1, 4, 10, 40, THORN_LIMITS.maxSpikes]) {
        const derived = deriveGeometry(source, burst({ spikes }))
        const stats = derived.experimental.thorn
        expect(stats.thorns, `"${glyph.char}" × ${spikes}`).toBe(spikes)
        expect(stats.roots).toBe(0)
        expect(stats.longest).toBeGreaterThan(0)
        expect(stats.longest).toBeLessThanOrEqual(THORN.canvasReach * THORN_LIMITS.defaultCanvasEm * derived.polygon.metrics.unitsPerEm * BURST_REACH + 1e-6)
        expect(sameContours(contoursOf(derived.polygon), plain)).toBe(false)
      }
      // Beyond the slider, clamped to it.
      expect(deriveGeometry(source, burst({ spikes: 500 })).experimental.thorn.thorns).toBe(THORN_LIMITS.maxSpikes)
    }
  })

  it('is deterministic, and a new seed moves the spikes', async () => {
    const font = await loadFixture(fontName)
    for (const glyph of sampleGlyphs(font, 'aR')) {
      const source = font.getGlyph(glyph.index)
      const a = contoursOf(deriveGeometry(source, burst({ spikes: 40 })).polygon)
      expect(sameContours(a, contoursOf(deriveGeometry(source, burst({ spikes: 40 })).polygon))).toBe(true)
      expect(sameContours(a, contoursOf(deriveGeometry(source, burst({ spikes: 40 }, 2)).polygon))).toBe(false)
    }
  })

  it('draws straight edges only, with no run of short edges that reads as a curve where the letter had none', async () => {
    const font = await loadFixture(fontName)
    for (const glyph of sampleGlyphs(font, 'aeosgRB&')) {
      const source = font.getGlyph(glyph.index)
      // As the font comes, and with an anchor every 5 units: there every vertex the dents sink sits on a short edge.
      for (const geometry of [GEOMETRY.plain, GEOMETRY.dense]) {
        const base = deriveGeometry(source, paramsWith(geometry, {})).polygon
        const upm = base.metrics.unitsPerEm
        const plain = curvedVertices(contoursOf(base), upm)
        for (const patch of [{ spikes: 4, dent: 1 }, { spikes: 8 }, { spikes: 20 }, { spikes: 80 }, { spikes: 80, dent: 1, width: 0 }, { spikes: 40, reverse: true }, { spikes: 10, dent: 0 }]) {
          const contours = contoursOf(deriveGeometry(source, paramsWith(geometry, on('thorn', { burst: true, ...patch }))).polygon)
          expect(curvedVertices(contours, upm), `"${glyph.char}" ${JSON.stringify(patch)}`).toBeLessThanOrEqual(plain)
        }
      }
    }
  })

  it('keeps the letter between the spikes: at Dent 0 and 1% no arm, crossbar or corner is cut off', async () => {
    const font = await loadFixture(fontName)
    for (const glyph of sampleGlyphs(font, 'HEMW&a')) {
      const source = font.getGlyph(glyph.index)
      const base = deriveGeometry(source, paramsWith(GEOMETRY.plain, {})).polygon
      // A base may cut a corner by at most BURST.leastBase (0.02 em) and the dent sinks 1% of 60% of a stroke.
      const near = 0.025 * base.metrics.unitsPerEm
      for (const patch of [{ spikes: 4 }, { spikes: 8 }, { spikes: 4, canvasReach: 0.3 }, { spikes: 40 }]) {
        for (const dent of [0, 0.01]) {
          const contours = contoursOf(deriveGeometry(source, burst({ ...patch, dent })).polygon)
          expect(lostVertices(contoursOf(base), contours, near), `"${glyph.char}" ${JSON.stringify(patch)}, dent ${dent}`).toEqual([])
        }
      }
    }
  })

  it('merges into a valid outline, Reverse included', async () => {
    const font = await loadFixture(fontName)
    for (const glyph of sampleGlyphs(font, 'aB@')) {
      const source = font.getGlyph(glyph.index)
      for (const patch of [{ spikes: 80 }, { spikes: 80, reverse: true }, { spikes: 40, reverse: true, canvasReach: 1 }]) {
        const derived = deriveGeometry(source, burst(patch))
        expect(derived.experimental.folds.applied, `"${glyph.char}" ${JSON.stringify(patch)}`).toBe(true)
        expect(outlineCrossings(contoursOf(derived.polygon)).cross, `"${glyph.char}" ${JSON.stringify(patch)}`).toBe(0)
      }
      const out = contoursOf(deriveGeometry(source, burst({ spikes: 40 })).polygon)
      expect(sameContours(out, contoursOf(deriveGeometry(source, burst({ spikes: 40, reverse: true })).polygon))).toBe(false)
    }
  })
})

describe('Burst on a ring', () => {
  // A square with a square counter: 4000 units round the outside, 2400 round the counter.
  const outer = rect(0, 0, 1000, 1000)
  const inner = rect(200, 200, 800, 800).reverse()
  const ring = polygonOf([outer, inner])
  const hole = (p: Point) => Math.min(p.x - 200, 800 - p.x, p.y - 200, 800 - p.y)

  it('shares the spikes out by length, and those on the counter point into it and stay inside', () => {
    for (const reverse of [false, true]) {
      const { polygon, stats } = applyThorn(ring, { ...BURST, spikes: 40, reverse }, 1, 1000)
      expect(stats.thorns).toBe(40)
      const [out, counter] = contoursOf(polygon)
      // 40 × 2400 / 6400 = 15 spikes on the counter, each a tip and two shoulders off the outline.
      const deep = counter.filter((p) => hole(p) > 1)
      if (!reverse) {
        expect(deep.length).toBeGreaterThanOrEqual(15)
        // Inside the counter: never more than 42% of the way across it (600 units), so never out of its far side.
        for (const p of deep) expect(hole(p)).toBeLessThanOrEqual(0.42 * 600 + 1e-6)
        // And the dents sink into the ring only, never through it.
        for (const p of counter) expect(Math.min(p.x, 1000 - p.x, p.y, 1000 - p.y)).toBeGreaterThan(0)
        // The outside's spikes all point out of the letter.
        for (const p of out) expect(hole(p)).toBeLessThan(0)
        expect(out.filter((p) => Math.min(p.x, 1000 - p.x, p.y, 1000 - p.y) < -1).length).toBeGreaterThanOrEqual(25)
      } else {
        // Reversed: the counter's spikes go into the ring, the outside's into the letter.
        expect(out.filter((p) => Math.min(p.x, 1000 - p.x, p.y, 1000 - p.y) > 1).length).toBeGreaterThanOrEqual(25)
        expect(counter.filter((p) => hole(p) < -1).length).toBeGreaterThanOrEqual(15)
      }
    }
  })

  it('keeps the outline where a spike has no room to grow, and every corner of a long gap', () => {
    // A staircase of 20 corners; spikes so short that some are left out (no longer than a step off the outline).
    const stairs: Point[] = [{ x: 0, y: 0 }, { x: 1000, y: 0 }]
    for (let k = 0; k < 10; k++) stairs.push({ x: 1000 - 100 * k, y: 100 * (k + 1) }, { x: 900 - 100 * k, y: 100 * (k + 1) })
    const glyph = polygonOf([stairs])
    for (const spikes of [4, 80]) {
      const { polygon, stats } = applyThorn(glyph, { ...BURST, spikes, canvasReach: 0.0004, dent: 0.01 }, 1, 1000)
      if (spikes === 80) {
        expect(stats.thorns).toBeGreaterThan(0)
        expect(stats.thorns).toBeLessThan(spikes)
      }
      // Each corner stays, sunk at most 1% of 60% of the stroke (or under a base a few units wide).
      const out = contoursOf(polygon).flat()
      for (const p of stairs) expect(Math.min(...out.map((q) => Math.hypot(q.x - p.x, q.y - p.y))), `${spikes}: ${p.x},${p.y}`).toBeLessThan(10)
    }
  })

  it('keeps the glyph within its vertex budget, simplified as the budget does', () => {
    const plain = applyThorn(ring, { ...BURST, spikes: 80 }, 1, 1000).polygon
    const all = vertexCount(contoursOf(plain))
    const budget = new GlyphBudget(120, 30_000, 1000)
    const { polygon } = applyThorn(ring, { ...BURST, spikes: 80 }, 1, 1000, undefined, false, budget)
    expect(all).toBeGreaterThan(120)
    expect(vertexCount(contoursOf(polygon))).toBeLessThanOrEqual(120)
    expect(budget.stats.applied).toBe(true)
    expect(budget.stats.before).toBe(all)
    // The same again: the simplification depends only on the glyph and the settings.
    const again = applyThorn(ring, { ...BURST, spikes: 80 }, 1, 1000, undefined, false, new GlyphBudget(120, 30_000, 1000)).polygon
    expect(sameContours(contoursOf(polygon), contoursOf(again))).toBe(true)
  })

  it('leaves the anchors Thorn picks alone: Anchors above its slider is clamped there with Burst off', () => {
    const at12 = applyThorn(ring, { ...THORN, count: 12 }, 1, 1000)
    const at80 = applyThorn(ring, { ...THORN, count: 80 }, 1, 1000)
    expect(at80.stats.thorns).toBe(at12.stats.thorns)
    expect(sameContours(contoursOf(at80.polygon), contoursOf(at12.polygon))).toBe(true)
  })
})

describe('thornBursts and describePipeline', () => {
  it('are on only with Thorn and Burst on', () => {
    expect(thornBursts(BURST)).toBe(true)
    expect(thornBursts(THORN)).toBe(false)
    expect(thornBursts({ ...BURST, enabled: false })).toBe(false)
    expect(thornBursts({ ...BURST, canvasReach: 0 })).toBe(false)
  })

  it('say "thorn burst" with its spikes and Dent, and no root', () => {
    const steps = describePipeline(burst({ spikes: 64, dent: 0.3, canvasEm: 30 })).join(' | ')
    expect(steps).toMatch(/thorn burst ×64, reach 10% canvas \(longest about 0\.90 em\), dent 30%, spread 50%, width 30%, seed 1/)
    expect(steps).not.toContain('root')
    expect(describePipeline(burst({ reverse: true })).join(' | ')).toMatch(/thorn burst ×40, reversed, reach/)
    expect(describePipeline(paramsWith(GEOMETRY.plain, on('thorn'))).join(' | ')).toMatch(/thorn ×3, reach/)
  })
})
