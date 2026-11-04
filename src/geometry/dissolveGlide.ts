// What Glide pairs a dissolved letter's anchors on (specimen/morph.ts). Worked out only when a glide is planned, so
// editing and the exports cost what they did without it: experimental.ts keeps the outline Dissolve was given as the
// glyph's glideOutline, marked `glideDissolved`, and this adds the ink Dissolve ate and added to it.

import { mergeOverlaps } from './overlaps'
import { signedArea } from './primitives'
import type { PolygonContour, PolygonGlyph } from './types'

/** The anchors of the outline before Dissolve and after it, at most, for dissolvedAsHoles (specimen/morph.ts maxPoints). */
const DISSOLVE_GLIDE_MAX_POINTS = 12_000

/** Each dissolved glyph's outline to pair, by its glideOutline (a glyph is planned as `to`, then again as `from`). */
const resolved = new WeakMap<PolygonContour[], PolygonContour[] | null>()

/**
 * The contours Glide pairs a glyph's anchors on: its glideOutline, after Dissolve with the ink Dissolve ate and added
 * (dissolvedAsHoles). Null when it has none: its own contours.
 */
export function glideOutlineOf(glyph: PolygonGlyph): PolygonContour[] | null {
  const outline = glyph.glideOutline
  if (!outline) return null
  if (!glyph.glideDissolved) return outline
  let kept = resolved.get(outline)
  if (kept === undefined) {
    kept = dissolvedAsHoles(outline, glyph)
    resolved.set(outline, kept)
  }
  return kept
}

/**
 * The outline Dissolve was given (`before`, as it came), with the ink Dissolve ate
 * as holes of its own and the ink it added (specks, a ragged edge) as islands. Dissolve breaks a letter's edge, so its
 * counter is often no hole at all; Glide pairs the letter's own contours with the contours they were, instead of
 * shrinking the counter into its centre, which filled it black on the way. Holes wind against `before`'s largest
 * contour and islands with it, so this fills the same as `after` except where `before`'s own overlaps wind twice. Null
 * when either difference cannot be merged, or the outlines are too large to glide.
 */
function dissolvedAsHoles(before: PolygonContour[], after: PolygonGlyph): PolygonContour[] | null {
  // Glide changes a glyph past MORPH_LIMITS.maxPoints anchors at once: no outline to pair, and no merges to pay for.
  let points = 0
  for (const c of before) points += c.points.length
  for (const c of after.contours) points += c.points.length
  if (points > DISSOLVE_GLIDE_MAX_POINTS) return null
  const reversed = (c: PolygonContour): PolygonContour => ({
    points: c.points.slice().reverse(),
    clockwise: !c.clockwise,
  })
  let largest = 0
  for (const c of before) {
    const area = signedArea(c.points)
    if (Math.abs(area) > Math.abs(largest)) largest = area
  }
  // `before` wound as Dissolve winds its ink (outer contours counter-clockwise), once or more where pieces overlap.
  const ink = largest > 0 ? before : before.map(reversed)
  // Positive where one has ink and the other has not.
  const minus = (a: PolygonContour[], b: PolygonContour[]) =>
    mergeOverlaps({ ...after, contours: [...a, ...b.map(reversed)] }, 'positive')
  const eaten = minus(ink, after.contours)
  const added = minus(after.contours, ink)
  if (!eaten.stats.applied || !added.stats.applied) return null
  const holes = largest > 0 ? eaten.polygon.contours.map(reversed) : eaten.polygon.contours
  const islands = largest > 0 ? added.polygon.contours : added.polygon.contours.map(reversed)
  return [...before, ...holes, ...islands]
}
