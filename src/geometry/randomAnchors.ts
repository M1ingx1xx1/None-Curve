// Seeded random anchors. Pure functions in font units; no React, no DOM, no Math.random.
//
// Instead of Flatten's regular sampling, anchors are placed at random arc-length positions on the
// original curves, so every anchor lies exactly on the source outline. Randomness comes from an
// integer hash of (seed, the contour's outline, attempt), so the same seed and settings always give
// the same polygon for the same outline, also in different glyphs that share it (Latin A, Greek Alpha).

import { ContourLayout } from './contourLayout'
import { addsCrossings, countSelfCrossings, lazy } from './crossings'
import { hashInts } from './distortion'
import { evaluate, signedArea, type FlattenResult } from './flatten'
import type { Point, PolygonContour, PolygonGlyph, RandomAnchorParams, SourceContour, SourceGlyph } from './types'

export const RANDOM_ANCHOR_LIMITS = {
  minDensity: 1,
  maxDensity: 100,
  maxSeed: 999_999,
  /** A source joint that turns by more than this many degrees is kept as a corner anchor. */
  cornerAngle: 30,
  /** Hard cap per contour, whatever the density. */
  maxAnchorsPerContour: 2000,
  /** Arc-length table samples per curve segment. */
  samplesPerCurve: 32,
  /** Anchors closer than this (font units) are merged. */
  minGap: 0.5,
  /** Different random draws tried, in order, before a contour falls back to Flatten's result. */
  attempts: 4,
} as const

export interface RandomAnchorStats {
  applied: boolean
  /** Anchors in the generated polygon, before the later pipeline steps. */
  anchors: number
  /** Source corners kept as fixed anchors. */
  corners: number
  /** Contours that needed another random draw because the first one was invalid. */
  redrawnContours: number
  /** Contours where no draw was valid; they use Flatten's result instead. */
  fallbackContours: number
}

type Piece = readonly Point[] // 2 points (line), 3 (quadratic) or 4 (cubic)

interface ArcTable {
  pieces: Piece[]
  /** Cumulative arc length at each sample; samples[k] belongs to pieces[piece[k]] at parameter t[k]. */
  s: number[]
  piece: number[]
  t: number[]
  /** Arc length at the start of each piece. */
  pieceStart: number[]
  total: number
}

/**
 * Replaces each contour of Flatten's result with random anchors on its source curves. A draw must keep
 * the contour's direction, add no self-crossings, and sit against the glyph's other contours as
 * Flatten's contour does (counters stay inside, separate parts apart); otherwise the next draw is
 * tried, and after the last one the contour keeps Flatten's result.
 */
export function applyRandomAnchors(
  source: SourceGlyph,
  flattened: FlattenResult,
  params: RandomAnchorParams,
): { polygon: PolygonGlyph; stats: RandomAnchorStats } {
  const stats: RandomAnchorStats = { applied: false, anchors: 0, corners: 0, redrawnContours: 0, fallbackContours: 0 }
  if (!params.enabled) return { polygon: flattened.polygon, stats }

  stats.applied = true
  const settings = {
    density: clamp(finite(params.density, 12), RANDOM_ANCHOR_LIMITS.minDensity, RANDOM_ANCHOR_LIMITS.maxDensity),
    randomness: clamp(finite(params.randomness, 1), 0, 1),
    keepCorners: Boolean(params.keepCorners),
    seed: Math.trunc(finite(params.seed, 1)) | 0,
  }

  const base = flattened.polygon.contours
  const current = base.map((c) => c.points)
  const layout = new ContourLayout(current.slice())
  const contours = base.map((contour, k): PolygonContour => {
    const sourceContour = source.contours[flattened.sources[k]]
    const table = buildTable(sourceContour)
    if (!table || table.total <= 0) return contour
    const crossings = lazy(() => countSelfCrossings(contour.points))
    const area = signedArea(contour.points)
    const outline = outlineHash(sourceContour)

    for (let attempt = 0; attempt < RANDOM_ANCHOR_LIMITS.attempts; attempt++) {
      const random = mulberry32(hashInts(settings.seed, outline, attempt))
      const drawn = drawContour(table, settings, random)
      if (isValid(drawn.points, area, crossings) && layout.keeps(current, k, drawn.points)) {
        if (attempt > 0) stats.redrawnContours++
        stats.anchors += drawn.points.length
        stats.corners += drawn.corners
        current[k] = drawn.points
        return { points: drawn.points, clockwise: signedArea(drawn.points) < 0 }
      }
    }
    stats.fallbackContours++
    stats.anchors += contour.points.length
    return contour
  })

  return { polygon: { ...flattened.polygon, contours }, stats }
}

/** Hash of a contour's coordinates: the same outline gets the same draws in every glyph. */
function outlineHash(contour: SourceContour): number {
  // Coordinates in 1/64 font units, so outlines equal up to float noise hash alike.
  let h = hashInts(Math.round(contour.start.x * 64), Math.round(contour.start.y * 64))
  for (const segment of contour.segments) {
    const points =
      segment.type === 'line'
        ? [segment.to]
        : segment.type === 'quad'
          ? [segment.control, segment.to]
          : [segment.control1, segment.control2, segment.to]
    for (const p of points) h = hashInts(h, Math.round(p.x * 64), Math.round(p.y * 64))
  }
  return h
}

// ---- Sampling ----

interface Settings {
  density: number
  randomness: number
  keepCorners: boolean
  seed: number
}

function drawContour(table: ArcTable, s: Settings, random: () => number): { points: Point[]; corners: number } {
  const corners = s.keepCorners ? findCorners(table) : []
  const positions: number[] = []

  if (corners.length >= 2) {
    // Corners stay fixed; each stretch between two corners gets its own random anchors.
    for (let i = 0; i < corners.length; i++) {
      const start = corners[i]
      const end = i + 1 < corners.length ? corners[i + 1] : corners[0] + table.total
      const length = end - start
      const n = anchorCount(length, s.density, 0)
      const slot = length / (n + 1)
      positions.push(start)
      for (let k = 1; k <= n; k++) positions.push(start + slot * (k + (random() - 0.5) * s.randomness))
    }
  } else {
    // One closed loop: a random starting point (or the single corner), then stratified anchors.
    const n = anchorCount(table.total, s.density, 3)
    const slot = table.total / n
    const offset = corners.length === 1 ? corners[0] : random() * slot * s.randomness
    for (let k = 0; k < n; k++) {
      const jitter = corners.length === 1 && k === 0 ? 0 : (random() - 0.5) * s.randomness
      positions.push(offset + slot * (k + jitter))
    }
  }

  const points: Point[] = []
  for (const position of positions) {
    const p = pointAt(table, ((position % table.total) + table.total) % table.total)
    const last = points[points.length - 1]
    if (!last || dist(last, p) >= RANDOM_ANCHOR_LIMITS.minGap) points.push(p)
  }
  while (points.length > 1 && dist(points[0], points[points.length - 1]) < RANDOM_ANCHOR_LIMITS.minGap) points.pop()
  return { points, corners: corners.length }
}

function anchorCount(length: number, density: number, minimum: number): number {
  return Math.min(RANDOM_ANCHOR_LIMITS.maxAnchorsPerContour, Math.max(minimum, Math.round((length * density) / 1000)))
}

/** Arc-length positions of joints that turn by more than the corner angle. */
function findCorners(table: ArcTable): number[] {
  const { pieces } = table
  const limit = Math.cos((RANDOM_ANCHOR_LIMITS.cornerAngle * Math.PI) / 180)
  const out: number[] = []
  for (let i = 0; i < pieces.length; i++) {
    const into = endDirection(pieces[(i - 1 + pieces.length) % pieces.length])
    const from = startDirection(pieces[i])
    if (!into || !from) continue
    if (into.x * from.x + into.y * from.y < limit) out.push(table.pieceStart[i])
  }
  return out
}

function pointAt(table: ArcTable, s: number): Point {
  // Binary search for the last sample at or before s.
  let lo = 0
  let hi = table.s.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (table.s[mid] <= s) lo = mid
    else hi = mid - 1
  }
  const k = lo
  const next = k + 1 < table.s.length ? k + 1 : -1
  const piece = table.piece[k]
  // Interpolate the curve parameter between two samples of the same piece, then evaluate the
  // curve itself, so the anchor lies exactly on the source outline.
  if (next >= 0 && table.piece[next] === piece) {
    const span = table.s[next] - table.s[k]
    const f = span > 0 ? (s - table.s[k]) / span : 0
    return evaluate(table.pieces[piece], table.t[k] + (table.t[next] - table.t[k]) * f)
  }
  return evaluate(table.pieces[piece], table.t[k])
}

function buildTable(contour: SourceContour): ArcTable | null {
  const pieces: Piece[] = []
  let prev = contour.start
  for (const segment of contour.segments) {
    const piece =
      segment.type === 'line'
        ? [prev, segment.to]
        : segment.type === 'quad'
          ? [prev, segment.control, segment.to]
          : [prev, segment.control1, segment.control2, segment.to]
    for (const p of piece) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    prev = segment.to
    if (piece.every((p) => p.x === piece[0].x && p.y === piece[0].y)) continue // zero-length
    pieces.push(piece)
  }
  // Close the contour with a straight line when the last point is not the start.
  if (dist(prev, contour.start) > 0) pieces.push([prev, contour.start])
  if (pieces.length === 0) return null

  const table: ArcTable = { pieces, s: [], piece: [], t: [], pieceStart: [], total: 0 }
  let length = 0
  pieces.forEach((piece, index) => {
    table.pieceStart.push(length)
    const steps = piece.length === 2 ? 1 : RANDOM_ANCHOR_LIMITS.samplesPerCurve
    let last = piece[0]
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const p = evaluate(piece, t)
      length += dist(last, p)
      last = p
      table.s.push(length)
      table.piece.push(index)
      table.t.push(t)
    }
    const end = piece[piece.length - 1]
    length += dist(last, end)
    // Final sample of the piece at t = 1, so interpolation inside the piece covers its whole length.
    table.s.push(length)
    table.piece.push(index)
    table.t.push(1)
  })
  table.total = length
  return table
}

function startDirection(piece: Piece): Point | null {
  for (let i = 1; i < piece.length; i++) {
    const d = unit(piece[0], piece[i])
    if (d) return d
  }
  return null
}

function endDirection(piece: Piece): Point | null {
  const end = piece[piece.length - 1]
  for (let i = piece.length - 2; i >= 0; i--) {
    const d = unit(piece[i], end)
    if (d) return d
  }
  return null
}

function isValid(points: readonly Point[], referenceArea: number, fallbackCrossings: () => number): boolean {
  if (points.length < 3) return false
  const area = signedArea(points)
  if (Math.abs(area) < 1e-6 || Math.sign(area) !== Math.sign(referenceArea)) return false
  return !addsCrossings(points, fallbackCrossings)
}

// ---- Deterministic random numbers ----

/** Small seeded PRNG; returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- Helpers ----

function unit(a: Point, b: Point): Point | null {
  const l = Math.hypot(b.x - a.x, b.y - a.y)
  return l < 1e-9 ? null : { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}
