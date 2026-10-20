// The geometry worker's lanes (src/geometry/workerCore.ts, NOCUR-82), with a fake `post`: the canvas lane goes first,
// then plans, then the precompute window; no lane cancels another's request, and a newer ahead request replaces the
// older between items.

import { describe, expect, it, vi } from 'vitest'
import type { AheadItem, WorkerRequest, WorkerResponse } from '../../src/geometry/protocol'
import { paramsKey } from '../../src/geometry/cache'
import { unpackGeometry } from '../../src/geometry/packed'
import { deriveGeometry } from '../../src/geometry/pipeline'
import { createGeometryWorker } from '../../src/geometry/workerCore'
import { morphAt, planMorph } from '../../src/specimen/morph'
import { decodePlan, encodeGlyph } from '../../src/specimen/planCodec'
import { fixtureBytes, loadFixture, localSource, sampleGlyphs } from '../helpers/fonts'
import { ALL_DEFAULT, BASE, GEOMETRY, paramsWith } from '../helpers/params'
import { burst, glyphOf } from '../helpers/planCases'

function worker(reply: (message: WorkerResponse, send: (m: WorkerRequest) => void) => void = () => {}) {
  const sent: WorkerResponse[] = []
  const transfers = new Map<WorkerResponse, readonly Transferable[]>()
  const send = createGeometryWorker((message, transfer) => {
    sent.push(message)
    if (transfer) transfers.set(message, transfer)
    reply(message, send)
  })
  const index = (match: (m: WorkerResponse) => boolean) => sent.findIndex(match)
  const until = (match: (m: WorkerResponse) => boolean) => vi.waitFor(() => expect(index(match)).toBeGreaterThanOrEqual(0), { timeout: 30_000, interval: 5 })
  return { sent, send, index, until, transfers }
}

const roboto = fixtureBytes('Roboto')
const font = { type: 'font', fontId: 'roboto', bytes: roboto, source: localSource('Roboto.ttf', roboto) } as const
const heavy = paramsWith(GEOMETRY.plain, ALL_DEFAULT)
const glyphItem = (seq: number, indices: number[], params = heavy): AheadItem => ({ kind: 'glyphs', seq, key: paramsKey(params), params, indices })
const ahead = (requestId: number, items: AheadItem[], generation = 1): Extract<WorkerRequest, { type: 'ahead' }> => ({ type: 'ahead', requestId, fontId: 'roboto', generation, glideMs: 150, playheadMs: 0, items })
const doneOf = (id: number) => (m: WorkerResponse) => (m.type === 'done' || m.type === 'ahead-done') && m.requestId === id

describe('worker lanes', async () => {
  const loaded = await loadFixture('Roboto')
  const glyphs = sampleGlyphs(loaded).map((g) => g.index)

  it('a canvas compute during an ahead request finishes first, and does not cancel it', async () => {
    let sentCompute = false
    const w = worker((message, send) => {
      if (message.type === 'ahead-results' && !sentCompute) {
        sentCompute = true
        send({ type: 'compute', requestId: 2, fontId: 'roboto', jobs: [{ params: BASE, key: paramsKey(BASE), indices: glyphs.slice(0, 3) }] })
      }
    })
    w.send(font)
    w.send(ahead(1, [glyphItem(1, glyphs.slice(0, 30))]))
    await w.until(doneOf(1))
    await w.until(doneOf(2))
    expect(w.index(doneOf(2))).toBeLessThan(w.index(doneOf(1)))
    expect(w.sent[w.index(doneOf(1))]).toMatchObject({ type: 'ahead-done', requestId: 1 })
    expect(w.sent[w.index(doneOf(1))]).not.toHaveProperty('stopped')
    const results = w.sent.flatMap((m) => (m.type === 'ahead-results' ? m.results.map((r) => r.index) : []))
    expect(results).toEqual(glyphs.slice(0, 30))
  })

  it('posts the window’s glyphs packed, their arrays transferred, and keeps a copy only with Glide (NOCUR-85)', async () => {
    for (const glideMs of [150, 0]) {
      const w = worker()
      w.send(font)
      w.send({ ...ahead(1, [glyphItem(1, glyphs.slice(0, 3), BASE)]), glideMs })
      await w.until(doneOf(1))
      const results = w.sent.filter((m): m is Extract<WorkerResponse, { type: 'ahead-results' }> => m.type === 'ahead-results')
      const packed = results.flatMap((m) => m.results)
      expect(packed.map((r) => r.index)).toEqual(glyphs.slice(0, 3))
      for (const message of results) {
        const transfer = w.transfers.get(message)!
        for (const result of message.results) {
          if (!('packed' in result)) throw new Error('expected a glyph')
          expect(transfer).toContain(result.packed.contours.xy.buffer)
          const { source: _source, ...want } = deriveGeometry(loaded.getGlyph(result.index), BASE)
          expect(unpackGeometry(result.packed)).toEqual(want)
        }
      }
      const done = w.sent[w.index(doneOf(1))] as Extract<WorkerResponse, { type: 'ahead-done' }>
      if (glideMs > 0) expect(done.stored!.bytes).toBeGreaterThan(0)
      else expect(done.stored?.bytes ?? 0).toBe(0)
    }
  })

  it('a newer ahead request replaces the older one between items', async () => {
    let replaced = false
    const w = worker((message, send) => {
      if (message.type === 'ahead-results' && message.requestId === 1 && !replaced) {
        replaced = true
        send(ahead(3, [glyphItem(2, glyphs.slice(0, 2), BASE)]))
      }
    })
    w.send(font)
    w.send(ahead(1, [glyphItem(1, glyphs.slice(0, 40))]))
    await w.until(doneOf(1))
    await w.until(doneOf(3))
    expect(w.sent[w.index(doneOf(1))]).toMatchObject({ type: 'ahead-done', requestId: 1, stopped: true })
    expect(w.sent[w.index(doneOf(3))]).toMatchObject({ type: 'ahead-done', requestId: 3 })
    expect(w.sent[w.index(doneOf(3))]).not.toHaveProperty('stopped')
  })

  it('steps chains after their glyphs and answers plans on demand after the canvas lane', async () => {
    const w = worker()
    w.send(font)
    const index = glyphs[1]
    const [k1, k2] = [paramsKey(burst(1)), paramsKey(burst(2))]
    w.send(
      ahead(5, [
        { kind: 'glyphs', seq: 1, key: k1, params: burst(1), indices: [index] },
        { kind: 'step', seq: 1, mediaMs: 0, lineage: 1, parent: -1, index, key: k1 },
        { kind: 'glyphs', seq: 2, key: k2, params: burst(2), indices: [index] },
        { kind: 'step', seq: 2, mediaMs: 33, lineage: 2, parent: 1, index, key: k2 },
      ]),
    )
    await w.until(doneOf(5))
    const plans = w.sent.flatMap((m) => (m.type === 'ahead-plans' ? [m] : []))
    expect(plans.map((m) => m.seq)).toEqual([1, 2])
    expect(plans[0].plans).toEqual([{ lineage: 1, from: { kind: 'computed', key: k1 }, data: null, unchanged: true }])
    expect(plans[1].plans[0]).toMatchObject({ lineage: 2, from: { kind: 'computed', key: k1 } })
    expect(plans[1].plans[0].data).not.toBeNull()

    // A plan on demand, from an in-between glyph sent by value, waits for the canvas compute sent before it.
    const a = await glyphOf('Roboto', 'Hamburg', 1, burst(1))
    const b = await glyphOf('Roboto', 'Hamburg', 1, burst(2))
    const between = morphAt(planMorph(a, b)!, 0.4)
    w.send({ type: 'compute', requestId: 6, fontId: 'roboto', jobs: [{ params: heavy, key: paramsKey(heavy), indices: glyphs.slice(0, 6) }] })
    w.send({ type: 'plan', requestId: 7, fontId: 'roboto', from: structuredClone(encodeGlyph(between)), to: structuredClone(encodeGlyph(a)) })
    await w.until((m) => m.type === 'plan-result' && m.requestId === 7)
    expect(w.index(doneOf(6))).toBeLessThan(w.index((m) => m.type === 'plan-result' && m.requestId === 7))
    const result = w.sent.find((m) => m.type === 'plan-result' && m.requestId === 7)
    const data = result?.type === 'plan-result' ? result.data : null
    expect(data?.settled).not.toBeNull()
    // Decoded on the page's own glyphs, it starts from the settled shape and ends at the target.
    const plan = decodePlan(data!, between, a)
    expect(morphAt(plan, 1)).toBe(a)
  })

  it('a cancelled plan gets no answer', async () => {
    const w = worker()
    w.send(font)
    const a = await glyphOf('Roboto', 'Hamburg', 0, burst(1))
    w.send({ type: 'compute', requestId: 8, fontId: 'roboto', jobs: [{ params: heavy, key: paramsKey(heavy), indices: glyphs.slice(0, 4) }] })
    w.send({ type: 'plan', requestId: 9, fontId: 'roboto', from: encodeGlyph(a), to: encodeGlyph(a) })
    w.send({ type: 'cancel', requestId: 9 })
    await w.until(doneOf(8))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(w.sent.some((m) => m.type === 'plan-result')).toBe(false)
  })
})
