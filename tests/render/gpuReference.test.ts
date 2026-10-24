// The WebGL renderer's morph evaluation, as its JS mirror (src/render/gpuReference.ts) computes it from the very
// Float32 rows uploaded to the GPU (gpuPlans.ts), against the CPU's: morphAt itself for straight and still tracks,
// whorlTrajectory's own path for Whorl's sweep (one ring and two), and whorlGlide.ts's mesh formulas. Within 1e-4 font
// units (Float32 rows). And still faceted on the GPU: every path is piecewise linear in p.

import { describe, expect, it } from 'vitest'
import { anchorRows, pathRows, planContours } from '../../src/render/gpuPlans'
import { evaluateAnchors, evaluatePaths, planUniforms } from '../../src/render/gpuReference'
import type { PlanData } from '../../src/specimen/planData'
import { allFixtures, whorlFixture, type PlanFixture } from './plans'

/** The mirror's positions for a fixture at p, from the uploaded rows. */
function gpuPositions(fixture: PlanFixture, p: number): Float64Array {
  const data: PlanData = fixture.data
  const rows = anchorRows(data, fixture.plan.to)
  const count = planContours(data, fixture.plan.to).reduce((n, c) => n + c.n, 0)
  const u = planUniforms(data)
  const prow = pathRows(data)
  const pathPos = prow && data.mesh ? evaluatePaths(prow, data.mesh.a0.length, p, u) : null
  return evaluateAnchors(rows, count, p, u, pathPos)
}

const SAMPLES = [0.001, 0.1, 0.25, 0.37, 0.4999, 0.5, 0.5001, 0.63, 0.9, 0.999]

describe('the GPU evaluation (its JS mirror)', () => {
  for (const fixture of allFixtures()) {
    it(`matches the CPU for ${fixture.name}`, () => {
      for (const p of SAMPLES) {
        const gpu = gpuPositions(fixture, p)
        const cpu = fixture.cpu(p)
        expect(gpu.length).toBe(cpu.length)
        for (let i = 0; i < cpu.length; i++)
          expect(Math.abs(gpu[i] - cpu[i]), `${fixture.name} p ${p} [${i}]`).toBeLessThan(1e-4)
      }
    })
  }

  it('keeps Whorl faceted: positions are piecewise linear in p, bending only at ring corners', () => {
    for (const two of [false, true]) {
      const fixture = whorlFixture(two)
      const steps = 2000
      const at = (k: number) => gpuPositions(fixture, k / steps)
      const anchors = fixture.data.points
      const bends = new Array(anchors).fill(0)
      let a = at(1)
      let m = at(2)
      for (let k = 3; k < steps; k++) {
        const b = at(k)
        for (let i = 0; i < anchors; i++) {
          // The second difference: zero on a straight piece at an even pace.
          const dx = m[2 * i] - (a[2 * i] + b[2 * i]) / 2
          const dy = m[2 * i + 1] - (a[2 * i + 1] + b[2 * i + 1]) / 2
          if (Math.hypot(dx, dy) > 1e-6) bends[i]++
        }
        a = m
        m = b
      }
      // Each anchor turns at most a few ring corners (each bends at most two sample triples), plus the halfway seam.
      for (const n of bends) expect(n).toBeLessThanOrEqual(2 * 6 + 2)
      expect(bends.some((n) => n > 0)).toBe(true)
    }
  })
})
