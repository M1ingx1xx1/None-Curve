// The page's side of the geometry worker: sends it the font and the glyphs to compute, keeps the
// results, and tells React when new ones arrive. Live frames (parameters Sound is driving) keep their
// results apart, so a song does not push out the results of normal editing, and reach React only when
// complete, so each live frame appears whole (SOUND_PLAN §2).
//
// Glyphs are computed only in the worker, never on the page. Every request ends with an answer; a
// worker that falls silent is restarted, and the glyph it was stuck on is marked failed so the rest of
// the text goes on. If the worker cannot start, cannot open the font, or keeps failing, the glyphs fail
// and the canvas says why (getProblem).

import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import type { LoadedFont } from '../font/model'
import type { WorkerGeometry, WorkerRequest, WorkerResponse } from '../geometry/protocol'
import type { GeometryParams } from '../geometry/types'
import type { PolygonLookup } from '../specimen/scene'

/** A result. `transient` marks a glyph that was not computed (the worker stopped): not a fault of the glyph. */
export type GeometryEntry = { geometry: WorkerGeometry } | { error: string; transient?: boolean }

/** A result, and whether it is from earlier settings (shown until the current one arrives). */
export interface GeometryLookup {
  entry: GeometryEntry
  stale: boolean
}

/** Parameter sets whose results are kept, so stepping back to recent settings is instant. */
const KEPT_KEYS = 4
/** Live parameter sets whose results are kept: the frame on screen and the one being computed. */
const LIVE_KEPT_KEYS = 2
/** Worker results arriving within this many milliseconds are shown in one update. */
const NOTIFY_MS = 50
/**
 * A busy worker silent this long is stuck: it is restarted, and the glyph it was on is marked failed.
 * The pipeline's per-glyph budget keeps the slowest glyph to about 3 s on a fast machine; the margin
 * leaves room for slow machines and for opening a large font, so only a fault gets here.
 */
const WATCHDOG_MS = 60_000
/** More than this many restarts within RESTART_WINDOW_MS and geometry stops until the next font. */
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 60_000
/**
 * A glyph of superseded settings that has run this long is abandoned for new settings: the worker is
 * replaced at once instead of finishing it (never for a live frame).
 */
const PREEMPT_MS = 750
/** At most one such replacement this often: each one opens the font again and starts from an empty cache. */
const PREEMPT_GAP_MS = 2000
/** Requests remembered by id, so the glyph a silent worker is stuck on can be blamed after its request was superseded. */
const REMEMBERED_REQUESTS = 8

const CANNOT_START = 'The geometry worker could not start. Reload the page to try again.'

type ComputeRequest = Extract<WorkerRequest, { type: 'compute' }>

/**
 * Who asked: the canvas (useGlyphGeometry), the live scheduler ahead of a frame's render (prefetch),
 * or an export (ensure).
 */
type Origin = 'canvas' | 'prefetch' | 'export'

interface InFlight {
  id: number
  key: string
  indices: Set<number>
  live: boolean
  origin: Origin
  sentAt: number
  request: ComputeRequest
}

export interface GeometryClientOptions {
  /** Starts a worker; throws where workers cannot start. */
  createWorker?: () => Worker
  /** Silence after which a busy worker counts as stuck (ms). */
  watchdogMs?: number
}

const startGeometryWorker = () => new Worker(new URL('../geometry/geometry.worker.ts', import.meta.url), { type: 'module' })

export class GeometryClient {
  private worker: Worker | null = null
  private readonly createWorker: () => Worker
  private readonly watchdogMs: number
  private font: LoadedFont | null = null
  private fontId: string | null = null
  private byKey = new Map<string, Map<number, GeometryEntry>>()
  private liveByKey = new Map<string, Map<number, GeometryEntry>>()
  /** The newest result per glyph that was computed or shown, used while the current one is computed. */
  private latest = new Map<number, GeometryEntry>()
  private inFlight: InFlight | null = null
  /** Recent requests by id: their settings, for blaming a glyph. */
  private requests = new Map<number, { key: string; live: boolean }>()
  private nextId = 1
  private listeners = new Set<() => void>()
  private idleListeners = new Set<() => void>()
  private version = 0
  /** The font and glyphs the canvas shows, for live frames asked for before they render (prefetch). */
  private shown: { font: LoadedFont; indices: readonly number[] } | null = null

  /** When the worker last sent anything (or started). */
  private lastHeard = 0
  /** The glyph the worker said it started, while nothing has been heard since. */
  private current: { requestId: number; index: number; at: number } | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  /** When the worker was last replaced for superseded settings (PREEMPT_GAP_MS). */
  private lastReplaced = -Infinity
  /** When the worker was restarted after a fault, within the last RESTART_WINDOW_MS. */
  private restarts: number[] = []
  /** The font was sent again after the worker said it did not have it (once per font). */
  private resentFont = false
  /** Why geometry stopped for good (until the next font), or null. */
  private stopped: string | null = null
  /** Why the worker cannot open a font. */
  private fontProblem: { fontId: string; message: string } | null = null

  constructor(options: GeometryClientOptions = {}) {
    this.createWorker = options.createWorker ?? startGeometryWorker
    this.watchdogMs = options.watchdogMs ?? WATCHDOG_MS
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

  /** True while a compute request is on its way in the worker (the live scheduler sends one at a time). */
  isComputing(): boolean {
    return this.inFlight !== null
  }

  /** Calls `listener` whenever the request in flight ends (answered, cancelled, or the worker restarted); returns the unsubscribe function. */
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
    this.ask(font, params, key, indices, live, 'canvas')
  }

  /** The font and glyphs the canvas shows (useGlyphGeometry), so prefetch knows what a frame needs. */
  show(font: LoadedFont | null, indices: readonly number[]) {
    this.shown = font ? { font, indices } : null
  }

  /**
   * Asks for a live frame's glyphs before React renders it: the live scheduler commits the frame once
   * they have arrived, so it renders once, complete. True while they are computed (idle listeners hear
   * when the request ends); false when there is nothing to wait for.
   */
  prefetch(params: GeometryParams, key: string): boolean {
    const shown = this.shown
    return shown !== null && this.ask(shown.font, params, key, shown.indices, true, 'prefetch')
  }

  /**
   * Polygons for an export: resolves once every one of these glyphs has a result under these settings,
   * asking the worker for those still missing (never computing on the page). Rejects when `signal` aborts.
   */
  ensure(font: LoadedFont, params: GeometryParams, key: string, indices: readonly number[], signal?: AbortSignal): Promise<PolygonLookup> {
    return new Promise((resolve, reject) => {
      const missing = () => indices.filter((i) => !this.entry(key, i))
      const check = () => {
        if (signal?.aborted) {
          end(() => reject(signal.reason))
          // Nobody wants these glyphs now: the worker stops on them (between glyphs).
          if (this.inFlight?.origin === 'export') this.cancel()
          return
        }
        if (this.inFlight === null && missing().length) this.ask(font, params, key, missing(), false, 'export')
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
    return this.byKey.get(key)?.get(index) ?? this.liveByKey.get(key)?.get(index)
  }

  /** Sends a request for the glyphs still missing; true when one is on its way (now or already). */
  private ask(font: LoadedFont, params: GeometryParams, key: string, indices: readonly number[], live: boolean, origin: Origin): boolean {
    this.useFont(font)
    // Settings that were a live frame (Freeze keeps one) become ordinary kept results.
    if (!live) this.promote(key)
    const missing: number[] = []
    for (const i of indices) {
      const entry = this.entry(key, i)
      // On the canvas, each glyph's shape under these settings is what is on screen now: it stands in
      // while later settings are computed (after Sound stops, the sliders' own shapes, not the last live frame).
      if (entry && origin === 'canvas') this.latest.set(i, entry)
      else if (!entry) missing.push(i)
    }
    if (!missing.length) {
      // The canvas has everything (e.g. back to recent settings): what it asked for before is no longer needed.
      if (origin === 'canvas' && this.inFlight?.origin === 'canvas') this.cancel()
      return false
    }
    const inFlight = this.inFlight
    if (inFlight?.key === key && missing.every((i) => inFlight.indices.has(i))) {
      // The canvas waits for it too, so its end must reach React.
      if (origin === 'canvas' && inFlight.origin === 'prefetch') inFlight.origin = 'canvas'
      return true
    }
    if (!live && this.stuckElsewhere(key, missing)) this.replaceWorker()
    this.startWorker()
    const problem = this.getProblem()
    if (problem) {
      // No page-side computing: the glyphs fail (canvas, preview and exports alike) and the canvas says why.
      for (const i of missing) this.store(key, i, { error: problem, transient: true }, live)
      if (origin !== 'prefetch') this.notify()
      return false
    }
    this.request(font, params, key, missing, live, origin)
    return true
  }

  private request(font: LoadedFont, params: GeometryParams, key: string, indices: number[], live: boolean, origin: Origin) {
    const id = this.nextId++
    const request: ComputeRequest = { type: 'compute', requestId: id, fontId: font.id, params, key, indices, ...(live ? { live } : {}) }
    this.inFlight = { id, key, indices: new Set(indices), live, origin, sentAt: performance.now(), request }
    this.requests.set(id, { key, live })
    while (this.requests.size > REMEMBERED_REQUESTS) this.requests.delete(this.requests.keys().next().value!)
    this.send(request)
    this.armWatchdog(this.watchdogMs)
  }

  /** Stops the request in flight (between glyphs, in the worker) and tells the idle listeners. */
  private cancel() {
    if (!this.inFlight) return
    this.send({ type: 'cancel', requestId: this.inFlight.id })
    this.inFlight = null
    this.idle()
  }

  /**
   * True when the worker has been in one glyph for PREEMPT_MS that these settings do not need (the
   * glyph of superseded settings): replacing the worker is quicker than waiting for it.
   */
  private stuckElsewhere(key: string, indices: number[]): boolean {
    const current = this.current
    const now = performance.now()
    if (!this.worker || !current || now - current.at < PREEMPT_MS || now - this.lastReplaced < PREEMPT_GAP_MS) return false
    const request = this.requests.get(current.requestId)
    return !(request && request.key === key && indices.includes(current.index))
  }

  private useFont(font: LoadedFont) {
    if (this.fontId === font.id) return
    const inFlight = this.inFlight
    if (inFlight) this.send({ type: 'cancel', requestId: inFlight.id })
    this.inFlight = null
    this.font = font
    this.fontId = font.id
    this.byKey.clear()
    this.liveByKey.clear()
    this.latest.clear()
    this.resentFont = false
    // A new font is a fresh start after geometry stopped.
    this.stopped = null
    this.restarts = []
    if (this.worker) this.sendFont()
    else this.startWorker()
    // After the request that asked for this font is on its way (an idle listener may ask for glyphs itself).
    if (inFlight) queueMicrotask(() => this.idle())
  }

  private sendFont() {
    const font = this.font
    if (font) this.send({ type: 'font', fontId: font.id, bytes: font.bytes, source: font.source })
  }

  /** Starts a worker if there is none (and sends it the font); null when geometry stopped or no worker can start. */
  private startWorker(): Worker | null {
    if (this.worker || this.stopped) return this.worker
    let worker: Worker
    try {
      worker = this.createWorker()
    } catch {
      this.stopped = CANNOT_START
      return null
    }
    // Messages a replaced worker sent before it was stopped are ignored.
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (this.worker === worker) this.receive(event.data)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      if (this.worker === worker) this.restart('kept failing')
    }
    worker.onmessageerror = () => {
      if (this.worker === worker) this.restart('kept failing')
    }
    this.worker = worker
    this.lastHeard = performance.now()
    this.sendFont()
    return worker
  }

  /** A new worker in place of one busy with a glyph nobody needs (not a fault: no restart is counted). */
  private replaceWorker() {
    this.lastReplaced = performance.now()
    this.worker?.terminate()
    this.worker = null
    this.current = null
    this.startWorker()
  }

  /**
   * After a fault: a new worker, unless there were too many lately. What was on its way is asked for
   * again by the next render (useGlyphGeometry's `version`), by the live scheduler, or by an export.
   */
  private restart(what: string) {
    this.worker?.terminate()
    this.worker = null
    this.inFlight = null
    this.current = null
    const now = performance.now()
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS)
    this.restarts.push(now)
    if (this.restarts.length > MAX_RESTARTS) this.stopped = `The geometry worker ${what}. Reload the page to try again.`
    else this.startWorker()
    this.notifyNow()
    this.idle()
  }

  /** One timer, re-armed lazily: when it fires, a request still in flight after watchdogMs of silence restarts the worker. */
  private armWatchdog(ms: number) {
    if (this.watchdog !== null) return
    this.watchdog = setTimeout(() => {
      this.watchdog = null
      const inFlight = this.inFlight
      if (!inFlight || !this.worker) return
      const silent = performance.now() - Math.max(this.lastHeard, inFlight.sentAt)
      if (silent < this.watchdogMs) return this.armWatchdog(this.watchdogMs - silent)
      // Blame the glyph the worker said it started, so asking again does not get stuck again.
      const current = this.current
      const blamed = current && this.requests.get(current.requestId)
      if (current && blamed) {
        this.store(blamed.key, current.index, { error: `Took longer than ${Math.round(this.watchdogMs / 1000)} s; try lighter settings` }, blamed.live)
      }
      this.restart('stopped responding')
    }, ms)
  }

  private send(message: WorkerRequest) {
    this.worker?.postMessage(message)
  }

  private receive(message: WorkerResponse) {
    const now = performance.now()
    this.lastHeard = now
    if (message.type === 'glyph') {
      this.current = { requestId: message.requestId, index: message.index, at: now }
      return
    }
    if (message.type !== 'font-error') this.current = null
    if (message.type === 'results') {
      if (message.fontId !== this.fontId) return
      for (const result of message.results) {
        const entry: GeometryEntry = 'error' in result ? { error: result.error } : { geometry: result.geometry }
        this.store(message.key, result.index, entry, message.live === true)
      }
      // Live results wait for their frame's 'done', so each live frame appears whole (SOUND_PLAN §2).
      if (!message.live) this.notifySoon()
    } else if (message.type === 'done') {
      const inFlight = this.inFlight
      if (inFlight?.id !== message.requestId) return
      this.inFlight = null
      // A live frame is complete: show it now, whole (its results were held back until now). A prefetched
      // frame is not shown yet: the live scheduler commits it when it hears it is idle.
      if (inFlight.live && inFlight.origin !== 'prefetch') this.notifyNow()
      this.idle()
    } else if (message.type === 'failed') {
      this.failed(message.requestId, message.reason, message.message)
    } else if (message.fontId === this.fontId) {
      this.fontProblem = { fontId: message.fontId, message: `The geometry worker could not open this font (${message.message}).` }
      this.notify()
    }
  }

  private failed(requestId: number, reason: Extract<WorkerResponse, { type: 'failed' }>['reason'], message: string) {
    const inFlight = this.inFlight
    if (inFlight?.id !== requestId) return
    if (reason === 'no-font' && !this.resentFont && this.font) {
      // The worker does not have the font (it was dropped, or never arrived): send it again and repeat the request, once.
      this.resentFont = true
      this.sendFont()
      this.request(this.font, inFlight.request.params, inFlight.key, [...inFlight.indices], inFlight.live, inFlight.origin)
      return
    }
    if (reason === 'font') {
      const problem = `The geometry worker could not open this font (${message}).`
      this.fontProblem = { fontId: inFlight.request.fontId, message: problem }
      this.inFlight = null
      for (const i of inFlight.indices) if (!this.entry(inFlight.key, i)) this.store(inFlight.key, i, { error: problem, transient: true }, inFlight.live)
      this.notifyNow()
      this.idle()
      return
    }
    this.restart('kept failing')
  }

  private store(key: string, index: number, entry: GeometryEntry, live = false) {
    const kept = live ? this.liveByKey : this.byKey
    let results = kept.get(key)
    if (!results) {
      results = new Map()
      kept.set(key, results)
      const max = live ? LIVE_KEPT_KEYS : KEPT_KEYS
      while (kept.size > max) kept.delete(kept.keys().next().value!)
    }
    results.set(index, entry)
    this.latest.set(index, entry)
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

export const geometryClient = new GeometryClient()

/**
 * Geometry for these glyphs under these settings, computed in the worker. Re-renders as results
 * arrive; until then `lookup` returns the glyph's previous shape (stale) or null. `live` marks
 * parameters Sound is driving (kept apart from the results of normal editing).
 */
export function useGlyphGeometry(font: LoadedFont | null, params: GeometryParams, key: string, indices: readonly number[], live = false) {
  const version = useSyncExternalStore(geometryClient.subscribe, geometryClient.getVersion)
  const indicesKey = indices.join(',')
  // Before any effect: the live scheduler may ask for the next frame's glyphs in one.
  useLayoutEffect(
    () => geometryClient.show(font, indices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [font, indicesKey],
  )
  useEffect(() => {
    if (font) geometryClient.compute(font, params, key, indices, live)
    // `key` stands for `params`, and `indicesKey` for `indices`; `version` asks again after the worker restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, key, indicesKey, version, live])
  return useMemo(() => ({ lookup: (index: number) => geometryClient.lookup(key, index), version }), [key, version])
}

/** Why glyphs cannot be computed now (the canvas shows it), or null. */
export function useGeometryProblem(): string | null {
  return useSyncExternalStore(geometryClient.subscribe, geometryClient.getProblem)
}
