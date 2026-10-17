// The Experimental effects, run after the whole Geometry pipeline in a fixed order: Crumple, Ripple, Whorl, Slipstream, Thorn.
// The first four are piecewise-linear warps (see warp.ts) that add vertices only at creases. Within their safe ranges the
// warps are one-to-one, so any combination of them keeps the glyph valid. Beyond them (folds) the letter overlaps itself,
// and the overlaps are merged into clean outlines at the end (see overlaps.ts). Thorn moves a few anchors far out
// (thorn.ts); a thorn may cross the letter, so its outlines are merged the same way.

import { whorlFolds, whorlIsOn, whorlWarp } from './whorl'
import { crumpleFolds, crumpleIsOn, crumpleWarp } from './crumple'
import { emptyOverlapStats, mergeOverlaps, type OverlapStats } from './overlaps'
import { inkBox, rippleFolds, rippleIsOn, rippleWarp } from './ripple'
import { applyThorns, emptyThornStats, thornIsOn, type ThornStats } from './thorn'
import { slipstreamFolds, slipstreamIsOn, slipstreamWarp } from './slipstream'
import type { ExperimentalParams, PolygonGlyph } from './types'
import { applyWarp, emptyWarpStats, type CreaseMarks, type WarpStats } from './warp'

export const EXPERIMENTAL_LIMITS = { maxSeed: 999_999 } as const

export interface ExperimentalStats {
  crumple: WarpStats
  ripple: WarpStats
  whorl: WarpStats
  slipstream: WarpStats
  thorn: ThornStats
  /** The merge of overlaps when an effect goes beyond its safe range, or Thorn is on. */
  folds: OverlapStats
}

/** True when the outlines are merged at the end: Thorn is on, so a thorn may cross the letter. */
export function experimentalMerges(params: ExperimentalParams): boolean {
  return experimentalFolds(params) || thornIsOn(params.thorn)
}

/** True when any effect goes beyond its safe range, so the letters fold onto themselves. */
export function experimentalFolds(params: ExperimentalParams): boolean {
  return crumpleFolds(params.crumple) || rippleFolds(params.ripple) || whorlFolds(params.whorl) || slipstreamFolds(params.slipstream)
}

export function applyExperimental(polygon: PolygonGlyph, params: ExperimentalParams): { polygon: PolygonGlyph; stats: ExperimentalStats } {
  const seed = Math.trunc(Number.isFinite(params.seed) ? params.seed : 1) | 0
  const unitsPerEm = polygon.metrics.unitsPerEm > 0 ? polygon.metrics.unitsPerEm : 1000
  const stats: ExperimentalStats = { crumple: emptyWarpStats(), ripple: emptyWarpStats(), whorl: emptyWarpStats(), slipstream: emptyWarpStats(), thorn: emptyThornStats(), folds: emptyOverlapStats() }
  // Once one effect folds, the outlines cross, so no effect checks them; they are merged at the end.
  const folds = experimentalFolds(params)
  let result = polygon
  // Which vertices earlier effects added at creases, so a later effect's tidying may remove them too.
  let marks: CreaseMarks | undefined
  if (crumpleIsOn(params.crumple)) {
    const noised = applyWarp(result, (scale) => crumpleWarp(params.crumple, seed, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.crumple, marks } = noised)
  }
  // Ripple, Whorl, and Slipstream place themselves by the ink box of what they receive, so the same letter
  // always looks alike.
  const rippleBox = rippleIsOn(params.ripple) ? inkBox(result) : null
  if (rippleBox) {
    const rippled = applyWarp(result, (scale) => rippleWarp(params.ripple, rippleBox, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.ripple, marks } = rippled)
  }
  const whorlBox = whorlIsOn(params.whorl) ? inkBox(result) : null
  if (whorlBox) {
    const whorled = applyWarp(result, (scale) => whorlWarp(params.whorl, whorlBox, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.whorl, marks } = whorled)
  }
  const slipstreamBox = slipstreamIsOn(params.slipstream) ? inkBox(result) : null
  if (slipstreamBox) {
    const blown = applyWarp(result, (scale) => slipstreamWarp(params.slipstream, seed, slipstreamBox, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.slipstream, marks } = blown)
  }
  const thorns = thornIsOn(params.thorn)
  if (thorns) ({ polygon: result, stats: stats.thorn } = applyThorns(result, params.thorn, seed, unitsPerEm))
  if (folds || stats.thorn.applied) ({ polygon: result, stats: stats.folds } = mergeOverlaps(result))
  return { polygon: result, stats }
}
