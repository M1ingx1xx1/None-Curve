import { noiseIsOn } from './noise'
import { rippleIsOn } from './ripple'
import { windIsOn } from './wind'
import type { GeometryParams } from './types'

/** Human-readable list of the active pipeline steps, in pipeline order. */
export function describePipeline(params: GeometryParams): string[] {
  const { flatten, random, squaring, anchors, grid, distortion, experimental } = params
  const merge = flatten.mergeCurves
    ? `merged, break at ${flatten.breakAt === 'extrema' ? 'corners & extremes' : 'corners'}, ${flatten.cornerAngle}°${flatten.mergeLines ? ', through lines' : ''}`
    : null
  const steps = [
    // Random anchors replace Flatten's sampling, so only one of the two is listed.
    random.enabled
      ? `random anchors ${random.density}/1000 u, randomness ${Math.round(random.randomness * 100)}%${random.keepCorners ? ', corners kept' : ''}${random.randomness > 0 ? `, seed ${random.seed}` : ''}`
      : flatten.mode === 'adaptive'
        ? `adaptive, tolerance ${flatten.tolerance} u${merge ? ` (${merge})` : ''}`
        : merge
          ? `${flatten.segmentsPerCurve} segments/merged curve (${merge.replace('merged, ', '')})`
          : `${flatten.segmentsPerCurve} segments/curve`,
  ]
  if (squaring.amount > 0) steps.push(`squaring ${Math.round(squaring.amount * 100)}%${squaring.scope === 'all' ? ' (all contours)' : ''}`)
  if (anchors.spacing > 0) steps.push(`spacing ${anchors.spacing} u`)
  if (anchors.simplify > 0) steps.push(`reduction ${anchors.simplify} u`)
  if (grid.snap && grid.size > 0) steps.push(`grid ${grid.size} u`)
  if (grid.angleLock) steps.push(`angle lock ${grid.angleStep}°`)
  if (distortion.amount > 0) {
    steps.push(
      `distortion ${distortion.amount} u, frequency ${distortion.frequency}, bias ${Math.round(distortion.normalBias * 100)}%, seed ${distortion.seed}`,
    )
  }
  if (noiseIsOn(experimental.noise)) {
    steps.push(`noise ${Math.round(experimental.noise.amount * 100)}%, facets ${Math.round(experimental.noise.facet * 100)}% em, seed ${experimental.seed}`)
  }
  if (rippleIsOn(experimental.ripple)) {
    const r = experimental.ripple
    const pct = (v: number) => `${Math.round(v * 100)}%`
    steps.push(
      `ripple ${pct(r.amount)}, wavelength ${pct(r.wavelength)} em, ${r.sides} sides, center ${pct(r.centerX)} / ${pct(r.centerY)}${r.fade > 0 ? `, fade ${pct(r.fade)}` : ''}`,
    )
  }
  if (windIsOn(experimental.wind)) {
    const w = experimental.wind
    const pct = (v: number) => `${Math.round(v * 100)}%`
    steps.push(`wind ${pct(w.strength)} toward ${Math.round(w.direction)}°, gusts ${pct(w.gust)} em, gustiness ${pct(w.gustiness)}, seed ${experimental.seed}`)
  }
  return steps
}
