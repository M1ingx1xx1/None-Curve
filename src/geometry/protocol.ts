// Messages between the page and the geometry worker (geometry.worker.ts, workerCore.ts).

import type { FontSource } from '../font/model'
import type { DerivedGeometry, GeometryJob } from './types'

export type { GeometryJob } from './types'

/** A glyph's derived geometry without its source outline (the page reads that from its own font). */
export type WorkerGeometry = Omit<DerivedGeometry, 'source'>

export type WorkerRequest =
  /** Opens a font in the worker; later requests refer to it by id. */
  | { type: 'font'; fontId: string; bytes: Uint8Array; source: FontSource }
  /**
   * Computes these jobs' glyphs, job after job, in this order (a live frame whose letters show several
   * parameter sets is one request). A newer compute request stops this one between glyphs.
   * `live` marks parameters Sound is driving: their results go to the worker's live cache.
   */
  | { type: 'compute'; requestId: number; fontId: string; jobs: GeometryJob[]; live?: boolean }
  /** Stops this request between glyphs: the page has everything it needs. */
  | { type: 'cancel'; requestId: number }

export type GlyphResult = { index: number; geometry: WorkerGeometry } | { index: number; error: string }

/** Why a request failed: the worker does not have the font, could not open it, or anything else went wrong. */
export type FailureReason = 'no-font' | 'font' | 'internal'

export type WorkerResponse =
  /**
   * One job's glyphs (every message holds one `key`). `live` repeats the request's flag, so the page keeps live results
   * apart too. `times`: how long each result took (ms, in the same order), so the page can share the next request
   * out evenly among its workers.
   */
  | { type: 'results'; requestId: number; fontId: string; key: string; results: GlyphResult[]; live?: boolean; times?: number[] }
  /**
   * Sent before each glyph: the page's watchdog hears the worker is alive, and knows which glyph (under
   * which settings) to blame if it falls silent.
   */
  | { type: 'glyph'; requestId: number; key: string; index: number }
  /** Every compute request ends with one 'done' (all glyphs sent, or `stopped` early by a newer request or a cancel) or one 'failed'. */
  | { type: 'done'; requestId: number; stopped?: boolean }
  | { type: 'failed'; requestId: number; reason: FailureReason; message: string }
  | { type: 'font-error'; fontId: string; message: string }
