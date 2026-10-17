// Sound → parameters: the features a mapping can follow, the parameters sound can drive (targets), and
// the pure function that applies the mappings to the slider values. No React, no DOM, no Web Audio
// (see docs/SOUND_PLAN.md §5–6).
//
// Most targets are one slider of the Geometry or Experimental tab, with that slider's own range, step
// and scale (Tolerance is logarithmic, Thorn's Reach cubic), shared with its control through src/state/sliderScales.ts. A
// mapping moves the slider's position, not the raw value, and the live value is always one the slider
// itself can produce (highest rule, SOUND_PLAN §2): positions snap to the slider's step before converting back.
// The seeds are jump targets: a seed moves on by one whole number on each jump (jumps.ts), so every
// anchor lands somewhere new, and it stays within its field's range.

import { DISTORTION_LIMITS } from '../geometry/distortion'
import { EXPERIMENTAL_LIMITS } from '../geometry/experimental'
import { RANDOM_ANCHOR_LIMITS } from '../geometry/randomAnchors'
import { THORN_FALLBACK } from '../geometry/thorn'
import type { ExperimentalParams, FlattenMode, GeometryParams } from '../geometry/types'
import { reachFromSlider, reachToSlider, sliderRange, THORN_REACH, TOLERANCE, toleranceFromSlider } from '../state/sliderScales'
import { NEUTRAL_RESPONSE, RESPONSE_LIMITS, type FeatureFrame, type ResponseSettings } from './types'

const clamp01 = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0)

// ---- Features ----

/** The features a mapping can follow: numeric fields of FeatureFrame. */
export type FeatureId = 'level' | 'swell' | 'bass' | 'mids' | 'treble' | 'brightness' | 'pitch' | 'melody' | 'beat' | 'activity' | 'pan'
/** The old name, kept so existing imports keep working. */
export type ContinuousFeature = FeatureId

export type FeatureGroup = 'Loudness' | 'Bands' | 'Tone' | 'Rhythm' | 'Stereo'

export interface FeatureSpec {
  id: FeatureId
  label: string
  group: FeatureGroup
  /** Runs −1…1 instead of 0…1 (Pan). */
  bipolar?: true
  /** On a seed (a jump target) this feature counts the frame's onsets instead: one step per Beat. */
  event?: 'onset'
}

export const FEATURE_GROUPS: readonly FeatureGroup[] = ['Loudness', 'Bands', 'Tone', 'Rhythm', 'Stereo']

/** Every feature, in FEATURE_GROUPS order, as the Sound tab lists them. */
export const FEATURES: readonly FeatureSpec[] = [
  { id: 'level', label: 'Level', group: 'Loudness' },
  { id: 'swell', label: 'Swell', group: 'Loudness' },
  { id: 'bass', label: 'Bass', group: 'Bands' },
  { id: 'mids', label: 'Mids', group: 'Bands' },
  { id: 'treble', label: 'Treble', group: 'Bands' },
  { id: 'brightness', label: 'Brightness', group: 'Tone' },
  { id: 'pitch', label: 'Pitch', group: 'Tone' },
  { id: 'melody', label: 'Melody', group: 'Tone' },
  { id: 'beat', label: 'Beat', group: 'Rhythm', event: 'onset' },
  { id: 'activity', label: 'Activity', group: 'Rhythm' },
  { id: 'pan', label: 'Pan', group: 'Stereo', bipolar: true },
]

/** Kept for existing imports: the same list. */
export const CONTINUOUS_FEATURES = FEATURES

const featuresById = new Map<string, FeatureSpec>(FEATURES.map((f) => [f.id, f]))

export function featureById(id: string): FeatureSpec | undefined {
  return featuresById.get(id)
}

/** A feature's value in a frame, clamped to −1…1 for a bipolar feature and to 0…1 for any other; NaN or missing reads 0. */
export function featureValue(frame: FeatureFrame, id: FeatureId): number {
  const value: unknown = frame[id]
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return featuresById.get(id)?.bipolar ? (value > -1 ? (value < 1 ? value : 1) : -1) : clamp01(value)
}

// ---- Targets ----

/** One group's changes, as the editor's updateParams action takes them. */
export type ParamPatch = { [G in keyof GeometryParams]: { group: G; patch: Partial<GeometryParams[G]> } }[keyof GeometryParams]

export interface Activation {
  patches: readonly ParamPatch[]
  /** What was changed, as short sentences for the Sound tab: "Turned on Ripple." */
  notice: string
}

/** One parameter sound can drive: a slider or a seed of the Geometry or Experimental tab. */
export interface TargetSpec {
  /** Stable id, "<group>.<param>", e.g. "distortion.amount", "experimental.crumple.amount". */
  id: string
  tab: 'geometry' | 'experimental'
  /** 'slider': live position = slider position + Depth × feature. 'jump': a seed that moves on by one on each jump (jumps.ts). */
  kind: 'slider' | 'jump'
  /** The control group it belongs to, as labelled in the panel, e.g. "Distortion", "Ripple". */
  section: string
  /** The slider's label in the panel, e.g. "Amount". */
  label: string
  /** The slider's range and step in parameter units (exactly as the panel's slider; a seed: 0 to its largest, step 1). */
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
  /** The settings to change so this target acts, or null when it already acts (inactive(params) === null). */
  activate(params: GeometryParams): Activation | null
}

/** The params with the patches applied, as the editor's updateParams action applies them (each group merged shallowly). */
export function applyPatches(params: GeometryParams, patches: readonly ParamPatch[]): GeometryParams {
  for (const { group, patch } of patches) params = { ...params, [group]: { ...params[group], ...patch } }
  return params
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

// The Tolerance slider (logarithmic, see TOLERANCE in src/state/sliderScales.ts), so the live value is one
// that slider produces.
const toleranceSlider = TOLERANCE.slider
const toleranceScale: Scale = {
  steps: Math.round((toleranceSlider.max - toleranceSlider.min) / toleranceSlider.step),
  position: (tol) => Math.log(tol / TOLERANCE.min) / Math.log(TOLERANCE.max / TOLERANCE.min),
  // The range input at step `index`, as FlattenControls reads it.
  valueAt: (index) => toleranceFromSlider(toleranceSlider.min + index * toleranceSlider.step),
}

// Thorn's Reach slider (cubic, see THORN_REACH in src/state/sliderScales.ts); its range input runs 0–1.
const reachSlider = THORN_REACH.slider
const reachScale: Scale = {
  steps: Math.round((reachSlider.max - reachSlider.min) / reachSlider.step),
  position: reachToSlider,
  // The range input at step `index`, as ExperimentalControls reads it.
  valueAt: (index) => reachFromSlider(reachSlider.min + index * reachSlider.step),
}

// ---- What a target needs to act ----

/**
 * A setting a target needs to act: why it does not act (a sentence for the Sound tab, null while the
 * setting is right), and the change that makes it right, with a sentence saying what was changed.
 */
interface Requirement {
  unmet(params: GeometryParams): string | null
  meet(params: GeometryParams): { patch: ParamPatch; notice: string }
}

type EffectKey = 'crumple' | 'ripple' | 'whorl' | 'slipstream' | 'thorn' | 'dissolve'

const EFFECT_NAMES: Record<EffectKey, string> = {
  crumple: 'Crumple',
  ripple: 'Ripple',
  whorl: 'Whorl',
  slipstream: 'Slipstream',
  thorn: 'Thorn',
  dissolve: 'Dissolve',
}

/** Noise amplitude set by turning Distortion on for one of its targets: clearly visible, a fifth of the slider. */
const ACTIVE_DISTORTION_AMOUNT = 40
/** Thorn's Refraction set by turning it on for its Flute width target: clearly visible, half the slider. */
const ACTIVE_REFRACTION = 0.5

// Random anchors replace Flatten's sampling, so every Curve flattening slider needs them off.
const flattenNotReplaced: Requirement = {
  unmet: (p) => (p.random.enabled ? 'Random anchors replace flattening: turn them off to hear this.' : null),
  meet: () => ({ patch: { group: 'random', patch: { enabled: false } }, notice: 'Turned off Random anchors.' }),
}
const flattenMode = (mode: FlattenMode, label: string): Requirement => ({
  unmet: (p) => (p.flatten.mode === mode ? null : `Set Mode to ${label} to hear this.`),
  meet: () => ({ patch: { group: 'flatten', patch: { mode } }, notice: `Set Mode to ${label}.` }),
})
const mergeCurvesOn: Requirement = {
  unmet: (p) => (p.flatten.mergeCurves ? null : 'Turn on Merge joined curves to hear this.'),
  meet: () => ({ patch: { group: 'flatten', patch: { mergeCurves: true } }, notice: 'Turned on Merge joined curves.' }),
}
const snapOn: Requirement = {
  unmet: (p) => (p.grid.snap ? null : 'Turn on Snap to grid to hear this.'),
  meet: () => ({ patch: { group: 'grid', patch: { snap: true } }, notice: 'Turned on Snap to grid.' }),
}
// Noise amplitude 0 turns Distortion off (applyDistortion), so its other settings do nothing.
const distortionOn: Requirement = {
  unmet: (p) => (p.distortion.amount > 0 ? null : 'Set Noise amplitude above 0 to hear this.'),
  meet: () => ({
    patch: { group: 'distortion', patch: { amount: ACTIVE_DISTORTION_AMOUNT } },
    notice: `Set Noise amplitude to ${ACTIVE_DISTORTION_AMOUNT}.`,
  }),
}
const randomOn: Requirement = {
  unmet: (p) => (p.random.enabled ? null : 'Turn on Random anchors to hear this.'),
  meet: () => ({ patch: { group: 'random', patch: { enabled: true } }, notice: 'Turned on Random anchors.' }),
}
// At 0% Randomness the anchors are evenly spaced, so the seed has nothing to choose (RandomAnchorControls).
const randomnessOn: Requirement = {
  unmet: (p) => (p.random.randomness > 0 ? null : 'Set Randomness above 0% to hear this.'),
  meet: () => ({ patch: { group: 'random', patch: { randomness: 1 } }, notice: 'Set Randomness to 100%.' }),
}
const effectOn = (effect: EffectKey): Requirement => ({
  unmet: (p) => (p.experimental[effect]?.enabled ? null : `Turn on ${EFFECT_NAMES[effect]} to hear this.`),
  meet: (p) => ({
    // The whole effect object: updateParams merges the experimental group one level deep only.
    patch: { group: 'experimental', patch: { [effect]: { ...p.experimental[effect], enabled: true } } as Partial<ExperimentalParams> },
    notice: `Turned on ${EFFECT_NAMES[effect]}.`,
  }),
})
// Thorn's Burst (applyThorn) spreads its own number of spikes, sunk by Dent, and grows no roots: Anchors and Root act
// with Burst off, Burst's Anchors and Dent with it on.
const burst = (on: boolean): Requirement => ({
  unmet: (p) => ((p.experimental.thorn?.burst === true) === on ? null : `Turn ${on ? 'on' : 'off'} Burst to hear this.`),
  meet: (p) => ({
    patch: { group: 'experimental', patch: { thorn: { ...p.experimental.thorn, burst: on } } as Partial<ExperimentalParams> },
    notice: `Turned ${on ? 'on' : 'off'} Burst.`,
  }),
})
// Refraction 0 turns Thorn's fluted glass off (applyThorn), so its Flute width does nothing.
const refractionOn: Requirement = {
  unmet: (p) => ((p.experimental.thorn?.refraction ?? 0) > 0 ? null : 'Set Refraction above 0% to hear this.'),
  meet: (p) => ({
    patch: { group: 'experimental', patch: { thorn: { ...p.experimental.thorn, refraction: ACTIVE_REFRACTION } } as Partial<ExperimentalParams> },
    notice: `Set Refraction to ${Math.round(ACTIVE_REFRACTION * 100)}%.`,
  }),
}
// The shared seed picks Crumple's folds, Slipstream's gusts, slips, cuts and trails, Thorn's anchors and flutes, and
// Dissolve's ink; Ripple and Whorl have no randomness.
const seededEffectOn: Requirement = {
  unmet: (p) =>
    p.experimental.crumple.enabled || p.experimental.slipstream.enabled || p.experimental.thorn?.enabled || p.experimental.dissolve?.enabled
      ? null
      : 'Turn on Crumple, Slipstream, Thorn or Dissolve to hear this.',
  meet: effectOn('crumple').meet,
}

/** The first reason a target does not act, or null. */
function firstUnmet(requires: readonly Requirement[], params: GeometryParams): string | null {
  for (const requirement of requires) {
    const why = requirement.unmet(params)
    if (why !== null) return why
  }
  return null
}

/** Meets every unmet requirement in order; consecutive changes to one group go into one patch. */
function activation(requires: readonly Requirement[], params: GeometryParams): Activation | null {
  const patches: ParamPatch[] = []
  const notices: string[] = []
  for (const requirement of requires) {
    if (requirement.unmet(params) === null) continue
    const { patch, notice } = requirement.meet(params)
    params = applyPatches(params, [patch])
    const last = patches[patches.length - 1]
    if (last?.group === patch.group) patches[patches.length - 1] = { group: last.group, patch: { ...last.patch, ...patch.patch } } as ParamPatch
    else patches.push(patch)
    notices.push(notice)
  }
  return patches.length ? { patches, notice: notices.join(' ') } : null
}

// ---- Target definitions ----

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string
type GroupKey = 'flatten' | 'random' | 'squaring' | 'anchors' | 'grid' | 'distortion'

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
    // Older saved settings may lack a whole effect (Thorn, Dissolve).
    read: (p) => p.experimental[effect]?.[key],
    write: (p, value) => ({
      ...p,
      experimental: { ...p.experimental, [effect]: { ...p.experimental[effect], [key]: value } },
    }),
  }
}

/** A field at the top level of the Experimental tab's params (its shared seed). */
function experimentalField(key: NumericKeys<ExperimentalParams>): Field {
  return {
    id: `experimental.${key}`,
    read: (p) => p.experimental[key],
    write: (p, value) => ({ ...p, experimental: { ...p.experimental, [key]: value } }),
  }
}

interface TargetDef {
  field: Field
  tab: TargetSpec['tab']
  /** Defaults to 'slider'. */
  kind?: TargetSpec['kind']
  section: string
  label: string
  min: number
  max: number
  step: number
  /** Defaults to the linear scale of min, max, step. */
  scale?: Scale
  /**
   * Value when the field is missing, as the panel shows it (older saved settings lack Crumple Turn,
   * Ripple Petals, Slipstream Slip, Cuts and Trails, and Thorn Root, Refraction, Flute width, Burst anchors and Dent).
   * Defaults to min.
   */
  fallback?: number
  /** The settings it needs to act, checked and met in this order. */
  requires?: readonly Requirement[]
}

function target(def: TargetDef): TargetSpec {
  const scale = def.scale ?? linearScale(def.min, def.max, def.step)
  const fallback = def.fallback ?? def.min
  const requires = def.requires ?? []
  const toSlider = (value: number) => {
    const position = scale.position(value)
    return Number.isNaN(position) ? 0 : clamp01(position)
  }
  return {
    id: def.field.id,
    tab: def.tab,
    kind: def.kind ?? 'slider',
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
    inactive: (params) => firstUnmet(requires, params),
    activate: (params) => activation(requires, params),
  }
}

// Sliders take their range from SLIDER_RANGES (src/state/sliderScales.ts), as the panels do.
const geometry = (section: string, field: Field, label: string, rest: Partial<TargetDef> = {}) =>
  target({ field, tab: 'geometry', section, label, ...sliderRange(field.id), ...rest })
const experimental = <E extends EffectKey>(effect: E, key: NumericKeys<ExperimentalParams[E]>, label: string, rest: Partial<TargetDef> = {}) => {
  const field = effectField(effect, key)
  return target({ field, tab: 'experimental', section: EFFECT_NAMES[effect], label, ...sliderRange(field.id), requires: [effectOn(effect)], ...rest })
}
/** A seed field (whole numbers 0 to its largest seed): a jump target. */
const seed = (tab: TargetSpec['tab'], section: string, field: Field, max: number, requires: readonly Requirement[]) =>
  target({ field, tab, kind: 'jump', section, label: 'Seed', min: 0, max, step: 1, requires })

/** Every parameter sound can drive, Geometry tab first, in panel order. */
export const TARGETS: readonly TargetSpec[] = [
  // Geometry tab, labels as in FlattenControls, SquaringControls, AnchorControls, GridControls,
  // DistortionControls and RandomAnchorControls (Random anchors sit at the bottom).
  target({
    field: groupField('flatten', 'tolerance'),
    tab: 'geometry',
    section: 'Curve flattening',
    label: 'Tolerance',
    // Log slider: min and max are its values, step roundTolerance's finest unit; the scale holds the slider's real steps.
    min: TOLERANCE.min,
    max: TOLERANCE.max,
    step: TOLERANCE.step,
    scale: toleranceScale,
    requires: [flattenNotReplaced, flattenMode('adaptive', 'Adaptive')],
  }),
  geometry('Curve flattening', groupField('flatten', 'segmentsPerCurve'), 'Segments per curve', {
    requires: [flattenNotReplaced, flattenMode('segments', 'Fixed segments')],
  }),
  // Shown with Merge joined curves in either mode (FlattenControls' merge controls are shared by both
  // modes, and flatten() merges in both).
  geometry('Curve flattening', groupField('flatten', 'cornerAngle'), 'Corner angle', {
    requires: [flattenNotReplaced, mergeCurvesOn],
  }),
  geometry('Squaring', groupField('squaring', 'amount'), 'Amount'),
  geometry('Anchors', groupField('anchors', 'spacing'), 'Anchor spacing'),
  geometry('Anchors', groupField('anchors', 'simplify'), 'Anchor reduction'),
  geometry('Grid & angles', groupField('grid', 'size'), 'Grid size', { requires: [snapOn] }),
  geometry('Distortion', groupField('distortion', 'amount'), 'Noise amplitude'),
  geometry('Distortion', groupField('distortion', 'frequency'), 'Noise frequency', { requires: [distortionOn] }),
  geometry('Distortion', groupField('distortion', 'normalBias'), 'Normal bias', { requires: [distortionOn] }),
  seed('geometry', 'Distortion', groupField('distortion', 'seed'), DISTORTION_LIMITS.maxSeed, [distortionOn]),
  geometry('Random anchors', groupField('random', 'density'), 'Density', { requires: [randomOn] }),
  geometry('Random anchors', groupField('random', 'randomness'), 'Randomness', { requires: [randomOn] }),
  seed('geometry', 'Random anchors', groupField('random', 'seed'), RANDOM_ANCHOR_LIMITS.maxSeed, [randomOn, randomnessOn]),

  // Experimental tab, as in ExperimentalControls: each effect acts only while its "Use …" is on; the
  // shared Seed sits in its own group at the bottom.
  experimental('crumple', 'amount', 'Amount'),
  experimental('crumple', 'facet', 'Facet size'),
  experimental('crumple', 'turn', 'Turn', { fallback: 0 }),
  experimental('ripple', 'amount', 'Amount'),
  experimental('ripple', 'wavelength', 'Wavelength'),
  experimental('ripple', 'sides', 'Sides'),
  experimental('ripple', 'centerX', 'Center X'),
  experimental('ripple', 'centerY', 'Center Y'),
  experimental('ripple', 'fade', 'Fade'),
  experimental('ripple', 'petals', 'Petals', { fallback: 0 }),
  experimental('whorl', 'amount', 'Amount'),
  experimental('whorl', 'rings', 'Rings'),
  experimental('whorl', 'sides', 'Sides'),
  experimental('slipstream', 'direction', 'Direction'),
  experimental('slipstream', 'strength', 'Strength'),
  experimental('slipstream', 'slip', 'Slip', { fallback: 0 }),
  experimental('slipstream', 'gust', 'Gust size'),
  experimental('slipstream', 'gustiness', 'Gustiness'),
  experimental('slipstream', 'cuts', 'Cuts', { fallback: 0 }),
  experimental('slipstream', 'trails', 'Trails', { fallback: 0 }),
  experimental('thorn', 'count', 'Anchors', { requires: [effectOn('thorn'), burst(false)] }),
  // Cubic slider: min and max are its values, step roundReach's unit; the scale holds the slider's real steps.
  target({
    field: effectField('thorn', 'canvasReach'),
    tab: 'experimental',
    section: EFFECT_NAMES.thorn,
    label: 'Reach',
    min: 0,
    max: THORN_REACH.max,
    step: THORN_REACH.step,
    scale: reachScale,
    requires: [effectOn('thorn')],
  }),
  experimental('thorn', 'root', 'Root', { fallback: THORN_FALLBACK.root, requires: [effectOn('thorn'), burst(false)] }),
  experimental('thorn', 'spread', 'Spread'),
  experimental('thorn', 'width', 'Width'),
  experimental('thorn', 'refraction', 'Refraction', { fallback: 0 }),
  // The panel disables Flute width while Refraction is 0.
  experimental('thorn', 'flute', 'Flute width', {
    fallback: THORN_FALLBACK.flute,
    requires: [effectOn('thorn'), refractionOn],
  }),
  // Burst's own sliders: the panel shows its Anchors in place of Anchors, and disables Dent with Burst off.
  experimental('thorn', 'spikes', 'Burst anchors', { fallback: THORN_FALLBACK.spikes, requires: [effectOn('thorn'), burst(true)] }),
  experimental('thorn', 'dent', 'Dent', { fallback: THORN_FALLBACK.dent, requires: [effectOn('thorn'), burst(true)] }),
  experimental('dissolve', 'amount', 'Amount'),
  experimental('dissolve', 'grain', 'Grain'),
  experimental('dissolve', 'spread', 'Spread'),
  experimental('dissolve', 'specks', 'Specks'),
  experimental('dissolve', 'curl', 'Curl'),
  experimental('dissolve', 'facets', 'Facets'),
  seed('experimental', 'Seed', experimentalField('seed'), EXPERIMENTAL_LIMITS.maxSeed, [seededEffectOn]),
]

const targetsById = new Map(TARGETS.map((t) => [t.id, t]))

export function targetById(id: string): TargetSpec | undefined {
  return targetsById.get(id)
}

/** A seed moved on by `jumps` (a whole number), wrapped past the target's largest seed to 0; 0 jumps keep it exactly. */
export function seedAfter(spec: TargetSpec, seed: number, jumps: number): number {
  if (jumps === 0) return seed
  const count = spec.max + 1
  return (((Math.trunc(seed) + Math.trunc(jumps)) % count) + count) % count
}

// ---- Mappings and their shaping ----

/**
 * How a mapping answers its feature (shaping.ts):
 * - 'follow': continuously, as the feature moves (the default, and the only mode before shaping existed);
 * - 'trigger': one event each time the feature rises past the Gate. On a slider, a pulse to the full Depth that falls
 *   back in a straight line over Smooth (at least SHAPING_LIMITS.pulseMs); on a seed, one jump;
 * - 'toggle': each rise past the Gate flips the target between its slider value and slider value + Depth (eased
 *   over Smooth); on a seed, one jump per rise, as Trigger.
 */
export type MappingMode = 'follow' | 'trigger' | 'toggle'

export const MAPPING_MODES: readonly MappingMode[] = ['follow', 'trigger', 'toggle']

/**
 * A mapping's shaping: what it does to the feature before Depth (shaping.ts), and how far it may move its target.
 * Every field at its default (DEFAULT_SHAPING) gives exactly what a mapping gave before shaping existed.
 */
export interface Shaping {
  /**
   * Range, as shares (0–1) of the target slider's travel, rangeMin < rangeMax: the mapping moves the slider only within
   * this span. A slider that sits outside it is not pulled in: sound can then move it only towards the span. Several
   * mappings on one slider share one span, from the lowest of their lows to the highest of their highs (sharedRange),
   * so a full Range on one of them leaves the others' Ranges with no effect. No effect on a seed.
   */
  rangeMin: number
  rangeMax: number
  /**
   * Curve, −1–1, applied to the feature (after the Gate and Smooth): 0 is linear, above 0 an exponential response
   * (quiet parts stay low, value^(CURVE_BASE^curve)), below 0 a logarithmic one (quiet parts rise fast).
   */
  curve: number
  /**
   * Smooth, in ms: the time constant of a smoothing of this mapping's feature on top of the engine's Release. In Trigger
   * mode, how long the pulse takes to fall back; in Toggle mode, how long a flip takes.
   */
  smoothMs: number
  /**
   * Gate, 0–SHAPING_LIMITS.maxGate: below it the feature counts as 0, and above it the rest of the travel is spread over
   * 0–1 again ((value − gate) / (1 − gate)), so nothing jumps where it opens. Trigger and Toggle fire when the feature
   * rises past it (but at least SHAPING_LIMITS.minFire; with Beat, at every hit).
   */
  gate: number
  mode: MappingMode
}

export const DEFAULT_SHAPING: Shaping = { rangeMin: 0, rangeMax: 1, curve: 0, smoothMs: 0, gate: 0, mode: 'follow' }

export const SHAPING_LIMITS = {
  /** Range ends: shares of the slider's travel on this step, at least minSpan apart. */
  rangeStep: 0.01,
  minSpan: 0.01,
  curve: { min: -1, max: 1, step: 0.01 },
  smoothMs: { min: 0, max: 2000, step: 10 },
  gate: { min: 0, max: 0.95, step: 0.01 },
  /** The exponent at Curve ±1 is CURVE_BASE^±1. */
  curveBase: 3,
  /** Trigger's pulse falls back over Smooth, but never faster than this (ms), so even Smooth 0 shows a pulse. */
  pulseMs: 80,
  /**
   * Trigger and Toggle fire when the feature rises above the Gate, but never below minFire, and re-arm once it falls
   * rearm below that level, so noise around it fires once and the band stays open at Gate 0.
   */
  minFire: 0.1,
  rearm: 0.05,
  /** A longer gap between measured frames counts as this long (ms), as for the jumps (JUMP_LIMITS.maxStepMs). */
  maxStepMs: 100,
} as const

/** A mapping: one feature drives one target. The shaping fields are optional: missing, each is its default (DEFAULT_SHAPING). */
export interface Mapping extends Partial<Shaping> {
  id: string
  enabled: boolean
  feature: FeatureId
  target: string
  /**
   * -1–1: the share of the slider's full travel the target moves at feature 1 (negative turns it down).
   * On a seed, |depth| is the Rate of its jumps (jumps.ts).
   */
  depth: number
}

const snapTo = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(String(step).split('.')[1]?.length ?? 0))
const within = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

/**
 * Shaping fields clamped to SHAPING_LIMITS and snapped to their steps; a field that is missing or not a finite number
 * (or an unknown mode) comes from `current`. The range keeps at least minSpan between its ends: a patch that moves one
 * end stops it short of the other; one that sets both (a saved mapping) keeps rangeMin and moves rangeMax up.
 */
export function clampShaping(patch: Partial<Record<keyof Shaping, unknown>>, current: Shaping = DEFAULT_SHAPING): Shaping {
  const { curve, smoothMs, gate, rangeStep, minSpan } = SHAPING_LIMITS
  let rangeMin = snapTo(within(patch.rangeMin, 0, 1, current.rangeMin), rangeStep)
  let rangeMax = snapTo(within(patch.rangeMax, 0, 1, current.rangeMax), rangeStep)
  if (rangeMax - rangeMin < minSpan - 1e-9) {
    if (patch.rangeMin !== undefined && patch.rangeMax === undefined) rangeMin = snapTo(Math.max(0, rangeMax - minSpan), rangeStep)
    else rangeMax = snapTo(Math.min(1, rangeMin + minSpan), rangeStep)
    if (rangeMax - rangeMin < minSpan - 1e-9) rangeMin = snapTo(rangeMax - minSpan, rangeStep)
  }
  return {
    rangeMin,
    rangeMax,
    curve: snapTo(within(patch.curve, curve.min, curve.max, current.curve), curve.step),
    smoothMs: snapTo(within(patch.smoothMs, smoothMs.min, smoothMs.max, current.smoothMs), smoothMs.step),
    gate: snapTo(within(patch.gate, gate.min, gate.max, current.gate), gate.step),
    mode: MAPPING_MODES.includes(patch.mode as MappingMode) ? (patch.mode as MappingMode) : current.mode,
  }
}

/** A mapping's shaping with every missing field at its default. */
export function shapingOf(mapping: Partial<Shaping>): Shaping {
  return {
    rangeMin: mapping.rangeMin ?? DEFAULT_SHAPING.rangeMin,
    rangeMax: mapping.rangeMax ?? DEFAULT_SHAPING.rangeMax,
    curve: mapping.curve ?? DEFAULT_SHAPING.curve,
    smoothMs: mapping.smoothMs ?? DEFAULT_SHAPING.smoothMs,
    gate: mapping.gate ?? DEFAULT_SHAPING.gate,
    mode: mapping.mode ?? DEFAULT_SHAPING.mode,
  }
}

/** Only the shaping fields that differ from their defaults (how they are saved and how presets write them). */
export function shapingChanges(shaping: Shaping): Partial<Shaping> {
  const changes: Partial<Shaping> = {}
  for (const key of Object.keys(DEFAULT_SHAPING) as (keyof Shaping)[]) {
    if (shaping[key] !== DEFAULT_SHAPING[key]) Object.assign(changes, { [key]: shaping[key] })
  }
  return changes
}

/**
 * The Gate applied to a feature value (signed for Pan: the gate acts on its size): 0 up to the gate, then the rest of
 * the travel spread over 0–1. Gate 0 returns `value` itself.
 */
export function gateValue(value: number, gate: number): number {
  if (!(gate > 0)) return value
  const size = Math.abs(value)
  if (size <= gate) return 0
  const opened = (size - gate) / (1 - gate)
  return value < 0 ? -opened : opened
}

/** The Curve applied to a value in −1…1 (signed for Pan: the curve acts on its size). Curve 0 returns `value` itself. */
export function curveValue(value: number, curve: number): number {
  if (curve === 0 || !Number.isFinite(curve) || value === 0) return value
  const shaped = Math.abs(value) ** (SHAPING_LIMITS.curveBase ** curve)
  return value < 0 ? -shaped : shaped
}

/**
 * A mapping's feature value as far as it can be shaped without memory (Gate, then Curve; no Smooth): what Follow
 * gives at Smooth 0. Trigger and Toggle need the frames before (ShapingTracker), so without them they read 0.
 * At the default shaping, exactly featureValue.
 */
export function shapeStateless(mapping: Mapping, frame: FeatureFrame): number {
  if ((mapping.mode ?? 'follow') !== 'follow') return 0
  return curveValue(gateValue(featureValue(frame, mapping.feature), mapping.gate ?? 0), mapping.curve ?? 0)
}

export interface Modulated {
  /** The live parameters: `base` itself (same object) when no mapping moves anything. */
  params: GeometryParams
  /** Live slider position (0–1) of each driven slider target, by id. */
  positions: ReadonlyMap<string, number>
  /** Live seed of each driven jump target (its seed field's value plus its jumps, wrapped past the largest seed to 0), by id. */
  seeds: ReadonlyMap<string, number>
  /**
   * The span (slider positions, low and high) each slider target's live position keeps to, by id: only targets whose
   * mappings narrow their Range; missing, the whole slider. Letters on other levels keep to it too (letters.ts).
   */
  bounds?: ReadonlyMap<string, readonly [number, number]>
}

/** `position` kept to `bounds` (none: unchanged); a slider position outside them is not pulled in (see Shaping.rangeMin). */
export function withinBounds(position: number, basePosition: number, bounds: readonly [number, number] | undefined): number {
  if (!bounds) return position
  const low = Math.min(bounds[0], basePosition)
  const high = Math.max(bounds[1], basePosition)
  return position < low ? low : position > high ? high : position
}

/**
 * The span (shares of the slider's travel, low and high) that modulate() keeps a slider target to: from the lowest
 * rangeMin to the highest rangeMax among the target's enabled mappings with a Depth; undefined when none drives it.
 */
export function sharedRange(mappings: readonly Mapping[], targetId: string): readonly [number, number] | undefined {
  let span: [number, number] | undefined
  for (const mapping of mappings) {
    if (mapping.target !== targetId || !mapping.enabled || mapping.depth === 0 || !Number.isFinite(mapping.depth)) continue
    const low = mapping.rangeMin ?? 0
    const high = mapping.rangeMax ?? 1
    if (!span) span = [low, high]
    else {
      if (low < span[0]) span[0] = low
      if (high > span[1]) span[1] = high
    }
  }
  return span
}

const NO_VALUES: ReadonlyMap<string, number> = new Map()

/**
 * Applies the mappings to the slider values: for each slider target, its slider position plus the sum
 * of depth × feature over its enabled mappings, clamped to the slider, converted back and rounded to
 * the slider's step. Targets that are inactive, mappings with depth 0, and features at 0 contribute
 * nothing; when nothing contributes, `base` is returned unchanged (exact restore).
 *
 * `positions` holds every slider target with an enabled, active mapping of non-zero depth, at the
 * slider position of its live value (its base position while the sum is 0 or stays within the base
 * value's own step), so markers sit where the slider's thumb would be for that value.
 *
 * A seed (jump target) driven the same way takes no part in the sum: its live seed is its field's
 * value moved on by `jumps` (by target id, from JumpTracker), listed in `seeds`.
 *
 * `response` applies the Response group: Melody tracking adds RESPONSE_LIMITS.melodyBoost × melody × the Melody
 * pulse to each slider mapping's feature (capped at 1; not Pan, not a Melody row, only in Follow mode), and Strength
 * multiplies each target's sum before it is clamped. Neutral (the default) gives exactly the same values as without it
 * (a sum times 1 is that sum, bit for bit). Motion contrast and Pitch reactive act per letter (letters.ts), never here.
 *
 * `shaped` holds each mapping's shaped feature value (ShapingTracker, by mapping id: Gate, Curve, Smooth, Trigger's
 * pulse, Toggle's state) in place of its feature value; a mapping missing from it is shaped without memory
 * (shapeStateless). Each slider target's live position then keeps to one span shared by its mappings, from the lowest
 * of their Range lows to the highest of their highs (`bounds`, as sharedRange).
 * At the default shaping every value is the feature value itself and the range the whole slider, so the result is
 * exactly what it was before shaping existed.
 */
export function modulate(
  base: GeometryParams,
  frame: FeatureFrame,
  mappings: readonly Mapping[],
  jumps: ReadonlyMap<string, number> = NO_VALUES,
  response: ResponseSettings = NEUTRAL_RESPONSE,
  shaped: ReadonlyMap<string, number> = NO_VALUES,
): Modulated {
  const boost = response.melody > 0 ? RESPONSE_LIMITS.melodyBoost * response.melody * featureValue(frame, 'melody') : 0
  // Sum of depth × feature per slider target, in the order targets first appear in the mappings.
  let sums: Map<TargetSpec, number> | null = null
  let seeds: Map<string, number> | null = null
  // Each slider target's shared Range (sharedRange): the lowest low and the highest high among its mappings.
  let spans: Map<TargetSpec, [number, number]> | null = null
  let params = base
  const inactive = new Map<TargetSpec, boolean>()
  for (const mapping of mappings) {
    if (!mapping.enabled || mapping.depth === 0 || !Number.isFinite(mapping.depth)) continue
    const spec = targetById(mapping.target)
    if (!spec) continue
    let off = inactive.get(spec)
    if (off === undefined) inactive.set(spec, (off = spec.inactive(base) !== null))
    if (off) continue
    if (spec.kind === 'jump') {
      if (seeds?.has(spec.id)) continue
      const value = spec.get(base)
      const live = seedAfter(spec, value, jumps.get(spec.id) ?? 0)
      ;(seeds ??= new Map()).set(spec.id, live)
      if (live !== value) params = spec.set(params, live)
      continue
    }
    sums ??= new Map()
    let value = shaped.get(mapping.id) ?? shapeStateless(mapping, frame)
    const follow = (mapping.mode ?? 'follow') === 'follow'
    if (boost > 0 && follow && mapping.feature !== 'melody' && !featuresById.get(mapping.feature)?.bipolar) value = Math.min(1, value + boost)
    sums.set(spec, (sums.get(spec) ?? 0) + mapping.depth * value)
    spans ??= new Map()
    const low = mapping.rangeMin ?? 0
    const high = mapping.rangeMax ?? 1
    const span = spans.get(spec)
    if (!span) spans.set(spec, [low, high])
    else {
      if (low < span[0]) span[0] = low
      if (high > span[1]) span[1] = high
    }
  }
  if (!sums) return { params, positions: NO_VALUES, seeds: seeds ?? NO_VALUES }

  const positions = new Map<string, number>()
  let bounds: Map<string, readonly [number, number]> | null = null
  for (const [spec, added] of sums) {
    const sum = added * response.strength
    const value = spec.get(base)
    const basePosition = spec.toSlider(value)
    // A narrowed Range only: the whole slider leaves the position to fromSlider's own clamp, as before shaping.
    const span = spans?.get(spec)
    const bound = span && (span[0] > 0 || span[1] < 1) ? span : undefined
    if (bound) (bounds ??= new Map()).set(spec.id, bound)
    // Nothing added this frame: keep the slider's value exactly, even when it lies off the step grid.
    if (sum === 0) {
      positions.set(spec.id, basePosition)
      continue
    }
    const live = spec.fromSlider(withinBounds(basePosition + sum, basePosition, bound))
    // Still within the base value's own step (the step its thumb shows): keep the exact slider value,
    // so a value typed between steps does not jump to its neighbour at the faintest sound.
    if (live === value || live === spec.fromSlider(basePosition)) {
      positions.set(spec.id, basePosition)
      continue
    }
    params = spec.set(params, live)
    positions.set(spec.id, spec.toSlider(live))
  }
  return bounds ? { params, positions, seeds: seeds ?? NO_VALUES, bounds } : { params, positions, seeds: seeds ?? NO_VALUES }
}
