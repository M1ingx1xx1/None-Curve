// Piecewise-linear warps of the plane: the common base of the Experimental effects. Pure functions in
// font units; no React, no DOM, no Math.random.
//
// A warp cuts the plane into triangles and moves each one by its own linear map, continuously across
// triangle edges. A straight edge therefore stays exactly straight inside a triangle and bends only
// where it crosses a triangle edge (a crease), and the only vertices added are at creases: an effect
// can add corners but never round anything off, so the letters stay free of curves also to the eye.
//
// An effect keeps every triangle the same way round (none flips or flattens), which makes its warp a
// one-to-one map of the plane. A one-to-one map cannot make an outline cross itself or another
// contour, so any warp, and any sequence of warps, keeps a valid glyph valid. Contours are still
// checked like in every Geometry step, in case floating-point rounding breaks one.

import { ContourLayout } from './contourLayout'
import { findRingCrossings, findSelfCrossings } from './crossings'
import { signedArea } from './flatten'
import type { Point, PolygonContour, PolygonGlyph } from './types'

export interface Warp {
  /** The image of p: continuous, and linear inside each mesh triangle. */
  map(p: Point): Point
  /** Where the segment a → b crosses mesh edges, as parameters t in (0, 1) in ascending order. */
  creases(a: Point, b: Point): number[]
}

export const WARP_LIMITS = {
  /**
   * A crease that turns the outline by less than this many degrees does not read as a corner, only as
   * a slight wobble, so it is left out instead of adding a vertex. Every crease kept is a visible facet.
   */
  minTurn: 3,
  /**
   * Creases left out may lie at most this far (× the em) from the edge that replaces them. Where that
   * makes a contour touch another (they can be a unit apart), the smaller limits are tried in turn.
   */
  maxDrift: 0.01,
  driftScales: [1, 0.25, 0.0625, 0.015625] as const,
  /**
   * Where tidying makes a contour touch itself or another, the creases the offending edge replaced
   * are kept and the rest is tidied again, up to this many times.
   */
  pinRounds: 8,
  /**
   * A curve-like run: at least `curveRun` vertices in a row turning the same way, each by
   * `straightTurn`–`curveTurn` degrees, between edges shorter than `shortEdge` × the em. Creases are
   * removed until none is needed to make such a run (runs the input's own vertices already form are
   * the input's shape), so an effect never makes an outline look more curved.
   */
  curveRun: 5,
  straightTurn: 0.5,
  curveTurn: 20,
  shortEdge: 0.04,
  maxTidyRounds: 50,
  /** Input edges closer than this (font units) touch: crossings between their images are the input's own. */
  touch: 1e-6,
  /** Input edges closer than this (font units) may be squeezed so thin that rounding crosses their exact images. */
  nearTouch: 0.05,
  /** Spikes in the input thinner than this (font units) lose their tip before warping. */
  spikeWidth: 0.01,
  /** Creases this close (font units) to a vertex or to each other are merged into it. */
  minGap: 1e-6,
  /** Strengths tried for a contour, in order, if the full warp ever breaks it. */
  retryScales: [0.5, 0.25, 0.125, 0.0625] as const,
} as const

export interface WarpStats {
  applied: boolean
  /** Largest vertex movement (font units). */
  maxShift: number
  /** Vertices added at creases. */
  addedVertices: number
  /** Contours that needed a weaker warp to stay valid. */
  reducedContours: number
  /** Contours left as they were because no tried strength kept them valid. */
  fallbackContours: number
}

export const emptyWarpStats = (): WarpStats => ({
  applied: false,
  maxShift: 0,
  addedVertices: 0,
  reducedContours: 0,
  fallbackContours: 0,
})

/** For each vertex of each contour: true where an earlier Experimental effect added it at a crease. */
export type CreaseMarks = (readonly boolean[])[]

/**
 * Applies a warp to every contour. `makeWarp(scale)` gives the warp at a fraction of its strength;
 * `unitsPerEm` sets the scale at which a run of short edges starts to read as a curve. `marks` says
 * which input vertices earlier effects added at creases: tidying may remove those as well, so a run
 * that only the creases of several effects together make curve-like is broken up too. Returns the
 * marks for the result.
 */
export function applyWarp(
  polygon: PolygonGlyph,
  makeWarp: (scale: number) => Warp,
  unitsPerEm: number,
  marks?: CreaseMarks,
): { polygon: PolygonGlyph; stats: WarpStats; marks: CreaseMarks } {
  const stats = emptyWarpStats()
  stats.applied = true
  const layout = new ContourLayout(polygon.contours.map((c) => c.points))
  const usable = (c: PolygonContour) => c.points.length >= 3

  // Every contour starts as its exact image. The exact images are valid together by construction,
  // whereas an image checked against contours not yet warped can seem to cross them.
  const full = makeWarp(1)
  const inputMarks = polygon.contours.map((c, k) => marks?.[k] ?? c.points.map(() => false))
  const sources = polygon.contours.map((c, k) => {
    const kept = removeFoldBacks(c.points)
    return { points: kept.map((i) => c.points[i]), marks: kept.map((i) => inputMarks[k][i] ?? false) }
  })
  const images = polygon.contours.map((c, k) =>
    usable(c) && sources[k].points.length >= 3 ? warpContour(sources[k].points, full, sources[k].marks) : null,
  )
  const current = polygon.contours.map((c, k) => images[k]?.points ?? c.points)
  const result: Warped[] = []

  // Then each contour, in turn, checked against the others as they are at that moment: its exact image
  // (or a weaker one, if rounding ever breaks it), then, in its place, the tidied image if that is valid
  // too. The last contour of any pair to change is checked against the other's final points.
  for (const [index, contour] of polygon.contours.entries()) {
    const image = images[index]
    if (!image) continue
    const before = sources[index].points
    const valid = (after: Warped) =>
      after.points.length >= 3 && !crossesAnew(after, before) && layout.keeps(current, index, after.points)

    let chosen: Warped | null = valid(image) ? image : null
    if (!chosen) {
      for (const scale of WARP_LIMITS.retryScales) {
        const weaker = warpContour(before, makeWarp(scale), sources[index].marks)
        if (valid(weaker)) {
          chosen = weaker
          stats.reducedContours++
          break
        }
      }
    }
    // Nothing valid: leave the whole glyph as it was, which is valid.
    if (!chosen) {
      return { polygon, stats: { ...emptyWarpStats(), applied: true, fallbackContours: polygon.contours.length }, marks: inputMarks }
    }
    current[index] = chosen.points
    chosen = tidyValid(chosen, unitsPerEm, valid, (after) => conflicts(after, before, index, current, layout)) ?? chosen
    current[index] = chosen.points
    result[index] = chosen
  }

  const contours = polygon.contours.map((contour, index) => {
    const chosen = result[index]
    if (!chosen) return contour
    stats.addedVertices += chosen.kinds.filter((kind) => kind === 'new').length
    stats.maxShift = Math.max(stats.maxShift, chosen.maxShift)
    return { points: chosen.points, clockwise: signedArea(chosen.points) < 0 }
  })
  const outMarks = polygon.contours.map((_, k) => result[k]?.kinds.map((kind) => kind !== 'input') ?? inputMarks[k])
  return { polygon: { ...polygon, contours }, stats, marks: outMarks }
}

/**
 * The tidied image, if a valid one is found. Tidying moves the outline a little, which can make it
 * touch itself or another contour where they are very close. Then every crease that the offending
 * edge replaced is kept (pinned), restoring the exact outline along that edge, and the rest is tidied
 * again, so one tight spot does not stop tidying elsewhere. Failing that, the whole contour is tidied
 * under tighter drift limits.
 */
function tidyValid(
  image: Warped,
  unitsPerEm: number,
  valid: (after: Warped) => boolean,
  locate: (after: Warped) => number[] | null,
): Warped | null {
  const pins = new Set<number>()
  const n = image.points.length
  for (let round = 0; round < WARP_LIMITS.pinRounds; round++) {
    const tidied = tidy(image, unitsPerEm, 1, pins)
    if (valid(tidied)) return tidied
    const edges = locate(tidied)
    if (!edges) break
    const before = pins.size
    const m = tidied.points.length
    for (const e of edges) {
      // The creases between the edge's two ends in the exact image.
      const from = tidied.origins[e]
      const to = tidied.origins[(e + 1) % m]
      for (let k = (from + 1) % n; k !== to; k = (k + 1) % n) pins.add(k)
    }
    if (pins.size === before) break
  }
  for (const drift of WARP_LIMITS.driftScales.slice(1)) {
    const tidied = tidy(image, unitsPerEm, drift)
    if (valid(tidied)) return tidied
  }
  return null
}

/**
 * The edges (by start index) where the image crosses itself anew (see crossesAnew) or crosses another
 * contour it should not; null when a contour moved into or out of another without crossing it.
 */
function conflicts(
  image: Warped,
  input: readonly Point[],
  index: number,
  current: readonly (readonly Point[])[],
  layout: ContourLayout,
): number[] | null {
  const found: number[] = []
  for (const c of findSelfCrossings(image.points)) if (!inputsOwn(image, input, c)) found.push(c.i, c.j)
  for (let m = 0; m < current.length; m++) {
    if (m === index || layout.pairKept(index, m, image.points, current[m])) continue
    const crossings = findRingCrossings(image.points, current[m])
    if (crossings.length === 0) return null
    for (const c of crossings) found.push(c.i)
  }
  return found
}

/**
 * True when the image crosses itself where the input does not (see inputsOwn). Comparing counts
 * instead would fail where the input touches itself (heavy Geometry settings can lay two parts of an
 * outline on top of each other), because rounding in the warp can turn such a touch into a crossing.
 */
function crossesAnew(image: Warped, input: readonly Point[]): boolean {
  return findSelfCrossings(image.points).some((c) => !inputsOwn(image, input, c))
}

/**
 * True when a self-crossing of the image is the input's own or comes from rounding alone: the two image
 * edges lie on separate input edges that cross or touch, or on input edges less than `nearTouch` apart
 * (neighbouring edges and one edge with itself included) while both are still exactly as the warp
 * mapped them (not changed by tidying). A one-to-one warp cannot make such edges cross, but it can
 * squeeze a sharp spike or a thin sliver (heavy Distortion leaves them) so thin that rounding does. A
 * crossing between untouched edges whose input edges lie further apart is a real fault.
 */
function inputsOwn(image: Warped, input: readonly Point[], c: { i: number; j: number }): boolean {
  const n = input.length
  const a = image.edges[c.i]
  const b = image.edges[c.j]
  const gap = Math.abs(a - b)
  const apart = segmentGap(input[a], input[(a + 1) % n], input[b], input[(b + 1) % n])
  if (Math.min(gap, n - gap) >= 2 && apart <= WARP_LIMITS.touch) return true
  const m = image.points.length
  const exact = (e: number) => (image.origins[(e + 1) % m] - image.origins[e] + image.exactCount) % image.exactCount === 1
  return apart <= WARP_LIMITS.nearTouch && exact(c.i) && exact(c.j)
}

/** The shortest distance between segments a1–a2 and b1–b2 (0 when they cross). */
function segmentGap(a1: Point, a2: Point, b1: Point, b2: Point): number {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = side(a1, a2, b1)
  const d2 = side(a1, a2, b2)
  const d3 = side(b1, b2, a1)
  const d4 = side(b1, b2, a2)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(distanceToSegment(b1, a1, a2), distanceToSegment(b2, a1, a2), distanceToSegment(a1, b1, b2), distanceToSegment(a2, b1, b2))
}

/**
 * Leaves out the tips of spikes thinner than `spikeWidth`, where an outline runs out along a line and
 * (almost) straight back (heavy Geometry settings can leave these). They enclose next to no area, so
 * the letter looks the same, but after warping, rounding could make the two sides of a spike cross.
 */
function removeFoldBacks(points: readonly Point[]): number[] {
  const kept = points.map((_, i) => i)
  for (let k = 0; kept.length > 3 && k < kept.length; ) {
    const n = kept.length
    const a = points[kept[(k - 1 + n) % n]]
    const b = points[kept[k]]
    const c = points[kept[(k + 1) % n]]
    const ux = b.x - a.x
    const uy = b.y - a.y
    const vx = c.x - b.x
    const vy = c.y - b.y
    // How far the end of the shorter edge lies from the line of the longer one: the spike's width.
    const longer = Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy))
    const reverses = ux * vx + uy * vy < 0 && Math.abs(ux * vy - uy * vx) <= WARP_LIMITS.spikeWidth * longer
    const repeated = ux === 0 && uy === 0
    if (reverses || repeated) {
      kept.splice(k, 1)
      k = Math.max(0, k - 1)
    } else k++
  }
  return kept
}

/** Where a vertex comes from: the effect's input (never removed), or a crease of an earlier effect or of this one. */
type Kind = 'input' | 'earlier' | 'new'

interface Warped {
  points: Point[]
  /** For each point: where it comes from. Creases (earlier or new) may be removed by tidying. */
  kinds: Kind[]
  /** For each point: the input edge it lies on (edge k runs from input vertex k to k + 1), and so does the edge it starts. */
  edges: number[]
  /** For each point: its index in the exact image it was tidied from (its own index in an exact image). */
  origins: number[]
  /** How many points that exact image has. */
  exactCount: number
  maxShift: number
}

/**
 * The exact image of a closed contour: every vertex mapped, plus a vertex wherever an edge crosses a
 * crease. `marks` flags the input vertices that earlier effects added at creases.
 */
export function warpContour(points: readonly Point[], warp: Warp, marks?: readonly boolean[]): Warped {
  const n = points.length
  const images: Point[] = []
  const kinds: Kind[] = []
  const edges: number[] = []
  let maxShift = 0
  const push = (p: Point, kind: Kind, edge: number) => {
    const q = warp.map(p)
    maxShift = Math.max(maxShift, Math.hypot(q.x - p.x, q.y - p.y))
    images.push(q)
    kinds.push(kind)
    edges.push(edge)
  }

  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    push(a, marks?.[i] ? 'earlier' : 'input', i)
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length === 0) continue
    const gap = WARP_LIMITS.minGap / length
    let last = 0
    for (const t of warp.creases(a, b)) {
      if (t - last < gap || 1 - t < gap) continue
      push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, 'new', i)
      last = t
    }
  }
  return { points: images, kinds, edges, origins: images.map((_, k) => k), exactCount: images.length, maxShift }
}

/**
 * Removes creases (this effect's or earlier ones') that would not read as corners: first those that turn
 * the outline less than `minTurn`, then, from every curve-like run that only creases make long enough, the crease that turns
 * least, until no such run is left. No removed crease lies farther than the drift limit from the edge
 * that replaces it, and vertices of the input are never removed.
 */
function tidy(image: Warped, unitsPerEm: number, driftScale = 1, pins: ReadonlySet<number> = new Set()): Warped {
  const shortEdge = WARP_LIMITS.shortEdge * unitsPerEm
  const drift = WARP_LIMITS.maxDrift * unitsPerEm * driftScale
  let points: Point[] = []
  let kinds: Kind[] = []
  let edges: number[] = []
  let origins: number[] = []
  const n = image.points.length
  // Creases left out since the last point kept: they must all stay close to the edge that replaces them,
  // or a chain of faint creases bending the same way would be cut off by one long chord.
  let skipped: Point[] = []
  for (let k = 0; k < n; k++) {
    const p = image.points[k]
    if (image.kinds[k] !== 'input' && !pins.has(image.origins[k])) {
      const prev = points.length > 0 ? points[points.length - 1] : image.points[n - 1]
      const next = image.points[(k + 1) % n]
      const faint = Math.abs(turnDegrees(prev, p, next)) < WARP_LIMITS.minTurn
      if (faint && [...skipped, p].every((q) => distanceToSegment(q, prev, next) <= drift)) {
        skipped.push(p)
        continue
      }
    }
    points.push(p)
    kinds.push(image.kinds[k])
    edges.push(image.edges[k])
    origins.push(image.origins[k])
    skipped = []
  }

  for (let round = 0; round < WARP_LIMITS.maxTidyRounds; round++) {
    const drop = new Set<number>()
    const m = points.length
    const near = (k: number) => distanceToSegment(points[k], points[(k - 1 + m) % m], points[(k + 1) % m]) <= drift
    for (const run of curveLikeRuns(points, shortEdge)) {
      // A run that the input's own vertices make long enough was already curve-like before the warp.
      if (run.filter((k) => kinds[k] === 'input').length >= WARP_LIMITS.curveRun) continue
      let weakest = -1
      for (const k of run) {
        if (kinds[k] !== 'input' && near(k) && !pins.has(origins[k]) && (weakest < 0 || run.turn(k) < run.turn(weakest))) weakest = k
      }
      // Never two neighbours in one round: each removal is measured against the other's current place.
      if (weakest >= 0 && !drop.has((weakest + 1) % m) && !drop.has((weakest - 1 + m) % m)) drop.add(weakest)
    }
    if (drop.size === 0) break
    points = points.filter((_, k) => !drop.has(k))
    kinds = kinds.filter((_, k) => !drop.has(k))
    edges = edges.filter((_, k) => !drop.has(k))
    origins = origins.filter((_, k) => !drop.has(k))
  }
  return { points, kinds, edges, origins, exactCount: image.exactCount, maxShift: image.maxShift }
}

type Run = number[] & { turn: (k: number) => number }

/**
 * Runs of `curveRun` or more vertices in a row that all turn the same way, each by less than
 * `curveTurn` degrees, between edges shorter than `shortEdge`: how a polyline starts to look like a curve.
 */
export function curveLikeRuns(points: readonly Point[], shortEdge: number): Run[] {
  const n = points.length
  if (n < WARP_LIMITS.curveRun) return []
  const turns = new Float64Array(n)
  const sign = new Int8Array(n)
  const edge = (k: number) => {
    const a = points[k]
    const b = points[(k + 1) % n]
    return Math.hypot(b.x - a.x, b.y - a.y)
  }
  for (let k = 0; k < n; k++) {
    const t = turnDegrees(points[(k - 1 + n) % n], points[k], points[(k + 1) % n])
    turns[k] = Math.abs(t)
    const gentle = turns[k] >= WARP_LIMITS.straightTurn && turns[k] <= WARP_LIMITS.curveTurn
    sign[k] = gentle && edge(k) < shortEdge && edge((k - 1 + n) % n) < shortEdge ? Math.sign(t) : 0
  }
  const turn = (k: number) => turns[k]
  const runs: Run[] = []
  // Start just after a vertex that breaks runs, so no run is split where the contour closes.
  const start = sign.findIndex((v) => v === 0)
  if (start < 0) return [Object.assign(Array.from({ length: n }, (_, k) => k), { turn })]
  let current: number[] = []
  const close = () => {
    if (current.length >= WARP_LIMITS.curveRun) runs.push(Object.assign(current, { turn }))
    current = []
  }
  for (let step = 1; step <= n; step++) {
    const k = (start + step) % n
    if (sign[k] === 0) close()
    else {
      if (current.length > 0 && sign[current[0]] !== sign[k]) close()
      current.push(k)
    }
  }
  close()
  return runs
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
}

/** How far the path a → b → c turns at b, in degrees: positive to the left, negative to the right. */
function turnDegrees(a: Point, b: Point, c: Point): number {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const vx = c.x - b.x
  const vy = c.y - b.y
  return (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI
}
