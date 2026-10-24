// The small helpers every geometry step shares (src/geometry/primitives.ts).

import { describe, expect, it } from 'vitest'
import { clamp, distanceToSegment, lerp, signedArea } from '../../src/geometry/primitives'
import type { Point } from '../../src/geometry/types'
import { rect, seededRandom, signedArea2 } from '../helpers/outline'

describe('clamp', () => {
  it('keeps a value in range and limits one outside it', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(12, 0, 10)).toBe(10)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('gives the bound when min equals max', () => {
    expect(clamp(-1, 4, 4)).toBe(4)
    expect(clamp(9, 4, 4)).toBe(4)
  })

  it('limits infinities to the bounds', () => {
    expect(clamp(Infinity, 0, 1)).toBe(1)
    expect(clamp(-Infinity, 0, 1)).toBe(0)
  })
})

describe('lerp', () => {
  const a = { x: 1, y: 2 }
  const b = { x: 5, y: -6 }

  it('gives the end points at t = 0 and t = 1, and the middle at 0.5', () => {
    expect(lerp(a, b, 0)).toEqual(a)
    expect(lerp(a, b, 1)).toEqual(b)
    expect(lerp(a, b, 0.5)).toEqual({ x: 3, y: -2 })
  })

  it('extends past the ends outside 0..1', () => {
    expect(lerp(a, b, 2)).toEqual({ x: 9, y: -14 })
    expect(lerp(a, b, -1)).toEqual({ x: -3, y: 10 })
  })

  it('returns a new point', () => {
    expect(lerp(a, b, 0)).not.toBe(a)
  })
})

describe('distanceToSegment', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 10, y: 0 }

  it('measures to the foot of the perpendicular inside the segment', () => {
    expect(distanceToSegment({ x: 4, y: 3 }, a, b)).toBe(3)
    expect(distanceToSegment({ x: 4, y: -3 }, a, b)).toBe(3)
  })

  it('measures to the nearer end beyond either end', () => {
    expect(distanceToSegment({ x: -3, y: 4 }, a, b)).toBe(5)
    expect(distanceToSegment({ x: 13, y: 4 }, a, b)).toBe(5)
  })

  it('is 0 on the segment, ends included', () => {
    expect(distanceToSegment({ x: 7, y: 0 }, a, b)).toBe(0)
    expect(distanceToSegment(a, a, b)).toBe(0)
    expect(distanceToSegment(b, a, b)).toBe(0)
  })

  it('treats a zero-length segment as its point, without dividing by zero', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5)
    expect(distanceToSegment(a, a, a)).toBe(0)
  })

  it('does not depend on the direction of the segment', () => {
    const random = seededRandom(7)
    const pick = (): Point => ({ x: random() * 200 - 100, y: random() * 200 - 100 })
    for (let i = 0; i < 200; i++) {
      const [p, q, r] = [pick(), pick(), pick()]
      expect(distanceToSegment(p, q, r)).toBeCloseTo(distanceToSegment(p, r, q), 9)
    }
  })

  it('is never more than the distance to either end', () => {
    const random = seededRandom(11)
    const pick = (): Point => ({ x: random() * 200 - 100, y: random() * 200 - 100 })
    for (let i = 0; i < 200; i++) {
      const [p, q, r] = [pick(), pick(), pick()]
      const d = distanceToSegment(p, q, r)
      expect(d).toBeLessThanOrEqual(Math.hypot(p.x - q.x, p.y - q.y) + 1e-9)
      expect(d).toBeLessThanOrEqual(Math.hypot(p.x - r.x, p.y - r.y) + 1e-9)
    }
  })
})

describe('signedArea', () => {
  it('is positive counter-clockwise and negative clockwise (y up)', () => {
    const square = rect(0, 0, 10, 20)
    expect(signedArea(square)).toBe(200)
    expect(signedArea(square.slice().reverse())).toBe(-200)
  })

  it('is 0 for fewer than three points and for a flat ring', () => {
    expect(signedArea([])).toBe(0)
    expect(signedArea([{ x: 1, y: 1 }])).toBe(0)
    expect(
      signedArea([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe(0)
    expect(
      signedArea([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ]),
    ).toBe(0)
  })

  it('does not change when the ring starts at another point', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 8, y: 1 },
      { x: 6, y: 7 },
      { x: -2, y: 5 },
    ]
    const rotated = [...ring.slice(2), ...ring.slice(0, 2)]
    expect(signedArea(rotated)).toBe(signedArea(ring))
  })

  it('matches the test helper (twice the area) and the copy flatten still exports', () => {
    const random = seededRandom(3)
    const ring = Array.from({ length: 12 }, () => ({ x: random() * 100, y: random() * 100 }))
    expect(signedArea(ring)).toBeCloseTo(signedArea2(ring) / 2, 9)
  })
})
