import { simplifyClosed } from '../geometry/anchors'
import { findSelfCrossings, type Crossing } from '../geometry/crossings'
import { signedArea } from '../geometry/flatten'
import type { Point, PolygonGlyph } from '../geometry/types'

export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded // no "-0"
}

/**
 * Light simplifications (RDP tolerance, in units of the rounding step) tried when a rounded contour
 * still crosses itself: they only remove detail finer than the rounding grid can hold.
 */
const RETRY_TOLERANCES = [0.5, 1, 2]
/** Vertex removals tried per contour to undo crossings that rounding introduced. */
const MAX_REPAIRS = 12
/** A contour smaller than this many square rounding steps is too small to show; if rounding
    collapses it, it is left out instead of the whole glyph. */
const NEGLIGIBLE_AREA = 4

/**
 * Rounds every contour to `decimals` places and makes sure rounding did not damage it. Each contour
 * is rounded, then cleaned (repeated points, zero-length edges, and points on a straight line between
 * their neighbours — including back-and-forth spikes — are removed, which changes nothing visible),
 * then checked: at least three points, the same direction (so counters stay holes), non-zero area,
 * and no new self-crossings. A crossing is new only where the unrounded contour neither crossed
 * itself nor ran within two rounding steps of itself: outlines that already overlap (common in
 * fonts), or whose parts nearly touch, cannot avoid that at this precision, and the difference is
 * smaller than the rounding step. Rounding crossings are first repaired by removing one of the
 * vertices involved; if a new crossing remains, the contour is simplified very slightly (below the
 * rounding step) and tried again. A contour too small to show that collapses is left out. Throws
 * ExportError naming the glyph only when nothing works; `advice` (for example "Use a higher
 * precision.") is appended to that message. Output is y-up font units.
 */
export function quantizePolygon(polygon: PolygonGlyph, decimals: number, label: string, advice = ''): Point[][] {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new ExportError(`Precision must be a whole number from 0 to 6 (got ${decimals}).`)
  }
  const step = 10 ** -decimals
  const out: Point[][] = []
  for (const contour of polygon.contours) {
    for (const p of contour.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new ExportError(`${label} has a non-finite coordinate.`)
    }
    const area = signedArea(contour.points)
    const direction = Math.sign(area)
    const original = new Original(contour.points)

    let failure: 'collapse' | 'cross' = 'collapse'
    let result: Point[] | null = null
    for (const tolerance of [0, ...RETRY_TOLERANCES]) {
      const source = tolerance === 0 ? contour.points : simplifyClosed(contour.points, tolerance * step).points
      const attempt = roundContour(source, decimals, direction, step, original)
      if (Array.isArray(attempt)) {
        result = attempt
        break
      }
      failure = attempt
    }
    if (result) out.push(result)
    else if (failure === 'collapse' && Math.abs(area) < NEGLIGIBLE_AREA * step * step) continue
    else {
      const places = decimals === 0 ? 'whole units' : `${decimals} decimal place${decimals === 1 ? '' : 's'}`
      const what = failure === 'collapse' ? 'a contour collapses or flips' : 'a contour crosses itself'
      throw new ExportError(`${label}: ${what} when its points are rounded to ${places}.${advice ? ` ${advice}` : ''}`)
    }
  }
  return out
}

/** The unrounded contour, for telling rounding noise from real damage. */
class Original {
  private crossings: Point[] | null = null
  constructor(readonly points: readonly Point[]) {}

  /** True when the contour crossed itself near `at`. */
  hasCrossingNear(at: Point, radius: number): boolean {
    this.crossings ??= findSelfCrossings(this.points).map((c) => c.at)
    return this.crossings.some((k) => Math.abs(k.x - at.x) <= radius && Math.abs(k.y - at.y) <= radius)
  }

  /** True when the contour crossed itself, or ran within `radius` of itself, near `at`. */
  explains(at: Point, radius: number): boolean {
    if (this.hasCrossingNear(at, radius)) return true
    // Two parts of the outline close to the point that are not neighbouring edges: a near touch.
    const n = this.points.length
    const near: number[] = []
    for (let i = 0; i < n; i++) {
      if (distanceToSegment(at, this.points[i], this.points[(i + 1) % n]) <= radius) near.push(i)
    }
    return near.some((a) => near.some((b) => {
      const gap = Math.abs(a - b)
      return Math.min(gap, n - gap) >= 2
    }))
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** One attempt: round, clean, then repair new crossings. Returns the contour or why it failed. */
function roundContour(
  points: readonly Point[],
  decimals: number,
  direction: number,
  step: number,
  original: Original,
): Point[] | 'collapse' | 'cross' {
  const rounded = clean(points.map((p) => ({ x: roundTo(p.x, decimals), y: roundTo(p.y, decimals) })))
  if (!healthy(rounded, direction)) return 'collapse'
  // Repair any crossing rounding added (cleaner outlines), then accept what is only rounding noise.
  // A repair moves an edge, so if the repaired contour is not acceptable, the plain one may still be.
  let out = rounded
  let added = addedCrossings(out, original, step, false)
  for (let i = 0; added.length > 0 && i < MAX_REPAIRS; i++) {
    const repaired = repair(out, added[0], direction, original, step, added.length)
    if (!repaired) break
    out = repaired.points
    added = repaired.added
  }
  for (const candidate of out === rounded ? [out] : [out, rounded]) {
    if (addedCrossings(candidate, original, step, true).length === 0) return candidate
  }
  return 'cross'
}

const healthy = (points: readonly Point[], direction: number) => {
  const area = signedArea(points)
  return points.length >= 3 && Math.abs(area) > 1e-9 && Math.sign(area) === direction
}

/**
 * Removes repeated points and points lying on the straight line through their neighbours (this
 * includes the tip of a spike that goes out and comes straight back). Repeats until nothing changes.
 */
function clean(points: Point[]): Point[] {
  let out = points
  for (let changed = true; changed && out.length >= 3; ) {
    changed = false
    const next: Point[] = []
    for (let i = 0; i < out.length; i++) {
      const prev = next.length ? next[next.length - 1] : out[out.length - 1]
      const p = out[i]
      const after = out[(i + 1) % out.length]
      if ((p.x === prev.x && p.y === prev.y) || Math.abs(cross(prev, p, after)) < 1e-9) {
        changed = true
        continue
      }
      next.push(p)
    }
    out = next
  }
  return out
}

/** Removes one endpoint of a new crossing: the choice that leaves the fewest new crossings. */
function repair(
  points: Point[],
  crossing: Crossing,
  direction: number,
  original: Original,
  step: number,
  currentCount: number,
): { points: Point[]; added: Crossing[] } | null {
  const n = points.length
  const candidates = new Set([crossing.i, (crossing.i + 1) % n, crossing.j, (crossing.j + 1) % n])
  let best: { points: Point[]; added: Crossing[]; areaChange: number } | null = null
  const area = signedArea(points)
  for (const index of candidates) {
    const trial = clean(points.filter((_, k) => k !== index))
    if (!healthy(trial, direction)) continue
    const added = addedCrossings(trial, original, step, false)
    if (added.length >= currentCount) continue
    const areaChange = Math.abs(signedArea(trial) - area)
    if (!best || added.length < best.added.length || (added.length === best.added.length && areaChange < best.areaChange)) {
      best = { points: trial, added, areaChange }
    }
  }
  return best
}

/**
 * Crossings of the rounded contour that the original did not have. With `allowNearTouch`, crossings
 * where the original ran within two rounding steps of itself are accepted as rounding noise.
 */
function addedCrossings(points: readonly Point[], original: Original, step: number, allowNearTouch: boolean): Crossing[] {
  const found = findSelfCrossings(points)
  if (!found.length) return found
  const radius = 2 * step
  return found.filter((c) => (allowNearTouch ? !original.explains(c.at, radius) : !original.hasCrossingNear(c.at, radius)))
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
