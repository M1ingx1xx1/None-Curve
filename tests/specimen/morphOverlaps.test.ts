// Glide into Burst and back keeps blank ground blank (NOCUR-93). Many fonts (Roboto here, Space Grotesk in the app) draw
// A, R or e as overlapping pieces whose counter is a gap between them, not a hole, and Burst's spikes cross one another;
// the merged outline turns both into holes, which had no partner, grew from their centres and filled the counter or the
// pocket between crossing spikes on the way. Glide now pairs the outline from before that merge (glideOutline).

import { describe, expect, it } from 'vitest'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { Point, PolygonGlyph } from '../../src/geometry/types'
import { morphAt, planFromData, planMorph } from '../../src/specimen/morph'
import { loadFixture, sampleGlyphs } from '../helpers/fonts'
import { contoursOf, winding } from '../helpers/outline'
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

describe('Glide into Burst and back', async () => {
  const font = await loadFixture('Roboto')
  const burst = (canvasReach: number) =>
    paramsWith(GEOMETRY.plain, on('thorn', { burst: true, spikes: 40, dent: 0.8, canvasReach }))
  const glyphs = sampleGlyphs(font, 'AReaD').map(({ char, index }) => {
    const source = font.getGlyph(index)
    return {
      char,
      plain: deriveGeometry(source, burst(0)).polygon,
      spiked: (r: number) => deriveGeometry(source, burst(r)).polygon,
    }
  })

  it('keeps the outline from before the merge, which fills the same', () => {
    for (const { char, spiked } of glyphs) {
      const glyph = spiked(0.15)
      expect(glyph.glideOutline, char).toBeDefined()
      const unmerged = glyph.glideOutline!.map((c) => c.points)
      const ground = blankGround(glyph, glyph, 0.02 * glyph.metrics.unitsPerEm)
      const ink = ground.filter((p) => winding(unmerged, p) !== 0).length
      expect(ink, char).toBe(0)
    }
  })

  it('keeps ground that is blank at both ends blank on the way, both ways', () => {
    for (const { char, plain, spiked } of glyphs) {
      for (const reach of [0.05, 0.15]) {
        const to = spiked(reach)
        const ground = blankGround(plain, to, 0.02 * plain.metrics.unitsPerEm)
        expect(ground.length, char).toBeGreaterThan(50)
        for (const [a, b] of [
          [plain, to],
          [to, plain],
        ]) {
          const plan = planMorph(a, b)!
          for (const p of PROGRESS)
            expect(inked(morphAt(plan, p), ground), `${char} reach ${reach} at ${p}`).toBeLessThan(0.02)
        }
      }
    }
  })

  it('still starts and ends on the glyphs themselves, runs the same from its data, and goes on from its own anchors', () => {
    for (const { plain, spiked } of glyphs) {
      const to = spiked(0.15)
      const plan = planMorph(plain, to)!
      expect(morphAt(plan, 0)).toBe(plain)
      expect(morphAt(plan, 1)).toBe(to)
      const fresh = planFromData(plan.data!, plain, to)
      for (const p of PROGRESS) expect(morphAt(fresh, p).contours).toEqual(morphAt(plan, p).contours)
      expect(morphAt(plan, 0.5).glideOutline).toBeUndefined()
    }
  })
})
