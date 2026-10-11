// The page's side of the geometry worker: sends it the font and the glyphs to compute, keeps the
// results, and tells React when new ones arrive. Without worker support (or if the worker cannot
// open the font) glyphs are computed here instead, as before. Live frames (parameters Sound is
// driving) keep their results apart, so a song does not push out the results of normal editing, and
// reach React only when complete, so each live frame appears whole (SOUND_PLAN §2).

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { LoadedFont } from '../font/model'
import { glyphGeometry } from '../geometry/cache'
import type { WorkerGeometry, WorkerRequest, WorkerResponse } from '../geometry/protocol'
import type { GeometryParams } from '../geometry/types'
import type { PolygonLookup } from '../specimen/scene'

export type GeometryEntry = { geometry: WorkerGeometry } | { error: string }

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

class GeometryClient {
  private worker: Worker | null = null
  private workerFailed = false
  private fontId: string | null = null
  private byKey = new Map<string, Map<number, GeometryEntry>>()
  private liveByKey = new Map<string, Map<number, GeometryEntry>>()
  /** The newest result per glyph that was computed or shown, used while the current one is computed. */
  private latest = new Map<number, GeometryEntry>()
  private inFlight: { id: number; key: string; indices: Set<number>; live: boolean } | null = null
  private nextId = 1
  private listeners = new Set<() => void>()
  private idleListeners = new Set<() => void>()
  private version = 0

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = () => this.version

  /** True while a compute request is on its way in the worker (the live scheduler sends one at a time). */
  isComputing(): boolean {
    return this.inFlight !== null
  }

  /** Calls `listener` whenever the request in flight finishes (or the worker is given up); returns the unsubscribe function. */
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
    const current = this.byKey.get(key)?.get(index) ?? this.liveByKey.get(key)?.get(index)
    if (current) return { entry: current, stale: false }
    const earlier = this.latest.get(index)
    return earlier ? { entry: earlier, stale: true } : null
  }

  /**
   * Asks for these glyphs (most important first). Known glyphs and glyphs on their way are skipped.
   * `live` marks parameters Sound is driving: their results are kept apart (LIVE_KEPT_KEYS).
   */
  compute(font: LoadedFont, params: GeometryParams, key: string, indices: readonly number[], live = false) {
    this.useFont(font)
    // Settings that were a live frame (Freeze keeps one) become ordinary kept results.
    if (!live) this.promote(key)
    const known = this.byKey.get(key)
    const knownLive = this.liveByKey.get(key)
    // Each glyph's shape under these settings is what is on screen now: it stands in while later
    // settings are computed (after Sound stops, the sliders' own shapes, not the last live frame).
    const missing: number[] = []
    for (const i of indices) {
      const entry = known?.get(i) ?? knownLive?.get(i)
      if (entry) this.latest.set(i, entry)
      else missing.push(i)
    }
    if (!missing.length) return
    if (this.inFlight?.key === key && missing.every((i) => this.inFlight!.indices.has(i))) return

    const worker = this.startWorker()
    if (!worker) {
      for (const index of missing) this.store(key, index, computeHere(font, index, params, key, live), live)
      this.notify()
      return
    }
    const id = this.nextId++
    this.inFlight = { id, key, indices: new Set(missing), live }
    this.send({ type: 'compute', requestId: id, fontId: font.id, params, key, indices: missing, ...(live ? { live } : {}) })
  }

  private useFont(font: LoadedFont) {
    if (this.fontId === font.id) return
    this.fontId = font.id
    this.byKey.clear()
    this.liveByKey.clear()
    this.latest.clear()
    this.inFlight = null
    if (this.startWorker()) this.send({ type: 'font', fontId: font.id, bytes: font.bytes, source: font.source })
  }

  private startWorker(): Worker | null {
    if (this.worker || this.workerFailed) return this.worker
    try {
      this.worker = new Worker(new URL('../geometry/geometry.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data)
      this.worker.onerror = () => this.giveUpWorker()
    } catch {
      this.workerFailed = true
    }
    return this.worker
  }

  /** From now on compute on the page; whatever was on its way is asked for again by the next render. */
  private giveUpWorker() {
    this.workerFailed = true
    this.worker?.terminate()
    this.worker = null
    this.inFlight = null
    this.notify()
    this.idle()
  }

  private send(message: WorkerRequest) {
    this.worker?.postMessage(message)
  }

  private receive(message: WorkerResponse) {
    if (message.type === 'results') {
      if (message.fontId !== this.fontId) return
      for (const result of message.results) {
        const entry: GeometryEntry = 'error' in result ? { error: result.error } : { geometry: result.geometry }
        this.store(message.key, result.index, entry, message.live === true)
      }
      // Live results wait for their frame's 'done', so each live frame appears whole (SOUND_PLAN §2).
      if (!message.live) this.notifySoon()
    } else if (message.type === 'done') {
      if (this.inFlight?.id !== message.requestId) return
      const { live } = this.inFlight
      this.inFlight = null
      // A live frame is complete: show it now, whole (its results were held back until now).
      if (live) this.notifyNow()
      this.idle()
    } else if (message.fontId === this.fontId) {
      this.giveUpWorker()
    }
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

function computeHere(font: LoadedFont, index: number, params: GeometryParams, key: string, live = false): GeometryEntry {
  try {
    const { source: _source, ...geometry } = glyphGeometry(font, index, params, key, live)
    return { geometry }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
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
  useEffect(() => {
    if (font) geometryClient.compute(font, params, key, indices, live)
    // `key` stands for `params`, and `indicesKey` for `indices`; `version` re-asks after the worker fails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, key, indicesKey, version, live])
  return useMemo(() => ({ lookup: (index: number) => geometryClient.lookup(key, index), version }), [key, version])
}

/**
 * Polygons for export: the worker's results for these settings where there are some, computed here
 * for the rest (export needs every glyph now, not later).
 */
export function exportPolygonLookup(font: LoadedFont, params: GeometryParams, key: string): PolygonLookup {
  return (index) => {
    const found = geometryClient.holds(font.id) ? geometryClient.lookup(key, index) : null
    const entry = found && !found.stale ? found.entry : computeHere(font, index, params, key)
    return 'error' in entry ? { error: entry.error } : { polygon: entry.geometry.polygon }
  }
}
