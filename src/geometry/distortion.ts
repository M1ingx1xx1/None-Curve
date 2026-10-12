// Deterministic vertex distortion. Pure functions in font units; no React, no DOM, no Math.random.
//
// Each vertex moves by smooth 1D value noise sampled at its arc-length position along the contour.
// Lattice values come from an integer hash of (seed, contour index, channel, lattice cell), so the
// same glyph, parameters, contour order, and point order always give the same result.
//
// Few anchors (set by the Sound tab's Flicker preset, no control): only a few vertices per letter move,
// picked by a hash of the seed and their position, and each jumps at least a set share of the amplitude.
// Corners, extremes and small contours never move, so the letter keeps its shape; a new seed picks others.
// The midpoints of long straight edges may be picked too (inserted as new vertices), so letters made only of
// corners and extremes (l, H, T) flicker as well.

import { ContourLayout } from './contourLayout'
import { addsCrossings, countSelfCrossings, findRingCrossings, findSelfCrossings, lazy } from './crossings'
import { signedArea } from './flatten'
import type { DistortionParams, Point, PolygonContour, PolygonGlyph } from './types'

export const DISTORTION_LIMITS = {
  maxAmount: 200,
  minFrequency: 0.5,
  maxFrequency: 50,
  /** Largest seed the Seed field takes. */
  maxSeed: 999_999,
  /**
   * The two ends of an edge may move toward each other along the edge by at most this fraction of its
   * length, so no edge can collapse or reverse. Movement across the edge is not limited: it only turns
   * the edge, and limiting it would weaken the distortion the denser the outline (neighbouring vertices
   * of a dense outline are close, so any difference in their movement is large next to their edge).
   */
  edgeFraction: 0.5,
  /** Passes of the edge protection; each pass only shortens displacements. */
  protectionPasses: 4,
  /**
   * Where a distorted contour crosses itself or another contour (dense outlines at inner corners, thin
   * strokes), the amplitude is halved around the crossing, smoothly over one amplitude of outline on
   * each side, up to this many times; the rest of the contour keeps the full amplitude.
   */
  localRepairs: 12,
  /** Amplitude scales tried for the whole contour, in order, when local repairs are not enough. */
  retryScales: [0.5, 0.25, 0.125, 0.0625] as const,
} as const

/** Few anchors: which vertices may move, how many do, and how far. */
export const SPARSE_LIMITS = {
  /** A vertex where the outline turns by more than this many degrees is a corner and stays put. */
  cornerAngle: 30,
  /** Every vertex of a contour with fewer vertices than this stays put (dots, small counters). */
  minContour: 8,
  /** Movers per letter: this share of its vertices, rounded, from 1 up to maxMovers. */
  share: 0.06,
  maxMovers: 5,
  /** At most this many movers on one contour. */
  perContour: 2,
  /** No two movers this many vertices apart or closer along their contour. */
  gap: 4,
  /** Each mover moves at least this share of the amplitude (less only where a repair lowers it). */
  minShare: 0.6,
  /**
   * The midpoint of an edge at least this share of the em long may move too: it is inserted as a new vertex when
   * picked, and the edge's ends stay put. For the spacing it counts as sitting halfway between them. Not where the
   * inserted midpoint would touch another edge of its contour (an outline that runs back along the edge, as grid
   * snapping can leave): it could often not move without crossing, and the contour would fall back.
   */
  midpointEdge: 0.1,
} as const

/** Channel numbers keep the few-anchors random numbers apart from the noise lattice's for the same seed. */
const CHANNEL = { pick: 0xd15, direction: 0xd16 } as const

export interface DistortionStats {
  applied: boolean
  /** Largest actual vertex displacement (font units). */
  maxShift: number
  /** Vertices that actually moved. */
  movedAnchors: number
  /** Vertices whose movement across the outline was shortened so no edge collapses or folds back. */
  clampedVertices: number
  /** Contours that needed a smaller amplitude, in places or overall, to stay valid (not crossing themselves or another contour). */
  reducedContours: number
  /** Contours left undistorted because no tried amplitude was valid. */
  fallbackContours: number
}

export function applyDistortion(polygon: PolygonGlyph, params: DistortionParams): { polygon: PolygonGlyph; stats: DistortionStats } {
  const stats: DistortionStats = { applied: false, maxShift: 0, movedAnchors: 0, clampedVertices: 0, reducedContours: 0, fallbackContours: 0 }
  const amount = clamp(finite(params.amount, 0), 0, DISTORTION_LIMITS.maxAmount)
  if (amount === 0) return { polygon, stats }

  stats.applied = true
  const settings = {
    amount,
    frequency: clamp(finite(params.frequency, 8), DISTORTION_LIMITS.minFrequency, DISTORTION_LIMITS.maxFrequency),
    normalBias: clamp(finite(params.normalBias, 0.7), 0, 1),
    seed: Math.trunc(finite(params.seed, 1)) | 0,
    sparse: params.sparse === true,
  }
  // Few anchors: where each contour moves (see pickMovers); every other vertex keeps weight 0, so it stays exactly in place.
  const movers = settings.sparse ? pickMovers(polygon, settings.seed) : null

  // Each distorted contour must also sit against the other contours as before (counters stay inside).
  const current = polygon.contours.map((c) => c.points)
  const layout = new ContourLayout(current.slice())
  const contours = polygon.contours.map((contour, index) => {
    if (contour.points.length < 3 || (movers && movers[index].length === 0)) return contour
    // A picked edge midpoint becomes a vertex: on the edge, so the outline only changes where it moves.
    const picked = movers && withMidpoints(contour.points, movers[index])
    const before = picked ? picked.points : contour.points
    // Counted on the old points: an inserted midpoint may itself touch an edge that runs back along its edge.
    const crossingsBefore = lazy(() => countSelfCrossings(contour.points))
    const damage = (after: readonly Point[]) => findDamage(before, after, crossingsBefore, index, current, layout)
    const accept = (result: Distorted, reduced: boolean) => {
      if (reduced) stats.reducedContours++
      stats.clampedVertices += result.clamped
      stats.maxShift = Math.max(stats.maxShift, result.maxShift)
      for (let i = 0; i < before.length; i++) if (result.points[i].x !== before[i].x || result.points[i].y !== before[i].y) stats.movedAnchors++
      current[index] = result.points
      return { points: result.points, clockwise: signedArea(result.points) < 0 } satisfies PolygonContour
    }

    // Full amplitude (at the movers only, with few anchors), lowered only around the places that cross.
    const weights = new Float64Array(before.length)
    if (picked) for (const i of picked.movers) weights[i] = 1
    else weights.fill(1)
    for (let round = 0; round <= DISTORTION_LIMITS.localRepairs; round++) {
      const result = distortContour(before, index, settings, weights)
      const found = damage(result.points)
      if (found === null) return accept(result, round > 0)
      if (found === 'all' || round === DISTORTION_LIMITS.localRepairs) break
      soften(before, weights, found, amount)
    }
    // Then smaller amplitudes for the whole contour, on top of what was lowered in places.
    for (const scale of DISTORTION_LIMITS.retryScales) {
      const result = distortContour(before, index, { ...settings, amount: amount * scale }, weights)
      if (damage(result.points) === null) return accept(result, true)
    }
    stats.fallbackContours++
    return contour
  })

  return { polygon: { ...polygon, contours }, stats }
}

interface Settings {
  amount: number
  frequency: number
  normalBias: number
  seed: number
  sparse: boolean
}

interface Distorted {
  points: Point[]
  clamped: number
  maxShift: number
}

/** `weights` scales each vertex's displacement (used to lower the amplitude in places). */
function distortContour(points: readonly Point[], contourIndex: number, s: Settings, weights?: Float64Array): Distorted {
  const n = points.length

  // Arc length at each vertex, measured from the start vertex; the closing edge counts too.
  const arc: number[] = [0]
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + dist(points[i - 1], points[i]))
  const total = arc[n - 1] + dist(points[n - 1], points[0])

  // A whole number of noise cells around the loop makes the noise periodic, so there is no seam
  // where the contour closes. Frequency is in noise features per 1000 font units of outline.
  const cells = Math.max(1, Math.round((total * s.frequency) / 1000))

  // Normal / tangent weights, normalized so the largest possible offset equals the amplitude.
  const length = Math.hypot(s.normalBias, 1 - s.normalBias)
  const wNormal = s.normalBias / length
  const wTangent = (1 - s.normalBias) / length

  // Each displacement has a part across the outline (normal) and a part along it (tangent).
  const normal: Point[] = []
  const tangent: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]

    // Tangent from the neighbours on both sides, wrapping around the closed contour.
    let tx = next.x - prev.x
    let ty = next.y - prev.y
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const nx = ty
    const ny = -tx

    const t = total > 0 ? (arc[i] / total) * cells : 0
    const amount = s.amount * (weights ? weights[i] : 1)
    let across = amount * wNormal * periodicNoise(t, cells, s.seed, contourIndex, 0)
    let along = amount * wTangent * periodicNoise(t, cells, s.seed, contourIndex, 1)
    // Few anchors: a mover jumps at least minShare of its amplitude, so every jump shows. Each part is raised on
    // its own, in the bias's proportions: raising the whole vector would turn noise that points mostly along the
    // outline into a long slide, which the edge protection below cuts to half an edge.
    if (s.sparse && amount > 0) {
      const least = SPARSE_LIMITS.minShare * amount
      const h = hashInts(s.seed, CHANNEL.direction, contourIndex, Math.round(points[i].x), Math.round(points[i].y))
      across = atLeast(across, least * wNormal, h & 1)
      along = atLeast(along, least * wTangent, h & 2)
    }
    normal.push({ x: across * nx, y: across * ny })
    tangent.push({ x: along * tx, y: along * ty })
  }

  // Edge protection: if the ends of an edge would move toward each other along the edge by more than
  // edgeFraction × its length, shorten their displacements; the edge then keeps at least half its
  // length along its old direction, so it cannot collapse or reverse. The parts along the outline are
  // shortened first (sliding points together along a stroke changes nothing visible); the parts across
  // it only where that is not enough, such as on the inside of a tight curve.
  const scaleN = new Float64Array(n).fill(1)
  const scaleT = new Float64Array(n).fill(1)
  for (let pass = 0; pass < DISTORTION_LIMITS.protectionPasses; pass++) {
    let changed = false
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ex = points[j].x - points[i].x
      const ey = points[j].y - points[i].y
      const edge = Math.hypot(ex, ey)
      if (edge === 0) continue
      const limit = -DISTORTION_LIMITS.edgeFraction * edge
      // How much each part brings the two ends together along the edge (negative: closer).
      const byNormal =
        ((normal[j].x * scaleN[j] - normal[i].x * scaleN[i]) * ex + (normal[j].y * scaleN[j] - normal[i].y * scaleN[i]) * ey) / edge
      const byTangent =
        ((tangent[j].x * scaleT[j] - tangent[i].x * scaleT[i]) * ex + (tangent[j].y * scaleT[j] - tangent[i].y * scaleT[i]) * ey) /
        edge
      if (byNormal + byTangent >= limit) continue
      changed = true
      if (byTangent < 0) {
        const k = Math.max(0, (limit - byNormal) / byTangent)
        scaleT[i] *= Math.min(1, k)
        scaleT[j] *= Math.min(1, k)
        if (k > 0) continue
      }
      if (byNormal < limit) {
        const k = limit / byNormal
        scaleN[i] *= k
        scaleN[j] *= k
      }
    }
    if (!changed) break
  }

  const out: Point[] = []
  let clamped = 0
  let maxShift = 0
  for (let i = 0; i < n; i++) {
    const dx = normal[i].x * scaleN[i] + tangent[i].x * scaleT[i]
    const dy = normal[i].y * scaleN[i] + tangent[i].y * scaleT[i]
    if (scaleN[i] < 1 && (!weights || weights[i] > 0)) clamped++
    maxShift = Math.max(maxShift, Math.hypot(dx, dy))
    out.push({ x: points[i].x + dx, y: points[i].y + dy })
  }
  return { points: out, clamped, maxShift }
}

/** `value` with its size raised to at least `size`, keeping its sign (a seeded one where it is 0). */
function atLeast(value: number, size: number, positive: number): number {
  if (Math.abs(value) >= size) return value
  return value > 0 || (value === 0 && positive) ? size : -size
}

/**
 * Few anchors: where each contour moves, as positions along it: a whole number is a vertex, and i + 0.5 the
 * midpoint of the edge from vertex i to the next. Vertices that hold the letter's shape (corners, extremes, every
 * vertex of a small contour) stay put; the rest, and the midpoints of edges at least midpointEdge of the em long
 * (see there), are ranked by a hash of the seed, contour and position, and the first few per letter move, kept
 * apart along their contour and at most perContour on one contour.
 */
function pickMovers(polygon: PolygonGlyph, seed: number): number[][] {
  const { contours } = polygon
  const total = contours.reduce((n, c) => n + c.points.length, 0)
  const count = clamp(Math.round(SPARSE_LIMITS.share * total), 1, SPARSE_LIMITS.maxMovers)
  const longEdge = SPARSE_LIMITS.midpointEdge * polygon.metrics.unitsPerEm
  const candidates: { contour: number; at: number; rank: number }[] = []
  const offer = (contour: number, at: number, p: Point) =>
    candidates.push({ contour, at, rank: hashInts(seed, CHANNEL.pick, contour, Math.round(p.x), Math.round(p.y)) })
  contours.forEach(({ points }, contour) => {
    const n = points.length
    if (n < 3) return
    if (n >= SPARSE_LIMITS.minContour) {
      const locked = lockedVertices(points)
      points.forEach((p, index) => {
        if (!locked[index]) offer(contour, index, p)
      })
    }
    points.forEach((p, index) => {
      const q = points[(index + 1) % n]
      if (dist(p, q) >= longEdge) offer(contour, index + 0.5, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
    })
  })
  candidates.sort((a, b) => a.rank - b.rank || a.contour - b.contour || a.at - b.at)

  const movers = contours.map((): number[] => [])
  const crossings = contours.map(({ points }) => lazy(() => countSelfCrossings(points)))
  let picked = 0
  for (const { contour, at } of candidates) {
    if (picked === count) break
    const chosen = movers[contour]
    const { points } = contours[contour]
    const n = points.length
    if (chosen.length >= SPARSE_LIMITS.perContour) continue
    if (chosen.some((j) => Math.min(Math.abs(j - at), n - Math.abs(j - at)) <= SPARSE_LIMITS.gap)) continue
    if (!Number.isInteger(at) && countSelfCrossings(withMidpoints(points, [at]).points) > crossings[contour]()) continue
    chosen.push(at)
    picked++
  }
  return movers
}

/** A contour with its picked edge midpoints inserted as vertices, and the indices of its movers there. */
function withMidpoints(points: readonly Point[], movers: readonly number[]): { points: readonly Point[]; movers: readonly number[] } {
  if (movers.every(Number.isInteger)) return { points, movers }
  const out: Point[] = []
  const at: number[] = []
  points.forEach((p, i) => {
    if (movers.includes(i)) at.push(out.length)
    out.push(p)
    if (movers.includes(i + 0.5)) {
      const q = points[(i + 1) % points.length]
      at.push(out.length)
      out.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
    }
  })
  return { points: out, movers: at }
}

/**
 * Vertices that hold a contour's shape: corners (turn above cornerAngle), extremes in x or y, and vertices on a
 * zero-length edge (no direction to judge them by).
 */
function lockedVertices(points: readonly Point[]): Uint8Array {
  const n = points.length
  const locked = new Uint8Array(n)
  // Slightly below cos(cornerAngle), so a turn of exactly cornerAngle (angle lock makes many) is not a corner
  // whichever way rounding goes.
  const straight = Math.cos((SPARSE_LIMITS.cornerAngle * Math.PI) / 180) - 1e-9
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const a = points[(i - 1 + n) % n]
    const b = points[(i + 1) % n]
    const ax = p.x - a.x
    const ay = p.y - a.y
    const bx = b.x - p.x
    const by = b.y - p.y
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    if (la === 0 || lb === 0 || (ax * bx + ay * by) / (la * lb) < straight) locked[i] = 1
  }
  markExtremes(points.map((p) => p.x), locked)
  markExtremes(points.map((p) => p.y), locked)
  return locked
}

/**
 * Marks where a coordinate peaks or dips along the closed contour. A flat run of equal values (a straight
 * top, bottom or side) counts whole when the vertices on both sides of it lie on the same side of it; a flat
 * step between a lower and a higher stretch does not.
 */
function markExtremes(values: readonly number[], locked: Uint8Array) {
  const n = values.length
  // Start right after a change, so no flat run wraps around the start.
  let start = -1
  for (let i = 0; i < n && start < 0; i++) if (values[i] !== values[(i - 1 + n) % n]) start = i
  if (start < 0) {
    locked.fill(1)
    return
  }
  for (let k = 0; k < n; ) {
    const first = (start + k) % n
    const v = values[first]
    let length = 1
    while (values[(first + length) % n] === v) length++
    const below = values[(first - 1 + n) % n] < v
    if ((values[(first + length) % n] < v) === below) for (let m = 0; m < length; m++) locked[(first + m) % n] = 1
    k += length
  }
}

/**
 * What is wrong with a distorted contour: null when it is valid, 'all' when the whole contour is at
 * fault (a collapsed edge, a flipped direction, a contour that moved into or out of another), or the
 * vertices at the ends of the edges that cross, itself or another contour.
 */
function findDamage(
  before: readonly Point[],
  after: readonly Point[],
  crossingsBefore: () => number,
  index: number,
  current: readonly (readonly Point[])[],
  layout: ContourLayout,
): number[] | 'all' | null {
  const n = after.length
  for (let i = 0; i < n; i++) if (dist(after[i], after[(i + 1) % n]) < 1e-6) return 'all'
  const a0 = signedArea(before)
  const a1 = signedArea(after)
  if (Math.abs(a1) < 1e-6 || Math.sign(a1) !== Math.sign(a0)) return 'all'
  const vertices: number[] = []
  if (addsCrossings(after, crossingsBefore)) {
    for (const c of findSelfCrossings(after)) vertices.push(c.i, (c.i + 1) % n, c.j, (c.j + 1) % n)
  }
  for (let m = 0; m < current.length; m++) {
    if (m === index || layout.pairKept(index, m, after, current[m])) continue
    const found = findRingCrossings(after, current[m])
    if (found.length === 0) return 'all'
    for (const c of found) vertices.push(c.i, (c.i + 1) % n)
  }
  return vertices.length ? vertices : null
}

/** Halves the weights at these vertices, fading out over `radius` of outline on each side. */
function soften(points: readonly Point[], weights: Float64Array, vertices: readonly number[], radius: number) {
  const n = points.length
  const arc = new Float64Array(n)
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + dist(points[i - 1], points[i])
  const total = arc[n - 1] + dist(points[n - 1], points[0])
  const marks = [...new Set(vertices)].map((v) => arc[v]).sort((a, b) => a - b)
  for (let i = 0; i < n; i++) {
    // Distance along the closed outline to the nearest marked vertex: the marks on either side of
    // this vertex, and the first and last marks (around the closing point).
    let lo = 0
    let hi = marks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (marks[mid] < arc[i]) lo = mid + 1
      else hi = mid
    }
    let near = Infinity
    for (const m of [marks[lo], marks[lo - 1], marks[0], marks[marks.length - 1]]) {
      if (m === undefined) continue
      const d = Math.abs(arc[i] - m)
      near = Math.min(near, d, total - d)
    }
    // 0.5 at a marked vertex, rising smoothly to 1 at `radius`.
    if (near < radius) weights[i] *= 1 - 0.25 * (1 + Math.cos((Math.PI * near) / radius))
  }
}

// ---- Deterministic noise ----

/** 32-bit integer hash of several integers (murmur3-style mixing). */
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9 | 0
  for (const v of values) {
    let k = Math.imul(v | 0, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Lattice value in [-1, 1]. */
function lattice(cell: number, seed: number, contour: number, channel: number): number {
  return (hashInts(seed, contour, channel, cell) / 0xffffffff) * 2 - 1
}

/** Smooth value noise with period `cells`: noise(t) === noise(t + cells). */
function periodicNoise(t: number, cells: number, seed: number, contour: number, channel: number): number {
  const i = Math.floor(t)
  const f = t - i
  const a = lattice(((i % cells) + cells) % cells, seed, contour, channel)
  const b = lattice((((i + 1) % cells) + cells) % cells, seed, contour, channel)
  const u = f * f * f * (f * (f * 6 - 15) + 10) // quintic fade
  return a + (b - a) * u
}

// ---- Helpers ----

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}
