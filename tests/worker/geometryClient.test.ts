// The page's side of the geometry worker (src/state/geometryClient.ts) against a fake Worker and fake timers: the
// watchdog restarts a silent worker and blames the glyph it was on, restarts are limited, a worker busy with
// superseded settings is replaced, and a worker that cannot start or open the font fails the glyphs with a reason.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedFont } from '../../src/font/model'
import type { WorkerGeometry, WorkerRequest, WorkerResponse } from '../../src/geometry/protocol'
import { GeometryClient } from '../../src/state/geometryClient'
import { BASE } from '../helpers/params'

class FakeWorker {
  readonly received: WorkerRequest[] = []
  terminated = false
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage(message: WorkerRequest) {
    this.received.push(message)
  }
  terminate() {
    this.terminated = true
  }
  /** The worker answers the page. */
  reply(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>)
  }
  /** The newest compute request it was sent. */
  get lastCompute() {
    return this.received.filter((m) => m.type === 'compute').at(-1) as Extract<WorkerRequest, { type: 'compute' }>
  }
}

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
    worker().reply({ type: 'glyph', requestId, index: 1 })
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
    first.reply({ type: 'glyph', requestId, index: 5 })
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
      worker().reply({ type: 'glyph', requestId, index })
      await vi.advanceTimersByTimeAsync(45_000)
    }
    expect(workers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(16_000)
    expect(workers).toHaveLength(2)
    expect(client.lookup('k1', 3)?.entry).toEqual({ error: STUCK })
  })

  it('stops after more than 3 restarts within a minute, until the next font', async () => {
    client = new GeometryClient({ createWorker: () => (workers.push(new FakeWorker()), worker() as unknown as Worker), watchdogMs: 5_000 })
    for (let k = 0; k < 4; k++) {
      client.compute(font('f'), BASE, `k${k}`, [k])
      worker().reply({ type: 'glyph', requestId: worker().lastCompute.requestId, index: k })
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
    first.reply({ type: 'glyph', requestId: first.lastCompute.requestId, index: 1 })
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
    worker().reply({ type: 'glyph', requestId: worker().lastCompute.requestId, index: 1 })
    await vi.advanceTimersByTimeAsync(100)
    client.compute(font('f'), BASE, 'new', [2])
    expect(workers).toHaveLength(1)
    expect(worker().received.map((m) => m.type)).toEqual(['font', 'compute', 'compute'])
  })

  it('fails the glyphs with a reason when no worker can start', () => {
    client = new GeometryClient({
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
    expect(lookup(1)).toEqual({ polygon: geometry(1).polygon })
    expect(lookup(2)).toEqual({ error: 'bad' })
  })
})
