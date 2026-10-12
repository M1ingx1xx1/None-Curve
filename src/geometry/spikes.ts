// Experimental Spikes: a few anchors of each letter jump straight out from it, so their two edges become long,
// straight spikes reaching into the canvas. Pure functions in font units; no React, no DOM, no Math.random.
//
// Only anchors on the letter's outside (contours not inside another contour) jump, away from the ink. Which
// anchors jump, in which direction and how far all come from an integer hash of the shared Experimental seed and
// the anchor's position, so the same seed and outline always give the same spikes, and a new seed moves them.
// A spike may cross the letter or another spike; the outlines are then merged at the end of the Experimental
// effects (overlaps.ts), as when an effect folds.

import { hashInts } from './distortion'
import { signedArea } from './flatten'
import type { Point, PolygonGlyph, SpikeParams } from './types'

export const SPIKE_LIMITS = {
  minCount: 1,
  maxCount: 12,
  /** Longest jump, as a share of the em. */
  maxReach: 2,
  /** Each anchor jumps at least this share of Reach (the rest is random, up to all of it). */
  minShare: 0.35,
  /** The narrowest base, as a share of the anchor's shorter edge (Width 0). */
  minWidth: 0.02,
} as const

export interface SpikeStats {
  applied: boolean
  /** Anchors that jumped. */
  spikes: number
  /** Longest jump (font units). */
  longest: number
}

export const emptySpikeStats = (): SpikeStats => ({ applied: false, spikes: 0, longest: 0 })

/** Channel numbers keep Spikes' random numbers apart from the other effects' for the same seed. */
const CHANNEL = { pick: 0x5a1, direction: 0x5a2, distance: 0x5a3 } as const
const UINT = 0x1_0000_0000

export function spikesIsOn(params: SpikeParams | undefined): params is SpikeParams {
  return !!params && params.enabled && finite(params.count, 0) >= SPIKE_LIMITS.minCount && finite(params.reach, 0) > 0
}

export function applySpikes(
  polygon: PolygonGlyph,
  params: SpikeParams,
  seed: number,
  unitsPerEm: number,
): { polygon: PolygonGlyph; stats: SpikeStats } {
  const stats = emptySpikeStats()
  const count = Math.round(clamp(finite(params.count, 3), SPIKE_LIMITS.minCount, SPIKE_LIMITS.maxCount))
  const reach = clamp(finite(params.reach, 0.5), 0, SPIKE_LIMITS.maxReach) * unitsPerEm
  const spread = clamp(finite(params.spread, 0.5), 0, 1)
  const width = clamp(finite(params.width, 1), SPIKE_LIMITS.minWidth, 1)
  const contours = polygon.contours.map((c) => c.points)

  // Candidates: every anchor of an outside contour, ranked by a hash of the seed and its position.
  const candidates: { contour: number; index: number; rank: number }[] = []
  contours.forEach((points, contour) => {
    if (points.length < 3 || !isOutside(contours, contour)) return
    points.forEach((p, index) => {
      candidates.push({ contour, index, rank: hashInts(seed, CHANNEL.pick, Math.round(p.x), Math.round(p.y), index) })
    })
  })
  if (candidates.length === 0 || reach === 0) return { polygon, stats }
  candidates.sort((a, b) => a.rank - b.rank || a.contour - b.contour || a.index - b.index)

  // The tip of each spike by contour and anchor; the bases are added when the contours are rebuilt below.
  const tips = contours.map(() => new Map<number, Point>())
  for (const { contour, index } of candidates.slice(0, count)) {
    const points = contours[contour]
    const p = points[index]
    const normal = outwardNormal(points, index)
    if (!normal) continue
    const key = [Math.round(p.x), Math.round(p.y), index] as const
    const turn = (hashInts(seed, CHANNEL.direction, ...key) / UINT - 0.5) * spread * Math.PI
    const share = SPIKE_LIMITS.minShare + (1 - SPIKE_LIMITS.minShare) * (hashInts(seed, CHANNEL.distance, ...key) / UINT)
    const distance = reach * share
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    tips[contour].set(index, {
      x: p.x + distance * (normal.x * cos - normal.y * sin),
      y: p.y + distance * (normal.x * sin + normal.y * cos),
    })
    stats.spikes++
    stats.longest = Math.max(stats.longest, distance)
  }
  if (stats.spikes === 0) return { polygon, stats }
  stats.applied = true
  const moved = contours.map((points, contour) => (tips[contour].size ? withSpikes(points, tips[contour], width) : points))
  return {
    polygon: { ...polygon, contours: moved.map((points) => ({ points, clockwise: signedArea(points) < 0 })) },
    stats,
  }
}

/**
 * The contour with each spiking anchor replaced by its tip. Below Width 1, the spike keeps a narrower base: two new
 * anchors on the anchor's edges, `width` of the shorter edge away from it, so the rest of each edge stays put.
 */
function withSpikes(points: readonly Point[], tips: ReadonlyMap<number, Point>, width: number): Point[] {
  const n = points.length
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const tip = tips.get(i)
    if (!tip) {
      out.push(points[i])
      continue
    }
    const p = points[i]
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const inLength = Math.hypot(p.x - prev.x, p.y - prev.y)
    const outLength = Math.hypot(next.x - p.x, next.y - p.y)
    const base = width * Math.min(inLength, outLength)
    // A neighbour that spikes too keeps half of the edge between them for its own base.
    const room = (length: number, neighbour: number) => (tips.has(neighbour) ? length / 2 : length)
    if (width < 1 && base < room(inLength, (i - 1 + n) % n)) out.push(lerp(p, prev, base / inLength))
    out.push(tip)
    if (width < 1 && base < room(outLength, (i + 1) % n)) out.push(lerp(p, next, base / outLength))
  }
  return out
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
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

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
