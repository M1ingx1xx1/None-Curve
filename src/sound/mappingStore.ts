// The Sound tab's mappings and the "Drive letters" switch: a small store outside React state, read
// with hooks. The mappings are saved between visits with the settings (state/persist.ts) and their
// changes can be undone (state/history.ts); Drive letters is neither.

import { useSyncExternalStore } from 'react'
import { undoHistory } from '../state/history'
import type { FeatureId, Mapping } from './mapping'

export const MAPPING_LIMITS = {
  /** Mappings the Sound tab holds at most. */
  maxMappings: 8,
} as const

export interface MappingState {
  mappings: readonly Mapping[]
  /** Sound drives the letters only while this is on (and a source is playing or listening). */
  drive: boolean
  /**
   * The system asks for reduced motion: Drive letters starts off (and switches off if the setting is
   * turned on during the visit), and the tab says why.
   */
  reducedMotion: boolean
}

function reducedMotionQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
  } catch {
    return null
  }
}

class MappingStore {
  private state: MappingState
  private listeners = new Set<() => void>()
  private nextId = 1

  constructor() {
    const query = reducedMotionQuery()
    const reducedMotion = query?.matches ?? false
    this.state = { mappings: [], drive: !reducedMotion, reducedMotion }
    // Follow the system setting while the page is open (as ThemeToggle does): turning reduced motion on
    // switches Drive letters off and shows the note; turning it off leaves Drive letters as it is.
    query?.addEventListener?.('change', (e) => {
      this.set(e.matches ? { reducedMotion: true, drive: false } : { reducedMotion: false })
    })
  }

  getState = (): MappingState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Adds a mapping (ignored at the limit); returns its id, or null. */
  add(feature: FeatureId, target: string, depth = 0.5): string | null {
    if (this.state.mappings.length >= MAPPING_LIMITS.maxMappings) return null
    const id = `m${this.nextId++}`
    undoHistory.record(null)
    this.set({ mappings: [...this.state.mappings, { id, enabled: true, feature, target, depth: clampDepth(depth) }] })
    return id
  }

  update(id: string, patch: Partial<Omit<Mapping, 'id'>>) {
    const current = this.state.mappings.find((m) => m.id === id)
    if (!current) return
    const next = { ...current, ...patch, ...(patch.depth !== undefined ? { depth: clampDepth(patch.depth) } : {}) }
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((key) => next[key] !== current[key])
    if (changed.length === 0) return
    // One undo step per Depth drag: changes to the same fields of the same row join.
    undoHistory.record(`mapping:${id}:${changed.sort().join(',')}`)
    this.set({ mappings: this.state.mappings.map((m) => (m.id === id ? next : m)) })
  }

  remove(id: string) {
    if (!this.state.mappings.some((m) => m.id === id)) return
    undoHistory.record(null)
    this.set({ mappings: this.state.mappings.filter((m) => m.id !== id) })
  }

  /** Replaces every mapping (a preset's). */
  replace(mappings: readonly Omit<Mapping, 'id'>[]) {
    undoHistory.record(null)
    this.set({
      mappings: mappings.slice(0, MAPPING_LIMITS.maxMappings).map((m) => ({ ...m, id: `m${this.nextId++}`, depth: clampDepth(m.depth) })),
    })
  }

  /**
   * Puts back mappings as they were (undo and redo, or a saved session), ids included; later rows get
   * ids past the largest. Not recorded for undo.
   */
  restore(mappings: readonly Mapping[]) {
    for (const { id } of mappings) {
      const n = /^m(\d+)$/.exec(id)
      if (n) this.nextId = Math.max(this.nextId, Number(n[1]) + 1)
    }
    this.set({ mappings: mappings.slice(0, MAPPING_LIMITS.maxMappings) })
  }

  setDrive(drive: boolean) {
    this.set({ drive })
  }

  private set(patch: Partial<MappingState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}

export function clampDepth(depth: number): number {
  return Number.isFinite(depth) ? Math.min(1, Math.max(-1, depth)) : 0
}

export const mappingStore = new MappingStore()

/** The mappings and the Drive letters switch; re-renders when they change. */
export function useMappingState(): MappingState {
  return useSyncExternalStore(mappingStore.subscribe, mappingStore.getState)
}
