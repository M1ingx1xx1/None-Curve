// Deterministic vertex distortion. Pure functions in font units; no React, no DOM, no Math.random.
//
// Each vertex moves by smooth 1D value noise sampled at its arc-length position along the contour.
// Lattice values come from an integer hash of (seed, contour index, channel, lattice cell), so the
// same glyph, parameters, contour order, and point order always give the same result.

import { countSelfCrossings } from './anchors'
import { signedArea } from './flatten'
import type { DistortionParams, Point, PolygonContour, PolygonGlyph } from './types'

export const DISTORTION_LIMITS = {
  maxAmount: 200,
  minFrequency: 0.5,
  maxFrequency: 50,
  /**
   * The two ends of an edge may move apart or together by at most this fraction of the edge length,
   * so no edge can collapse or reverse. Smooth noise moves neighbours alike, so dense outlines keep
   * their full amplitude.
   */
  edgeFraction: 0.5,
  /** Passes of the edge protection; each pass only shortens displacements. */
  protectionPasses: 4,
  /** Amplitude scales tried, in order, when a distorted contour is invalid. */
  retryScales: [1, 0.5, 0.25] as const,
} as const

export interface DistortionStats {
  applied: boolean
  /** Largest actual vertex displacement (font units). */
  maxShift: number
  /** Vertices whose displacement was shortened to protect short edges and sharp turns. */
  clampedVertices: number
  /** Contours that needed a smaller amplitude to stay valid. */
  reducedContours: number
  /** Contours left undistorted because no tried amplitude was valid. */
  fallbackContours: number
}

export function applyDistortion(polygon: PolygonGlyph, params: DistortionParams): { polygon: PolygonGlyph; stats: DistortionStats } {
  const stats: DistortionStats = { applied: false, maxShift: 0, clampedVertices: 0, reducedContours: 0, fallbackContours: 0 }
  const amount = clamp(finite(params.amount, 0), 0, DISTORTION_LIMITS.maxAmount)
  if (amount === 0) return { polygon, stats }

  stats.applied = true
  const settings = {
    amount,
    frequency: clamp(finite(params.frequency, 8), DISTORTION_LIMITS.minFrequency, DISTORTION_LIMITS.maxFrequency),
    normalBias: clamp(finite(params.normalBias, 0.7), 0, 1),
    seed: Math.trunc(finite(params.seed, 1)) | 0,
  }

  const contours = polygon.contours.map((contour, index) => {
    const before = contour.points
    if (before.length < 3) return contour
    const crossingsBefore = lazy(() => countSelfCrossings(before))
    for (const scale of DISTORTION_LIMITS.retryScales) {
      const result = distortContour(before, index, { ...settings, amount: amount * scale })
      if (isValid(before, result.points, crossingsBefore)) {
        if (scale < 1) stats.reducedContours++
        stats.clampedVertices += result.clamped
        stats.maxShift = Math.max(stats.maxShift, result.maxShift)
        return { points: result.points, clockwise: signedArea(result.points) < 0 } satisfies PolygonContour
      }
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
}

function distortContour(points: readonly Point[], contourIndex: number, s: Settings) {
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

  const offsets: Point[] = []
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
    const noiseNormal = periodicNoise(t, cells, s.seed, contourIndex, 0)
    const noiseTangent = periodicNoise(t, cells, s.seed, contourIndex, 1)
    offsets.push({
      x: s.amount * (wNormal * noiseNormal * nx + wTangent * noiseTangent * tx),
      y: s.amount * (wNormal * noiseNormal * ny + wTangent * noiseTangent * ty),
    })
  }

  // Edge protection: if the ends of an edge would move relative to each other by more than
  // edgeFraction × its length, shorten both displacements. The new edge then keeps at least half its
  // length and its direction (no zero-length edges, no fold-backs at short edges or sharp turns).
  const scale = new Array<number>(n).fill(1)
  for (let pass = 0; pass < DISTORTION_LIMITS.protectionPasses; pass++) {
    let changed = false
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const edge = dist(points[i], points[j])
      const rx = offsets[j].x * scale[j] - offsets[i].x * scale[i]
      const ry = offsets[j].y * scale[j] - offsets[i].y * scale[i]
      const relative = Math.hypot(rx, ry)
      const limit = DISTORTION_LIMITS.edgeFraction * edge
      if (relative > limit) {
        const k = limit / relative
        scale[i] *= k
        scale[j] *= k
        changed = true
      }
    }
    if (!changed) break
  }

  const out: Point[] = []
  let clamped = 0
  let maxShift = 0
  for (let i = 0; i < n; i++) {
    const dx = offsets[i].x * scale[i]
    const dy = offsets[i].y * scale[i]
    if (scale[i] < 1) clamped++
    maxShift = Math.max(maxShift, Math.hypot(dx, dy))
    out.push({ x: points[i].x + dx, y: points[i].y + dy })
  }
  return { points: out, clamped, maxShift }
}

function isValid(before: readonly Point[], after: readonly Point[], crossingsBefore: () => number): boolean {
  for (let i = 0; i < after.length; i++) if (dist(after[i], after[(i + 1) % after.length]) < 1e-6) return false
  const a0 = signedArea(before)
  const a1 = signedArea(after)
  if (Math.abs(a1) < 1e-6 || Math.sign(a1) !== Math.sign(a0)) return false
  const crossings = countSelfCrossings(after)
  return crossings === 0 || crossings <= crossingsBefore()
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

function lazy<T>(compute: () => T): () => T {
  let done = false
  let value: T
  return () => {
    if (!done) {
      value = compute()
      done = true
    }
    return value
  }
}
