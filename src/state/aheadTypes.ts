// The contract between the director (sound/director.ts) and the geometry pool's ahead lane and worker plans
// (state/aheadGeometry.ts), and between Glide (specimen/glide.ts) and the plans it is given.

import type { GeometryJob, PolygonGlyph } from '../geometry/types'
import type { MorphPlan } from '../specimen/morph'

/** One selected commit's work: its glyphs, then each lineage's glide step. */
export interface AheadCommit {
  seq: number
  prevSeq: number
  mediaMs: number
  /** Resolved jobs (indices filled; `within` already applied). */
  jobs: readonly GeometryJob[]
  /** Distinct lineage steps of this commit (occurrences with the same history share one); parent -1 = none. */
  steps: readonly { lineage: number; parent: number; index: number; key: string }[]
}

export interface AheadWindow {
  generation: number
  fontId: string
  /** Glide's time (ms); 0 = no plans. */
  glideMs: number
  commits: readonly AheadCommit[]
}

export interface AheadStats {
  /** Glyph computations per second the ahead lane sustained lately (EMA). */
  glyphsPerSecond: number
  /** Work queued but not done, ms at that rate. */
  backlogMs: number
}

export interface AheadGeometry {
  /** Replaces the wanted window (same generation: diffed; new generation: older work dropped). */
  want(window: AheadWindow): void
  /** Every glyph of the commit is in the store, and (glideMs > 0) every step's plan. */
  ready(seq: number): boolean
  stats(): AheadStats
  /** Commits before `seq` will not be shown: their glyphs and plans may go. */
  release(beforeSeq: number): void
  /** Called when readiness changes (batched, at most once per animation frame). */
  subscribeReady(listener: () => void): () => void
  clear(): void
}

/** An on-demand plan (live path): from is sent by value with its side tables. */
export interface PlanRequest { from: PolygonGlyph; to: PolygonGlyph; toRef: { key: string; index: number } | null }

export interface PlanSource {
  /** The worker's chained plan for this lineage at commit `seq`, decoded onto `from`/`to`, or undefined (not ready / not matching). */
  chained(lineage: number, seq: number, from: PolygonGlyph, to: PolygonGlyph, fromTag: ChainTag | null, fromComputedKey: string | null): MorphPlan | null | undefined
  /** Asks a worker to plan; `done` gets the plan (null: change at once). Returns a cancel. */
  request(job: PlanRequest, done: (plan: MorphPlan | null) => void): () => void
}

/** What an in-between glyph on the page was made from (glide.ts tags them). */
export interface ChainTag { lineage: number; seq: number; q: number }

// The registries: state/aheadGeometry.ts registers its implementations at import; null until then (and in tests).
let aheadGeometry: AheadGeometry | null = null
let planSource: PlanSource | null = null

export function setAheadGeometry(impl: AheadGeometry | null): void {
  aheadGeometry = impl
}

export function getAheadGeometry(): AheadGeometry | null {
  return aheadGeometry
}

export function setPlanSource(impl: PlanSource | null): void {
  planSource = impl
}

export function getPlanSource(): PlanSource | null {
  return planSource
}
