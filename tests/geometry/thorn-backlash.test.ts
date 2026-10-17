// Thorn's Back thorn and Dent (src/geometry/thorn.ts, step 3). Off, they change nothing: settings saved before they
// existed (no keys) and both at 0 give the very same outline. On, each back thorn grows where the ray from its thorn's
// anchor into the ink leaves the stroke, pointing the other way from its thorn (with Reverse, back through the stroke and
// out past the anchor's side); each dent moves the outline beside its thorn into the stroke, never through to its other
// side. Validity of these settings (reversed, dense, at the sliders' ends), straight segments only, is checked with the
// other configurations in tests/helpers/invariants.ts.

import { describe, expect, it } from 'vitest'
import { describePipeline } from '../../src/geometry/describe'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { applyThorn, ThornAnchors } from '../../src/geometry/thorn'
import type { ExperimentalParams, GeometryParams, Point, PolygonGlyph, ThornParams } from '../../src/geometry/types'
import { targetById } from '../../src/sound/mapping'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import { contoursOf, sameContours, signedArea2, winding, type Contours } from '../helpers/outline'
import { BASE, GEOMETRY, on, paramsWith } from '../helpers/params'

const THORN = on('thorn').thorn!
/** No root, no glass and no turn: each thorn is only added on, straight along its anchor's normal. */
const PLAIN: ThornParams = { ...THORN, count: 6, canvasReach: 0.05, root: 0, spread: 0, refraction: 0 }
const GLYPHS = 'AHbgmo&'
/** Dents are checked on these too: bowls, terminals and curving strokes. */
const DENTED = 'AHbgmo&acsuS'

/** The settings with Thorn's `back` and `dent` keys taken out, as saved before they existed. */
function withoutBacklash(params: GeometryParams): GeometryParams {
  const { back: _back, dent: _dent, ...rest } = params.experimental.thorn
  return { ...params, experimental: { ...params.experimental, thorn: rest } as ExperimentalParams }
}

/** The vertices of `b` that `a` does not have (exactly). */
function added(a: Contours, b: Contours): { contour: number; p: Point }[] {
  const known = new Set(a.flatMap((c) => c.map((p) => `${p.x},${p.y}`)))
  return b.flatMap((c, contour) => c.filter((p) => !known.has(`${p.x},${p.y}`)).map((p) => ({ contour, p })))
}

/** How many edges of the contours the segment from p to q crosses (properly: touching does not count). */
function crossings(contours: Contours, p: Point, q: Point): number {
  const side = (o: Point, u: Point, v: Point) => Math.sign((u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x))
  let count = 0
  for (const ring of contours) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (side(p, q, a) * side(p, q, b) < 0 && side(a, b, p) * side(a, b, q) < 0) count++
    }
  }
  return count
}

/** The distance from `p` to the nearest edge of the contours. */
function distanceToOutline(contours: Contours, p: Point): number {
  let best = Infinity
  for (const ring of contours) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy))
    }
  }
  return best
}

describe.each(FIXTURE_FONTS)('Back thorn and Dent off: %s', (fontName) => {
  it('give the same outline as settings without the keys', async () => {
    const font = await loadFixture(fontName)
    for (const params of [
      paramsWith(GEOMETRY.plain, on('thorn', { count: 6, canvasReach: 0.3, refraction: 0.4 })),
      paramsWith(GEOMETRY.heavy, on('thorn', { reverse: true })),
    ]) {
      expect([params.experimental.thorn.back, params.experimental.thorn.dent]).toEqual([0, 0])
      for (const glyph of sampleGlyphs(font, GLYPHS)) {
        const source = font.getGlyph(glyph.index)
        const a = contoursOf(deriveGeometry(source, params).polygon)
        const b = contoursOf(deriveGeometry(source, withoutBacklash(params)).polygon)
        expect(sameContours(a, b), `"${glyph.char}"`).toBe(true)
      }
    }
  })

  it('change the outline when on, and count back thorns apart from thorns', async () => {
    const font = await loadFixture(fontName)
    for (const glyph of sampleGlyphs(font, 'Ho')) {
      const source = font.getGlyph(glyph.index)
      const plain = deriveGeometry(source, paramsWith(GEOMETRY.plain, on('thorn')))
      for (const patch of [{ back: 1 }, { dent: 1 }]) {
        const lashed = deriveGeometry(source, paramsWith(GEOMETRY.plain, on('thorn', patch)))
        expect(sameContours(contoursOf(plain.polygon), contoursOf(lashed.polygon)), `"${glyph.char}" ${JSON.stringify(patch)}`).toBe(false)
        expect(lashed.experimental.thorn.thorns).toBe(plain.experimental.thorn.thorns)
        expect(lashed.experimental.thorn.backThorns > 0).toBe('back' in patch)
      }
    }
  })
})

/** The back tips `back` adds to `plain` (same settings, Back thorn 0): the new vertices off the letter's outline (bases lie on it). */
function backTips(ink: Contours, plain: PolygonGlyph, back: PolygonGlyph, upm: number): Point[] {
  return added(contoursOf(plain), contoursOf(back))
    .map(({ p }) => p)
    .filter((p) => distanceToOutline(ink, p) > 1e-6 * upm)
}

describe.each(FIXTURE_FONTS)('Back thorns: %s', (fontName) => {
  it('grow where the stroke behind each thorn ends, the other way from it; reversed, from there back through the stroke', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    let backThorns = 0
    for (const seed of [1, 7]) {
      for (const glyph of sampleGlyphs(font, GLYPHS)) {
        const label = `seed ${seed}, "${glyph.char}"`
        const letter = deriveGeometry(font.getGlyph(glyph.index), BASE).polygon
        const ink = contoursOf(letter)
        const picks = new ThornAnchors(letter, letter, PLAIN, seed, upm).located(letter)
        const tips = [false, true].map((reverse) => {
          const plain = applyThorn(letter, { ...PLAIN, reverse }, seed, upm)
          const lashed = applyThorn(letter, { ...PLAIN, reverse, back: 1 }, seed, upm)
          expect(lashed.stats.thorns, label).toBe(plain.stats.thorns)
          expect(lashed.stats.longest, label).toBe(plain.stats.longest)
          const found = backTips(ink, plain.polygon, lashed.polygon, upm)
          expect(found.length, label).toBe(lashed.stats.backThorns)
          return found
        })
        const [out, reversed] = tips
        // Reverse measures the same strokes (its ray runs the same way, into the ink), so the same back thorns grow.
        expect(reversed.length, label).toBe(out.length)
        for (const p of out) {
          // On the line of a thorn's anchor and normal (within the snap onto a vertex), behind the anchor.
          const pick = picks.find((s) => {
            const anchor = letter.contours[s.contour].points[s.index]
            const off = (p.x - anchor.x) * s.normal.y - (p.y - anchor.y) * s.normal.x
            return Math.abs(off) < 0.006 * upm && (p.x - anchor.x) * s.normal.x + (p.y - anchor.y) * s.normal.y < 0
          })
          expect(pick, label).toBeDefined()
          // Its reversed twin starts at the same site on the far side and points the other way: the site lies halfway
          // between them, on the letter's outline, and the reversed tip lies further out along the thorn's normal.
          const twin = reversed.find((q) => distanceToOutline(ink, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) < 1e-6 * upm)
          expect(twin, label).toBeDefined()
          expect((twin!.x - p.x) * pick!.normal.x + (twin!.y - p.y) * pick!.normal.y, label).toBeGreaterThan(0)
        }
        backThorns += out.length
      }
    }
    expect(backThorns).toBeGreaterThan(20)
  })

  it('grow through the stroke, not along it, from turned thorns too: in an o, always into its counter', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    let backThorns = 0
    for (const glyph of sampleGlyphs(font, 'oO')) {
      const letter = deriveGeometry(font.getGlyph(glyph.index), BASE).polygon
      const ink = contoursOf(letter)
      expect(ink.length).toBe(2)
      // Thorns grow only from the outer contour, so each ray crosses the bowl into the counter: a ray that ran on round
      // the bowl and out of the outer contour again would put its back thorn there instead.
      const counter = Math.abs(signedArea2(ink[0])) < Math.abs(signedArea2(ink[1])) ? 0 : 1
      for (const spread of [0.5, 1]) {
        for (let seed = 1; seed <= 8; seed++) {
          const params = { ...PLAIN, count: 8, spread }
          const plain = applyThorn(letter, params, seed, upm).polygon
          const lashed = applyThorn(letter, { ...params, back: 1 }, seed, upm).polygon
          const found = added(contoursOf(plain), contoursOf(lashed)).filter(({ p }) => distanceToOutline(ink, p) > 1e-6 * upm)
          for (const { contour } of found) expect(contour, `"${glyph.char}", spread ${spread}, seed ${seed}`).toBe(counter)
          backThorns += found.length
        }
      }
    }
    expect(backThorns).toBeGreaterThan(10)
  })

  it('are as long as Back thorn says: half their thorn at 100%', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    let paired = 0
    for (const glyph of sampleGlyphs(font, 'Hbo')) {
      const letter = deriveGeometry(font.getGlyph(glyph.index), BASE).polygon
      const ink = contoursOf(letter)
      const plain = applyThorn(letter, PLAIN, 1, upm).polygon
      const tips = (back: number) => backTips(ink, plain, applyThorn(letter, { ...PLAIN, back }, 1, upm).polygon, upm)
      const half = tips(0.5)
      const full = tips(1)
      expect(full.length, `"${glyph.char}"`).toBe(half.length)
      // From the same site: at 100% twice as far from it as at 50%, so the site (2 × half - full) lies on the outline.
      for (const p of full) {
        const twin = half.find((q) => distanceToOutline(ink, { x: 2 * q.x - p.x, y: 2 * q.y - p.y }) < 1e-6 * upm)
        expect(twin, `"${glyph.char}"`).toBeDefined()
        paired++
      }
    }
    expect(paired).toBeGreaterThan(3)
  })
})

describe.each(FIXTURE_FONTS)('Dents: %s', (fontName) => {
  for (const reverse of [false, true]) {
    // Turned thorns too: a slanted ray meets a curving stroke along it rather than across, as in a bowl or a terminal.
    for (const spread of [0, 0.5, 1]) {
      it(`sink the outline beside each thorn into the stroke, never through it, at spread ${spread}${reverse ? ', reversed' : ''}`, async () => {
        const font = await loadFixture(fontName)
        const upm = font.metrics.unitsPerEm
        let moved = 0
        for (const seed of [1, 7]) {
          for (const glyph of sampleGlyphs(font, DENTED)) {
            const label = `seed ${seed}, "${glyph.char}"`
            const letter = deriveGeometry(font.getGlyph(glyph.index), BASE).polygon
            const ink = contoursOf(letter)
            const params = { ...PLAIN, spread, reverse }
            const picks = new ThornAnchors(letter, letter, params, seed, upm).located(letter)
            const a = contoursOf(applyThorn(letter, params, seed, upm).polygon)
            const b = contoursOf(applyThorn(letter, { ...params, dent: 1 }, seed, upm).polygon)
            // Dents only move vertices.
            expect(b.map((c) => c.length), label).toEqual(a.map((c) => c.length))
            a.forEach((points, contour) =>
              points.forEach((p, i) => {
                const q = b[contour][i]
                if (p.x === q.x && p.y === q.y) return
                moved++
                const move = Math.hypot(q.x - p.x, q.y - p.y)
                // Against a thorn's outward normal (into the stroke): against it, or between two where the dents of
                // neighbouring thorns meet; each at most 55% of the thickest stroke measured.
                const against = picks.map((pick) => ((q.x - p.x) * pick.normal.x + (q.y - p.y) * pick.normal.y) / move)
                expect(Math.min(...against), label).toBeLessThan(0)
                expect(move, label).toBeLessThanOrEqual(2 * 0.55 * 0.6 * upm)
                // In the letter's ink all the way (its overlapping contours count as ink): short of the stroke's other side.
                for (let k = 1; k <= 16; k++) {
                  const at = { x: p.x + ((q.x - p.x) * k) / 16, y: p.y + ((q.y - p.y) * k) / 16 }
                  expect(winding(ink, at), `${label}, vertex ${i} of contour ${contour}`).not.toBe(0)
                }
              }),
            )
            // Every edge from a moved vertex. Between two vertices of the outline it stays in the letter's ink all the way;
            // a thorn's side (to its tip, off the outline) crosses the outline as drawn without dents and tips (each
            // thorn's bases joined straight) at most once more than it did, where it now leaves the ink: never through
            // the stroke's other side into a counter or out of the letter.
            const tip = (p: Point) => distanceToOutline(ink, p) > 1e-6 * upm
            const drawn = a.map((points) => points.filter((p) => !tip(p)))
            b.forEach((points, contour) =>
              points.forEach((q, i) => {
                const j = (i + 1) % points.length
                const [p0, p1] = [a[contour][i], a[contour][j]]
                const q1 = points[j]
                const edge = `${label}, edge ${i} of contour ${contour}`
                if (p0.x === q.x && p0.y === q.y && p1.x === q1.x && p1.y === q1.y) return
                if (tip(p1) || tip(p0)) {
                  // From the base (moved) to the tip (not); the original side starts a hair off its base on the outline.
                  const [base, from, to] = tip(p1) ? [q, p0, p1] : [q1, p1, p0]
                  const start = { x: from.x + (to.x - from.x) * 1e-6, y: from.y + (to.y - from.y) * 1e-6 }
                  expect(crossings(drawn, base, to), edge).toBeLessThanOrEqual(crossings(drawn, start, to) + 1)
                  return
                }
                for (let k = 1; k < 16; k++) {
                  const at = { x: q.x + ((q1.x - q.x) * k) / 16, y: q.y + ((q1.y - q.y) * k) / 16 }
                  expect(winding(ink, at), edge).not.toBe(0)
                }
              }),
            )
          }
        }
        expect(moved).toBeGreaterThan(20)
      })
    }
  }

  it('sink deeper as Dent rises', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    const letter = deriveGeometry(font.getGlyph(sampleGlyphs(font, 'H')[0].index), BASE).polygon
    const base = contoursOf(applyThorn(letter, PLAIN, 1, upm).polygon)
    const total = (dent: number) => {
      const out = contoursOf(applyThorn(letter, { ...PLAIN, dent }, 1, upm).polygon)
      return base.reduce((sum, c, k) => sum + c.reduce((s, p, i) => s + Math.hypot(out[k][i].x - p.x, out[k][i].y - p.y), 0), 0)
    }
    expect(total(0.5)).toBeGreaterThan(0)
    expect(total(1)).toBeGreaterThan(total(0.5))
  })
})

describe.each(FIXTURE_FONTS)('Back thorns and dents together: %s', (fontName) => {
  it('are deterministic, keep every coordinate finite and are merged into valid outlines, reversed or not', async () => {
    const font = await loadFixture(fontName)
    for (const reverse of [false, true]) {
      const params = paramsWith(GEOMETRY.plain, on('thorn', { count: 8, back: 1, dent: 1, reverse }), 3)
      for (const glyph of sampleGlyphs(font, 'HOgm')) {
        const label = `reverse ${reverse}, "${glyph.char}"`
        const source = font.getGlyph(glyph.index)
        const first = deriveGeometry(source, params)
        const again = deriveGeometry(source, params)
        expect(sameContours(contoursOf(first.polygon), contoursOf(again.polygon)), label).toBe(true)
        expect(first.experimental.thorn.backThorns, label).toBe(again.experimental.thorn.backThorns)
        expect(first.experimental.folds.applied, label).toBe(true)
        expect(first.experimental.folds.failed, label).toBe(false)
        const points = first.polygon.contours.flatMap((c) => c.points)
        expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), label).toBe(true)
      }
    }
  })

  it('leave glyphs without thorns alone', () => {
    const empty: PolygonGlyph = { contours: [], metrics: { advanceWidth: 500, unitsPerEm: 1000 } } as unknown as PolygonGlyph
    const out = applyThorn(empty, { ...PLAIN, back: 1, dent: 1 }, 1, 1000)
    expect(out.stats.applied).toBe(false)
    expect(out.stats.backThorns).toBe(0)
  })
})

describe('Back thorn and Dent settings', () => {
  it('are named in the pipeline description only when on', () => {
    const steps = (patch: Partial<ThornParams>) => describePipeline(paramsWith(GEOMETRY.plain, on('thorn', patch))).join(' | ')
    expect(steps({})).not.toMatch(/back thorns|dent/)
    expect(steps({ back: 0.5 })).toMatch(/width 30%, back thorns 50%, seed/)
    expect(steps({ dent: 0.25 })).toMatch(/width 30%, dent 25%, seed/)
    expect(describePipeline(withoutBacklash(paramsWith(GEOMETRY.plain, on('thorn')))).join(' | ')).not.toMatch(/back thorns|dent/)
  })

  it('are Sound targets that read missing keys as off', () => {
    const old = withoutBacklash(paramsWith(GEOMETRY.plain, on('thorn')))
    for (const [id, label] of [
      ['experimental.thorn.back', 'Back thorn'],
      ['experimental.thorn.dent', 'Dent'],
    ]) {
      const spec = targetById(id)!
      expect(spec.label).toBe(label)
      expect([spec.min, spec.max]).toEqual([0, 1])
      expect(spec.get(old)).toBe(0)
    }
  })
})
