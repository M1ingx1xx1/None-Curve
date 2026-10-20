// The page's store of the precompute window's glyphs (src/state/aheadStore.ts, NOCUR-85): packed glyphs within a byte
// budget, turned into objects when looked up (a small LRU of them); past the budget, orphans go first (oldest first),
// then the glyphs used farthest from the playhead (behind counts behindWeight times), never one in use near it, and a
// result farther than everything kept is dropped at once.

import { describe, expect, it } from 'vitest'
import { ERROR_BYTES, packGeometry } from '../../src/geometry/packed'
import type { WorkerGeometry } from '../../src/geometry/protocol'
import { AheadStore } from '../../src/state/aheadStore'

/** A small glyph: one triangle. */
const glyph = (x: number) =>
  packGeometry({
    polygon: { ref: { index: x }, metrics: {}, contours: [{ points: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x, y: 1 }], clockwise: true }] },
    vertexCount: 3,
  } as unknown as WorkerGeometry).packed

const ERROR = { error: 'x' }

describe('the page ahead store', () => {
  it('turns a glyph into objects once while it is among the recently looked up', () => {
    const made: string[] = []
    const store = new AheadStore(1 << 20, { materialized: 2, onMaterialize: (_, key) => made.push(key) })
    for (const key of ['a', 'b', 'c']) store.put(key, 1, { packed: glyph(key.charCodeAt(0)) })
    const a = store.get('a', 1)!
    expect('geometry' in a && a.geometry.polygon.contours[0].points[0].x).toBe(97)
    expect(store.get('a', 1)).toBe(a)
    store.get('b', 1)
    store.get('c', 1)
    // Three looked up, two kept as objects: a is made again.
    expect(store.get('a', 1)).not.toBe(a)
    expect(store.get('a', 1)).toEqual(a)
    expect(made).toEqual(['a', 'b', 'c', 'a'])
    expect(store.get('z', 1)).toBeUndefined()
    expect(store.points()).toBe(9)
  })

  it('past its budget, evicts orphans first, then the farthest; a result farther than everything is dropped at once', () => {
    // Room for ten error results; eviction goes down to nine.
    const store = new AheadStore(10 * ERROR_BYTES, { protectMs: 500 })
    const evicted: string[] = []
    store.onEvict((list) => evicted.push(...list.map((e) => e.key)))
    store.setPlayhead(10_000)
    for (let k = 0; k < 9; k++) {
      store.use(`a${k}`, 0, 10_000 + 1000 * k)
      store.put(`a${k}`, 0, ERROR)
    }
    expect(store.put('orphan', 0, ERROR)).toBe(true)
    expect(store.orphans()).toBe(1)
    store.use('far', 0, 20_000)
    expect(store.put('far', 0, ERROR)).toBe(false)
    expect(evicted).toEqual(['orphan', 'far'])
    expect(store.size()).toBe(9)
    expect(store.full()).toBe(true)
    expect(store.farthest()).toBe(8000)
    // 3 s behind weighs 9 s: it goes before the glyph 8 s ahead, and the glyph just ahead is protected.
    store.use('behind', 0, 7000)
    store.put('behind', 0, ERROR)
    store.use('near', 0, 10_100)
    expect(store.put('near', 0, ERROR)).toBe(true)
    expect(evicted.slice(2)).toEqual(['behind', 'a8'])
    expect(store.has('near', 0)).toBe(true)
    expect(store.evictions).toBe(4)
    expect(store.bytes()).toBe(9 * ERROR_BYTES)
  })

  it('a new plan makes every glyph an orphan until the window uses it again', () => {
    const store = new AheadStore(10 * ERROR_BYTES)
    store.setPlayhead(0)
    for (let k = 0; k < 5; k++) {
      store.use(`k${k}`, 0, 100 * k)
      store.put(`k${k}`, 0, ERROR)
    }
    store.orphanAll()
    expect(store.orphans()).toBe(5)
    expect(store.full()).toBe(false)
    store.use('k3', 0, 50)
    expect(store.orphans()).toBe(4)
    // Orphans go first, oldest first; the one used again stays.
    for (let k = 5; k < 12; k++) {
      store.use(`k${k}`, 0, 100 * k)
      store.put(`k${k}`, 0, ERROR)
    }
    expect(store.has('k0', 0)).toBe(false)
    expect(store.has('k3', 0)).toBe(true)
  })

  it('forgets uses of glyphs it does not hold outside the window, and clears with one eviction call', () => {
    const store = new AheadStore(10 * ERROR_BYTES)
    store.use('gone', 0, 100)
    store.use('kept', 0, 100)
    store.put('kept', 0, ERROR)
    store.pruneUses(5000, 50_000)
    // Put now, 'gone' arrives as an orphan; 'kept' kept its use.
    store.put('gone', 0, ERROR)
    expect(store.orphans()).toBe(1)
    const calls: number[] = []
    store.onEvict((list) => calls.push(list.length))
    store.clear()
    expect(calls).toEqual([2])
    expect(store.size()).toBe(0)
    expect(store.bytes()).toBe(0)
  })
})
