// Reset experimental (the Experimental tab's button): every effect off, every switch off, and every slider at its
// lowest, or at 0 where its range reaches below 0 (Whorl's Amount, Ripple's Center), so the tab starts from nothing.
// The seed is kept, so a variant the user liked is not lost. Derived from the default settings' fields and the
// sliders' ranges (sliderScales.ts), so a new effect or slider is cleared too, and sliderRange throws for a number
// with no slider rather than leaving it out. Pure: no React, no DOM.

import type { ExperimentalParams } from '../geometry/types'
import { initialState } from './editorState'
import { reachFromSlider, sliderRange, THORN_REACH } from './sliderScales'

type Effect = Exclude<keyof ExperimentalParams, 'seed'>

/** The curved sliders' lowest values, by Sound target id: they have no linear range in SLIDER_RANGES. */
const CURVED_LOWEST: Readonly<Record<string, number>> = {
  'experimental.thorn.canvasReach': reachFromSlider(THORN_REACH.slider.min),
}

/** What Reset experimental sets this slider to: 0 when its range holds 0, else the end nearest 0 (its minimum). */
export function clearedSliderValue(id: string): number {
  if (Object.hasOwn(CURVED_LOWEST, id)) return CURVED_LOWEST[id]
  const { min, max } = sliderRange(id)
  return Math.min(max, Math.max(min, 0))
}

const TEMPLATE = initialState.params.experimental
const EFFECTS = (Object.keys(TEMPLATE) as (keyof ExperimentalParams)[]).filter((key): key is Effect => key !== 'seed')

const CLEARED: Omit<ExperimentalParams, 'seed'> = Object.fromEntries(
  EFFECTS.map((effect) => [
    effect,
    Object.fromEntries(
      Object.entries(TEMPLATE[effect]).map(([key, value]) => [key, typeof value === 'boolean' ? false : clearedSliderValue(`experimental.${effect}.${key}`)]),
    ),
  ]),
) as unknown as Omit<ExperimentalParams, 'seed'>

/** The Experimental settings Reset experimental gives: everything off and at its lowest, with this seed. */
export function clearedExperimental(seed: number): ExperimentalParams {
  return { seed, ...structuredClone(CLEARED) }
}

/** Whether Reset experimental would change nothing: every effect, switch and slider already cleared (any seed). */
export function isClearedExperimental(params: ExperimentalParams): boolean {
  return EFFECTS.every((effect) => {
    const current = params[effect] as unknown as Record<string, unknown> | undefined
    return !!current && Object.entries(CLEARED[effect]).every(([key, value]) => current[key] === value)
  })
}
