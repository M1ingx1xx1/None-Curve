// Curve merging for fixed-segment flattening. Pure functions in font units; no React, no DOM.
//
// Fonts build one visible curve out of several Bézier segments (TrueType especially: consecutive
// off-curve points create implied on-curve points). "N lines per curve" then applies to every small
// segment, so the result stays smooth. Merging joins consecutive curve segments that meet smoothly
// into one run and samples the whole run with N edges, spaced evenly by arc length.

import type { Point, SourceContour } from './types'

/** Where a run of joined curves is broken. */
export type BreakRule = 'extrema' | 'corners'

type Curve = Point[] // 3 points (quadratic) or 4 points (cubic)

export type ContourItem = { kind: 'line'; to: Point } | { kind: 'run'; pieces: Curve[]; sourceSegments: number }

/** Joints whose tangent is within this angle of horizontal or vertical count as extrema. */
const EXTREMUM_JOINT_DEGREES = 1
/** Parameters this close to a segment end are not used to split it. */
const T_EPSILON = 1e-4
/** Samples per curve piece when measuring arc length. */
const SAMPLES_PER_PIECE = 32

/**
 * Splits a contour into straight lines and runs of joined curves. A run breaks at every straight
 * segment, at every joint where the direction turns by more than `cornerAngle` degrees, at the
 * contour start (so the start point is kept), and — with rule 'extrema' — wherever the curve is
 * horizontal or vertical (its leftmost, rightmost, top, and bottom points), including inside a
 * segment.
 */
export function buildCurveRuns(contour: SourceContour, breakAt: BreakRule, cornerAngle: number): ContourItem[] {
  type Entry = { kind: 'line'; to: Point } | { kind: 'curve'; pts: Curve; forcedBreak: boolean; segmentStart: boolean }
  const entries: Entry[] = []
  let prev = contour.start
  for (const seg of contour.segments) {
    if (seg.type === 'line') {
      entries.push({ kind: 'line', to: seg.to })
    } else {
      const curve: Curve = seg.type === 'quad' ? [prev, seg.control, seg.to] : [prev, seg.control1, seg.control2, seg.to]
      const pieces = breakAt === 'extrema' ? splitAtExtrema(curve) : [curve]
      pieces.forEach((pts, i) => entries.push({ kind: 'curve', pts, forcedBreak: i > 0, segmentStart: i === 0 }))
    }
    prev = seg.to
  }

  const cornerRad = (Math.max(0, cornerAngle) * Math.PI) / 180
  const items: ContourItem[] = []
  let run: Curve[] | null = null
  let runSegments = 0
  let previous: Entry | null = null
  const closeRun = () => {
    if (run) items.push({ kind: 'run', pieces: run, sourceSegments: runSegments })
    run = null
    runSegments = 0
  }

  for (const entry of entries) {
    if (entry.kind === 'line') {
      closeRun()
      items.push(entry)
    } else {
      let breakHere = previous === null || previous.kind === 'line' || entry.forcedBreak
      if (!breakHere && previous?.kind === 'curve') {
        const out = endTangent(previous.pts)
        const into = startTangent(entry.pts)
        if (turnAngle(out, into) > cornerRad) breakHere = true
        else if (breakAt === 'extrema' && isAxisAligned(into)) breakHere = true
      }
      if (breakHere) closeRun()
      run ??= []
      run.push(entry.pts)
      if (entry.segmentStart) runSegments++
    }
    previous = entry
  }
  closeRun()
  return items
}

/**
 * Samples a run with exactly `n` edges spaced evenly by arc length and pushes the end point of each
 * (the run's start point is already the previous point). Returns the largest distance from the
 * densely sampled curve to the edge that replaces it.
 */
export function sampleRun(pieces: readonly Curve[], n: number, push: (p: Point) => void): number {
  const dense: Point[] = [pieces[0][0]]
  for (const piece of pieces) for (let k = 1; k <= SAMPLES_PER_PIECE; k++) dense.push(evaluate(piece, k / SAMPLES_PER_PIECE))
  const cumulative = [0]
  for (let i = 1; i < dense.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y))
  const total = cumulative[cumulative.length - 1]

  const out: Point[] = [dense[0]]
  let j = 1
  for (let i = 1; i < n; i++) {
    const target = (total * i) / n
    while (j < dense.length - 1 && cumulative[j] < target) j++
    const span = cumulative[j] - cumulative[j - 1]
    const f = span > 0 ? (target - cumulative[j - 1]) / span : 0
    out.push({ x: dense[j - 1].x + (dense[j].x - dense[j - 1].x) * f, y: dense[j - 1].y + (dense[j].y - dense[j - 1].y) * f })
  }
  out.push(dense[dense.length - 1])
  for (let i = 1; i < out.length; i++) push(out[i])

  // Deviation: each dense sample against the edge covering its arc-length position.
  let deviation = 0
  for (let k = 0; k < dense.length; k++) {
    const edge = total > 0 ? Math.min(n - 1, Math.floor((cumulative[k] / total) * n)) : 0
    deviation = Math.max(deviation, distanceToSegment(dense[k], out[edge], out[edge + 1]))
  }
  return deviation
}

// ---- Helpers ----

function splitAtExtrema(curve: Curve): Curve[] {
  const ts = [...extremaParams(curve, 'x'), ...extremaParams(curve, 'y')]
    .filter((t) => t > T_EPSILON && t < 1 - T_EPSILON)
    .sort((a, b) => a - b)
  const pieces: Curve[] = []
  let rest = curve
  let consumed = 0
  for (const t of ts) {
    const local = (t - consumed) / (1 - consumed)
    if (local <= T_EPSILON || local >= 1 - T_EPSILON) continue
    const [left, right] = splitAt(rest, local)
    pieces.push(left)
    rest = right
    consumed = t
  }
  pieces.push(rest)
  return pieces
}

/** Parameters where the derivative of one coordinate is zero. */
function extremaParams(c: Curve, axis: 'x' | 'y'): number[] {
  const v = c.map((p) => p[axis])
  if (c.length === 3) {
    const denom = v[0] - 2 * v[1] + v[2]
    return Math.abs(denom) < 1e-12 ? [] : [(v[0] - v[1]) / denom]
  }
  // Cubic derivative: 3[(1−t)²(v1−v0) + 2(1−t)t(v2−v1) + t²(v3−v2)] = a t² + b t + c
  const a = -v[0] + 3 * v[1] - 3 * v[2] + v[3]
  const b = 2 * (v[0] - 2 * v[1] + v[2])
  const cc = v[1] - v[0]
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-cc / b]
  const disc = b * b - 4 * a * cc
  if (disc < 0) return []
  const s = Math.sqrt(disc)
  return [(-b + s) / (2 * a), (-b - s) / (2 * a)]
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function evaluate(curve: readonly Point[], t: number): Point {
  let pts = curve.slice()
  while (pts.length > 1) {
    const next: Point[] = []
    for (let i = 0; i < pts.length - 1; i++) next.push(lerp(pts[i], pts[i + 1], t))
    pts = next
  }
  return pts[0]
}

function splitAt(curve: Curve, t: number): [Curve, Curve] {
  const left: Point[] = [curve[0]]
  const right: Point[] = [curve[curve.length - 1]]
  let pts = curve.slice()
  while (pts.length > 1) {
    const next: Point[] = []
    for (let i = 0; i < pts.length - 1; i++) next.push(lerp(pts[i], pts[i + 1], t))
    left.push(next[0])
    right.unshift(next[next.length - 1])
    pts = next
  }
  return [left, right]
}

function direction(a: Point, b: Point): Point | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  return len < 1e-9 ? null : { x: dx / len, y: dy / len }
}

function startTangent(c: Curve): Point | null {
  for (let i = 1; i < c.length; i++) {
    const d = direction(c[0], c[i])
    if (d) return d
  }
  return null
}

function endTangent(c: Curve): Point | null {
  const last = c[c.length - 1]
  for (let i = c.length - 2; i >= 0; i--) {
    const d = direction(c[i], last)
    if (d) return d
  }
  return null
}

function turnAngle(a: Point | null, b: Point | null): number {
  if (!a || !b) return Math.PI
  return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)))
}

function isAxisAligned(t: Point | null): boolean {
  if (!t) return false
  const limit = Math.sin((EXTREMUM_JOINT_DEGREES * Math.PI) / 180)
  return Math.abs(t.x) < limit || Math.abs(t.y) < limit
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}
