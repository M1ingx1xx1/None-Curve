// Reset experimental (the Experimental tab's button): every effect off, every switch off, and every slider at its
// lowest, or at 0 where its range reaches below 0 (Whorl's Amount), so the tab starts from nothing. Three sliders keep
// their starting value instead (KEPT_AT_DEFAULT): Ripple's Center X/Y, a position whose neutral is the middle, and
// Dissolve's Grain, whose lowest is the finest and slowest setting. The seed is kept, so a variant the user liked is not lost. Derived from the default settings' fields and the
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

const TEMPLATE = initialState.params.experimental

/**
 * Sliders Reset experimental leaves at their starting value, by Sound target id: Ripple's centre stays in the middle
 * of the letter (0 would move it to a corner), and Dissolve's Grain stays out of its finest, most expensive setting.
 */
const KEPT_AT_DEFAULT: ReadonlySet<string> = new Set(['experimental.ripple.centerX', 'experimental.ripple.centerY', 'experimental.dissolve.grain'])

/** The starting value of this Experimental slider, from the default settings. */
function defaultSliderValue(id: string): number {
  const [, effect, key] = id.split('.')
  return (TEMPLATE[effect as Effect] as unknown as Record<string, number>)[key]
}

/**
 * What Reset experimental sets this slider to: its starting value for the few in KEPT_AT_DEFAULT, else 0 when its
 * range holds 0, else the end nearest 0 (its minimum).
 */
export function clearedSliderValue(id: string): number {
  if (KEPT_AT_DEFAULT.has(id)) return defaultSliderValue(id)
  if (Object.hasOwn(CURVED_LOWEST, id)) return CURVED_LOWEST[id]
  const { min, max } = sliderRange(id)
  return Math.min(max, Math.max(min, 0))
}
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
