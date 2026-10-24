// The contract between the director (sound/director.ts) and the geometry pool's ahead lane and worker plans
// (state/aheadGeometry.ts), and between Glide (specimen/glide.ts) and the plans it is given.

import type { GeometryJob, PolygonGlyph } from '../geometry/types'
import type { MorphPlan } from '../specimen/morph'
import { PRECOMPUTE_LIMITS } from '../sound/timelineTypes'

/** One selected commit's work: its glyphs, then each lineage's glide step. */
export interface AheadCommit {
  seq: number
  prevSeq: number
  mediaMs: number
  /** Until when it is on screen: the next selected commit's media time (for the buffered ranges). */
  endMs: number
  /** Resolved jobs (indices filled; `within` already applied). */
  jobs: readonly GeometryJob[]
  /** Distinct lineage steps of this commit (occurrences with the same history share one); parent -1 = none. */
  steps: readonly { lineage: number; parent: number; index: number; key: string }[]
}

/**
 * The geometry window around the playhead: the selected commits of [playhead − windowBehindMs, playhead +
 * windowAheadMs] in media order. Those before `dueSeq` (the commit due) are the part behind: their glyphs are kept
 * for a rewind, but no glide steps are worked out for them.
 */
export interface AheadWindow {
  generation: number
  /** The decimation level the commits were selected at (lineages change with it). */
  level: number
  fontId: string
  /** Glide's time (ms); 0 = no plans. */
  glideMs: number
  playheadMs: number
  dueSeq: number
  commits: readonly AheadCommit[]
}

export interface AheadStats {
  /** Glyph computations per second the ahead lane sustained lately (EMA). */
  glyphsPerSecond: number
  /** Work queued but not done, ms at that rate. */
  backlogMs: number
}

/** Media time ranges whose geometry is ready, for one plan generation: [startMs, endMs, …], merged, in order. */
export interface ReadyRanges {
  generation: number
  ranges: Float64Array
}

export interface AheadGeometry {
  /** Replaces the wanted window (same generation: diffed; new generation: older work dropped). */
  want(window: AheadWindow): void
  /** The same window's commits, with the playhead (and the commit due) moved on: nothing is diffed again. */
  setPlayhead(playheadMs: number, dueSeq: number): void
  /** Every glyph of the commit is in the store, and (glideMs > 0) every step's plan. */
  ready(seq: number): boolean
  /** Every glyph of the commit is in the store (its steps' plans aside). */
  shapesReady(seq: number): boolean
  stats(): AheadStats
  /** Commits before `seq` (the window's first) will not be shown: their plans may go. */
  release(beforeSeq: number): void
  /** Stops the work in the workers (settling, hidden, backing off); what is held stays. The next `want` resumes. */
  pause(): void
  /** Where the current plan's geometry is ready (the buffered bar). */
  readyRanges(): ReadyRanges
  /** Called when readiness changes (batched, at most once per animation frame). */
  subscribeReady(listener: () => void): () => void
  clear(): void
}

/**
 * How far a glyph used from media ms `first` to `last` is from the playhead `ph`, weighted: 0 when the playhead is
 * within, the distance ahead, or behindWeight times the distance behind (a rewind is less likely than playing on).
 */
export function weightedDistance(first: number, last: number, ph: number): number {
  if (first <= ph && ph <= last) return 0
  return first > ph ? first - ph : PRECOMPUTE_LIMITS.behindWeight * (ph - last)
}

/** An on-demand plan (live path): both glyphs are sent by value with their side tables. */
export interface PlanRequest {
  from: PolygonGlyph
  to: PolygonGlyph
}

export interface PlanSource {
  /** The worker's chained plan for this lineage at commit `seq`, decoded onto `from`/`to`, or undefined (not ready / not matching). */
  chained(
    lineage: number,
    seq: number,
    from: PolygonGlyph,
    to: PolygonGlyph,
    fromTag: ChainTag | null,
    fromComputedKey: string | null,
  ): MorphPlan | null | undefined
  /** Asks a worker to plan; `done` gets the plan (null: change at once). Returns a cancel. */
  request(job: PlanRequest, done: (plan: MorphPlan | null) => void): () => void
}

/** What an in-between glyph on the page was made from (glide.ts tags them). */
export interface ChainTag {
  lineage: number
  seq: number
  q: number
}

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
