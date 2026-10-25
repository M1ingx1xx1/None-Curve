// Glide between a letter drawn as overlapping pieces and an outline with real holes (NOCUR-93). Many fonts (Roboto here,
// Space Grotesk in the app) draw A, R or D as pieces whose counter is a gap between them, not a hole; Burst merges the
// letter, so its counters are real holes. Paired as they were, those holes grew from their centres while the pieces
// sank, and the counter filled on the way. Paired as the outlines of what they fill, the counter stays open.

import { describe, expect, it } from 'vitest'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { Point, PolygonGlyph } from '../../src/geometry/types'
import { morphAt, planFromData, planMorph } from '../../src/specimen/morph'
import { loadFixture, sampleGlyphs } from '../helpers/fonts'
import { contoursOf, outlineCrossings, polygonOf, rect, winding } from '../helpers/outline'
import { GEOMETRY, on, paramsWith } from '../helpers/params'

const PROGRESS = [0.1, 0.25, 0.5, 0.75, 0.9]

/** The share of `ground` that `glyph` inks. */
const inked = (glyph: PolygonGlyph, ground: Point[]) =>
  ground.filter((p) => winding(contoursOf(glyph), p) !== 0).length / ground.length

/** The distance from `p` to the nearest side of `glyph`. */
function distanceToSides(glyph: PolygonGlyph, p: Point): number {
  let best = Infinity
  for (const { points } of glyph.contours) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l = dx * dx + dy * dy
      const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy))
    }
  }
  return best
}

/** Points on a grid over `from`'s box that are blank in both outlines and at least `margin` from either's sides. */
function blankGround(from: PolygonGlyph, to: PolygonGlyph, margin: number): Point[] {
  const all = from.contours.flatMap((c) => c.points)
  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const ground: Point[] = []
  const steps = 48
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p = { x: minX + ((maxX - minX) * i) / steps, y: minY + ((maxY - minY) * j) / steps }
      if (winding(contoursOf(from), p) !== 0 || winding(contoursOf(to), p) !== 0) continue
      if (distanceToSides(from, p) < margin || distanceToSides(to, p) < margin) continue
      ground.push(p)
    }
  }
  return ground
}

describe('Glide from overlapping pieces to an outline with holes', () => {
  // A square frame drawn as four overlapping bars, its counter the gap between them...
  const pieces = polygonOf([
    rect(0, 0, 300, 1000),
    rect(700, 0, 1000, 1000),
    rect(0, 0, 1000, 300),
    rect(0, 700, 1000, 1000),
  ])
  // ...and the frame as one outline with a hole, a little bolder.
  const merged = polygonOf([rect(-20, -20, 1020, 1020), rect(320, 680, 680, 320)])
  const counter: Point[] = []
  for (let x = 340; x <= 660; x += 40) for (let y = 340; y <= 660; y += 40) counter.push({ x, y })

  it('keeps the counter open all the way, both ways', () => {
    expect(outlineCrossings(contoursOf(pieces)).cross).toBeGreaterThan(0)
    for (const [from, to] of [
      [pieces, merged],
      [merged, pieces],
    ]) {
      const plan = planMorph(from, to)!
      expect(plan).not.toBeNull()
      for (const p of PROGRESS) expect(inked(morphAt(plan, p), counter), `at ${p}`).toBe(0)
    }
  })

  it('still starts and ends on the glyphs themselves, and runs the same from its data', () => {
    const plan = planMorph(pieces, merged)!
    expect(morphAt(plan, 0)).toBe(pieces)
    expect(morphAt(plan, 1)).toBe(merged)
    const fresh = planFromData(plan.data!, pieces, merged)
    for (const p of PROGRESS) expect(morphAt(fresh, p).contours).toEqual(morphAt(plan, p).contours)
  })
})

describe('Glide from a font drawn in pieces to Burst', async () => {
  const font = await loadFixture('Roboto')
  const burst = (canvasReach: number) =>
    paramsWith(GEOMETRY.plain, on('thorn', { burst: true, spikes: 40, dent: 0.8, canvasReach }))

  it('keeps ground that is blank at both ends blank on the way, both ways', () => {
    for (const { char, index } of sampleGlyphs(font, 'ARD')) {
      const source = font.getGlyph(index)
      const plain = deriveGeometry(source, burst(0)).polygon
      const spiked = deriveGeometry(source, burst(0.05)).polygon
      // The fixture draws these letters in crossing pieces, and Burst merges them.
      expect(outlineCrossings(contoursOf(plain)).cross, char).toBeGreaterThan(0)
      expect(outlineCrossings(contoursOf(spiked)).cross, char).toBe(0)
      const ground = blankGround(plain, spiked, 0.02 * plain.metrics.unitsPerEm)
      expect(ground.length, char).toBeGreaterThan(50)
      for (const [from, to] of [
        [plain, spiked],
        [spiked, plain],
      ]) {
        const plan = planMorph(from, to)!
        for (const p of PROGRESS) expect(inked(morphAt(plan, p), ground), `${char} at ${p}`).toBeLessThan(0.02)
      }
    }
  })
})
