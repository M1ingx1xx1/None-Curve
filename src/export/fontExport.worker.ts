// Font export worker: builds and verifies one font file (buildFontFile) off the page's main thread, so
// the page keeps responding however long the outlines take, and Cancel stops the build at once (the
// page terminates the worker). It opens its own copy of the font; the glyphs the canvas already
// computed come with the request and are used as they are.

import { parseFont } from '../font/parse'
import { buildFontFile } from './fontFile'
import { unpackGlyphs, type FontExportRequest, type FontExportResponse } from './protocol'

const post = (message: FontExportResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

self.onmessage = async (event: MessageEvent<FontExportRequest>) => {
  const { bytes, source, plan, params, key, naming, known } = event.data
  // Nothing cancels from inside: the page terminates the worker.
  const signal = new AbortController().signal
  try {
    const font = await parseFont(bytes, source, signal)
    const glyphs = unpackGlyphs(known)
    const result = await buildFontFile(
      font,
      plan,
      params,
      key,
      naming,
      signal,
      (done, total, stage) => post({ type: 'progress', done, total, stage }),
      // The worker lives for one build: no cache, and no need to yield.
      { known: (index) => glyphs.get(index), cache: false, sliceMs: Infinity },
    )
    post({ type: 'built', result }, [result.bytes])
  } catch (error) {
    post({ type: 'failed', message: error instanceof Error ? error.message : String(error) })
  }
}
