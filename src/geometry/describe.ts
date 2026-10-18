import { reachPercent, reachReadout } from '../state/sliderScales'
import { crumpleIsOn, crumpleLattice } from './crumple'
import { dissolveIsOn } from './dissolve'
import { experimentalFolds } from './experimental'
import { rippleIsOn, rippleRings } from './ripple'
import { slipstreamBands, slipstreamIsOn } from './slipstream'
import { BURST_REACH, THORN_FALLBACK, THORN_LIMITS, thornFlutes, thornIsOn } from './thorn'
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
    // As drawn: below the finest facet the lattice keeps that size and the movement fades out.
    const { facet, fade } = crumpleLattice(c)
    steps.push(`crumple ${Math.round(c.amount * fade * 100)}%, facets ${Math.round(facet * 100)}% em${c.turn ? `, turn ${Math.round(c.turn)}°` : ''}, seed ${experimental.seed}`)
  }
  if (rippleIsOn(experimental.ripple)) {
    const r = experimental.ripple
    const pct = (v: number) => `${Math.round(v * 100)}%`
    // As drawn: below the shortest wavelength the rings keep that spacing and the waves fade out; at 0 there are none.
    const { wavelength, waves } = rippleRings(r)
    const rings = waves > 0 ? `ripple ${pct(r.amount * waves)}, wavelength ${pct(wavelength)} em` : 'ripple no waves'
    steps.push(
      `${rings}, ${r.sides} sides, center ${pct(r.centerX)} / ${pct(r.centerY)}${r.fade > 0 ? `, fade ${pct(r.fade)}` : ''}${r.petals > 0 ? `, petals ${pct(r.petals)}` : ''}${r.reverse === true ? ', reversed' : ''}`,
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
    // As drawn: below the smallest band the bands keep that size and Slip and Gustiness fade out; at 0 it is steady.
    const { gust, fade } = slipstreamBands(w)
    const gusts = fade > 0 ? `slip ${pct(slip * fade)} em, gusts ${pct(gust)} em, gustiness ${pct(w.gustiness * fade)}` : 'steady, no gusts'
    steps.push(
      `slipstream ${pct(w.strength)} toward ${Math.round(w.direction)}°, ${gusts}${marks ? `, ${marks}` : ''}, seed ${experimental.seed}`,
    )
  }
  if (thornIsOn(experimental.thorn)) {
    const s = experimental.thorn
    const pct = (v: number) => `${Math.round(v * 100)}%`
    const root = s.root ?? THORN_FALLBACK.root
    const refraction = s.refraction ?? 0
    // As the Reach slider shows it, and its length in em the same way.
    const reach = `${reachPercent(s.canvasReach)}% canvas${s.canvasEm !== undefined ? ` (about ${reachReadout(s.canvasReach * Math.min(s.canvasEm, THORN_LIMITS.maxReachEm))} em)` : ''}`
    // As drawn: below the narrowest strip the strips keep that width and Refraction fades out; Flute width 0 clears
    // the glass, as Refraction 0 does.
    const { flute, fade } = thornFlutes(s)
    const glass = refraction * fade > 0 ? `, refraction ${pct(refraction * fade)} (flutes ${pct(flute)} em)` : ''
    if (s.burst === true) {
      // Burst: its own spike count and Dent, no roots; its longest spike is BURST_REACH of Reach's length.
      const spikes = s.spikes ?? THORN_FALLBACK.spikes
      const longest = s.canvasEm !== undefined ? ` (longest about ${reachReadout(s.canvasReach * Math.min(s.canvasEm, THORN_LIMITS.maxReachEm) * BURST_REACH)} em)` : ''
      steps.push(
        `thorn burst ×${spikes}${s.reverse === true ? ', reversed' : ''}, reach ${reachPercent(s.canvasReach)}% canvas${longest}, dent ${pct(s.dent ?? THORN_FALLBACK.dent)}, spread ${pct(s.spread)}, width ${pct(s.width)}${glass}, seed ${experimental.seed}`,
      )
    } else {
      steps.push(
        `thorn ×${s.count}${s.reverse === true ? ', reversed' : ''}, reach ${reach}, root ${pct(root)}, spread ${pct(s.spread)}, width ${pct(s.width)}${glass}, seed ${experimental.seed}`,
      )
    }
  }
  if (dissolveIsOn(experimental.dissolve)) {
    const d = experimental.dissolve
    const pct = (v: number) => `${Math.round(v * 100)}%`
    steps.push(
      `dissolve ${pct(d.amount)}, grain ${pct(d.grain)} stroke, spread ${pct(d.spread)}, specks ${pct(d.specks)}, curl ${pct(d.curl)}, facets ${pct(d.facets)}, seed ${experimental.seed}`,
    )
  }
  if (experimentalFolds(experimental)) steps.push('folds merged')
  return steps
}
