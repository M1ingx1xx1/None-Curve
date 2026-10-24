// Hit testing mid-glide without the frame's whole scene (src/render/hitTest.ts, hitFrame): only the gliding glyphs near
// the point are made on the CPU, and the targets are the ones hitScene finds on the evaluated scene, point for point.

import { describe, expect, it } from 'vitest'
import { hitFrame, hitScene, type HitOptions } from '../../src/render/hitTest'
import type { GlideFrame, GlyphMorph } from '../../src/render/types'
import { morphAt, planMorph, type MorphPlan } from '../../src/specimen/morph'
import type { SpecimenScene } from '../../src/specimen/scene'
import { planCases } from '../helpers/planCases'
import { sceneOf, squareSource } from './fixtures'

const options = (patch: Partial<HitOptions> = {}): HitOptions => ({
  outline: 'flattened',
  fill: true,
  showSkeleton: false,
  showVertices: false,
  showMarkers: false,
  markerRadius: 14,
  u: 4,
  ascender: 900,
  descender: -250,
  freeMove: false,
  offsetX: 0,
  offsetY: 0,
  source: (index) => squareSource(index),
  ...patch,
})

/** The layout with every morph made, as Glide's frame.scene() does. */
function evaluated(layout: SpecimenScene, morphs: (GlyphMorph | null)[]): SpecimenScene {
  let k = 0
  return {
    ...layout,
    lines: layout.lines.map((line) => ({
      ...line,
      glyphs: line.glyphs.map((g) => {
        const morph = morphs[k++]
        return morph ? { ...g, polygon: morphAt(morph.plan, morph.p) } : g
      }),
    })),
  }
}

describe('hit testing a frame of Glide', async () => {
  const cases = await planCases()
  const plans = new Map<string, MorphPlan>()
  for (const c of cases) {
    const plan = planMorph(c.from, c.to)
    if (plan) plans.set(c.name, plan)
  }
  const pick = ['burst H/a/g 1', 'whorl one ring', 'mesh on', 'grow and shrink'].map((name) => plans.get(name)!)

  it('finds what the evaluated scene gives, without evaluating it', () => {
    expect(pick.every(Boolean)).toBe(true)
    // Narrow advances, so most hits come from the outlines, the click outlines and the vertices, not the boxes.
    const glyphs = pick.flatMap((plan, i) => [
      { index: 10 + i, x: i * 900, y: 0, advance: 40, polygon: plan.to },
      { index: 20 + i, x: i * 900 + 450, y: 1200, advance: 40, polygon: plan.to },
    ])
    for (const slant of [0, 12]) {
      const layout = sceneOf([glyphs.filter((g) => g.y === 0), glyphs.filter((g) => g.y === 1200)], slant)
      const morphs: (GlyphMorph | null)[] = [
        ...pick.map((plan, i) => ({ plan, p: 0.2 + 0.15 * i })),
        null,
        null,
        { plan: pick[0], p: 0.7 },
        null,
      ]
      const scene = evaluated(layout, morphs)
      const frame: GlideFrame = {
        target: layout,
        layout,
        morphs,
        scene: () => {
          throw new Error('scene() evaluates every morph')
        },
      }
      for (const o of [
        options(),
        options({ fill: false }),
        options({ showVertices: true, showMarkers: true }),
        options({ outline: 'compare', offsetX: 30 }),
      ]) {
        let hits = 0
        for (let sx = -1200; sx <= 4200; sx += 97) {
          for (let sy = -1500; sy <= 1700; sy += 89) {
            const want = hitScene(scene, sx, sy, o)
            expect(hitFrame(frame, sx, sy, o)).toEqual(want)
            if (want) hits++
          }
        }
        expect(hits).toBeGreaterThan(30)
      }
    }
  })

  it('tests the scene as it is when nothing glides', () => {
    const layout = sceneOf([[{ index: 1, polygon: pick[0].to }]])
    const frame: GlideFrame = { target: layout, layout, morphs: null, scene: () => layout }
    for (const [sx, sy] of [
      [300, -200],
      [5000, 0],
    ] as const) {
      expect(hitFrame(frame, sx, sy, options())).toEqual(hitScene(layout, sx, sy, options()))
    }
  })
})
