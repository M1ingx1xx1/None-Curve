// The Experimental effects, run after the whole Geometry pipeline in a fixed order: Crumple, Ripple, Whorl, Slipstream, Thorn.
// The first four are piecewise-linear warps (see warp.ts) that add vertices only at creases. Within their safe ranges the
// warps are one-to-one, so any combination of them keeps the glyph valid. Beyond them (folds) the letter overlaps itself,
// and the overlaps are merged into clean outlines at the end (see overlaps.ts). After its warp, Slipstream adds trails that
// never cross the letter and cuts it with thin wedges, redrawing the outline (merging any folds so far). Thorn moves a few anchors far out, each
// pulling the letter around it along by a one-to-one warp, and can show the letter through fluted glass (thorn.ts); a
// thorn may cross the letter, so its outlines are merged the same way; layout measures the letter as it was before
// Thorn (PolygonGlyph.layoutBox and layoutHull), so thorns never move the text. Each glyph has a vertex budget (budget.ts): one
// that grows beyond it is simplified, and merged afterwards.

import { GlyphBudget, type BudgetStats } from './budget'
import { crumpleFolds, crumpleIsOn, crumpleWarp } from './crumple'
import { emptyOverlapStats, type OverlapStats } from './overlaps'
import { inkBox, rippleFolds, rippleIsOn, rippleWarp } from './ripple'
import { emptySlipstreamStats, slipstreamFolds, slipstreamIsOn, slipstreamMerges, slipstreamTrailsAndCuts, slipstreamWarp, type SlipstreamStats } from './slipstream'
import { applyThorn, emptyThornStats, thornIsOn, type ThornStats } from './thorn'
import type { ExperimentalParams, Point, PolygonGlyph } from './types'
import { applyWarp, emptyWarpStats, type CreaseMarks, type WarpStats } from './warp'
import { whorlFolds, whorlIsOn, whorlWarp } from './whorl'

export const EXPERIMENTAL_LIMITS = {
  maxSeed: 999_999,
  /**
   * The vertex budget (see budget.ts), on top of the vertices the glyph brings in, so dense Geometry is never cut: at
   * most this many vertices more after any effect, and this many grid points (vertices and crossings) more in a merge.
   * No single effect reaches them, even at the ends of its sliders; only several dense ones together do.
   */
  maxAddedVertices: 6000,
  maxMergePoints: 30_000,
} as const

export interface ExperimentalStats {
  crumple: WarpStats
  ripple: WarpStats
  whorl: WarpStats
  slipstream: SlipstreamStats
  thorn: ThornStats
  /** The merge of overlaps when an effect goes beyond its safe range, Thorn is on, Slipstream cuts the letters, or the glyph was simplified. */
  folds: OverlapStats
  /** Whether the glyph was simplified to stay within its vertex budget. */
  budget: BudgetStats
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
  const vertices = polygon.contours.reduce((n, c) => n + c.points.length, 0)
  const budget = new GlyphBudget(vertices + EXPERIMENTAL_LIMITS.maxAddedVertices, vertices + EXPERIMENTAL_LIMITS.maxMergePoints, unitsPerEm)
  const stats: ExperimentalStats = {
    crumple: emptyWarpStats(),
    ripple: emptyWarpStats(),
    whorl: emptyWarpStats(),
    slipstream: emptySlipstreamStats(),
    thorn: emptyThornStats(),
    folds: emptyOverlapStats(),
    budget: budget.stats,
  }
  // Once one effect folds, the outlines cross, so no effect checks them; they are merged at the end.
  const folds = experimentalFolds(params)
  // True while the outlines may cross: an effect folds the letter, or the budget simplified it.
  let tangled = folds
  let result = polygon
  // Which vertices earlier effects added at creases, so a later effect's tidying may remove them too.
  let marks: CreaseMarks | undefined
  // Keeps the glyph within its vertex budget. A simplified glyph may cross itself, so from then on it is merged at the end.
  const withinBudget = () => {
    const fitted = budget.fit(result)
    if (fitted === result) return
    result = fitted
    marks = undefined
    tangled = true
  }
  if (crumpleIsOn(params.crumple)) {
    // Crumple holds the middle of each glyph's ink box in place, so letters bend without drifting.
    const box = inkBox(result)
    const anchor = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : undefined
    const crumpled = applyWarp(result, (scale) => crumpleWarp(params.crumple, seed, unitsPerEm, scale, polygon.ref.index, anchor), unitsPerEm, marks, tangled, budget.maxWarpPoints)
    ;({ polygon: result, stats: stats.crumple, marks } = crumpled)
    withinBudget()
  }
  // Ripple, Whorl, and Slipstream place themselves by the ink box of what they receive, so the same letter
  // always looks alike.
  const rippleBox = rippleIsOn(params.ripple) ? inkBox(result) : null
  if (rippleBox) {
    const rippled = applyWarp(result, (scale) => rippleWarp(params.ripple, rippleBox, unitsPerEm, scale), unitsPerEm, marks, tangled, budget.maxWarpPoints)
    ;({ polygon: result, stats: stats.ripple, marks } = rippled)
    withinBudget()
  }
  const whorlBox = whorlIsOn(params.whorl) ? inkBox(result) : null
  if (whorlBox) {
    const whorled = applyWarp(result, (scale) => whorlWarp(params.whorl, whorlBox, unitsPerEm, scale), unitsPerEm, marks, tangled, budget.maxWarpPoints)
    ;({ polygon: result, stats: stats.whorl, marks } = whorled)
    withinBudget()
  }
  const slipstreamBox = slipstreamIsOn(params.slipstream) ? inkBox(result) : null
  // True once Slipstream's cuts have redrawn the outline, which merges any folds so far.
  let streamMerged = false
  // The outline Slipstream could not merge (it broke down or was too complex), so the final merge need not try it again.
  let unmergeable: PolygonGlyph | null = null
  if (slipstreamBox) {
    const streamed = applyWarp(result, (scale) => slipstreamWarp(params.slipstream, seed, slipstreamBox, unitsPerEm, scale), unitsPerEm, marks, tangled, budget.maxWarpPoints)
    ;({ polygon: result, marks } = streamed)
    withinBudget()
    const marked = slipstreamTrailsAndCuts(result, params.slipstream, seed, unitsPerEm, budget)
    stats.slipstream = { ...streamed.stats, trails: marked.trails, cuts: marked.cuts }
    if (marked.trails > 0 || marked.merge?.applied || marked.merge?.tooComplex) {
      result = marked.polygon
      // Trails, the redrawn outline, and the budget's simplification change the vertices: the crease marks no longer line up.
      marks = undefined
    }
    if (marked.merge) {
      stats.folds = marked.merge
      streamMerged = marked.merge.applied
      // Not merged: `result` has the very contours the merge was tried on.
      if (streamMerged) tangled = false
      else unmergeable = result
    }
  }
  // Slipstream's merge adds a vertex at every crossing, and Thorn picks its anchors from what is left.
  withinBudget()
  // The letter before its thorns grow, which layout measures instead of the outline (see PolygonGlyph.layoutBox).
  let layout: Required<Pick<PolygonGlyph, 'layoutBox' | 'layoutHull'>> | null = null
  if (thornIsOn(params.thorn)) {
    const layoutBox = inkBox(result)
    if (layoutBox) layout = { layoutBox, layoutHull: convexHull(result) }
    const reductions = budget.reductions
    // Once Slipstream has merged the folds, the outlines no longer cross, so Thorn's warps are checked again.
    ;({ polygon: result, stats: stats.thorn } = applyThorn(result, params.thorn, seed, unitsPerEm, marks, tangled, budget))
    if (budget.reductions > reductions) tangled = true
  }
  if ((tangled || stats.thorn.applied) && result !== unmergeable) {
    const merged = budget.merge(result)
    result = merged.polygon
    // After Slipstream's cut merge, count both merges' crossings and removed contours, and either's trouble.
    stats.folds = streamMerged
      ? {
          ...merged.stats,
          crossings: stats.folds.crossings + merged.stats.crossings,
          removed: stats.folds.removed + merged.stats.removed,
          contoursIn: stats.folds.contoursIn,
          failed: merged.stats.failed || stats.folds.failed,
          tooComplex: merged.stats.tooComplex || stats.folds.tooComplex,
        }
      : merged.stats
  }
  return { polygon: layout ? { ...result, ...layout } : result, stats }
}

/**
 * The convex hull of every point of the outline, counterclockwise and without collinear points (monotone chain).
 * Slanting is linear, so the slanted letter reaches exactly as far as its hull (see PolygonGlyph.layoutHull).
 */
function convexHull(polygon: PolygonGlyph): Point[] {
  const points = polygon.contours.flatMap((c) => c.points.map(({ x, y }) => ({ x, y }))).sort((a, b) => a.x - b.x || a.y - b.y)
  if (points.length < 3) return points
  const turn = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (from: Point[]) => {
    const kept: Point[] = []
    for (const p of from) {
      while (kept.length >= 2 && turn(kept[kept.length - 2], kept[kept.length - 1], p) <= 0) kept.pop()
      kept.push(p)
    }
    // Its last point starts the other half.
    kept.pop()
    return kept
  }
  return [...half(points), ...half([...points].reverse())]
}
