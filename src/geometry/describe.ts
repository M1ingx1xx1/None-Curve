import type { GeometryParams } from './types'

/** Human-readable list of the active pipeline steps, in pipeline order. */
export function describePipeline(params: GeometryParams): string[] {
  const { flatten, anchors, grid, distortion } = params
  const steps = [
    flatten.mode === 'adaptive' ? `adaptive, tolerance ${flatten.tolerance} u` : `${flatten.segmentsPerCurve} segments/curve`,
  ]
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
