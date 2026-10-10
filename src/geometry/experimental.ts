// The Experimental effects, run after the whole Geometry pipeline in a fixed order: Noise, Ripple, Wind. Each is a one-to-one piecewise-linear warp (see warp.ts), so any
// combination of them keeps the glyph valid, and each adds vertices only at creases.

import { noiseIsOn, noiseWarp } from './noise'
import { inkBox, rippleIsOn, rippleWarp } from './ripple'
import { windIsOn, windWarp } from './wind'
import type { ExperimentalParams, PolygonGlyph } from './types'
import { applyWarp, emptyWarpStats, type CreaseMarks, type WarpStats } from './warp'

export const EXPERIMENTAL_LIMITS = { maxSeed: 999_999 } as const

export interface ExperimentalStats {
  noise: WarpStats
  ripple: WarpStats
  wind: WarpStats
}

export function applyExperimental(polygon: PolygonGlyph, params: ExperimentalParams): { polygon: PolygonGlyph; stats: ExperimentalStats } {
  const seed = Math.trunc(Number.isFinite(params.seed) ? params.seed : 1) | 0
  const unitsPerEm = polygon.metrics.unitsPerEm > 0 ? polygon.metrics.unitsPerEm : 1000
  const stats: ExperimentalStats = { noise: emptyWarpStats(), ripple: emptyWarpStats(), wind: emptyWarpStats() }
  let result = polygon
  // Which vertices earlier effects added at creases, so a later effect's tidying may remove them too.
  let marks: CreaseMarks | undefined
  if (noiseIsOn(params.noise)) {
    const noised = applyWarp(result, (scale) => noiseWarp(params.noise, seed, unitsPerEm, scale), unitsPerEm, marks)
    ;({ polygon: result, stats: stats.noise, marks } = noised)
  }
  // Ripple and Wind place themselves by the ink box of what they receive, so the same letter always
  // looks alike.
  const rippleBox = rippleIsOn(params.ripple) ? inkBox(result) : null
  if (rippleBox) {
    const rippled = applyWarp(result, (scale) => rippleWarp(params.ripple, rippleBox, unitsPerEm, scale), unitsPerEm, marks)
    ;({ polygon: result, stats: stats.ripple, marks } = rippled)
  }
  const windBox = windIsOn(params.wind) ? inkBox(result) : null
  if (windBox) {
    const blown = applyWarp(result, (scale) => windWarp(params.wind, seed, windBox, unitsPerEm, scale), unitsPerEm, marks)
    ;({ polygon: result, stats: stats.wind, marks } = blown)
  }
  return { polygon: result, stats }
}
