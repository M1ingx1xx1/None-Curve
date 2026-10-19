// The page's side of the workers' lanes (src/state/geometryClient.ts, NOCUR-82) against fake Workers and fake timers:
// ahead work is pinned per glyph (index % workers), so a glyph's chain steps go where its states are; only the canvas
// lane counts as computing; ahead results stand in like any result; plans are answered, cancelled, or end with null on
// a restart; and the watchdog blames the glyph in the lane that was on it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedFont } from '../../src/font/model'
import type { AheadItem, EncodedGlyph, WorkerGeometry, WorkerRequest } from '../../src/geometry/protocol'
import type { PlanData } from '../../src/specimen/planData'
import { GeometryClient } from '../../src/state/geometryClient'
import { FakeWorker } from '../helpers/fakeWorker'
import { BASE } from '../helpers/params'

const font = (id: string) => ({ id, bytes: new Uint8Array(4), source: { kind: 'local', fileName: `${id}.ttf`, byteSize: 4 } }) as unknown as LoadedFont
const geometry = (index: number) => ({ polygon: { ref: { index, name: '', unicode: null }, metrics: {}, contours: [] }, vertexCount: index }) as unknown as WorkerGeometry
const shape = (index: number): EncodedGlyph => ({ glyph: geometry(index).polygon, kept: null, pose: null })
const glyphs = (seq: number, key: string, indices: number[]): AheadItem => ({ kind: 'glyphs', seq, key, params: BASE, indices })
const step = (seq: number, index: number): AheadItem => ({ kind: 'step', seq, mediaMs: 0, lineage: index, parent: -1, index, key: 'k' })
const aheadOf = (w: FakeWorker) => w.received.filter((m) => m.type === 'ahead').at(-1) as Extract<WorkerRequest, { type: 'ahead' }> | undefined
const planOf = (w: FakeWorker) => w.received.filter((m) => m.type === 'plan').at(-1) as Extract<WorkerRequest, { type: 'plan' }>

const STUCK = 'Took longer than 5 s; try lighter settings'

describe('geometry client lanes', () => {
  let workers: FakeWorker[]
  let client: GeometryClient

  /** A client with `size` workers that holds font 'f' (the canvas asked for a glyph, answered). */
  const pool = (size: number) => {
    workers = []
    client = new GeometryClient({
      workers: size,
      watchdogMs: 5_000,
      createWorker: () => {
        const w = new FakeWorker()
        workers.push(w)
        return w as unknown as Worker
      },
    })
    client.compute(font('f'), BASE, 'base', [1])
    for (const w of workers) {
      const request = w.received.find((m) => m.type === 'compute')
      if (request?.type === 'compute') w.reply({ type: 'done', requestId: request.requestId })
    }
    expect(client.isComputing()).toBe(false)
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'queueMicrotask'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pins ahead work to one worker per glyph, and steps go with their glyphs', () => {
    pool(3)
    expect(workers).toHaveLength(3)
    expect(client.sendAhead('f', 1, 150, [glyphs(1, 'k', [0, 1, 2, 3, 4, 5]), step(1, 4), step(1, 2)])).toBe(true)
    workers.forEach((w, n) => {
      const items = aheadOf(w)!.items
      expect(items[0]).toMatchObject({ kind: 'glyphs', indices: [0, 1, 2, 3, 4, 5].filter((i) => i % 3 === n) })
      expect(items.slice(1).map((i) => (i.kind === 'step' ? i.index : -1))).toEqual([4, 2].filter((i) => i % 3 === n))
    })
    // Request ids are unique across workers (a cancel names one request).
    expect(new Set(workers.map((w) => aheadOf(w)!.requestId)).size).toBe(3)
    // Work for one glyph only: the other workers are told to stop.
    client.sendAhead('f', 1, 150, [glyphs(2, 'k', [3])])
    expect(aheadOf(workers[0])!.items).toEqual([glyphs(2, 'k', [3])])
    expect(workers[1].received.at(-1)?.type).toBe('cancel')
    expect(workers[2].received.at(-1)?.type).toBe('cancel')
    // Another font than the one held: nothing is sent.
    expect(client.sendAhead('g', 1, 150, [glyphs(3, 'k', [0])])).toBe(false)
  })

  it('isComputing ignores the ahead and plan lanes; ahead results stand in like any result', () => {
    pool(1)
    const w = workers[0]
    client.sendAhead('f', 1, 0, [glyphs(1, 'k', [1, 2])])
    expect(client.requestPlan(shape(1), { key: 'k', index: 1 }, () => {})).not.toBeNull()
    expect(client.isComputing()).toBe(false)
    const { requestId } = aheadOf(w)!
    w.reply({ type: 'ahead-results', requestId, generation: 1, seq: 1, key: 'k', results: [{ index: 1, geometry: geometry(1) }, { index: 2, geometry: geometry(2) }], times: [3, 4] })
    expect(client.lookup('k', 1)).toEqual({ entry: { geometry: geometry(1) }, stale: false })
    expect(client.has('k', 2)).toBe(true)
    const held = client.lookup('k', 2)!.entry as { geometry: WorkerGeometry }
    expect(client.keyOf(held.geometry.polygon)).toBe('k')
    // The canvas asking for them sends nothing: the ahead store has them.
    const computes = w.computes
    client.compute(font('f'), BASE, 'k', [1, 2])
    expect(w.computes).toBe(computes)
    expect(client.isComputing()).toBe(false)
  })

  it('answers plans, and a cancelled plan is told to the worker and never answered', () => {
    pool(1)
    const w = workers[0]
    const answers: (PlanData | null)[] = []
    client.requestPlan(shape(1), { key: 'k', index: 1 }, (data) => answers.push(data))
    const data = { version: 1 } as unknown as PlanData
    w.reply({ type: 'plan-result', requestId: planOf(w).requestId, data })
    expect(answers).toEqual([data])
    const cancel = client.requestPlan(shape(1), shape(2), (d) => answers.push(d))!
    const { requestId } = planOf(w)
    cancel()
    expect(w.received.at(-1)).toEqual({ type: 'cancel', requestId })
    w.reply({ type: 'plan-result', requestId, data: null })
    expect(answers).toEqual([data])
  })

  it('restarts a worker silent in the ahead lane, blames its ahead glyph, and ends its plans with null', async () => {
    pool(1)
    const first = workers[0]
    const answers: (PlanData | null)[] = []
    const ended: boolean[] = []
    client.setAheadListener({ results: () => {}, plans: () => {}, ended: (stopped) => ended.push(stopped) })
    client.requestPlan(shape(1), { key: 'k', index: 1 }, (d) => answers.push(d))
    client.sendAhead('f', 1, 0, [glyphs(1, 'k', [7, 8])])
    first.reply({ type: 'glyph', requestId: aheadOf(first)!.requestId, key: 'k', index: 7 })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(workers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(first.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(client.lookup('k', 7)?.entry).toEqual({ error: STUCK })
    expect(client.lookup('k', 8)).toBeNull()
    // Blamed in the ahead lane: the canvas store did not get it.
    expect(client.lookup('base', 7)).toBeNull()
    expect(answers).toEqual([null])
    expect(ended).toEqual([true])
    expect(client.isComputing()).toBe(false)
  })
})
