// The Experimental effects, run after the whole Geometry pipeline in a fixed order: Noise, Ripple, Curl, Wind. Each is a
// piecewise-linear warp (see warp.ts) that adds vertices only at creases. Within their safe ranges the warps are one-to-one,
// so any combination of them keeps the glyph valid. Beyond them (folds) the letter overlaps itself, and the overlaps are
// merged into clean outlines at the end (see overlaps.ts).

import { curlFolds, curlIsOn, curlWarp } from './curl'
import { noiseFolds, noiseIsOn, noiseWarp } from './noise'
import { emptyOverlapStats, mergeOverlaps, type OverlapStats } from './overlaps'
import { inkBox, rippleFolds, rippleIsOn, rippleWarp } from './ripple'
import { windFolds, windIsOn, windWarp } from './wind'
import type { ExperimentalParams, PolygonGlyph } from './types'
import { applyWarp, emptyWarpStats, type CreaseMarks, type WarpStats } from './warp'

export const EXPERIMENTAL_LIMITS = { maxSeed: 999_999 } as const

export interface ExperimentalStats {
  noise: WarpStats
  ripple: WarpStats
  curl: WarpStats
  wind: WarpStats
  /** The merge of overlaps when an effect goes beyond its safe range. */
  folds: OverlapStats
}

/** True when any effect goes beyond its safe range, so the letters fold onto themselves. */
export function experimentalFolds(params: ExperimentalParams): boolean {
  return noiseFolds(params.noise) || rippleFolds(params.ripple) || curlFolds(params.curl) || windFolds(params.wind)
}

export function applyExperimental(polygon: PolygonGlyph, params: ExperimentalParams): { polygon: PolygonGlyph; stats: ExperimentalStats } {
  const seed = Math.trunc(Number.isFinite(params.seed) ? params.seed : 1) | 0
  const unitsPerEm = polygon.metrics.unitsPerEm > 0 ? polygon.metrics.unitsPerEm : 1000
  const stats: ExperimentalStats = { noise: emptyWarpStats(), ripple: emptyWarpStats(), curl: emptyWarpStats(), wind: emptyWarpStats(), folds: emptyOverlapStats() }
  // Once one effect folds, the outlines cross, so no effect checks them; they are merged at the end.
  const folds = experimentalFolds(params)
  let result = polygon
  // Which vertices earlier effects added at creases, so a later effect's tidying may remove them too.
  let marks: CreaseMarks | undefined
  if (noiseIsOn(params.noise)) {
    const noised = applyWarp(result, (scale) => noiseWarp(params.noise, seed, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.noise, marks } = noised)
  }
  // Ripple, Curl, and Wind place themselves by the ink box of what they receive, so the same letter
  // always looks alike.
  const rippleBox = rippleIsOn(params.ripple) ? inkBox(result) : null
  if (rippleBox) {
    const rippled = applyWarp(result, (scale) => rippleWarp(params.ripple, rippleBox, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.ripple, marks } = rippled)
  }
  const curlBox = curlIsOn(params.curl) ? inkBox(result) : null
  if (curlBox) {
    const curled = applyWarp(result, (scale) => curlWarp(params.curl, curlBox, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.curl, marks } = curled)
  }
  const windBox = windIsOn(params.wind) ? inkBox(result) : null
  if (windBox) {
    const blown = applyWarp(result, (scale) => windWarp(params.wind, seed, windBox, unitsPerEm, scale), unitsPerEm, marks, folds)
    ;({ polygon: result, stats: stats.wind, marks } = blown)
  }
  if (folds) ({ polygon: result, stats: stats.folds } = mergeOverlaps(result))
  return { polygon: result, stats }
}
