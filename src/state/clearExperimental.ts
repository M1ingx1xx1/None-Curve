// Reset experimental (the Experimental tab's button): every effect off, every switch off, and every slider at 0, so the
// tab starts from nothing. Angles (Crumple's Turn, Slipstream's Direction) and Whorl's signed Amount sit at 0 too; a
// slider whose range starts above 0 (Ripple's and Whorl's Sides, Whorl's Rings, Dissolve's Grain: none of them has a
// "nothing" at 0) goes to its minimum. Ripple's Center X/Y, a position whose neutral is the middle, go to the middle
// (CENTRED). The seed is kept, so a variant the user liked is not lost. Derived from the default settings' fields and
// the sliders' ranges (sliderScales.ts), so a new effect or slider is cleared too, and sliderRange throws for a number
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
 * Sliders Reset experimental puts in the middle, by Sound target id: Ripple's centre, a share of the letter's ink box
 * (0 would move it to a corner).
 */
const CENTRED: ReadonlySet<string> = new Set(['experimental.ripple.centerX', 'experimental.ripple.centerY'])

/** What Reset experimental sets this slider to: the middle for those in CENTRED, else 0 when its range holds 0, else the end nearest 0 (its minimum). */
export function clearedSliderValue(id: string): number {
  if (CENTRED.has(id)) return 0.5
  if (Object.hasOwn(CURVED_LOWEST, id)) return CURVED_LOWEST[id]
  const { min, max } = sliderRange(id)
  return Math.min(max, Math.max(min, 0))
}
const EFFECTS = (Object.keys(TEMPLATE) as (keyof ExperimentalParams)[]).filter((key): key is Effect => key !== 'seed')

const CLEARED: Omit<ExperimentalParams, 'seed'> = Object.fromEntries(
  EFFECTS.map((effect) => [
    effect,
    Object.fromEntries(
      Object.entries(TEMPLATE[effect]).map(([key, value]) => [
        key,
        typeof value === 'boolean' ? false : clearedSliderValue(`experimental.${effect}.${key}`),
      ]),
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
