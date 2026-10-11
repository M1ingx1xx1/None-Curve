// The Sound tab's mappings and the "Drive letters" switch: a small store outside React state, read
// with hooks. Not saved: like the sliders, mappings last for the visit.

import { useSyncExternalStore } from 'react'
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
    this.set({ mappings: [...this.state.mappings, { id, enabled: true, feature, target, depth: clampDepth(depth) }] })
    return id
  }

  update(id: string, patch: Partial<Omit<Mapping, 'id'>>) {
    const mappings = this.state.mappings.map((m) =>
      m.id === id ? { ...m, ...patch, ...(patch.depth !== undefined ? { depth: clampDepth(patch.depth) } : {}) } : m,
    )
    this.set({ mappings })
  }

  remove(id: string) {
    this.set({ mappings: this.state.mappings.filter((m) => m.id !== id) })
  }

  /** Replaces every mapping (for presets, phase 3). */
  replace(mappings: readonly Omit<Mapping, 'id'>[]) {
    this.set({
      mappings: mappings.slice(0, MAPPING_LIMITS.maxMappings).map((m) => ({ ...m, id: `m${this.nextId++}`, depth: clampDepth(m.depth) })),
    })
  }

  setDrive(drive: boolean) {
    this.set({ drive })
  }

  private set(patch: Partial<MappingState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function clampDepth(depth: number): number {
  return Number.isFinite(depth) ? Math.min(1, Math.max(-1, depth)) : 0
}

export const mappingStore = new MappingStore()

/** The mappings and the Drive letters switch; re-renders when they change. */
export function useMappingState(): MappingState {
  return useSyncExternalStore(mappingStore.subscribe, mappingStore.getState)
}
