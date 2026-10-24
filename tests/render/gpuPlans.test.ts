// The WebGL renderer's pure plan builders (src/render/gpuPlans.ts): the anchor rows in morphAt's anchor order, triangle
// fans that cover each contour, side instances that wrap within their contour, plan bounds that hold every in-between
// position (so culling never drops a glyph mid-Glide), the GPU-memory LRU (idle entries first, then oldest by bytes), and
// the plan slots a frame hands out (a progress evaluated once, and not again in a frame drawn again at it).

import { describe, expect, it } from 'vitest'
import { ANCHOR_STRIDE, anchorRows, claimSlot, fanIndices, GPU_LIMITS, GpuLru, KIND, PATH_STRIDE, pathRows, planBounds, planContours, segmentIndices, slotBytes, texRows } from '../../src/render/gpuPlans'
import { allFixtures, meshFixture, straightFixture, whorlFixture } from './plans'

describe('anchor rows', () => {
  it('follow morphAt: mesh anchors, then one block per track, kinds tagged', () => {
    const s = straightFixture()
    const rows = anchorRows(s.data, s.plan.to)
    expect(rows.length).toBe(7 * ANCHOR_STRIDE)
    expect([0, 1, 2, 3].map((i) => rows[i * ANCHOR_STRIDE])).toEqual(new Array(4).fill(KIND.straight))
    expect([4, 5, 6].map((i) => rows[i * ANCHOR_STRIDE])).toEqual(new Array(3).fill(KIND.still))
    expect([rows[1], rows[2], rows[3], rows[4]]).toEqual([0, 0, 100, -40])
    expect([rows[4 * ANCHOR_STRIDE + 1], rows[4 * ANCHOR_STRIDE + 2]]).toEqual([50, 50])
    expect(planContours(s.data, s.plan.to)).toEqual([
      { start: 0, n: 4 },
      { start: 4, n: 3 },
    ])

    const one = whorlFixture(false)
    expect(anchorRows(one.data, one.plan.to)[0]).toBe(KIND.whorl)
    const two = whorlFixture(true)
    expect(anchorRows(two.data, two.plan.to)[0]).toBe(KIND.whorlTwo)

    const m = meshFixture()
    const mesh = anchorRows(m.data, m.plan.to)
    expect([0, 1, 2, 3].map((i) => mesh[i * ANCHOR_STRIDE])).toEqual([KIND.mesh, KIND.mesh, KIND.mesh, KIND.meshOuter])
    expect(mesh[3 * ANCHOR_STRIDE + 1]).toBe(m.data.mesh!.corners)
    expect(pathRows(m.data)!.length).toBe(m.data.mesh!.a0.length * PATH_STRIDE)
    expect(pathRows(s.data)).toBeNull()
  })
})

describe('index buffers', () => {
  const contours = [
    { start: 0, n: 4 },
    { start: 4, n: 2 },
    { start: 6, n: 5 },
    { start: 11, n: 1 },
  ]

  it('fan every contour of 3 or more anchors from its first anchor', () => {
    const fan = fanIndices(contours, 100)
    expect(fan.length).toBe(3 * (2 + 3))
    expect([...fan.slice(0, 6)]).toEqual([100, 101, 102, 100, 102, 103])
    expect([...fan.slice(6, 9)]).toEqual([106, 107, 108])
    // Every side of a contour is an edge of some fan triangle, so the stencil count is the winding number.
    for (const { start, n } of contours.filter((c) => c.n >= 3)) {
      for (let i = 0; i < n; i++) {
        const a = 100 + start + i
        const b = 100 + start + ((i + 1) % n)
        let found = false
        for (let t = 0; t < fan.length; t += 3) {
          const tri = [fan[t], fan[t + 1], fan[t + 2]]
          if (tri.includes(a) && tri.includes(b)) found = true
        }
        expect(found, `side ${a}-${b}`).toBe(true)
      }
    }
  })

  it('give each side (prev, a, b, next), wrapping within its contour', () => {
    const seg = segmentIndices(contours)
    expect(seg.length).toBe(4 * (4 + 2 + 5))
    expect([...seg.slice(0, 4)]).toEqual([3, 0, 1, 2])
    expect([...seg.slice(12, 16)]).toEqual([2, 3, 0, 1])
    expect([...seg.slice(16, 20)]).toEqual([5, 4, 5, 4])
    for (let k = 24; k < seg.length; k++) {
      expect(seg[k]).toBeGreaterThanOrEqual(6)
      expect(seg[k]).toBeLessThan(11)
    }
  })
})

describe('plan bounds', () => {
  it('hold every in-between position', () => {
    for (const fixture of allFixtures()) {
      const [x0, y0, x1, y1] = planBounds(fixture.plan, fixture.data)
      for (let k = 0; k <= 64; k++) {
        const pos = fixture.cpu(k / 64)
        for (let i = 0; i < pos.length; i += 2) {
          expect(pos[i], `${fixture.name} p ${k / 64}`).toBeGreaterThanOrEqual(x0)
          expect(pos[i]).toBeLessThanOrEqual(x1)
          expect(pos[i + 1]).toBeGreaterThanOrEqual(y0)
          expect(pos[i + 1]).toBeLessThanOrEqual(y1)
        }
      }
    }
  })
})

describe('the GPU memory LRU', () => {
  it('sizes position slots by texture rows', () => {
    expect(texRows(1)).toBe(1)
    expect(texRows(GPU_LIMITS.texWidth + 1)).toBe(2)
    expect(slotBytes(10)).toBe(2 * GPU_LIMITS.texWidth * 8)
  })

  it('drops idle entries, then the oldest until under the byte cap, never one used this frame', () => {
    const disposed: string[] = []
    const lru = new GpuLru<object, string>((v) => disposed.push(v))
    const [a, b, c, d] = [{}, {}, {}, {}]
    lru.set(a, 'a', 100, 0)
    lru.set(b, 'b', 100, 1000)
    lru.set(c, 'c', 100, 2500)
    lru.set(d, 'd', 100, 3000)
    expect(lru.bytes).toBe(400)
    lru.evict(3000, 1000, 2000)
    expect(disposed).toEqual(['a'])
    lru.grow(c, 50)
    expect(lru.bytes).toBe(350)
    lru.get(b, 3000)
    lru.evict(3000, 200, 2000)
    // c is the oldest now; b and d were used this frame and stay even over the cap.
    expect(disposed).toEqual(['a', 'c'])
    expect(lru.size).toBe(2)
    lru.evict(3000, 0, 2000)
    expect(lru.size).toBe(2)
    lru.set(b, 'b2', 10, 3001)
    expect(disposed).toEqual(['a', 'c', 'b'])
    expect(lru.bytes).toBe(110)
    lru.clear()
    expect(disposed.slice(0, 3)).toEqual(['a', 'c', 'b'])
    expect(new Set(disposed.slice(3))).toEqual(new Set(['b2', 'd']))
    expect(lru.bytes).toBe(0)
  })
})

describe('plan slots', () => {
  /** A frame: the progress of each glyph drawn with the plan; returns how many evaluations it took. */
  function frame(plan: { slots: { id: number; p: number }[]; used: number }, ps: number[], made: { n: number }): number {
    plan.used = 0
    let evaluated = 0
    for (const p of ps) {
      const { slot, fresh } = claimSlot(plan, p, () => ({ id: made.n++, p: NaN }))
      if (fresh) {
        slot.p = p
        evaluated++
      }
      expect(slot.p).toBe(p)
    }
    return evaluated
  }

  it('evaluate each progress once a frame, and keep what an earlier frame evaluated', () => {
    const plan = { slots: [] as { id: number; p: number }[], used: 0 }
    const made = { n: 0 }
    expect(frame(plan, [0.2, 0.5, 0.2], made)).toBe(2)
    expect(made.n).toBe(2)
    // Drawn again at the same progress (a hover, a pan, a paused glide): nothing is evaluated.
    expect(frame(plan, [0.2, 0.5], made)).toBe(0)
    // In another order, too: the slot at 0.5 is moved to the front.
    expect(frame(plan, [0.5, 0.2], made)).toBe(0)
    expect(plan.slots.map((s) => s.p)).toEqual([0.5, 0.2])
    // A new progress takes a free slot; one left from before still serves its own progress.
    expect(frame(plan, [0.6], made)).toBe(1)
    expect(frame(plan, [0.6, 0.2], made)).toBe(0)
    expect(frame(plan, [0.6, 0.1, 0.3], made)).toBe(2)
    expect(made.n).toBe(3)
    expect(plan.used).toBe(3)
  })
})
