// Parameter sets the geometry tests run: the app's defaults, each Experimental effect on its own, all five, and the
// strongest settings the sliders reach (SLIDER_RANGES), on plain, dense and heavy Geometry.

import { THORN_LIMITS } from '../../src/geometry/thorn'
import type { ExperimentalParams, GeometryParams } from '../../src/geometry/types'
import { initialState } from '../../src/state/editorState'
import { SLIDER_RANGES, type SliderId } from '../../src/state/sliderScales'

const { flatten, random, squaring, anchors, grid, distortion, experimental } = initialState.params

/** The app's default Geometry and Experimental settings (every effect off). */
export const BASE: GeometryParams = { flatten, random, squaring, anchors, grid, distortion, experimental }

export const EFFECTS = ['crumple', 'ripple', 'whorl', 'slipstream', 'thorn'] as const
export type Effect = (typeof EFFECTS)[number]

type EffectPatch = Partial<Pick<ExperimentalParams, Effect>>

/** The effect switched on with its default settings, changed by `patch`. */
export function on<E extends Effect>(effect: E, patch: Partial<ExperimentalParams[E]> = {}): EffectPatch {
  return { [effect]: { ...experimental[effect], enabled: true, ...patch } } as EffectPatch
}

const top = (id: SliderId) => SLIDER_RANGES[id].max
const bottom = (id: SliderId) => SLIDER_RANGES[id].min

/** Each effect at the ends of its sliders that make the most vertices (the finest meshes, the most thorns and cuts). */
export const SLIDER_MAX: Record<Effect, EffectPatch> = {
  crumple: on('crumple', {
    amount: top('experimental.crumple.amount'),
    facet: bottom('experimental.crumple.facet'),
  }),
  ripple: on('ripple', {
    amount: top('experimental.ripple.amount'),
    wavelength: bottom('experimental.ripple.wavelength'),
    sides: top('experimental.ripple.sides'),
    petals: top('experimental.ripple.petals'),
  }),
  whorl: on('whorl', {
    amount: top('experimental.whorl.amount'),
    rings: top('experimental.whorl.rings'),
    sides: top('experimental.whorl.sides'),
  }),
  slipstream: on('slipstream', {
    strength: top('experimental.slipstream.strength'),
    gust: bottom('experimental.slipstream.gust'),
    gustiness: top('experimental.slipstream.gustiness'),
    slip: top('experimental.slipstream.slip'),
    cuts: top('experimental.slipstream.cuts'),
    trails: top('experimental.slipstream.trails'),
  }),
  // Reach at 100%: the whole diagonal of the default canvas (about 30 em), as the app gives it while Thorn is on.
  thorn: on('thorn', {
    count: top('experimental.thorn.count'),
    canvasReach: 1,
    canvasEm: THORN_LIMITS.defaultCanvasEm,
    spread: top('experimental.thorn.spread'),
    width: top('experimental.thorn.width'),
    root: top('experimental.thorn.root'),
    back: top('experimental.thorn.back'),
    dent: top('experimental.thorn.dent'),
    refraction: top('experimental.thorn.refraction'),
    flute: bottom('experimental.thorn.flute'),
  }),
}

/** Thorn at slider max on the largest canvas in em that Reach spans (THORN_LIMITS.maxReachEm: 256 em). */
export const THORN_FARTHEST: EffectPatch = on('thorn', { ...SLIDER_MAX.thorn.thorn, canvasEm: THORN_LIMITS.maxReachEm })

export const ALL_DEFAULT: EffectPatch = Object.assign({}, ...EFFECTS.map((e) => on(e)))
export const ALL_MAX: EffectPatch = Object.assign({}, ...EFFECTS.map((e) => SLIDER_MAX[e]))

/** Geometry variants under the effects: as it comes, dense (an anchor every 5 units), heavy (squared, snapped, distorted). */
export const GEOMETRY: Record<'plain' | 'dense' | 'heavy' | 'spacing1', Partial<GeometryParams>> = {
  plain: {},
  dense: { anchors: { spacing: 5, simplify: 0 } },
  heavy: {
    squaring: { amount: 1, scope: 'all' },
    grid: { snap: true, size: 50, angleLock: true, angleStep: 15 },
    distortion: { ...distortion, amount: 30 },
  },
  spacing1: { anchors: { spacing: 1, simplify: 0 } },
}

/** Settings with this Geometry variant and these effects (seed 1 unless given). */
export function paramsWith(geometry: Partial<GeometryParams>, effects: EffectPatch, seed = 1): GeometryParams {
  return { ...BASE, ...geometry, experimental: { ...experimental, seed, ...effects } }
}

/** The same settings with every Experimental effect off. */
export function withoutEffects(params: GeometryParams): GeometryParams {
  const x = params.experimental
  return {
    ...params,
    experimental: {
      ...x,
      crumple: { ...x.crumple, enabled: false },
      ripple: { ...x.ripple, enabled: false },
      whorl: { ...x.whorl, enabled: false },
      slipstream: { ...x.slipstream, enabled: false },
      thorn: { ...x.thorn, enabled: false },
    },
  }
}
