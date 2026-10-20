// The page's side of the geometry workers: sends them the font and the glyphs to compute, keeps the
// results, and tells React when new ones arrive. Live frames (parameters Sound is driving) keep their
// results apart, so a song does not push out the results of normal editing, and reach React only when
// complete, so each live frame appears whole (SOUND_PLAN §2). A live frame whose letters react by
// different amounts asks for several parameter sets in one request (jobs).
//
// There is a pool of workers (2 to 4, by the number of cores: poolSize), and each request is shared out
// among them, glyph by glyph: a glyph keeps going to the same worker (whose cache knows it) unless that
// worker has more than its share of the request, and the share is weighed by how long each glyph took
// before. A request is one request to its asker: it ends when every worker's part has ended.
//
// Glyphs are computed only in the workers, never on the page. Every request ends with an answer; a
// worker that falls silent is restarted on its own, and the glyph it was stuck on is marked failed so the
// rest of the text goes on. If no worker can start, the workers cannot open the font, or they keep failing
// (counted for the whole pool), the glyphs fail and the canvas says why (getProblem).
//
// Besides the canvas's requests, two more lanes run in the same workers (protocol.ts Lane), each apart from the others:
// the precompute window ('ahead', driven by aheadGeometry.ts), whose glyphs are kept packed in a store of their own
// (aheadStore.ts, within a byte budget) and stand in for the canvas's like any result, and Glide plans on demand ('plan'). Ahead work is pinned to one worker per glyph
// (homeAhead), so a glyph's Glide chain stays in the worker that holds its states. Only the canvas lane counts as
// computing (isComputing), so the live scheduler never waits on the others.

import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import type { LoadedFont } from '../font/model'
import type { AheadItem, EncodedGlyph, Lane, WorkerGeometry, WorkerRequest, WorkerResponse } from '../geometry/protocol'
import type { FrameJob, GeometryJob, GeometryParams, PolygonGlyph } from '../geometry/types'
import type { PlanData } from '../specimen/planData'
import type { PolygonLookup } from '../specimen/scene'
import { PRECOMPUTE_LIMITS } from '../sound/timelineTypes'
import { AheadStore } from './aheadStore'
// Registers the ahead lane's page side and the worker plans (aheadTypes.ts) wherever the client is used.
import './aheadGeometry'

/** A result. `transient` marks a glyph that was not computed (the worker stopped): not a fault of the glyph. */
export type GeometryEntry = { geometry: WorkerGeometry } | { error: string; transient?: boolean }

/** A result, and whether it is from earlier settings (shown until the current one arrives). */
export interface GeometryLookup {
  entry: GeometryEntry
  stale: boolean
}

/** Parameter sets whose results are kept, so stepping back to recent settings is instant. */
const KEPT_KEYS = 4
/**
 * Live parameter sets whose results are kept, least recently asked for dropped first: the frame on
 * screen and the one being computed, so twice the most sets a live request asked for lately (LIVE_ASKS),
 * between LIVE_MIN_KEYS (frames of up to three sets: letters reacting by different amounts) and
 * LIVE_KEPT_KEYS (up to sixteen: three levels times five Thorn turn groups, THORN_TURNS in
 * src/sound/types.ts, and the shared values). With Thorn turns, each set holds only the glyphs its letters show.
 */
export const LIVE_KEPT_KEYS = 32
const LIVE_MIN_KEYS = 6
/** How many recent live requests the number of sets kept follows. */
const LIVE_ASKS = 4
/** Worker results arriving within this many milliseconds are shown in one update. */
const NOTIFY_MS = 50
/**
 * A busy worker silent this long is stuck: it is restarted, and the glyph it was on is marked failed.
 * The pipeline's per-glyph budget keeps the slowest glyph to about 3 s on a fast machine; the margin
 * leaves room for slow machines and for opening a large font, so only a fault gets here.
 */
const WATCHDOG_MS = 60_000
/**
 * After more than this many restarts within RESTART_WINDOW_MS, counted for the whole pool (a glyph that crashes workers
 * crashes each one it goes to), geometry stops until the next font.
 */
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 60_000
/**
 * A glyph of superseded settings that has run this long is abandoned for new settings: the worker is
 * replaced at once instead of finishing it (never for a live frame).
 */
const PREEMPT_MS = 750
/** At most one such replacement in the pool this often: each one opens the font again and starts from an empty cache. */
const PREEMPT_GAP_MS = 2000
/** Requests remembered by id, so the glyph a silent worker is stuck on can be blamed after its request was superseded. */
const REMEMBERED_REQUESTS = 8
/** Most workers in the pool: past four, a frame's few dozen distinct glyphs gain little, and each worker holds its own copy of the font. */
const MAX_WORKERS = 4
/**
 * How far past an even share of a request a worker may be loaded with glyphs it computed before (so its cache
 * knows them) before they go to the least loaded worker instead.
 */
const SHARE_SLACK = 0.1
/** How much a glyph's newest time counts in its estimate (the rest is its earlier estimate). */
const COST_WEIGHT = 0.5

const CANNOT_START = 'The geometry worker could not start. Reload the page to try again.'

type ComputeRequest = Extract<WorkerRequest, { type: 'compute' }>

/**
 * Who asked: the canvas (useGlyphGeometry), the live scheduler ahead of a frame's render (prefetch),
 * or an export (ensure).
 */
type Origin = 'canvas' | 'prefetch' | 'export'

/** One worker of the pool, and what the page knows of it. */
interface Slot {
  worker: Worker | null
  /** When the worker last sent anything (or started). */
  lastHeard: number
  /** The glyph (and its font, settings and lane) the worker said it started, while nothing has been heard since. */
  current: { requestId: number; fontId: string | undefined; key: string; index: number; at: number; lane: Lane } | null
  /** The font was sent again after the worker said it did not have it (once per font). */
  resentFont: boolean
  /** Out of the pool until the next font: it could not start. */
  retired: boolean
  /** Its ahead request not ended yet, and when it was sent (the watchdog's clock). */
  ahead: { id: number; sentAt: number } | null
  /** Its plan requests not answered yet. */
  plans: Set<number>
}

/** Hears the ahead lane (aheadGeometry.ts). */
export interface AheadListener {
  /** These glyphs of commit `seq` are in the ahead store now. */
  results(seq: number, key: string, indices: number[], times: (number | null)[]): void
  /** Commit `seq`'s chain steps. */
  plans(message: Extract<WorkerResponse, { type: 'ahead-plans' }>): void
  /** An ahead request ended (done, stopped, or its worker restarted or was replaced): what is missing may be sent again. */
  ended(stopped: boolean): void
}

/** A worker's share of a request: its glyphs, by parameter set, in the request's order. */
interface Part {
  request: ComputeRequest
  /** True until the worker ends it ('done', 'failed', or a restart). */
  pending: boolean
}

interface InFlight {
  id: number
  /** The glyphs on their way, by parameter set (a worker's glyphs leave when it is restarted). */
  pairs: Map<string, Set<number>>
  /** The first parameter set asked for (see RequestInfo.primary). */
  primary: string | undefined
  live: boolean
  origin: Origin
  sentAt: number
  /** Each worker's part. */
  parts: Map<Slot, Part>
  /** A worker's part ended without its glyphs (restarted, or no font): the end must reach React, which asks again. */
  broken: boolean
}

/** What is remembered of a request: whether it was live, and the first parameter set its asker wanted. */
interface RequestInfo {
  fontId: string
  live: boolean
  /**
   * The key of the asker's first job (before glyphs already known were left out): the canvas's shown settings, or a
   * live frame's shared set. Only its results stand in for a glyph (`latest`); a live frame's other levels never do.
   */
  primary: string | undefined
}

export interface GeometryClientOptions {
  /** Starts a worker (called once per worker of the pool); throws where workers cannot start. */
  createWorker?: () => Worker
  /** Workers in the pool (poolSize() if not given); with 1, every request goes to one worker. */
  workers?: number
  /** Silence after which a busy worker counts as stuck (ms). */
  watchdogMs?: number
  /** The ahead store's budget (bytes). */
  aheadBytes?: number
}

const startGeometryWorker = () => new Worker(new URL('../geometry/geometry.worker.ts', import.meta.url), { type: 'module' })

/**
 * Workers in the pool for this many logical cores: one fewer than the cores, so the page's own thread (React,
 * Sound's analysis) keeps one, but at least two (a dual core still computes on both while the page waits for a
 * frame) and at most MAX_WORKERS.
 */
export function poolSize(cores = typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency): number {
  const n = Number.isFinite(cores) && cores! > 0 ? Math.floor(cores!) - 1 : 2
  return Math.min(MAX_WORKERS, Math.max(2, n))
}

export class GeometryClient {
  private readonly slots: Slot[]
  private readonly createWorker: () => Worker
  private readonly watchdogMs: number
  private font: LoadedFont | null = null
  private fontId: string | null = null
  private byKey = new Map<string, Map<number, GeometryEntry>>()
  private liveByKey = new Map<string, Map<number, GeometryEntry>>()
  /** The newest result per glyph that was computed or shown, used while the current one is computed. */
  private latest = new Map<number, GeometryEntry>()
  private inFlight: InFlight | null = null
  /** Recent requests by id, for blaming a glyph and for which results stand in (`latest`). */
  private requests = new Map<number, RequestInfo>()
  private nextId = 1
  private listeners = new Set<() => void>()
  private idleListeners = new Set<() => void>()
  private version = 0
  /** The font and glyphs the canvas shows, for live frames asked for before they render (prefetch). */
  private shown: { font: LoadedFont; indices: readonly number[] } | null = null
  /** How many parameter sets the latest live requests asked for (LIVE_ASKS of them), newest last. */
  private liveSets: number[] = []
  /** The worker each glyph went to last (its cache knows the glyph), for this font. */
  private homes = new Map<number, Slot>()
  /**
   * How long each glyph took in a worker lately (ms), for this font: requests are shared out by it. One estimate per
   * glyph across settings: a live frame's settings are new each frame, and what the split needs is how glyphs compare.
   */
  private costs = new Map<number, number>()
  /** When a worker was last replaced for superseded settings (PREEMPT_GAP_MS), anywhere in the pool. */
  private lastReplaced = -Infinity
  /** When a worker was restarted after a fault, within the last RESTART_WINDOW_MS, anywhere in the pool. */
  private restarts: number[] = []

  private watchdog: ReturnType<typeof setTimeout> | null = null
  /** Why geometry stopped for good (until the next font), or null. */
  private stopped: string | null = null
  /** Why the worker cannot open a font. */
  private fontProblem: { fontId: string; message: string } | null = null
  /** The precompute window's results, packed (aheadGeometry.ts tells it which commits use them). */
  readonly aheadStore: AheadStore
  /** Bytes each worker's ahead store held at its last answer (the probe). */
  private workerBytes = new Map<Slot, number>()
  private aheadListener: AheadListener | null = null
  /** Plan requests on their way, by id. */
  private planRequests = new Map<number, { slot: Slot; sentAt: number; done: (data: PlanData | null) => void }>()
  /** The key each polygon held here was computed under (Glide matches a chained plan's `from` by it). */
  private keys = new WeakMap<PolygonGlyph, string>()
  /** Ahead requests from this id on are for the current font (older answers are dropped). */
  private aheadSince = 0
  /** Ahead work was sent for the current font (the workers hold some to forget when it changes). */
  private aheadSent = false

  constructor(options: GeometryClientOptions = {}) {
    this.createWorker = options.createWorker ?? startGeometryWorker
    this.watchdogMs = options.watchdogMs ?? WATCHDOG_MS
    const size = Math.max(1, Math.floor(options.workers ?? poolSize()))
    this.aheadStore = new AheadStore(options.aheadBytes ?? PRECOMPUTE_LIMITS.pageStoreBytes, {
      onMaterialize: (geometry, key) => this.keys.set(geometry.polygon, key),
    })
    this.slots = Array.from({ length: size }, () => ({
      worker: null,
      lastHeard: 0,
      current: null,
      resentFont: false,
      retired: false,
      ahead: null,
      plans: new Set(),
    }))
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = () => this.version

  /** Why glyphs cannot be computed now (shown on the canvas), or null. */
  getProblem = (): string | null => {
    if (this.stopped) return this.stopped
    return this.fontProblem && this.fontProblem.fontId === this.fontId ? this.fontProblem.message : null
  }

  /** True while a compute request is on its way in the workers (the live scheduler sends one at a time). */
  isComputing(): boolean {
    return this.inFlight !== null
  }

  /** Calls `listener` whenever the request in flight ends (answered, cancelled, or the workers restarted); returns the unsubscribe function. */
  subscribeIdle(listener: () => void): () => void {
    this.idleListeners.add(listener)
    return () => {
      this.idleListeners.delete(listener)
    }
  }

  /** True when results held here belong to this font. */
  holds(fontId: string): boolean {
    return this.fontId === fontId
  }

  /** The result for this glyph under these settings, or the newest earlier one (stale). */
  lookup(key: string, index: number): GeometryLookup | null {
    const current = this.entry(key, index)
    if (current) return { entry: current, stale: false }
    const earlier = this.latest.get(index)
    return earlier ? { entry: earlier, stale: true } : null
  }

  /** Mean vertex count of the glyphs computed under these settings, or null if there are none. */
  meanVertexCount(key: string): number | null {
    let count = 0
    let sum = 0
    for (const results of [this.byKey.get(key), this.liveByKey.get(key)]) {
      for (const entry of results?.values() ?? []) {
        if (!('geometry' in entry)) continue
        count++
        sum += entry.geometry.vertexCount
      }
    }
    return count ? sum / count : null
  }

  /**
   * Asks for these glyphs (most important first). Known glyphs and glyphs on their way are skipped.
   * `live` marks parameters Sound is driving: their results are kept apart (LIVE_KEPT_KEYS).
   */
  compute(font: LoadedFont, params: GeometryParams, key: string, indices: readonly number[], live = false) {
    this.computeJobs(font, [{ params, key, indices }], live)
  }

  /**
   * Asks for glyphs under several parameter sets in one request (a live frame whose letters react by
   * different amounts), the first set first. Otherwise as `compute`.
   */
  computeJobs(font: LoadedFont, jobs: readonly GeometryJob[], live = false) {
    this.ask(font, jobs, live, 'canvas')
  }

  /** The font and glyphs the canvas shows (useGlyphGeometry), so prefetch knows what a frame needs. */
  show(font: LoadedFont | null, indices: readonly number[]) {
    this.shown = font ? { font, indices } : null
  }

  /** The font and glyphs the canvas shows (show), for frames whose jobs are resolved ahead (sound/director.ts). */
  shownGlyphSet(): { fontId: string; indices: readonly number[] } | null {
    return this.shown ? { fontId: this.shown.font.id, indices: this.shown.indices } : null
  }

  /**
   * Asks for a live frame's glyphs before React renders it, every parameter set its letters show in one
   * request (a job without `indices` asks for the glyphs the canvas shows): the live scheduler commits the
   * frame once they have arrived, so it renders once, complete. True while they are computed (idle listeners
   * hear when the request ends); false when there is nothing to wait for.
   */
  prefetchJobs(jobs: readonly FrameJob[]): boolean {
    const shown = this.shown
    if (shown === null) return false
    const asked = jobs.map(({ params, key, indices, within }) => ({ params, key, indices: indices ?? shownGlyphs(shown.indices, within) }))
    return this.ask(shown.font, asked, true, 'prefetch')
  }

  /**
   * Polygons for an export: resolves once every one of these glyphs has a result under these settings,
   * asking the workers for those still missing (never computing on the page). Rejects when `signal` aborts.
   */
  ensure(font: LoadedFont, params: GeometryParams, key: string, indices: readonly number[], signal?: AbortSignal): Promise<PolygonLookup> {
    return new Promise((resolve, reject) => {
      const missing = () => indices.filter((i) => !this.entry(key, i))
      const check = () => {
        if (signal?.aborted) {
          end(() => reject(signal.reason))
          // Nobody wants these glyphs now: the workers stop on them (between glyphs).
          if (this.inFlight?.origin === 'export') this.cancel()
          return
        }
        if (this.inFlight === null && missing().length) this.ask(font, [{ params, key, indices: missing() }], false, 'export')
        // Done, or nothing left to wait for (glyphs that cannot be computed now have failed).
        if (!missing().length || this.inFlight === null) end(() => resolve(this.snapshot(key, indices)))
      }
      const off = this.subscribeIdle(check)
      const end = (settle: () => void) => {
        off()
        signal?.removeEventListener('abort', check)
        settle()
      }
      signal?.addEventListener('abort', check)
      check()
    })
  }

  /** The results under these settings for these glyphs, as they are now (later evictions do not change it). */
  private snapshot(key: string, indices: readonly number[]): PolygonLookup {
    const found = new Map<number, GeometryEntry>()
    for (const index of indices) {
      const entry = this.entry(key, index)
      if (entry) found.set(index, entry)
    }
    return (index) => {
      const entry = found.get(index)
      if (!entry) return null
      return 'error' in entry ? { error: entry.error } : { polygon: entry.geometry.polygon }
    }
  }

  private entry(key: string, index: number): GeometryEntry | undefined {
    return this.byKey.get(key)?.get(index) ?? this.liveByKey.get(key)?.get(index) ?? this.aheadStore.get(key, index)
  }

  /** True when a result for this glyph under these settings is held (in any of the three stores). */
  has(key: string, index: number): boolean {
    return this.byKey.get(key)?.has(index) === true || this.liveByKey.get(key)?.has(index) === true || this.aheadStore.has(key, index)
  }

  /** The key a polygon held here was computed under, or null (an in-between shape, or not from here). */
  keyOf(polygon: PolygonGlyph): string | null {
    return this.keys.get(polygon) ?? null
  }

  /** The ahead lane's listener (aheadGeometry.ts); one at a time. */
  setAheadListener(listener: AheadListener | null) {
    this.aheadListener = listener
  }

  /** The worker a glyph's ahead work goes to: one per glyph index among the workers running, so its chain stays there. */
  private homeAhead(index: number, slots: readonly Slot[]): Slot {
    return slots[index % slots.length]
  }

  /** Some worker is still working on its part of the last lease (its ahead-done has not come). */
  aheadInFlight(): boolean {
    return this.slots.some((slot) => slot.ahead !== null)
  }

  /** Workers in the pool (the ahead lane's leases are shared among them). */
  workerCount(): number {
    return Math.max(1, this.slots.filter((slot) => !slot.retired).length)
  }

  /**
   * Sends the precompute window's work (aheadGeometry.ts) for the font the canvas shows (`fontId`): each worker gets its
   * glyphs and chain steps, in order, replacing what it was sent before; a worker with nothing to do is told to stop.
   * `playheadMs`: where playback is (the workers' stores keep what is used soonest). False when that is not the font
   * held here, or no worker runs.
   */
  sendAhead(fontId: string, generation: number, glideMs: number, playheadMs: number, items: readonly AheadItem[]): boolean {
    const font = this.font
    if (!font || font.id !== fontId) return false
    this.startWorkers()
    const slots = this.slots.filter((slot) => slot.worker)
    if (!slots.length || this.getProblem()) return false
    const parts = new Map<Slot, AheadItem[]>()
    const add = (slot: Slot, item: AheadItem) => {
      let part = parts.get(slot)
      if (!part) parts.set(slot, (part = []))
      part.push(item)
    }
    for (const item of items) {
      if (item.kind === 'step') {
        add(this.homeAhead(item.index, slots), item)
        continue
      }
      const bySlot = new Map<Slot, number[]>()
      for (const index of item.indices) {
        const slot = this.homeAhead(index, slots)
        let indices = bySlot.get(slot)
        if (!indices) bySlot.set(slot, (indices = []))
        indices.push(index)
      }
      for (const [slot, indices] of bySlot) add(slot, { ...item, indices })
    }
    const now = performance.now()
    for (const slot of slots) {
      const part = parts.get(slot)
      if (!part) {
        if (slot.ahead) this.send(slot, { type: 'cancel', requestId: slot.ahead.id })
        slot.ahead = null
        continue
      }
      const id = this.nextId++
      this.aheadSent = true
      slot.ahead = { id, sentAt: now }
      this.send(slot, { type: 'ahead', requestId: id, fontId: font.id, generation, glideMs, playheadMs, items: part })
    }
    this.armWatchdog(this.watchdogMs)
    return true
  }

  /** Commits before `beforeSeq` will not be shown: every worker forgets their glyphs and chain states. */
  releaseAhead(beforeSeq: number) {
    for (const slot of this.slots) this.send(slot, { type: 'ahead-release', beforeSeq })
  }

  /** Points held in the ahead store. */
  aheadPoints(): number {
    return this.aheadStore.points()
  }

  /** Bytes each worker's ahead store held at its last answer (the probe). */
  aheadWorkerBytes(): number[] {
    return this.slots.map((slot) => this.workerBytes.get(slot) ?? 0)
  }

  /**
   * Asks a worker to plan a glide (the plan lane): `from` by value with its side tables, `to` by value or by the key
   * and glyph it was computed under. `done` gets the plan's data (null: change at once; also when its worker was
   * restarted). Returns a cancel, after which `done` is never called; null when no worker can take it (nothing sent).
   */
  requestPlan(from: EncodedGlyph, to: EncodedGlyph | { key: string; index: number }, done: (data: PlanData | null) => void): (() => void) | null {
    const font = this.font
    if (font) this.startWorkers()
    const slots = this.slots.filter((slot) => slot.worker)
    if (!font || !slots.length || this.getProblem()) return null
    // The glyph's home worker when it is free of plans, else the worker with fewest plans waiting.
    const index = from.glyph.ref.index
    const home = this.homes.get(index)
    const slot = home && slots.includes(home) && home.plans.size === 0 ? home : slots.reduce((a, b) => (b.plans.size < a.plans.size ? b : a))
    const id = this.nextId++
    slot.plans.add(id)
    this.planRequests.set(id, { slot, sentAt: performance.now(), done })
    this.send(slot, { type: 'plan', requestId: id, fontId: font.id, from, to })
    this.armWatchdog(this.watchdogMs)
    return () => {
      if (!this.planRequests.delete(id)) return
      slot.plans.delete(id)
      this.send(slot, { type: 'cancel', requestId: id })
    }
  }

  /**
   * Ends this worker's ahead request and plans without answers (it was restarted or replaced, or the font changed):
   * the plans change at once, and the ahead lane hears it once the pool is settled (it may send the window again).
   */
  private dropLanes(slot: Slot) {
    const hadAhead = slot.ahead !== null
    slot.ahead = null
    const dropped = [...slot.plans].map((id) => this.planRequests.get(id))
    for (const id of slot.plans) this.planRequests.delete(id)
    slot.plans.clear()
    if (!hadAhead && !dropped.length) return
    queueMicrotask(() => {
      for (const pending of dropped) pending?.done(null)
      if (hadAhead) this.aheadListener?.ended(true)
    })
  }

  /**
   * Sends one request for the glyphs still missing under each parameter set; true when one is on its way
   * (now or already).
   */
  private ask(font: LoadedFont, jobs: readonly GeometryJob[], live: boolean, origin: Origin): boolean {
    this.useFont(font)
    // The asker's first parameter set, even when its glyphs are all known and it is not sent.
    const primary = jobs[0]?.key
    if (live) {
      this.liveSets.push(jobs.length)
      if (this.liveSets.length > LIVE_ASKS) this.liveSets.shift()
    }
    const missing = new Map<string, { params: GeometryParams; indices: Set<number> }>()
    jobs.forEach(({ params, key, indices }, n) => {
      // Settings that were a live frame (Freeze keeps one) become ordinary kept results; live settings
      // asked for again are dropped last.
      if (live) this.touchLive(key)
      else this.promote(key)
      for (const i of indices) {
        const entry = this.entry(key, i)
        if (entry) {
          // On the canvas, each glyph's shape under the first settings is what is on screen now: it stands in
          // while later settings are computed (after Sound stops, the sliders' own shapes, not the last live frame).
          if (origin === 'canvas' && n === 0) this.latest.set(i, entry)
          continue
        }
        let job = missing.get(key)
        if (!job) missing.set(key, (job = { params, indices: new Set() }))
        job.indices.add(i)
      }
    })
    if (!missing.size) {
      // The canvas has everything (e.g. back to recent settings): what it asked for before is no longer needed.
      if (origin === 'canvas' && this.inFlight?.origin === 'canvas') this.cancel()
      return false
    }
    const inFlight = this.inFlight
    if (inFlight && covers(inFlight.pairs, missing)) {
      // The canvas waits for it too, so its end must reach React.
      if (origin === 'canvas' && inFlight.origin === 'prefetch') inFlight.origin = 'canvas'
      return true
    }
    const needed: GeometryJob[] = [...missing].map(([key, { params, indices }]) => ({ params, key, indices: [...indices] }))
    this.startWorkers()
    if (!this.getProblem() && this.request(needed, live, origin, primary)) return true
    // No page-side computing: the glyphs fail (canvas, preview and exports alike) and the canvas says why.
    const problem = this.getProblem() ?? CANNOT_START
    for (const { key, indices } of needed) for (const i of indices) this.store(key, i, { error: problem, transient: true }, live)
    if (origin !== 'prefetch') this.notify()
    // A request still in flight has no worker left to end it (they were replaced and none started again): it is over.
    this.cancel()
    return false
  }

  /**
   * Shares the jobs out among the workers and sends each its part; the request in flight before is superseded.
   * False when no worker is left to send it to.
   */
  private request(jobs: GeometryJob[], live: boolean, origin: Origin, primary: string | undefined): boolean {
    const font = this.font!
    // A worker busy with a glyph nobody asks for now is replaced (static settings only).
    if (!live) {
      const stuck = this.stuckElsewhere(jobs)
      if (stuck) this.replaceWorker(stuck)
    }
    const shares = this.share(jobs, this.slots.filter((slot) => slot.worker))
    if (!shares.size) return false
    for (const [slot, part] of shares) for (const { indices } of part) for (const i of indices) this.homes.set(i, slot)
    const id = this.nextId++
    const previous = this.inFlight
    const parts = new Map<Slot, Part>()
    for (const [slot, part] of shares) {
      parts.set(slot, { request: { type: 'compute', requestId: id, fontId: font.id, jobs: part, ...(live ? { live } : {}) }, pending: true })
    }
    const pairs = new Map(jobs.map((job) => [job.key, new Set(job.indices)]))
    this.inFlight = { id, pairs, primary, live, origin, sentAt: performance.now(), parts, broken: false }
    this.requests.set(id, { fontId: font.id, live, primary })
    while (this.requests.size > REMEMBERED_REQUESTS) this.requests.delete(this.requests.keys().next().value!)
    // A worker's new part stops its old one; a worker without one is told to stop.
    for (const [slot, part] of previous?.parts ?? []) {
      if (part.pending && !parts.has(slot)) this.send(slot, { type: 'cancel', requestId: previous!.id })
    }
    for (const [slot, part] of parts) this.send(slot, part.request)
    this.armWatchdog(this.watchdogMs)
    return true
  }

  /**
   * Each worker's part of these jobs: every glyph (under all its parameter sets) to one worker, in the jobs' order.
   * A glyph a worker is computing now stays with it (asked for again, it finishes there instead of starting over
   * elsewhere). Then, heaviest first, a glyph goes back to the worker it went to last while that worker stays within an
   * even share of the request (by each glyph's recent time, SHARE_SLACK over), else to the least loaded worker.
   */
  private share(jobs: GeometryJob[], slots: Slot[]): Map<Slot, GeometryJob[]> {
    if (slots.length <= 1) return new Map(slots.map((slot) => [slot, jobs]))
    // Every glyph's estimated time in this request (under all its sets); a glyph never timed counts as the mean.
    const known = [...this.costs.values()]
    const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1
    const weights = new Map<number, number>()
    for (const { indices } of jobs) for (const i of indices) weights.set(i, (weights.get(i) ?? 0) + (this.costs.get(i) ?? fallback))
    const load = new Map(slots.map((slot) => [slot, 0]))
    const owner = new Map<number, Slot>()
    for (const slot of slots) {
      const current = slot.current
      if (!current || owner.has(current.index) || !this.asks(jobs, current)) continue
      owner.set(current.index, slot)
      load.set(slot, weights.get(current.index)!)
    }
    const order = [...weights].filter(([index]) => !owner.has(index)).sort((a, b) => b[1] - a[1] || a[0] - b[0])
    const total = [...weights.values()].reduce((sum, w) => sum + w, 0)
    const cap = Math.max((total / slots.length) * (1 + SHARE_SLACK), order[0]?.[1] ?? 0)
    for (const [index, weight] of order) {
      const home = this.homes.get(index)
      let slot = home !== undefined && load.has(home) && load.get(home)! + weight <= cap ? home : undefined
      if (!slot) slot = slots.reduce((a, b) => (load.get(b)! < load.get(a)! ? b : a))
      load.set(slot, load.get(slot)! + weight)
      owner.set(index, slot)
    }
    const shares = new Map<Slot, GeometryJob[]>()
    for (const slot of slots) {
      const part = jobs
        .map((job) => ({ ...job, indices: job.indices.filter((i) => owner.get(i) === slot) }))
        .filter((job) => job.indices.length)
      if (part.length) shares.set(slot, part)
    }
    return shares
  }

  /** Stops the request in flight (between glyphs, in the workers) and tells the idle listeners. */
  private cancel() {
    const inFlight = this.inFlight
    if (!inFlight) return
    this.stopParts(inFlight)
    this.inFlight = null
    this.idle()
  }

  /** Tells every worker still on a part of this request to stop. */
  private stopParts(inFlight: InFlight) {
    for (const [slot, part] of inFlight.parts) if (part.pending) this.send(slot, { type: 'cancel', requestId: inFlight.id })
  }

  /** True when these jobs ask for the glyph a worker is on (the same font, settings and glyph). */
  private asks(jobs: readonly GeometryJob[], current: NonNullable<Slot['current']>): boolean {
    return current.fontId === this.fontId && jobs.some(({ key, indices }) => key === current.key && indices.includes(current.index))
  }

  /**
   * The worker in one glyph for longest, at least PREEMPT_MS, that these jobs do not ask for (the glyph of superseded
   * settings): replacing it is quicker than waiting for it. None within PREEMPT_GAP_MS of the last replacement.
   */
  private stuckElsewhere(jobs: readonly GeometryJob[]): Slot | undefined {
    const now = performance.now()
    if (now - this.lastReplaced < PREEMPT_GAP_MS) return undefined
    let stuck: Slot | undefined
    for (const slot of this.slots) {
      const current = slot.current
      if (!slot.worker || !current || now - current.at < PREEMPT_MS || this.asks(jobs, current)) continue
      if (!stuck || current.at < stuck.current!.at) stuck = slot
    }
    return stuck
  }

  /** The glyphs that went to this worker are not in its cache now (it was replaced or restarted). */
  private forgetHomes(slot: Slot) {
    for (const [index, home] of this.homes) if (home === slot) this.homes.delete(index)
  }

  private useFont(font: LoadedFont) {
    if (this.fontId === font.id) return
    const inFlight = this.inFlight
    if (inFlight) this.stopParts(inFlight)
    this.inFlight = null
    this.font = font
    this.fontId = font.id
    this.byKey.clear()
    this.liveByKey.clear()
    this.latest.clear()
    this.homes.clear()
    this.costs.clear()
    // The window and its chains were the old font's: every worker forgets them, and answers still on their way are dropped.
    this.aheadStore.clear()
    this.workerBytes.clear()
    this.aheadSince = this.nextId
    for (const slot of this.slots) {
      this.dropLanes(slot)
      if (this.aheadSent) this.send(slot, { type: 'ahead-release', beforeSeq: Infinity })
    }
    this.aheadSent = false
    // A new font is a fresh start after geometry stopped: every worker is back in the pool.
    this.stopped = null
    this.restarts = []
    for (const slot of this.slots) {
      slot.resentFont = false
      slot.retired = false
      if (slot.worker) this.sendFont(slot)
    }
    this.startWorkers()
    // After the request that asked for this font is on its way (an idle listener may ask for glyphs itself).
    if (inFlight) queueMicrotask(() => this.idle())
  }

  private sendFont(slot: Slot) {
    const font = this.font
    if (font) this.send(slot, { type: 'font', fontId: font.id, bytes: font.bytes, source: font.source, workers: this.slots.length })
  }

  /** Starts the workers missing from the pool (and sends them the font), unless geometry stopped. */
  private startWorkers() {
    if (this.stopped) return
    for (const slot of this.slots) if (!slot.worker && !slot.retired) this.startWorker(slot)
  }

  /** Starts this worker; a worker that cannot start leaves the pool, and with none left geometry stops. */
  private startWorker(slot: Slot) {
    let worker: Worker
    try {
      worker = this.createWorker()
    } catch {
      this.retire(slot, CANNOT_START)
      return
    }
    // Messages a replaced worker sent before it was stopped are ignored.
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (slot.worker === worker) this.receive(slot, event.data)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      if (slot.worker === worker) this.restart(slot, 'kept failing')
    }
    worker.onmessageerror = () => {
      if (slot.worker === worker) this.restart(slot, 'kept failing')
    }
    slot.worker = worker
    slot.lastHeard = performance.now()
    this.sendFont(slot)
  }

  /** Takes the worker out of the pool until the next font; with none left, geometry stops for this reason. */
  private retire(slot: Slot, problem: string) {
    slot.retired = true
    if (this.slots.every((s) => s.retired)) this.stopped = problem
  }

  /** Terminates this worker; its cache goes with it. */
  private stopWorker(slot: Slot) {
    slot.worker?.terminate()
    slot.worker = null
    slot.current = null
    this.forgetHomes(slot)
    this.dropLanes(slot)
  }

  /** A new worker in place of one busy with a glyph nobody needs (not a fault: no restart is counted). */
  private replaceWorker(slot: Slot) {
    this.lastReplaced = performance.now()
    this.stopWorker(slot)
    slot.resentFont = false
    this.startWorker(slot)
  }

  /**
   * After a fault: a new worker in this one's place, unless the pool restarted workers too often lately (then
   * geometry stops). Its part of the request in flight ends; the other workers go on, and once all have ended, what
   * this one did not send is asked for again by the next render (useGlyphGeometry's `version`), by the live
   * scheduler, or by an export.
   */
  private restart(slot: Slot, what: string) {
    this.stopWorker(slot)
    const now = performance.now()
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS)
    this.restarts.push(now)
    if (this.restarts.length > MAX_RESTARTS) {
      this.stop(`The geometry worker ${what}. Reload the page to try again.`)
      return
    }
    this.startWorker(slot)
    const inFlight = this.inFlight
    const part = inFlight?.parts.get(slot)
    if (inFlight && part?.pending) this.endPart(inFlight, part)
    else if (!inFlight) {
      this.notifyNow()
      this.idle()
    }
  }

  /** Geometry stops until the next font: every worker is terminated, and the request in flight ends. */
  private stop(problem: string) {
    for (const slot of this.slots) {
      this.stopWorker(slot)
      slot.retired = true
    }
    this.stopped = problem
    this.inFlight = null
    // The canvas asks again, and its glyphs fail with the reason.
    this.notifyNow()
    this.idle()
  }

  /** A worker's part ended without all its glyphs: they are no longer on their way, and the request may be over. */
  private endPart(inFlight: InFlight, part: Part) {
    part.pending = false
    inFlight.broken = true
    for (const { key, indices } of part.request.jobs) for (const i of indices) inFlight.pairs.get(key)?.delete(i)
    this.endIfComplete(inFlight)
  }

  /** Ends the request once every worker's part has ended. */
  private endIfComplete(inFlight: InFlight) {
    if (this.inFlight !== inFlight) return
    for (const part of inFlight.parts.values()) if (part.pending) return
    this.inFlight = null
    // A live frame is complete: show it now, whole (its results were held back until now). A prefetched frame is
    // not shown yet: the live scheduler commits it when it hears it is idle. A request a worker did not finish is
    // shown at once, so the canvas asks again for what is missing.
    if (inFlight.broken || (inFlight.live && inFlight.origin !== 'prefetch')) this.notifyNow()
    this.idle()
  }

  /** When this worker's newest request still waiting for an answer was sent (any lane), or null when it has none. */
  private busySince(slot: Slot): number | null {
    let since: number | null = null
    const later = (t: number) => (since = since === null ? t : Math.max(since, t))
    const inFlight = this.inFlight
    if (inFlight?.parts.get(slot)?.pending) later(inFlight.sentAt)
    if (slot.ahead) later(slot.ahead.sentAt)
    for (const id of slot.plans) {
      const pending = this.planRequests.get(id)
      if (pending) later(pending.sentAt)
    }
    return since
  }

  /**
   * One timer, re-armed lazily: when it fires, a worker with a request waiting (in any lane) after watchdogMs of silence
   * is restarted, and the glyph it said it started is blamed in that glyph's lane.
   */
  private armWatchdog(ms: number) {
    if (this.watchdog !== null) return
    this.watchdog = setTimeout(() => {
      this.watchdog = null
      let wait = Infinity
      for (const slot of this.slots) {
        const since = slot.worker ? this.busySince(slot) : null
        if (since === null) continue
        const silent = performance.now() - Math.max(slot.lastHeard, since)
        if (silent < this.watchdogMs) {
          wait = Math.min(wait, this.watchdogMs - silent)
          continue
        }
        // Blame the glyph the worker said it started, so asking again does not get stuck again.
        const current = slot.current
        const error = `Took longer than ${Math.round(this.watchdogMs / 1000)} s; try lighter settings`
        if (current?.lane === 'ahead') {
          if (current.fontId === this.fontId) this.aheadStore.put(current.key, current.index, { error })
        } else {
          const blamed = current && this.requests.get(current.requestId)
          if (current && blamed) this.store(current.key, current.index, { error }, blamed.live)
        }
        this.restart(slot, 'stopped responding')
      }
      if (wait < Infinity) this.armWatchdog(wait)
    }, ms)
  }

  private send(slot: Slot, message: WorkerRequest) {
    slot.worker?.postMessage(message)
  }

  private receive(slot: Slot, message: WorkerResponse) {
    const now = performance.now()
    slot.lastHeard = now
    if (message.type === 'glyph') {
      const ahead = slot.ahead?.id === message.requestId
      const fontId = ahead ? (this.fontId ?? undefined) : this.requests.get(message.requestId)?.fontId
      slot.current = { requestId: message.requestId, fontId, key: message.key, index: message.index, at: now, lane: ahead ? 'ahead' : 'canvas' }
      return
    }
    if (message.type !== 'font-error') slot.current = null
    if (message.type === 'results') {
      if (message.fontId !== this.fontId) return
      // A live frame's quiet and strong levels are not what a glyph shows everywhere: they never stand in for it.
      const asked = this.requests.get(message.requestId)
      const standsIn = !asked || asked.primary === undefined || message.key === asked.primary
      message.results.forEach((result, n) => {
        const entry: GeometryEntry = 'error' in result ? { error: result.error } : { geometry: result.geometry }
        this.store(message.key, result.index, entry, message.live === true, standsIn)
        const ms = message.times?.[n]
        if (ms !== undefined && ms !== null) {
          const before = this.costs.get(result.index)
          this.costs.set(result.index, before === undefined ? ms : before + COST_WEIGHT * (ms - before))
        }
      })
      // Live results wait for their frame's end, so each live frame appears whole (SOUND_PLAN §2).
      if (!message.live) this.notifySoon()
    } else if (message.type === 'done') {
      const inFlight = this.inFlight
      const part = inFlight?.parts.get(slot)
      if (inFlight?.id !== message.requestId || !part) return
      part.pending = false
      this.endIfComplete(inFlight)
    } else if (message.type === 'failed') {
      this.failed(slot, message.requestId, message.reason, message.message)
    } else if (message.type === 'font-error' && message.fontId === this.fontId) {
      this.fontProblem = { fontId: message.fontId, message: `The geometry worker could not open this font (${message.message}).` }
      this.notify()
    } else if (message.type === 'ahead-results') {
      // Requests sent before the font changed are over.
      if (message.requestId < this.aheadSince) return
      const indices: number[] = []
      for (const result of message.results) {
        this.aheadStore.put(message.key, result.index, result)
        indices.push(result.index)
      }
      this.aheadListener?.results(message.seq, message.key, indices, message.times)
    } else if (message.type === 'ahead-plans') {
      if (message.requestId >= this.aheadSince) this.aheadListener?.plans(message)
    } else if (message.type === 'ahead-done') {
      if (message.stored) this.workerBytes.set(slot, message.stored.bytes)
      if (slot.ahead?.id !== message.requestId) return
      slot.ahead = null
      this.aheadListener?.ended(message.stopped === true)
    } else if (message.type === 'plan-result') {
      const pending = this.planRequests.get(message.requestId)
      if (!pending) return
      this.planRequests.delete(message.requestId)
      pending.slot.plans.delete(message.requestId)
      pending.done(message.data)
    }
  }

  private failed(slot: Slot, requestId: number, reason: Extract<WorkerResponse, { type: 'failed' }>['reason'], message: string) {
    const inFlight = this.inFlight
    const part = inFlight?.parts.get(slot)
    if (!inFlight || inFlight.id !== requestId || !part?.pending) return
    if (reason === 'no-font' && !slot.resentFont && this.font) {
      // The worker does not have the font (it was dropped, or never arrived): send it again and repeat its part, once.
      slot.resentFont = true
      this.sendFont(slot)
      this.send(slot, part.request)
      return
    }
    if (reason === 'font') {
      const problem = `The geometry worker could not open this font (${message}).`
      this.fontProblem = { fontId: part.request.fontId, message: problem }
      for (const { key, indices } of part.request.jobs) {
        for (const i of indices) if (!this.entry(key, i)) this.store(key, i, { error: problem, transient: true }, inFlight.live)
      }
      this.endPart(inFlight, part)
      return
    }
    this.restart(slot, 'kept failing')
  }


  /** Keeps a result; `standsIn`: it also becomes the glyph's newest result, shown while other settings are computed. */
  private store(key: string, index: number, entry: GeometryEntry, live = false, standsIn = true) {
    const kept = live ? this.liveByKey : this.byKey
    let results = kept.get(key)
    if (!results) {
      results = new Map()
      kept.set(key, results)
      const max = live ? Math.min(LIVE_KEPT_KEYS, Math.max(LIVE_MIN_KEYS, 2 * Math.max(0, ...this.liveSets))) : KEPT_KEYS
      while (kept.size > max) kept.delete(kept.keys().next().value!)
    }
    results.set(index, entry)
    if ('geometry' in entry) this.keys.set(entry.geometry.polygon, key)
    if (standsIn) this.latest.set(index, entry)
  }

  /** Moves live results asked for again to the back of the kept ones, so the oldest frame's are dropped first. */
  private touchLive(key: string) {
    const results = this.liveByKey.get(key)
    if (!results) return
    this.liveByKey.delete(key)
    this.liveByKey.set(key, results)
  }

  /** Moves a live frame's results to the kept results of normal editing (merging with any there). */
  private promote(key: string) {
    const live = this.liveByKey.get(key)
    if (!live) return
    this.liveByKey.delete(key)
    const results = this.byKey.get(key)
    if (results) {
      for (const [index, entry] of live) if (!results.has(index)) results.set(index, entry)
      return
    }
    this.byKey.set(key, live)
    while (this.byKey.size > KEPT_KEYS) this.byKey.delete(this.byKey.keys().next().value!)
  }

  private idle() {
    for (const listener of this.idleListeners) listener()
  }

  private notify() {
    this.version++
    for (const listener of this.listeners) listener()
  }

  /** Batches that arrive close together re-render the page once. */
  private notifyTimer: ReturnType<typeof setTimeout> | null = null
  private notifySoon() {
    if (this.notifyTimer !== null) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.notify()
    }, NOTIFY_MS)
  }

  /** Sends a notification now, replacing a batched one that is waiting. */
  private notifyNow() {
    if (this.notifyTimer !== null) clearTimeout(this.notifyTimer)
    this.notifyTimer = null
    this.notify()
  }
}

/**
 * The glyphs a live frame's set asks for out of those the canvas shows (`indices`, the selected glyph first): all of
 * them, or with `within` only the first and those in `within` (FrameJob.within). The canvas and the live scheduler's
 * request use it alike, so the canvas asks for nothing more once the frame is committed.
 */
export function shownGlyphs(indices: readonly number[], within?: ReadonlySet<number>): readonly number[] {
  return within ? indices.filter((index, n) => n === 0 || within.has(index)) : indices
}

/** True when every glyph in `missing` is among `pairs` (glyphs by parameter set). */
function covers(pairs: Map<string, Set<number>>, missing: Map<string, { indices: Set<number> }>): boolean {
  for (const [key, { indices }] of missing) {
    const asked = pairs.get(key)
    if (!asked) return false
    for (const i of indices) if (!asked.has(i)) return false
  }
  return true
}

export const geometryClient = new GeometryClient()

/**
 * Geometry for these glyphs under these settings, computed in the worker. Re-renders as results
 * arrive; until then `lookup` returns the glyph's previous shape (stale) or null. `live` marks
 * parameters Sound is driving (kept apart from the results of normal editing). `extra` asks for more
 * parameter sets in the same request (letters of a live frame that react by different amounts); their
 * results are read with `geometryClient.lookup`. `within`: of `indices`, these settings are asked for
 * only the first and those in `within` (shownGlyphs; a live frame with Thorn turns).
 */
export function useGlyphGeometry(
  font: LoadedFont | null,
  params: GeometryParams,
  key: string,
  indices: readonly number[],
  live = false,
  extra?: readonly GeometryJob[],
  within?: ReadonlySet<number> | null,
) {
  const version = useSyncExternalStore(geometryClient.subscribe, geometryClient.getVersion)
  const indicesKey = indices.join(',')
  const asked = shownGlyphs(indices, within ?? undefined)
  const askedKey = asked === indices ? '' : asked.join(',')
  const extraKey = extra?.map((job) => `${job.key}\u001f${job.indices.join(',')}`).join('\u001e') ?? ''
  // Before any effect: the live scheduler may ask for the next frame's glyphs in one.
  useLayoutEffect(
    () => geometryClient.show(font, indices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [font, indicesKey],
  )
  useEffect(() => {
    if (!font) return
    geometryClient.computeJobs(font, [{ params, key, indices: asked }, ...(extra ?? [])], live)
    // `key` stands for `params`, `indicesKey` and `askedKey` for `asked`, `extraKey` for `extra`; `version` asks again after the worker restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, key, indicesKey, askedKey, extraKey, version, live])
  return useMemo(() => ({ lookup: (index: number) => geometryClient.lookup(key, index), version }), [key, version])
}

/** Why glyphs cannot be computed now (the canvas shows it), or null. */
export function useGeometryProblem(): string | null {
  return useSyncExternalStore(geometryClient.subscribe, geometryClient.getProblem)
}
