// The page's side of a font export: builds the font in a worker of its own (fontExport.worker.ts), one
// per build, which Cancel terminates at once, and so does a long silence (EXPORT_SILENCE_MS). Where a
// worker cannot start, the build runs on the page instead, yielding between glyphs (one slow glyph still
// holds the page up while it is computed). The build code (fontFile.ts and the whole geometry pipeline) is
// loaded on the page only then.

import type { LoadedFont } from '../font/model'
import type { GeometryParams } from '../geometry/types'
import type { FontExportPlan, FontExportResult, FontExportStage, FontNaming, KnownGlyph } from './fontPlan'
import { packGlyphs, type FontExportRequest, type FontExportResponse } from './protocol'

/**
 * The export worker reports its progress between glyphs (about every 100 ms) and at each stage, and
 * neither one glyph nor writing or verifying the file takes more than seconds. If it sends nothing for
 * this long, it is stopped and the export fails instead of waiting for ever.
 */
const EXPORT_SILENCE_MS = 60_000

export interface FontExportJob {
  font: LoadedFont
  plan: FontExportPlan
  params: GeometryParams
  key: string
  naming: FontNaming
  /** Glyphs the canvas already computed for these settings, by source glyph index. */
  known: ReadonlyMap<number, KnownGlyph>
  onProgress: (done: number, total: number, stage: FontExportStage) => void
}

/** Builds and verifies the font file; aborting `signal` stops the build at once and rejects with its reason. */
export function runFontExport(job: FontExportJob, signal: AbortSignal): Promise<FontExportResult> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./fontExport.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return buildOnPage(job, signal)
  }
  return new Promise<FontExportResult>((resolve, reject) => {
    let heard = false
    let silence: ReturnType<typeof setTimeout> | undefined
    // Restarted by every message from the worker.
    const listen = () => {
      clearTimeout(silence)
      silence = setTimeout(() => {
        end()
        reject(new Error('The export stopped responding.'))
      }, EXPORT_SILENCE_MS)
    }
    const end = () => {
      clearTimeout(silence)
      worker.terminate()
      signal.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      end()
      reject(signal.reason)
    }
    if (signal.aborted) return cancel()
    signal.addEventListener('abort', cancel)
    worker.onmessage = (event: MessageEvent<FontExportResponse>) => {
      heard = true
      const message = event.data
      if (message.type === 'progress') {
        listen()
        return job.onProgress(message.done, message.total, message.stage)
      }
      end()
      if (message.type === 'built') resolve(message.result)
      else reject(new Error(message.message))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      end()
      // Silent from the start: its script did not load (e.g. a tab opened before an update). Build here instead.
      if (!heard) buildOnPage(job, signal).then(resolve, reject)
      else reject(new Error(`The export worker stopped${event.message ? ` (${event.message})` : ''}.`))
    }
    const { packed, transfer } = packGlyphs(job.known)
    const request: FontExportRequest = {
      type: 'build',
      bytes: job.font.bytes,
      source: job.font.source,
      plan: job.plan,
      params: job.params,
      key: job.key,
      naming: job.naming,
      known: packed,
    }
    listen()
    worker.postMessage(request, transfer)
  })
}

async function buildOnPage(job: FontExportJob, signal: AbortSignal): Promise<FontExportResult> {
  const { buildFontFile } = await import('./fontFile')
  signal.throwIfAborted()
  return buildFontFile(job.font, job.plan, job.params, job.key, job.naming, signal, job.onProgress, { known: (index) => job.known.get(index) })
}
