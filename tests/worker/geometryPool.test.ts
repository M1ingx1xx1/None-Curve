// The page's pool of geometry workers (src/state/geometryClient.ts) against fake Workers and fake timers: a request
// is shared out among the workers glyph by glyph, in the order asked; it ends (and a live frame reaches React) only
// once every worker's part has ended; a glyph goes back to the worker that computed it before, unless that worker
// has more than its share, weighed by how long glyphs took; a stuck or failing worker is restarted on its own and
// fails only its glyphs; and the pool runs with the workers that could start.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedFont } from '../../src/font/model'
import type { WorkerGeometry, WorkerResponse } from '../../src/geometry/protocol'
import type { GeometryJob } from '../../src/geometry/types'
import { GeometryClient, poolSize } from '../../src/state/geometryClient'
import { FakeWorker } from '../helpers/fakeWorker'
import { BASE } from '../helpers/params'

const font = (id: string) => ({ id, bytes: new Uint8Array(4), source: { kind: 'local', fileName: `${id}.ttf`, byteSize: 4 } }) as unknown as LoadedFont
const geometry = (index: number) => ({ polygon: { ref: { index, name: '', unicode: null }, metrics: {}, contours: [] }, vertexCount: index }) as unknown as WorkerGeometry
const job = (key: string, indices: number[]): GeometryJob => ({ params: BASE, key, indices })
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)

/** The glyphs of each set in a worker's newest request, as "key|index", in its order. */
const pairsOf = (w: FakeWorker) => (w.computes ? w.lastRequest.jobs.flatMap(({ key, indices }) => indices.map((i) => `${key}|${i}`)) : [])

/** The worker answers its newest request in full (each glyph taking `ms`), then says it is done. */
function answer(w: FakeWorker, ms: (index: number) => number = () => 1) {
  const { requestId, jobs, live } = w.lastRequest
  for (const { key, indices } of jobs) {
    w.reply({
      type: 'results',
      requestId,
      fontId: 'f',
      key,
      results: indices.map((index) => ({ index, geometry: geometry(index) })),
      times: indices.map(ms),
      ...(live ? { live } : {}),
    } as WorkerResponse)
  }
  w.reply({ type: 'done', requestId })
}

describe('geometry worker pool', () => {
  let workers: FakeWorker[]
  let client: GeometryClient
  const pool = (size: number, options: { watchdogMs?: number; failAt?: number[] } = {}) => {
    let calls = 0
    workers = []
    client = new GeometryClient({
      workers: size,
      watchdogMs: options.watchdogMs,
      createWorker: () => {
        if (options.failAt?.includes(calls++)) throw new Error('no worker')
        const w = new FakeWorker()
        workers.push(w)
        return w as unknown as Worker
      },
    })
  }
  /** The workers that got a part of the newest request, in pool order. */
  const busy = () => workers.filter((w) => !w.terminated && w.computes && w.lastRequest.requestId === Math.max(...workers.filter((v) => v.computes).map((v) => v.lastRequest.requestId)))

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('has 2 to 4 workers: one fewer than the cores', () => {
    expect([1, 2, 3, 4, 5, 8, 16].map((cores) => poolSize(cores))).toEqual([2, 2, 2, 3, 4, 4, 4])
    expect(poolSize(Number.NaN)).toBe(2)
    expect(poolSize(0)).toBe(2)
  })

  it('starts every worker with the font, and shares a request out among them, each glyph once, in the order asked', () => {
    pool(3)
    client.computeJobs(font('f'), [job('a', range(1, 12)), job('b', [7, 3, 11])])
    expect(workers).toHaveLength(3)
    for (const w of workers) expect(w.received[0].type).toBe('font')
    const parts = workers.map(pairsOf)
    // Every pair asked for goes to exactly one worker.
    const all = parts.flat()
    expect([...all].sort()).toEqual([...range(1, 12).map((i) => `a|${i}`), 'b|7', 'b|3', 'b|11'].sort())
    expect(new Set(all).size).toBe(all.length)
    // Each worker's part keeps the request's order: the sets in order, and the glyphs within each as asked.
    const order = [...range(1, 12).map((i) => `a|${i}`), 'b|7', 'b|3', 'b|11']
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0)
      expect(part).toEqual(order.filter((pair) => part.includes(pair)))
    }
    // A glyph's sets all go to one worker, and the request is one id.
    for (const w of workers) for (const i of [7, 3, 11]) expect(pairsOf(w).includes(`a|${i}`)).toBe(pairsOf(w).includes(`b|${i}`))
    expect(new Set(workers.map((w) => w.lastRequest.requestId)).size).toBe(1)
    // An even share when nothing is known of the glyphs' times.
    expect(workers.map((w) => w.lastRequest.jobs[0].indices.length)).toEqual([4, 4, 4])
  })

  it('ends a request, and shows a live frame, only once every worker has answered its part', () => {
    pool(3)
    const listener = vi.fn()
    const idle = vi.fn()
    client.subscribe(listener)
    client.subscribeIdle(idle)
    client.show(font('f'), range(1, 9))
    expect(client.prefetchJobs([{ params: BASE, key: 'S' }, job('Q', [2, 5])])).toBe(true)
    expect(busy()).toHaveLength(3)
    for (const w of workers) expect(w.lastRequest.live).toBe(true)
    answer(workers[0])
    answer(workers[2])
    expect(client.isComputing()).toBe(true)
    expect(idle).not.toHaveBeenCalled()
    answer(workers[1])
    expect(client.isComputing()).toBe(false)
    expect(idle).toHaveBeenCalledTimes(1)
    for (const i of range(1, 9)) expect(client.lookup('S', i)?.stale).toBe(false)

    // A live frame the canvas asks for itself reaches React once, when its last part is in.
    listener.mockClear()
    client.computeJobs(font('f'), [job('L', range(1, 9))], true)
    answer(workers[0])
    answer(workers[1])
    expect(listener).not.toHaveBeenCalled()
    answer(workers[2])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores a done for a part that is over and an answer from a superseded request', () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 4))
    const first = workers[0].lastRequest.requestId
    answer(workers[0])
    // Done again from the same worker does not end the request.
    workers[0].reply({ type: 'done', requestId: first })
    expect(client.isComputing()).toBe(true)
    answer(workers[1])
    expect(client.isComputing()).toBe(false)
  })

  it('sends a glyph back to the worker that computed it before', () => {
    pool(4)
    client.compute(font('f'), BASE, 'a', range(1, 16))
    const owner = new Map<number, FakeWorker>()
    for (const w of workers) for (const i of w.lastRequest.jobs[0].indices) owner.set(i, w)
    for (const w of workers) answer(w)
    // New settings, the same glyphs in another order, and fewer of them (two from each worker, so each keeps its share).
    client.compute(font('f'), BASE, 'b', [16, 3, 9, 1, 12, 6, 2, 7])
    for (const w of busy()) for (const i of w.lastRequest.jobs[0].indices) expect(owner.get(i)).toBe(w)
    for (const w of busy()) answer(w)
    // One glyph alone stays with its worker too.
    client.compute(font('f'), BASE, 'c', [7])
    expect(busy()).toEqual([owner.get(7)])
  })

  it('weighs the share by how long glyphs took: a slow glyph leaves its worker fewer others', () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 8))
    const slowWorker = workers.find((w) => w.lastRequest.jobs[0].indices.includes(1))!
    // Glyph 1 took as long as the other seven together.
    for (const w of workers) answer(w, (i) => (i === 1 ? 7 : 1))
    client.compute(font('f'), BASE, 'b', range(1, 8))
    expect(slowWorker.lastRequest.jobs[0].indices).toEqual([1])
    const other = workers.find((w) => w !== slowWorker)!
    expect(other.lastRequest.jobs[0].indices).toEqual(range(2, 8))
  })

  it('tells a worker without a part of a new request to stop its old one', () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 4))
    const first = workers[0].lastRequest.requestId
    const loner = workers.find((w) => w.lastRequest.jobs[0].indices.includes(1))!
    const other = workers.find((w) => w !== loner)!
    client.compute(font('f'), BASE, 'b', [1])
    expect(loner.lastRequest.jobs).toEqual([job('b', [1])])
    expect(other.received.at(-1)).toEqual({ type: 'cancel', requestId: first })
    // Its stopped part's end does not end the new request.
    other.reply({ type: 'done', requestId: first, stopped: true })
    expect(client.isComputing()).toBe(true)
    answer(loner)
    expect(client.isComputing()).toBe(false)
  })

  it('restarts only a stuck worker, blames its glyph, and lets the others finish', async () => {
    pool(2)
    const idle = vi.fn()
    client.subscribeIdle(idle)
    client.compute(font('f'), BASE, 'a', range(1, 6))
    const [stuck, fine] = workers
    const stuckGlyphs = stuck.lastRequest.jobs[0].indices
    const { requestId } = stuck.lastRequest
    stuck.reply({ type: 'glyph', requestId, key: 'a', index: stuckGlyphs[0] })
    await vi.advanceTimersByTimeAsync(30_000)
    answer(fine)
    // The request waits for the stuck worker.
    expect(client.isComputing()).toBe(true)
    await vi.advanceTimersByTimeAsync(31_000)
    expect(stuck.terminated).toBe(true)
    expect(fine.terminated).toBe(false)
    expect(workers).toHaveLength(3)
    expect(workers[2].received.map((m) => m.type)).toEqual(['font'])
    expect(client.lookup('a', stuckGlyphs[0])?.entry).toEqual({ error: 'Took longer than 60 s; try lighter settings' })
    for (const i of stuckGlyphs.slice(1)) expect(client.lookup('a', i)).toBeNull()
    for (const i of fine.lastRequest.jobs[0].indices) expect(client.lookup('a', i)?.stale).toBe(false)
    expect(client.isComputing()).toBe(false)
    expect(idle).toHaveBeenCalledTimes(1)
    // Asking again sends only the stuck worker's other glyphs.
    client.compute(font('f'), BASE, 'a', range(1, 6))
    expect([...pairsOf(workers[2]), ...(fine.computes > 1 ? pairsOf(fine) : [])].sort()).toEqual(stuckGlyphs.slice(1).map((i) => `a|${i}`).sort())
  })

  it('restarts a failing worker on its own while the request goes on, then asks again for its glyphs', () => {
    pool(2)
    const listener = vi.fn()
    client.subscribe(listener)
    client.compute(font('f'), BASE, 'a', range(1, 6))
    const [failing, fine] = workers
    const lost = failing.lastRequest.jobs[0].indices
    failing.onerror?.({ preventDefault: () => {} } as ErrorEvent)
    expect(failing.terminated).toBe(true)
    expect(workers).toHaveLength(3)
    expect(client.isComputing()).toBe(true)
    // The canvas asking again meanwhile (a render) does not wait for glyphs no worker is computing.
    client.compute(font('f'), BASE, 'a', range(1, 6))
    expect(pairsOf(workers[2]).sort()).toEqual(lost.map((i) => `a|${i}`).sort())
    expect(client.isComputing()).toBe(true)
  })

  it('a worker that keeps failing leaves the pool; the others go on, and geometry stops only when none is left', () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 4))
    /** Fails this worker and each worker started in its place, `times` times in all. */
    const failRepeatedly = (w: FakeWorker, times: number) => {
      for (let k = 0; k < times; k++) {
        const count = workers.length
        w.onerror?.({ preventDefault: () => {} } as ErrorEvent)
        if (workers.length > count) w = workers.at(-1)!
      }
    }
    failRepeatedly(workers[0], 4)
    expect(client.getProblem()).toBeNull()
    const left = workers.filter((w) => !w.terminated)
    expect(left).toEqual([workers[1]])
    // Everything goes to the worker left.
    client.compute(font('f'), BASE, 'b', range(1, 4))
    expect(left[0].lastRequest.jobs).toEqual([job('b', range(1, 4))])
    failRepeatedly(left[0], 4)
    expect(client.getProblem()).toBe('The geometry worker kept failing. Reload the page to try again.')
    // A new font brings the whole pool back.
    const before = workers.length
    client.compute(font('g'), BASE, 'k', [1])
    expect(workers.length - before).toBe(2)
    expect(client.getProblem()).toBeNull()
  })

  it('runs with the workers that could start', () => {
    pool(3, { failAt: [1] })
    client.compute(font('f'), BASE, 'a', range(1, 6))
    expect(workers).toHaveLength(2)
    expect(client.getProblem()).toBeNull()
    expect(workers.flatMap(pairsOf).sort()).toEqual(range(1, 6).map((i) => `a|${i}`).sort())
    pool(3, { failAt: [0, 1, 2] })
    client.compute(font('f'), BASE, 'a', [1])
    expect(client.getProblem()).toBe('The geometry worker could not start. Reload the page to try again.')
    expect(client.lookup('a', 1)?.entry).toEqual({ error: client.getProblem(), transient: true })
  })

  it('sends the font again to the one worker that lacks it, with its part', () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 4))
    const [lacking, other] = workers
    const part = lacking.lastRequest
    lacking.reply({ type: 'failed', requestId: part.requestId, reason: 'no-font', message: 'no font' })
    expect(lacking.received.map((m) => m.type)).toEqual(['font', 'compute', 'font', 'compute'])
    expect(lacking.lastRequest).toEqual(part)
    expect(other.received.map((m) => m.type)).toEqual(['font', 'compute'])
    answer(lacking)
    answer(other)
    expect(client.isComputing()).toBe(false)
  })

  it('a pool of one sends every request whole, as one worker did', () => {
    pool(1)
    const jobs = [job('a', [5, 1, 3]), job('b', [3])]
    client.computeJobs(font('f'), jobs, true)
    expect(workers).toHaveLength(1)
    expect(workers[0].lastRequest).toEqual({ type: 'compute', requestId: expect.any(Number), fontId: 'f', jobs, live: true })
    expect(workers[0].received.filter((m) => m.type === 'cancel')).toEqual([])
  })
})
