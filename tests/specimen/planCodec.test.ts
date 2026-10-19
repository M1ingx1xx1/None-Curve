// Glide plans as data (NOCUR-82): planMorph builds every plan from its data (planData.ts), and a plan sent as data
// (planCodec.ts) draws exactly what the plan it came from draws; in-between glyphs sent by value glide on the same.

import { describe, expect, it } from 'vitest'
import { morphAt, planMorph, settleInBetween, sideTablesOf } from '../../src/specimen/morph'
import { decodeGlyph, decodePlan, encodeGlyph, encodePlan, encodeSettled } from '../../src/specimen/planCodec'
import { planCases, planHash, SAMPLES } from '../helpers/planCases'

/**
 * What each case's plan drew before plans were built from data (planHash of the closures planMorph made then): plans
 * built from data must draw the very same anchors, bit for bit.
 */
const BEFORE: Record<string, string> = {
  'burst H/a/g 0': 'straight:516:cb7c7a92',
  'burst H/a/g 1': 'straight:500:87fd5c3e',
  'burst H/a/g 6': 'straight:491:9c6a8688',
  'whorl one ring': 'whorl:416:9d7fa74d',
  'whorl rings': 'whorl:228:89c2122a',
  'whorl two rings': 'whorl:279:9100c2ac',
  'whorl comes on': 'whorl:332:90b10d07',
  'mesh on': 'whorl-mesh:90:35c89339',
  'mesh amount': 'whorl-mesh:90:507700de',
  'mesh off': 'whorl-mesh:144:9d4a2e65',
  'dissolve STIX': 'straight:1749:a82a8761',
  'whorl STIX': 'whorl:265:9966bd99',
  'burst goes on': 'straight:585:80ce812e',
  'mesh goes on': 'whorl-mesh:90:e9449a17',
  'grow and shrink': 'straight:12:3c6d7d38',
  'still and moved': 'straight:8:aa9a8255',
}

describe('plans as data', async () => {
  const cases = await planCases()

  it('draws what plans drew before they were built from data, bit for bit', () => {
    const now = Object.fromEntries(cases.map((c) => [c.name, planHash(planMorph(c.from, c.to))]))
    expect(now).toEqual(BEFORE)
  })

  it('covers every kind of track: still, straight, growing, Whorl on one ring and on two, and the mesh', () => {
    const kinds = new Set<string>()
    for (const c of cases) {
      const data = planMorph(c.from, c.to)!.data!
      if (data.mesh) kinds.add('mesh')
      for (const t of data.tracks) {
        if (t.kind === 'whorl') kinds.add(t.mx ? 'whorl two rings' : 'whorl')
        else if (t.kind === 'straight' && t.sx.length > 1 && t.sx.every((x) => x === t.sx[0])) kinds.add('grows')
        else if (t.kind === 'straight' && t.tx.length > 1 && t.tx.every((x) => x === t.tx[0])) kinds.add('shrinks')
        else kinds.add(t.kind)
      }
    }
    expect([...kinds].sort()).toEqual(['grows', 'mesh', 'shrinks', 'still', 'straight', 'whorl', 'whorl two rings'])
  })

  it('a plan sent as data (structured clone) and decoded draws the same anchors, motion, kept anchors and mesh pose', () => {
    for (const c of cases) {
      const plan = planMorph(c.from, c.to)!
      const { data, transfer } = encodePlan(plan)
      expect(transfer.length).toBeGreaterThan(0)
      const decoded = decodePlan(structuredClone(data), plan.from, plan.to)
      expect(planHash(decoded), c.name).toBe(planHash(plan))
      for (const p of SAMPLES) {
        const a = morphAt(plan, p)
        const b = morphAt(decoded, p)
        expect(b.motion).toEqual(a.motion)
        const ta = sideTablesOf(a)
        const tb = sideTablesOf(b)
        expect(tb.kept).toEqual(ta.kept)
        if (ta.pose) {
          const { prepared: _a, ...poseA } = ta.pose
          const { prepared: _b, ...poseB } = tb.pose!
          expect(poseB).toEqual(poseA)
          expect(tb.pose!.prepared.mesh.key).toBe(ta.pose.prepared.mesh.key)
        } else expect(tb.pose).toBeNull()
      }
    }
  })

  it('a plan from a settled shape carries it, and runs from it on any glyph alike', () => {
    const c = cases.find((x) => x.name === 'burst goes on')!
    const between = morphAt(planMorph(c.from, c.to)!, 0.3)
    const settled = settleInBetween(between, c.from)
    expect(settled).not.toBe(between)
    const plan = planMorph(settled, c.from)!
    const data = { ...structuredClone(plan.data!), settled: encodeSettled(settled) }
    const decoded = decodePlan(data, between, c.from)
    expect(decoded.from.contours).toEqual(settled.contours)
    expect(planHash(decoded)).toBe(planHash(plan))
  })

  it('an in-between glyph sent by value with its side tables glides on as it would have', () => {
    for (const name of ['burst goes on', 'mesh goes on']) {
      const c = cases.find((x) => x.name === name)!
      // The case's `from` is settled already; glide on from a fresh in-between of its plan.
      const between = morphAt(planMorph(c.from, c.to)!, 0.3)
      const received = decodeGlyph(structuredClone(encodeGlyph(between)))
      expect(received).not.toBe(between)
      const direct = planMorph(settleInBetween(between, c.from), c.from)
      const viaCopy = planMorph(settleInBetween(received, c.from), c.from)
      expect(planHash(viaCopy), name).toBe(planHash(direct))
      if (name === 'mesh goes on') expect(direct!.trajectory).toBe('whorl-mesh')
    }
  })
})
