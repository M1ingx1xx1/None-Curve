// The Sound tab's mappings, the Response group's response values (Strength, Motion contrast, Pitch
// reactive, Melody tracking, Glide) and the "Drive letters" switch: a small store outside React state, read
// with hooks. The mappings and the response are saved between visits with the settings
// (state/persist.ts) and their changes can be undone (state/history.ts); Drive letters is neither.

import { useSyncExternalStore } from 'react'
import { undoHistory } from '../state/history'
import { clampShaping, shapingOf, targetById, type FeatureId, type Mapping, type Shaping } from './mapping'
import { clampResponse, DEFAULT_RESPONSE, type ResponseSettings } from './types'

export const MAPPING_LIMITS = {
  /** Mappings the Sound tab holds at most. */
  maxMappings: 8,
} as const

export interface MappingState {
  mappings: readonly Mapping[]
  /** How the letters answer the sound over every mapping; presets leave it alone, Reset sound sets it back. */
  response: ResponseSettings
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
    this.state = { mappings: [], response: DEFAULT_RESPONSE, drive: !reducedMotion, reducedMotion }
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

  /**
   * Maps `feature` to `target`, as a drop on a control does (drag to map): a new row, on, at `depth` (+50% by default)
   * and in Toggle on a switch (a checkbox has no Follow), one undo step. A row that maps the same feature to the same
   * target already is not doubled: its id comes back with `created` false, and if it was off it is switched on
   * (`switchedOn`, one undo step; a row that was on records none). Null at the limit.
   */
  connect(
    feature: FeatureId,
    target: string,
    depth = 0.5,
  ): { id: string; created: boolean; switchedOn: boolean } | null {
    const existing = this.state.mappings.find((m) => m.feature === feature && m.target === target)
    if (existing) {
      if (!existing.enabled) {
        // A step of its own: it never joins an open step that switched the row off.
        undoHistory.record(null)
        this.set({ mappings: this.state.mappings.map((m) => (m.id === existing.id ? { ...m, enabled: true } : m)) })
      }
      return { id: existing.id, created: false, switchedOn: !existing.enabled }
    }
    if (this.state.mappings.length >= MAPPING_LIMITS.maxMappings) return null
    const id = `m${this.nextId++}`
    const mode: Partial<Shaping> = targetById(target)?.kind === 'switch' ? { mode: 'toggle' } : {}
    undoHistory.record(null)
    this.set({
      mappings: [...this.state.mappings, { id, enabled: true, feature, target, depth: clampDepth(depth), ...mode }],
    })
    return { id, created: true, switchedOn: false }
  }

  /** Changes a mapping; Depth and the shaping fields are clamped to their limits (clampDepth, clampShaping). */
  update(id: string, patch: Partial<Omit<Mapping, 'id'>>) {
    const current = this.state.mappings.find((m) => m.id === id)
    if (!current) return
    const next = { ...current, ...patch, ...(patch.depth !== undefined ? { depth: clampDepth(patch.depth) } : {}) }
    if (SHAPING_KEYS.some((key) => patch[key] !== undefined)) {
      const shaping = clampShaping(patch, shapingOf(current))
      // Only the fields the patch names; the others stay as they are (or missing).
      for (const key of SHAPING_KEYS) if (patch[key] !== undefined) Object.assign(next, { [key]: shaping[key] })
    }
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
      mappings: mappings
        .slice(0, MAPPING_LIMITS.maxMappings)
        .map((m) => ({ ...m, id: `m${this.nextId++}`, depth: clampDepth(m.depth), ...clampedShaping(m) })),
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

  /**
   * Changes response values, clamped to RESPONSE_LIMITS and snapped to their steps. One undo step per field drag:
   * changes to the same fields join (keys "sound:strength" and so on, as the Sensitivity and Release sliders').
   */
  setResponse(patch: Partial<ResponseSettings>) {
    const current = this.state.response
    const next = clampResponse(patch, current)
    const changed = (Object.keys(next) as (keyof ResponseSettings)[]).filter((key) => next[key] !== current[key])
    if (changed.length === 0) return
    undoHistory.record(`sound:${changed.sort().join(',')}`)
    this.set({ response: next })
  }

  /**
   * Puts back response values as they were (undo and redo, or a saved session). Not recorded for undo. A value left out
   * (Glide, in sessions saved before it existed) is its default.
   */
  restoreResponse(response: Partial<ResponseSettings>) {
    const next = clampResponse(response, DEFAULT_RESPONSE)
    const current = this.state.response
    if ((Object.keys(next) as (keyof ResponseSettings)[]).every((key) => next[key] === current[key])) return
    this.set({ response: next })
  }

  setDrive(drive: boolean) {
    this.set({ drive })
  }

  private set(patch: Partial<MappingState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}

/** The shaping fields of a Mapping. */
const SHAPING_KEYS: readonly (keyof Shaping)[] = ['rangeMin', 'rangeMax', 'curve', 'smoothMs', 'gate', 'mode']

/** The shaping fields a mapping sets, clamped (clampShaping); the ones it leaves out stay out. */
function clampedShaping(mapping: Partial<Shaping>): Partial<Shaping> {
  const set = SHAPING_KEYS.filter((key) => mapping[key] !== undefined)
  if (set.length === 0) return {}
  const shaping = clampShaping(mapping)
  return Object.fromEntries(set.map((key) => [key, shaping[key]]))
}

export function clampDepth(depth: number): number {
  return Number.isFinite(depth) ? Math.min(1, Math.max(-1, depth)) : 0
}

export const mappingStore = new MappingStore()

/** The mappings and the Drive letters switch; re-renders when they change. */
export function useMappingState(): MappingState {
  return useSyncExternalStore(mappingStore.subscribe, mappingStore.getState)
}
