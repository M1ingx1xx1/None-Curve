// The page's side of the geometry worker (src/state/geometryClient.ts) against a fake Worker and fake timers: the
// watchdog restarts a silent worker and blames the glyph it was on, restarts are limited, a worker busy with
// superseded settings is replaced, and a worker that cannot start or open the font fails the glyphs with a reason.
// A request may hold several parameter sets (jobs, for letters of a live frame that react by different amounts):
// only the missing glyphs of each are sent, and live sets asked for again are kept longest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedFont } from '../../src/font/model'
import type { WorkerGeometry, WorkerResponse } from '../../src/geometry/protocol'
import { GeometryClient, LIVE_KEPT_KEYS } from '../../src/state/geometryClient'
import { FakeWorker } from '../helpers/fakeWorker'
import { BASE } from '../helpers/params'

const font = (id: string) => ({ id, bytes: new Uint8Array(4), source: { kind: 'local', fileName: `${id}.ttf`, byteSize: 4 } }) as unknown as LoadedFont
const geometry = (index: number) => ({ polygon: { ref: { index, name: '', unicode: null }, metrics: {}, contours: [] }, vertexCount: index }) as unknown as WorkerGeometry

const STUCK = 'Took longer than 60 s; try lighter settings'

describe('geometry client', () => {
  let workers: FakeWorker[]
  let client: GeometryClient
  const worker = () => workers[workers.length - 1]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
    workers = []
    client = new GeometryClient({
      workers: 1,
      createWorker: () => {
        const w = new FakeWorker()
        workers.push(w)
        return w as unknown as Worker
      },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the font, then the glyphs, and keeps the results', async () => {
    const listener = vi.fn()
    client.subscribe(listener)
    client.compute(font('f'), BASE, 'k1', [1, 2])
    expect(worker().received.map((m) => m.type)).toEqual(['font', 'compute'])
    const { requestId } = worker().lastCompute
    expect(client.isComputing()).toBe(true)
    worker().reply({ type: 'glyph', requestId, key: 'k1', index: 1 })
    worker().reply({ type: 'results', requestId, fontId: 'f', key: 'k1', results: [{ index: 1, geometry: geometry(1) }, { index: 2, error: 'bad glyph' }] })
    worker().reply({ type: 'done', requestId })
    expect(client.isComputing()).toBe(false)
    await vi.advanceTimersByTimeAsync(60)
    expect(listener).toHaveBeenCalled()
    expect(client.lookup('k1', 1)).toEqual({ entry: { geometry: geometry(1) }, stale: false })
    expect(client.lookup('k1', 2)).toEqual({ entry: { error: 'bad glyph' }, stale: false })
    // Asking again for what is known sends nothing.
    client.compute(font('f'), BASE, 'k1', [1, 2])
    expect(worker().received.filter((m) => m.type === 'compute')).toHaveLength(1)
  })

  it('restarts a worker silent for 60 s, and blames the glyph it was on', async () => {
    const idle = vi.fn()
    client.subscribeIdle(idle)
    client.compute(font('f'), BASE, 'k1', [5, 6])
    const first = worker()
    const { requestId } = first.lastCompute
    first.reply({ type: 'glyph', requestId, key: 'k1', index: 5 })
    await vi.advanceTimersByTimeAsync(59_000)
    expect(workers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(first.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(worker().received.map((m) => m.type)).toEqual(['font'])
    expect(client.lookup('k1', 5)?.entry).toEqual({ error: STUCK })
    expect(client.lookup('k1', 6)).toBeNull()
    expect(client.isComputing()).toBe(false)
    expect(idle).toHaveBeenCalled()
    // Messages from the stopped worker are ignored.
    first.reply({ type: 'results', requestId, fontId: 'f', key: 'k1', results: [{ index: 6, geometry: geometry(6) }] })
    expect(client.lookup('k1', 6)).toBeNull()
  })

  it('keeps a worker that is slow but still heard from', async () => {
    client.compute(font('f'), BASE, 'k1', [1, 2, 3])
    const { requestId } = worker().lastCompute
    for (const index of [1, 2, 3]) {
      worker().reply({ type: 'glyph', requestId, key: 'k1', index })
      await vi.advanceTimersByTimeAsync(45_000)
    }
    expect(workers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(16_000)
    expect(workers).toHaveLength(2)
    expect(client.lookup('k1', 3)?.entry).toEqual({ error: STUCK })
  })

  it('stops after more than 3 restarts within a minute, until the next font', async () => {
    client = new GeometryClient({ workers: 1, createWorker: () => (workers.push(new FakeWorker()), worker() as unknown as Worker), watchdogMs: 5_000 })
    for (let k = 0; k < 4; k++) {
      client.compute(font('f'), BASE, `k${k}`, [k])
      worker().reply({ type: 'glyph', requestId: worker().lastCompute.requestId, key: `k${k}`, index: k })
      await vi.advanceTimersByTimeAsync(5_001)
      expect(client.lookup(`k${k}`, k)?.entry).toEqual({ error: 'Took longer than 5 s; try lighter settings' })
    }
    expect(workers).toHaveLength(4)
    const problem = client.getProblem()
    expect(problem).toBe('The geometry worker stopped responding. Reload the page to try again.')
    // No worker now: glyphs fail at once, with the reason, and nothing is computed on the page.
    client.compute(font('f'), BASE, 'later', [9])
    expect(workers).toHaveLength(4)
    expect(client.lookup('later', 9)?.entry).toEqual({ error: problem, transient: true })
    // A new font starts afresh.
    client.compute(font('g'), BASE, 'k', [1])
    expect(client.getProblem()).toBeNull()
    expect(workers).toHaveLength(5)
  })

  it('does not stop for restarts spread over more than a minute', async () => {
    for (let k = 0; k < 6; k++) {
      client.compute(font('f'), BASE, `k${k}`, [k])
      await vi.advanceTimersByTimeAsync(60_001)
    }
    expect(client.getProblem()).toBeNull()
    expect(workers).toHaveLength(7)
  })

  it('replaces a worker stuck on a glyph of superseded settings, without counting a restart', async () => {
    client.compute(font('f'), BASE, 'old', [1])
    const first = worker()
    first.reply({ type: 'glyph', requestId: first.lastCompute.requestId, key: 'old', index: 1 })
    await vi.advanceTimersByTimeAsync(800)
    client.compute(font('f'), BASE, 'new', [2])
    expect(first.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(worker().received.map((m) => m.type)).toEqual(['font', 'compute'])
    expect(worker().lastCompute.key).toBe('new')
    // Not a fault: the glyph is not blamed.
    expect(client.lookup('old', 1)).toBeNull()
  })

  it('cancels instead while the glyph is young', async () => {
    client.compute(font('f'), BASE, 'old', [1])
    worker().reply({ type: 'glyph', requestId: worker().lastCompute.requestId, key: 'old', index: 1 })
    await vi.advanceTimersByTimeAsync(100)
    client.compute(font('f'), BASE, 'new', [2])
    expect(workers).toHaveLength(1)
    expect(worker().received.map((m) => m.type)).toEqual(['font', 'compute', 'compute'])
  })

  it('fails the glyphs with a reason when no worker can start', () => {
    client = new GeometryClient({
      workers: 1,
      createWorker: () => {
        throw new Error('no workers here')
      },
    })
    client.compute(font('f'), BASE, 'k', [1, 2])
    const problem = 'The geometry worker could not start. Reload the page to try again.'
    expect(client.getProblem()).toBe(problem)
    expect(client.lookup('k', 1)?.entry).toEqual({ error: problem, transient: true })
    expect(client.isComputing()).toBe(false)
  })

  it('sends the font again once when the worker does not have it', () => {
    client.compute(font('f'), BASE, 'k', [1])
    const w = worker()
    w.reply({ type: 'failed', requestId: w.lastCompute.requestId, reason: 'no-font', message: 'no font' })
    expect(w.received.map((m) => m.type)).toEqual(['font', 'compute', 'font', 'compute'])
    // A second time is a fault: the worker is restarted.
    w.reply({ type: 'failed', requestId: w.lastCompute.requestId, reason: 'no-font', message: 'no font' })
    expect(w.terminated).toBe(true)
    expect(workers).toHaveLength(2)
  })

  it('fails the glyphs with the reason when the worker cannot open the font', () => {
    client.compute(font('f'), BASE, 'k', [1, 2])
    const w = worker()
    w.reply({ type: 'font-error', fontId: 'f', message: 'bad tables' })
    w.reply({ type: 'failed', requestId: w.lastCompute.requestId, reason: 'font', message: 'bad tables' })
    const problem = 'The geometry worker could not open this font (bad tables).'
    expect(client.getProblem()).toBe(problem)
    expect(client.lookup('k', 2)?.entry).toEqual({ error: problem, transient: true })
    expect(workers).toHaveLength(1)
  })

  it('restarts on a worker error', () => {
    client.compute(font('f'), BASE, 'k', [1])
    const w = worker()
    w.onerror?.({ preventDefault: () => {} } as ErrorEvent)
    expect(w.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(client.isComputing()).toBe(false)
  })

  it('ensure resolves once every glyph has a result, asking the worker for the rest', async () => {
    const f = font('f')
    const done = client.ensure(f, BASE, 'k', [1, 2])
    const w = worker()
    const { requestId, indices } = w.lastCompute
    expect(indices).toEqual([1, 2])
    w.reply({ type: 'results', requestId, fontId: 'f', key: 'k', results: [{ index: 1, geometry: geometry(1) }, { index: 2, error: 'bad' }] })
    w.reply({ type: 'done', requestId })
    const lookup = await done
    expect(lookup(1, 0)).toEqual({ polygon: geometry(1).polygon })
    expect(lookup(2, 1)).toEqual({ error: 'bad' })
  })

  describe('jobs: several parameter sets in one request', () => {
    const job = (key: string, indices: number[], params = BASE) => ({ params, key, indices })
    const results = (key: string, indices: readonly number[], live = false) =>
      ({ type: 'results', requestId: worker().lastCompute.requestId, fontId: 'f', key, results: indices.map((index) => ({ index, geometry: geometry(index) })), ...(live ? { live } : {}) }) as WorkerResponse
    const done = () => worker().reply({ type: 'done', requestId: worker().lastCompute.requestId })

    it('sends only the missing glyphs of each set, in the order asked', () => {
      const f = font('f')
      client.compute(f, BASE, 'a', [1, 2])
      worker().reply(results('a', [1, 2]))
      done()
      const other = { ...BASE, experimental: { ...BASE.experimental, seed: 9 } }
      client.computeJobs(f, [job('a', [1, 2, 3]), job('b', [2, 1], other)], true)
      expect(worker().lastRequest).toEqual({
        type: 'compute',
        requestId: expect.any(Number),
        fontId: 'f',
        jobs: [job('a', [3]), job('b', [2, 1], other)],
        live: true,
      })
      // A set named twice is asked for once.
      done()
      client.computeJobs(f, [job('c', [4]), job('c', [4, 5])])
      expect(worker().lastRequest.jobs).toEqual([job('c', [4, 5])])
    })

    it('waits for the request in flight when it has every missing glyph of every set', () => {
      const f = font('f')
      client.computeJobs(f, [job('a', [1, 2]), job('b', [3])])
      expect(worker().computes).toBe(1)
      client.computeJobs(f, [job('b', [3]), job('a', [2])])
      expect(worker().computes).toBe(1)
      // A glyph of a set it does not have, or of another set, needs a new request.
      client.computeJobs(f, [job('a', [1]), job('b', [1])])
      expect(worker().computes).toBe(2)
      expect(worker().lastRequest.jobs).toEqual([job('a', [1]), job('b', [1])])
    })

    it('prefetches the shown glyphs for a set without indices, as one live request', () => {
      expect(client.prefetchJobs([job('s', [1])])).toBe(false)
      client.show(font('f'), [4, 5, 6])
      expect(client.prefetchJobs([{ params: BASE, key: 's' }, job('q', [5])])).toBe(true)
      expect(worker().lastRequest.jobs).toEqual([job('s', [4, 5, 6]), job('q', [5])])
      expect(worker().lastRequest.live).toBe(true)
      // A single set is the same request.
      done()
      expect(client.prefetchJobs([{ params: BASE, key: 't' }])).toBe(true)
      expect(worker().lastRequest.jobs).toEqual([job('t', [4, 5, 6])])
    })

    it("only a live frame's shared set stands in for a glyph while other settings are computed, never its quiet or strong level", () => {
      client.show(font('f'), [1, 2, 3])
      // Each set's results told apart by their vertex count.
      const counts: Record<string, number> = { S: 10, T: 20, Q: 30, T2: 40 }
      const answer = () => {
        const { requestId, jobs } = worker().lastRequest
        for (const { key, indices } of jobs) {
          worker().reply({ type: 'results', requestId, fontId: 'f', key, live: true, results: indices.map((index) => ({ index, geometry: geometry(counts[key]) })) })
        }
        done()
      }
      const standIn = (index: number) => {
        const found = client.lookup('not yet computed', index)
        return found && 'geometry' in found.entry ? found.entry.geometry.vertexCount : null
      }
      // The next frame, prefetched (not shown yet): the shared set for every glyph, strong letters of glyph 1, quiet ones of 2.
      client.prefetchJobs([{ params: BASE, key: 'S' }, job('T', [1]), job('Q', [2])])
      answer()
      expect([1, 2, 3].map(standIn)).toEqual([10, 10, 10])
      // The shared set already known: the request sent holds only a level, which still does not stand in.
      client.prefetchJobs([{ params: BASE, key: 'S' }, job('T2', [1, 3])])
      expect(worker().lastRequest.jobs.map((j) => j.key)).toEqual(['T2'])
      answer()
      expect([1, 2, 3].map(standIn)).toEqual([10, 10, 10])
      expect(client.lookup('T2', 3)?.stale).toBe(false)
    })

    it('keeps a live set that every frame asks for, dropping the oldest frames first', () => {
      client.show(font('f'), [1, 2])
      // Four frames of three sets: one shared by all of them, two new ones each.
      for (let n = 1; n <= 4; n++) {
        client.prefetchJobs([{ params: BASE, key: 'S' }, job(`q${n}`, [1]), job(`r${n}`, [2])])
        // The shared set is never computed again.
        expect(worker().lastRequest.jobs.map((j) => j.key)).toEqual(n === 1 ? ['S', 'q1', 'r1'] : [`q${n}`, `r${n}`])
        for (const { key, indices } of worker().lastRequest.jobs) worker().reply(results(key, indices, true))
        done()
      }
      expect(client.lookup('S', 1)?.stale).toBe(false)
      expect(client.lookup('S', 2)?.stale).toBe(false)
      for (const key of ['q4', 'r4', 'q3', 'r3', 'r2']) expect(client.lookup(key, key.startsWith('q') ? 1 : 2)?.stale).toBe(false)
      // Nine sets were made and six are kept: the three asked for longest ago went.
      expect(client.lookup('q1', 1)?.stale).toBe(true)
      expect(client.lookup('r1', 2)?.stale).toBe(true)
      expect(client.lookup('q2', 1)?.stale).toBe(true)
    })

    it('keeps two frames of live sets for frames of many (Thorn turn groups), and six again once frames are small', () => {
      client.show(font('f'), [1, 2])
      const made: string[] = []
      // A frame of `sets` sets: the shared one and new ones.
      const frame = (n: number, sets: number) => {
        const jobs = [{ params: BASE, key: 'S' }, ...Array.from({ length: sets - 1 }, (_, k) => job(`${n}.${k}`, [1]))]
        client.prefetchJobs(jobs)
        for (const { key, indices } of worker().lastRequest.jobs) worker().reply(results(key, indices, true))
        done()
        made.push(...jobs.slice(1).map(({ key }) => key))
      }
      const kept = () => made.filter((key) => client.lookup(key, 1)?.stale === false)
      // Fifteen sets a frame (three levels of five turn groups): the frame on screen and the one being computed fit.
      for (let n = 1; n <= 4; n++) frame(n, 15)
      expect(client.lookup('S', 1)?.stale).toBe(false)
      expect(kept()).toEqual(made.slice(-kept().length))
      expect(kept().length + 1).toBeGreaterThanOrEqual(2 * 15)
      expect(kept().length + 1).toBeLessThanOrEqual(LIVE_KEPT_KEYS)
      // Frames of three sets again: once the larger ones are LIVE_ASKS requests behind, six sets are kept, as before.
      for (let n = 5; n <= 12; n++) frame(n, 3)
      expect(client.lookup('S', 1)?.stale).toBe(false)
      expect(kept()).toEqual(made.slice(-5))
    })

    it('blames a stuck glyph under the set the heartbeat names', async () => {
      client.computeJobs(font('f'), [job('a', [1]), job('b', [2])])
      worker().reply({ type: 'glyph', requestId: worker().lastCompute.requestId, key: 'b', index: 2 })
      await vi.advanceTimersByTimeAsync(61_000)
      expect(workers).toHaveLength(2)
      expect(client.lookup('b', 2)?.entry).toEqual({ error: STUCK })
      expect(client.lookup('a', 1)).toBeNull()
    })

    it('keeps a worker busy with a glyph that any set of the new request still needs', async () => {
      client.compute(font('f'), BASE, 'a', [1])
      worker().reply({ type: 'glyph', requestId: worker().lastCompute.requestId, key: 'a', index: 1 })
      await vi.advanceTimersByTimeAsync(800)
      client.computeJobs(font('f'), [job('b', [2]), job('a', [1])])
      expect(workers).toHaveLength(1)
      expect(worker().computes).toBe(2)
    })

    it('sends the same sets again when the worker does not have the font, and fails every set when it cannot open it', () => {
      client.computeJobs(font('f'), [job('a', [1]), job('b', [2, 3])])
      const w = worker()
      const sent = w.lastRequest.jobs
      w.reply({ type: 'failed', requestId: w.lastCompute.requestId, reason: 'no-font', message: 'no font' })
      expect(w.received.map((m) => m.type)).toEqual(['font', 'compute', 'font', 'compute'])
      expect(w.lastRequest.jobs).toEqual(sent)
      w.reply({ type: 'results', requestId: w.lastCompute.requestId, fontId: 'f', key: 'b', results: [{ index: 2, geometry: geometry(2) }] })
      w.reply({ type: 'failed', requestId: w.lastCompute.requestId, reason: 'font', message: 'bad tables' })
      const problem = { error: 'The geometry worker could not open this font (bad tables).', transient: true }
      expect(client.lookup('a', 1)?.entry).toEqual(problem)
      expect(client.lookup('b', 3)?.entry).toEqual(problem)
      expect(client.lookup('b', 2)?.entry).toEqual({ geometry: geometry(2) })
    })
  })
})
