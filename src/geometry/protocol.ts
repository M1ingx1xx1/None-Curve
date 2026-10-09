// Messages between the page and the geometry worker (geometry.worker.ts).

import type { FontSource } from '../font/model'
import type { DerivedGeometry, GeometryParams } from './types'

/** A glyph's derived geometry without its source outline (the page reads that from its own font). */
export type WorkerGeometry = Omit<DerivedGeometry, 'source'>

export type WorkerRequest =
  /** Opens a font in the worker; later requests refer to it by id. */
  | { type: 'font'; fontId: string; bytes: Uint8Array; source: FontSource }
  /** Computes these glyphs, in this order. A newer compute request stops this one between glyphs. */
  | { type: 'compute'; requestId: number; fontId: string; params: GeometryParams; key: string; indices: number[] }

export type GlyphResult = { index: number; geometry: WorkerGeometry } | { index: number; error: string }

export type WorkerResponse =
  | { type: 'results'; requestId: number; fontId: string; key: string; results: GlyphResult[] }
  | { type: 'done'; requestId: number }
  | { type: 'font-error'; fontId: string; message: string }
