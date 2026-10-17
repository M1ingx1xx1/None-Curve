// The sliders' ranges, in one place: the panels build their range inputs from these, and Sound
// (src/sound/mapping.ts) drives the same sliders through them, so a live value is always one the slider itself
// can produce and the two cannot drift apart. Keyed by each slider's Sound target id ("group.key",
// "experimental.effect.key"). Pure: no React, no DOM.

import { CRUMPLE_LIMITS } from '../geometry/crumple'
import { DISTORTION_LIMITS } from '../geometry/distortion'
import { RANDOM_ANCHOR_LIMITS } from '../geometry/randomAnchors'
import { RIPPLE_LIMITS } from '../geometry/ripple'
import { SLIPSTREAM_LIMITS } from '../geometry/slipstream'
import { THORN_LIMITS } from '../geometry/thorn'
import { WHORL_LIMITS } from '../geometry/whorl'

export interface SliderRange {
  readonly min: number
  readonly max: number
  readonly step: number
}

const range = (min: number, max: number, step: number): SliderRange => ({ min, max, step })

/**
 * Curve flattening's Tolerance slider is logarithmic: 0.1 to 500 font units on a 0–100 range input in steps
 * of 0.5, rounded by roundTolerance. The top of the range only matters with Merge joined curves, where a
 * whole bowl can become a single edge.
 */
export const TOLERANCE = {
  /** Smallest and largest tolerance (font units). */
  min: 0.1,
  max: 500,
  /** roundTolerance's finest unit: the step of its number box. */
  step: 0.01,
  /** The range input itself. */
  slider: range(0, 100, 0.5),
} as const

/** Rounds a tolerance to what the panel shows: hundredths below 1, tenths below 10, whole units above. */
export function roundTolerance(tol: number): number {
  if (tol < 1) return Math.round(tol * 100) / 100
  if (tol < 10) return Math.round(tol * 10) / 10
  return Math.round(tol)
}

/** Where a tolerance sits on the Tolerance range input (0–100). */
export const toleranceToSlider = (tol: number) => (TOLERANCE.slider.max * Math.log(tol / TOLERANCE.min)) / Math.log(TOLERANCE.max / TOLERANCE.min)

/** The tolerance at a position of the Tolerance range input (0–100), rounded by roundTolerance. */
export const toleranceFromSlider = (pos: number) =>
  roundTolerance(TOLERANCE.min * Math.pow(TOLERANCE.max / TOLERANCE.min, pos / TOLERANCE.slider.max))

/**
 * Thorn's Reach slider is cubic: the reach (a share of the canvas diagonal, 0–1) is the cube of the range
 * input's position (0–1 in steps of 0.005), rounded by roundReach. Short thorns keep fine steps, and the
 * top still flings an anchor across the whole canvas. Near 0, where the cube grows by less than roundReach's
 * unit per step, each step adds that unit instead (up to 0.28%), so every step is a reach of its own and the
 * arrow keys always move the slider.
 */
export const THORN_REACH = {
  /** Largest reach: the whole canvas diagonal. */
  max: 1,
  /** roundReach's unit: the step of its number box. */
  step: 0.0001,
  /** The range input itself. */
  slider: range(0, 1, 0.005),
} as const

/** Rounds a reach to 4 decimals (a hundredth of a percent of the canvas). */
export const roundReach = (reach: number) => Math.round(reach * 10_000) / 10_000

/** A positive number as the Reach readouts show it: hundredths below 1 (never 0.00), one decimal below 10, whole above. */
export function reachReadout(v: number): string {
  const hundredths = Math.max(Math.round(v * 100), 1) / 100
  if (hundredths < 1) return hundredths.toFixed(2)
  const tenths = Math.round(v * 10) / 10
  return tenths < 10 ? tenths.toFixed(1) : String(Math.round(v))
}

/** A reach as the panel and the status line show it, in percent of the canvas; 0.0 only while it is off. */
export const reachPercent = (reach: number) => (reach > 0 ? reachReadout(reach * 100) : '0.0')

/** Where a reach sits on the Reach range input (0–1). */
export const reachToSlider = (reach: number) => Math.min(Math.cbrt(reach / THORN_REACH.max), reach * 10_000 * THORN_REACH.slider.step)

/** The reach at a position of the Reach range input (0–1), rounded by roundReach: the cube, or a hundredth of a percent per step near 0. */
export const reachFromSlider = (pos: number) => roundReach(Math.max(THORN_REACH.max * pos ** 3, pos / THORN_REACH.slider.step / 10_000))

/**
 * Every linear slider Sound can drive, Geometry tab then Experimental tab, in panel order. Steps are fine (NOCUR-63):
 * 1% for shares, 1% of the em for sizes, 1° for angles (whose range stops at 359°, a step short of a full turn),
 * whole font units, and whole counts; each slider's number box takes exact values on the same step.
 */
export const SLIDER_RANGES = {
  // Geometry tab (Tolerance is the logarithmic TOLERANCE above).
  'flatten.segmentsPerCurve': range(1, 32, 1),
  'flatten.cornerAngle': range(1, 90, 1),
  'squaring.amount': range(0, 1, 0.01),
  'anchors.spacing': range(0, 200, 1),
  'anchors.simplify': range(0, 100, 0.1),
  'grid.size': range(0, 200, 1),
  'distortion.amount': range(0, DISTORTION_LIMITS.maxAmount, 1),
  'distortion.frequency': range(DISTORTION_LIMITS.minFrequency, DISTORTION_LIMITS.maxFrequency, 0.1),
  'distortion.normalBias': range(0, 1, 0.01),
  'random.density': range(RANDOM_ANCHOR_LIMITS.minDensity, RANDOM_ANCHOR_LIMITS.maxDensity, 1),
  'random.randomness': range(0, 1, 0.01),

  // Experimental tab (Thorn's Reach is the cubic THORN_REACH above).
  'experimental.crumple.amount': range(0, CRUMPLE_LIMITS.maxAmount, 0.01),
  'experimental.crumple.facet': range(CRUMPLE_LIMITS.minFacet, CRUMPLE_LIMITS.maxFacet, 0.01),
  'experimental.crumple.turn': range(0, 359, 1),
  'experimental.ripple.amount': range(0, RIPPLE_LIMITS.maxAmount, 0.01),
  'experimental.ripple.wavelength': range(RIPPLE_LIMITS.minWavelength, RIPPLE_LIMITS.maxWavelength, 0.01),
  'experimental.ripple.sides': range(RIPPLE_LIMITS.minSides, RIPPLE_LIMITS.maxSides, 1),
  'experimental.ripple.centerX': range(RIPPLE_LIMITS.minCenter, RIPPLE_LIMITS.maxCenter, 0.01),
  'experimental.ripple.centerY': range(RIPPLE_LIMITS.minCenter, RIPPLE_LIMITS.maxCenter, 0.01),
  'experimental.ripple.fade': range(0, 1, 0.01),
  'experimental.ripple.petals': range(0, RIPPLE_LIMITS.maxPetals, 0.01),
  'experimental.whorl.amount': range(-WHORL_LIMITS.maxAmount, WHORL_LIMITS.maxAmount, 0.01),
  'experimental.whorl.rings': range(WHORL_LIMITS.minRings, WHORL_LIMITS.maxRings, 1),
  'experimental.whorl.sides': range(WHORL_LIMITS.minSides, WHORL_LIMITS.maxSides, 1),
  'experimental.slipstream.direction': range(0, 359, 1),
  'experimental.slipstream.strength': range(0, SLIPSTREAM_LIMITS.maxStrength, 0.01),
  'experimental.slipstream.slip': range(0, SLIPSTREAM_LIMITS.maxSlip, 0.01),
  'experimental.slipstream.gust': range(SLIPSTREAM_LIMITS.minGust, SLIPSTREAM_LIMITS.maxGust, 0.01),
  'experimental.slipstream.gustiness': range(0, SLIPSTREAM_LIMITS.maxGustiness, 0.01),
  'experimental.slipstream.cuts': range(0, SLIPSTREAM_LIMITS.maxCuts, 1),
  'experimental.slipstream.trails': range(0, SLIPSTREAM_LIMITS.maxTrails, 1),
  'experimental.thorn.count': range(THORN_LIMITS.minCount, THORN_LIMITS.maxCount, 1),
  'experimental.thorn.root': range(0, 1, 0.01),
  'experimental.thorn.spread': range(0, 1, 0.01),
  'experimental.thorn.width': range(0, 1, 0.01),
  'experimental.thorn.refraction': range(0, 1, 0.01),
  'experimental.thorn.flute': range(THORN_LIMITS.minFlute, THORN_LIMITS.maxFlute, 0.01),
  'experimental.thorn.spikes': range(THORN_LIMITS.minSpikes, THORN_LIMITS.maxSpikes, 1),
  'experimental.thorn.dent': range(0, 1, 0.01),
} as const satisfies Record<string, SliderRange>

/** A linear slider's Sound target id. */
export type SliderId = keyof typeof SLIDER_RANGES

/** The range of the slider with this target id; throws for an id that is not a linear slider (a typo, Tolerance, or Reach). */
export function sliderRange(id: string): SliderRange {
  if (!Object.hasOwn(SLIDER_RANGES, id)) throw new Error(`No slider range for "${id}"`)
  return SLIDER_RANGES[id as SliderId]
}
