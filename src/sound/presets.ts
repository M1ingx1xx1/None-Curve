// Presets for the Sound tab (see docs/SOUND_PLAN.md §7): named sets of mappings with the slider values
// they start from. Load resets the Geometry and Experimental tabs to their defaults, keeping the seeds,
// sets the preset's start values and replaces the mappings (presetSettings), so every preset starts
// from the same readable letters whatever was set before; its rows then need nothing switched on.

import type { ExperimentalParams, GeometryParams } from '../geometry/types'
import { initialState } from '../state/editorState'
import { applyPatches, type Mapping, type ParamPatch } from './mapping'

export interface Preset {
  id: string
  name: string
  /** One short line for the ⓘ explanation. */
  description: string
  /** Slider and switch values Load sets after resetting: only what differs from the defaults (an effect's patch fills in the rest of it). */
  start: readonly ParamPatch[]
  mappings: readonly Omit<Mapping, 'id'>[]
}

/** The groups Load resets: every group of the Geometry and Experimental tabs. */
const RESET_GROUPS = ['flatten', 'random', 'squaring', 'anchors', 'grid', 'distortion', 'experimental'] as const

const DEFAULTS: GeometryParams = initialState.params

type EffectKey = 'crumple' | 'ripple' | 'whorl' | 'slipstream' | 'thorn'

/** The Experimental effects, in panel order, with their names in the Experimental tab. */
const EFFECTS: readonly [EffectKey, string][] = [
  ['crumple', 'Crumple'],
  ['ripple', 'Ripple'],
  ['whorl', 'Whorl'],
  ['slipstream', 'Slipstream'],
  ['thorn', 'Thorn'],
]

const map = (feature: Mapping['feature'], target: string, depth: number): Omit<Mapping, 'id'> => ({
  enabled: true,
  feature,
  target,
  depth,
})

/** Start values for a Geometry group. */
const set = <G extends Exclude<keyof GeometryParams, 'experimental'>>(group: G, patch: Partial<GeometryParams[G]>) =>
  ({ group, patch }) as ParamPatch

/** Start values for an Experimental effect, as the whole effect object: patches merge the experimental group one level deep only. */
const effect = <E extends EffectKey>(key: E, patch: Partial<ExperimentalParams[E]>): ParamPatch => ({
  group: 'experimental',
  patch: { [key]: { ...DEFAULTS.experimental[key], ...patch } } as Partial<ExperimentalParams>,
})

// Most presets keep to the Geometry tab and its default sliders, so the letters stay readable while
// quiet; at most one Experimental effect each. Depth is a share of the slider's travel; on a seed it is Rate.
export const PRESETS: readonly Preset[] = [
  {
    id: 'flicker',
    name: 'Flicker',
    description: 'On every beat a few other anchors jump while the rest hold the letter; louder sound and each beat throw them further.',
    // Only a few seeded anchors move: no control sets this, only this preset. A tiny amplitude, so the Seed row acts while it is quiet.
    start: [set('distortion', { sparse: true, amount: 2, normalBias: 0.9 })],
    mappings: [map('level', 'distortion.amount', 0.9), map('beat', 'distortion.amount', 0.3), map('beat', 'distortion.seed', 1)],
  },
  {
    id: 'scatter',
    name: 'Scatter',
    description: 'Anchors are placed afresh on every other beat: close and even while it is quiet, fewer and further from even as it gets louder.',
    start: [set('random', { enabled: true, density: 10, randomness: 0.05 })],
    mappings: [map('level', 'random.randomness', 0.9), map('level', 'random.density', -0.09), map('beat', 'random.seed', 0.5)],
  },
  {
    id: 'pixel',
    name: 'Pixel',
    description: 'The letters snap to a grid that the bass makes coarser; hiss and cymbals drop anchors.',
    start: [set('grid', { snap: true })],
    mappings: [map('bass', 'grid.size', 0.7), map('treble', 'anchors.simplify', 0.4)],
  },
  {
    id: 'low-poly',
    name: 'Low poly',
    description: 'Loud passages flatten the curves into fewer, longer sides; bright sound drops anchors.',
    // Merged curves, so a large Tolerance reaches whole bowls (each font curve keeps at least one edge otherwise).
    start: [set('flatten', { mergeCurves: true })],
    mappings: [map('level', 'flatten.tolerance', 0.7), map('brightness', 'anchors.simplify', 0.4)],
  },
  {
    id: 'block',
    name: 'Block',
    description: 'The round strokes square off as the music swells, and a little more on each beat.',
    start: [],
    mappings: [map('swell', 'squaring.amount', 0.9), map('beat', 'squaring.amount', 0.3)],
  },
  {
    id: 'jitter',
    name: 'Jitter',
    description: 'Hiss and cymbals make the outlines tremble; brighter sound makes the tremor finer.',
    // A tiny amplitude, so the Noise frequency row acts while it is quiet.
    start: [set('distortion', { amount: 2, frequency: 20 })],
    mappings: [map('treble', 'distortion.amount', 0.6), map('brightness', 'distortion.frequency', 0.3)],
  },
  {
    id: 'facet',
    name: 'Facet',
    description: 'Curves break into a few straight sides as it gets louder and on each beat; higher notes smooth them again.',
    start: [set('flatten', { mode: 'segments', mergeCurves: true, segmentsPerCurve: 6 })],
    mappings: [
      map('level', 'flatten.segmentsPerCurve', -0.15),
      map('beat', 'flatten.segmentsPerCurve', -0.05),
      map('pitch', 'flatten.segmentsPerCurve', 0.2),
    ],
  },
  {
    id: 'bloom',
    name: 'Bloom',
    description: 'Ripples run through the letters and swell on each beat; the bass bends them into petals.',
    start: [effect('ripple', { enabled: true, amount: 0.3 })],
    // Petals change a letter's shape fast: 10% once the bass is up (20% is hard to read).
    mappings: [map('beat', 'experimental.ripple.amount', 0.1), map('bass', 'experimental.ripple.petals', 0.05)],
  },
  {
    id: 'flare',
    name: 'Flare',
    description: 'Thorns shoot out of a few anchors per letter as it gets louder; on every beat they jump somewhere new and briefly multiply.',
    // Reach 0: no thorns (and no root pull) while it is quiet. A shallower root keeps the strokes readable.
    start: [effect('thorn', { enabled: true, count: 1, canvasReach: 0, root: 0.25 })],
    mappings: [
      map('beat', 'experimental.seed', 1),
      // Half the cubic Reach slider at full level: an eighth of the canvas diagonal (about 4 em on the default canvas).
      map('level', 'experimental.thorn.canvasReach', 0.5),
      map('beat', 'experimental.thorn.count', 0.15),
    ],
  },
  {
    id: 'gale',
    name: 'Gale',
    description: 'Loudness slides slices of the letters past each other; beats cut slits along the stream and busy passages draw trails.',
    // Nothing streams while it is quiet. No stretch: it pushes letters into their neighbours.
    start: [effect('slipstream', { enabled: true, strength: 0, slip: 0, cuts: 0, trails: 0 })],
    mappings: [
      map('level', 'experimental.slipstream.slip', 0.5),
      map('beat', 'experimental.slipstream.cuts', 0.4),
      map('activity', 'experimental.slipstream.trails', 0.35),
    ],
  },
]

/** What Load does with the current settings: the settings, their changes and what to tell the user. */
export interface PresetSettings {
  /** The settings after Load: every Geometry and Experimental group reset (seeds kept), then the preset's start. */
  params: GeometryParams
  /** The groups that changed, each as the whole group object, ready for the editor's updateParams action. */
  patches: readonly ParamPatch[]
  /**
   * "Loaded Flicker." and what was turned off ("Turned off Crumple and Ripple.", "Turned off Random
   * anchors."), then whether any other setting the preset does not set went back to its default.
   */
  notice: string
}

/** A setting's path in the params, e.g. ['experimental', 'crumple', 'amount']. */
type Path = readonly string[]

/** Every setting Load resets, from the defaults' shape. */
const SETTINGS: readonly Path[] = RESET_GROUPS.flatMap((group) => leaves(DEFAULTS[group], [group]))

function leaves(value: unknown, path: Path): Path[] {
  if (typeof value !== 'object' || value === null) return [path]
  return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]))
}

function read(params: GeometryParams, path: Path): unknown {
  let value: unknown = params
  for (const key of path) value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
  return value
}

/** The switches the notice names when Load turns them off. */
const NAMED_SWITCHES = new Set(['random.enabled', ...EFFECTS.map(([key]) => `experimental.${key}.enabled`)])

const same = (a: unknown, b: unknown) => a === b || (Number.isNaN(a) && Number.isNaN(b))

/** "Crumple", "Crumple and Ripple", "Crumple, Ripple and Whorl". */
function listNames(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('')
}

/**
 * Loading `preset` over the `current` settings: every Geometry and Experimental group goes back to its
 * default, keeping the three seeds, and the preset's start values are set on top. Pure; the Sound tab
 * dispatches the patches and replaces the mappings.
 */
export function presetSettings(current: GeometryParams, preset: Preset): PresetSettings {
  const reset: GeometryParams = {
    ...current,
    flatten: DEFAULTS.flatten,
    random: { ...DEFAULTS.random, seed: current.random.seed },
    squaring: DEFAULTS.squaring,
    anchors: DEFAULTS.anchors,
    grid: DEFAULTS.grid,
    distortion: { ...DEFAULTS.distortion, seed: current.distortion.seed },
    experimental: { ...DEFAULTS.experimental, seed: current.experimental.seed },
  }
  const params = applyPatches(reset, preset.start)
  const patches = RESET_GROUPS.filter((group) =>
    SETTINGS.some((path) => path[0] === group && !same(read(current, path), read(params, path))),
  ).map((group) => ({ group, patch: params[group] }) as ParamPatch)

  // A setting missing from older settings reads as its default here; the panel may show it at the target's fallback
  // instead (Slipstream's Slip, Cuts and Trails show 0).
  const before = (path: Path) => read(current, path) ?? read(DEFAULTS, path)
  const turnedOff = (path: Path) => before(path) === true && read(params, path) === false
  const effects = EFFECTS.filter(([key]) => turnedOff(['experimental', key, 'enabled'])).map(([, name]) => name)
  const randomOff = turnedOff(['random', 'enabled'])
  // Any other setting back at its default that was not: the switches named above are left out, and so is
  // everything the preset sets (it differs from the reset).
  const othersReset = SETTINGS.some(
    (path) =>
      !NAMED_SWITCHES.has(path.join('.')) && same(read(params, path), read(reset, path)) && !same(before(path), read(params, path)),
  )
  const notice = [
    `Loaded ${preset.name}.`,
    effects.length ? `Turned off ${listNames(effects)}.` : '',
    randomOff ? 'Turned off Random anchors.' : '',
    othersReset ? 'Other Geometry and Experimental settings back to defaults (seeds kept).' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return { params, patches, notice }
}
