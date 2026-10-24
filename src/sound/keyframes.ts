// Keyframes (NOCUR-91): while Glide is on, a large change of shape (an Experimental effect switched on or off, as
// Return to plain does on every beat, or an effect's strength moving far) passes through real in-between shapes on its
// way, instead of one morph from the old outline straight to the new. Each keyframe is a parameter set between the
// two frames: every effect's strength fields (KEYFRAME_FIELDS) part of the way from the old value to the new one, an
// effect switching on or off fading from or to nothing (its strength fields at 0) while it stays on, and every other
// value already the new one. The geometry pipeline computes them like any frame, so each keyframe is as faceted as the
// frames themselves, and Glide (specimen/glide.ts) morphs through them leg by leg, each leg along its effect's path.
// Pure: no React, no DOM.

import { paramsKey } from '../geometry/paramsKey'
import type { ExperimentalParams } from '../geometry/types'
import { targetById, type DrivenParams } from './mapping'

export const KEYFRAME_LIMITS = {
  /** In-between shapes per large change, evenly spaced from the old frame to the new (1/3 and 2/3 of the way). */
  count: 2,
  /** A strength field moving at least this share of its slider's travel makes a change large. */
  minShare: 0.25,
} as const

type Effect = Exclude<keyof ExperimentalParams, 'seed'>

/**
 * Each Experimental effect's strength fields: what fades in and out with it. At 0 each leaves the letter as the
 * pipeline gives it to the effect (Dissolve's ragged edge excepted: at 0 it still eats a little ink).
 */
export const KEYFRAME_FIELDS: Readonly<Record<Effect, readonly string[]>> = {
  crumple: ['amount'],
  ripple: ['amount', 'petals'],
  whorl: ['amount'],
  slipstream: ['strength', 'slip', 'cuts', 'trails'],
  thorn: ['canvasReach', 'refraction', 'dent'],
  dissolve: ['amount', 'spread', 'specks'],
}

const EFFECTS = Object.keys(KEYFRAME_FIELDS) as Effect[]

/** A keyframe: its parameter set and that set's geometry key (paramsKey). */
export interface Keyframe {
  params: DrivenParams
  key: string
}

const field = (params: DrivenParams, effect: Effect, name: string): number =>
  (params.experimental[effect] as unknown as Record<string, number>)[name] ?? 0

/** How far a strength field moves from `a` to `b`, as a share of its slider's travel. */
function share(effect: Effect, name: string, a: number, b: number): number {
  const spec = targetById(`experimental.${effect}.${name}`)
  return spec ? Math.abs(spec.toSlider(b) - spec.toSlider(a)) : 0
}

/** True when going from `from` to `to` is a large change (see the top of the file) that keyframes pass through. */
export function isLargeChange(from: DrivenParams, to: DrivenParams): boolean {
  for (const effect of EFFECTS) {
    const a = from.experimental[effect]
    const b = to.experimental[effect]
    if (a === b) continue
    if (a.enabled !== b.enabled) return true
    if (!a.enabled) continue
    for (const name of KEYFRAME_FIELDS[effect])
      if (share(effect, name, field(from, effect, name), field(to, effect, name)) >= KEYFRAME_LIMITS.minShare)
        return true
  }
  return false
}

/** The parameter set `mix` (0–1) of the way from `from` to `to` (see the top of the file). */
export function keyframeParams(from: DrivenParams, to: DrivenParams, mix: number): DrivenParams {
  let experimental = to.experimental
  for (const effect of EFFECTS) {
    const a = from.experimental[effect]
    const b = to.experimental[effect]
    if (!a.enabled && !b.enabled) continue
    // Switching on, it grows from nothing; switching off, it fades to nothing: on all the way, with b's other values.
    const on = b.enabled ? b : a
    const next: Record<string, unknown> = { ...on, enabled: true }
    for (const name of KEYFRAME_FIELDS[effect]) {
      const start = a.enabled ? field(from, effect, name) : 0
      const end = b.enabled ? field(to, effect, name) : 0
      next[name] = start + (end - start) * mix
    }
    experimental = { ...experimental, [effect]: next }
  }
  return experimental === to.experimental ? to : { ...to, experimental }
}

/**
 * The keyframes from `from` to `to` (KEYFRAME_LIMITS.count of them, in order), or null when the change is not a large
 * one. Each keyframe that turns out the same as the frame before it is left out.
 */
export function keyframesBetween(from: DrivenParams, to: DrivenParams): Keyframe[] | null {
  if (from === to || !isLargeChange(from, to)) return null
  const frames: Keyframe[] = []
  let lastKey = paramsKey(from)
  const toKey = paramsKey(to)
  for (let i = 1; i <= KEYFRAME_LIMITS.count; i++) {
    const params = keyframeParams(from, to, i / (KEYFRAME_LIMITS.count + 1))
    const key = paramsKey(params)
    if (key === lastKey || key === toKey) continue
    frames.push({ params, key })
    lastKey = key
  }
  return frames.length > 0 ? frames : null
}
