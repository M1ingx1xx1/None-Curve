// The Experimental effects, run after the whole Geometry pipeline in a fixed order: Crumple, Ripple, Whorl, Slipstream, Thorn.
// The first four are piecewise-linear warps (see warp.ts) that add vertices only at creases. Within their safe ranges the
// warps are one-to-one, so any combination of them keeps the glyph valid. Beyond them (folds) the letter overlaps itself,
// and the overlaps are merged into clean outlines at the end (see overlaps.ts). After its warp, Slipstream adds trails that
// never cross the letter and cuts it with thin wedges, redrawing the outline (merging any folds so far). Thorn moves a few anchors far out, each
// pulling the letter around it along by a one-to-one warp, and can show the letter through fluted glass (thorn.ts); a
// thorn may cross the letter, so its outlines are merged the same way.

import { crumpleFolds, crumpleIsOn, crumpleWarp } from './crumple'
import { emptyOverlapStats, mergeOverlaps, type OverlapStats } from './overlaps'
import { inkBox, rippleFolds, rippleIsOn, rippleWarp } from './ripple'
import { emptySlipstreamStats, slipstreamFolds, slipstreamIsOn, slipstreamMerges, slipstreamTrailsAndCuts, slipstreamWarp, type SlipstreamStats } from './slipstream'
import { applyThorn, emptyThornStats, thornIsOn, type ThornStats } from './thorn'
import type { ExperimentalParams, PolygonGlyph } from './types'
import { applyWarp, emptyWarpStats, type CreaseMarks, type WarpStats } from './warp'
import { whorlFolds, whorlIsOn, whorlWarp } from './whorl'

export const EXPERIMENTAL_LIMITS = { maxSeed: 999_999 } as const

export interface ExperimentalStats {
  crumple: WarpStats
  ripple: WarpStats
  whorl: WarpStats
  slipstream: SlipstreamStats
  thorn: ThornStats
  /** The merge of overlaps when an effect goes beyond its safe range, Thorn is on, or Slipstream cuts the letters. */
  folds: OverlapStats
}

/** True when the outlines are merged: Thorn is on, so a thorn may cross the letter, or Slipstream cuts the letters. */
export function experimentalMerges(params: ExperimentalParams): boolean {
  return experimentalFolds(params) || thornIsOn(params.thorn) || slipstreamMerges(params.slipstream)
}

/** True when any effect goes beyond its safe range, so the letters fold onto themselves. */
export function experimentalFolds(params: ExperimentalParams): boolean {
  return crumpleFolds(params.crumple) || rippleFolds(params.ripple) || whorlFolds(params.whorl) || slipstreamFolds(params.slipstream)
}

export function applyExperimental(polygon: PolygonGlyph, params: ExperimentalParams): { polygon: PolygonGlyph; stats: ExperimentalStats } {
  const seed = Math.trunc(Number.isFinite(params.seed) ? params.seed : 1) | 0
  const unitsPerEm = polygon.metrics.unitsPerEm > 0 ? polygon.metrics.unitsPerEm : 1000
  const stats: ExperimentalStats = { crumple: emptyWarpStats(), ripple: emptyWarpStats(), whorl: emptyWarpStats(), slipstream: emptySlipstreamStats(), thorn: emptyThornStats(), folds: emptyOverlapStats() }
  // Once one effect folds, the outlines cross, so no effect checks them; they are merged at the end.
  const folds = experimentalFolds(params)
  let result = polygon
  // Which vertices earlier effects added at creases, so a later effect's tidying may remove them too.
  let marks: CreaseMarks | undefined
  if (crumpleIsOn(params.crumple)) {
    // Crumple holds the middle of each glyph's ink box in place, so letters bend without drifting.
    const box = inkBox(result)
    const anchor = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : undefined
    const crumpled = applyWarp(result, (scale) => crumpleWarp(params.crumple, seed, unitsPerEm, scale, polygon.ref.index, anchor), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.crumple, marks } = crumpled)
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
  // True once Slipstream's cuts have redrawn the outline, which merges any folds so far.
  let streamMerged = false
  if (slipstreamBox) {
    const streamed = applyWarp(result, (scale) => slipstreamWarp(params.slipstream, seed, slipstreamBox, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, marks } = streamed)
    const marked = slipstreamTrailsAndCuts(result, params.slipstream, seed, unitsPerEm)
    stats.slipstream = { ...streamed.stats, trails: marked.trails, cuts: marked.cuts }
    if (marked.trails > 0 || marked.merge) {
      result = marked.polygon
      // Trails and the redrawn outline bring vertices of their own: the crease marks no longer line up.
      marks = undefined
    }
    if (marked.merge) {
      stats.folds = marked.merge
      streamMerged = true
    }
  }
  const thorn = thornIsOn(params.thorn)
  // Once Slipstream has merged the folds, the outlines no longer cross, so Thorn's warps are checked again.
  if (thorn) ({ polygon: result, stats: stats.thorn } = applyThorn(result, params.thorn, seed, unitsPerEm, marks, folds && !streamMerged))
  if ((folds && !streamMerged) || stats.thorn.applied) {
    const merged = mergeOverlaps(result)
    result = merged.polygon
    // After Slipstream's cut merge, count both merges' crossings and removed contours.
    stats.folds = streamMerged
      ? { ...merged.stats, crossings: stats.folds.crossings + merged.stats.crossings, removed: stats.folds.removed + merged.stats.removed, contoursIn: stats.folds.contoursIn }
      : merged.stats
  }
  return { polygon: result, stats }
}
