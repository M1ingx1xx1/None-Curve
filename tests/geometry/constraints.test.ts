// Grid snapping and angle lock (src/geometry/constraints.ts) on small hand-made outlines: edge cases of the grid
// size and the angle step, degenerate contours, and what a contour that cannot be constrained keeps.

import { describe, expect, it } from 'vitest'
import { applyConstraints, nearestAllowedAngle, snapValue } from '../../src/geometry/constraints'
import { ANGLE_STEPS } from '../../src/geometry/limits'
import type { GridParams, Point } from '../../src/geometry/types'
import { contoursOf, outlineCrossings, polygonOf, rect, signedArea2, type Contours } from '../helpers/outline'

const OFF: GridParams = { snap: false, size: 0, angleLock: false, angleStep: 45 }
const snap = (size: number): GridParams => ({ ...OFF, snap: true, size })
const lock = (angleStep: number): GridParams => ({ ...OFF, angleLock: true, angleStep })

/** A lopsided hexagon with no edge on a multiple of 15°. */
const HEXAGON: Point[] = [
  { x: 100, y: 0 },
  { x: 520, y: 40 },
  { x: 610, y: 330 },
  { x: 480, y: 690 },
  { x: 130, y: 640 },
  { x: 20, y: 300 },
]

/** Each edge's direction in degrees, from 0 to 360. */
function edgeAngles(points: readonly Point[]): number[] {
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length]
    return ((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 360) + 360) % 360
  })
}

/** How far an angle is from the nearest multiple of `step`, in degrees. */
const offStep = (degrees: number, step: number) => Math.abs(degrees - Math.round(degrees / step) * step)

const run = (contours: Contours, params: GridParams) => applyConstraints(polygonOf(contours), params)

describe('snapValue', () => {
  it('rounds to the nearest multiple of the size', () => {
    expect(snapValue(12, 10, 0)).toBe(10)
    expect(snapValue(17, 10, 0)).toBe(20)
    expect(snapValue(-12, 10, 0)).toBe(-10)
    expect(snapValue(-17, 10, 0)).toBe(-20)
    expect(snapValue(30, 10, 0)).toBe(30)
  })

  it('rounds an exact half toward the centre', () => {
    expect(snapValue(15, 10, 100)).toBe(20)
    expect(snapValue(15, 10, 0)).toBe(10)
    expect(snapValue(-15, 10, 0)).toBe(-10)
    expect(snapValue(-15, 10, -100)).toBe(-20)
    // A point on the centre itself rounds down.
    expect(snapValue(15, 10, 15)).toBe(10)
  })

  it('snaps symmetric points symmetrically about the centre', () => {
    for (const v of [5, 15, 25, 35, 7, 33]) expect(snapValue(50 - v, 10, 50) + snapValue(50 + v, 10, 50)).toBe(100)
  })

  it('cleans floating noise and negative zero', () => {
    expect(snapValue(0.3, 0.1, 0)).toBe(0.3)
    expect(snapValue(0.7, 0.1, 0)).toBe(0.7)
    expect(Object.is(snapValue(-0.4, 10, 0), 0)).toBe(true)
  })

  it('works with a tiny size', () => {
    expect(snapValue(1.23456, 0.001, 0)).toBe(1.235)
    expect(snapValue(1.2344, 0.001, 0)).toBe(1.234)
  })
})

describe('nearestAllowedAngle', () => {
  it('rounds to the nearest multiple of the step', () => {
    expect(nearestAllowedAngle(10, 45)).toBe(0)
    expect(nearestAllowedAngle(30, 45)).toBe(45)
    expect(nearestAllowedAngle(100, 90)).toBe(90)
    expect(nearestAllowedAngle(8, 15)).toBe(15)
  })

  it('rounds an exact tie up (counter-clockwise)', () => {
    expect(nearestAllowedAngle(22.5, 45)).toBe(45)
    expect(nearestAllowedAngle(45, 90)).toBe(90)
    expect(nearestAllowedAngle(15, 30)).toBe(30)
    expect(nearestAllowedAngle(7.5, 15)).toBe(15)
  })

  it('stays just below a tie on the lower side', () => {
    expect(nearestAllowedAngle(22.499999, 45)).toBe(0)
    expect(nearestAllowedAngle(44.999999, 90)).toBe(0)
  })

  it('wraps negative angles and angles of a full turn or more into 0..360', () => {
    expect(nearestAllowedAngle(-10, 90)).toBe(0)
    expect(nearestAllowedAngle(-100, 90)).toBe(270)
    expect(nearestAllowedAngle(350, 45)).toBe(0)
    expect(nearestAllowedAngle(720 + 50, 45)).toBe(45)
    // 315 is a tie at 90° that rounds up to 360, which is 0.
    expect(nearestAllowedAngle(315, 90)).toBe(0)
  })
})

describe('applyConstraints: off and no-op settings', () => {
  it('changes nothing with both steps off', () => {
    const polygon = polygonOf([HEXAGON])
    const { polygon: out, stats } = applyConstraints(polygon, OFF)
    expect(out.contours).toBe(polygon.contours)
    expect(stats.snapApplied).toBe(false)
    expect(stats.angleApplied).toBe(false)
  })

  it('treats a grid size of 0, below 0, or not finite as snapping off', () => {
    for (const size of [0, -10, NaN, Infinity]) {
      const polygon = polygonOf([HEXAGON])
      const { polygon: out, stats } = applyConstraints(polygon, snap(size))
      expect(stats.snapApplied, `size ${size}`).toBe(false)
      expect(out.contours).toBe(polygon.contours)
    }
  })

  it('handles a glyph with no contours', () => {
    const { polygon, stats } = applyConstraints(polygonOf([]), { snap: true, size: 10, angleLock: true, angleStep: 90 })
    expect(polygon.contours).toEqual([])
    expect(stats.fallbacks).toEqual([])
  })

  it('never modifies its input', () => {
    const contours = [HEXAGON.map((p) => ({ ...p })), rect(200, 200, 300, 300)]
    const copy = JSON.parse(JSON.stringify(contours))
    run(contours, { snap: true, size: 37, angleLock: true, angleStep: 30 })
    expect(contours).toEqual(copy)
  })
})

describe('applyConstraints: grid snapping', () => {
  it('puts every vertex on the grid', () => {
    for (const size of [1, 7, 25, 50]) {
      const { polygon, stats } = run([HEXAGON], snap(size))
      expect(stats.fallbacks, `size ${size}`).toEqual([])
      for (const p of polygon.contours[0].points) {
        expect(Math.abs(p.x / size - Math.round(p.x / size))).toBeLessThan(1e-6)
        expect(Math.abs(p.y / size - Math.round(p.y / size))).toBeLessThan(1e-6)
      }
      expect(stats.snapMaxShift).toBeLessThanOrEqual((size * Math.SQRT2) / 2 + 1e-9)
    }
  })

  it('leaves an outline already on a tiny grid where it is', () => {
    const square = rect(0, 0, 100, 100)
    const { polygon, stats } = run([square], snap(0.001))
    expect(contoursOf(polygon)).toEqual([square])
    expect(stats.snapMaxShift).toBe(0)
    expect(stats.snapMerged).toBe(0)
  })

  it('merges neighbours that land on the same grid point', () => {
    const notched: Point[] = [
      { x: 0, y: 0 },
      { x: 98, y: 0 },
      { x: 102, y: 1 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]
    const { polygon, stats } = run([notched], snap(100))
    expect(polygon.contours[0].points).toHaveLength(5)
    expect(stats.snapMerged).toBe(1)
  })

  it('keeps a contour that would collapse onto fewer than three grid points', () => {
    const small = rect(10, 10, 30, 30)
    const { polygon, stats } = run([small], snap(1000))
    expect(contoursOf(polygon)).toEqual([small])
    expect(stats.fallbacks).toEqual([{ step: 'snap', reason: 'collapsed' }])
  })

  it('keeps a degenerate contour of two points, or of three in a line', () => {
    const two: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]
    const flat: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ]
    for (const contour of [two, flat]) {
      const { polygon, stats } = run([contour], snap(10))
      expect(contoursOf(polygon)).toEqual([contour])
      expect(stats.fallbacks).toHaveLength(1)
      expect(stats.fallbacks[0].step).toBe('snap')
    }
  })

  it('keeps the winding of every contour, a counter included', () => {
    const outer = rect(0, 0, 400, 400)
    const hole = rect(103, 97, 297, 302).reverse()
    const { polygon } = run([outer, hole], snap(10))
    const [a, b] = contoursOf(polygon)
    expect(signedArea2(a)).toBeGreaterThan(0)
    expect(signedArea2(b)).toBeLessThan(0)
    expect(polygon.contours.map((c) => c.clockwise)).toEqual([false, true])
  })

  it('keeps a contour that would snap into touching its neighbour', () => {
    const left = rect(0, 0, 106, 100)
    const right = rect(107, 3, 200, 97)
    const { polygon, stats } = run([left, right], snap(10))
    expect(outlineCrossings(contoursOf(polygon)).cross).toBe(0)
    expect(stats.fallbacks.some((f) => f.reason === 'contours')).toBe(true)
  })
})

describe('applyConstraints: angle lock', () => {
  it('turns every edge to a multiple of each allowed step', () => {
    for (const step of ANGLE_STEPS) {
      const { polygon, stats } = run([HEXAGON], lock(step))
      expect(stats.angleApplied).toBe(true)
      expect(stats.fallbacks, `step ${step}`).toEqual([])
      for (const angle of edgeAngles(polygon.contours[0].points))
        expect(offStep(angle, step), `step ${step}`).toBeLessThan(1e-6)
    }
  })

  it('uses 45° for a step that is not allowed', () => {
    const expected = contoursOf(run([HEXAGON], lock(45)).polygon)
    for (const step of [0, 7, 60, -45, NaN])
      expect(contoursOf(run([HEXAGON], lock(step)).polygon), `step ${step}`).toEqual(expected)
  })

  it('keeps an outline whose edges are already on allowed directions', () => {
    const square = rect(0, 0, 300, 200)
    const { polygon, stats } = run([square], lock(90))
    const [out] = contoursOf(polygon)
    expect(out).toHaveLength(4)
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(square[i].x, 6)
      expect(p.y).toBeCloseTo(square[i].y, 6)
    })
    expect(stats.angleMaxShift).toBeLessThan(1e-6)
  })

  it('locks edges that sit exactly on a tie between two directions', () => {
    // A square turned by 22.5°: every edge is a tie at 45° and rounds counter-clockwise.
    const square: Point[] = []
    let p = { x: 500, y: 100 }
    for (const degrees of [22.5, 112.5, 202.5, 292.5]) {
      square.push(p)
      const r = (degrees * Math.PI) / 180
      p = { x: p.x + 300 * Math.cos(r), y: p.y + 300 * Math.sin(r) }
    }
    const { polygon, stats } = run([square], lock(45))
    expect(stats.fallbacks).toEqual([])
    for (const angle of edgeAngles(polygon.contours[0].points)) expect(offStep(angle, 45)).toBeLessThan(1e-6)
  })

  it('keeps a degenerate contour of two points, or of three in a line', () => {
    const two: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 37 },
    ]
    const flat: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 37 },
      { x: 200, y: 74 },
    ]
    for (const contour of [two, flat]) {
      const { polygon, stats } = run([contour], lock(90))
      expect(contoursOf(polygon)).toEqual([contour])
      expect(stats.fallbacks).toHaveLength(1)
      expect(stats.fallbacks[0].step).toBe('angle')
    }
  })

  it('gives a long diagonal fine stair steps at 90° instead of moving it', () => {
    // A thin slanted bar: locking it would move its ends too far, so it becomes a staircase.
    const bar: Point[] = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 560, y: 700 },
      { x: 500, y: 700 },
    ]
    const { polygon, stats } = run([bar], lock(90))
    const [out] = contoursOf(polygon)
    expect(stats.fallbacks).toEqual([])
    expect(out.length).toBeGreaterThan(bar.length * 4)
    for (const angle of edgeAngles(out)) expect(offStep(angle, 90)).toBeLessThan(1e-6)
    expect(outlineCrossings([out]).cross).toBe(0)
    expect(Math.sign(signedArea2(out))).toBe(Math.sign(signedArea2(bar)))
  })

  it('runs after snapping when both are on', () => {
    const { polygon, stats } = run([HEXAGON], { snap: true, size: 10, angleLock: true, angleStep: 90 })
    expect(stats.snapApplied && stats.angleApplied).toBe(true)
    expect(stats.fallbacks).toEqual([])
    for (const angle of edgeAngles(polygon.contours[0].points)) expect(offStep(angle, 90)).toBeLessThan(1e-6)
  })
})
