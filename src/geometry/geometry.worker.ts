// Geometry worker: opens the font itself and runs the geometry pipeline off the page's main thread,
// so sliders, typing, and dragging stay smooth however long a glyph takes. Results go back in small
// batches; a newer request stops an older one between glyphs.

import type { LoadedFont } from '../font/model'
import { parseFont } from '../font/parse'
import { glyphGeometry } from './cache'
import type { GlyphResult, WorkerRequest, WorkerResponse } from './protocol'

/** How long the worker computes before sending what it has and checking for newer requests (ms). */
const BATCH_MS = 40
/** Fonts kept open; older ones are dropped (with their cache) when a new font arrives. */
const MAX_FONTS = 2

const fonts = new Map<string, Promise<LoadedFont>>()
let latestRequest = 0

const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message)

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'font') {
    const loading = parseFont(message.bytes, message.source, new AbortController().signal)
    loading.catch((error) => post({ type: 'font-error', fontId: message.fontId, message: String(error?.message ?? error) }))
    fonts.set(message.fontId, loading)
    while (fonts.size > MAX_FONTS) fonts.delete(fonts.keys().next().value!)
  } else {
    latestRequest = message.requestId
    void compute(message)
  }
}

async function compute(request: Extract<WorkerRequest, { type: 'compute' }>) {
  const loading = fonts.get(request.fontId)
  if (!loading) return
  let font: LoadedFont
  try {
    font = await loading
  } catch {
    return
  }
  let batch: GlyphResult[] = []
  let started = performance.now()
  const flush = () => {
    if (batch.length) post({ type: 'results', requestId: request.requestId, fontId: request.fontId, key: request.key, results: batch })
    batch = []
  }
  for (const index of request.indices) {
    if (latestRequest !== request.requestId) return // superseded: the page wants other settings now
    try {
      const { source: _source, ...geometry } = glyphGeometry(font, index, request.params, request.key)
      batch.push({ index, geometry })
    } catch (error) {
      batch.push({ index, error: error instanceof Error ? error.message : String(error) })
    }
    if (performance.now() - started > BATCH_MS) {
      flush()
      // Let newer requests in before going on.
      await new Promise((resolve) => setTimeout(resolve, 0))
      started = performance.now()
    }
  }
  flush()
  post({ type: 'done', requestId: request.requestId })
}
