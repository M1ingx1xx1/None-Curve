// mergeOverlaps on synthetic outlines: crossings on grid-cell corners and sides (report item #1), a merge of tens of
// thousands of vertices in one piece (#2, the union-find that used to recurse once per vertex), the `maxHot`
// budget that gives up early on glyphs too complex to merge, outlines as far out as Thorn reaches (256 em), and thin
// contours: slivers left out, letters with long thin thorns kept.

import { describe, expect, it } from 'vitest'
import { mergeOverlaps } from '../../src/geometry/overlaps'
import type { Point, PolygonGlyph } from '../../src/geometry/types'
import { contoursOf, inkArea, outlineCrossings, polygonOf, rect, signedArea2, vertexCount, type Contours } from '../helpers/outline'

/** Proper crossings the merged outline still has, and its ink as a share of the input's. */
function check(input: PolygonGlyph, output: PolygonGlyph, lines = 1500) {
  const out = contoursOf(output)
  return { crossings: outlineCrossings(out).cross, ink: inkArea(out, lines) / inkArea(contoursOf(input), lines) }
}

/** Accepts a merge that came out right (no crossings, the same ink) or that gave up and returned its input unchanged. */
function expectMergedOrFailed(input: PolygonGlyph, label: string) {
  const { polygon, stats } = mergeOverlaps(input)
  if (stats.failed) {
    expect(polygon, `${label}: a failed merge returns its input`).toBe(input)
    expect(stats.applied).toBe(false)
    return 'failed'
  }
  const { crossings, ink } = check(input, polygon)
  expect(crossings, `${label}: crossings after the merge`).toBe(0)
  expect(Math.abs(ink - 1), `${label}: ink ${(100 * ink).toFixed(2)}% of the input's`).toBeLessThan(0.01)
  return 'merged'
}

// ---- #1: crossings exactly on a grid-cell corner or side ----

const cross2 = (s: readonly number[], x: number, y: number) => (s[2] - s[0]) * (y - s[1]) - (s[3] - s[1]) * (x - s[0])

function proper(s: readonly number[], t: readonly number[]) {
  const d1 = cross2(s, t[0], t[1])
  const d2 = cross2(s, t[2], t[3])
  const d3 = cross2(t, s[0], s[1])
  const d4 = cross2(t, s[2], s[3])
  return d1 !== 0 && d2 !== 0 && d1 > 0 !== d2 > 0 && d3 !== 0 && d4 !== 0 && d3 > 0 !== d4 > 0
}

/** The grid point a crossing rounds to in floating point, as the merge first computed it. */
function floatPixel(s: readonly number[], t: readonly number[]) {
  const d1 = cross2(s, t[0], t[1])
  const d2 = cross2(s, t[2], t[3])
  const f = d1 / (d1 - d2)
  return [Math.round(t[0] + (t[2] - t[0]) * f), Math.round(t[1] + (t[3] - t[1]) * f)]
}

/** The grid point it rounds to exactly (halves up), in integers. */
function exactPixel(s: readonly number[], t: readonly number[]) {
  const [ax, ay, bx, by] = s.map(BigInt)
  const [cx, cy, dx, dy] = t.map(BigInt)
  const cr = (x0: bigint, y0: bigint, x1: bigint, y1: bigint, x2: bigint, y2: bigint) => (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
  const d1 = cr(ax, ay, bx, by, cx, cy)
  const d2 = cr(ax, ay, bx, by, dx, dy)
  let den = d1 - d2
  let nx = cx * den + (dx - cx) * d1
  let ny = cy * den + (dy - cy) * d1
  if (den < 0n) [den, nx, ny] = [-den, -nx, -ny]
  const floor = (n: bigint, d: bigint) => (n >= 0n ? n / d : -((-n + d - 1n) / d))
  return [Number(floor(2n * nx + den, 2n * den)), Number(floor(2n * ny + den, 2n * den))]
}

/** The segment closed into a counter-clockwise triangle by an apex off to one side. */
function triangle(e: readonly number[]): Point[] {
  const [ax, ay, bx, by] = e
  const apex = { x: Math.round((ax + bx) / 2 - (by - ay) * 0.3), y: Math.round((ay + by) / 2 + (bx - ax) * 0.3) }
  const points = [{ x: ax, y: ay }, { x: bx, y: by }, apex]
  return signedArea2(points) > 0 ? points : points.reverse()
}

/**
 * Pairs of long segments that cross exactly at a cell's corner (both coordinates half-integers) or on a cell's side
 * (one of them), most of them where the floating-point crossing rounds into a different cell than the exact one.
 * `areas`: how long the segments are (about) and how far from the origin they cross (at most).
 */
function cornerCases(
  hardPerKind: number,
  easyPerKind: number,
  areas: readonly (readonly [number, number])[] = [
    [4000, 1000],
    [8000, 100000],
  ],
) {
  let seed = 12345
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
  const int = (a: number, b: number) => a + Math.floor(random() * (b - a + 1))
  const odd = (m: number) => 2 * int(-m, m - 1) + 1
  // The segment through (cx2 / 2, cy2 / 2) along (p, q), u half-steps back and w forward.
  const through = (cx2: number, cy2: number, p: number, q: number, u: number, w: number) => [(cx2 - u * p) / 2, (cy2 - u * q) / 2, (cx2 + w * p) / 2, (cy2 + w * q) / 2]
  const cases: { s: number[]; t: number[]; hard: boolean; kind: string }[] = []
  for (const [size, spread] of areas) {
    for (const kind of ['corner', 'side']) {
      let hard = 0
      let easy = 0
      for (let tries = 0; tries < 400000 && (hard < hardPerKind || easy < easyPerKind); tries++) {
        const cx2 = 2 * int(-spread, spread) + 1
        const cy2 = kind === 'corner' ? 2 * int(-spread, spread) + 1 : 2 * int(-spread, spread)
        const m = Math.max(1, Math.floor(size / 4))
        const direction = () => (kind === 'corner' ? [odd(m), odd(m)] : [odd(m), 2 * int(-m, m)])
        const [p, q] = direction()
        const [p2, q2] = direction()
        const s = through(cx2, cy2, p, q, Math.abs(odd(40)), Math.abs(odd(40)))
        const t = through(cx2, cy2, p2, q2, Math.abs(odd(40)), Math.abs(odd(40)))
        if (!proper(s, t)) continue
        const f = floatPixel(s, t)
        const e = exactPixel(s, t)
        const isHard = f[0] !== e[0] || f[1] !== e[1]
        if (isHard && hard < hardPerKind) {
          hard++
          cases.push({ s, t, hard: true, kind: `${kind} ${spread}` })
        } else if (!isHard && easy < easyPerKind) {
          easy++
          cases.push({ s, t, hard: false, kind: `${kind} ${spread}` })
        }
      }
    }
  }
  return cases
}

describe('mergeOverlaps: crossings on grid-cell corners and sides (#1)', () => {
  it('merges the known corner cases correctly or reports them failed', () => {
    const known = [
      { s: [-21456, 3349, 75123, -15516], t: [4480, 41160, -5778, -40766] },
      { s: [62309, -56326, -19839, 18606], t: [8424, 14835, -7389, -10932] },
      { s: [104018, -28182, 55018, -11662], t: [170168, 7296, 12143, -49851] },
    ]
    for (const { s, t } of known) expectMergedOrFailed(polygonOf([triangle(s), triangle(t)]), `${s} x ${t}`)
  })

  it('merges generated corner and side cases correctly or reports them failed', () => {
    const cases = cornerCases(60, 10)
    expect(cases.filter((c) => c.hard).length).toBeGreaterThanOrEqual(200)
    const outcomes = cases.map(({ s, t, kind, hard }) => expectMergedOrFailed(polygonOf([triangle(s), triangle(t)]), `${kind}${hard ? ' hard' : ''} ${s} x ${t}`))
    // Giving up is the last resort: nearly all of them merge.
    expect(outcomes.filter((o) => o === 'failed').length).toBeLessThanOrEqual(cases.length / 20)
  })
})

/**
 * A comb: a base with `teeth` teeth `width` wide on a pitch of twice that, `height` tall, as one counter-clockwise
 * contour of 4 * teeth + 2 points, and a bar across all the teeth halfway up.
 */
function combAndBar(teeth: number, width: number, height: number): Contours {
  const pitch = 2 * width
  const span = teeth * pitch - width
  const comb: Point[] = [
    { x: 0, y: -10 },
    { x: span, y: -10 },
  ]
  for (let k = teeth - 1; k >= 0; k--) {
    const x = k * pitch
    comb.push({ x: x + width, y: 0 }, { x: x + width, y: height }, { x, y: height }, { x, y: 0 })
  }
  return [comb, rect(-5, height / 2, span + 5, height / 2 + 4)]
}

describe('mergeOverlaps: large pieces (#2)', () => {
  it('merges a comb of 30 000 points crossed 30 000 times without overflowing the stack', () => {
    const input = polygonOf(combAndBar(7500, 3, 60))
    expect(vertexCount(contoursOf(input))).toBeGreaterThan(30000)
    let result: ReturnType<typeof mergeOverlaps> | undefined
    expect(() => (result = mergeOverlaps(input))).not.toThrow()
    const { polygon, stats } = result!
    expect(stats).toMatchObject({ applied: true, failed: false, tooComplex: false, crossings: 30000 })
    const { crossings, ink } = check(input, polygon, 400)
    expect(crossings).toBe(0)
    expect(Math.abs(ink - 1)).toBeLessThan(0.01)
    // One outline around the ink, and a hole between every two teeth under the bar.
    expect(polygon.contours.length).toBe(7500)
  })
})

describe('mergeOverlaps: the maxHot budget', () => {
  const input = polygonOf(combAndBar(1500, 3, 60))
  const vertices = vertexCount(contoursOf(input))

  it('merges as usual within the budget', () => {
    const unlimited = mergeOverlaps(input)
    const hot = vertices + unlimited.stats.crossings
    const within = mergeOverlaps(input, 'nonzero', { maxHot: hot + 10 })
    expect(within.stats.tooComplex).toBe(false)
    expect(within.polygon.contours).toEqual(unlimited.polygon.contours)
  })

  it('returns the input, flagged too complex, beyond it', () => {
    for (const maxHot of [Math.floor(vertices / 2), vertices + 100]) {
      const { polygon, stats } = mergeOverlaps(input, 'nonzero', { maxHot })
      expect(polygon).toBe(input)
      expect(stats).toMatchObject({ applied: false, tooComplex: true, failed: false })
    }
  })

  it('gives up faster than it merges', () => {
    const time = (run: () => void) => {
      let best = Infinity
      for (let k = 0; k < 3; k++) {
        const start = performance.now()
        run()
        best = Math.min(best, performance.now() - start)
      }
      return best
    }
    const full = time(() => mergeOverlaps(input))
    const early = time(() => mergeOverlaps(input, 'nonzero', { maxHot: Math.floor(vertices / 2) }))
    expect(early).toBeLessThan(full / 3)
  })
})

// ---- Far out: Thorn reaches up to 256 em (THORN_LIMITS.maxReachEm) ----

/** A thin thorn: a triangle from a base (b0–b1) to a tip, counter-clockwise. */
function thorn(b0: Point, b1: Point, tip: Point): Point[] {
  const points = [b0, b1, tip]
  return signedArea2(points) > 0 ? points : points.reverse()
}

/**
 * A letter-sized square at 4096 units per em with four thin thorns reaching `length` units across, two each way, each
 * pair crossing at a shallow angle about halfway out.
 */
function farThorns(length: number): Contours {
  const em = 4096
  return [
    rect(0, 0, em, em),
    thorn({ x: 1000, y: 0 }, { x: 1300, y: 0 }, { x: length, y: length / 2 + 2000 }),
    thorn({ x: 1000, y: em }, { x: 1300, y: em }, { x: length, y: length / 2 - 2000 }),
    thorn({ x: 2800, y: 0 }, { x: 3100, y: 0 }, { x: -length, y: -length / 2 + 2000 }),
    thorn({ x: 2800, y: em }, { x: 3100, y: em }, { x: -length, y: -length / 2 - 2000 }),
  ]
}

describe('mergeOverlaps: far out', () => {
  // The merge tries a grid of whole units at 4096 units per em, then one twice as fine: 256 em out is 2^20 cells on the
  // first and 2^21 on the second. The arithmetic depends only on the grid coordinates, so 512 em out on the first grid
  // stands for 256 em on the second.
  for (const em of [256, 512]) {
    it(`merges thorns ${em} em long at 4096 units per em exactly`, () => {
      const input = polygonOf(farThorns(em * 4096), 4096)
      const { polygon, stats } = mergeOverlaps(input)
      expect(stats).toMatchObject({ applied: true, failed: false, tooComplex: false })
      expect(stats.crossings).toBeGreaterThanOrEqual(4)
      const { crossings, ink } = check(input, polygon, 4000)
      expect(crossings).toBe(0)
      expect(Math.abs(ink - 1)).toBeLessThan(0.01)
    })
  }

  it('merges corner and side cases 2^21 grid cells out correctly or reports them failed', () => {
    const cases = cornerCases(20, 5, [[8000, 2 ** 21 - 40000]])
    expect(cases.filter((c) => c.hard).length).toBeGreaterThanOrEqual(30)
    const outcomes = cases.map(({ s, t, kind, hard }) => expectMergedOrFailed(polygonOf([triangle(s), triangle(t)]), `${kind}${hard ? ' hard' : ''} ${s} x ${t}`))
    expect(outcomes.filter((o) => o === 'failed').length).toBeLessThanOrEqual(cases.length / 20)
  })

  it('reports a glyph beyond the grid failed, and leaves it as it is', () => {
    const input = polygonOf(farThorns(2 ** 22), 4096)
    const { polygon, stats } = mergeOverlaps(input)
    expect(polygon).toBe(input)
    expect(stats).toMatchObject({ applied: false, failed: true, tooComplex: false })
  })
})

// ---- Thin contours: slivers too thin to show, and letters made thin on average by long thorns ----

describe('mergeOverlaps: thin contours', () => {
  it('leaves out hair-thin slivers, however long', () => {
    // Half a unit wide on average, 4 em and 30 em long (0.015 em² of area), beside a letter-sized square.
    const slivers = [thorn({ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1 }), thorn({ x: 0, y: -100 }, { x: 30_000, y: -100 }, { x: 30_000, y: -99 })]
    const input = polygonOf([rect(0, 100, 500, 600), ...slivers])
    const { polygon, stats } = mergeOverlaps(input)
    expect(stats.removed).toBe(2)
    expect(contoursOf(polygon)).toHaveLength(1)
    expect(inkArea(contoursOf(polygon))).toBeCloseTo(500 * 500, -2)
  })

  it('keeps a letter whose long thin thorn makes it narrow on average', () => {
    // A square 0.1 em across with a thorn 200 em long and 1 unit wide at its base: twice the area over the perimeter
    // is about half a unit, yet the square is plain to see. The merge used to leave all of it out.
    const input = polygonOf([rect(0, 0, 100, 100), thorn({ x: 100, y: 50 }, { x: 100, y: 51 }, { x: 200_000, y: 50 })])
    const { polygon, stats } = mergeOverlaps(input)
    expect(stats).toMatchObject({ applied: true, failed: false, removed: 0 })
    expect(contoursOf(polygon)).toHaveLength(1)
    const { crossings, ink } = check(input, polygon)
    expect(crossings).toBe(0)
    expect(Math.abs(ink - 1)).toBeLessThan(0.01)
  })

  it('keeps a hole that a long thin crack makes narrow on average', () => {
    // A square hole 0.2 em across with a crack 200 em long and 1 unit wide, in a bar around both (clockwise: a hole).
    const hole = [
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 201 },
      { x: 200_000, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 100 },
    ]
    const input = polygonOf([rect(0, 0, 200_100, 1000), hole])
    const { polygon, stats } = mergeOverlaps(input)
    expect(stats).toMatchObject({ applied: true, failed: false, removed: 0 })
    expect(contoursOf(polygon)).toHaveLength(2)
    const { crossings, ink } = check(input, polygon)
    expect(crossings).toBe(0)
    expect(Math.abs(ink - 1)).toBeLessThan(0.01)
  })
})
