// What morphAt allocates per frame (NOCUR-89): the kept flags are made once per plan and shared by every in-between
// glyph, the same progress twice gives the same glyph back, and none of it changes what is drawn.

import { describe, expect, it } from 'vitest'
import { morphAt, planFromData, planMorph, sideTablesOf } from '../../src/specimen/morph'
import { planCases } from '../helpers/planCases'

describe('morphAt', async () => {
  const cases = await planCases()
  const plans = cases.flatMap((c) => {
    const plan = planMorph(c.from, c.to)
    return plan ? [{ name: c.name, plan }] : []
  })

  it('shares one set of kept flags per plan, all ones for the mesh’s contours', () => {
    expect(plans.some(({ plan }) => plan.mesh)).toBe(true)
    for (const { plan } of plans) {
      const a = sideTablesOf(morphAt(plan, 0.3)).kept!
      const b = sideTablesOf(morphAt(plan, 0.6)).kept!
      expect(b).toBe(a)
      const glyph = morphAt(plan, 0.6)
      expect(a.length).toBe(glyph.contours.length)
      a.forEach((flags, c) => expect(flags.length).toBe(glyph.contours[c].points.length))
      const meshContours = plan.mesh?.contours.length ?? 0
      for (let c = 0; c < meshContours; c++) expect(a[c].every((f) => f === 1)).toBe(true)
      for (let t = 0; t < plan.tracks.length; t++) expect(a[meshContours + t]).toBe(plan.tracks[t].kept)
    }
  })

  it('gives the same glyph back for the same progress, and draws what a fresh plan draws', () => {
    for (const { plan } of plans) {
      const once = morphAt(plan, 0.42)
      expect(morphAt(plan, 0.42)).toBe(once)
      const other = morphAt(plan, 0.43)
      expect(other).not.toBe(once)
      const fresh = planFromData(plan.data!, plan.from, plan.to)
      expect(morphAt(plan, 0.42).contours).toEqual(morphAt(fresh, 0.42).contours)
      expect(other.contours).toEqual(morphAt(fresh, 0.43).contours)
      // The scratch the plan shares between frames did not leak into the glyph kept from before.
      expect(once.contours).toEqual(morphAt(fresh, 0.42).contours)
    }
  })

  it('works out a mesh glide’s pose only when asked, as the mesh gives it', () => {
    for (const { plan } of plans) {
      if (!plan.mesh) continue
      const glyph = morphAt(plan, 0.55)
      const pose = sideTablesOf(glyph).pose
      expect(pose).toEqual(plan.mesh.pose(0.55))
      expect(sideTablesOf(glyph).pose).toBe(pose)
    }
  })
})
