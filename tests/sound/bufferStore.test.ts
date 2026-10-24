// The buffered bar's store (src/sound/bufferStore.ts, NOCUR-85): snapshots are published at most every bufferEveryMs,
// only when they moved by about a pixel of the slider, and at once when forced (a new plan, file or font).

import { describe, expect, it } from 'vitest'
import { createBufferStore, EMPTY_BUFFER, QUANTUM } from '../../src/sound/bufferStore'
import { PRECOMPUTE_LIMITS } from '../../src/sound/timelineTypes'

const snapshot = (plannedMs: number, ready: number[] = []) => ({
  durationMs: 60_000,
  plannedMs,
  ready: Float32Array.from(ready),
})

describe('the buffer store', () => {
  it('publishes at most every bufferEveryMs, only what moved by a quantum, and at once when forced', () => {
    const store = createBufferStore()
    let heard = 0
    const off = store.subscribe(() => heard++)
    expect(store.get()).toBe(EMPTY_BUFFER)
    expect(store.offer(snapshot(1000, [0, 2000]), 0)).toBe(true)
    expect(store.get()).toMatchObject({ plannedMs: 1000, version: 1 })
    // Too soon.
    expect(store.offer(snapshot(5000), 10)).toBe(false)
    const every = PRECOMPUTE_LIMITS.bufferEveryMs
    // Less than a quantum of the length: not worth a render.
    expect(store.offer(snapshot(1000 + 0.4 * QUANTUM * 60_000, [0, 2000]), every)).toBe(false)
    expect(store.offer(snapshot(5000, [0, 2000]), every)).toBe(true)
    // Forced: at once, even right after.
    expect(store.offer(snapshot(0), every + 1, true)).toBe(true)
    expect(store.get()).toMatchObject({ plannedMs: 0, version: 3 })
    expect(heard).toBe(3)
    // The same snapshot forced again changes nothing.
    expect(store.offer(snapshot(0), every + 2, true)).toBe(false)
    off()
    store.offer(snapshot(30_000), 10 * every)
    expect(heard).toBe(3)
  })
})
