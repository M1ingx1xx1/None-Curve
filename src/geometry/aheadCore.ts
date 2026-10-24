// The geometry worker's side of the precompute window (workerCore.ts runs it for 'ahead' requests): the glyphs of the
// commits ahead of the playhead, kept apart from the canvas's caches, and the Glide chains that run through them.
//
// A chain follows one occurrence's glide history (its lineage) over the commits the page will show, in order. At each
// commit it works out what the page will have on screen at that commit's media time, by the same rules as SceneGlide
// (a glide nearly done counts as arrived; an in-between shape is settled before it glides on), and plans the glide from
// there to the commit's glyph. The page uses the plan only when the shape it shows matches the plan's `from` (PlanFrom);
// otherwise it pairs as without the chain. Pure: no messages, no timers.
//
// Glyphs are kept packed (packed.ts) within PRECOMPUTE_LIMITS.workerStoreBytes, and only the part ahead of the commit
// due (release). Past the budget, the glyph whose newest use is farthest ahead goes first.

import type { PolygonGlyph } from './types'
import { easeOut, GLIDE_LIMITS } from '../specimen/glide'
import { morphAt, planMorph, settleInBetween, type MorphPlan } from '../specimen/morph'
import { encodePlan, encodeSettled } from '../specimen/planCodec'
import type { PlanData, PlanFrom } from '../specimen/planData'
import { PRECOMPUTE_LIMITS } from '../sound/timelineTypes'
import { ERROR_BYTES, packedBytes, unpackGeometry, type PackedGlyph } from './packed'

/** A glyph of the window: packed (packed.ts), or why it failed. */
export type AheadEntry = { packed: PackedGlyph } | { error: string }

interface Stored {
  entry: AheadEntry
  bytes: number
  /** The newest commit that uses it: release drops it once that commit is behind. */
  seq: number
  /** The media time of that newest use: past the budget, the glyph used farthest ahead goes first. */
  mediaMs: number
}

/** One lineage's glide as of its latest step. */
interface ChainState {
  seq: number
  /** The glyph glided into at `seq` as stored for its key; undefined when it was not stored. */
  entry: AheadEntry | undefined
  /** Its polygon once unpacked (null: it failed); undefined until a glide from it is planned. */
  polygon?: PolygonGlyph | null
  key: string
  index: number
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

/**
 * The worker's store of window glyphs, kept only with Glide on: a chain step needs its glyph where the lineage is
 * stepped. Without Glide the page's store is the window, and the worker keeps nothing.
 */
export class AheadCore {
  private glyphs = new Map<string, Stored>()
  private storedBytes = 0
  private chains = new Map<number, ChainState>()
  private fontId: string | null = null
  private generation: number | null = null
  private keeping = true
  private playheadMs = 0

  constructor(private readonly budgetBytes: number = PRECOMPUTE_LIMITS.workerStoreBytes) {}

  /**
   * A request for this font and generation: another font starts afresh; another generation drops the chains only.
   * `glideMs` 0: nothing is kept (and what was kept goes).
   */
  begin(fontId: string, generation: number, glideMs = 1, playheadMs = this.playheadMs) {
    if (fontId !== this.fontId) {
      this.clear()
      this.fontId = fontId
    }
    if (generation !== this.generation) this.chains.clear()
    this.generation = generation
    this.keeping = glideMs > 0
    this.playheadMs = playheadMs
    if (!this.keeping && this.glyphs.size) {
      this.glyphs.clear()
      this.storedBytes = 0
    }
  }

  /** The glyph kept for this key and index (marked as used by commit `seq` at `mediaMs`), or undefined. */
  get(key: string, index: number, seq?: number, mediaMs?: number): AheadEntry | undefined {
    const stored = this.glyphs.get(`${index}|${key}`)
    if (!stored) return undefined
    if (seq !== undefined && seq > stored.seq) {
      stored.seq = seq
      if (mediaMs !== undefined) stored.mediaMs = mediaMs
    }
    return stored.entry
  }

  /** Keeps a glyph for commit `seq` (at `mediaMs`); past the budget, the glyphs used farthest ahead go first. */
  put(key: string, index: number, entry: AheadEntry, seq: number, mediaMs = this.playheadMs) {
    if (!this.keeping) return
    const id = `${index}|${key}`
    const before = this.glyphs.get(id)
    if (before) {
      this.storedBytes -= before.bytes
      this.glyphs.delete(id)
    }
    const bytes = 'packed' in entry ? packedBytes(entry.packed) : ERROR_BYTES
    const newer = before && before.seq > seq
    this.glyphs.set(id, { entry, bytes, seq: newer ? before.seq : seq, mediaMs: newer ? before.mediaMs : mediaMs })
    this.storedBytes += bytes
    if (this.storedBytes > this.budgetBytes) this.evict()
  }

  /** Drops the glyphs used farthest ahead (behind the playhead first) until the store is at 90 % of its budget. */
  private evict() {
    const target = 0.9 * this.budgetBytes
    const ph = this.playheadMs
    // Behind the playhead counts as farthest: release would drop it soon anyway.
    const rank = (stored: Stored) => (stored.mediaMs < ph ? Infinity : stored.mediaMs - ph)
    const order = [...this.glyphs].sort((a, b) => rank(b[1]) - rank(a[1]))
    for (const [id, stored] of order) {
      if (this.storedBytes <= target || this.glyphs.size <= 1) break
      this.glyphs.delete(id)
      this.storedBytes -= stored.bytes
    }
  }

  /**
   * Marks the glyphs a request's commits use (a step's glyph may have been stored for an earlier commit), so a release
   * that arrives before those commits are worked on keeps them.
   */
  reserve(uses: Iterable<{ seq: number; key: string; index: number; mediaMs?: number }>) {
    for (const { seq, key, index, mediaMs } of uses) {
      const stored = this.glyphs.get(`${index}|${key}`)
      if (stored && seq > stored.seq) {
        stored.seq = seq
        if (mediaMs !== undefined) stored.mediaMs = mediaMs
      }
    }
  }

  /** Glyphs kept, their bytes, and the chains (tests, stats). */
  get size(): { glyphs: number; bytes: number; chains: number } {
    return { glyphs: this.glyphs.size, bytes: this.storedBytes, chains: this.chains.size }
  }

  /**
   * Steps `lineage` to commit `seq` (at `mediaMs`) into the glyph `key`/`index`, going on from `parent`'s glide (-1:
   * none). The commit's glyphs are stored before its steps run.
   */
  step(
    seq: number,
    mediaMs: number,
    lineage: number,
    parent: number,
    index: number,
    key: string,
    glideMs: number,
  ): StepRecord {
    const stored = this.get(key, index, seq, mediaMs)
    // Unpacked only when a glide is planned into it: an unchanged step costs no polygon.
    let polygon: PolygonGlyph | null | undefined
    const settle = (plan: MorphPlan | null, record: StepRecord): StepRecord => {
      this.chains.set(lineage, { seq, entry: stored, polygon, key, index, plan, start: mediaMs, parent })
      return record
    }
    const computed: PlanFrom = { kind: 'computed', key }
    if (parent < 0) return settle(null, { lineage, from: computed, data: null, unchanged: true })
    const prev = this.chains.get(parent)
    // The parent's state or a glyph is gone (a restarted worker, the store's limit): the page pairs this glyph itself.
    if (!prev || prev.entry === undefined || stored === undefined)
      return settle(null, { lineage, from: { kind: 'value' }, data: null })
    // What the page shows at `mediaMs`, as SceneGlide.shown works it out.
    const q = prev.plan && glideMs > 0 ? easeOut((mediaMs - prev.start) / glideMs) : 1
    const arrived = !prev.plan || q >= GLIDE_LIMITS.arrived
    const from: PlanFrom = arrived
      ? { kind: 'computed', key: prev.key }
      : { kind: 'between', lineage: parent, seq: prev.seq, q }
    // Not reshaped (arrived at the same stored glyph: one key and glyph id): nothing glides.
    const same = arrived && prev.key === key && prev.index === index
    if (same || glideMs <= 0) {
      if (same && prev.entry === stored) polygon = prev.polygon
      return settle(null, { lineage, from, data: null, unchanged: true })
    }
    const shown = arrived ? targetOf(prev) : morphAt(prev.plan!, q)
    const to = (polygon = 'packed' in stored ? unpackGeometry(stored.packed).polygon : null)
    // No outline on either side: nothing glides.
    if (!shown || !to) return settle(null, { lineage, from, data: null, unchanged: true })
    const settled = settleInBetween(shown, to)
    const plan = planMorph(settled, to)
    if (!plan) return settle(null, { lineage, from, data: null })
    const { data } = encodePlan(plan)
    return settle(plan, {
      lineage,
      from,
      data: settled === shown ? data : { ...data, settled: encodeSettled(settled) },
    })
  }

  /**
   * Commits before `beforeSeq` will not be shown: chain states older than that go unless a newer one goes on from them,
   * and so do glyphs no newer commit uses.
   */
  release(beforeSeq: number) {
    const parents = new Set<number>()
    for (const state of this.chains.values()) if (state.seq >= beforeSeq && state.parent >= 0) parents.add(state.parent)
    for (const [lineage, state] of this.chains)
      if (state.seq < beforeSeq && !parents.has(lineage)) this.chains.delete(lineage)
    for (const [id, stored] of this.glyphs) {
      if (stored.seq >= beforeSeq) continue
      this.glyphs.delete(id)
      this.storedBytes -= stored.bytes
    }
  }

  clear() {
    this.glyphs.clear()
    this.storedBytes = 0
    this.chains.clear()
    this.generation = null
  }
}

/** The polygon a chain glided into, unpacked once (null: the glyph failed). */
function targetOf(state: ChainState): PolygonGlyph | null {
  if (state.polygon === undefined)
    state.polygon = state.entry && 'packed' in state.entry ? unpackGeometry(state.entry.packed).polygon : null
  return state.polygon
}
