// The geometry worker's logic (geometry.worker.ts connects it to the worker's messages; tests run it
// with a fake `post`). It opens fonts and runs the geometry pipeline for the page's requests (one or
// more parameter sets each), sending results back in small batches. A newer request or a cancel stops
// a request between glyphs, and every request ends with one answer ('done' or 'failed'), so the page
// never waits on a request that is over.
//
// Requests come in three lanes (protocol.ts Lane), each with its own latest request, so none cancels another's:
// 'canvas' (compute: what the canvas shows now), 'plan' (a Glide plan on demand) and 'ahead' (the precompute window's
// glyphs and Glide chains, aheadCore.ts). They take turns by priority, between glyphs and items: a plan waits while
// the canvas lane computes, and the ahead lane waits while either does.

import type { LoadedFont } from '../font/model'
import { parseFont } from '../font/parse'
import { planMorph, settleInBetween } from '../specimen/morph'
import { decodeGlyph, encodePlan, encodeSettled } from '../specimen/planCodec'
import { AheadCore, type StepRecord } from './aheadCore'
import { cachedGeometry, glyphGeometry, isCached, shareCacheLimits } from './cache'
import { clonePacked, packGeometry, unpackGeometry } from './packed'
import type { AheadResult, GlyphResult, Lane, WorkerRequest, WorkerResponse } from './protocol'
import type { PolygonGlyph } from './types'

/** How long the worker computes before sending what it has and checking for newer requests (ms). */
const BATCH_MS = 40
/** Fonts kept open; older ones are dropped (with their cache) when a new font arrives. */
const MAX_FONTS = 2

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Lets newer messages in before going on (a lower lane resumes once the higher one has posted its answer). */
const idle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The worker's message handler; `post` sends a message to the page (with the buffers to transfer, if any). */
export function createGeometryWorker(post: (message: WorkerResponse, transfer?: Transferable[]) => void): (message: WorkerRequest) => void {
  const fonts = new Map<string, Promise<LoadedFont>>()
  /** Each lane's latest request (0: none, or cancelled). Plans run each to its end unless cancelled. */
  const latest: Record<Exclude<Lane, 'plan'>, number> = { canvas: 0, ahead: 0 }
  /** Requests running in each lane, for the priority between them. */
  const busy: Record<Lane, number> = { canvas: 0, ahead: 0, plan: 0 }
  /** Plan requests not answered yet, and those of them the page cancelled. */
  const plans = new Set<number>()
  const cancelledPlans = new Set<number>()
  const core = new AheadCore()

  async function compute(request: Extract<WorkerRequest, { type: 'compute' }>) {
    const { requestId, fontId } = request
    const loading = fonts.get(fontId)
    if (!loading) return post({ type: 'failed', requestId, reason: 'no-font', message: 'The geometry worker does not have this font.' })
    let font: LoadedFont
    try {
      font = await loading
    } catch (error) {
      return post({ type: 'failed', requestId, reason: 'font', message: errorText(error) })
    }
    // Live frames (parameters Sound is driving) use the live cache; the flag goes back with the results.
    const live = request.live === true
    let batch: GlyphResult[] = []
    let times: (number | null)[] = []
    let started = performance.now()
    const flush = (key: string) => {
      if (batch.length) post({ type: 'results', requestId, fontId, key, results: batch, ...(live ? { live } : {}), times })
      batch = []
      times = []
    }
    for (const { params, key, indices } of request.jobs) {
      for (const index of indices) {
        if (latest.canvas !== requestId) {
          // Superseded or cancelled: the page wants other settings now, or has everything.
          flush(key)
          return post({ type: 'done', requestId, stopped: true })
        }
        post({ type: 'glyph', requestId, key, index })
        // A result from the cache took no time: it says nothing of what the glyph costs to compute.
        const cached = isCached(font, index, key)
        const begun = performance.now()
        try {
          const { source: _source, ...geometry } = glyphGeometry(font, index, params, key, live)
          batch.push({ index, geometry })
        } catch (error) {
          batch.push({ index, error: errorText(error) })
        }
        times.push(cached ? null : performance.now() - begun)
        if (performance.now() - started > BATCH_MS) {
          flush(key)
          // Let newer requests and cancels in before going on.
          await idle()
          started = performance.now()
        }
      }
      // Each 'results' message holds one job's glyphs, so it names one key.
      flush(key)
    }
    post({ type: 'done', requestId })
  }

  /** The window's glyphs (into the ahead store) and chain steps, item after item, below the other lanes. */
  async function ahead(request: Extract<WorkerRequest, { type: 'ahead' }>) {
    const { requestId, fontId, generation, glideMs, playheadMs, items } = request
    const stopped = () => latest.ahead !== requestId
    const done = (stoppedEarly: boolean) =>
      post({ type: 'ahead-done', requestId, ...(stoppedEarly ? { stopped: true } : {}), stored: { bytes: core.size.bytes } })
    let font: LoadedFont
    try {
      const loading = fonts.get(fontId)
      if (!loading) throw new Error('no font')
      font = await loading
    } catch {
      // Without the font nothing of the window can be done; the page sends the font again (or gives up on it).
      return post({ type: 'ahead-done', requestId, stopped: true })
    }
    core.begin(fontId, generation, glideMs, playheadMs)
    core.reserve(items.flatMap((item) => (item.kind === 'step' ? [item] : item.indices.map((index) => ({ seq: item.seq, key: item.key, index, mediaMs: item.mediaMs })))))
    let started = performance.now()
    let plansOf: { seq: number; plans: StepRecord[] } | null = null
    const flushPlans = () => {
      if (plansOf && plansOf.plans.length) post({ type: 'ahead-plans', requestId, generation, seq: plansOf.seq, plans: plansOf.plans })
      plansOf = null
    }
    /** Waits while a higher lane works, and between batches; false once a newer ahead request replaced this one. */
    const turn = async (): Promise<boolean> => {
      if (performance.now() - started > BATCH_MS) {
        await idle()
        started = performance.now()
      }
      while (!stopped() && (busy.canvas > 0 || busy.plan > 0)) {
        await idle()
        started = performance.now()
      }
      return !stopped()
    }
    for (const item of items) {
      if (!(await turn())) {
        flushPlans()
        return done(true)
      }
      if (item.kind === 'step') {
        if (plansOf && plansOf.seq !== item.seq) flushPlans()
        plansOf ??= { seq: item.seq, plans: [] }
        plansOf.plans.push(core.step(item.seq, item.mediaMs, item.lineage, item.parent, item.index, item.key, glideMs))
        continue
      }
      flushPlans()
      const { seq, key, params, indices } = item
      let results: AheadResult[] = []
      let times: (number | null)[] = []
      let transfer: ArrayBuffer[] = []
      const flush = () => {
        if (results.length) post({ type: 'ahead-results', requestId, generation, seq, key, results, times }, transfer)
        results = []
        times = []
        transfer = []
      }
      for (const index of indices) {
        if (results.length && performance.now() - started > BATCH_MS) flush()
        if (!(await turn())) {
          flush()
          return done(true)
        }
        const kept = core.get(key, index, seq, item.mediaMs)
        let ms: number | null = null
        if (kept && 'packed' in kept) {
          // Kept here already: posted again from a copy (posting transfers the buffers, and the store keeps its own).
          const copy = clonePacked(kept.packed)
          results.push({ index, packed: copy.packed })
          transfer.push(...copy.transfer)
        } else if (kept) {
          results.push({ index, error: kept.error })
        } else {
          post({ type: 'glyph', requestId, key, index })
          const begun = performance.now()
          try {
            const { source: _source, ...geometry } = glyphGeometry(font, index, params, key, true, 'ahead')
            const { packed, transfer: buffers } = packGeometry(geometry)
            ms = performance.now() - begun
            // With Glide, the store keeps a copy of its own: the posted buffers move to the page.
            if (glideMs > 0) core.put(key, index, { packed: clonePacked(packed).packed }, seq, item.mediaMs)
            results.push({ index, packed })
            transfer.push(...buffers)
          } catch (error) {
            ms = performance.now() - begun
            core.put(key, index, { error: errorText(error) }, seq, item.mediaMs)
            results.push({ index, error: errorText(error) })
          }
        }
        times.push(ms)
      }
      flush()
    }
    flushPlans()
    done(false)
  }

  /** One glide planned on demand, after whatever the canvas lane is computing. */
  async function plan(request: Extract<WorkerRequest, { type: 'plan' }>) {
    const { requestId } = request
    try {
      while (busy.canvas > 0 && !cancelledPlans.has(requestId)) await idle()
      if (cancelledPlans.has(requestId)) return
      const from = decodeGlyph(request.from)
      let to: PolygonGlyph | null = null
      if ('glyph' in request.to) to = decodeGlyph(request.to)
      else {
        const { key, index } = request.to
        const stored = core.get(key, index)
        if (stored && 'packed' in stored) to = unpackGeometry(stored.packed).polygon
        else {
          const font = await fonts.get(request.fontId)?.catch(() => undefined)
          to = (font && cachedGeometry(font, index, key)?.polygon) ?? null
        }
      }
      const settled = to ? settleInBetween(from, to) : from
      const planned = to ? planMorph(settled, to) : null
      const data = planned ? encodePlan(planned).data : null
      post({ type: 'plan-result', requestId, data: data && settled !== from ? { ...data, settled: encodeSettled(settled) } : data })
    } finally {
      plans.delete(requestId)
      cancelledPlans.delete(requestId)
    }
  }

  const fail = (requestId: number, error: unknown) => {
    try {
      post({ type: 'failed', requestId, reason: 'internal', message: errorText(error) })
    } catch {
      // Nothing more can reach the page; its watchdog restarts a worker that has gone silent.
    }
  }

  /** Runs a request in its lane, counted as busy while it runs. */
  const run = (lane: Lane, work: Promise<void>, onError: (error: unknown) => void) => {
    busy[lane]++
    work.catch(onError).finally(() => busy[lane]--)
  }

  return (message) => {
    if (message.type === 'font') {
      shareCacheLimits(message.workers ?? 1)
      const loading = parseFont(message.bytes, message.source, new AbortController().signal)
      loading.catch((error) => post({ type: 'font-error', fontId: message.fontId, message: errorText(error) }))
      // A font sent again goes to the back, so the current font is never the one dropped.
      fonts.delete(message.fontId)
      fonts.set(message.fontId, loading)
      while (fonts.size > MAX_FONTS) fonts.delete(fonts.keys().next().value!)
    } else if (message.type === 'cancel') {
      // Request ids are unique across lanes: the cancel stops whichever lane runs it.
      if (latest.canvas === message.requestId) latest.canvas = 0
      if (latest.ahead === message.requestId) latest.ahead = 0
      if (plans.has(message.requestId)) cancelledPlans.add(message.requestId)
    } else if (message.type === 'compute') {
      latest.canvas = message.requestId
      run('canvas', compute(message), (error) => fail(message.requestId, error))
    } else if (message.type === 'ahead') {
      latest.ahead = message.requestId
      run('ahead', ahead(message), () => post({ type: 'ahead-done', requestId: message.requestId, stopped: true }))
    } else if (message.type === 'plan') {
      plans.add(message.requestId)
      run('plan', plan(message), () => post({ type: 'plan-result', requestId: message.requestId, data: null }))
    } else if (message.type === 'ahead-release') {
      if (message.beforeSeq === Infinity) core.clear()
      else core.release(message.beforeSeq)
    }
  }
}
