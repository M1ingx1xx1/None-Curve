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
// Each thorn grows in three steps:
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
// 3. Refraction (optional): the letter as seen through fluted glass. Vertical strips (Flute width), each
//    showing its part of the letter magnified about its middle, slid sideways and lifted or dropped, with the
//    seams between them squeezed into steep breaks. x moves by a rising piecewise-linear function and y by a
//    shift that depends on x alone, so the map is one-to-one at any strength. The glass covers only the letter
//    (and a strip either side): a thorn's far end, which can reach across the canvas, is left as it is.
// Reach is a share of the canvas diagonal: the app gives that diagonal in em (canvasEm), so at Reach 100% a thorn
// can span the whole canvas whatever the text size.
// A thorn may cross the letter or another thorn; the outlines are then merged at the end of the Experimental
// effects (overlaps.ts), as when an effect folds.
// Reverse turns every thorn round, so it shoots into the letter along the inward normal: the same anchors, turns,
// lengths, leans, roots and bases, only each direction negated. Inside a stroke the thorn carves a white slit; where
// it crosses a counter or comes out past the far side, the merge (nonzero) shows it as an ink spike.

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

/** Used where older saved settings lack the newer sliders (Refraction: off). */
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

export interface ThornStats {
  applied: boolean
  /** Anchors that jumped. */
  thorns: number
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

export const emptyThornStats = (): ThornStats => ({ applied: false, thorns: 0, longest: 0, roots: 0, reducedContours: 0, fallbackContours: 0, tooComplex: false })

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
    if (stats.thorns > 0) {
      stats.applied = true
      const grown = result.contours.map((c, k) =>
        tips[k].size ? withThorns(c.points, tips[k], resultMarks?.[k]) : { points: c.points, marks: resultMarks?.[k] ?? c.points.map(() => false) },
      )
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
}

/**
 * The contour with each jumping anchor replaced by its tip. The thorn's base: a new anchor `base` along the outline
 * on either side, the anchors in between left out, so the thorn's two straight sides start there. A neighbouring
 * thorn keeps half of the outline between them; where a base would reach past that, the two share one base there.
 * `marks` flags crease vertices (see applyWarp); the tips and bases are not creases.
 */
function withThorns(points: readonly Point[], tips: ReadonlyMap<number, Tip>, marks?: readonly boolean[]): { points: Point[]; marks: boolean[] } {
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
  const push = (p: Point, mark: boolean) => {
    out.push(p)
    outMarks.push(mark)
  }
  for (let i = 0; i < n; i++) {
    const tip = tips.get(i)
    if (tip) {
      const { before, after } = bases.get(i)!
      if (before) push(before, false)
      push(tip.at, false)
      if (after) push(after, false)
    } else if (!dropped.has(i)) push(points[i], marks?.[i] ?? false)
  }
  return { points: out, marks: outMarks }
}

/** The shorter of the two edges at an anchor. */
function shorterEdge(points: readonly Point[], index: number): number {
  const n = points.length
  const p = points[index]
  const prev = points[(index - 1 + n) % n]
  const next = points[(index + 1) % n]
  return Math.min(Math.hypot(p.x - prev.x, p.y - prev.y), Math.hypot(next.x - p.x, next.y - p.y))
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
