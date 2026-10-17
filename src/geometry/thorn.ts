// Experimental Thorn: a few anchors of each letter grow into long, straight thorns that pull the letter along.
// Pure functions in font units; no React, no DOM, no Math.random.
//
// Only anchors on the letter's outside (inside no other contour, or an even number) grow thorns, away from the ink.
// Which anchors, in which direction and how far all come from an integer hash of the shared Experimental seed
// and the anchor's place on the letter before Distortion and the other Experimental effects (its reference
// outline), so the same seed and letter always give the same thorns, and a new seed moves them. Each anchor is
// followed through those effects to the vertex it became, and its thorn grows from there, along the outline's
// normal as the warps turned it (mirrored out of the ink where it would point into the letter as drawn; see
// ThornAnchors): the small moves of earlier effects, or a new Distortion seed, neither move a thorn to another anchor
// nor swing it round.
//
// Each thorn grows in four steps:
// 1. Root: a piecewise-linear warp (see warp.ts) on a small star mesh around the anchor: the anchor in the
//    middle, an inner ring, and an outer ring at Root's radius that stays put. The anchor moves part of the
//    way out; the inner ring follows less far (least on the far side), drawn in toward the thorn's axis and
//    pulled a little more on one side. Everything inside the outer ring moves with it, other contours
//    included, so strokes tilt and thin, and a counter or the far side of a stem bends toward the thorn too.
//    Every mesh triangle is checked: while one would flip or flatten, the pull is halved, so each pull is
//    one-to-one and keeps the glyph valid. Later thorns centre their mesh where earlier pulls moved their
//    anchor; all pulls run as one warp, their composition.
// 2. Tip: the anchor jumps the rest of its thorn's length, a sharp straight thorn. Its base (Width) reaches along the
//    outline on either side, up to the root's inner ring, so the thorn narrows on from the root.
// 3. Backlash (optional): a ray from the anchor straight into the ink (against its thorn) finds where the stroke behind
//    it ends: where the ray leaves the ink, past contours that overlap inside it, so into a counter or out of the
//    letter. Its length is the stroke's thickness there. A thorn turned so far that the ray starts out of the ink,
//    or one whose ray runs more than 60% of the em (along a stroke rather than across it), gets neither of:
//    - Back thorn: where the ray leaves the ink, a shorter thorn (Back × half its thorn's length) shoots on the
//      other way, with the same base, as if the thorn had been driven through the stroke. One that would land on or
//      beside another tip, or within either's base, is left out.
//    - Dent: the outline either side of the thorn sinks into the stroke, deepest at the base (Dent × 55% of the
//      thickness) and less to nothing a few bases along. A side stops at another thorn, or where the outline turns so
//      far that the ray from it no longer leads into the ink; no vertex sinks more than three quarters of its own way
//      across, so a dent never reaches the stroke's other side.
// 4. Refraction (optional): the letter as seen through fluted glass. Vertical strips (Flute width), each
//    showing its part of the letter magnified about its middle, slid sideways and lifted or dropped, with the
//    seams between them squeezed into steep breaks. x moves by a rising piecewise-linear function and y by a
//    shift that depends on x alone, so the map is one-to-one at any strength. The glass covers only the letter
//    (and a strip either side): a thorn's far end, which can reach across the canvas, is left as it is.
// Reach is a share of the canvas diagonal: the app gives that diagonal in em (canvasEm), so at Reach 100% a thorn
// can span the whole canvas whatever the text size.
// A thorn or back thorn may cross the letter or another thorn; the outlines are then merged at the end of the Experimental
// effects (overlaps.ts), as when an effect folds.
// Reverse turns every thorn round, so it shoots into the letter along the inward normal: the same anchors, turns,
// lengths, leans, roots and bases, only each direction negated. Inside a stroke the thorn carves a white slit; where
// it crosses a counter or comes out past the far side, the merge (nonzero) shows it as an ink spike. Back thorns and
// dents keep their places too: the ray still runs into the stroke (now along the thorn), the dents still sink into it,
// and each back thorn, its direction negated like the rest, starts at the stroke's far side and shoots back through
// it, coming out past the anchor's side as a spike beside the slit.

import type { GlyphBudget } from './budget'
import { hashInts } from './distortion'
import { signedArea } from './flatten'
import { inkBox, type Box } from './ripple'
import type { Point, PolygonGlyph, ThornParams } from './types'
import { applyWarp, breakRuns, WARP_LIMITS, type CreaseMarks, type Warp, type WarpStats } from './warp'

/** A canvas's diagonal over the text size: the diagonal in em, to 0.01 em. */
const diagonalEm = (width: number, height: number, size: number) => Math.round((Math.hypot(width, height) / size) * 100) / 100

export const THORN_LIMITS = {
  minCount: 1,
  maxCount: 12,
  /**
   * The canvas diagonal in em that Reach is a share of when the app gives none (ThornParams.canvasEm): the default
   * canvas, 1200 × 800 px, at the default 48 px text (about 30 em).
   */
  defaultCanvasEm: diagonalEm(1200, 800, 48),
  /**
   * The longest jump in em, whatever the canvas (small text on a large canvas spans over 1000 em): a safety cap that
   * keeps every merge within its exact grid (see OVERLAP_LIMITS.maxCoordinate).
   */
  maxReachEm: 256,
  /** Each anchor jumps at least this share of Reach (the rest is random, up to all of it). */
  minShare: 0.35,
  /** The narrowest base (Width 0), as a share of how far a base may reach: the root's inner ring, or the anchor's shorter edge. */
  minWidth: 0.02,
  /** The root's radius at Root 100%, as a share of the em (Root 0: no root, the thorns are only added on). */
  maxRoot: 0.6,
  /** Flute width range, as a share of the em. */
  minFlute: 0.04,
  maxFlute: 0.3,
} as const

/** Used where older saved settings lack the newer sliders (Refraction, Back thorn and Dent: off). */
export const THORN_FALLBACK = { root: 0.5, flute: 0.1 } as const

/** The shape of a root (see the header). */
const ROOT = {
  /** Sides of the mesh's two rings; a flat side faces the thorn. */
  sides: 8,
  /** The inner ring's radius, as a share of the root's. */
  inner: 0.35,
  /** The anchor moves out this share of its thorn's length, at most `maxPull` of the root's radius. */
  pull: 0.5,
  maxPull: 0.75,
  /** How far the inner ring follows the anchor, as a share of its move: on the thorn's side and on the far side. */
  front: 0.6,
  back: 0.15,
  /** How far the inner ring's sides are drawn in toward the thorn's axis, as a share of the anchor's move. */
  squeeze: 0.35,
  /** One side of the root follows up to this much more than the other (seeded). */
  lean: 0.5,
  /** No mesh triangle may shrink below this share of its area; the move is halved until none does, at most `halvings` times. */
  minArea: 0.2,
  halvings: 6,
} as const

/** The fluted glass (see the header). */
const FLUTE = {
  /** The seams between strips take this share of the letter, half on either side of each strip's edge. */
  seam: 0.3,
  /**
   * At Refraction 100%, the middle of each strip shows its part of the letter this much wider (+30%), so the
   * seams are squeezed into steep, narrow breaks. Below seam / (1 - seam), x keeps rising across every seam.
   */
  magnify: 0.3,
  /** Strips slide sideways by up to this share of what keeps x rising across every seam. */
  slide: 0.8,
  /** Strips move up or down by up to this share of their width. */
  lift: 0.35,
} as const

/** Back thorns and dents (see the header). */
const BACKLASH = {
  /** A back thorn's length at Back thorn 100%, as a share of its thorn's. */
  length: 0.5,
  /** The thickest stroke measured, as a share of the em: a ray that runs farther went along a stroke, not across it. */
  maxThickness: 0.6,
  /** A back thorn's site this close (× the em) to a vertex moves onto it, so no sliver of an edge is left. */
  snap: 0.005,
  /** The deepest dent, at its thorn's base at Dent 100%, as a share of the stroke's thickness. */
  depth: 0.55,
  /** How far along the outline a dent reaches: this many of its thorn's bases, or this share of the thickness if more. */
  reachBases: 2.5,
  reachThickness: 1.2,
  /** No vertex sinks more than this share of its own way across the stroke (to the outline's next edge inward). */
  maxShare: 0.75,
  /** A dent looks up the edges near its vertices this many at a time. */
  batch: 32,
} as const

export interface ThornStats {
  applied: boolean
  /** Anchors that jumped. */
  thorns: number
  /** Back thorns grown behind the thorns (Back thorn). */
  backThorns: number
  /** Longest jump (font units). */
  longest: number
  /** Thorns whose root pulled the letter around them along. */
  roots: number
  /** Contours that needed a weaker root or refraction to stay valid. */
  reducedContours: number
  /** Contours left without roots or refraction because no tried strength kept them valid. */
  fallbackContours: number
  /** Roots or refraction were left out of the glyph: they would have made more points than its budget allows. */
  tooComplex: boolean
}

export const emptyThornStats = (): ThornStats => ({ applied: false, thorns: 0, backThorns: 0, longest: 0, roots: 0, reducedContours: 0, fallbackContours: 0, tooComplex: false })

/** Channel numbers keep Thorn's random numbers apart from the other effects' for the same seed. */
const CHANNEL = { pick: 0x5a1, direction: 0x5a2, distance: 0x5a3, lean: 0x5a4, slide: 0x5a5, lift: 0x5a6 } as const
const UINT = 0x1_0000_0000

export function thornIsOn(params: ThornParams | undefined): params is ThornParams {
  return !!params && params.enabled && finite(params.count, 0) >= THORN_LIMITS.minCount && finite(params.canvasReach, 0) > 0
}

/**
 * The canvas diagonal in em (ThornParams.canvasEm): the artboard's diagonal over the text size, both in px, to 0.01 em.
 * The default canvas's (THORN_LIMITS.defaultCanvasEm) for sizes that are not finite and positive.
 */
export function canvasDiagonalEm(width: number, height: number, size: number): number {
  if (![width, height, size].every((v) => Number.isFinite(v) && v > 0)) return THORN_LIMITS.defaultCanvasEm
  const em = diagonalEm(width, height, size)
  return Number.isFinite(em) && em > 0 ? em : THORN_LIMITS.defaultCanvasEm
}

/** One of Thorn's picks: an anchor of the reference outline, which way its thorn grows, and its seeded turn, length and lean. */
interface Pick {
  /**
   * The points a window's length (THORN_WINDOW) back and on along the reference outline from the anchor, carried through
   * the warps since (see ThornAnchors.warped): the thorn grows square to the line between them.
   */
  ends: [Point, Point]
  /** Which side of the outline the ink lies on: 1 when its contour runs counter-clockwise. */
  side: number
  /** The outward normal on the reference outline, for when the warps squeeze the window to a point. */
  normal: Point
  /** -0.5 to 0.5: the turn from the outward normal, as a share of Spread × 180°. */
  turn: number
  /** The share of Reach the thorn takes. */
  share: number
  /** -1 to 1: which side of the root follows more, and how much. */
  lean: number
}

/** Where a pick is on the outline now: contour and vertex index. */
interface Site {
  contour: number
  index: number
}

/** A pick where it is on the outline now, with the outward normal it grows along (before its turn). */
export interface ThornSite extends Site {
  normal: Point
  turn: number
  share: number
  lean: number
}

/**
 * How much of the outline (× the em, either way along it from the anchor) sets which way a thorn grows: the outline's
 * direction over about a thorn's base, rather than at the anchor alone. Warps that crinkle the outline finely (Ripple's
 * zigzags, Whorl's kinks between rings) then turn a thorn only a little when they shift along the letter, as they do
 * when Distortion changes the letter's ink box, which places them.
 */
const THORN_WINDOW = 0.06

/**
 * How far (× the em) a picked anchor stays from any contour its own crosses (where contours overlap, as an arch drawn
 * over a stem): Distortion moves the two apart, and an anchor it carried into the other's ink would start its thorn
 * hidden there, the thorn's visible root sliding along the other's edge as Distortion changes.
 */
const THORN_CLEARANCE = 0.1

/**
 * Which anchors grow thorns, and which way: picked on the glyph's reference outline (the letter before Distortion and
 * the other Experimental effects) and followed through every later step to the vertex each became: which anchors grow
 * thorns depends only on the seed, the reference outline and Anchors; their directions on these and Spread, turned with
 * the letter by the warps (never by Distortion's noise). So a step of Distortion or of Crumple's or Ripple's Amount, or a
 * new Distortion seed, neither moves a thorn to another anchor nor swings it round (tests/geometry/thorn-anchors.test.ts).
 * The warps' other sliders change the warps themselves and may still move thorns, so Sound hands them to the letters by
 * turns (isTurnTarget in src/sound/letters.ts). The anchors are ranked by a hash
 * of the seed and their place on the reference outline, and the first `count` grow thorns, so Anchors adds or removes
 * thorns at the end of a fixed list.
 *
 * Each step reports how it changed the outline:
 * - a warp (warped) keeps every input vertex, in order, and marks the creases it adds (CreaseMarks): a pick moves to the
 *   vertex at its place among the unmarked ones. The ends of its window go where the warp takes them, from where they
 *   were before Distortion moved the outline, and through the warp as it is placed without Distortion's move of the ink
 *   box (`ends`), so Distortion changes neither which way they point nor where the warp's creases fall for them;
 * - a step that redraws the outline (redrawn: the vertex budget's simplification, Slipstream's trails and cuts) keeps
 *   the vertices it does not cut away where they were: a pick moves to the nearest vertex on the letter's outside.
 */
export class ThornAnchors {
  private readonly picks: Pick[] = []
  /** Where each pick is on the outline now, or null once it is lost. */
  private sites: (Site | null)[] = []

  /** How far the drawn outline's direction is measured either way along it (THORN_WINDOW), in font units. */
  private readonly window: number

  /** `reference`: the outline the anchors are picked on. `polygon`: the outline now (after Distortion), with the same contours. */
  constructor(reference: PolygonGlyph, polygon: PolygonGlyph, params: ThornParams, seed: number, unitsPerEm: number) {
    this.window = THORN_WINDOW * unitsPerEm
    const count = Math.round(clamp(finite(params.count, 3), THORN_LIMITS.minCount, THORN_LIMITS.maxCount))
    const contours = reference.contours.map((c) => c.points)
    // Candidates: every anchor, ranked by a hash of the seed and its place; the first `count` on the letter's outside
    // are picked (inside no other contour, or an even number: where contours overlap, the anchors outside the others,
    // clear of them by THORN_CLEARANCE where enough are).
    const candidates: { contour: number; index: number; rank: number }[] = []
    contours.forEach((points, contour) => {
      if (points.length < 3) return
      points.forEach((p, index) => {
        candidates.push({ contour, index, rank: hashInts(seed, CHANNEL.pick, contour, Math.round(p.x), Math.round(p.y)) })
      })
    })
    candidates.sort((a, b) => a.rank - b.rank || a.contour - b.contour || a.index - b.index)
    // The anchors clear of crossing contours first; only when too few are, the others outside them, each in rank order.
    const chosen: { contour: number; index: number }[] = []
    for (const outside of [outsideTest(contours, THORN_CLEARANCE * unitsPerEm), outsideTest(contours)]) {
      for (const candidate of candidates) {
        if (chosen.length >= count) break
        if (!chosen.includes(candidate) && outside(candidate.contour, contours[candidate.contour][candidate.index])) chosen.push(candidate)
      }
    }
    for (const { contour, index } of chosen) {
      const points = contours[contour]
      const side = signedArea(points) > 0 ? 1 : -1
      const normal = outwardNormal(points, index, side)
      if (!normal) continue
      const key = [contour, Math.round(points[index].x), Math.round(points[index].y)] as const
      this.picks.push({
        ends: windowEnds(points, index, this.window),
        side,
        normal,
        turn: hashInts(seed, CHANNEL.direction, ...key) / UINT - 0.5,
        share: THORN_LIMITS.minShare + (1 - THORN_LIMITS.minShare) * (hashInts(seed, CHANNEL.distance, ...key) / UINT),
        lean: (hashInts(seed, CHANNEL.lean, ...key) / UINT) * 2 - 1,
      })
      this.sites.push(polygon === reference ? { contour, index } : follow(reference, polygon, { contour, index }))
    }
  }

  /**
   * After a warp from `before` (crease marks `beforeMarks`) to `after` (`afterMarks`); `warp` is the warp at full
   * strength, and `ends` the same warp placed as it would be without Distortion (the window's ends go through it). A
   * pick moves to the vertex at its place among the unmarked vertices, which a warp keeps in order (failing that, to the
   * vertex nearest to where the warp took it).
   */
  warped(before: PolygonGlyph, beforeMarks: CreaseMarks | undefined, after: PolygonGlyph, afterMarks: CreaseMarks, warp: Warp, ends: Warp = warp): void {
    const unmarked = (marks: readonly boolean[] | undefined, n: number) => {
      const out: number[] = []
      for (let i = 0; i < n; i++) if (!marks?.[i]) out.push(i)
      return out
    }
    this.sites = this.sites.map((site, t) => {
      const from = site && before.contours[site.contour]?.points
      const to = site && after.contours[site.contour]?.points
      // Left as it was: the warp gave up on the glyph.
      if (!site || !from || !to || from === to) return site
      const pick = this.picks[t]
      pick.ends = [ends.map(pick.ends[0]), ends.map(pick.ends[1])]
      const inputs = unmarked(beforeMarks?.[site.contour], from.length)
      const outputs = unmarked(afterMarks[site.contour], to.length)
      const place = inputs.indexOf(site.index)
      if (place >= 0 && inputs.length === outputs.length) return { contour: site.contour, index: outputs[place] }
      // The warp left out a spike's tip: the vertex nearest to where the warp took the pick.
      const index = nearest(to, warp.map(from[site.index]), Infinity, place >= 0 ? (i) => !afterMarks[site.contour]?.[i] : undefined)
      return index < 0 ? null : { contour: site.contour, index }
    })
  }

  /**
   * After a step that redrew the outline from `before` to `after`: each pick moves to the vertex nearest to it on the
   * letter's outside (as the picks are: a redraw can leave a counter's vertex nearest), or to the nearest vertex when no
   * vertex is outside.
   */
  redrawn(before: PolygonGlyph, after: PolygonGlyph): void {
    const contours = after.contours.map((c) => c.points)
    const outside = outsideTest(contours)
    this.sites = this.sites.map((site) => {
      const p = site && before.contours[site.contour]?.points[site.index]
      return p ? nearestOutside(contours, p, outside) : null
    })
  }

  /**
   * The picks on `polygon` (the outline the steps reported last), at most one per vertex. Each grows along the normal its
   * window's ends give, unless that points into the letter as drawn: a warp can turn the outline at the anchor further
   * than the window's ends show. Then it is mirrored in the drawn outline's direction over the same window, so it points
   * out as far as it pointed in (see outOfInk).
   */
  located(polygon: PolygonGlyph): ThornSite[] {
    const taken = new Set<string>()
    const out: ThornSite[] = []
    const sides = new Map<number, number>()
    this.sites.forEach((site, t) => {
      const points = site && polygon.contours[site.contour]?.points
      if (!site || !points?.[site.index]) return
      const key = `${site.contour}:${site.index}`
      if (taken.has(key)) return
      taken.add(key)
      const { ends, side, normal, turn, share, lean } = this.picks[t]
      const along = unit(ends[1].x - ends[0].x, ends[1].y - ends[0].y)
      let drawnSide = sides.get(site.contour)
      if (drawnSide === undefined) sides.set(site.contour, (drawnSide = signedArea(points) > 0 ? 1 : -1))
      const grown = along ? { x: side * along.y, y: -side * along.x } : normal
      out.push({ ...site, normal: outOfInk(grown, windowEnds(points, site.index, this.window), drawnSide), turn, share, lean })
    })
    return out
  }
}

/** The points `window` back and on along the contour from vertex `index` (at most a quarter of its length either way). */
function windowEnds(points: readonly Point[], index: number, window: number): [Point, Point] {
  const n = points.length
  const length = (i: number, j: number) => Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y)
  let perimeter = 0
  for (let i = 0; i < n; i++) perimeter += length(i, (i + 1) % n)
  const reach = Math.min(window, perimeter / 4)
  const walk = (step: 1 | -1): Point => {
    let left = reach
    for (let k = 0, at = index; k < n; k++) {
      const next = (at + step + n) % n
      const edge = length(at, next)
      if (edge >= left && edge > 0) return lerp(points[at], points[next], left / edge)
      left -= edge
      at = next
    }
    return points[index]
  }
  return [walk(-1), walk(1)]
}

/**
 * `normal` (a unit vector) where it points into the ink of the drawn outline, judged by the outline's direction between
 * `ends` (the window's ends on it; `side` as for outwardNormal): mirrored in that direction, so it points out as far as
 * it pointed in. The mirror is continuous, so a normal near that direction turns hardly at all. Otherwise `normal`.
 */
function outOfInk(normal: Point, [a, b]: readonly [Point, Point], side: number): Point {
  const along = unit(b.x - a.x, b.y - a.y)
  if (!along) return normal
  const outward = { x: side * along.y, y: -side * along.x }
  const dot = normal.x * outward.x + normal.y * outward.y
  return dot < 0 ? { x: normal.x - 2 * dot * outward.x, y: normal.y - 2 * dot * outward.y } : normal
}

/**
 * Where a vertex of `from` is on `to`: the same vertices, each moved a little or not at all, with a few more put in
 * between (Distortion: with few anchors, it adds the midpoints of some edges). Same count: the same vertex.
 * Otherwise vertex i went to i + o, where the offset o (0 to the number put in) never falls along the contour: the
 * nearest vertices that did not move pin it from either side, and the vertex nearest to where it was in that range
 * is the one.
 */
function follow(from: PolygonGlyph, to: PolygonGlyph, site: Site): Site | null {
  const a = from.contours[site.contour]?.points
  const b = to.contours[site.contour]?.points
  const p = a?.[site.index]
  if (!a || !p) return null
  if (!b || from.contours.length !== to.contours.length || b.length < a.length) return nearestSite(to, p)
  if (a.length === b.length) return site
  const added = b.length - a.length
  const offset = (i: number) => {
    for (let o = 0; o <= added; o++) if (b[i + o].x === a[i].x && b[i + o].y === a[i].y) return o
    return -1
  }
  let lo = 0
  let hi = added
  for (let i = site.index; i >= 0; i--) {
    const o = offset(i)
    if (o >= 0) {
      lo = o
      break
    }
  }
  for (let i = site.index + 1; i < a.length; i++) {
    const o = offset(i)
    if (o >= 0) {
      hi = Math.max(o, lo)
      break
    }
  }
  const index = nearest(b.slice(site.index + lo, site.index + hi + 1), p, Infinity)
  return index < 0 ? null : { contour: site.contour, index: site.index + lo + index }
}

/** The vertex of any contour nearest to `p`. */
function nearestSite(polygon: PolygonGlyph, p: Point): Site | null {
  let best: Site | null = null
  let bestDistance = Infinity
  polygon.contours.forEach((c, contour) => {
    if (c.points.length < 3) return
    const index = nearest(c.points, p, bestDistance)
    if (index < 0) return
    const distance = Math.hypot(c.points[index].x - p.x, c.points[index].y - p.y)
    if (distance <= bestDistance) {
      best = { contour, index }
      bestDistance = distance
    }
  })
  return best
}

/** The vertex nearest to `p` that `outside` passes (see outsideTest), or the nearest of all when none does. */
function nearestOutside(contours: readonly (readonly Point[])[], p: Point, outside: (contour: number, p: Point) => boolean): Site | null {
  const all: { contour: number; index: number; distance: number }[] = []
  let best = -1
  for (let contour = 0; contour < contours.length; contour++) {
    const points = contours[contour]
    if (points.length < 3) continue
    for (let index = 0; index < points.length; index++) {
      const distance = Math.hypot(points[index].x - p.x, points[index].y - p.y)
      if (best < 0 || distance < all[best].distance) best = all.length
      all.push({ contour, index, distance })
    }
  }
  if (best < 0) return null
  const pass = ({ contour, index }: Site) => outside(contour, contours[contour][index])
  // Usually the pick's own vertex, kept where it was.
  const found = pass(all[best]) ? all[best] : (all.slice().sort((a, b) => a.distance - b.distance).find(pass) ?? all[best])
  return { contour: found.contour, index: found.index }
}

/** A chosen anchor: where it is, which way and how far its thorn goes. */
interface Thorn {
  contour: number
  index: number
  anchor: Point
  /** Unit vector along the thorn. */
  direction: Point
  length: number
  /** -1 to 1: which side of the root follows more, and how much. */
  lean: number
}

/**
 * The thorns, after the warps of earlier effects. `marks` flags the vertices earlier effects added at
 * creases (tidying may remove them); with `folds`, an earlier effect folds the letter, so the root and
 * refraction warps are not checked either (see applyWarp). `budget` keeps the refracted glyph within its vertex
 * budget (see budget.ts); when it simplifies the glyph, the outlines may cross, and the caller merges them.
 * `anchors`: the anchors picked on the reference outline and followed to `polygon` (see ThornAnchors); without
 * them, `polygon` is its own reference.
 */
export function applyThorn(
  polygon: PolygonGlyph,
  params: ThornParams,
  seed: number,
  unitsPerEm: number,
  marks?: CreaseMarks,
  folds = false,
  budget?: GlyphBudget,
  anchors?: ThornAnchors,
): { polygon: PolygonGlyph; stats: ThornStats } {
  const stats = emptyThornStats()
  // The longest a thorn may be: a share of the canvas diagonal, in em up to the safety cap.
  const canvasEm = Math.min(positive(params.canvasEm, THORN_LIMITS.defaultCanvasEm), THORN_LIMITS.maxReachEm)
  const maxLength = clamp(finite(params.canvasReach, 0), 0, 1) * canvasEm * unitsPerEm
  const spread = clamp(finite(params.spread, 0.5), 0, 1)
  const width = clamp(finite(params.width, 1), THORN_LIMITS.minWidth, 1)
  const radius = clamp(finite(params.root, THORN_FALLBACK.root), 0, 1) * THORN_LIMITS.maxRoot * unitsPerEm
  const refraction = clamp(finite(params.refraction, 0), 0, 1)
  const flute = clamp(finite(params.flute, THORN_FALLBACK.flute), THORN_LIMITS.minFlute, THORN_LIMITS.maxFlute) * unitsPerEm
  // Older saved settings have no Back thorn or Dent: off, as at 0, which leaves out step 3 altogether.
  const back = clamp(finite(params.back, 0), 0, 1)
  const dent = clamp(finite(params.dent, 0), 0, 1)
  const contours = polygon.contours.map((c) => c.points)

  // Older saved settings have no Reverse; off runs exactly the expressions it always did.
  const reverse = params.reverse === true
  const thorns: Thorn[] = []
  const picks = maxLength > 0 ? (anchors ?? new ThornAnchors(polygon, polygon, params, seed, unitsPerEm)).located(polygon) : []
  for (const { contour, index, normal, turn: bend, share, lean } of picks) {
    const turn = bend * spread * Math.PI
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    // Reversed: the inward normal, turned the same way, which is exactly the outward direction negated.
    const n = reverse ? { x: -normal.x, y: -normal.y } : normal
    thorns.push({
      contour,
      index,
      anchor: contours[contour][index],
      direction: { x: n.x * cos - n.y * sin, y: n.x * sin + n.y * cos },
      length: maxLength * share,
      lean,
    })
  }

  let result = polygon
  let resultMarks = marks
  const warpStats = (s: WarpStats) => {
    stats.reducedContours += s.reducedContours
    stats.fallbackContours += s.fallbackContours
    stats.tooComplex ||= s.tooComplex
  }
  const maxPoints = budget?.maxWarpPoints ?? Infinity
  // The letter's ink box before the tips grow: refraction covers only it (see fluteWarp).
  let letter: Box | null = null

  if (thorns.length > 0) {
    // 1. Roots, all at once as one warp. Each anchor is kept as an input vertex, so tidying never removes it.
    const pulls = radius > 0 ? rootPulls(thorns, radius, 1) : thorns.map(() => null)
    const anchorAt = thorns.map((thorn) => thorn.index)
    stats.roots = pulls.filter(Boolean).length
    if (stats.roots > 0) {
      const warps = new Map<number, Warp>([[1, compose(pulls)]])
      const warpAt = (scale: number) => {
        let warp = warps.get(scale)
        if (!warp) warps.set(scale, (warp = compose(rootPulls(thorns, radius, scale))))
        return warp
      }
      const anchors = new Set(thorns.map((thorn) => `${thorn.contour}:${thorn.index}`))
      const kept = contours.map((points, k) => points.map((_, i) => (marks?.[k]?.[i] ?? false) && !anchors.has(`${k}:${i}`)))
      const warped = applyWarp(result, warpAt, unitsPerEm, kept, folds, maxPoints)
      warpStats(warped.stats)
      result = warped.polygon
      resultMarks = warped.marks
      // Find each anchor in the warped contour: where the full warp took it, or a weaker one (see applyWarp).
      // The warp leaves out the tip of a hair-thin spike, so an anchor there grows from the nearest vertex instead.
      thorns.forEach((thorn, t) => {
        const points = result.contours[thorn.contour].points
        const find = (p: Point) => points.findIndex((q) => q.x === p.x && q.y === p.y)
        let index = find(warpAt(1).map(thorn.anchor))
        for (const scale of WARP_LIMITS.retryScales) if (index < 0) index = find(warpAt(scale).map(thorn.anchor))
        if (index < 0) index = find(thorn.anchor)
        if (index < 0) index = nearest(points, warpAt(1).map(thorn.anchor), WARP_LIMITS.shortEdge * unitsPerEm)
        anchorAt[t] = index
      })
    }

    if (refraction > 0) letter = inkBox(result)
    // 2. Tips: each anchor jumps the rest of its thorn's length. Its base reaches Width × the root's inner ring
    // (or × the anchor's shorter edge, if that is longer) along the outline on either side.
    const tips = result.contours.map(() => new Map<number, Tip>())
    thorns.forEach((thorn, t) => {
      const index = anchorAt[t]
      if (index < 0) return
      const p = result.contours[thorn.contour].points[index]
      // Measured from where the warp actually took the anchor (a weaker retry moves it less), so every tip ends a
      // thorn's length out.
      const moved = (p.x - thorn.anchor.x) * thorn.direction.x + (p.y - thorn.anchor.y) * thorn.direction.y
      const rest = Math.max(0, thorn.length - moved)
      const base = width * Math.max(radius > 0 ? ROOT.inner * radius : 0, shorterEdge(contours[thorn.contour], thorn.index))
      tips[thorn.contour].set(index, { at: { x: p.x + rest * thorn.direction.x, y: p.y + rest * thorn.direction.y }, base })
      stats.thorns++
      stats.longest = Math.max(stats.longest, thorn.length)
    })
    // 3. Backlash: each back thorn's site is put into the outline with its tip, and each dent is given to its thorn's
    // tip; the dents sink the outline once the tips have grown, from their bases.
    if (stats.thorns > 0 && (back > 0 || dent > 0)) {
      const lashed = backlash(result, resultMarks, thorns, anchorAt, tips, { back, dent, reverse }, unitsPerEm)
      result = lashed.polygon
      resultMarks = lashed.marks
      stats.backThorns = lashed.backThorns
    }
    if (stats.thorns > 0) {
      stats.applied = true
      const grown = result.contours.map((c, k) =>
        tips[k].size
          ? withThorns(c.points, tips[k], resultMarks?.[k])
          : { points: c.points, marks: resultMarks?.[k] ?? c.points.map(() => false), spans: [] },
      )
      if (dent > 0) sinkDents(grown)
      result = { ...result, contours: grown.map(({ points }) => ({ points, clockwise: signedArea(points) < 0 })) }
      resultMarks = grown.map(({ marks }) => marks)
    }
  }

  // 3. Refraction. Once a thorn is added, the outlines may cross, so nothing is checked: they are merged next.
  const glass = refraction > 0 ? (letter ?? inkBox(result)) : null
  if (glass) {
    const refracted = applyWarp(result, (scale) => fluteWarp(refraction * scale, flute, seed, glass), unitsPerEm, resultMarks, folds || stats.applied, maxPoints)
    warpStats(refracted.stats)
    result = refracted.polygon
    resultMarks = refracted.marks
    // Refraction warps every strip of the letter again, so it can multiply the vertices: keep them within the budget.
    const fitted = budget ? budget.fit(result) : result
    if (fitted !== result) {
      result = fitted
      resultMarks = undefined
    }
  }
  // The bases leave out anchors, which can leave a run of creases looking like a curve after all: break it up.
  if (stats.applied) {
    const marks = resultMarks
    result = { ...result, contours: result.contours.map((c, k) => breakRuns(c, marks?.[k], WARP_LIMITS.shortEdge * unitsPerEm)) }
  }
  return { polygon: result, stats }
}

/** A thorn's tip, and how far along the outline its base reaches on either side of the anchor (font units). */
interface Tip {
  at: Point
  base: number
  /** With Dent: how the outline sinks on either side of this thorn (see sinkDents). */
  dent?: Dent
}

/** A thorn as withThorns drew it: the indices of its tip and of its first and last vertex (its bases, or the tip where it has none). */
interface Span {
  from: number
  tip: number
  to: number
  dent?: Dent
}

/** How a dent sinks the outline (font units): along `inward` (a unit vector into the stroke), `depth` at the base, to nothing `reach` along. */
interface Dent {
  inward: Point
  depth: number
  reach: number
}

/**
 * The contour with each jumping anchor replaced by its tip. The thorn's base: a new anchor `base` along the outline
 * on either side, the anchors in between left out, so the thorn's two straight sides start there. A neighbouring
 * thorn keeps half of the outline between them; where a base would reach past that, the two share one base there.
 * `marks` flags crease vertices (see applyWarp); the tips and bases are not creases. `spans`: where each thorn is drawn.
 */
function withThorns(points: readonly Point[], tips: ReadonlyMap<number, Tip>, marks?: readonly boolean[]): { points: Point[]; marks: boolean[]; spans: Span[] } {
  const n = points.length
  const length = (i: number, j: number) => Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y)
  let perimeter = 0
  for (let i = 0; i < n; i++) perimeter += length(i, (i + 1) % n)
  const dropped = new Set<number>()
  const bases = new Map<number, { before: Point | null; after: Point | null }>()
  for (const [i, tip] of tips) {
    const side = (step: 1 | -1): Point | null => {
      // How much outline this thorn may take: half of it up to the next thorn, or nearly half of all of it.
      let arc = 0
      let neighbour = false
      for (let k = 0, at = i; k < n; k++) {
        const next = (at + step + n) % n
        arc += length(at, next)
        if (tips.has(next)) {
          neighbour = next !== i
          break
        }
        at = next
      }
      const room = neighbour ? arc / 2 : Math.min(arc, perimeter) * 0.45
      // Two thorns whose bases would pass the middle between them share one base there, put in by the first.
      const shared = neighbour && tip.base >= room
      let left = Math.min(tip.base, room)
      for (let k = 0, at = i; k < n; k++) {
        const next = (at + step + n) % n
        const edge = length(at, next)
        if (edge > left) return (shared && step < 0) || left <= 0 ? null : lerp(points[at], points[next], left / edge)
        left -= edge
        // Exactly on an anchor: the anchor itself is the base.
        if (left <= 0 || tips.has(next)) return null
        dropped.add(next)
        at = next
      }
      return null
    }
    bases.set(i, { before: side(-1), after: side(1) })
  }
  const out: Point[] = []
  const outMarks: boolean[] = []
  const spans: Span[] = []
  const push = (p: Point, mark: boolean) => {
    out.push(p)
    outMarks.push(mark)
  }
  for (let i = 0; i < n; i++) {
    const tip = tips.get(i)
    if (tip) {
      const { before, after } = bases.get(i)!
      const from = out.length
      if (before) push(before, false)
      push(tip.at, false)
      spans.push({ from, tip: out.length - 1, to: after ? out.length : out.length - 1, dent: tip.dent })
      if (after) push(after, false)
    } else if (!dropped.has(i)) push(points[i], marks?.[i] ?? false)
  }
  return { points: out, marks: outMarks, spans }
}

/** The shorter of the two edges at an anchor. */
function shorterEdge(points: readonly Point[], index: number): number {
  const n = points.length
  const p = points[index]
  const prev = points[(index - 1 + n) % n]
  const next = points[(index + 1) % n]
  return Math.min(Math.hypot(p.x - prev.x, p.y - prev.y), Math.hypot(next.x - p.x, next.y - p.y))
}

// ---- Backlash ----

/**
 * Step 3 (see the header), before the tips grow: measures the stroke behind each thorn. With `back`, each back thorn's
 * site goes into its contour as a new vertex (or onto the vertex it nearly falls on), its tip into `tips`, whose indices
 * move along; with `dent`, each measured thorn's tip gets its dent. Returns the outline, its crease marks (the new
 * vertices are no creases), and how many back thorns grew.
 */
function backlash(
  polygon: PolygonGlyph,
  marks: CreaseMarks | undefined,
  thorns: readonly Thorn[],
  anchorAt: readonly number[],
  tips: Map<number, Tip>[],
  { back, dent, reverse }: { back: number; dent: number; reverse: boolean },
  unitsPerEm: number,
): { polygon: PolygonGlyph; marks: CreaseMarks | undefined; backThorns: number } {
  const contours = polygon.contours.map((c) => c.points)
  const limit = BACKLASH.maxThickness * unitsPerEm
  const snap = BACKLASH.snap * unitsPerEm
  const arcs = contours.map(arcLengths)
  // The tips on each contour so far, by where they are along it, with their bases: the thorns', then each back thorn's.
  const taken = tips.map((contourTips, k) => [...contourTips].map(([i, tip]) => ({ arc: arcs[k].at[i], base: tip.base })))
  const inserts = contours.map(() => [] as { edge: number; t: number; at: Point; tip: Tip }[])
  let backThorns = 0
  thorns.forEach((thorn, t) => {
    const index = anchorAt[t]
    const tip = index >= 0 ? tips[thorn.contour].get(index) : undefined
    if (!tip) return
    const n = contours[thorn.contour].length
    // Into the stroke: against the thorn, or along it when reversed (the inward normal as the thorn was turned).
    const inward = reverse ? thorn.direction : { x: -thorn.direction.x, y: -thorn.direction.y }
    const anchorEdges = (k: number, e: number) => k === thorn.contour && (e === index || e === (index - 1 + n) % n)
    const far = farSide(contours, contours[thorn.contour][index], inward, limit, anchorEdges)
    if (!far) return
    if (dent > 0) {
      const reach = Math.max(BACKLASH.reachBases * tip.base, BACKLASH.reachThickness * far.distance)
      tip.dent = { inward, depth: dent * BACKLASH.depth * far.distance, reach }
    }
    if (back <= 0) return
    // On a vertex, or so near one that the new vertex would leave a sliver of an edge: that vertex is the site.
    const points = contours[far.contour]
    const m = points.length
    const edge = Math.hypot(points[(far.edge + 1) % m].x - points[far.edge].x, points[(far.edge + 1) % m].y - points[far.edge].y)
    const vertex = far.t * edge <= snap ? far.edge : (1 - far.t) * edge <= snap ? (far.edge + 1) % m : -1
    const arc = vertex >= 0 ? arcs[far.contour].at[vertex] : arcs[far.contour].at[far.edge] + far.t * edge
    // Clear of every tip on that contour by both bases, its own thorn's included (across a hairline, it is close by).
    const { perimeter } = arcs[far.contour]
    const apart = (other: number) => Math.min(Math.abs(arc - other), perimeter - Math.abs(arc - other))
    if (!taken[far.contour].every((o) => apart(o.arc) > Math.max(tip.base + o.base, snap))) return
    if (vertex >= 0 && tips[far.contour].has(vertex)) return
    const site = vertex >= 0 ? points[vertex] : far.at
    const length = BACKLASH.length * back * thorn.length
    // The other way from its thorn: out of the far side, or (reversed) back through the stroke.
    const backTip: Tip = { at: { x: site.x - length * thorn.direction.x, y: site.y - length * thorn.direction.y }, base: tip.base }
    taken[far.contour].push({ arc, base: tip.base })
    if (vertex >= 0) tips[far.contour].set(vertex, backTip)
    else inserts[far.contour].push({ edge: far.edge, t: far.t, at: far.at, tip: backTip })
    backThorns++
  })
  if (!inserts.some((list) => list.length > 0)) return { polygon, marks, backThorns }

  // Put the new sites in, each after its edge's first vertex, and move every tip's index along.
  const outMarks = contours.map((points, k) => marks?.[k] ?? points.map(() => false))
  const outContours = polygon.contours.map((c, k) => {
    const list = inserts[k].sort((a, b) => a.edge - b.edge || a.t - b.t)
    if (list.length === 0) return c
    const points: Point[] = []
    const pointMarks: boolean[] = []
    const moved = new Map<number, Tip>()
    let next = 0
    c.points.forEach((p, i) => {
      const tip = tips[k].get(i)
      if (tip) moved.set(points.length, tip)
      points.push(p)
      pointMarks.push(outMarks[k][i] ?? false)
      for (; next < list.length && list[next].edge === i; next++) {
        moved.set(points.length, list[next].tip)
        points.push(list[next].at)
        pointMarks.push(false)
      }
    })
    tips[k] = moved
    outMarks[k] = pointMarks
    // A vertex on an edge leaves the contour's area and direction as they were.
    return { ...c, points }
  })
  return { polygon: { ...polygon, contours: outContours }, marks: outMarks, backThorns }
}

/**
 * Sinks the outline on either side of each thorn with a dent (step 3, see the header), once the tips have grown. From
 * the thorn's base on, each vertex moves along the dent's inward direction, by its depth at the base, linearly less to
 * nothing at its reach (along the outline as it was before this dent). A side stops at another thorn's tip or base, or
 * at a vertex the inward direction does not lead into its contour's ink from (the outline has turned a corner). The
 * stroke is measured on the outline without its tips (each thorn's bases joined straight), so a thorn crossing it does
 * not count: no vertex moves more than BACKLASH.maxShare of its way to the stroke's next edge inward, so a dent never
 * reaches the stroke's other side, and each dent sees the ones before it.
 */
function sinkDents(grown: readonly { points: Point[]; spans: readonly Span[] }[]): void {
  // The outline without its tips, and where each vertex of the grown outline is in it (-1 for a tip).
  const strokes: Point[][] = []
  const inStroke: number[][] = []
  grown.forEach(({ points, spans }, k) => {
    const tips = new Set(spans.map((span) => span.tip))
    strokes[k] = []
    inStroke[k] = points.map((p, i) => (tips.has(i) ? -1 : strokes[k].push(p) - 1))
  })
  grown.forEach(({ points, spans }, k) => {
    if (!spans.some((span) => span.dent)) return
    const n = points.length
    const stroke = strokes[k]
    const m = stroke.length
    const side = inkSide(strokes, k)
    // Which thorn each vertex is drawn for (its tip and bases), or -1.
    const owner = new Array<number>(n).fill(-1)
    spans.forEach((span, s) => {
      for (let i = span.from; i <= span.to; i++) owner[i] = s
    })
    spans.forEach(({ tip, dent }, s) => {
      if (!dent) return
      // Only edges within depth / maxShare of a vertex can cap its move.
      const within = dent.depth / BACKLASH.maxShare
      for (const step of [1, -1]) {
        const at = (walked: number) => (((tip + step * walked) % n) + n) % n
        // Every vertex this side moves lies within its reach of the first (its base), and the dent moves edges by at
        // most its depth on the way.
        const near = edgesNear(strokes, [points[at(1)]], dent.reach + dent.depth + within)
        let arc = 0
        let previous: Point | null = null
        // The edges near the next BACKLASH.batch vertices along, from `near`: a few, where `near` can be thousands.
        let nearBatch: [number, number][] = []
        for (let walked = 1; walked < n; walked++) {
          const j = at(walked)
          if ((walked - 1) % BACKLASH.batch === 0) {
            const batch = Array.from({ length: Math.min(BACKLASH.batch, n - walked) }, (_, b) => points[at(walked + b)])
            nearBatch = edgesNear(strokes, batch, dent.depth + within, near)
          }
          if (owner[j] !== -1 && (owner[j] !== s || j === tip)) break
          const q = points[j]
          if (previous) arc += Math.hypot(q.x - previous.x, q.y - previous.y)
          previous = q
          if (arc >= dent.reach) break
          const own = inStroke[k][j]
          if (!leadsInto(stroke, own, dent.inward, side)) break
          const clear = clearance(strokes, q, dent.inward, nearBatch, within, (c, e) => c === k && (e === own || e === (own - 1 + m) % m))
          const move = Math.min(dent.depth * (1 - arc / dent.reach), BACKLASH.maxShare * clear)
          points[j] = stroke[own] = { x: q.x + move * dent.inward.x, y: q.y + move * dent.inward.y }
        }
      }
    })
  })
}

/**
 * Which side of contour k's edges its ink lies on, by the nonzero rule over all the contours: 1 for the left (as for a
 * counter-clockwise outer contour), -1 for the right. Judged just beside the middle of its longest edge that has ink on
 * one side only (an edge inside another contour's ink, where contours overlap, has it on both).
 */
function inkSide(contours: readonly (readonly Point[])[], k: number): number {
  const points = contours[k]
  const n = points.length
  const edges = points.map((p, i) => ({ i, length: Math.hypot(points[(i + 1) % n].x - p.x, points[(i + 1) % n].y - p.y) }))
  edges.sort((a, b) => b.length - a.length || a.i - b.i)
  // A few tries: a contour all inside another's ink has ink on both sides of every edge.
  for (const { i, length } of edges.slice(0, 8)) {
    if (length === 0) break
    const a = points[i]
    const b = points[(i + 1) % n]
    // A thousandth of the edge to either side of its middle.
    const offset = { x: -(b.y - a.y) * 1e-3, y: (b.x - a.x) * 1e-3 }
    const middle = lerp(a, b, 0.5)
    const left = windingAt(contours, { x: middle.x + offset.x, y: middle.y + offset.y }) !== 0
    const right = windingAt(contours, { x: middle.x - offset.x, y: middle.y - offset.y }) !== 0
    if (left !== right) return left ? 1 : -1
  }
  return signedArea(points) > 0 ? 1 : -1
}

/** Whether `direction` leaves vertex `index` of a closed contour into its ink (on side `side` of its edges, see inkSide): inside the corner its two edges make there. */
function leadsInto(points: readonly Point[], index: number, direction: Point, side: number): boolean {
  const n = points.length
  const q = points[index]
  // Ink on the left of prev → q → next: the ink's corner sweeps counter-clockwise from the edge to next round to the
  // edge back to prev; on the right, from the edge back to prev round to the edge to next.
  const start = points[(index + (side > 0 ? 1 : n - 1)) % n]
  const end = points[(index + (side > 0 ? n - 1 : 1)) % n]
  const ux = start.x - q.x
  const uy = start.y - q.y
  const sweep = (x: number, y: number) => {
    const angle = Math.atan2(ux * y - uy * x, ux * x + uy * y)
    return angle < 0 ? angle + 2 * Math.PI : angle
  }
  const into = sweep(direction.x, direction.y)
  return into > 0 && into < sweep(end.x - q.x, end.y - q.y)
}

/**
 * The edges of the contours (of at least 3 points; or of `among`), as [contour, first vertex], whose boxes come within
 * `within` of the box around `points`.
 */
function edgesNear(contours: readonly (readonly Point[])[], points: readonly Point[], within: number, among?: readonly [number, number][]): [number, number][] {
  const minX = Math.min(...points.map((p) => p.x)) - within
  const maxX = Math.max(...points.map((p) => p.x)) + within
  const minY = Math.min(...points.map((p) => p.y)) - within
  const maxY = Math.max(...points.map((p) => p.y)) + within
  const meets = (contour: number, edge: number) => {
    const ring = contours[contour]
    const a = ring[edge]
    const b = ring[(edge + 1) % ring.length]
    return Math.max(a.x, b.x) >= minX && Math.min(a.x, b.x) <= maxX && Math.max(a.y, b.y) >= minY && Math.min(a.y, b.y) <= maxY
  }
  if (among) return among.filter(([contour, edge]) => meets(contour, edge))
  const out: [number, number][] = []
  contours.forEach((ring, contour) => {
    if (ring.length >= 3) for (let edge = 0; edge < ring.length; edge++) if (meets(contour, edge)) out.push([contour, edge])
  })
  return out
}

/** Where a ray crosses an edge: the edge (from its vertex `edge`, at `t` along it), how far along the ray, and the point. */
interface RayHit {
  contour: number
  edge: number
  t: number
  distance: number
  at: Point
}

/**
 * Where a ray from `from` along `direction` (a unit vector) leaves the ink for good: past the edges of contours that
 * overlap inside it, at the first edge with no ink beyond it. Null where the ray starts out of the ink (the direction
 * points away from it), or leaves it only beyond `limit`. `skip` leaves edges out (the anchor's own).
 */
function farSide(contours: readonly (readonly Point[])[], from: Point, direction: Point, limit: number, skip: (contour: number, edge: number) => boolean): RayHit | null {
  const hits = castRay(contours, from, direction, skip)
  // Between two crossings the ray is all in the ink or all out of it, so the middle of each stretch tells which.
  const inInk = (a: number, b: number) => {
    const middle = (a + b) / 2
    return windingAt(contours, { x: from.x + middle * direction.x, y: from.y + middle * direction.y }) !== 0
  }
  if (hits.length === 0 || !inInk(0, hits[0].distance)) return null
  for (let h = 0; h < hits.length; h++) {
    const hit = hits[h]
    if (hit.distance > limit) return null
    const next = hits[h + 1]
    // Two edges crossed at the same place (a vertex, or contours that meet there) make no stretch between them.
    if (next && next.distance - hit.distance <= 1e-9 * limit) continue
    if (!next || !inInk(hit.distance, next.distance)) return hit
  }
  return null
}

/** Every edge of the contours (of at least 3 points) a ray from `from` along `direction` crosses, nearest first; `skip` leaves edges out. */
function castRay(contours: readonly (readonly Point[])[], from: Point, direction: Point, skip: (contour: number, edge: number) => boolean): RayHit[] {
  const hits: RayHit[] = []
  contours.forEach((points, contour) => {
    const n = points.length
    if (n < 3) return
    for (let edge = 0; edge < n; edge++) {
      if (skip(contour, edge)) continue
      const a = points[edge]
      const b = points[(edge + 1) % n]
      const t = along(from, direction, a, b)
      if (t) hits.push({ contour, edge, t: t.t, distance: t.distance, at: lerp(a, b, t.t) })
    }
  })
  return hits.sort((p, q) => p.distance - q.distance || p.contour - q.contour || p.edge - q.edge)
}

/** How far a ray from `from` along `direction` runs before it crosses one of `edges` (as [contour, first vertex]; `skip` leaves edges out): at most `within`. */
function clearance(
  contours: readonly (readonly Point[])[],
  from: Point,
  direction: Point,
  edges: readonly (readonly [number, number])[],
  within: number,
  skip: (contour: number, edge: number) => boolean,
): number {
  let nearest = within
  for (const [contour, edge] of edges) {
    if (skip(contour, edge)) continue
    const points = contours[contour]
    const hit = along(from, direction, points[edge], points[(edge + 1) % points.length])
    if (hit && hit.distance < nearest) nearest = hit.distance
  }
  return nearest
}

/** Where a ray from `from` along `direction` crosses the edge from a to b: how far along the ray, and at `t` along the edge (0 ≤ t < 1); or null. */
function along(from: Point, direction: Point, a: Point, b: Point): { distance: number; t: number } | null {
  const ex = b.x - a.x
  const ey = b.y - a.y
  const denominator = direction.x * ey - direction.y * ex
  if (denominator === 0) return null
  const wx = a.x - from.x
  const wy = a.y - from.y
  const distance = (wx * ey - wy * ex) / denominator
  const t = (wx * direction.y - wy * direction.x) / denominator
  return distance > 0 && t >= 0 && t < 1 ? { distance, t } : null
}

/** The nonzero winding number of the contours around `p`: not 0 in the ink, as the final merge fills it. */
function windingAt(contours: readonly (readonly Point[])[], p: Point): number {
  let winding = 0
  for (const points of contours) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j]
      const b = points[i]
      const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
      if (a.y <= p.y) {
        if (b.y > p.y && side > 0) winding++
      } else if (b.y <= p.y && side < 0) winding--
    }
  }
  return winding
}

/** How far along a closed contour each vertex is from its first, and its whole length. */
function arcLengths(points: readonly Point[]): { at: number[]; perimeter: number } {
  const at: number[] = []
  let perimeter = 0
  points.forEach((p, i) => {
    at.push(perimeter)
    const q = points[(i + 1) % points.length]
    perimeter += Math.hypot(q.x - p.x, q.y - p.y)
  })
  return { at, perimeter }
}

// ---- Roots ----

/** A root's warp, and how far it moves its anchor (font units). */
interface Pull extends Warp {
  shift: number
}

/** Mesh vertices: 0 is the anchor, 1 … sides the inner ring, then the outer ring, both counter-clockwise. */
const MESH = (() => {
  const k1 = (k: number) => (k + 1) % ROOT.sides
  const inner = (k: number) => 1 + k
  const outer = (k: number) => 1 + ROOT.sides + k
  const triangles: [number, number, number][] = []
  const edges: [number, number][] = []
  for (let k = 0; k < ROOT.sides; k++) {
    // Per sector: the fan triangle, then the cell between the rings, split along its diagonal. All counter-clockwise.
    triangles.push([0, inner(k), inner(k1(k))], [inner(k), outer(k), outer(k1(k))], [inner(k), outer(k1(k)), inner(k1(k))])
    edges.push([0, inner(k)], [inner(k), inner(k1(k))], [inner(k), outer(k)], [inner(k), outer(k1(k))], [outer(k), outer(k1(k))])
  }
  return { triangles, edges }
})()

/**
 * Each thorn's root at `scale` × its full move, or null where no move keeps the mesh one-to-one. A root is
 * centred where the earlier ones moved its anchor.
 */
function rootPulls(thorns: readonly Thorn[], radius: number, scale: number): (Pull | null)[] {
  const done: Pull[] = []
  return thorns.map((thorn) => {
    const centre = done.reduce((p, pull) => pull.map(p), thorn.anchor)
    const pull = rootPull(centre, thorn, radius, scale)
    if (pull) done.push(pull)
    return pull
  })
}

function rootPull(centre: Point, thorn: Thorn, radius: number, scale: number): Pull | null {
  const n = thorn.direction
  const t = { x: -n.y, y: n.x }
  const sides = ROOT.sides
  // Corner k of each ring sits at angle (2k + 1)·180°/sides from the thorn, so a flat side faces it.
  const angles = Array.from({ length: sides }, (_, k) => ((2 * k + 1) * Math.PI) / sides)
  const ring = (r: number) => angles.map((a) => ({ x: centre.x + r * (Math.cos(a) * n.x + Math.sin(a) * t.x), y: centre.y + r * (Math.cos(a) * n.y + Math.sin(a) * t.y) }))
  const from = [centre, ...ring(ROOT.inner * radius), ...ring(radius)]
  const area = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)

  let shift = Math.min(ROOT.pull * thorn.length, ROOT.maxPull * radius) * scale
  for (let round = 0; round <= ROOT.halvings && shift > 0; round++, shift /= 2) {
    const moves: Point[] = from.map(() => ({ x: 0, y: 0 }))
    moves[0] = { x: shift * n.x, y: shift * n.y }
    angles.forEach((a, k) => {
      const follow = ROOT.back + ((ROOT.front - ROOT.back) * (1 + Math.cos(a))) / 2
      const forward = shift * follow * (1 + ROOT.lean * thorn.lean * Math.sin(a))
      const across = -shift * ROOT.squeeze * Math.sin(a)
      moves[1 + k] = { x: forward * n.x + across * t.x, y: forward * n.y + across * t.y }
    })
    const to = from.map((p, i) => ({ x: p.x + moves[i].x, y: p.y + moves[i].y }))
    if (MESH.triangles.every(([i, j, k]) => area(to[i], to[j], to[k]) >= ROOT.minArea * area(from[i], from[j], from[k]))) {
      return meshWarp(from, moves, centre, n, radius, shift)
    }
  }
  return null
}

/** The warp that moves each mesh vertex by its move, linearly inside each triangle, and leaves everything beyond the mesh. */
function meshWarp(from: readonly Point[], moves: readonly Point[], centre: Point, n: Point, radius: number, shift: number): Pull {
  const sides = ROOT.sides
  const radius2 = radius * radius
  return {
    shift,
    map(p) {
      const dx = p.x - centre.x
      const dy = p.y - centre.y
      if (dx * dx + dy * dy >= radius2) return p
      // The sector: corner k sits at angle (2k + 1)·180°/sides from the thorn (see rootPull).
      const angle = Math.atan2(n.x * dy - n.y * dx, n.x * dx + n.y * dy)
      const sector = (((Math.floor((angle * sides) / (2 * Math.PI) - 0.5) % sides) + sides) % sides)
      let best: [number, number, number] | null = null
      let bestWeights: [number, number, number] = [0, 0, 0]
      let bestMin = -Infinity
      for (let m = 0; m < 3; m++) {
        const triangle = MESH.triangles[3 * sector + m]
        const w = barycentric(p, from[triangle[0]], from[triangle[1]], from[triangle[2]])
        const least = Math.min(w[0], w[1], w[2])
        if (least > bestMin) {
          best = triangle
          bestWeights = w
          bestMin = least
        }
      }
      // Beyond the outer ring (between it and its corners' circle): nothing moves.
      if (!best || bestMin < -1e-9) return p
      let x = p.x
      let y = p.y
      for (let m = 0; m < 3; m++) {
        x += bestWeights[m] * moves[best[m]].x
        y += bestWeights[m] * moves[best[m]].y
      }
      return { x, y }
    },
    creases(a, b) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const length2 = dx * dx + dy * dy
      if (length2 === 0) return []
      // Skip segments that pass outside the corners' circle.
      const along = clamp(((centre.x - a.x) * dx + (centre.y - a.y) * dy) / length2, 0, 1)
      if (Math.hypot(a.x + dx * along - centre.x, a.y + dy * along - centre.y) >= radius) return []
      const ts: number[] = []
      for (const [i, j] of MESH.edges) {
        const p = from[i]
        const ex = from[j].x - p.x
        const ey = from[j].y - p.y
        const denominator = dx * ey - dy * ex
        if (denominator === 0) continue
        const wx = p.x - a.x
        const wy = p.y - a.y
        const t = (wx * ey - wy * ex) / denominator
        const u = (wx * dy - wy * dx) / denominator
        if (t > 0 && t < 1 && u >= -1e-12 && u <= 1 + 1e-12) ts.push(t)
      }
      ts.sort((p, q) => p - q)
      return ts.filter((t, k) => k === 0 || t - ts[k - 1] > 1e-12)
    },
  }
}

/** The warps one after another, as one warp: its creases are each warp's, traced back through the ones before. */
function compose(pulls: readonly (Pull | null)[]): Warp {
  const warps = pulls.filter((pull): pull is Pull => pull !== null)
  const creases = (from: number, a: Point, b: Point): number[] => {
    if (from === warps.length) return []
    const warp = warps[from]
    const bounds = [0, ...warp.creases(a, b), 1]
    const out: number[] = []
    for (let k = 0; k + 1 < bounds.length; k++) {
      const t0 = bounds[k]
      const t1 = bounds[k + 1]
      // Between two creases the warp is linear, so the piece's image is straight and its parameters scale linearly.
      const p0 = warp.map(t0 === 0 ? a : lerp(a, b, t0))
      const p1 = warp.map(t1 === 1 ? b : lerp(a, b, t1))
      for (const s of creases(from + 1, p0, p1)) out.push(t0 + s * (t1 - t0))
      if (k + 2 < bounds.length) out.push(t1)
    }
    return out
  }
  return {
    map: (p) => warps.reduce((q, warp) => warp.map(q), p),
    creases: (a, b) => creases(0, a, b),
  }
}

/** Barycentric weights of p in the triangle a, b, c. */
function barycentric(p: Point, a: Point, b: Point, c: Point): [number, number, number] {
  const d = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
  const wb = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / d
  const wc = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / d
  return [1 - wb - wc, wb, wc]
}

// ---- Refraction ----

/**
 * Fluted glass at `strength` (0–1): vertical strips `width` wide from the glyph's origin, over `letter` (its ink box
 * before the tips grow) and one strip either side; beyond them the glass is plain and leaves every point where it is,
 * so a thorn's far end gains no points however far it reaches. The middle of strip k shows its part of the letter
 * magnified about the strip's middle, slid sideways and moved up or down (seeded); the seams between strips are
 * squeezed to join them up, so the strips look cut apart. Every piece is linear, so straight edges bend only at the
 * seams' sides.
 *
 * y moves by a shift that depends on x alone, so the map is one-to-one while x keeps rising. With half a seam s each
 * side of a strip's edge, magnification m and room r = 2s - (m - 1)(w - 2s) (r ≥ 0.09w, as s = 0.15w and m - 1 ≤ 0.3),
 * every slide lies within ±0.4r, and:
 * - inside a strip, x rises by m (fluted) or 1 (plain);
 * - a seam between fluted strips sliding by a (left) and b (right) is r + b - a ≥ 0.2r wide on the image;
 * - a seam between a fluted strip sliding by a and plain glass is r + (m - 1)(w/2 - s) ∓ a ≥ 0.6r wide (- with the
 *   fluted strip on the left): the plain side does not magnify, which only widens it;
 * - a seam between plain strips is plain.
 * The letter lies in fluted strips and the seams between them, a whole strip from plain glass, so it looks exactly as
 * through glass that goes on forever.
 */
function fluteWarp(strength: number, width: number, seed: number, letter: { minX: number; maxX: number }): Warp {
  const seam = (FLUTE.seam * width) / 2
  const magnify = 1 + FLUTE.magnify * strength
  // How wide a seam's image is when its two strips do not slide: x keeps rising while they slide apart by less.
  const room = 2 * seam - (magnify - 1) * (width - 2 * seam)
  // The fluted strips: the letter's, and one either side.
  const first = Math.floor(letter.minX / width) - 1
  const last = Math.floor(letter.maxX / width) + 1
  const fluted = (k: number) => k >= first && k <= last
  const slide = (k: number) => strength * FLUTE.slide * (room / 2) * ((hashInts(seed, CHANNEL.slide, k) / UINT) * 2 - 1)
  const lift = (k: number) => strength * FLUTE.lift * width * ((hashInts(seed, CHANNEL.lift, k) / UINT) * 2 - 1)
  /** The image of x (and the lift there) inside the middle of strip k: where plain, x itself. */
  const middle = (k: number, x: number) => {
    if (!fluted(k)) return { x, lift: 0 }
    const centre = (k + 0.5) * width
    return { x: centre + slide(k) + magnify * (x - centre), lift: lift(k) }
  }
  return {
    map(p) {
      const k = Math.floor(p.x / width)
      const u = p.x - k * width
      // In a seam: between the middles of the strips on either side of it.
      const seamOf = u < seam ? k : u > width - seam ? k + 1 : null
      // Plain glass, in a strip or a seam between two.
      if (seamOf === null ? !fluted(k) : !fluted(seamOf - 1) && !fluted(seamOf)) return p
      if (seamOf === null) {
        const m = middle(k, p.x)
        return { x: m.x, y: p.y + m.lift }
      }
      const x0 = seamOf * width - seam
      const left = middle(seamOf - 1, x0)
      const right = middle(seamOf, x0 + 2 * seam)
      const f = (p.x - x0) / (2 * seam)
      return { x: left.x + (right.x - left.x) * f, y: p.y + left.lift + (right.lift - left.lift) * f }
    },
    creases(a, b) {
      if (a.x === b.x) return []
      const lo = Math.min(a.x, b.x)
      const hi = Math.max(a.x, b.x)
      const ts: number[] = []
      // Only the seams beside a fluted strip bend: from the first fluted strip's left edge to the last one's right.
      for (let k = Math.max(Math.floor((lo - seam) / width), first); k * width - seam < hi && k <= last + 1; k++) {
        for (const x of [k * width - seam, k * width + seam]) {
          if (x > lo && x < hi) ts.push((x - a.x) / (b.x - a.x))
        }
      }
      return ts.sort((p, q) => p - q)
    },
  }
}

// ---- Helpers ----

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** The index of the vertex nearest to `p` (of those `allowed`), if one lies within `within`; otherwise -1. */
function nearest(points: readonly Point[], p: Point, within: number, allowed?: (index: number) => boolean): number {
  let best = -1
  let bestDistance = within
  points.forEach((q, i) => {
    const distance = Math.hypot(q.x - p.x, q.y - p.y)
    if (distance <= bestDistance && (!allowed || allowed(i))) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

/**
 * Whether an anchor of a contour is on the letter's outside: it lies inside an even number of the other contours (it
 * bounds ink from outside, not a counter). Per anchor, so where contours overlap (as in many variable fonts' instances)
 * the anchors outside the others count and those inside them do not. With `clearance`, an anchor must also lie at
 * least that far from every contour its own crosses (part inside it, part outside: overlapping ink, not a counter
 * within the letter or a dot beside it). Each contour's box is measured once, and which contours cross when first asked.
 */
function outsideTest(contours: readonly (readonly Point[])[], clearance = 0): (contour: number, p: Point) => boolean {
  const boxes = contours.map((points): Box | null => {
    if (points.length < 3) return null
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const q of points) {
      box.minX = Math.min(box.minX, q.x)
      box.minY = Math.min(box.minY, q.y)
      box.maxX = Math.max(box.maxX, q.x)
      box.maxY = Math.max(box.maxY, q.y)
    }
    return box
  })
  const near = (box: Box, p: Point, by: number) => p.x >= box.minX - by && p.x <= box.maxX + by && p.y >= box.minY - by && p.y <= box.maxY + by
  const crossing = new Map<number, boolean>()
  const crosses = (a: number, b: number) => {
    const pair = Math.min(a, b) * contours.length + Math.max(a, b)
    let known = crossing.get(pair)
    if (known === undefined) {
      known = partlyInside(contours[a], contours[b], boxes[b]) || partlyInside(contours[b], contours[a], boxes[a])
      crossing.set(pair, known)
    }
    return known
  }
  return (contour, p) => {
    let depth = 0
    for (let i = 0; i < contours.length; i++) {
      const box = boxes[i]
      if (i === contour || !box || !near(box, p, clearance)) continue
      if (contains(contours[i], p)) depth++
      else if (clearance > 0 && crosses(contour, i) && distanceToOutline(contours[i], p) < clearance) return false
    }
    return depth % 2 === 0
  }
}

/** How many of a contour's points partlyInside tests at most, evenly spaced: dense outlines have thousands. */
const CROSS_SAMPLES = 64

/** Whether some points of `points` (up to CROSS_SAMPLES of them) lie inside `other` (whose box is `box`) and some outside it. */
function partlyInside(points: readonly Point[], other: readonly Point[], box: Box | null): boolean {
  if (!box) return false
  const step = Math.max(1, Math.floor(points.length / CROSS_SAMPLES))
  let inside = false
  let outside = false
  for (let i = 0; i < points.length; i += step) {
    const p = points[i]
    if (p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY && contains(other, p)) inside = true
    else outside = true
    if (inside && outside) return true
  }
  return false
}

/** The distance from `p` to the nearest edge of a closed outline. */
function distanceToOutline(points: readonly Point[], p: Point): number {
  let best = Infinity
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]
    const b = points[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)))
  }
  return best
}

/** Even-odd point-in-polygon test. */
function contains(points: readonly Point[], p: Point): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * Unit vector at an anchor pointing away from the ink: the mean of its two edges' outward normals. `side`: 1 when the
 * contour runs counter-clockwise (positive area): the ink lies to the left of each edge, so outward is to its right.
 */
function outwardNormal(points: readonly Point[], index: number, side: number): Point | null {
  const n = points.length
  const prev = points[(index - 1 + n) % n]
  const p = points[index]
  const next = points[(index + 1) % n]
  const edgeNormal = (a: Point, b: Point): Point | null => {
    const d = unit(b.x - a.x, b.y - a.y)
    return d && { x: side * d.y, y: -side * d.x }
  }
  const a = edgeNormal(prev, p)
  const b = edgeNormal(p, next)
  if (!a || !b) return a ?? b
  const x = a.x + b.x
  const y = a.y + b.y
  const length = Math.hypot(x, y)
  // A hairpin (the edges fold back on each other): follow the incoming edge's normal.
  return length > 1e-9 ? { x: x / length, y: y / length } : a
}

function unit(x: number, y: number): Point | null {
  const length = Math.hypot(x, y)
  return length > 0 && Number.isFinite(length) ? { x: x / length, y: y / length } : null
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
