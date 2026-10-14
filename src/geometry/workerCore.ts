// The geometry worker's logic (geometry.worker.ts connects it to the worker's messages; tests run it
// with a fake `post`). It opens fonts and runs the geometry pipeline for the page's requests (one or
// more parameter sets each), sending results back in small batches. A newer request or a cancel stops
// a request between glyphs, and every request ends with one answer ('done' or 'failed'), so the page
// never waits on a request that is over.

import type { LoadedFont } from '../font/model'
import { parseFont } from '../font/parse'
import { glyphGeometry } from './cache'
import type { GlyphResult, WorkerRequest, WorkerResponse } from './protocol'

/** How long the worker computes before sending what it has and checking for newer requests (ms). */
const BATCH_MS = 40
/** Fonts kept open; older ones are dropped (with their cache) when a new font arrives. */
const MAX_FONTS = 2

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The worker's message handler; `post` sends a message to the page. */
export function createGeometryWorker(post: (message: WorkerResponse) => void): (message: WorkerRequest) => void {
  const fonts = new Map<string, Promise<LoadedFont>>()
  let latestRequest = 0

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
    let started = performance.now()
    const flush = (key: string) => {
      if (batch.length) post({ type: 'results', requestId, fontId, key, results: batch, ...(live ? { live } : {}) })
      batch = []
    }
    for (const { params, key, indices } of request.jobs) {
      for (const index of indices) {
        if (latestRequest !== requestId) {
          // Superseded or cancelled: the page wants other settings now, or has everything.
          flush(key)
          return post({ type: 'done', requestId, stopped: true })
        }
        post({ type: 'glyph', requestId, key, index })
        try {
          const { source: _source, ...geometry } = glyphGeometry(font, index, params, key, live)
          batch.push({ index, geometry })
        } catch (error) {
          batch.push({ index, error: errorText(error) })
        }
        if (performance.now() - started > BATCH_MS) {
          flush(key)
          // Let newer requests and cancels in before going on.
          await new Promise((resolve) => setTimeout(resolve, 0))
          started = performance.now()
        }
      }
      // Each 'results' message holds one job's glyphs, so it names one key.
      flush(key)
    }
    post({ type: 'done', requestId })
  }

  const fail = (requestId: number, error: unknown) => {
    try {
      post({ type: 'failed', requestId, reason: 'internal', message: errorText(error) })
    } catch {
      // Nothing more can reach the page; its watchdog restarts a worker that has gone silent.
    }
  }

  return (message) => {
    if (message.type === 'font') {
      const loading = parseFont(message.bytes, message.source, new AbortController().signal)
      loading.catch((error) => post({ type: 'font-error', fontId: message.fontId, message: errorText(error) }))
      // A font sent again goes to the back, so the current font is never the one dropped.
      fonts.delete(message.fontId)
      fonts.set(message.fontId, loading)
      while (fonts.size > MAX_FONTS) fonts.delete(fonts.keys().next().value!)
    } else if (message.type === 'cancel') {
      if (latestRequest === message.requestId) latestRequest = 0
    } else {
      latestRequest = message.requestId
      compute(message).catch((error) => fail(message.requestId, error))
    }
  }
}
