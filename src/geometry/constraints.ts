// Geometric constraints on the reduced polygon: grid snapping, then angle lock.
// Pure functions in font units; no React, no DOM. Inputs are never modified.

import { simplifyClosed } from './anchors'
import { ContourLayout, relate } from './contourLayout'
import { addsCrossings, countSelfCrossings, findSelfCrossings, lazy, ringBox } from './crossings'
import { signedArea } from './flatten'
import type { GridParams, Point, PolygonContour, PolygonGlyph } from './types'

export const ANGLE_STEPS = [90, 45, 30, 15] as const

/** Edges shorter than this after angle lock (font units) make the contour fall back. */
const MIN_EDGE = 0.5

/**
 * When a step fails on a contour, it is retried on simplified copies of the contour (RDP tolerance as a
 * fraction of the contour's bounding-box diagonal): fewer, longer edges are much easier to snap or
 * lock without collapsing or crossing. Only if every retry fails does the contour keep its points.
 * Angle lock simplifies less, so a locked letter keeps its features.
 */
const SNAP_RETRY_TOLERANCES = [0.01, 0.02, 0.04, 0.08, 0.16] as const
const ANGLE_RETRY_TOLERANCES = [0.01, 0.02, 0.04] as const

/**
 * Angle lock may move a vertex at most this fraction of its contour's bounding-box diagonal. Locking
 * that needs more changes the letter too much (at 90°, A, V, W, X, Z need 20–30 %: their long
 * diagonals have no nearby allowed direction, so a Z grows wide enough to cover its neighbours); such
 * a contour gets fine stair steps instead, or keeps its shape.
 */
const ANGLE_MAX_MOVE = 0.2
/**
 * Angle lock may change a contour's area by at most this fraction. Locking fits the result to the
 * original's bounding box, so a round O becomes a rectangle about 25 % larger in area; an S whose
 * openings close up grows by 40 % or more and is no longer readable.
 */
const ANGLE_MAX_AREA_CHANGE = 0.3
/**
 * Stair steps are at most this fraction of the em long: longer off-angle edges are split first, so a
 * long diagonal becomes a fine staircase that follows it instead of one large step.
 */
const STAIR_STEP_PER_EM = 1 / 40

/**
 * Why a contour kept its points. 'contours': the result would cross another contour of the glyph, or
 * move into or out of one. 'moved': angle lock would move a vertex too far.
 */
export type FallbackReason = 'collapsed' | 'flipped' | 'crossings' | 'contours' | 'unsolvable' | 'moved'

export interface ConstraintStats {
  snapApplied: boolean
  /** Vertices merged because snapping moved neighbours onto the same grid point. */
  snapMerged: number
  /** Largest distance a vertex moved while snapping (font units). */
  snapMaxShift: number
  angleApplied: boolean
  /** Largest distance a vertex moved under angle lock (font units). */
  angleMaxShift: number
  /** Contours that only worked after simplification, by step. */
  simplified: { step: 'snap' | 'angle' }[]
  /** Contours that kept their pre-step points, by step and reason. */
  fallbacks: { step: 'snap' | 'angle'; reason: FallbackReason }[]
}

export function applyConstraints(polygon: PolygonGlyph, params: GridParams): { polygon: PolygonGlyph; stats: ConstraintStats } {
  const stats: ConstraintStats = {
    snapApplied: false,
    snapMerged: 0,
    snapMaxShift: 0,
    angleApplied: false,
    angleMaxShift: 0,
    simplified: [],
    fallbacks: [],
  }
  let contours = polygon.contours

  const size = Number.isFinite(params.size) ? params.size : 0
  if (params.snap && size > 0) {
    stats.snapApplied = true
    const centre = glyphCentre(contours)
    contours = eachContour(contours, (c, fits) => {
      const outcome = withRetries(
        c.points,
        [
          (points) => {
            const result = snapContour(points, size, centre)
            return { points: result.points, reason: result.points ? null : ('collapsed' as const) }
          },
        ],
        SNAP_RETRY_TOLERANCES,
        fits,
      )
      if (!outcome.points) {
        stats.fallbacks.push({ step: 'snap', reason: outcome.reason })
        return null
      }
      if (outcome.simplified) {
        stats.simplified.push({ step: 'snap' })
        stats.snapMaxShift = Math.max(stats.snapMaxShift, nearestShift(c.points, outcome.points))
      } else {
        const direct = snapContour(c.points, size, centre)
        stats.snapMerged += direct.merged
        stats.snapMaxShift = Math.max(stats.snapMaxShift, direct.maxShift)
      }
      return outcome.points
    })
  }

  const step = ANGLE_STEPS.includes(params.angleStep as (typeof ANGLE_STEPS)[number]) ? params.angleStep : 45
  const stairStep = polygon.metrics.unitsPerEm * STAIR_STEP_PER_EM
  if (params.angleLock) {
    stats.angleApplied = true
    const maxMove = (points: readonly Point[]) => {
      const box = ringBox(points)
      return ANGLE_MAX_MOVE * Math.hypot(box.maxX - box.minX, box.maxY - box.minY)
    }
    // A glyph is locked as a whole or gets stair steps as a whole, so the parts of a letter match: if
    // locking any contour would move a vertex too far, or locking every contour would pull the glyph
    // apart (Roboto draws a V as two overlapping legs; locked on their own they become two separate
    // bars), every contour gets stairs.
    const trial = contours.map((c) => lockAngles(c.points, step, maxMove(c.points)))
    const stairsOnly =
      trial.some((t) => t.reason === 'moved') ||
      !keepsGlyphTogether(
        contours.map((c) => c.points),
        trial.map((t, k) => t.points ?? contours[k].points),
      )
    // Stair corners go away from the ink: outward on outer contours, into the hole on counters.
    const holes = contours.map((c, k) => isHole(c.points, contours, k))
    contours = eachContour(contours, (c, fits, k) => {
      const stairs: StepRun = (points) => stairAngles(points, step, stairStep, holes[k])
      // Prefer locked edges (lengths adjusted); if that cannot be made valid, use stairs (every
      // vertex kept, off-angle edges split into two allowed directions) before keeping the contour.
      const limit = maxMove(c.points)
      const runs: StepRun[] = stairsOnly ? [stairs] : [(points) => lockAngles(points, step, limit), stairs]
      const outcome = withRetries(c.points, runs, ANGLE_RETRY_TOLERANCES, fits)
      if (!outcome.points) {
        stats.fallbacks.push({ step: 'angle', reason: stairsOnly ? 'moved' : outcome.reason })
        return null
      }
      const changed = outcome.simplified || (stairsOnly && outcome.points.length !== c.points.length)
      if (changed) stats.simplified.push({ step: 'angle' })
      stats.angleMaxShift = Math.max(
        stats.angleMaxShift,
        changed ? nearestShift(c.points, outcome.points) : maxShift(c.points, outcome.points),
      )
      return outcome.points
    })
  }

  return { polygon: { ...polygon, contours }, stats }
}

/**
 * Runs `change` on every contour in turn; it returns new points, or null to keep the contour. `fits`
 * tells whether new points sit against the glyph's other contours (as already changed, or not yet)
 * like the contour did before: no crossing, and no moving into or out of another contour.
 */
function eachContour(
  contours: readonly PolygonContour[],
  change: (contour: PolygonContour, fits: (points: readonly Point[]) => boolean, index: number) => Point[] | null,
): PolygonContour[] {
  const current = contours.map((c) => c.points)
  const layout = new ContourLayout(current.slice())
  return contours.map((c, k) => {
    const points = change(c, (after) => layout.keeps(current, k, after), k)
    if (!points) return c
    current[k] = points
    return withPoints(points)
  })
}

/**
 * True when the contours `after` sit like `before`: overlapping contours still overlap (or one now
 * holds the other), and the others are still apart or nested exactly as before.
 */
function keepsGlyphTogether(before: readonly (readonly Point[])[], after: readonly (readonly Point[])[]): boolean {
  for (let i = 0; i < before.length; i++) {
    for (let j = i + 1; j < before.length; j++) {
      const was = relate(before[i], before[j])
      const now = relate(after[i], after[j])
      const kept = was.meet
        ? now.meet || now.aInB || now.bInA
        : !now.meet && now.aInB === was.aInB && now.bInA === was.bInA
      if (!kept) return false
    }
  }
  return true
}

/** True when contour k lies inside an odd number of the glyph's other contours: it is a counter. */
function isHole(points: readonly Point[], contours: readonly PolygonContour[], k: number): boolean {
  let depth = 0
  contours.forEach((c, m) => {
    if (m !== k && relate(points, c.points).aInB) depth++
  })
  return depth % 2 === 1
}

/** Centre of the glyph's bounding box: exact ties in snapping round toward it, so symmetric letters stay symmetric. */
function glyphCentre(contours: readonly PolygonContour[]): Point {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of contours) {
    const box = ringBox(c.points)
    minX = Math.min(minX, box.minX)
    minY = Math.min(minY, box.minY)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

type StepRun = (points: readonly Point[]) => { points: Point[] | null; reason: FallbackReason | null }

/**
 * Runs a step on the contour; if the result is invalid, runs it again on simplified copies (RDP
 * tolerances as fractions of the bounding-box diagonal), then tries the next method in `runs` the same
 * way. Every result is validated against the contour as it was before the step and, with `fits`,
 * against the glyph's other contours; the first reason is reported if all fail.
 */
function withRetries(
  points: readonly Point[],
  runs: StepRun[],
  tolerances: readonly number[],
  fits: (points: readonly Point[]) => boolean,
): { points: Point[]; simplified: boolean; reason: null } | { points: null; simplified: false; reason: FallbackReason } {
  // The contour's own crossings, counted once for every check against it.
  const crossings = lazy(() => countSelfCrossings(points))
  const check = (after: readonly Point[]) => validate(points, after, crossings) ?? (fits(after) ? null : 'contours')
  const first = runs[0](points)
  const firstReason = first.points ? check(first.points) : (first.reason ?? 'collapsed')
  if (!firstReason) return { points: first.points!, simplified: false, reason: null }

  const box = ringBox(points)
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxY - box.minY)
  const variants: (readonly Point[])[] = [points]
  for (const fraction of tolerances) {
    const simplified = simplifyClosed(points, diagonal * fraction, crossings)
    if (simplified.valid && simplified.points.length < variants[variants.length - 1].length) variants.push(simplified.points)
  }
  for (let r = 0; r < runs.length; r++) {
    for (let v = r === 0 ? 1 : 0; v < variants.length; v++) {
      const result = runs[r](variants[v])
      if (result.points && !check(result.points)) {
        return { points: result.points, simplified: r > 0 || v > 0, reason: null }
      }
    }
  }
  return { points: null, simplified: false, reason: firstReason }
}

/** Largest distance from an original vertex to the result's outline (point counts may differ). */
function nearestShift(before: readonly Point[], after: readonly Point[]): number {
  const kept = new Set(after.map((p) => `${p.x},${p.y}`))
  const m = after.length
  let max = 0
  for (const p of before) {
    // Stairs keep every vertex, so most are found at once.
    if (kept.has(`${p.x},${p.y}`)) continue
    let best = Infinity
    for (let j = 0; j < m && best > max; j++) best = Math.min(best, distanceToSegment(p, after[j], after[(j + 1) % m]))
    max = Math.max(max, best)
  }
  return max
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/**
 * Angle lock without moving any vertex: an edge already on an allowed direction stays; any other edge
 * becomes two edges along the two allowed directions on either side of it, like a stair step (an edge
 * longer than `maxStep` is first split, so it becomes a staircase of small steps). The step's corner
 * goes away from the ink — outside an outer contour, inside a counter (`hole`) — so the two sides of a
 * thin stroke move apart instead of into each other. Where two neighbouring steps would cross (at a
 * sharp inner turn), one of them is flipped to the other side. The contour closes exactly, so no edge
 * length has to be adjusted.
 */
function stairAngles(
  original: readonly Point[],
  step: number,
  maxStep: number,
  hole: boolean,
): { points: Point[] | null; reason: FallbackReason | null } {
  if (original.length < 3) return { points: null, reason: 'collapsed' }
  const points = splitOffAngle(original, step, maxStep)
  const n = points.length
  const flipped = new Uint8Array(n)
  const baseline = lazy(() => countSelfCrossings(points))
  let stairs = buildStairs(points, step, flipped, hole)
  for (let round = 0; round < STAIR_REPAIRS && addsCrossings(stairs.points, baseline); round++) {
    let changed = false
    for (const c of findSelfCrossings(stairs.points)) {
      const a = stairs.edgeOf[c.i]
      const b = stairs.edgeOf[c.j]
      // Only steps next to each other are repaired; anything else is a real crossing.
      const near = Math.min((b - a + n) % n, (a - b + n) % n) <= 1
      if (!near) continue
      for (const edge of [a, b]) {
        if (!flipped[edge] && stairs.hasCorner[edge]) {
          flipped[edge] = 1
          changed = true
          break
        }
      }
    }
    if (!changed) break
    stairs = buildStairs(points, step, flipped, hole)
  }
  return stairs.points.length >= 3 ? { points: stairs.points, reason: null } : { points: null, reason: 'collapsed' }
}

/** Splits edges that are not on an allowed direction into parts no longer than `maxStep`. */
function splitOffAngle(points: readonly Point[], step: number, maxStep: number): readonly Point[] {
  const rad = (step * Math.PI) / 180
  const out: Point[] = []
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    out.push(a)
    const theta = Math.atan2(b.y - a.y, b.x - a.x)
    const offAngle = Math.abs(theta / rad - Math.round(theta / rad)) > 1e-9
    const parts = offAngle && maxStep > 0 ? Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxStep - 1e-9) : 1
    for (let k = 1; k < parts; k++) out.push({ x: a.x + ((b.x - a.x) * k) / parts, y: a.y + ((b.y - a.y) * k) / parts })
  }
  return out.length === n ? points : out
}

/** Repair rounds for neighbouring stair steps that cross. */
const STAIR_REPAIRS = 8

/** Stair steps for every edge; `flipped` puts an edge's corner on the inside. `edgeOf[i]`: the edge that segment i belongs to. */
function buildStairs(points: readonly Point[], step: number, flipped: Uint8Array, hole: boolean) {
  const n = points.length
  const rad = (step * Math.PI) / 180
  // Positive area: the inside is to the left of each edge, so corners go to the right (to the left
  // for a counter, whose inside is the hole).
  const outsideSign = (signedArea(points) > 0 ? -1 : 1) * (hole ? -1 : 1)
  const out: Point[] = []
  const edgeOf: number[] = []
  const hasCorner = new Uint8Array(n)
  const push = (p: Point, edge: number) => {
    const last = out[out.length - 1]
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-9) {
      out.push(p)
      edgeOf.push(edge)
    }
  }
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    push({ x: a.x, y: a.y }, i)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const theta = Math.atan2(dy, dx)
    const k = Math.floor(theta / rad + 1e-9)
    const t1 = k * rad
    const t2 = (k + 1) * rad
    if (Math.abs(theta - t1) < 1e-9) continue
    // Solve d = α·u1 + β·u2 with u1, u2 the allowed directions around the edge (α, β ≥ 0).
    const u1 = { x: Math.cos(t1), y: Math.sin(t1) }
    const u2 = { x: Math.cos(t2), y: Math.sin(t2) }
    const det = u1.x * u2.y - u1.y * u2.x
    const alpha = (dx * u2.y - dy * u2.x) / det
    const beta = (u1.x * dy - u1.y * dx) / det
    const c1 = { x: a.x + alpha * u1.x, y: a.y + alpha * u1.y }
    const c2 = { x: a.x + beta * u2.x, y: a.y + beta * u2.y }
    const side = Math.sign(dx * (c1.y - a.y) - dy * (c1.x - a.x))
    const outside = side === outsideSign ? c1 : c2
    hasCorner[i] = 1
    push(flipped[i] ? (outside === c1 ? c2 : c1) : outside, i)
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-9) {
    out.pop()
    edgeOf.pop()
  }
  return { points: out, edgeOf, hasCorner }
}

function withPoints(points: Point[]): PolygonContour {
  return { points, clockwise: signedArea(points) < 0 }
}

/**
 * A constrained contour is valid when it keeps at least three distinct points, the same winding
 * direction with non-zero area, and no more self-crossings than before the step.
 */
function validate(before: readonly Point[], after: readonly Point[], beforeCrossings: () => number): FallbackReason | null {
  if (after.length < 3 || new Set(after.map((p) => `${p.x},${p.y}`)).size !== after.length) return 'collapsed'
  const a0 = signedArea(before)
  const a1 = signedArea(after)
  if (Math.abs(a1) < 1e-6) return 'collapsed'
  if (Math.sign(a1) !== Math.sign(a0)) return 'flipped'
  if (addsCrossings(after, beforeCrossings)) return 'crossings'
  return null
}

function maxShift(a: readonly Point[], b: readonly Point[]): number {
  let max = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) max = Math.max(max, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y))
  return max
}

// ---- Grid snapping ----

/**
 * Rounds to the nearest multiple of `size`. An exact half rounds toward `centre`, so two points placed
 * symmetrically about the centre snap symmetrically too.
 */
export function snapValue(v: number, size: number, centre: number): number {
  const q = v / size
  const below = Math.floor(q)
  const tie = Math.abs(q - below - 0.5) < 1e-9
  const snapped = (tie ? (v < centre ? below + 1 : below) : Math.round(q)) * size
  // Clean floating noise such as 0.30000000000000004 so equal grid points compare equal.
  return Number(snapped.toFixed(6)) + 0
}

/**
 * Snaps every vertex to the grid anchored at the glyph origin (0, 0), so the baseline and the left
 * edge of the advance box are grid lines; exact ties round toward the glyph's centre. Consecutive
 * vertices that land on the same grid point are merged; the first vertex stays first, and a last
 * vertex equal to it is dropped.
 */
function snapContour(
  points: readonly Point[],
  size: number,
  centre: Point,
): { points: Point[] | null; merged: number; maxShift: number } {
  const out: Point[] = []
  let maxShift = 0
  for (const p of points) {
    const q = { x: snapValue(p.x, size, centre.x), y: snapValue(p.y, size, centre.y) }
    maxShift = Math.max(maxShift, Math.hypot(q.x - p.x, q.y - p.y))
    const last = out[out.length - 1]
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q)
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop()
  return { points: out.length >= 3 ? out : null, merged: points.length - out.length, maxShift }
}

// ---- Angle lock ----

/**
 * Nearest allowed direction for an angle in degrees. Allowed directions are multiples of `step`
 * measured counter-clockwise from +x in y-up font space. An exact tie rounds up (counter-clockwise).
 */
export function nearestAllowedAngle(degrees: number, step: number): number {
  const normalized = ((degrees % 360) + 360) % 360
  return (Math.round(normalized / step) * step) % 360
}

/**
 * Turns every edge to its nearest allowed direction, then adjusts edge lengths (never directions)
 * so the contour closes again. The adjustment is the weighted least-squares change of lengths that
 * makes the edge vectors sum to zero, with each edge weighted by its length so long edges absorb
 * more of the correction. The vertices follow from the adjusted edges, so neighbouring edges stay
 * connected and the contour stays closed. The result is then fitted to the original's bounding box
 * (below) instead of pinning the start vertex and pushing all of the change to the far side. Fails
 * with 'moved' if that changes the shape too much: a vertex moves more than `maxMove`, or the area
 * changes by more than ANGLE_MAX_AREA_CHANGE.
 */
function lockAngles(
  points: readonly Point[],
  step: number,
  maxMove: number,
): { points: Point[] | null; reason: FallbackReason | null } {
  const n = points.length
  if (n < 3) return { points: null, reason: 'collapsed' }

  const dirs: Point[] = []
  const lengths: number[] = []
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const angle = (nearestAllowedAngle((Math.atan2(dy, dx) * 180) / Math.PI, step) * Math.PI) / 180
    const u = { x: Math.cos(angle), y: Math.sin(angle) }
    dirs.push(u)
    // Projection onto the locked direction; positive because the turn is at most step / 2 ≤ 45°.
    lengths.push(dx * u.x + dy * u.y)
  }

  // Residual r = Σ lᵢuᵢ; solve (Σ wᵢuᵢuᵢᵀ) λ = r and set lᵢ' = lᵢ − wᵢ (uᵢ·λ).
  let rx = 0
  let ry = 0
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const { x, y } = dirs[i]
    const w = Math.max(lengths[i], 0)
    rx += lengths[i] * x
    ry += lengths[i] * y
    sxx += w * x * x
    sxy += w * x * y
    syy += w * y * y
  }
  const det = sxx * syy - sxy * sxy
  let lambda = { x: 0, y: 0 }
  if (Math.hypot(rx, ry) > 1e-9) {
    // All edges parallel: no length change can close the contour.
    if (Math.abs(det) < 1e-9) return { points: null, reason: 'unsolvable' }
    lambda = { x: (syy * rx - sxy * ry) / det, y: (sxx * ry - sxy * rx) / det }
  }

  const out: Point[] = [{ x: points[0].x, y: points[0].y }]
  for (let i = 0; i < n; i++) {
    const w = Math.max(lengths[i], 0)
    const length = lengths[i] - w * (dirs[i].x * lambda.x + dirs[i].y * lambda.y)
    // A non-positive or tiny length would reverse or collapse the edge.
    if (length < MIN_EDGE) return { points: null, reason: 'unsolvable' }
    if (i < n - 1) {
      const p = out[i]
      out.push({ x: p.x + length * dirs[i].x, y: p.y + length * dirs[i].y })
    }
  }

  // Place the locked contour on the original's bounding box. Every edge keeps only the part of its
  // length along its new direction, so locking shrinks curves (at 90° an O loses about 30 % of its
  // width and height); scaling it back keeps letters their size, and placing it keeps them where they
  // were. At 90° every edge is horizontal or vertical, so width and height are scaled separately;
  // otherwise one scale keeps the box's area, so diagonals keep their angle, and the contour is centred
  // sideways and keeps its bottom (letters stay on the baseline).
  const before = ringBox(points)
  const after = ringBox(out)
  const w0 = before.maxX - before.minX
  const h0 = before.maxY - before.minY
  const w1 = after.maxX - after.minX
  const h1 = after.maxY - after.minY
  if (!(w1 > 1e-9 && h1 > 1e-9)) return { points: null, reason: 'collapsed' }
  let sx: number
  let sy: number
  if (step === 90) {
    sx = w0 / w1
    sy = h0 / h1
  } else {
    sx = sy = Math.sqrt((w0 * h0) / (w1 * h1))
  }
  const cx0 = (before.minX + before.maxX) / 2
  const cx1 = (after.minX + after.maxX) / 2
  const placed = out.map((p) => ({ x: cx0 + (p.x - cx1) * sx, y: before.minY + (p.y - after.minY) * sy }))
  const growth = signedArea(placed) / signedArea(points) - 1
  if (maxShift(points, placed) > maxMove || Math.abs(growth) > ANGLE_MAX_AREA_CHANGE) return { points: null, reason: 'moved' }
  return { points: placed, reason: null }
}
