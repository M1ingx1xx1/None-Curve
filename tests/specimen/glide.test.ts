// Glide (NOCUR-74): the anchor pairing and in-between outlines (morph.ts), the effects' trajectories (trajectory.ts), the
// scene glide (glide.ts) and the page store (useGlide.ts), on made-up outlines and on Roboto.

import { describe, expect, it } from 'vitest'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { GeometryParams, Point, PolygonContour, PolygonGlyph, WhorlMotion } from '../../src/geometry/types'
import { easeOut, GLIDE_LIMITS, SceneGlide } from '../../src/specimen/glide'
import { MORPH_LIMITS, morphAt, planMorph, settleInBetween, type MorphPlan } from '../../src/specimen/morph'
import { placePolygons, shapeSpecimen, type SpecimenScene } from '../../src/specimen/scene'
import { chooseTrajectory, ringPolygon, STRAIGHT, whorlTrajectory, whorlUnturn } from '../../src/specimen/trajectory'
import { whorlMotion, whorlWarp } from '../../src/geometry/whorl'
import { GlideStore, type GlideClock } from '../../src/state/useGlide'
import { loadFixture } from '../helpers/fonts'
import { BASE } from '../helpers/params'

const contour = (points: [number, number][], clockwise = false): PolygonContour => ({
  points: points.map(([x, y]) => ({ x, y })),
  clockwise,
})
const glyph = (...contours: PolygonContour[]): PolygonGlyph => ({
  ref: { index: 1, unicode: null, name: null } as unknown as PolygonGlyph['ref'],
  metrics: { unitsPerEm: 1000 } as PolygonGlyph['metrics'],
  contours,
})
const square = (x: number, y: number, s: number, clockwise = false) =>
  contour(
    [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
    ],
    clockwise,
  )

/** Distance from `p` to the outline of `c`. */
function distanceTo(c: PolygonContour, p: Point): number {
  let best = Infinity
  const pts = c.points
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y))
  }
  return best
}
const onOutline = (g: PolygonGlyph, p: Point) => Math.min(...g.contours.map((c) => distanceTo(c, p)))
const count = (g: PolygonGlyph) => g.contours.reduce((n, c) => n + c.points.length, 0)

/**
 * How the anchors of `plan` travel, sampled finely: `bent` is the share of sample triples whose middle is off the line
 * through its neighbours (a path of straight pieces bends only at its few corners; a curve bends at every sample), and
 * `most` the largest number of bends on one anchor's path.
 */
function bends(plan: MorphPlan, samples = 1500): { bent: number; most: number } {
  const frames = Array.from({ length: samples - 1 }, (_, i) => morphAt(plan, (i + 1) / samples))
  let bent = 0
  let total = 0
  let most = 0
  frames[0].contours.forEach((c, ci) =>
    c.points.forEach((_, pi) => {
      let here = 0
      for (let k = 1; k < frames.length - 1; k++) {
        const a = frames[k - 1].contours[ci].points[pi]
        const m = frames[k].contours[ci].points[pi]
        const b = frames[k + 1].contours[ci].points[pi]
        total++
        if (Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2) > 1e-6) here++
      }
      bent += here
      most = Math.max(most, here)
    }),
  )
  return { bent: bent / total, most }
}

describe('morph: pairing anchors and the in-between outlines', () => {
  const from = glyph(square(0, 0, 100))
  // The same square with a spike out of its right side and two more anchors.
  const spiked = glyph(
    contour([
      [0, 0],
      [100, 0],
      [100, 40],
      [180, 50],
      [100, 60],
      [100, 100],
      [0, 100],
    ]),
  )

  it('gives the outlines themselves at the ends, and in between the anchors of both on the way', () => {
    const plan = planMorph(from, spiked)!
    expect(morphAt(plan, 0)).toBe(from)
    expect(morphAt(plan, 1)).toBe(spiked)
    // Both outlines' anchors, every one once (shared ones once): never more than both together.
    expect(plan.points).toBeGreaterThanOrEqual(count(spiked))
    expect(plan.points).toBeLessThanOrEqual(count(from) + count(spiked))
    // Just after the start, the shape is the old outline (the added anchors lie on its sides); just before the end, the new.
    for (const p of morphAt(plan, 1e-9).contours[0].points) expect(onOutline(from, p)).toBeLessThan(1e-5)
    for (const p of morphAt(plan, 1 - 1e-9).contours[0].points) expect(onOutline(spiked, p)).toBeLessThan(1e-5)
  })

  it('grows a new spike straight out of its base and sinks a vanishing one straight back', () => {
    const plan = planMorph(from, spiked)!
    expect(plan.trajectory).toBe('straight')
    // The tip starts on the side it grows from, across from where it ends, and travels a straight line.
    const tipAt = (p: number) => morphAt(plan, p).contours[0].points.reduce((best, q) => (q.x > best.x ? q : best))
    const half = tipAt(0.5)
    expect(half.x).toBeCloseTo(140, 6)
    expect(half.y).toBeCloseTo(50, 6)
    const back = planMorph(spiked, from)!
    const sunk = morphAt(back, 0.5).contours[0].points.reduce((best, q) => (q.x > best.x ? q : best))
    expect(sunk.x).toBeCloseTo(140, 6)
    expect(sunk.y).toBeCloseTo(50, 6)
  })

  it('moves anchor to anchor when both have as many (Distortion)', () => {
    const moved = glyph(
      contour(from.contours[0].points.map((p, i) => [p.x + (i % 2 ? 7 : -5), p.y + 3] as [number, number])),
    )
    const plan = planMorph(from, moved)!
    expect(plan.points).toBe(4)
    const mid = morphAt(plan, 0.5).contours[0].points
    mid.forEach((p, i) => {
      expect(p.x).toBeCloseTo(from.contours[0].points[i].x + (i % 2 ? 3.5 : -2.5), 9)
      expect(p.y).toBeCloseTo(from.contours[0].points[i].y + 1.5, 9)
    })
  })

  it('pairs outlines with outlines and holes with holes; contours without a partner grow from and shrink to their centre', () => {
    const ring = glyph(square(0, 0, 300), square(100, 100, 100, true))
    const island = glyph(square(0, 0, 300), square(110, 100, 100, true), square(500, 0, 60))
    const plan = planMorph(ring, island)!
    const mid = morphAt(plan, 0.5)
    expect(mid.contours.map((c) => c.clockwise)).toEqual([false, true, false])
    // The hole slides with its partner; the island grows out of its centre (530, 30) at half its size.
    expect(mid.contours[1].points[0].x).toBeCloseTo(105, 9)
    expect(mid.contours[2].points.map((p) => [p.x, p.y])).toEqual([
      [515, 15],
      [545, 15],
      [545, 45],
      [515, 45],
    ])
    const back = morphAt(planMorph(island, ring)!, 0.5)
    // The island shrinks into its centre, after the paired contours.
    expect(back.contours[2].points.map((p) => [p.x, p.y])).toEqual([
      [515, 15],
      [545, 15],
      [545, 45],
      [515, 45],
    ])
  })

  it("keeps each anchor in place when only the contour's first anchor moved round it", () => {
    const turned = glyph(
      contour(
        [1, 2, 3, 0].map((i) => [from.contours[0].points[i].x + 2, from.contours[0].points[i].y] as [number, number]),
      ),
    )
    const mid = morphAt(planMorph(from, turned)!, 0.5).contours[0].points
    // Anchor to anchor by place, not by index: everything moves 1 unit, nothing slides round to the next corner.
    for (const p of mid)
      expect(Math.min(...from.contours[0].points.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))).toBeCloseTo(1, 9)
  })

  it('pairs an outline wound the other way (a merged outline) with its own outline, not with a small hole', () => {
    const a = glyph(
      contour(
        [
          [0, 0],
          [0, 300],
          [300, 300],
          [300, 0],
        ],
        true,
      ),
    )
    // The same letter merged: wound the other way, with a small contour wound the old way.
    const b = glyph(
      contour(
        [
          [0, 0],
          [310, 0],
          [310, 300],
          [0, 300],
        ],
        false,
      ),
      contour(
        [
          [100, 100],
          [100, 140],
          [140, 140],
          [140, 100],
        ],
        true,
      ),
    )
    const mid = morphAt(planMorph(a, b)!, 0.5)
    const xs = mid.contours[0].points.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(295)
  })

  it('grows a contour that splits off out of the outline it splits from, not out of a point', () => {
    const whole = glyph(
      contour([
        [0, 0],
        [400, 0],
        [400, 100],
        [0, 100],
      ]),
    )
    const split = glyph(
      contour([
        [0, 0],
        [180, 0],
        [180, 100],
        [0, 100],
      ]),
      contour([
        [220, 0],
        [400, 0],
        [400, 100],
        [220, 100],
      ]),
    )
    const plan = planMorph(whole, split)!
    const start = morphAt(plan, 1e-12)
    for (const c of start.contours) for (const p of c.points) expect(onOutline(whole, p)).toBeLessThan(1e-6)
    // Halfway, both halves show at about their size.
    for (const c of morphAt(plan, 0.5).contours) {
      const xs = c.points.map((p) => p.x)
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150)
    }
  })

  it('is deterministic and keeps every in-between anchor finite', () => {
    const a = planMorph(from, spiked)!
    const b = planMorph(from, spiked)!
    for (const p of [0.1, 0.37, 0.9]) {
      expect(morphAt(a, p).contours).toEqual(morphAt(b, p).contours)
      for (const q of morphAt(a, p).contours.flatMap((c) => c.points))
        expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true)
    }
  })

  it('changes a glyph at once when its in-between would pass the anchor budget', () => {
    const many = (n: number, r: number) =>
      glyph(
        contour(
          Array.from(
            { length: n },
            (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as [number, number],
          ),
        ),
      )
    expect(planMorph(many(MORPH_LIMITS.maxPoints / 2 + 10, 100), many(MORPH_LIMITS.maxPoints / 2 + 3, 300))).toBeNull()
    expect(planMorph(many(400, 100), many(300, 300))).not.toBeNull()
  })

  it('drops a half-sunk spike gradually, never at once, when quick changes bring more anchors than the next outline has', () => {
    const tall = glyph(
      contour([
        [0, 0],
        [100, 0],
        [100, 40],
        [500, 50],
        [100, 60],
        [100, 100],
        [0, 100],
      ]),
    )
    const half = morphAt(planMorph(tall, from)!, 0.5)
    const next = glyph(
      contour([
        [0, 0],
        [100, 0],
        [50, 100],
      ]),
    )
    // Its tip still stands 200 units out (more than settleMaxShare of an em): it stays.
    const settled = settleInBetween(half, next)
    expect(Math.max(...settled.contours[0].points.map((p) => p.x))).toBeGreaterThan(250)
  })

  it('drops the anchors only the old outline brought once they no longer show, so quick changes never pile anchors up', () => {
    const plan = planMorph(spiked, from)!
    // Nearly arrived: the spike's anchors are within a hair of the side and go.
    expect(count(settleInBetween(morphAt(plan, 0.9999)))).toBe(count(from))
    // Halfway: the half-sunk spike still shows and stays.
    expect(count(settleInBetween(morphAt(plan, 0.5)))).toBeGreaterThan(count(from))
    // A computed outline is left as it is.
    expect(settleInBetween(spiked)).toBe(spiked)
  })
})

describe('trajectories', () => {
  const motion = (amount: number, turn: number): WhorlMotion => ({
    x: 0,
    y: 0,
    sides: 6,
    rings: 2,
    amount,
    pinned: false,
    radius: 100,
    turns: [0, turn / 2, turn],
  })

  it('goes straight unless an effect with a path of its own changed', () => {
    expect(chooseTrajectory(undefined, undefined)).toBe(STRAIGHT)
    const w = motion(0.5, 0.4)
    // Whorl the same on both sides (another effect changed): straight.
    expect(chooseTrajectory({ whorl: w }, { whorl: { ...w, x: 30 } })).toBe(STRAIGHT)
    expect(chooseTrajectory({ whorl: w }, { whorl: motion(1, 0.8) }).id).toBe('whorl')
    expect(chooseTrajectory(undefined, { whorl: w }).id).toBe('whorl')
  })

  it("Whorl's anchors sweep around the centre along the ring polygon, its sides straight and its corners sharp", () => {
    const trajectory = whorlTrajectory(motion(0, 0), motion(1, 2))!
    const ring = ringPolygon(6)
    // A point on the outermost ring (apothem 100) at the bottom, turned by the outer ring's 2 radians.
    const start = ring.at(-Math.PI / 2, 100)
    const end = ring.at(-Math.PI / 2 + 2, 100)
    const fill = trajectory.path(
      Float64Array.of(start.x),
      Float64Array.of(start.y),
      Float64Array.of(end.x),
      Float64Array.of(end.y),
    )
    const xs = new Float64Array(1)
    const ys = new Float64Array(1)
    let lastAngle = -Math.PI / 2
    const samples: Point[] = []
    for (let k = 0; k <= 40; k++) {
      fill(k / 40, xs, ys)
      samples.push({ x: xs[0], y: ys[0] })
      // On the ring all the way: never cutting across it.
      expect(ring.size(xs[0], ys[0])).toBeCloseTo(100, 9)
      // Counter-clockwise, never back.
      const angle = Math.atan2(ys[0], xs[0])
      expect(angle).toBeGreaterThanOrEqual(lastAngle - 1e-12)
      lastAngle = angle
    }
    expect(samples[40].x).toBeCloseTo(end.x, 9)
    expect(samples[40].y).toBeCloseTo(end.y, 9)
    // The path is the hexagon's sides: every sample lies on one of its straight sides (a circle would bulge out).
    const corners = Array.from({ length: 6 }, (_, j) => ring.at(-Math.PI / 2 + Math.PI / 6 + (j * Math.PI) / 3, 100))
    const hexagon: PolygonContour = { points: corners, clockwise: false }
    for (const p of samples) expect(distanceTo(hexagon, p)).toBeLessThan(1e-9)
    // A straight line between the ends would cut across the ring.
    const chordMid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    expect(ring.size(chordMid.x, chordMid.y)).toBeLessThan(90)
  })

  it("moves in straight pieces between the ring's corners while the ring grows, and covers the rest in a straight line", () => {
    const trajectory = whorlTrajectory(motion(0, 0), motion(1, 2))!
    const ring = ringPolygon(6)
    const start = ring.at(-Math.PI / 2, 60)
    const end = ring.at(-Math.PI / 2 + 2 * (60 / 100), 90)
    const fill = trajectory.path(
      Float64Array.of(start.x),
      Float64Array.of(start.y),
      Float64Array.of(end.x),
      Float64Array.of(end.y),
    )
    const xs = new Float64Array(1)
    const ys = new Float64Array(1)
    const at = (p: number) => {
      fill(p, xs, ys)
      return { x: xs[0], y: ys[0] }
    }
    expect(at(1).x).toBeCloseTo(end.x, 9)
    expect(at(1).y).toBeCloseTo(end.y, 9)
    let bent = 0
    for (let k = 1; k < 999; k++) {
      const a = at((k - 1) / 1000)
      const m = at(k / 1000)
      const b = at((k + 1) / 1000)
      if (Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2) > 1e-9) bent++
    }
    // 1.2 radians round a hexagon: one or two corners, each bending at most two sample triples.
    expect(bent).toBeGreaterThan(0)
    expect(bent).toBeLessThanOrEqual(4)
  })

  it('finds where Whorl turned a point from: its ring along the side it faced, exactly, at Sides 3 and beyond 100%', () => {
    const box = { minX: -300, minY: -400, maxX: 300, maxY: 400 }
    const params = { enabled: true, amount: 1.8, rings: 5, sides: 3, pinned: true }
    const warp = whorlWarp(params, box, 1000)
    // A letter-like outline: two squares.
    const outline = [square(-250, -350, 500).points, square(-80, -60, 120).points]
    const motion = whorlMotion(params, box, 1000, glyph(...outline.map((points) => ({ points, clockwise: false }))))
    for (const pts of outline)
      for (let i = 0; i < pts.length; i++)
        for (const t of [0, 0.37, 0.81]) {
          const a = pts[i]
          const b = pts[(i + 1) % pts.length]
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
          const q = warp.map(p)
          const back = whorlUnturn(motion, q.x - motion.x, q.y - motion.y)
          expect(back.x + motion.x).toBeCloseTo(p.x, 6)
          expect(back.y + motion.y).toBeCloseTo(p.y, 6)
        }
  })

  it('turns the whole way the rings turned, beyond half a circle', () => {
    const trajectory = whorlTrajectory(motion(0, 0), motion(4, 4))!
    const ring = ringPolygon(6)
    const start = ring.at(0, 100)
    const end = ring.at(4, 100)
    const fill = trajectory.path(
      Float64Array.of(start.x),
      Float64Array.of(start.y),
      Float64Array.of(end.x),
      Float64Array.of(end.y),
    )
    const xs = new Float64Array(1)
    const ys = new Float64Array(1)
    fill(0.5, xs, ys)
    // Halfway round the 4-radian turn (counter-clockwise), not the short way back (clockwise).
    const angle = Math.atan2(ys[0], xs[0])
    expect(angle).toBeCloseTo(2, 1)
  })
})

describe('Glide on Roboto', async () => {
  const font = await loadFixture('Roboto')
  const shaped = shapeSpecimen(font, 'Hamburg')
  const sceneFor = (params: GeometryParams): SpecimenScene => {
    const cache = new Map<number, PolygonGlyph>()
    return placePolygons(shaped, (index) => {
      let polygon = cache.get(index)
      if (!polygon) cache.set(index, (polygon = deriveGeometry(font.getGlyph(index), params).polygon))
      return { polygon }
    })
  }
  const exp = (patch: Partial<GeometryParams['experimental']>): GeometryParams => ({
    ...BASE,
    experimental: { ...BASE.experimental, ...patch },
  })
  const whorl = (amount: number) => exp({ whorl: { ...BASE.experimental.whorl, enabled: true, amount } })
  const burst = (seed: number) =>
    exp({ seed, thorn: { ...BASE.experimental.thorn, enabled: true, burst: true, canvasReach: 0.05, canvasEm: 30 } })

  it('Whorl hands its centre and turns to the canvas without changing the outline', () => {
    const index = shaped.indices[0]
    const on = deriveGeometry(font.getGlyph(index), whorl(0.6)).polygon
    expect(on.motion?.whorl).toMatchObject({ sides: 8, rings: 6, amount: 0.6, pinned: true })
    expect(on.motion!.whorl!.turns).toHaveLength(7)
    expect(deriveGeometry(font.getGlyph(index), BASE).polygon.motion).toBeUndefined()
  })

  const glideBetween = (a: SpecimenScene, b: SpecimenScene, durationMs = 1000) => {
    const glide = new SceneGlide(() => 0)
    glide.retarget(a, 0, { durationMs, glide: false, key: 'k' })
    glide.retarget(b, 0, { durationMs, glide: true, key: 'k' })
    return glide
  }
  const glyphsOf = (scene: SpecimenScene) => scene.lines.flatMap((l) => l.glyphs)

  for (const [name, a, b] of [
    ['Whorl 0.3 → 0.9', whorl(0.3), whorl(0.9)],
    ['Thorn Burst seed 1 → 2', burst(1), burst(2)],
  ] as const) {
    it(`${name}: starts from the shapes shown, arrives at the shapes computed, and every frame is straight sides`, () => {
      const sa = sceneFor(a)
      const sb = sceneFor(b)
      const glide = glideBetween(sa, sb)
      expect(glyphsOf(glide.frame(0)!).map((g) => g.polygon)).toEqual(glyphsOf(sa).map((g) => g.polygon))
      for (const t of [100, 400, 800]) {
        const frame = glide.frame(t)!
        glyphsOf(frame).forEach((g, k) => {
          for (const c of g.polygon!.contours) {
            expect(c.points.length).toBeLessThanOrEqual(
              count(glyphsOf(sa)[k].polygon!) + count(glyphsOf(sb)[k].polygon!),
            )
            for (const p of c.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
          }
        })
      }
      expect(glide.frame(1000)).toBe(sb)
      expect(glide.moving(1000)).toBe(false)
    })
  }

  it('glides Whorl on its own by its mesh: in straight pieces, from the shape shown to the shape computed, folds and all', () => {
    for (const [from, to] of [
      [BASE, whorl(1.5)],
      [whorl(1), whorl(1.1)],
      [whorl(0.3), whorl(0.9)],
    ] as const) {
      const a = glyphsOf(sceneFor(from))[0].polygon! // "H"
      const b = glyphsOf(sceneFor(to))[0].polygon!
      const plan = planMorph(a, b)!
      expect(plan.trajectory).toBe('whorl-mesh')
      // Every anchor travels in straight pieces that turn at a few corners.
      const { bent, most } = bends(plan)
      expect(bent).toBeLessThan(0.02)
      expect(most).toBeLessThan(80)
      // The ends are the outlines themselves.
      expect(morphAt(plan, 0)).toBe(a)
      expect(morphAt(plan, 1)).toBe(b)
    }
  })

  it('a Whorl glide that goes on carries on from the mesh as shown, with no jump', () => {
    const s1 = sceneFor(whorl(0.3))
    const s2 = sceneFor(whorl(0.9))
    const s3 = sceneFor(whorl(1.4))
    const glide = glideBetween(s1, s2, 150)
    const before = glide.frame(40)!
    glide.retarget(s3, 40, { durationMs: 150, glide: true, key: 'k' })
    const after = glide.frame(40)!
    glyphsOf(after).forEach((g, k) => expect(g.polygon!.contours).toEqual(glyphsOf(before)[k].polygon!.contours))
    expect(glide.frame(40 + 150)).toBe(s3)
  })

  it('glides Whorl with other changes around the centre in straight pieces; spikes grow straight out of their base', () => {
    const thorny = (amount: number, reach: number) =>
      exp({
        seed: 1,
        whorl: { ...BASE.experimental.whorl, enabled: true, amount },
        thorn: { ...BASE.experimental.thorn, enabled: true, canvasReach: reach, canvasEm: 30 },
      })
    for (const [from, to] of [
      [thorny(0.3, 0.03), thorny(0.9, 0.12)],
      [whorl(0.6), exp({ whorl: { ...BASE.experimental.whorl, enabled: true, amount: 0.6, rings: 3 } })],
    ] as const) {
      const a = glyphsOf(sceneFor(from))[1].polygon! // "a"
      const b = glyphsOf(sceneFor(to))[1].polygon!
      const plan = planMorph(a, b)!
      expect(plan.trajectory).toBe('whorl')
      expect(bends(plan).bent).toBeLessThan(0.02)
    }
  })

  it('a new shape on the way glides on from the shape on screen, with no jump', () => {
    const s1 = sceneFor(burst(1))
    const s2 = sceneFor(burst(2))
    const s3 = sceneFor(burst(3))
    const glide = glideBetween(s1, s2, 150)
    const before = glide.frame(40)!
    glide.retarget(s3, 40, { durationMs: 150, glide: true, key: 'k' })
    const after = glide.frame(40)!
    // The same outlines (anchors only the old outline brought may be dropped within GLIDE's tolerance).
    glyphsOf(after).forEach((g, k) => {
      const shown = glyphsOf(before)[k].polygon!
      for (const c of g.polygon!.contours)
        for (const p of c.points) expect(onOutline(shown, p)).toBeLessThan(MORPH_LIMITS.settleShare * 2048 + 1e-6)
    })
    expect(glide.frame(40 + 150)).toBe(s3)
  })

  it('shows changes at once with Glide 0, without Sound, or for another text', () => {
    const sa = sceneFor(burst(1))
    const sb = sceneFor(burst(2))
    for (const options of [
      { durationMs: 0, glide: true, key: 'k' },
      { durationMs: 150, glide: false, key: 'k' },
      { durationMs: 150, glide: true, key: 'other' },
    ]) {
      const glide = new SceneGlide(() => 0)
      glide.retarget(sa, 0, { durationMs: 150, glide: false, key: 'k' })
      glide.retarget(sb, 0, options)
      expect(glide.frame(0)).toBe(sb)
      expect(glide.moving(0)).toBe(false)
    }
  })
})

describe('the page store', () => {
  /** A clock that stands still until told, and frames run by hand. */
  function fakeClock() {
    let now = 0
    let queued: (() => void) | null = null
    const clock: GlideClock = {
      now: () => now,
      request: (callback) => {
        queued = callback
        return 1
      },
      cancel: () => {
        queued = null
      },
    }
    return {
      clock,
      advance(ms: number) {
        now += ms
        const run = queued
        queued = null
        run?.()
      },
      get queued() {
        return queued !== null
      },
    }
  }
  const scene = (x: number): SpecimenScene => ({
    lines: [
      {
        glyphs: [
          {
            index: 1,
            text: 'a',
            x,
            y: 0,
            advance: 100,
            missing: false,
            polygon: glyph(square(0, 0, 100)),
            error: null,
            ink: null,
          },
        ],
        width: 100,
        baseline: 0,
        ink: null,
      },
    ],
    lineHeight: 1000,
    ascender: 800,
    descender: -200,
    capHeight: 700,
    ink: null,
    body: null,
    blockWidth: 100,
    textTop: -800,
    textBottom: 200,
    slant: 0,
    missingCharacters: [],
    failedGlyphs: 0,
    pendingGlyphs: 0,
    glyphCount: 1,
    truncated: false,
    kerning: false,
  })

  it('keeps one frame asked for however many scenes arrive mid-glide', () => {
    const pending = new Set<number>()
    let next = 1
    const clock: GlideClock = {
      now: () => 0,
      request: () => {
        pending.add(next)
        return next++
      },
      cancel: (handle) => {
        pending.delete(handle)
      },
    }
    const store = new GlideStore(clock)
    store.show(scene(0), { durationMs: 100, live: true, key: 'k' })
    for (let i = 1; i <= 20; i++) store.show(scene(i * 10), { durationMs: 100, live: true, key: 'k' })
    expect(pending.size).toBe(1)
  })

  it('with Glide 0 shows each scene itself, at once, and asks for no frames', () => {
    const fake = fakeClock()
    const store = new GlideStore(fake.clock)
    const a = scene(0)
    const b = scene(50)
    store.show(a, { durationMs: 0, live: true, key: 'k' })
    store.show(b, { durationMs: 0, live: true, key: 'k' })
    expect(store.getSnapshot()).toMatchObject({ target: b, scene: b })
    expect(store.getSnapshot().frame).toMatchObject({ target: b, layout: b, morphs: null })
    expect(store.getSnapshot().frame.scene()).toBe(b)
    expect(store.getSnapshot().scene).toBe(b)
    expect(fake.queued).toBe(false)
  })

  it('glides while Sound drives (and into the first scene after), frame by frame, then stops asking', () => {
    const fake = fakeClock()
    const store = new GlideStore(fake.clock)
    store.show(scene(0), { durationMs: 100, live: false, key: 'k' })
    store.show(scene(100), { durationMs: 100, live: true, key: 'k' })
    expect(fake.queued).toBe(true)
    fake.advance(50)
    const x = store.getSnapshot().scene!.lines[0].glyphs[0].x
    expect(x).toBeCloseTo(100 * easeOut(0.5), 9)
    fake.advance(60)
    expect(store.getSnapshot().scene!.lines[0].glyphs[0].x).toBe(100)
    expect(fake.queued).toBe(false)
    // Sound stopped: the first scene after still glides (back to the sliders' own)...
    store.show(scene(0), { durationMs: 100, live: false, key: 'k' })
    expect(fake.queued).toBe(true)
    fake.advance(200)
    // ...a later one does not.
    store.show(scene(30), { durationMs: 100, live: false, key: 'k' })
    expect(fake.queued).toBe(false)
    expect(store.getSnapshot().scene!.lines[0].glyphs[0].x).toBe(30)
  })

  it('lets every glyph of a long text take its turn while new shapes keep coming faster than they can all be paired', () => {
    // A clock that runs 10 ms on every reading: each frame pairs one glyph, then its budget is spent.
    let t = 0
    const glide = new SceneGlide(() => (t += 10))
    const many = (shift: number): SpecimenScene => {
      const base = scene(0)
      const glyphs = Array.from({ length: 12 }, (_, k) => ({
        ...base.lines[0].glyphs[0],
        x: 100 * k,
        polygon: glyph(square(0, 0, 100 + shift)),
      }))
      return { ...base, lines: [{ ...base.lines[0], glyphs }] }
    }
    glide.retarget(many(0), 0, { durationMs: 100, glide: false, key: 'k' })
    const reshaped = new Set<number>()
    for (let frame = 1; frame <= 36; frame++) {
      const now = 16 * frame
      // A new shape every second frame.
      if (frame % 2 === 1) glide.retarget(many(frame), now, { durationMs: 100, glide: true, key: 'k' })
      glide.frame(now)!.lines[0].glyphs.forEach((g, k) => {
        const width = Math.max(...g.polygon!.contours[0].points.map((p) => p.x))
        if (width > 100) reshaped.add(k)
      })
    }
    expect(reshaped.size).toBe(12)
  })

  it('arrives early enough that a glide nearly done is not glided again', () => {
    expect(easeOut(1)).toBe(1)
    expect(GLIDE_LIMITS.arrived).toBeLessThan(1)
  })
})
