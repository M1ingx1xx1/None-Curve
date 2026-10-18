// The geometry worker's logic (src/geometry/workerCore.ts) with a fake `post`: every compute request ends with one
// 'done' or one 'failed', a heartbeat goes out before each glyph, and a cancel or a newer request stops it. A request
// with several jobs (parameter sets) computes them in order, and every 'results' message holds one job's key.

import { describe, expect, it, vi } from 'vitest'
import type { FontSource } from '../../src/font/model'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { WorkerRequest, WorkerResponse } from '../../src/geometry/protocol'
import { createGeometryWorker } from '../../src/geometry/workerCore'
import { fixtureBytes, loadFixture, localSource, sampleGlyphs } from '../helpers/fonts'
import { ALL_DEFAULT, BASE, GEOMETRY, paramsWith } from '../helpers/params'
import { makeCollection } from '../helpers/sfnt'

type Compute = Extract<WorkerRequest, { type: 'compute' }>

/** A glyph index whose geometry throws, as a glyph with broken data would. */
const BROKEN = 999_999

vi.mock('../../src/geometry/cache', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/geometry/cache')>()
  return {
    ...real,
    glyphGeometry: (...args: Parameters<typeof real.glyphGeometry>) => {
      if (args[1] === BROKEN) throw new Error('broken glyph data')
      return real.glyphGeometry(...args)
    },
  }
})

/** A worker with a fake `post` that records what it sends; `reply` lets a test answer messages as they arrive. */
function worker(reply: (message: WorkerResponse, send: (m: WorkerRequest) => void) => void = () => {}) {
  const sent: WorkerResponse[] = []
  const send = createGeometryWorker((message) => {
    sent.push(message)
    reply(message, send)
  })
  const ended = (requestId: number) => sent.find((m) => (m.type === 'done' || m.type === 'failed') && m.requestId === requestId)
  const until = (requestId: number) => vi.waitFor(() => expect(ended(requestId)).toBeDefined(), { timeout: 20_000, interval: 5 })
  const of = (requestId: number) => sent.filter((m) => 'requestId' in m && m.requestId === requestId)
  return { sent, send, ended, until, of }
}

const roboto = fixtureBytes('Roboto')
const robotoSource: FontSource = localSource('Roboto.ttf', roboto)
const job = (indices: number[], params = BASE) => ({ params, key: `${JSON.stringify(params)}`, indices })
const compute = (requestId: number, indices: number[], params = BASE, fontId = 'roboto'): Compute => ({
  type: 'compute',
  requestId,
  fontId,
  jobs: [job(indices, params)],
})

describe('geometry worker core', async () => {
  const font = await loadFixture('Roboto')
  const glyphs = sampleGlyphs(font).map((g) => g.index)

  it('computes every glyph, with one heartbeat before each, and ends with done', async () => {
    const w = worker()
    w.send({ type: 'font', fontId: 'roboto', bytes: roboto, source: robotoSource })
    w.send(compute(1, glyphs.slice(0, 12)))
    await w.until(1)
    const messages = w.of(1)
    expect(messages.filter((m) => m.type === 'glyph').map((m) => (m as { index: number }).index)).toEqual(glyphs.slice(0, 12))
    const results = messages.flatMap((m) => (m.type === 'results' ? m.results : []))
    expect(results.map((r) => r.index)).toEqual(glyphs.slice(0, 12))
    expect(results.every((r) => 'geometry' in r)).toBe(true)
    // Each heartbeat comes before its glyph's result, and the request ends with exactly one 'done'.
    expect(messages[messages.length - 1]).toEqual({ type: 'done', requestId: 1 })
    expect(messages.filter((m) => m.type === 'done' || m.type === 'failed')).toHaveLength(1)
    const first = results[0]
    expect('geometry' in first && first.geometry.polygon).toEqual(deriveGeometry(font.getGlyph(glyphs[0]), BASE).polygon)
  })

  it('times each glyph it computes, and gives no time for one its cache already held', async () => {
    const w = worker()
    w.send({ type: 'font', fontId: 'roboto', bytes: roboto, source: robotoSource, workers: 2 })
    w.send(compute(1, glyphs.slice(0, 4)))
    await w.until(1)
    const times = (requestId: number) => w.of(requestId).flatMap((m) => (m.type === 'results' ? (m.times ?? []) : []))
    expect(times(1)).toHaveLength(4)
    for (const ms of times(1)) expect(typeof ms).toBe('number')
    w.send(compute(2, [...glyphs.slice(2, 4), glyphs[4]]))
    await w.until(2)
    expect(times(2).slice(0, 2)).toEqual([null, null])
    expect(typeof times(2)[2]).toBe('number')
  })

  it('answers a request for a font it does not have with failed (no-font)', async () => {
    const w = worker()
    w.send(compute(7, glyphs.slice(0, 2)))
    await w.until(7)
    expect(w.of(7)).toEqual([{ type: 'failed', requestId: 7, reason: 'no-font', message: expect.any(String) }])
  })

  it('reports a font it cannot open (font-error, then failed: font)', async () => {
    const w = worker()
    const junk = new Uint8Array(64).fill(7)
    w.send({ type: 'font', fontId: 'junk', bytes: junk, source: localSource('junk.ttf', junk) })
    w.send(compute(3, [1], BASE, 'junk'))
    await w.until(3)
    expect(w.sent.some((m) => m.type === 'font-error' && m.fontId === 'junk')).toBe(true)
    expect(w.of(3)).toEqual([{ type: 'failed', requestId: 3, reason: 'font', message: expect.any(String) }])
  })

  it('sends a glyph that throws as an error result and still ends with done', async () => {
    const w = worker()
    w.send({ type: 'font', fontId: 'roboto', bytes: roboto, source: robotoSource })
    w.send(compute(4, [glyphs[0], BROKEN, glyphs[1]]))
    await w.until(4)
    const results = w.of(4).flatMap((m) => (m.type === 'results' ? m.results : []))
    expect(results.map((r) => [r.index, 'error' in r ? r.error : 'ok'])).toEqual([
      [glyphs[0], 'ok'],
      [BROKEN, 'broken glyph data'],
      [glyphs[1], 'ok'],
    ])
    expect(w.ended(4)).toEqual({ type: 'done', requestId: 4 })
  })

  it('answers failed (internal) when something outside a glyph throws', async () => {
    let thrown = false
    const w = worker((message) => {
      if (message.type === 'glyph' && !thrown) {
        thrown = true
        throw new Error('the page went away')
      }
    })
    w.send({ type: 'font', fontId: 'roboto', bytes: roboto, source: robotoSource })
    w.send(compute(5, glyphs.slice(0, 3)))
    await w.until(5)
    expect(w.ended(5)).toEqual({ type: 'failed', requestId: 5, reason: 'internal', message: 'the page went away' })
    expect(w.of(5).filter((m) => m.type === 'done')).toEqual([])
  })

  it('stops between glyphs on a cancel, and on a newer request', async () => {
    const heavy = paramsWith(GEOMETRY.plain, ALL_DEFAULT)
    // Cancel request 10 when its first batch arrives; on request 11's first batch, send request 12.
    const w = worker((message, send) => {
      if (message.type !== 'results') return
      if (message.requestId === 10) send({ type: 'cancel', requestId: 10 })
      if (message.requestId === 11) send(compute(12, glyphs.slice(0, 2)))
    })
    w.send({ type: 'font', fontId: 'roboto', bytes: roboto, source: robotoSource })
    w.send(compute(10, glyphs, heavy))
    await w.until(10)
    expect(w.ended(10)).toEqual({ type: 'done', requestId: 10, stopped: true })
    const done10 = w.of(10).flatMap((m) => (m.type === 'results' ? m.results : [])).length
    expect(done10).toBeLessThan(glyphs.length)

    w.send(compute(11, glyphs, { ...heavy, experimental: { ...heavy.experimental, seed: 2 } }))
    // Request 12 may end first: request 11 notices it between glyphs, after its batch.
    await w.until(11)
    await w.until(12)
    expect(w.ended(11)).toEqual({ type: 'done', requestId: 11, stopped: true })
    expect(w.ended(12)).toEqual({ type: 'done', requestId: 12 })
  })

  it('computes the jobs in order, each results message under one key, with keyed heartbeats and one done', async () => {
    const seeded = paramsWith(GEOMETRY.plain, ALL_DEFAULT)
    const jobs = [job(glyphs.slice(0, 3)), job(glyphs.slice(1, 3), seeded)]
    const w = worker()
    w.send({ type: 'font', fontId: 'roboto', bytes: roboto, source: robotoSource })
    w.send({ type: 'compute', requestId: 30, fontId: 'roboto', jobs, live: true })
    await w.until(30)
    const messages = w.of(30)
    const pairs = (m: WorkerResponse) => (m.type === 'results' ? m.results.map((r) => `${m.key}|${r.index}`) : [])
    const expected = jobs.flatMap(({ key, indices }) => indices.map((index) => `${key}|${index}`))
    expect(messages.filter((m) => m.type === 'glyph').map((m) => (m.type === 'glyph' ? `${m.key}|${m.index}` : ''))).toEqual(expected)
    expect(messages.flatMap(pairs)).toEqual(expected)
    // Every batch is one job's glyphs, and keeps the live flag.
    for (const m of messages) if (m.type === 'results') expect(m.live).toBe(true)
    const second = messages.flatMap((m) => (m.type === 'results' && m.key === jobs[1].key ? m.results : []))
    const shape = second[0]
    expect('geometry' in shape && shape.geometry.polygon).toEqual(deriveGeometry(font.getGlyph(glyphs[1]), seeded).polygon)
    expect(messages.filter((m) => m.type === 'done' || m.type === 'failed')).toEqual([{ type: 'done', requestId: 30 }])
    expect(messages.at(-1)).toEqual({ type: 'done', requestId: 30 })
  })

  it('stops between jobs on a newer request', async () => {
    const first = job(glyphs.slice(0, 2))
    const last = first.indices.at(-1)
    // When the first job's last glyph arrives, a newer request comes in: the second job is never started.
    const w = worker((message, send) => {
      if (message.type === 'results' && message.requestId === 40 && message.results.some((r) => r.index === last)) send(compute(41, glyphs.slice(0, 1)))
    })
    w.send({ type: 'font', fontId: 'roboto', bytes: roboto, source: robotoSource })
    w.send({ type: 'compute', requestId: 40, fontId: 'roboto', jobs: [first, job(glyphs.slice(2, 4), paramsWith(GEOMETRY.plain, ALL_DEFAULT))] })
    await w.until(40)
    await w.until(41)
    expect(w.ended(40)).toEqual({ type: 'done', requestId: 40, stopped: true })
    expect(w.of(40).filter((m) => (m.type === 'results' || m.type === 'glyph') && m.key !== first.key)).toEqual([])
    expect(w.ended(41)).toEqual({ type: 'done', requestId: 41 })
  })

  it('opens the face of a collection the source names', async () => {
    const collection = makeCollection([fixtureBytes('STIXTwoText'), roboto])
    const w = worker()
    w.send({ type: 'font', fontId: 'both', bytes: collection, source: localSource('Both.ttc', collection, 1) })
    w.send(compute(20, glyphs.slice(0, 3), BASE, 'both'))
    await w.until(20)
    const results = w.of(20).flatMap((m) => (m.type === 'results' ? m.results : []))
    expect(results.map((r) => ('geometry' in r ? r.geometry.polygon.contours : r.error))).toEqual(
      glyphs.slice(0, 3).map((index) => deriveGeometry(font.getGlyph(index), BASE).polygon.contours),
    )
  })
})
