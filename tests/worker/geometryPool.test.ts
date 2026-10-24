// The page's pool of geometry workers (src/state/geometryClient.ts) against fake Workers and fake timers: a request
// is shared out among the workers glyph by glyph, in the order asked; it ends (and a live frame reaches React) only
// once every worker's part has ended; a glyph goes back to the worker that computed it before, unless that worker
// has more than its share, weighed by how long glyphs took, and a glyph a worker is on stays with it; a stuck or
// failing worker is restarted on its own and fails only its glyphs, while restarts are counted for the whole pool;
// at most one worker is replaced for superseded settings at a time; and the pool runs with the workers that could start.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedFont } from '../../src/font/model'
import { packGeometry } from '../../src/geometry/packed'
import type { WorkerGeometry, WorkerResponse } from '../../src/geometry/protocol'
import type { GeometryJob } from '../../src/geometry/types'
import { GeometryClient, poolSize } from '../../src/state/geometryClient'
import { FakeWorker } from '../helpers/fakeWorker'
import { BASE } from '../helpers/params'

const font = (id: string) => ({ id, bytes: new Uint8Array(4), source: { kind: 'local', fileName: `${id}.ttf`, byteSize: 4 } }) as unknown as LoadedFont
const geometry = (index: number) => ({ polygon: { ref: { index, name: '', unicode: null }, metrics: {}, contours: [] }, vertexCount: index }) as unknown as WorkerGeometry
const packed = (index: number) => packGeometry(geometry(index)).packed
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
      fontId: w.lastRequest.fontId,
      key,
      results: indices.map((index) => ({ index, packed: packed(index) })),
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
    const [failing] = workers
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

  it('counts restarts for the whole pool: more than three within a minute stop geometry, however they are spread', () => {
    pool(4)
    const idle = vi.fn()
    client.subscribeIdle(idle)
    client.compute(font('f'), BASE, 'a', range(1, 8))
    const crash = (w: FakeWorker) => w.onerror?.({ preventDefault: () => {} } as ErrorEvent)
    // A glyph that crashes a worker crashes each one it goes to: three crashes on three workers, and the pool goes on.
    crash(workers[0])
    crash(workers[1])
    crash(workers[4])
    expect(client.getProblem()).toBeNull()
    expect(workers.filter((w) => !w.terminated)).toHaveLength(4)
    expect(client.isComputing()).toBe(true)
    // The fourth stops every worker, ends the request, and the glyphs fail with the reason.
    crash(workers[2])
    expect(client.getProblem()).toBe('The geometry worker kept failing. Reload the page to try again.')
    expect(workers.every((w) => w.terminated)).toBe(true)
    expect(client.isComputing()).toBe(false)
    expect(idle).toHaveBeenCalledTimes(1)
    const count = workers.length
    client.compute(font('f'), BASE, 'b', [1])
    expect(workers).toHaveLength(count)
    expect(client.lookup('b', 1)?.entry).toEqual({ error: client.getProblem(), transient: true })
    // A new font brings the whole pool back.
    client.compute(font('g'), BASE, 'k', [1])
    expect(workers.length - count).toBe(4)
    expect(client.getProblem()).toBeNull()
  })

  it('forgets restarts older than a minute', async () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 4))
    for (let k = 0; k < 3; k++) workers.filter((w) => !w.terminated)[0].onerror?.({ preventDefault: () => {} } as ErrorEvent)
    await vi.advanceTimersByTimeAsync(60_001)
    workers.filter((w) => !w.terminated)[0].onerror?.({ preventDefault: () => {} } as ErrorEvent)
    expect(client.getProblem()).toBeNull()
    expect(workers.filter((w) => !w.terminated)).toHaveLength(2)
  })

  it('keeps a glyph a worker is computing with that worker, even when heavier glyphs fill its share', () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 8))
    const [first, second] = workers
    // The first worker's glyphs are a little slower than the second's.
    answer(first, () => 11)
    answer(second, () => 10)
    // A new glyph alone goes to the first worker, which starts on it.
    client.compute(font('f'), BASE, 'b', [9])
    expect(first.lastRequest.jobs).toEqual([job('b', [9])])
    first.reply({ type: 'glyph', requestId: first.lastRequest.requestId, key: 'b', index: 9 })
    vi.advanceTimersByTime(1000)
    // Asked for again with the others, it stays where it is being computed (not started over on the second worker,
    // and the first is not replaced as if its glyph were not needed).
    client.compute(font('f'), BASE, 'b', [9, ...range(1, 8)])
    expect(first.terminated).toBe(false)
    expect(workers).toHaveLength(2)
    expect(pairsOf(first)).toContain('b|9')
    expect(pairsOf(second)).not.toContain('b|9')
    expect([...pairsOf(first), ...pairsOf(second)].sort()).toEqual([9, ...range(1, 8)].map((i) => `b|${i}`).sort())
  })

  it('replaces a worker stuck on a glyph of superseded settings, at most one in the pool every two seconds', () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 4))
    const [first, second] = workers
    first.reply({ type: 'glyph', requestId: first.lastRequest.requestId, key: 'a', index: first.lastRequest.jobs[0].indices[0] })
    vi.advanceTimersByTime(100)
    second.reply({ type: 'glyph', requestId: second.lastRequest.requestId, key: 'a', index: second.lastRequest.jobs[0].indices[0] })
    // Not yet: neither has been on its glyph for 750 ms.
    vi.advanceTimersByTime(600)
    client.compute(font('f'), BASE, 'b', range(1, 4))
    expect(workers).toHaveLength(2)
    vi.advanceTimersByTime(200)
    // Both are stuck now: only the one stuck longest is replaced, and the new request goes to the new worker too.
    client.compute(font('f'), BASE, 'c', range(1, 4))
    expect(first.terminated).toBe(true)
    expect(second.terminated).toBe(false)
    expect(workers).toHaveLength(3)
    expect(workers[2].received.map((m) => m.type)).toEqual(['font', 'compute'])
    vi.advanceTimersByTime(1900)
    client.compute(font('f'), BASE, 'd', range(1, 4))
    expect(second.terminated).toBe(false)
    vi.advanceTimersByTime(101)
    client.compute(font('f'), BASE, 'e', range(1, 4))
    expect(second.terminated).toBe(true)
    expect(workers).toHaveLength(4)
  })

  it('never replaces a worker for a live frame', () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 4))
    const [first] = workers
    first.reply({ type: 'glyph', requestId: first.lastRequest.requestId, key: 'a', index: first.lastRequest.jobs[0].indices[0] })
    vi.advanceTimersByTime(5000)
    client.computeJobs(font('f'), [job('L', range(1, 4))], true)
    expect(first.terminated).toBe(false)
    expect(workers).toHaveLength(2)
  })

  it('ends the request in flight when the worker replacing a stuck one cannot start', () => {
    pool(1, { failAt: [1] })
    const idle = vi.fn()
    client.subscribeIdle(idle)
    client.compute(font('f'), BASE, 'a', [1, 2])
    const [w] = workers
    w.reply({ type: 'glyph', requestId: w.lastRequest.requestId, key: 'a', index: 1 })
    vi.advanceTimersByTime(1000)
    client.compute(font('f'), BASE, 'b', [3])
    expect(w.terminated).toBe(true)
    expect(client.getProblem()).toBe('The geometry worker could not start. Reload the page to try again.')
    expect(client.lookup('b', 3)?.entry).toEqual({ error: client.getProblem(), transient: true })
    expect(client.isComputing()).toBe(false)
    expect(idle).toHaveBeenCalledTimes(1)
  })

  it("restarts two workers silent at once, blames each one's glyph, and ends the request", async () => {
    pool(3, { watchdogMs: 5_000 })
    const idle = vi.fn()
    client.subscribeIdle(idle)
    client.compute(font('f'), BASE, 'a', range(1, 9))
    const [s1, s2, fine] = workers
    const stuckGlyphs = [s1, s2].map((w) => w.lastRequest.jobs[0].indices[0])
    for (const w of [s1, s2]) w.reply({ type: 'glyph', requestId: w.lastRequest.requestId, key: 'a', index: w.lastRequest.jobs[0].indices[0] })
    answer(fine)
    await vi.advanceTimersByTimeAsync(5_001)
    expect([s1.terminated, s2.terminated, fine.terminated]).toEqual([true, true, false])
    expect(workers).toHaveLength(5)
    for (const i of stuckGlyphs) expect(client.lookup('a', i)?.entry).toEqual({ error: 'Took longer than 5 s; try lighter settings' })
    expect(client.getProblem()).toBeNull()
    expect(client.isComputing()).toBe(false)
    expect(idle).toHaveBeenCalledTimes(1)
  })

  it("switching fonts stops every worker's part; the old font's late answers are ignored", async () => {
    pool(3)
    const idle = vi.fn()
    client.subscribeIdle(idle)
    client.compute(font('f'), BASE, 'a', range(1, 9))
    const old = workers.map((w) => w.lastRequest)
    client.compute(font('g'), BASE, 'a', range(1, 6))
    expect(workers).toHaveLength(3)
    for (const [n, w] of workers.entries()) {
      expect(w.received.map((m) => m.type)).toEqual(['font', 'compute', 'cancel', 'font', 'compute'])
      expect(w.received[2]).toEqual({ type: 'cancel', requestId: old[n].requestId })
      expect(w.lastRequest.fontId).toBe('g')
    }
    // The old request's end reaches the idle listeners once, after the new one is on its way.
    await Promise.resolve()
    expect(idle).toHaveBeenCalledTimes(1)
    // The old font's results and dones, arriving late, change nothing.
    workers[0].reply({ type: 'results', requestId: old[0].requestId, fontId: 'f', key: 'a', results: [{ index: 1, packed: packed(1) }] })
    for (const [n, w] of workers.entries()) w.reply({ type: 'done', requestId: old[n].requestId, stopped: true })
    expect(client.lookup('a', 1)).toBeNull()
    expect(client.isComputing()).toBe(true)
    for (const w of workers) answer(w)
    expect(client.isComputing()).toBe(false)
    for (const i of range(1, 6)) expect(client.lookup('a', i)?.stale).toBe(false)
  })

  it("a time of null (a result from the worker's cache) leaves the glyph's estimate as it was", () => {
    pool(2)
    client.compute(font('f'), BASE, 'a', range(1, 8))
    const slowWorker = workers.find((w) => w.lastRequest.jobs[0].indices.includes(1))!
    for (const w of workers) answer(w, (i) => (i === 1 ? 7 : 1))
    client.compute(font('f'), BASE, 'b', range(1, 8))
    for (const w of busy()) answer(w, () => null as unknown as number)
    client.compute(font('f'), BASE, 'c', range(1, 8))
    expect(slowWorker.lastRequest.jobs[0].indices).toEqual([1])
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
    expect(workers[0].lastRequest).toEqual({ type: 'compute', requestId: expect.any(Number), fontId: 'f', jobs, live: true, stats: { key: 'a', index: 5 } })
    expect(workers[0].received.filter((m) => m.type === 'cancel')).toEqual([])
  })
})
