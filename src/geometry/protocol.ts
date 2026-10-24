// Messages between the page and the geometry worker (geometry.worker.ts, workerCore.ts).

import type { FontSource } from '../font/model'
import type { PlanData, PlanFrom } from '../specimen/planData'
import type { PackedGlyph } from './packed'
import type { DerivedGeometry, GeometryJob, GeometryParams, PolygonGlyph } from './types'

export type { GeometryJob } from './types'

/** A glyph's derived geometry without its source outline (the page reads that from its own font). */
export type WorkerGeometry = Omit<DerivedGeometry, 'source'>

/** The pipeline's statistics for a glyph (the panels and the status bar read them for the selected glyph). */
export type GlyphStats = Omit<WorkerGeometry, 'polygon' | 'vertexCount'>

/** A glyph's geometry without its statistics: what the canvas lane sends for every glyph but the one asked. */
export type LeanGeometry = Pick<WorkerGeometry, 'polygon' | 'vertexCount'>

/**
 * The pool's lanes: 'canvas' (what the canvas shows now), 'ahead' (the precompute window) and 'plan' (Glide plans on
 * demand). Each keeps its own latest request; 'compute' and 'cancel' are the canvas lane's.
 */
export type Lane = 'canvas' | 'ahead' | 'plan'

export type WorkerRequest =
  /**
   * Opens a font in the worker; later requests refer to it by id. `workers`: how many workers the page shares glyphs
   * among; each keeps that share of the glyph cache's limits, so the pool together holds what one worker did.
   */
  | { type: 'font'; fontId: string; bytes: Uint8Array; source: FontSource; workers?: number }
  /**
   * Computes these jobs' glyphs, job after job, in this order (a live frame whose letters show several
   * parameter sets is one request). A newer compute request stops this one between glyphs.
   * `live` marks parameters Sound is driving: their results go to the worker's live cache. `stats`: the one glyph
   * (under one key) whose result carries the pipeline's statistics (the selected glyph); the others go without.
   */
  | {
      type: 'compute'
      requestId: number
      fontId: string
      jobs: GeometryJob[]
      live?: boolean
      stats?: { key: string; index: number }
    }
  /** Stops this request between glyphs: the page has everything it needs. */
  | { type: 'cancel'; requestId: number }
  /**
   * Computes the ahead window's glyphs for this worker (pinned indices) and steps its glide chains (aheadCore.ts). A
   * newer 'ahead' request replaces this one between items. `playheadMs`: where playback is (media ms), for what the
   * worker's store keeps.
   */
  | {
      type: 'ahead'
      requestId: number
      fontId: string
      generation: number
      glideMs: number
      playheadMs: number
      items: AheadItem[]
    }
  /** Plans one glide on demand (live path), both glyphs by value. */
  | { type: 'plan'; requestId: number; fontId: string; from: EncodedGlyph; to: EncodedGlyph }
  /** Forget ahead glyphs and chain states before this commit. */
  | { type: 'ahead-release'; beforeSeq: number }

/** One unit of an ahead request: a commit's glyphs under one parameter set (at its media time), or one lineage's glide step. */
export type AheadItem =
  | { kind: 'glyphs'; seq: number; key: string; params: GeometryParams; indices: number[]; mediaMs?: number }
  | { kind: 'step'; seq: number; mediaMs: number; lineage: number; parent: number; index: number; key: string }

/** An in-between glyph by value: the glyph, plus its kept flags and mesh pose (morph.ts side tables). */
export interface EncodedGlyph {
  glyph: PolygonGlyph
  kept: Uint8Array[] | null
  pose: EncodedPose | null
}
export interface EncodedPose {
  meshKey: string
  turns: Float64Array
  cornerX: Float64Array
  cornerY: Float64Array
  outerX: Float64Array
  outerY: Float64Array
}

/** A glyph's result in either lane: packed (packed.ts; its arrays are transferred), or why it failed. */
export type GlyphResult = { index: number; packed: PackedGlyph } | { index: number; error: string }

/** Why a request failed: the worker does not have the font, could not open it, or anything else went wrong. */
export type FailureReason = 'no-font' | 'font' | 'internal'

export type WorkerResponse =
  /**
   * One job's glyphs, packed (every message holds one `key`). `live` repeats the request's flag, so the page keeps live results
   * apart too. `times`: how long each result took (ms, in the same order), so the page can share the next request
   * out evenly among its workers; null for a result the worker's cache already held (it says nothing of the glyph's cost).
   */
  | {
      type: 'results'
      requestId: number
      fontId: string
      key: string
      results: GlyphResult[]
      live?: boolean
      times?: (number | null)[]
    }
  /**
   * Sent before each glyph: the page's watchdog hears the worker is alive, and knows which glyph (under
   * which settings) to blame if it falls silent. It names its lane and font, so a glyph of a request the page has
   * since replaced is still known for what it is.
   */
  | { type: 'glyph'; requestId: number; lane: Exclude<Lane, 'plan'>; fontId: string; key: string; index: number }
  /** Every compute request ends with one 'done' (all glyphs sent, or `stopped` early by a newer request or a cancel) or one 'failed'. */
  | { type: 'done'; requestId: number; stopped?: boolean }
  | { type: 'failed'; requestId: number; reason: FailureReason; message: string }
  | { type: 'font-error'; fontId: string; message: string }
  /** One ahead job's glyphs for commit `seq` (as 'results', packed, into the page's ahead store). */
  | {
      type: 'ahead-results'
      requestId: number
      generation: number
      seq: number
      key: string
      results: GlyphResult[]
      times: (number | null)[]
    }
  /** Commit `seq`'s glide steps: per lineage the plan's `from`, its data (null: change at once), and `unchanged` when not reshaped. */
  | {
      type: 'ahead-plans'
      requestId: number
      generation: number
      seq: number
      plans: { lineage: number; from: PlanFrom; data: PlanData | null; unchanged?: true }[]
    }
  /**
   * Every ahead request ends with one 'ahead-done' (all items done, or `stopped` by a newer one). `stored`: what the
   * worker's ahead store holds now (the probe).
   */
  | { type: 'ahead-done'; requestId: number; stopped?: boolean; stored?: { bytes: number } }
  /** The answer to a 'plan' request (null: change at once). */
  | { type: 'plan-result'; requestId: number; data: PlanData | null }
