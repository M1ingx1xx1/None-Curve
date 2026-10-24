// Thorn's anchors (ThornAnchors, src/geometry/thorn.ts): picked on the letter before Distortion and followed through the
// warps after it, so the small moves earlier steps make (a step of Distortion, Crumple or Ripple, a new Distortion seed)
// keep nearly every thorn on its place and pointing the same way, while a new Experimental seed picks again. The settings
// are those Sound drove when the thorns jumped about: tolerance 4.2, Distortion 46 at frequency 8, Crumple 0.7 with
// facets 0.18, Ripple 0.5 with wavelength 0.3 and 8 sides, three thorns 0.6 em long at most.

import { describe, expect, it } from 'vitest'
import type { LoadedFont } from '../../src/font/model'
import { crumpleWarp } from '../../src/geometry/crumple'
import { experimentalFolds, THORN_LIMITS } from '../../src/geometry/limits'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { inkBox, rippleWarp, type Box } from '../../src/geometry/ripple'
import { ThornAnchors, type ThornSite } from '../../src/geometry/thorn'
import type { ExperimentalParams, GeometryParams, Point } from '../../src/geometry/types'
import { applyWarp, type CreaseMarks, type Warp } from '../../src/geometry/warp'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import { BASE, on, paramsWith, withoutEffects } from '../helpers/params'

const CANVAS_EM = 7.71
const TEXT = 'HelloThisisMing'

const STACK = paramsWith(
  { flatten: { ...BASE.flatten, tolerance: 4.2 }, distortion: { ...BASE.distortion, amount: 46, frequency: 8, normalBias: 0.7, seed: 1 } },
  {
    ...on('crumple', { amount: 0.7, facet: 0.18 }),
    ...on('ripple', { amount: 0.5, wavelength: 0.3, sides: 8 }),
    ...on('thorn', { count: 3, canvasReach: 0.6 / CANVAS_EM, canvasEm: CANVAS_EM, spread: 0.5, width: 0.3, root: 0.5 }),
  },
)

type Step = (params: GeometryParams) => GeometryParams
const distortion = (patch: Partial<GeometryParams['distortion']>): Step => (p) => ({ ...p, distortion: { ...p.distortion, ...patch } })
const effect =
  <E extends 'crumple' | 'ripple' | 'thorn'>(name: E, patch: Partial<ExperimentalParams[E]>): Step =>
  (p) => ({ ...p, experimental: { ...p.experimental, [name]: { ...p.experimental[name], ...patch } } })
const seed = (value: number): Step => (p) => ({ ...p, experimental: { ...p.experimental, seed: value } })

/** A thorn as Thorn grows it: its pick, the vertex it grows from, and the outline's direction there. */
interface Grown extends ThornSite {
  root: Point
  tangent: Point
}

/** The glyph's outline before Distortion (Thorn's reference) and after it, as the pipeline gives them to Experimental. */
function outlines(font: LoadedFont, index: number, params: GeometryParams) {
  const plain = withoutEffects(params)
  const derived = deriveGeometry(font.getGlyph(index), plain)
  const reference = deriveGeometry(font.getGlyph(index), { ...plain, distortion: { ...plain.distortion, amount: 0 } }).polygon
  return { reference, distorted: derived.polygon, maxShift: derived.distortion.maxShift }
}

/**
 * The thorns on the glyph: picked on its reference outline and followed through Crumple and Ripple as applyExperimental
 * does (the window's ends through each warp placed by its ink box with Distortion's move of each side taken back).
 */
function thornsOf(font: LoadedFont, index: number, params: GeometryParams, warps = true): Grown[] {
  const upm = font.metrics.unitsPerEm
  const x = params.experimental
  const { reference, distorted } = outlines(font, index, params)
  const anchors = new ThornAnchors(reference, distorted, x.thorn, x.seed, upm)
  const folds = experimentalFolds(x)
  const [a, b] = [inkBox(reference)!, inkBox(distorted)!]
  const undistorted = (box: Box): Box => ({
    minX: box.minX - (b.minX - a.minX),
    minY: box.minY - (b.minY - a.minY),
    maxX: box.maxX - (b.maxX - a.maxX),
    maxY: box.maxY - (b.maxY - a.maxY),
  })
  let polygon = distorted
  let marks: CreaseMarks | undefined
  const warp = (make: (scale: number, box: Box) => Warp) => {
    const box = inkBox(polygon)!
    const warped = applyWarp(polygon, (scale) => make(scale, box), upm, marks, folds)
    anchors.warped(polygon, marks, warped.polygon, warped.marks, make(1, box), make(1, undistorted(box)))
    ;({ polygon, marks } = warped)
  }
  if (warps) {
    warp((scale) => crumpleWarp(x.crumple, x.seed, upm, scale))
    warp((scale, box) => rippleWarp(x.ripple, box, upm, scale))
  }
  return anchors.located(polygon).map((site) => {
    const points = polygon.contours[site.contour].points
    const n = points.length
    const prev = points[(site.index - 1 + n) % n]
    const next = points[(site.index + 1) % n]
    const along = Math.hypot(next.x - prev.x, next.y - prev.y) || 1
    return { ...site, root: points[site.index], tangent: { x: (next.x - prev.x) / along, y: (next.y - prev.y) / along } }
  })
}

/**
 * How many of `before`'s thorns `after` keeps: rooted within 0.05 em along the outline (and 0.1 em in all) of where they
 * were, and pointing within 10° of the way they did (each thorn of `after` keeps at most one).
 */
function kept(before: Grown[], after: Grown[], em: number): number {
  const pairs: { i: number; j: number; distance: number }[] = []
  before.forEach((a, i) => {
    after.forEach((b, j) => {
      const dx = b.root.x - a.root.x
      const dy = b.root.y - a.root.y
      const slide = Math.abs(dx * b.tangent.x + dy * b.tangent.y)
      const distance = Math.hypot(dx, dy)
      const cos = a.normal.x * b.normal.x + a.normal.y * b.normal.y
      if (slide <= 0.05 * em && distance <= 0.1 * em && cos >= Math.cos((10 * Math.PI) / 180)) pairs.push({ i, j, distance })
    })
  })
  pairs.sort((p, q) => p.distance - q.distance)
  const used = [new Set<number>(), new Set<number>()]
  for (const { i, j } of pairs) {
    if (used[0].has(i) || used[1].has(j)) continue
    used[0].add(i)
    used[1].add(j)
  }
  return used[0].size
}

/** A pick as it is chosen, without where the outline took it. */
const pickOf = ({ contour, index, normal, turn, share, lean }: ThornSite) => ({ contour, index, normal, turn, share, lean })

describe.each(FIXTURE_FONTS)('Thorn anchors: %s', (fontName) => {
  it('picks the same anchors and directions whatever Distortion does', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    let thorns = 0
    for (const glyph of sampleGlyphs(font, TEXT)) {
      const still = thornsOf(font, glyph.index, distortion({ amount: 0 })(STACK), false).map(pickOf)
      thorns += still.length
      for (const step of [distortion({ amount: 45 }), distortion({ amount: 47 }), ...[1, 2, 3, 7].map((s) => distortion({ seed: s }))]) {
        const params = step(STACK)
        const label = `"${glyph.char}" ${JSON.stringify(params.distortion)}`
        expect(thornsOf(font, glyph.index, params, false).map(pickOf), label).toEqual(still)
      }
      // With few anchors, Distortion puts in some edge midpoints: the thorns grow from the same anchors, wherever it took them.
      for (const s of [1, 2, 3]) {
        const params = distortion({ seed: s, sparse: true })(STACK)
        const { reference, maxShift } = outlines(font, glyph.index, params)
        const sparse = thornsOf(font, glyph.index, params, false)
        const label = `"${glyph.char}" sparse, seed ${s}`
        expect(sparse.map(({ normal, turn, share, lean }) => ({ normal, turn, share, lean })), label).toEqual(
          still.map(({ normal, turn, share, lean }) => ({ normal, turn, share, lean })),
        )
        sparse.forEach((thorn, t) => {
          const anchor = reference.contours[still[t].contour].points[still[t].index]
          expect(Math.hypot(thorn.root.x - anchor.x, thorn.root.y - anchor.y), label).toBeLessThanOrEqual(maxShift + 1e-9 * upm)
        })
      }
    }
    expect(thorns).toBeGreaterThan(0)
  })

  it('keeps nearly every thorn through a step of Distortion, Crumple or Ripple, and picks again with a new seed', async () => {
    const font = await loadFixture(fontName)
    const em = font.metrics.unitsPerEm
    const glyphs = sampleGlyphs(font, TEXT)
    const before = glyphs.map((glyph) => thornsOf(font, glyph.index, STACK))
    const total = before.reduce((n, thorns) => n + thorns.length, 0)
    expect(total).toBeGreaterThan(2 * glyphs.length)
    const share = (step: Step) => {
      let count = 0
      const lost: string[] = []
      glyphs.forEach((glyph, g) => {
        const k = kept(before[g], thornsOf(font, glyph.index, step(STACK)), em)
        count += k
        if (before[g].length > 0 && k === 0) lost.push(glyph.char)
      })
      return { share: count / total, lost }
    }
    for (const [name, step] of [
      ['Distortion 46 -> 47', distortion({ amount: 47 })],
      ['Distortion 46 -> 45', distortion({ amount: 45 })],
      ['Distortion seed 1 -> 2', distortion({ seed: 2 })],
      ['Distortion seed 1 -> 7', distortion({ seed: 7 })],
      ['Crumple 0.7 -> 0.8', effect('crumple', { amount: 0.8 })],
      ['Crumple 0.7 -> 0.6', effect('crumple', { amount: 0.6 })],
      ['Ripple 0.5 -> 0.6', effect('ripple', { amount: 0.6 })],
      ['Ripple 0.5 -> 0.4', effect('ripple', { amount: 0.4 })],
    ] as const) {
      const { share: keeps, lost } = share(step)
      expect(keeps, name).toBeGreaterThanOrEqual(0.9)
      // No letter has all its thorns picked again.
      expect(lost, name).toEqual([])
    }
    expect(share(seed(2)).share).toBeLessThan(0.25)
  })

  it('turns the thorns only a little when Distortion moves the letter under Crumple and Ripple', async () => {
    // Sound drives Distortion every frame: it moves the ink box that places Crumple and Ripple, which must not swing
    // long thorns round (a 1° turn moves the tip of a 3 em thorn by 0.05 em). Placed by the box Distortion moved, the
    // window's ends turned them up to 11.7° (STIX) and 2.7° (Roboto) here, 0.06° and 0.03° at the median. Crumple's
    // single lattice, fixed in glyph coordinates, has finer creases than the large mesh it had from 10-13 to NOCUR-60,
    // so Distortion's moves cross more of them: up to 2.6° on STIX.
    const font = await loadFixture(fontName)
    const turns: number[] = []
    for (const glyph of sampleGlyphs(font, TEXT)) {
      const before = thornsOf(font, glyph.index, STACK)
      for (const amount of [47, 60, 92]) {
        const after = thornsOf(font, glyph.index, distortion({ amount })(STACK))
        before.forEach((thorn, t) => {
          const other = after[t]
          if (!other || other.contour !== thorn.contour) return
          const cos = thorn.normal.x * other.normal.x + thorn.normal.y * other.normal.y
          turns.push((Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI)
        })
      }
    }
    turns.sort((p, q) => p - q)
    expect(turns.length).toBeGreaterThan(30)
    expect(turns[Math.floor(turns.length / 2)]).toBeLessThanOrEqual(0.05)
    expect(turns[turns.length - 1]).toBeLessThanOrEqual(3)
  })

  it('adds and removes thorns at the end of a fixed list, and only Anchors and the seed change which', async () => {
    const font = await loadFixture(fontName)
    const upm = font.metrics.unitsPerEm
    for (const glyph of sampleGlyphs(font, TEXT)) {
      const all = thornsOf(font, glyph.index, effect('thorn', { count: THORN_LIMITS.maxCount })(STACK)).map(pickOf)
      let fewer = 0
      for (let count = THORN_LIMITS.minCount; count < THORN_LIMITS.maxCount; count++) {
        const some = thornsOf(font, glyph.index, effect('thorn', { count })(STACK)).map(pickOf)
        const label = `"${glyph.char}" Anchors ${count}`
        expect(some, label).toEqual(all.slice(0, some.length))
        expect(some.length, label).toBeGreaterThanOrEqual(fewer)
        expect(some.length, label).toBeLessThanOrEqual(count)
        fewer = some.length
      }
      const three = thornsOf(font, glyph.index, STACK).map(pickOf)
      for (const patch of [{ canvasReach: 0.3 }, { canvasReach: 1, canvasEm: 30 }, { spread: 0.9 }, { width: 1 }, { root: 0 }, { refraction: 1 }]) {
        expect(thornsOf(font, glyph.index, effect('thorn', patch)(STACK)).map(pickOf), `"${glyph.char}" ${JSON.stringify(patch)}`).toEqual(three)
      }
    }
    // Reach sets only how long the thorns are.
    for (const glyph of sampleGlyphs(font, 'Hg')) {
      const at = (canvasReach: number) => deriveGeometry(font.getGlyph(glyph.index), effect('thorn', { canvasReach, root: 0 })(STACK)).experimental.thorn
      const near = at(0.3 / CANVAS_EM)
      const far = at(0.6 / CANVAS_EM)
      expect(far.thorns, `"${glyph.char}"`).toBe(near.thorns)
      expect(far.longest / near.longest, `"${glyph.char}"`).toBeCloseTo(2, 9)
      expect(near.longest, `"${glyph.char}"`).toBeLessThanOrEqual(0.3 * upm)
    }
  })
})

describe('Thorn anchors where contours overlap', () => {
  /** Even-odd point-in-polygon test. */
  const inside = (points: readonly Point[], p: Point) => {
    let odd = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [a, b] = [points[i], points[j]]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd
    }
    return odd
  }
  /** The distance from `p` to the nearest edge of a closed outline. */
  const distance = (points: readonly Point[], p: Point) =>
    Math.min(
      ...points.map((b, i) => {
        const a = points[(i - 1 + points.length) % points.length]
        const [dx, dy] = [b.x - a.x, b.y - a.y]
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
      }),
    )

  it('grows thorns on letters drawn with overlapping contours, from anchors outside the others and clear of them', async () => {
    // Roboto draws these with an arch or bowl over a stem: before, no anchor of theirs counted as outside.
    const font = await loadFixture('Roboto')
    const em = font.metrics.unitsPerEm
    for (const glyph of sampleGlyphs(font, 'amnu')) {
      const contours = outlines(font, glyph.index, STACK).reference.contours.map((c) => c.points)
      for (let s = 1; s <= 5; s++) {
        const picks = thornsOf(font, glyph.index, seed(s)(STACK), false)
        const label = `"${glyph.char}" seed ${s}`
        expect(picks, label).toHaveLength(3)
        for (const { contour, index } of picks) {
          const p = contours[contour][index]
          const others = contours.filter((_, k) => k !== contour)
          // Inside an even number of the other contours: on the letter's outside.
          expect(others.filter((points) => inside(points, p)).length % 2, label).toBe(0)
          // And at least 0.1 em from the edge of every contour that crosses its own (part inside it, part outside).
          const own = contours[contour]
          const crosses = (points: readonly Point[]) =>
            new Set(own.map((q) => inside(points, q))).size > 1 || new Set(points.map((q) => inside(own, q))).size > 1
          for (const points of others.filter(crosses)) expect(distance(points, p), label).toBeGreaterThanOrEqual(0.1 * em)
        }
      }
    }
  })
})
