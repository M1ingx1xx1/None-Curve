import { simplifyClosed } from '../geometry/anchors'
import { ContourLayout } from '../geometry/contourLayout'
import { findRingCrossings, findSelfCrossings, ringBox, type Crossing } from '../geometry/crossings'
import { cross, distanceToSegment, signedArea } from '../geometry/primitives'
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
/**
 * A contour that already crosses itself more than this many times is a tangle (an outline left
 * unmerged): any crossing rounding adds there is noise below one rounding step, so it is rounded once
 * and kept as it is, without the repairs, the checks of each new crossing, or the simplified retries,
 * whose cost grows with the square of its crossings. Its direction and its place among the other
 * contours are still checked.
 */
const TANGLE_CROSSINGS = 2000
/** A contour smaller than this many square rounding steps is too small to show; if rounding
    collapses it, it is left out instead of the whole glyph. */
const NEGLIGIBLE_AREA = 4
/** Likewise a contour narrower on average than this many rounding steps (twice its area over its
    perimeter): a sliver that strong effects can squeeze out of a stroke cannot be drawn at this
    precision, however long it is. */
const NEGLIGIBLE_WIDTH = 1

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
 * rounding step) and tried again; a tangle, crossing itself thousands of times, is not (see
 * TANGLE_CROSSINGS). Every result must also sit against the glyph's other contours as
 * before: no contour moving into or out of another, and no new crossing between two contours except
 * where they already ran within two rounding steps of each other. A contour too small to show that
 * collapses is left out. Contours are rounded in order, and in the reverse order if that fails. Throws ExportError naming the glyph only when nothing works; `advice` (for example "Use a higher
 * precision.") is appended to that message. Output is y-up font units.
 */
export function quantizePolygon(polygon: PolygonGlyph, decimals: number, label: string, advice = ''): Point[][] {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new ExportError(`Precision must be a whole number from 0 to 6 (got ${decimals}).`)
  }
  const step = 10 ** -decimals
  const places = decimals === 0 ? 'whole units' : `${decimals} decimal place${decimals === 1 ? '' : 's'}`
  for (const contour of polygon.contours) {
    for (const p of contour.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new ExportError(`${label} has a non-finite coordinate.`)
    }
  }
  // Contours are rounded one after another, each checked against the others as they stand, so the
  // order matters: a repair of one contour can leave a neighbour no room to round. If the first order
  // fails, the reverse order is tried before giving up.
  const forward = polygon.contours.map((_, k) => k)
  const first = roundInOrder(polygon, forward, decimals, step)
  const result = Array.isArray(first) ? first : roundInOrder(polygon, forward.slice().reverse(), decimals, step)
  if (Array.isArray(result)) return result.filter((c): c is Point[] => c !== null)
  const what = {
    collapse: 'a contour collapses or flips',
    cross: 'a contour crosses itself',
    contours: 'a contour crosses another',
  }
  const failure = Array.isArray(first) ? result : first
  throw new ExportError(
    `${label}: ${what[failure]} when its points are rounded to ${places}.${advice ? ` ${advice}` : ''}`,
  )
}

/** Rounds the contours in the given order; the rounded contours by index (null: left out), or why it failed. */
function roundInOrder(
  polygon: PolygonGlyph,
  order: readonly number[],
  decimals: number,
  step: number,
): (Point[] | null)[] | 'collapse' | 'cross' | 'contours' {
  // Contours as they stand: rounded once done, unrounded until then (null: left out). Each rounded
  // contour must sit against the others as the unrounded ones do.
  const unrounded = polygon.contours.map((c) => c.points)
  const current: (readonly Point[] | null)[] = unrounded.slice()
  const layout = new ContourLayout(unrounded)
  const near = neighbours(unrounded, 2 * step)
  for (const k of order) {
    const contour = polygon.contours[k]
    const area = signedArea(contour.points)
    const direction = Math.sign(area)
    const original = new Original(contour.points, 2 * step)
    const fits = (points: readonly Point[]) => fitsLayout(k, points, current, unrounded, layout, step, near[k])

    let failure: 'collapse' | 'cross' | 'contours' = 'collapse'
    let result: Point[] | null = null
    for (const tolerance of [0, ...RETRY_TOLERANCES]) {
      const source = tolerance === 0 ? contour.points : simplifyClosed(contour.points, tolerance * step).points
      const attempt = roundContour(source, decimals, direction, original, fits)
      if (Array.isArray(attempt)) {
        result = attempt
        break
      }
      failure = attempt
      if (original.tangled) break
    }
    if (result) current[k] = result
    else if (failure === 'collapse' && negligible(contour.points, area, step)) current[k] = null
    else return failure
  }
  return current as (Point[] | null)[]
}

/** Too small or too thin to show at this precision (see NEGLIGIBLE_AREA and NEGLIGIBLE_WIDTH). */
function negligible(points: readonly Point[], area: number, step: number): boolean {
  if (Math.abs(area) < NEGLIGIBLE_AREA * step * step) return true
  let perimeter = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    perimeter += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return perimeter > 0 && (2 * Math.abs(area)) / perimeter < NEGLIGIBLE_WIDTH * step
}

/**
 * True when contour k, rounded to `points`, sits against the other contours as before. A new
 * crossing with another contour is accepted where both unrounded contours ran within two rounding
 * steps of it: contours that nearly touch cannot avoid that at this precision. Only the contours
 * `around` it can sit otherwise (see neighbours).
 */
function fitsLayout(
  k: number,
  points: readonly Point[],
  current: readonly (readonly Point[] | null)[],
  unrounded: readonly (readonly Point[])[],
  layout: ContourLayout,
  step: number,
  around: readonly number[],
): boolean {
  const radius = 2 * step
  const near = (at: Point, ring: readonly Point[]) =>
    ring.some((p, i) => distanceToSegment(at, p, ring[(i + 1) % ring.length]) <= radius)
  for (const m of around) {
    const other = current[m]
    if (!other || layout.pairKept(k, m, points, other)) continue
    const found = findRingCrossings(points, other)
    if (found.length === 0 || !found.every((c) => near(c.at, unrounded[k]) && near(c.at, unrounded[m]))) return false
  }
  return true
}

/**
 * For each contour, the others whose boxes come within `margin` of its box, in index order. Every
 * contour tried while rounding is made of rounded points of the unrounded one, at most half a rounding
 * step away, so with a margin of a step or more, contours farther apart stay apart, and sit as they did
 * (neither crossing nor inside one another). A glyph merged from strong effects can have thousands of
 * contours, nearly all of them far from each other.
 */
function neighbours(contours: readonly (readonly Point[])[], margin: number): number[][] {
  const boxes = contours.map((points) => ringBox(points))
  const around: number[][] = contours.map(() => [])
  const order = contours.map((_, k) => k).sort((k, m) => boxes[k].minX - boxes[m].minX)
  for (let a = 0; a < order.length; a++) {
    const p = boxes[order[a]]
    for (let b = a + 1; b < order.length; b++) {
      const q = boxes[order[b]]
      if (q.minX > p.maxX + margin) break
      if (q.minY > p.maxY + margin || q.maxY < p.minY - margin) continue
      around[order[a]].push(order[b])
      around[order[b]].push(order[a])
    }
  }
  for (const list of around) list.sort((k, m) => k - m)
  return around
}

/**
 * The unrounded contour, for telling rounding noise from real damage within `radius` (two rounding
 * steps). Its crossings with itself are kept by grid cell, so finding one near a point does not go
 * through them all: a tangle can have hundreds of thousands.
 */
class Original {
  private crossings: { cells: Map<number, Map<number, Point[]>>; count: number } | null = null
  constructor(
    readonly points: readonly Point[],
    readonly radius: number,
  ) {}

  /** True when the contour crosses itself more than TANGLE_CROSSINGS times. */
  get tangled(): boolean {
    return this.indexed().count > TANGLE_CROSSINGS
  }

  /** True when the contour crossed itself near `at`. */
  hasCrossingNear(at: Point): boolean {
    const { cells } = this.indexed()
    const { radius } = this
    const x = this.cell(at.x)
    const y = this.cell(at.y)
    for (let dx = -1; dx <= 1; dx++) {
      const column = cells.get(x + dx)
      if (!column) continue
      for (let dy = -1; dy <= 1; dy++) {
        const found = column.get(y + dy)
        if (found?.some((k) => Math.abs(k.x - at.x) <= radius && Math.abs(k.y - at.y) <= radius)) return true
      }
    }
    return false
  }

  /** True when the contour crossed itself, or ran within `radius` of itself, near `at`. */
  explains(at: Point): boolean {
    if (this.hasCrossingNear(at)) return true
    // Two parts of the outline close to the point that are not neighbouring edges: a near touch.
    const { radius } = this
    const n = this.points.length
    const near: number[] = []
    for (let i = 0; i < n; i++) {
      if (distanceToSegment(at, this.points[i], this.points[(i + 1) % n]) <= radius) near.push(i)
    }
    return near.some((a) =>
      near.some((b) => {
        const gap = Math.abs(a - b)
        return Math.min(gap, n - gap) >= 2
      }),
    )
  }

  /**
   * The grid column (or row) of a coordinate. A cell is twice the radius wide, so everything within
   * the radius of a point lies in the three by three cells around it.
   */
  private cell(value: number): number {
    return Math.floor(value / (2 * this.radius))
  }

  /** The contour's crossings with itself, by column and then row (see cell), and how many there are. */
  private indexed() {
    if (!this.crossings) {
      const cells = new Map<number, Map<number, Point[]>>()
      const found = findSelfCrossings(this.points)
      for (const { at } of found) {
        const x = this.cell(at.x)
        const y = this.cell(at.y)
        let column = cells.get(x)
        if (!column) cells.set(x, (column = new Map()))
        const list = column.get(y)
        if (list) list.push(at)
        else column.set(y, [at])
      }
      this.crossings = { cells, count: found.length }
    }
    return this.crossings
  }
}

/**
 * One attempt: round, clean, then repair new crossings. Returns the contour or why it failed; `fits`
 * checks it against the glyph's other contours.
 */
function roundContour(
  points: readonly Point[],
  decimals: number,
  direction: number,
  original: Original,
  fits: (points: readonly Point[]) => boolean,
): Point[] | 'collapse' | 'cross' | 'contours' {
  const rounded = clean(points.map((p) => ({ x: roundTo(p.x, decimals), y: roundTo(p.y, decimals) })))
  if (!healthy(rounded, direction)) return 'collapse'
  const found = findSelfCrossings(rounded)
  // A tangle is taken as rounded (see TANGLE_CROSSINGS).
  if (found.length > 0 && original.tangled) return fits(rounded) ? rounded : 'contours'
  // Repair any crossing rounding added (cleaner outlines), then accept what is only rounding noise.
  // A repair moves an edge, so if the repaired contour is not acceptable, the plain one may still be.
  let out = rounded
  let added = addedCrossings(out, original, false, found)
  for (let i = 0; added.length > 0 && i < MAX_REPAIRS; i++) {
    const repaired = repair(out, added[0], direction, original, added.length)
    if (!repaired) break
    out = repaired.points
    added = repaired.added
  }
  let failure: 'cross' | 'contours' = 'cross'
  for (const candidate of out === rounded ? [out] : [out, rounded]) {
    if (addedCrossings(candidate, original, true).length > 0) continue
    if (fits(candidate)) return candidate
    failure = 'contours'
  }
  return failure
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
  for (let changed = true; changed && out.length >= 3;) {
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
  currentCount: number,
): { points: Point[]; added: Crossing[] } | null {
  const n = points.length
  const candidates = new Set([crossing.i, (crossing.i + 1) % n, crossing.j, (crossing.j + 1) % n])
  let best: { points: Point[]; added: Crossing[]; areaChange: number } | null = null
  const area = signedArea(points)
  for (const index of candidates) {
    const trial = clean(points.filter((_, k) => k !== index))
    if (!healthy(trial, direction)) continue
    const added = addedCrossings(trial, original, false)
    if (added.length >= currentCount) continue
    const areaChange = Math.abs(signedArea(trial) - area)
    if (
      !best ||
      added.length < best.added.length ||
      (added.length === best.added.length && areaChange < best.areaChange)
    ) {
      best = { points: trial, added, areaChange }
    }
  }
  return best
}

/**
 * Crossings of the rounded contour (`found`, when already known) that the original did not have. With
 * `allowNearTouch`, crossings where the original ran within two rounding steps of itself are accepted
 * as rounding noise.
 */
function addedCrossings(
  points: readonly Point[],
  original: Original,
  allowNearTouch: boolean,
  found = findSelfCrossings(points),
): Crossing[] {
  if (!found.length) return found
  return found.filter((c) => (allowNearTouch ? !original.explains(c.at) : !original.hasCrossingNear(c.at)))
}
