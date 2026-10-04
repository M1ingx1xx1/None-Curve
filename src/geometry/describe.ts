import type { GeometryParams } from './types'

/** Human-readable list of the active pipeline steps, in pipeline order. */
export function describePipeline(params: GeometryParams): string[] {
  const { flatten, random, squaring, anchors, grid, distortion } = params
  const steps = [
    flatten.mode === 'adaptive'
      ? `adaptive, tolerance ${flatten.tolerance} u`
      : flatten.mergeCurves
        ? `${flatten.segmentsPerCurve} segments/merged curve (break at ${flatten.breakAt === 'extrema' ? 'corners & extremes' : 'corners'}, ${flatten.cornerAngle}°${flatten.mergeLines ? ', through lines' : ''})`
        : `${flatten.segmentsPerCurve} segments/curve`,
  ]
  if (random.enabled) {
    steps.push(
      `random anchors ${random.density}/1000 u, randomness ${Math.round(random.randomness * 100)}%${random.keepCorners ? ', corners kept' : ''}, seed ${random.seed}`,
    )
  }
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
