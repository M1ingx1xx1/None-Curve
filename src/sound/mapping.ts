// Sound → parameters: the parameters sound can drive (targets) and the pure function that applies
// the mappings to the slider values. No React, no DOM, no Web Audio (see docs/SOUND_PLAN.md §5–6).
//
// Every target is one slider of the Geometry or Experimental tab, with that slider's own range, step
// and scale (Tolerance is logarithmic), copied from its control component. A mapping moves the
// slider's position, not the raw value, and the live value is always one the slider itself can
// produce (highest rule, SOUND_PLAN §2): positions snap to the slider's step before converting back.

import { CURL_LIMITS } from '../geometry/curl'
import { DISTORTION_LIMITS } from '../geometry/distortion'
import { NOISE_LIMITS } from '../geometry/noise'
import { RANDOM_ANCHOR_LIMITS } from '../geometry/randomAnchors'
import { RIPPLE_LIMITS } from '../geometry/ripple'
import type { ExperimentalParams, GeometryParams } from '../geometry/types'
import { WIND_LIMITS } from '../geometry/wind'
import type { FeatureFrame } from './types'

/** Features a continuous mapping can follow (events — Beat, Kick — come in phase 3). */
export type ContinuousFeature = 'level' | 'low' | 'mid' | 'high' | 'brightness'

export const CONTINUOUS_FEATURES: readonly { id: ContinuousFeature; label: string }[] = [
  { id: 'level', label: 'Level' },
  { id: 'low', label: 'Low' },
  { id: 'mid', label: 'Mid' },
  { id: 'high', label: 'High' },
  { id: 'brightness', label: 'Brightness' },
]

/** One parameter sound can drive: a slider of the Geometry or Experimental tab. */
export interface TargetSpec {
  /** Stable id, "<group>.<param>", e.g. "distortion.amount", "experimental.noise.amount". */
  id: string
  tab: 'geometry' | 'experimental'
  /** The control group it belongs to, as labelled in the panel, e.g. "Distortion", "Ripple". */
  section: string
  /** The slider's label in the panel, e.g. "Amount". */
  label: string
  /** The slider's range and step in parameter units (exactly as the panel's slider). */
  min: number
  max: number
  step: number
  get(params: GeometryParams): number
  /** The params with this value set; copies only the groups on the way (immutable). */
  set(params: GeometryParams, value: number): GeometryParams
  /** Where a value sits on the panel's slider, 0–1 (log-scaled sliders included), and back. */
  toSlider(value: number): number
  fromSlider(position: number): number
  /**
   * Why driving this target currently changes nothing (its step or effect is off, or a mode hides
   * it), as a short sentence for the Sound tab ("Turn on Ripple to hear this."); null when it acts.
   */
  inactive(params: GeometryParams): string | null
}

// ---- Slider scales ----

/** How a slider maps its value to a position: `steps` equal steps from 0 to 1. */
interface Scale {
  /** Number of slider steps from one end to the other. */
  steps: number
  /** Continuous position of a value (may fall outside 0–1 for out-of-range values). */
  position(value: number): number
  /** The value the slider produces at step `index` (0…steps), with the slider's own rounding. */
  valueAt(index: number): number
}

/** Decimals of a number as written ("0.05" → 2), to strip floating-point noise like a range input does. */
function decimals(n: number): number {
  return (String(n).split('.')[1] ?? '').length
}

/** An ordinary range input: min + k × step, k = 0…(max − min) / step. */
function linearScale(min: number, max: number, step: number): Scale {
  const digits = Math.max(decimals(min), decimals(step))
  return {
    steps: Math.round((max - min) / step),
    position: (value) => (value - min) / (max - min),
    valueAt: (index) => Number((min + index * step).toFixed(digits)),
  }
}

// FlattenControls' Tolerance slider: logarithmic, 0.1–500 font units on a 0–100 slider in steps of 0.5,
// rounded by roundTolerance. Reproduced exactly so the live value is one that slider produces.
const TOL_MIN = 0.1
const TOL_MAX = 500
const TOL_SLIDER_STEP = 0.5

function roundTolerance(tol: number): number {
  if (tol < 1) return Math.round(tol * 100) / 100
  if (tol < 10) return Math.round(tol * 10) / 10
  return Math.round(tol)
}

const toleranceScale: Scale = {
  steps: 100 / TOL_SLIDER_STEP,
  position: (tol) => Math.log(tol / TOL_MIN) / Math.log(TOL_MAX / TOL_MIN),
  // Same expression as FlattenControls' fromSlider(pos), with pos = index × 0.5 on its 0–100 slider.
  valueAt: (index) => roundTolerance(TOL_MIN * Math.pow(TOL_MAX / TOL_MIN, (index * TOL_SLIDER_STEP) / 100)),
}

const clamp01 = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0)

// ---- Target definitions ----

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string
type GroupKey = 'flatten' | 'random' | 'squaring' | 'anchors' | 'grid' | 'distortion'
type EffectKey = 'noise' | 'ripple' | 'curl' | 'wind'

/** Reads and writes one numeric field of the params, copying only the objects on the way. */
interface Field {
  id: string
  read(params: GeometryParams): unknown
  write(params: GeometryParams, value: number): GeometryParams
}

function groupField<G extends GroupKey>(group: G, key: NumericKeys<GeometryParams[G]>): Field {
  return {
    id: `${group}.${key}`,
    read: (p) => p[group][key],
    write: (p, value) => ({ ...p, [group]: { ...p[group], [key]: value } }),
  }
}

function effectField<E extends EffectKey>(effect: E, key: NumericKeys<ExperimentalParams[E]>): Field {
  return {
    id: `experimental.${effect}.${key}`,
    read: (p) => p.experimental[effect][key],
    write: (p, value) => ({
      ...p,
      experimental: { ...p.experimental, [effect]: { ...p.experimental[effect], [key]: value } },
    }),
  }
}

interface TargetDef {
  field: Field
  tab: TargetSpec['tab']
  section: string
  label: string
  min: number
  max: number
  step: number
  /** Defaults to the linear scale of min, max, step. */
  scale?: Scale
  /**
   * Value when the field is missing (older saved settings lack Noise Turn and Ripple Petals; the panel
   * shows them as 0). Defaults to min.
   */
  fallback?: number
  inactive?: (params: GeometryParams) => string | null
}

function target(def: TargetDef): TargetSpec {
  const scale = def.scale ?? linearScale(def.min, def.max, def.step)
  const fallback = def.fallback ?? def.min
  const toSlider = (value: number) => {
    const position = scale.position(value)
    return Number.isNaN(position) ? 0 : clamp01(position)
  }
  return {
    id: def.field.id,
    tab: def.tab,
    section: def.section,
    label: def.label,
    min: def.min,
    max: def.max,
    step: def.step,
    get: (params) => {
      const value = def.field.read(params)
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    },
    set: def.field.write,
    toSlider,
    // Snaps to the slider's step, so only values the slider itself can produce come back.
    fromSlider: (position) => scale.valueAt(Math.round(clamp01(Number.isNaN(position) ? 0 : position) * scale.steps)),
    inactive: def.inactive ?? (() => null),
  }
}

// Why a target does nothing right now. Sound never flips a switch or a mode, so these depend only on
// settings the user controls.
const flattenReplaced = (p: GeometryParams) =>
  p.random.enabled ? 'Random anchors replace flattening: turn them off to hear this.' : null
const randomOff = (p: GeometryParams) => (p.random.enabled ? null : 'Turn on Random anchors to hear this.')

const EFFECT_NAMES: Record<EffectKey, string> = { noise: 'Noise', ripple: 'Ripple', curl: 'Curl', wind: 'Wind' }

const geometry = (section: string, field: Field, label: string, min: number, max: number, step: number, rest: Partial<TargetDef> = {}) =>
  target({ field, tab: 'geometry', section, label, min, max, step, ...rest })
const experimental = <E extends EffectKey>(
  effect: E,
  key: NumericKeys<ExperimentalParams[E]>,
  label: string,
  min: number,
  max: number,
  step: number,
  rest: Partial<TargetDef> = {},
) =>
  target({
    field: effectField(effect, key),
    tab: 'experimental',
    section: EFFECT_NAMES[effect],
    label,
    min,
    max,
    step,
    inactive: (p) => (p.experimental[effect].enabled ? null : `Turn on ${EFFECT_NAMES[effect]} to hear this.`),
    ...rest,
  })

/** Every parameter sound can drive, Geometry tab first, in panel order. */
export const TARGETS: readonly TargetSpec[] = [
  // Geometry tab. Ranges, steps and labels as in FlattenControls, SquaringControls, AnchorControls,
  // GridControls, DistortionControls and RandomAnchorControls (Random anchors sit at the bottom).
  geometry('Curve flattening', groupField('flatten', 'tolerance'), 'Tolerance', TOL_MIN, TOL_MAX, 0.01, {
    // Log slider: step here is roundTolerance's finest unit; the scale holds the slider's real steps.
    scale: toleranceScale,
    inactive: (p) => flattenReplaced(p) ?? (p.flatten.mode === 'adaptive' ? null : 'Set Mode to Adaptive to hear this.'),
  }),
  geometry('Curve flattening', groupField('flatten', 'segmentsPerCurve'), 'Segments per curve', 1, 32, 1, {
    inactive: (p) => flattenReplaced(p) ?? (p.flatten.mode === 'segments' ? null : 'Set Mode to Fixed segments to hear this.'),
  }),
  geometry('Curve flattening', groupField('flatten', 'cornerAngle'), 'Corner angle', 1, 90, 1, {
    inactive: (p) => flattenReplaced(p) ?? (p.flatten.mergeCurves ? null : 'Turn on Merge joined curves to hear this.'),
  }),
  geometry('Squaring', groupField('squaring', 'amount'), 'Amount', 0, 1, 0.05),
  geometry('Anchors', groupField('anchors', 'spacing'), 'Anchor spacing', 0, 200, 1),
  geometry('Anchors', groupField('anchors', 'simplify'), 'Anchor reduction', 0, 100, 0.5),
  geometry('Grid & angles', groupField('grid', 'size'), 'Grid size', 0, 200, 1, {
    inactive: (p) => (p.grid.snap ? null : 'Turn on Snap to grid to hear this.'),
  }),
  geometry('Distortion', groupField('distortion', 'amount'), 'Noise amplitude', 0, DISTORTION_LIMITS.maxAmount, 1),
  geometry('Distortion', groupField('distortion', 'frequency'), 'Noise frequency', DISTORTION_LIMITS.minFrequency, DISTORTION_LIMITS.maxFrequency, 0.5),
  geometry('Distortion', groupField('distortion', 'normalBias'), 'Normal bias', 0, 1, 0.05),
  geometry('Random anchors', groupField('random', 'density'), 'Density', RANDOM_ANCHOR_LIMITS.minDensity, RANDOM_ANCHOR_LIMITS.maxDensity, 1, {
    inactive: randomOff,
  }),
  geometry('Random anchors', groupField('random', 'randomness'), 'Randomness', 0, 1, 0.05, { inactive: randomOff }),

  // Experimental tab, as in ExperimentalControls: each effect acts only while its "Use …" is on.
  experimental('noise', 'amount', 'Amount', 0, NOISE_LIMITS.maxAmount, 0.1),
  experimental('noise', 'facet', 'Facet size', NOISE_LIMITS.minFacet, NOISE_LIMITS.maxFacet, 0.02),
  experimental('noise', 'turn', 'Turn', 0, 345, 15, { fallback: 0 }),
  experimental('ripple', 'amount', 'Amount', 0, RIPPLE_LIMITS.maxAmount, 0.1),
  experimental('ripple', 'wavelength', 'Wavelength', RIPPLE_LIMITS.minWavelength, RIPPLE_LIMITS.maxWavelength, 0.02),
  experimental('ripple', 'sides', 'Sides', RIPPLE_LIMITS.minSides, RIPPLE_LIMITS.maxSides, 1),
  experimental('ripple', 'centerX', 'Center X', RIPPLE_LIMITS.minCenter, RIPPLE_LIMITS.maxCenter, 0.1),
  experimental('ripple', 'centerY', 'Center Y', RIPPLE_LIMITS.minCenter, RIPPLE_LIMITS.maxCenter, 0.1),
  experimental('ripple', 'fade', 'Fade', 0, 1, 0.1),
  experimental('ripple', 'petals', 'Petals', 0, RIPPLE_LIMITS.maxPetals, 0.1, { fallback: 0 }),
  experimental('curl', 'amount', 'Amount', -CURL_LIMITS.maxAmount, CURL_LIMITS.maxAmount, 0.1),
  experimental('curl', 'rings', 'Rings', CURL_LIMITS.minRings, CURL_LIMITS.maxRings, 1),
  experimental('curl', 'sides', 'Sides', CURL_LIMITS.minSides, CURL_LIMITS.maxSides, 1),
  experimental('wind', 'direction', 'Direction', 0, 345, 15),
  experimental('wind', 'strength', 'Strength', 0, WIND_LIMITS.maxStrength, 0.1),
  experimental('wind', 'gust', 'Gust size', WIND_LIMITS.minGust, WIND_LIMITS.maxGust, 0.02),
  experimental('wind', 'gustiness', 'Gustiness', 0, WIND_LIMITS.maxGustiness, 0.1),
]

const targetsById = new Map(TARGETS.map((t) => [t.id, t]))

export function targetById(id: string): TargetSpec | undefined {
  return targetsById.get(id)
}

/** A continuous mapping: one feature drives one target. */
export interface Mapping {
  id: string
  enabled: boolean
  feature: ContinuousFeature
  target: string
  /** -1–1: the share of the slider's full travel the target moves at feature 1 (negative turns it down). */
  depth: number
}

export interface Modulated {
  /** The live parameters: `base` itself (same object) when no mapping moves anything. */
  params: GeometryParams
  /** Live slider position (0–1) of each target a mapping moves, by target id. */
  positions: ReadonlyMap<string, number>
}

const NO_POSITIONS: ReadonlyMap<string, number> = new Map()

/**
 * Applies the mappings to the slider values: for each target, its slider position plus the sum of
 * depth × feature over its enabled mappings, clamped to the slider, converted back and rounded to the
 * slider's step. Targets that are inactive, mappings with depth 0, and features at 0 contribute
 * nothing; when nothing contributes, `base` is returned unchanged (exact restore).
 *
 * `positions` holds every target with an enabled, active mapping of non-zero depth, at the slider
 * position of its live value (its base position while the sum is 0 or stays within the base value's
 * own step), so markers sit where the slider's thumb would be for that value.
 */
export function modulate(base: GeometryParams, frame: FeatureFrame, mappings: readonly Mapping[]): Modulated {
  // Sum of depth × feature per target, in the order targets first appear in the mappings.
  let sums: Map<TargetSpec, number> | null = null
  const inactive = new Map<TargetSpec, boolean>()
  for (const mapping of mappings) {
    if (!mapping.enabled || mapping.depth === 0 || !Number.isFinite(mapping.depth)) continue
    const spec = targetById(mapping.target)
    if (!spec) continue
    let off = inactive.get(spec)
    if (off === undefined) inactive.set(spec, (off = spec.inactive(base) !== null))
    if (off) continue
    const feature = frame[mapping.feature]
    const amount = typeof feature === 'number' && Number.isFinite(feature) ? feature : 0
    sums ??= new Map()
    sums.set(spec, (sums.get(spec) ?? 0) + mapping.depth * amount)
  }
  if (!sums) return { params: base, positions: NO_POSITIONS }

  let params = base
  const positions = new Map<string, number>()
  for (const [spec, sum] of sums) {
    const value = spec.get(base)
    const basePosition = spec.toSlider(value)
    // Nothing added this frame: keep the slider's value exactly, even when it lies off the step grid.
    if (sum === 0) {
      positions.set(spec.id, basePosition)
      continue
    }
    const live = spec.fromSlider(basePosition + sum)
    // Still within the base value's own step (the step its thumb shows): keep the exact slider value,
    // so a value typed between steps does not jump to its neighbour at the faintest sound.
    if (live === value || live === spec.fromSlider(basePosition)) {
      positions.set(spec.id, basePosition)
      continue
    }
    params = spec.set(params, live)
    positions.set(spec.id, spec.toSlider(live))
  }
  return { params, positions }
}
