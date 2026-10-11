// Presets for the Sound tab: named sets of mappings to start from (see docs/SOUND_PLAN.md §7). Loading
// one replaces the mappings; the Sound tab then switches on what their targets need, as when a target
// is picked by hand.

import type { Mapping } from './mapping'

export interface Preset {
  id: string
  name: string
  /** One short line for the ⓘ explanation. */
  description: string
  mappings: readonly Omit<Mapping, 'id'>[]
}

const map = (feature: Mapping['feature'], target: string, depth: number): Omit<Mapping, 'id'> => ({
  enabled: true,
  feature,
  target,
  depth,
})

export const PRESETS: readonly Preset[] = [
  {
    id: 'anchor-jump',
    name: 'Anchor jump',
    description: 'Anchors jump to new places on every beat and shake harder when it is loud.',
    mappings: [map('beatPulse', 'distortion.seed', 1), map('level', 'distortion.amount', 0.3)],
  },
  {
    id: 'resample',
    name: 'Resample',
    description: 'Random anchors are drawn again on every beat; the bass adds more of them.',
    mappings: [map('beatPulse', 'random.seed', 1), map('bass', 'random.density', 0.3)],
  },
  {
    id: 'bass-bloom',
    name: 'Bass bloom',
    description: 'Ripples kick out on the bass drum; petals open with the bass.',
    mappings: [map('kickPulse', 'experimental.ripple.amount', 0.4), map('bass', 'experimental.ripple.petals', 0.5)],
  },
  {
    id: 'shiver',
    name: 'Shiver',
    description: 'Hiss and cymbals crumple the letters; brightness turns the folds; every other beat reshuffles them.',
    mappings: [
      map('high', 'experimental.noise.amount', 0.3),
      map('brightness', 'experimental.noise.turn', 0.5),
      map('beatPulse', 'experimental.seed', 0.5),
    ],
  },
  {
    id: 'whirl',
    name: 'Whirl',
    description: 'The letters swirl as the music swells and twist further on each kick.',
    mappings: [map('swell', 'experimental.curl.amount', 0.2), map('kickPulse', 'experimental.curl.amount', 0.15)],
  },
  {
    id: 'gale',
    name: 'Gale',
    description: 'Loudness drags the letters out; busy passages make the gusts uneven; every other beat brings new gusts.',
    mappings: [
      map('level', 'experimental.wind.strength', 0.3),
      map('pace', 'experimental.wind.gustiness', 0.5),
      map('beatPulse', 'experimental.seed', 0.5),
    ],
  },
  {
    id: 'grid-pulse',
    name: 'Grid pulse',
    description: 'The bass snaps the letters to a coarser grid; loudness squares off the bowls.',
    mappings: [map('bass', 'grid.size', 0.3), map('level', 'squaring.amount', 0.5)],
  },
  {
    id: 'low-poly',
    name: 'Low poly',
    description: 'Loud passages get coarser and more angular; noisy sound drops anchors.',
    mappings: [map('level', 'flatten.tolerance', 0.3), map('noisiness', 'anchors.simplify', 0.2)],
  },
  {
    id: 'drift',
    name: 'Drift',
    description: 'Ripples follow the sound from left to right; higher notes give more sides.',
    mappings: [map('balance', 'experimental.ripple.centerX', 0.4), map('pitch', 'experimental.ripple.sides', 0.5)],
  },
]
