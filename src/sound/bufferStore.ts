// What precomputed playback has prepared of the file in the Sound tab (NOCUR-85), for the buffered bar under the
// Position slider: the parameter plan, contiguous from the start, and the media time ranges whose geometry is ready.
// The director (director.ts) offers a snapshot as often as it likes; the store publishes at most every
// PRECOMPUTE_LIMITS.bufferEveryMs, and only when something moved by about a pixel of the slider (QUANTUM of the
// file's length), except when told it must (a new plan, file or font: the bar drops back at once). Read it with
// useSyncExternalStore(bufferStore.subscribe, bufferStore.get).

import { PRECOMPUTE_LIMITS } from './timelineTypes'

export interface BufferSnapshot {
  /** The file's length (ms); 0: no precomputed file (no bar). */
  durationMs: number
  /** The plan is ready on [0, plannedMs]. */
  plannedMs: number
  /** Geometry ready: [startMs, endMs, …], merged, in order. */
  ready: Float32Array
  /** Bumps with every published snapshot. */
  version: number
}

/** Changes smaller than this share of the file's length are not published (about a pixel of the slider). */
export const QUANTUM = 0.0025

export const EMPTY_BUFFER: BufferSnapshot = { durationMs: 0, plannedMs: 0, ready: new Float32Array(0), version: 0 }

export interface BufferStore {
  get(): BufferSnapshot
  subscribe(listener: () => void): () => void
  /**
   * Offers a snapshot at page time `now`: published when `force` is set, or when bufferEveryMs passed since the last
   * one and it differs from it once quantised. True when published.
   */
  offer(next: Omit<BufferSnapshot, 'version'>, now: number, force?: boolean): boolean
}

/** The quantised form two snapshots are compared by. */
function signature(s: Omit<BufferSnapshot, 'version'>): string {
  const step = s.durationMs * QUANTUM
  const q = (ms: number) => (step > 0 ? Math.round(ms / step) : 0)
  let out = `${Math.round(s.durationMs)}|${q(s.plannedMs)}`
  for (const ms of s.ready) out += `,${q(ms)}`
  return out
}

export function createBufferStore(): BufferStore {
  let current = EMPTY_BUFFER
  let currentSignature = signature(current)
  let publishedAt = -Infinity
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    offer(next, now, force = false) {
      if (!force && now - publishedAt < PRECOMPUTE_LIMITS.bufferEveryMs) return false
      const nextSignature = signature(next)
      if (nextSignature === currentSignature) return false
      current = { ...next, version: current.version + 1 }
      currentSignature = nextSignature
      publishedAt = now
      for (const listener of listeners) listener()
      return true
    },
  }
}

export const bufferStore: BufferStore = createBufferStore()
