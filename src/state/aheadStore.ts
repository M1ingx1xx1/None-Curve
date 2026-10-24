// The page's store of the precompute window's glyphs (NOCUR-85): packed (geometry/packed.ts) within a byte budget, and
// turned back into objects only when looked up (a small LRU of them, so Glide and the canvas see one object per glyph
// while it is in use; bounded by a glyph count and by bytes, and counted in the budget). The geometry client (geometryClient.ts) reads it like its other stores; the ahead lane
// (aheadGeometry.ts) tells it when the window's commits use each glyph.
//
// Eviction, only when over budget (down to 90 % of it): first the orphans (no commit of the current plan uses them),
// oldest first; then by weighted distance from the playhead (state/aheadTypes.ts weightedDistance: a moment behind
// counts behindWeight times its distance), farthest first. A glyph used within protectMs of the playhead is never
// evicted. A result farther than everything kept is dropped at once, so the window fills up to the edge the budget
// allows and stops there. After a seek, glyphs near the old spot keep their use times and go only when room is needed;
// after a new plan, every glyph is an orphan until the new window uses it again (content-addressed reuse).

import {
  ERROR_BYTES,
  packedBytes,
  packedPoints,
  unpackedBytes,
  unpackEntry,
  type PackedGlyph,
  type UnpackedEntry,
} from '../geometry/packed'
import type { LeanGeometry, WorkerGeometry } from '../geometry/protocol'
import { PRECOMPUTE_LIMITS } from '../sound/timelineTypes'
import { weightedDistance } from './aheadTypes'

/** A glyph as the client reads it (geometryClient.ts GeometryEntry). */
export type StoredGeometry = UnpackedEntry | { error: string }

/** The earliest and latest media time a commit of the window uses a glyph. */
interface Use {
  first: number
  last: number
}

interface Entry {
  key: string
  index: number
  packed: PackedGlyph | null
  error: string | null
  bytes: number
  points: number
  use: Use | null
  materialized: StoredGeometry | null
  /** Bytes it takes as objects while materialized (estimate). */
  hotBytes: number
}

export interface AheadStoreOptions {
  /** Glyphs kept as objects (the materialised LRU). */
  materialized?: number
  /** Bytes the glyphs kept as objects may take (estimate; an eighth of the budget if not given), within the budget. */
  materializedBytes?: number
  /** Called for each glyph turned into objects (the client remembers its polygon's key). */
  onMaterialize?: (geometry: WorkerGeometry | LeanGeometry, key: string) => void
  /** Glyphs used this close to the playhead (weighted ms) are never evicted. */
  protectMs?: number
}

/** One bucket per second of weighted distance; farther ones share the last. */
const BUCKETS = 240
/**
 * The store counts as full from this share of its budget, orphans not counted: from there only glyphs nearer than
 * the farthest kept are worth computing (eviction goes down to 90 %, so a refill does not compute what goes next).
 */
const FULL_SHARE = 0.85

export class AheadStore {
  private entries = new Map<string, Map<number, Entry>>()
  /** Every entry, oldest first (orphans go in this order). */
  private order = new Set<Entry>()
  private uses = new Map<string, Map<number, Use>>()
  /** Entries turned into objects, least recently looked up first, and the bytes they take as objects. */
  private hot = new Set<Entry>()
  private hotBytes = 0
  /** Bytes of the packed entries (the objects of the hot ones are counted apart, in hotBytes). */
  private total = 0
  private orphanBytes = 0
  private pointCount = 0
  private playheadMs = 0
  private listeners = new Set<(evicted: readonly { key: string; index: number }[]) => void>()
  private farthestCache: { at: number; version: number; value: number } | null = null
  private version = 0
  /** Entries evicted so far (an epoch for readiness memos). */
  evictions = 0
  private readonly materializedMax: number
  private readonly materializedBytesMax: number
  private readonly protectMs: number

  constructor(
    private readonly budgetBytes: number = PRECOMPUTE_LIMITS.pageStoreBytes,
    private readonly options: AheadStoreOptions = {},
  ) {
    this.materializedMax = options.materialized ?? 4096
    this.materializedBytesMax = options.materializedBytes ?? budgetBytes / 8
    this.protectMs = options.protectMs ?? PRECOMPUTE_LIMITS.enterReadyMs
  }

  /** True when the glyph is held (without turning it into objects or changing what is recently looked up). */
  has(key: string, index: number): boolean {
    return this.entries.get(key)?.has(index) === true
  }

  /** The glyph as objects (unpacked once while it stays among the recently looked up), or undefined. */
  get(key: string, index: number): StoredGeometry | undefined {
    const entry = this.entries.get(key)?.get(index)
    if (!entry) return undefined
    if (entry.materialized) {
      this.hot.delete(entry)
      this.hot.add(entry)
      return entry.materialized
    }
    if (entry.error !== null) entry.materialized = { error: entry.error }
    else {
      const unpacked = unpackEntry(entry.packed!)
      this.options.onMaterialize?.(unpacked.geometry, key)
      entry.materialized = unpacked
    }
    this.hot.add(entry)
    this.hotBytes += entry.hotBytes
    // The newest stays, however large: it is the one being looked up.
    while (this.hot.size > 1 && (this.hot.size > this.materializedMax || this.hotBytes > this.materializedBytesMax))
      this.cool(this.hot.values().next().value!)
    return entry.materialized
  }

  /** Keeps a result; then evicts while over budget. False when it was dropped at once (farther than everything kept). */
  put(key: string, index: number, result: { packed: PackedGlyph } | { error: string }): boolean {
    this.remove(key, index)
    const packed = 'packed' in result ? result.packed : null
    const entry: Entry = {
      key,
      index,
      packed,
      error: 'error' in result ? result.error : null,
      bytes: packed ? packedBytes(packed) : ERROR_BYTES,
      points: packed ? packedPoints(packed) : 0,
      use: this.uses.get(key)?.get(index) ?? null,
      materialized: null,
      hotBytes: packed ? unpackedBytes(packed) : ERROR_BYTES,
    }
    let byIndex = this.entries.get(key)
    if (!byIndex) this.entries.set(key, (byIndex = new Map()))
    byIndex.set(index, entry)
    this.order.add(entry)
    this.total += entry.bytes
    this.pointCount += entry.points
    if (!entry.use) this.orphanBytes += entry.bytes
    this.version++
    if (this.total + this.hotBytes > this.budgetBytes) this.evict()
    return this.order.has(entry)
  }

  /** A commit of the window at `mediaMs` uses this glyph. */
  use(key: string, index: number, mediaMs: number): void {
    let byIndex = this.uses.get(key)
    if (!byIndex) this.uses.set(key, (byIndex = new Map()))
    let use = byIndex.get(index)
    if (!use) byIndex.set(index, (use = { first: mediaMs, last: mediaMs }))
    else {
      if (mediaMs < use.first) use.first = mediaMs
      if (mediaMs > use.last) use.last = mediaMs
    }
    const entry = this.entries.get(key)?.get(index)
    if (entry && !entry.use) {
      entry.use = use
      this.orphanBytes -= entry.bytes
    }
    this.version++
  }

  /** A new plan (or level): every glyph becomes an orphan, keeping its place in the order, until the window uses it again. */
  orphanAll(): void {
    this.uses.clear()
    for (const entry of this.order) entry.use = null
    this.orphanBytes = this.total
    this.version++
  }

  /** Forgets the uses of glyphs not held, outside [fromMs, toMs] (the window moved on). */
  pruneUses(fromMs: number, toMs: number): void {
    for (const [key, byIndex] of this.uses) {
      const held = this.entries.get(key)
      for (const [index, use] of byIndex)
        if ((use.last < fromMs || use.first > toMs) && !held?.has(index)) byIndex.delete(index)
      if (!byIndex.size) this.uses.delete(key)
    }
  }

  setPlayhead(ms: number): void {
    this.playheadMs = ms
  }

  /** Weighted distance of a use at media ms `mediaMs` from the playhead. */
  distanceAt(mediaMs: number): number {
    return weightedDistance(mediaMs, mediaMs, this.playheadMs)
  }

  /** Whether the glyphs in use fill the budget: then nothing farther than `farthest()` is worth computing. */
  full(): boolean {
    return this.total + this.hotBytes - this.orphanBytes >= FULL_SHARE * this.budgetBytes
  }

  /** The largest weighted distance of a glyph in use (0 when none). */
  farthest(): number {
    const cached = this.farthestCache
    if (cached && cached.version === this.version && cached.at === this.playheadMs) return cached.value
    let value = 0
    for (const entry of this.order)
      if (entry.use) value = Math.max(value, weightedDistance(entry.use.first, entry.use.last, this.playheadMs))
    this.farthestCache = { at: this.playheadMs, version: this.version, value }
    return value
  }

  /** Bytes held: the packed glyphs, and the objects of those recently looked up. */
  bytes(): number {
    return this.total + this.hotBytes
  }

  points(): number {
    return this.pointCount
  }

  size(): number {
    return this.order.size
  }

  orphans(): number {
    let n = 0
    for (const entry of this.order) if (!entry.use) n++
    return n
  }

  /** Hears the glyphs each eviction dropped; returns the unsubscribe function. */
  onEvict(listener: (evicted: readonly { key: string; index: number }[]) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  clear(): void {
    const evicted = [...this.order].map(({ key, index }) => ({ key, index }))
    this.entries.clear()
    this.order.clear()
    this.uses.clear()
    this.hot.clear()
    this.hotBytes = 0
    this.total = 0
    this.orphanBytes = 0
    this.pointCount = 0
    this.version++
    if (evicted.length) this.tell(evicted)
  }

  private remove(key: string, index: number): Entry | undefined {
    const byIndex = this.entries.get(key)
    const entry = byIndex?.get(index)
    if (!byIndex || !entry) return undefined
    byIndex.delete(index)
    if (!byIndex.size) this.entries.delete(key)
    this.order.delete(entry)
    if (this.hot.has(entry)) this.cool(entry)
    this.total -= entry.bytes
    this.pointCount -= entry.points
    if (!entry.use) this.orphanBytes -= entry.bytes
    this.version++
    return entry
  }

  /** Drops the glyph's objects (it stays packed). */
  private cool(entry: Entry) {
    this.hot.delete(entry)
    this.hotBytes -= entry.hotBytes
    entry.materialized = null
  }

  private evict() {
    // The objects of the glyphs looked up count too (the packed ones make room for them).
    const over = () => this.total + this.hotBytes > 0.9 * this.budgetBytes
    const evicted: { key: string; index: number }[] = []
    const drop = (entry: Entry) => {
      this.remove(entry.key, entry.index)
      evicted.push({ key: entry.key, index: entry.index })
    }
    // Orphans first, oldest first.
    if (this.orphanBytes > 0) {
      for (const entry of this.order) {
        if (!over()) break
        if (!entry.use) drop(entry)
      }
    }
    if (over()) {
      // Then the farthest, by second of weighted distance (the newest first within a second).
      const buckets: Entry[][] = Array.from({ length: BUCKETS }, () => [])
      for (const entry of this.order) {
        const d = weightedDistance(entry.use!.first, entry.use!.last, this.playheadMs)
        if (d < this.protectMs) continue
        buckets[Math.min(BUCKETS - 1, Math.floor(d / 1000))].push(entry)
      }
      for (let b = BUCKETS - 1; b >= 0 && over(); b--) {
        const bucket = buckets[b]
        for (let i = bucket.length - 1; i >= 0 && over(); i--) drop(bucket[i])
      }
    }
    if (!evicted.length) return
    this.evictions += evicted.length
    this.tell(evicted)
  }

  private tell(evicted: readonly { key: string; index: number }[]) {
    for (const listener of this.listeners) listener(evicted)
  }
}
