import type { GeometryParams } from './types'

/** Human-readable list of the active pipeline steps, in pipeline order. */
export function describePipeline(params: GeometryParams): string[] {
  const { flatten, random, squaring, anchors, grid, distortion } = params
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
  return steps
}
