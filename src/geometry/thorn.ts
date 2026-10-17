// Experimental Thorn: a few anchors of each letter grow into long, straight thorns that pull the letter along.
// Pure functions in font units; no React, no DOM, no Math.random.
//
// Only anchors on the letter's outside (contours not inside another contour) grow thorns, away from the ink.
// Which anchors, in which direction and how far all come from an integer hash of the shared Experimental seed
// and the anchor's position, so the same seed and outline always give the same thorns, and a new seed moves them.
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
// 2. Tip: the anchor jumps the rest of the reach, a sharp straight thorn. Its base (Width) reaches along the
//    outline on either side, up to the root's inner ring, so the thorn narrows on from the root.
// 3. Refraction (optional): the letter as seen through fluted glass. Vertical strips (Flute width), each
//    showing its part of the letter magnified about its middle, slid sideways and lifted or dropped, with the
//    seams between them squeezed into steep breaks. x moves by a rising piecewise-linear function and y by a
//    shift that depends on x alone, so the map is one-to-one at any strength.
// A thorn may cross the letter or another thorn; the outlines are then merged at the end of the Experimental
// effects (overlaps.ts), as when an effect folds.

import { hashInts } from './distortion'
import { signedArea } from './flatten'
import type { Point, PolygonContour, PolygonGlyph, ThornParams } from './types'
import { applyWarp, curveLikeRuns, WARP_LIMITS, type CreaseMarks, type Warp, type WarpStats } from './warp'

export const THORN_LIMITS = {
  minCount: 1,
  maxCount: 12,
  /** Longest jump, as a share of the em. */
  maxReach: 2,
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
}

export const emptyThornStats = (): ThornStats => ({ applied: false, thorns: 0, longest: 0, roots: 0, reducedContours: 0, fallbackContours: 0 })

/** Channel numbers keep Thorn's random numbers apart from the other effects' for the same seed. */
const CHANNEL = { pick: 0x5a1, direction: 0x5a2, distance: 0x5a3, lean: 0x5a4, slide: 0x5a5, lift: 0x5a6 } as const
const UINT = 0x1_0000_0000

export function thornIsOn(params: ThornParams | undefined): params is ThornParams {
  return !!params && params.enabled && finite(params.count, 0) >= THORN_LIMITS.minCount && finite(params.reach, 0) > 0
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
 * refraction warps are not checked either (see applyWarp).
 */
export function applyThorn(
  polygon: PolygonGlyph,
  params: ThornParams,
  seed: number,
  unitsPerEm: number,
  marks?: CreaseMarks,
  folds = false,
): { polygon: PolygonGlyph; stats: ThornStats } {
  const stats = emptyThornStats()
  const count = Math.round(clamp(finite(params.count, 3), THORN_LIMITS.minCount, THORN_LIMITS.maxCount))
  const reach = clamp(finite(params.reach, 0.5), 0, THORN_LIMITS.maxReach) * unitsPerEm
  const spread = clamp(finite(params.spread, 0.5), 0, 1)
  const width = clamp(finite(params.width, 1), THORN_LIMITS.minWidth, 1)
  const radius = clamp(finite(params.root, THORN_FALLBACK.root), 0, 1) * THORN_LIMITS.maxRoot * unitsPerEm
  const refraction = clamp(finite(params.refraction, 0), 0, 1)
  const flute = clamp(finite(params.flute, THORN_FALLBACK.flute), THORN_LIMITS.minFlute, THORN_LIMITS.maxFlute) * unitsPerEm
  const contours = polygon.contours.map((c) => c.points)

  // Candidates: every anchor of an outside contour, ranked by a hash of the seed and its position.
  const candidates: { contour: number; index: number; rank: number }[] = []
  contours.forEach((points, contour) => {
    if (points.length < 3 || !isOutside(contours, contour)) return
    points.forEach((p, index) => {
      candidates.push({ contour, index, rank: hashInts(seed, CHANNEL.pick, Math.round(p.x), Math.round(p.y), index) })
    })
  })
  candidates.sort((a, b) => a.rank - b.rank || a.contour - b.contour || a.index - b.index)

  const thorns: Thorn[] = []
  for (const { contour, index } of reach > 0 ? candidates.slice(0, count) : []) {
    const points = contours[contour]
    const p = points[index]
    const normal = outwardNormal(points, index)
    if (!normal) continue
    const key = [Math.round(p.x), Math.round(p.y), index] as const
    const turn = (hashInts(seed, CHANNEL.direction, ...key) / UINT - 0.5) * spread * Math.PI
    const share = THORN_LIMITS.minShare + (1 - THORN_LIMITS.minShare) * (hashInts(seed, CHANNEL.distance, ...key) / UINT)
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    thorns.push({
      contour,
      index,
      anchor: p,
      direction: { x: normal.x * cos - normal.y * sin, y: normal.x * sin + normal.y * cos },
      length: reach * share,
      lean: (hashInts(seed, CHANNEL.lean, ...key) / UINT) * 2 - 1,
    })
  }

  let result = polygon
  let resultMarks = marks
  const warpStats = (s: WarpStats) => {
    stats.reducedContours += s.reducedContours
    stats.fallbackContours += s.fallbackContours
  }

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
      const warped = applyWarp(result, warpAt, unitsPerEm, kept, folds)
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
  if (refraction > 0 && result.contours.length > 0) {
    const refracted = applyWarp(result, (scale) => fluteWarp(refraction * scale, flute, seed), unitsPerEm, resultMarks, folds || stats.applied)
    warpStats(refracted.stats)
    result = refracted.polygon
    resultMarks = refracted.marks
  }
  // The bases leave out anchors, which can leave a run of creases looking like a curve after all: break it up.
  if (stats.applied) {
    const marks = resultMarks
    result = { ...result, contours: result.contours.map((c, k) => breakRuns(c, marks?.[k], WARP_LIMITS.shortEdge * unitsPerEm)) }
  }
  return { polygon: result, stats }
}

/**
 * The contour without the creases (`marks`) that make a curve-like run long enough (see curveLikeRuns), weakest turn
 * first, like the warps' tidying but with no drift limit: it only runs once a thorn is added, and the outlines are
 * merged next anyway. Such a crease turns gently between short edges, so leaving it out barely moves the outline.
 */
function breakRuns(contour: PolygonContour, marks: readonly boolean[] | undefined, shortEdge: number): PolygonContour {
  if (!marks) return contour
  let points = contour.points
  let kept = marks
  for (let round = 0; round < WARP_LIMITS.maxTidyRounds; round++) {
    const m = points.length
    const drop = new Set<number>()
    for (const run of curveLikeRuns(points, shortEdge)) {
      if (run.filter((k) => !kept[k]).length >= WARP_LIMITS.curveRun) continue
      let weakest = -1
      for (const k of run) if (kept[k] && (weakest < 0 || run.turn(k) < run.turn(weakest))) weakest = k
      // Never two neighbours in one round: each removal is measured against the other's current place.
      if (weakest >= 0 && !drop.has((weakest + 1) % m) && !drop.has((weakest - 1 + m) % m)) drop.add(weakest)
    }
    if (drop.size === 0 || m - drop.size < 3) break
    points = points.filter((_, k) => !drop.has(k))
    kept = kept.filter((_, k) => !drop.has(k))
  }
  return points === contour.points ? contour : { points, clockwise: signedArea(points) < 0 }
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
 * Fluted glass at `strength` (0–1): vertical strips `width` wide from the glyph's origin. The middle of strip k
 * shows its part of the letter magnified about the strip's middle, slid sideways and moved up or down (seeded);
 * the seams between strips are squeezed to join them up, so the strips look cut apart. Every piece is linear, so
 * straight edges bend only at the seams' sides.
 */
function fluteWarp(strength: number, width: number, seed: number): Warp {
  const seam = (FLUTE.seam * width) / 2
  const magnify = 1 + FLUTE.magnify * strength
  // How wide a seam's image is when its two strips do not slide: x keeps rising while they slide apart by less.
  const room = 2 * seam - (magnify - 1) * (width - 2 * seam)
  const slide = (k: number) => strength * FLUTE.slide * (room / 2) * ((hashInts(seed, CHANNEL.slide, k) / UINT) * 2 - 1)
  const lift = (k: number) => strength * FLUTE.lift * width * ((hashInts(seed, CHANNEL.lift, k) / UINT) * 2 - 1)
  /** The image of x (and the lift there) inside the middle of strip k. */
  const middle = (k: number, x: number) => {
    const centre = (k + 0.5) * width
    return { x: centre + slide(k) + magnify * (x - centre), lift: lift(k) }
  }
  return {
    map(p) {
      const k = Math.floor(p.x / width)
      const u = p.x - k * width
      // In a seam: between the middles of the strips on either side of it.
      const seamOf = u < seam ? k : u > width - seam ? k + 1 : null
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
      for (let k = Math.floor((lo - seam) / width); k * width - seam < hi; k++) {
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

/** The index of the vertex nearest to `p`, if one lies within `within`; otherwise -1. */
function nearest(points: readonly Point[], p: Point, within: number): number {
  let best = -1
  let bestDistance = within
  points.forEach((q, i) => {
    const distance = Math.hypot(q.x - p.x, q.y - p.y)
    if (distance <= bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

/** True when the contour's first anchor lies inside an even number of the other contours (it bounds ink from outside). */
function isOutside(contours: readonly (readonly Point[])[], contour: number): boolean {
  const p = contours[contour][0]
  let depth = 0
  contours.forEach((other, i) => {
    if (i !== contour && other.length >= 3 && contains(other, p)) depth++
  })
  return depth % 2 === 0
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

/** Unit vector at an anchor pointing away from the ink: the mean of its two edges' outward normals. */
function outwardNormal(points: readonly Point[], index: number): Point | null {
  const n = points.length
  const prev = points[(index - 1 + n) % n]
  const p = points[index]
  const next = points[(index + 1) % n]
  // Counter-clockwise (positive area): the ink lies to the left of each edge, so outward is to its right.
  const side = signedArea(points) > 0 ? 1 : -1
  const edgeNormal = (a: Point, b: Point): Point | null => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    return length > 0 ? { x: (side * dy) / length, y: (-side * dx) / length } : null
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

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
