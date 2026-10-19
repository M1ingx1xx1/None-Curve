// The WebGL renderer's morph evaluation against the CPU's on real Glide plans (NOCUR-82): planMorph's own data from the
// codec cases (Roboto and STIX: straight, growing, still, Whorl on one ring and on two, the mesh, glides going on from an
// in-between shape), uploaded as the Float32 rows the GPU gets (gpuPlans.ts) and evaluated by the shaders' JS mirror
// (gpuReference.ts), must land within 1e-3 font units of morphAt at every sampled progress.

import { describe, expect, it } from 'vitest'
import { anchorRows, pathRows, planContours } from '../../src/render/gpuPlans'
import { evaluateAnchors, evaluatePaths, planUniforms } from '../../src/render/gpuReference'
import { morphAt, planMorph, type MorphPlan } from '../../src/specimen/morph'
import { planCases } from '../helpers/planCases'

const SAMPLES = [0.001, 0.1, 0.25, 0.37, 0.4999, 0.5, 0.5001, 0.63, 0.9, 0.999]

/** The mirror's positions for a plan at p (x, y pairs in the GPU's anchor order: mesh contours, then tracks). */
function gpuPositions(plan: MorphPlan, p: number): Float64Array {
  const data = plan.data!
  const rows = anchorRows(data, plan.to)
  const count = planContours(data, plan.to).reduce((n, c) => n + c.n, 0)
  const u = planUniforms(data)
  const prow = pathRows(data)
  const pathPos = prow && data.mesh ? evaluatePaths(prow, data.mesh.a0.length, p, u) : null
  return evaluateAnchors(rows, count, p, u, pathPos)
}

/** morphAt's anchors at p in the same order. */
function cpuPositions(plan: MorphPlan, p: number): Float64Array {
  return Float64Array.from(morphAt(plan, p).contours.flatMap((c) => c.points.flatMap((q) => [q.x, q.y])))
}

describe('the GPU evaluation on real plans', async () => {
  const cases = await planCases()

  for (const c of cases) {
    it(`matches morphAt for ${c.name}`, () => {
      const plan = planMorph(c.from, c.to)
      expect(plan?.data).toBeTruthy()
      for (const p of SAMPLES) {
        const gpu = gpuPositions(plan!, p)
        const cpu = cpuPositions(plan!, p)
        expect(gpu.length).toBe(cpu.length)
        let worst = 0
        for (let i = 0; i < cpu.length; i++) worst = Math.max(worst, Math.abs(gpu[i] - cpu[i]))
        expect(worst, `${c.name} p ${p}`).toBeLessThan(1e-3)
      }
    })
  }
})
