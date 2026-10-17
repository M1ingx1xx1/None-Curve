import { reachPercent, reachReadout } from '../state/sliderScales'
import { crumpleIsOn } from './crumple'
import { experimentalFolds } from './experimental'
import { rippleIsOn } from './ripple'
import { slipstreamIsOn } from './slipstream'
import { THORN_FALLBACK, THORN_LIMITS, thornIsOn } from './thorn'
import type { GeometryParams } from './types'
import { whorlIsOn } from './whorl'

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
      `distortion ${distortion.amount} u${distortion.sparse ? ', few anchors' : ''}, frequency ${distortion.frequency}, bias ${Math.round(distortion.normalBias * 100)}%, seed ${distortion.seed}`,
    )
  }
  if (crumpleIsOn(experimental.crumple)) {
    const c = experimental.crumple
    steps.push(`crumple ${Math.round(c.amount * 100)}%, facets ${Math.round(c.facet * 100)}% em${c.turn ? `, turn ${Math.round(c.turn)}°` : ''}, seed ${experimental.seed}`)
  }
  if (rippleIsOn(experimental.ripple)) {
    const r = experimental.ripple
    const pct = (v: number) => `${Math.round(v * 100)}%`
    steps.push(
      `ripple ${pct(r.amount)}, wavelength ${pct(r.wavelength)} em, ${r.sides} sides, center ${pct(r.centerX)} / ${pct(r.centerY)}${r.fade > 0 ? `, fade ${pct(r.fade)}` : ''}${r.petals > 0 ? `, petals ${pct(r.petals)}` : ''}${r.reverse === true ? ', reversed' : ''}`,
    )
  }
  if (whorlIsOn(experimental.whorl)) {
    const c = experimental.whorl
    steps.push(`whorl ${Math.round(c.amount * 100)}% (${c.pinned ? 'pinned' : 'whole'}), ${c.rings} rings, ${c.sides} sides`)
  }
  if (slipstreamIsOn(experimental.slipstream)) {
    const w = experimental.slipstream
    const pct = (v: number) => `${Math.round(v * 100)}%`
    // Older saved settings have no slip, cuts or trails.
    const slip = Number.isFinite(w.slip) ? w.slip : 0
    const count = (n: number, word: string) => (n >= 0.5 ? `${Math.round(n)} ${word}${Math.round(n) === 1 ? '' : 's'}` : '')
    const marks = [count(w.cuts, 'cut'), count(w.trails, 'trail')].filter(Boolean).join(', ')
    steps.push(
      `slipstream ${pct(w.strength)} toward ${Math.round(w.direction)}°, slip ${pct(slip)} em, gusts ${pct(w.gust)} em, gustiness ${pct(w.gustiness)}${marks ? `, ${marks}` : ''}, seed ${experimental.seed}`,
    )
  }
  if (thornIsOn(experimental.thorn)) {
    const s = experimental.thorn
    const pct = (v: number) => `${Math.round(v * 100)}%`
    const root = s.root ?? THORN_FALLBACK.root
    const refraction = s.refraction ?? 0
    const back = s.back ?? 0
    const dent = s.dent ?? 0
    // As the Reach slider shows it, and its length in em the same way.
    const reach = `${reachPercent(s.canvasReach)}% canvas${s.canvasEm !== undefined ? ` (about ${reachReadout(s.canvasReach * Math.min(s.canvasEm, THORN_LIMITS.maxReachEm))} em)` : ''}`
    steps.push(
      `thorn ×${s.count}${s.reverse === true ? ', reversed' : ''}, reach ${reach}, root ${pct(root)}, spread ${pct(s.spread)}, width ${pct(s.width)}${back > 0 ? `, back thorns ${pct(back)}` : ''}${dent > 0 ? `, dent ${pct(dent)}` : ''}${refraction > 0 ? `, refraction ${pct(refraction)} (flutes ${pct(s.flute ?? THORN_FALLBACK.flute)} em)` : ''}, seed ${experimental.seed}`,
    )
  }
  if (experimentalFolds(experimental)) steps.push('folds merged')
  return steps
}
