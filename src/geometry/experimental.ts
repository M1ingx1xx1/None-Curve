// The Experimental effects, run after the whole Geometry pipeline in a fixed order: Crumple, Ripple, Whorl, Slipstream, Thorn,
// Dissolve.
// The first four are piecewise-linear warps (see warp.ts) that add vertices only at creases. Within their safe ranges the
// warps are one-to-one, so any combination of them keeps the glyph valid. Beyond them (folds) the letter overlaps itself,
// and the overlaps are merged into clean outlines at the end (see overlaps.ts). After its warp, Slipstream adds trails that
// never cross the letter and cuts it with thin wedges, redrawing the outline (merging any folds so far). Thorn moves a few anchors far out, each
// pulling the letter around it along by a one-to-one warp (or, in Burst, grows many spikes all round it and sinks the outline
// between them), and can show the letter through fluted glass (thorn.ts); a
// thorn may cross the letter, so its outlines are merged the same way; layout measures the letter as it was before
// Thorn (PolygonGlyph.layoutBox and layoutHull), so thorns never move the text. Each glyph has a vertex budget (budget.ts): one
// that grows beyond it is simplified, and merged afterwards. Dissolve comes last, after the merge: it draws the letter
// anew from what that fills (by the nonzero rule, so it would read an unmerged outline the same), as contours that never
// cross, so it needs no merge of its own and keeps within the budget by itself (dissolve.ts).

import { GlyphBudget, type BudgetStats } from './budget'
import { crumpleWarp } from './crumple'
import { applyDissolve, emptyDissolveStats, type DissolveStats } from './dissolve'
import {
  crumpleIsOn,
  dissolveIsOn,
  EXPERIMENTAL_LIMITS,
  experimentalFolds,
  rippleIsOn,
  slipstreamIsOn,
  thornIsOn,
  whorlIsOn,
} from './limits'
import { emptyOverlapStats, type OverlapStats } from './overlaps'
import { inkBox, rippleWarp, type Box } from './ripple'
import { emptySlipstreamStats, slipstreamTrailsAndCuts, slipstreamWarp, type SlipstreamStats } from './slipstream'
import { applyThorn, emptyThornStats, ThornAnchors, thornBursts, withoutSpecks, type ThornStats } from './thorn'
import type { ExperimentalParams, Point, PolygonGlyph } from './types'
import { applyWarp, emptyWarpStats, type CreaseMarks, type Warp, type WarpStats } from './warp'
import { whorlMotion, whorlWarp } from './whorl'

export interface ExperimentalStats {
  crumple: WarpStats
  ripple: WarpStats
  whorl: WarpStats
  slipstream: SlipstreamStats
  thorn: ThornStats
  dissolve: DissolveStats
  /** The merge of overlaps when an effect goes beyond its safe range, Thorn is on, Slipstream cuts the letters, or the glyph was simplified. */
  folds: OverlapStats
  /** Whether the glyph was simplified to stay within its vertex budget. */
  budget: BudgetStats
}

/**
 * `reference`: the letter before Distortion (the pipeline gives it), with the same contours as `polygon`. Thorn picks its
 * anchors there, so the moves that Distortion and the effects before Thorn make neither re-pick nor turn its thorns.
 */
export function applyExperimental(
  polygon: PolygonGlyph,
  params: ExperimentalParams,
  reference: PolygonGlyph = polygon,
): { polygon: PolygonGlyph; stats: ExperimentalStats } {
  const seed = Math.trunc(Number.isFinite(params.seed) ? params.seed : 1) | 0
  const unitsPerEm = polygon.metrics.unitsPerEm > 0 ? polygon.metrics.unitsPerEm : 1000
  const vertices = polygon.contours.reduce((n, c) => n + c.points.length, 0)
  const budget = new GlyphBudget(
    vertices + EXPERIMENTAL_LIMITS.maxAddedVertices,
    vertices + EXPERIMENTAL_LIMITS.maxMergePoints,
    unitsPerEm,
  )
  const stats: ExperimentalStats = {
    crumple: emptyWarpStats(),
    ripple: emptyWarpStats(),
    whorl: emptyWarpStats(),
    slipstream: emptySlipstreamStats(),
    thorn: emptyThornStats(),
    dissolve: emptyDissolveStats(),
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
  // Thorn's anchors, picked on the reference and followed through every step below to the vertices they became.
  // Burst picks none: its spikes are spread round the outline as Thorn finds it.
  const anchors =
    thornIsOn(params.thorn) && !thornBursts(params.thorn)
      ? new ThornAnchors(reference, polygon, params.thorn, seed, unitsPerEm)
      : undefined
  // Keeps the glyph within its vertex budget. A simplified glyph may cross itself, so from then on it is merged at the end.
  const withinBudget = () => {
    const fitted = budget.fit(result)
    if (fitted === result) return
    anchors?.redrawn(result, fitted)
    result = fitted
    marks = undefined
    tangled = true
  }
  // Distortion's move of each side of the ink box, while Thorn is on: the warps below place themselves by the ink box,
  // so Thorn's window ends go through each warp placed by the box with this move taken back (undistorted). Otherwise a
  // Distortion change would shift where the warps fall for them and turn the thorns.
  const moved = anchors ? boxMove(inkBox(reference), inkBox(polygon)) : null
  const undistorted = (box: Box): Box =>
    moved
      ? {
          minX: box.minX - moved.minX,
          minY: box.minY - moved.minY,
          maxX: box.maxX - moved.maxX,
          maxY: box.maxY - moved.maxY,
        }
      : box
  // Warps the glyph (makeWarp gives the warp at a share of its strength, placed by `box`) and keeps it within its budget.
  const warp = (box: Box | null, makeWarp: (scale: number, box: Box | null) => Warp): WarpStats => {
    let full: Warp | undefined
    const warpAt = (scale: number) => (scale === 1 ? (full ??= makeWarp(1, box)) : makeWarp(scale, box))
    const warped = applyWarp(result, warpAt, unitsPerEm, marks, tangled, budget.maxWarpPoints)
    if (anchors)
      anchors.warped(
        result,
        marks,
        warped.polygon,
        warped.marks,
        warpAt(1),
        moved && box ? makeWarp(1, undistorted(box)) : warpAt(1),
      )
    ;({ polygon: result, marks } = warped)
    withinBudget()
    return warped.stats
  }
  if (crumpleIsOn(params.crumple)) {
    // Crumple's lattice is fixed in glyph coordinates, so it needs no box and every copy of a letter gets the same shape.
    stats.crumple = warp(null, (scale) => crumpleWarp(params.crumple, seed, unitsPerEm, scale))
  }
  // Ripple, Whorl, and Slipstream place themselves by the ink box of what they receive, so the same letter
  // always looks alike.
  const rippleBox = rippleIsOn(params.ripple) ? inkBox(result) : null
  if (rippleBox)
    stats.ripple = warp(rippleBox, (scale, box) => rippleWarp(params.ripple, box ?? rippleBox, unitsPerEm, scale))
  const whorlBox = whorlIsOn(params.whorl) ? inkBox(result) : null
  const beforeWhorl = result
  if (whorlBox)
    stats.whorl = warp(whorlBox, (scale, box) => whorlWarp(params.whorl, box ?? whorlBox, unitsPerEm, scale))
  const slipstreamBox = slipstreamIsOn(params.slipstream) ? inkBox(result) : null
  // True once Slipstream's cuts have redrawn the outline, which merges any folds so far.
  let streamMerged = false
  // The outline Slipstream could not merge (it broke down or was too complex), so the final merge need not try it again.
  let unmergeable: PolygonGlyph | null = null
  if (slipstreamBox) {
    const streamed = warp(slipstreamBox, (scale, box) =>
      slipstreamWarp(params.slipstream, seed, box ?? slipstreamBox, unitsPerEm, scale),
    )
    const marked = slipstreamTrailsAndCuts(result, params.slipstream, seed, unitsPerEm, budget)
    stats.slipstream = { ...streamed, trails: marked.trails, cuts: marked.cuts }
    if (marked.trails > 0 || marked.merge?.applied || marked.merge?.tooComplex) {
      anchors?.redrawn(result, marked.polygon)
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
  // Slipstream's merge adds a vertex at every crossing; Thorn finds its anchors (picked on the reference) among what is left.
  withinBudget()
  // The letter before its thorns grow, which layout measures instead of the outline (see PolygonGlyph.layoutBox).
  let layout: Required<Pick<PolygonGlyph, 'layoutBox' | 'layoutHull'>> | null = null
  if (thornIsOn(params.thorn)) {
    const layoutBox = inkBox(result)
    if (layoutBox) layout = { layoutBox, layoutHull: convexHull(result) }
    const reductions = budget.reductions
    // Once Slipstream has merged the folds, the outlines no longer cross, so Thorn's warps are checked again.
    ;({ polygon: result, stats: stats.thorn } = applyThorn(
      result,
      params.thorn,
      seed,
      unitsPerEm,
      marks,
      tangled,
      budget,
      anchors,
    ))
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
    // Burst's spikes cross by the dozen: leave out the specks where they do (see withoutSpecks).
    if (stats.thorn.applied && thornBursts(params.thorn) && merged.stats.applied) {
      const cleaned = withoutSpecks(result, unitsPerEm)
      result = cleaned.polygon
      stats.folds = {
        ...stats.folds,
        removed: stats.folds.removed + cleaned.removed,
        contoursOut: stats.folds.contoursOut - cleaned.removed,
      }
    }
  }
  if (dissolveIsOn(params.dissolve)) {
    ;({ polygon: result, stats: stats.dissolve } = applyDissolve(
      result,
      params.dissolve,
      seed,
      unitsPerEm,
      budget.maxVertices,
    ))
  }
  // Whorl's centre and settings ride along for Glide (display only; PolygonGlyph.motion).
  const motion = whorlBox ? { whorl: whorlMotion(params.whorl, whorlBox, unitsPerEm, beforeWhorl) } : null
  if (motion) {
    const last =
      !stats.whorl.tooComplex &&
      !slipstreamIsOn(params.slipstream) &&
      !thornIsOn(params.thorn) &&
      !dissolveIsOn(params.dissolve)
    if (last) motion.whorl.last = true
  }
  return { polygon: layout || motion ? { ...result, ...layout, ...(motion ? { motion } : {}) } : result, stats }
}

/**
 * The convex hull of every point of the outline, counterclockwise and without collinear points (monotone chain).
 * Slanting is linear, so the slanted letter reaches exactly as far as its hull (see PolygonGlyph.layoutHull).
 */
function convexHull(polygon: PolygonGlyph): Point[] {
  const points = polygon.contours
    .flatMap((c) => c.points.map(({ x, y }) => ({ x, y })))
    .sort((a, b) => a.x - b.x || a.y - b.y)
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

/** How far Distortion moved each side of the ink box (from `before` to `after`), or null when it moved none. */
function boxMove(before: Box | null, after: Box | null): Box | null {
  if (!before || !after) return null
  const move = {
    minX: after.minX - before.minX,
    minY: after.minY - before.minY,
    maxX: after.maxX - before.maxX,
    maxY: after.maxY - before.maxY,
  }
  return move.minX || move.minY || move.maxX || move.maxY ? move : null
}
