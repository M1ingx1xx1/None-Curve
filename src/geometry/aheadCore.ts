// The geometry worker's side of the precompute window (workerCore.ts runs it for 'ahead' requests): the glyphs of the
// commits ahead of the playhead, kept apart from the canvas's caches, and the Glide chains that run through them.
//
// A chain follows one occurrence's glide history (its lineage) over the commits the page will show, in order. At each
// commit it works out what the page will have on screen at that commit's media time, by the same rules as SceneGlide
// (a glide nearly done counts as arrived; an in-between shape is settled before it glides on), and plans the glide from
// there to the commit's glyph. The page uses the plan only when the shape it shows matches the plan's `from` (PlanFrom);
// otherwise it pairs as without the chain. Pure: no messages, no timers.

import type { PolygonGlyph } from './types'
import { easeOut, GLIDE_LIMITS } from '../specimen/glide'
import { morphAt, planMorph, settleInBetween, type MorphPlan } from '../specimen/morph'
import { encodePlan, encodeSettled } from '../specimen/planCodec'
import type { PlanData, PlanFrom } from '../specimen/planData'
import type { WorkerGeometry } from './protocol'

export const AHEAD_LIMITS = {
  /** Polygon points the worker keeps for the window; the least recently used glyphs go first past it. */
  maxPoints: 400_000,
} as const

/** A glyph of the window: its geometry, or why it failed. */
export type AheadEntry = { geometry: WorkerGeometry } | { error: string }

interface Stored {
  entry: AheadEntry
  points: number
  /** The newest commit that uses it: release drops it once that commit is behind. */
  seq: number
}

/** One lineage's glide as of its latest step. */
interface ChainState {
  seq: number
  /** The glyph glided into at `seq` (the stored polygon for its key); null when it has none (it failed), undefined when it was not stored. */
  target: PolygonGlyph | null | undefined
  key: string
  /** Null: not gliding (arrived, unchanged, or changed at once). */
  plan: MorphPlan | null
  /** Media ms the plan started. */
  start: number
  /** The lineage this one went on from (its state is kept while this one is). */
  parent: number
}

/** What a step tells the page: the plan's `from` and data (null: change at once), or that the glyph is not reshaped. */
export interface StepRecord {
  lineage: number
  from: PlanFrom
  data: PlanData | null
  unchanged?: true
}

export class AheadCore {
  private glyphs = new Map<string, Stored>()
  private points = 0
  private chains = new Map<number, ChainState>()
  private fontId: string | null = null
  private generation: number | null = null

  /** A request for this font and generation: another font starts afresh; another generation drops the chains only. */
  begin(fontId: string, generation: number) {
    if (fontId !== this.fontId) {
      this.clear()
      this.fontId = fontId
    }
    if (generation !== this.generation) this.chains.clear()
    this.generation = generation
  }

  /** The glyph kept for this key and index (marked as used by commit `seq`), or undefined. */
  get(key: string, index: number, seq?: number): AheadEntry | undefined {
    const id = `${index}|${key}`
    const stored = this.glyphs.get(id)
    if (!stored) return undefined
    this.glyphs.delete(id)
    this.glyphs.set(id, stored)
    if (seq !== undefined && seq > stored.seq) stored.seq = seq
    return stored.entry
  }

  /** Keeps a glyph for commit `seq`, dropping the least recently used past AHEAD_LIMITS.maxPoints. */
  put(key: string, index: number, entry: AheadEntry, seq: number) {
    const id = `${index}|${key}`
    const before = this.glyphs.get(id)
    if (before) {
      this.points -= before.points
      this.glyphs.delete(id)
    }
    const points = 'geometry' in entry ? entry.geometry.vertexCount : 0
    this.glyphs.set(id, { entry, points, seq: Math.max(seq, before?.seq ?? seq) })
    this.points += points
    while (this.glyphs.size > 1 && this.points > AHEAD_LIMITS.maxPoints) {
      const [oldest, evicted] = this.glyphs.entries().next().value!
      this.glyphs.delete(oldest)
      this.points -= evicted.points
    }
  }

  /**
   * Marks the glyphs a request's commits use (a step's glyph may have been stored for an earlier commit), so a release
   * that arrives before those commits are worked on keeps them.
   */
  reserve(uses: Iterable<{ seq: number; key: string; index: number }>) {
    for (const { seq, key, index } of uses) {
      const stored = this.glyphs.get(`${index}|${key}`)
      if (stored && seq > stored.seq) stored.seq = seq
    }
  }

  /** Glyphs kept, and their points (tests, stats). */
  get size(): { glyphs: number; points: number; chains: number } {
    return { glyphs: this.glyphs.size, points: this.points, chains: this.chains.size }
  }

  /**
   * Steps `lineage` to commit `seq` (at `mediaMs`) into the glyph `key`/`index`, going on from `parent`'s glide (-1:
   * none). The commit's glyphs are stored before its steps run.
   */
  step(seq: number, mediaMs: number, lineage: number, parent: number, index: number, key: string, glideMs: number): StepRecord {
    const stored = this.get(key, index, seq)
    const to = stored ? ('geometry' in stored ? stored.geometry.polygon : null) : undefined
    const settle = (plan: MorphPlan | null, record: StepRecord): StepRecord => {
      this.chains.set(lineage, { seq, target: to, key, plan, start: mediaMs, parent })
      return record
    }
    const computed: PlanFrom = { kind: 'computed', key }
    if (parent < 0) return settle(null, { lineage, from: computed, data: null, unchanged: true })
    const prev = this.chains.get(parent)
    // The parent's state or a glyph is gone (a restarted worker, the store's limit): the page pairs this glyph itself.
    if (!prev || prev.target === undefined || to === undefined) return settle(null, { lineage, from: { kind: 'value' }, data: null })
    // What the page shows at `mediaMs`, as SceneGlide.shown works it out.
    const q = prev.plan && glideMs > 0 ? easeOut((mediaMs - prev.start) / glideMs) : 1
    const arrived = !prev.plan || q >= GLIDE_LIMITS.arrived
    const shown = arrived ? prev.target : morphAt(prev.plan!, q)
    const from: PlanFrom = arrived ? { kind: 'computed', key: prev.key } : { kind: 'between', lineage: parent, seq: prev.seq, q }
    // Not reshaped (the same stored glyph), or no outline on either side: nothing glides.
    if (!shown || !to || shown === to || glideMs <= 0) return settle(null, { lineage, from, data: null, unchanged: true })
    const settled = settleInBetween(shown, to)
    const plan = planMorph(settled, to)
    if (!plan) return settle(null, { lineage, from, data: null })
    const { data } = encodePlan(plan)
    return settle(plan, { lineage, from, data: settled === shown ? data : { ...data, settled: encodeSettled(settled) } })
  }

  /**
   * Commits before `beforeSeq` will not be shown: chain states older than that go unless a newer one goes on from them,
   * and so do glyphs no newer commit uses.
   */
  release(beforeSeq: number) {
    const parents = new Set<number>()
    for (const state of this.chains.values()) if (state.seq >= beforeSeq && state.parent >= 0) parents.add(state.parent)
    for (const [lineage, state] of this.chains) if (state.seq < beforeSeq && !parents.has(lineage)) this.chains.delete(lineage)
    for (const [id, stored] of this.glyphs) {
      if (stored.seq >= beforeSeq) continue
      this.glyphs.delete(id)
      this.points -= stored.points
    }
  }

  clear() {
    this.glyphs.clear()
    this.points = 0
    this.chains.clear()
    this.generation = null
  }
}
