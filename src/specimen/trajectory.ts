// Glide's trajectories: the path each anchor takes from where it is on screen to where the new shape puts it. Every
// deformation is anchors moving, but not every one moves them in a straight line, so each effect with a path of its
// own declares it here as a model, and the glyph's own data for it rides on the polygon (PolygonGlyph.motion). Pure:
// no React, no DOM.
//
// - Straight (the default): the anchor goes straight to its new place. Thorn and Burst (new spikes grow straight out of
//   their base on the outline, vanishing ones sink straight back into it), Dissolve, Crumple, Ripple (its rings move in
//   and out along rays from its centre, which are straight), Slipstream, Distortion, Squaring, Random anchors, and the
//   Geometry steps all arrive this way.
// - Whorl: its rings turn about the centre of the glyph's ink box and stay regular polygons (Sides, flat side at the
//   bottom). When Whorl's own settings change, an anchor sweeps around that centre rather than cutting across: it slides
//   along its ring polygon (the regular polygon through it) by as far as Whorl's turn changed at its ring, in straight
//   pieces from corner to corner of that polygon, each piece at an even pace so that it stays a straight line: a
//   "curve" built from straight lines, never a smooth circle. The glyph carries how far Whorl turned each ring
//   (WhorlMotion.turns): the anchors are paired with every ring turned back (where both outlines are nearly the letter
//   before Whorl), and each sweeps the way, and as far, as its ring's turn changed (the whole turn, more than half a
//   circle if so). Whatever lies between the end of that sweep and the anchor's new place (another effect's move, a
//   spike growing or sinking, a ring that grew) is covered in a straight line along the way. The ring an anchor sweeps
//   by is the one its base lies on: for an anchor only one outline has, the end that lies on the other outline. So a
//   spike that grows or sinks while Whorl turns does so straight out of, or back into, its base as the base sweeps.
//
// The first model that plans a path for a glyph wins (TRAJECTORY_MODELS, in order); with none, the anchors go straight.
// So when several effects change at once, Whorl's sweep applies whenever Whorl's own settings changed (the others' moves
// ride along it in straight lines); otherwise, say when only Distortion shifted the box Whorl centres on, the anchors go
// straight.

import type { GlyphMotion, Point, WhorlMotion } from '../geometry/types'
import { whorlUnwarp } from '../geometry/whorl'

/** How the anchors of two outlines are paired before they travel (morph.ts). */
export type Correspondence =
  /** Each anchor to the nearest point of the other outline (kept in order): features grow from and sink to their base. */
  | 'nearest'
  /** By the share of the way round the outline (arc length), after the best turn: for outlines that slide round as a whole. */
  | 'arc'

/**
 * Writes the in-between positions of a contour's anchors at progress `p` (0 at the start, 1 at the end; eased) into the
 * first entries of `xs` and `ys` (which may be longer).
 */
export type TrackPath = (p: number, xs: Float64Array, ys: Float64Array) => void

export interface Trajectory {
  id: string
  correspondence: Correspondence
  /**
   * A point of the old outline ('from') or the new one ('to') with the effect's own move undone, when the effect knows
   * it (Whorl: its warp undone): the anchors are paired there, where both outlines are nearly the same letter. `near`:
   * the point before it on its contour, straightened, for the answer nearest it where several fit (where Whorl folds).
   */
  straighten?: (x: number, y: number, side: 'from' | 'to', near?: Point) => Point
  /**
   * The path of every anchor of one contour, from (sx, sy) to (tx, ty), with anything it needs worked out once.
   * `base[i]` set: the anchor's base (where it sits on the outlines) is its end rather than its start, as for an anchor
   * only the old outline had, which goes to its place on the new one.
   */
  path(sx: Float64Array, sy: Float64Array, tx: Float64Array, ty: Float64Array, base?: Uint8Array): TrackPath
}

export interface TrajectoryModel {
  id: string
  /** The trajectory for a glyph whose motion data went from `from` to `to`, or null when this effect did not move it. */
  plan(from: GlyphMotion | undefined, to: GlyphMotion | undefined): Trajectory | null
}

export const STRAIGHT: Trajectory = {
  id: 'straight',
  correspondence: 'nearest',
  path(sx, sy, tx, ty) {
    return (p, xs, ys) => {
      for (let i = 0; i < sx.length; i++) {
        xs[i] = sx[i] + (tx[i] - sx[i]) * p
        ys[i] = sy[i] + (ty[i] - sy[i]) * p
      }
    }
  },
}

/**
 * The regular polygon Whorl's rings follow: `sides` sides around the origin, flat side at the bottom (font units, y up).
 * `size` is a point's ring: its distance from the centre along the normal of the side it faces (the polygon's apothem
 * through it); `at` is the point on the ring of that size in the direction `angle`. Its corners lie on the rays at
 * `first` + k · `step`.
 */
export function ringPolygon(sides: number) {
  const n = Math.max(3, Math.round(sides))
  const half = Math.PI / n
  const step = 2 * half
  // Side normals point at -π/2 + k·step: one straight down, so the polygon sits on a flat side.
  const facing = (angle: number) => {
    const k = Math.round((angle + Math.PI / 2) / step)
    return Math.cos(angle - (-Math.PI / 2 + k * step))
  }
  return {
    n,
    step,
    first: -Math.PI / 2 + half,
    cosHalf: Math.cos(half),
    facing,
    size(dx: number, dy: number): number {
      return Math.hypot(dx, dy) * facing(Math.atan2(dy, dx))
    },
    at(angle: number, size: number): { x: number; y: number } {
      const r = size / facing(angle)
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
    },
  }
}

export type RingPolygon = ReturnType<typeof ringPolygon>

/** How far Whorl turned the ring of this size (measured along a side's normal; between rings, in proportion). */
export function turnAtSize(w: WhorlMotion | undefined, size: number): number {
  if (!w || w.turns.length === 0) return 0
  const rings = w.turns.length - 1
  const s = w.radius > 0 ? (size / w.radius) * rings : 0
  if (!(s > 0)) return w.turns[0]
  if (s >= rings) return w.turns[rings]
  const k = Math.floor(s)
  return w.turns[k] + (w.turns[k + 1] - w.turns[k]) * (s - k)
}

/**
 * Where the point (dx, dy) from Whorl's centre lay before Whorl turned it: its ring size there and the turn it took.
 * Whorl turns a point by its ring's turn and keeps its distance r from the centre, and the ring is measured before the
 * turn, along the normal of the side the point faced then. So the size is the one that, turned back by its own turn,
 * agrees with itself: r · facing(φ − turn(size)) = size, which lies between r · cos(π/Sides) and r (found by halving).
 */
export function whorlPreimage(w: WhorlMotion, dx: number, dy: number, ring: RingPolygon = ringPolygon(w.sides)): { size: number; turn: number } {
  const r = Math.hypot(dx, dy)
  if (!(r > 0)) return { size: 0, turn: turnAtSize(w, 0) }
  const angle = Math.atan2(dy, dx)
  const miss = (size: number) => r * ring.facing(angle - turnAtSize(w, size)) - size
  let lo = r * ring.cosHalf
  let hi = r
  if (miss(lo) <= 0) hi = lo
  else if (miss(hi) >= 0) lo = hi
  for (let k = 0; k < 48 && hi - lo > 1e-9 * r; k++) {
    const mid = (lo + hi) / 2
    if (miss(mid) > 0) lo = mid
    else hi = mid
  }
  const size = (lo + hi) / 2
  return { size, turn: turnAtSize(w, size) }
}

/** whorlUnwarp, by motion (each is worked out once per glyph and Whorl setting). */
const unwarps = new WeakMap<WhorlMotion, ReturnType<typeof whorlUnwarp>>()

/** The squared distance from (x, y) to the letter as Whorl received it, by motion; null without it. */
const outlines = new WeakMap<WhorlMotion, ((x: number, y: number) => number) | null>()

function outlineDistance(w: WhorlMotion): ((x: number, y: number) => number) | null {
  let known = outlines.get(w)
  if (known !== undefined) return known
  known = null
  if (w.outline && w.outline.length > 0) {
    const sides: number[] = []
    for (const pts of w.outline)
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        sides.push(a.x, a.y, b.x - a.x, b.y - a.y)
      }
    known = (x, y) => {
      let best = Infinity
      for (let o = 0; o < sides.length; o += 4) {
        const dx = sides[o + 2]
        const dy = sides[o + 3]
        const len2 = dx * dx + dy * dy
        let t = len2 > 0 ? ((x - sides[o]) * dx + (y - sides[o + 1]) * dy) / len2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const qx = sides[o] + dx * t - x
        const qy = sides[o + 1] + dy * t - y
        const d = qx * qx + qy * qy
        if (d < best) best = d
      }
      return best
    }
  }
  outlines.set(w, known)
  return known
}

/**
 * Where the point (dx, dy) from Whorl's centre lay before Whorl turned it, from the centre: exactly by the warp's mesh
 * (whorlUnwarp). Where the letter folds, several answers fit: the one on the letter as Whorl received it (the layer the
 * outline shows), then the one nearest `near` (from the centre) or else the ring-by-ring estimate (whorlPreimage);
 * that estimate where no mesh triangle holds the point.
 */
export function whorlUnturn(w: WhorlMotion, dx: number, dy: number, ring: RingPolygon = ringPolygon(w.sides), near?: Point): Point {
  const estimate = whorlPreimage(w, dx, dy, ring).turn
  const cos = Math.cos(-estimate)
  const sin = Math.sin(-estimate)
  const rough = { x: w.x + cos * dx - sin * dy, y: w.y + sin * dx + cos * dy }
  const guess = near ? { x: w.x + near.x, y: w.y + near.y } : rough
  let unwarp = unwarps.get(w)
  if (!unwarp) unwarps.set(w, (unwarp = whorlUnwarp(w)))
  const onOutline = outlineDistance(w)
  const exact =
    unwarp({ x: w.x + dx, y: w.y + dy }, (x, y) => {
      const near = (x - guess.x) ** 2 + (y - guess.y) ** 2
      return onOutline ? onOutline(x, y) + 1e-6 * near : near
    }) ?? rough
  return { x: exact.x - w.x, y: exact.y - w.y }
}

/** Scratch for `along`: no allocation per anchor per frame. */
const at = { x: 0, y: 0 }

/**
 * The point at `angle` on the way from (p0x, p0y), at angle `a0`, to (p1x, p1y), at `a1` (all from the ring's centre),
 * round the ring polygon of `size`: straight from corner to corner, each piece at an even pace (so each is a straight
 * line in time too); the first and last pieces run from and to the ends themselves. Written into `out`.
 */
export function along(
  ring: RingPolygon,
  size: number,
  a0: number,
  p0x: number,
  p0y: number,
  a1: number,
  p1x: number,
  p1y: number,
  angle: number,
  out: { x: number; y: number } = at,
) {
  const lo = Math.min(a0, a1)
  const hi = Math.max(a0, a1)
  if (!(hi > lo)) {
    out.x = p0x
    out.y = p0y
    return
  }
  const t = angle < lo ? lo : angle > hi ? hi : angle
  const k = Math.floor((t - ring.first) / ring.step)
  const c0 = ring.first + k * ring.step
  const c1 = c0 + ring.step
  const from = c0 > lo ? c0 : lo
  const to = c1 < hi ? c1 : hi
  const corner = size / ring.cosHalf
  // The ends of this piece: an end of the way, or a corner of the polygon.
  let fx: number
  let fy: number
  let tx: number
  let ty: number
  if (from === lo) {
    fx = lo === a0 ? p0x : p1x
    fy = lo === a0 ? p0y : p1y
  } else {
    fx = corner * Math.cos(from)
    fy = corner * Math.sin(from)
  }
  if (to === hi) {
    tx = hi === a1 ? p1x : p0x
    ty = hi === a1 ? p1y : p0y
  } else {
    tx = corner * Math.cos(to)
    ty = corner * Math.sin(to)
  }
  const w = to > from ? (t - from) / (to - from) : 0
  out.x = fx + (tx - fx) * w
  out.y = fy + (ty - fy) * w
}

/** The swirl around Whorl's centre (see the top of the file). */
export function whorlTrajectory(from: WhorlMotion | undefined, to: WhorlMotion | undefined): Trajectory | null {
  const start = from ?? to
  const end = to ?? from
  if (!start || !end) return null
  const ringA = ringPolygon(start.sides)
  const ringB = ringPolygon(end.sides)
  // Sides changed: the first half of the sweep runs along the old polygon, the second along the new one.
  const twoRings = ringA.n !== ringB.n
  return {
    id: 'whorl',
    correspondence: 'nearest',
    // Whorl's warp undone, placed about the new centre: both outlines become nearly the letter before Whorl.
    straighten(x, y, side, near) {
      const w = side === 'from' ? from : to
      const c = side === 'from' ? start : end
      const hint = near ? { x: near.x - end.x, y: near.y - end.y } : undefined
      const q = w ? whorlUnturn(w, x - c.x, y - c.y, side === 'from' ? ringA : ringB, hint) : { x: x - c.x, y: y - c.y }
      return { x: end.x + q.x, y: end.y + q.y }
    },
    path(sx, sy, tx, ty, base) {
      const n = sx.length
      const a0 = new Float64Array(n)
      const turn = new Float64Array(n)
      const sizeA = new Float64Array(n)
      const sizeB = new Float64Array(n)
      // Where the sweep starts and ends (from the moving centre), and the straight rest of the way.
      const ox = new Float64Array(n)
      const oy = new Float64Array(n)
      const ex = new Float64Array(n)
      const ey = new Float64Array(n)
      const rx = new Float64Array(n)
      const ry = new Float64Array(n)
      // Sides changed: where the two halves meet.
      const mx = twoRings ? new Float64Array(n) : null
      const my = twoRings ? new Float64Array(n) : null
      for (let i = 0; i < n; i++) {
        const dx0 = sx[i] - start.x
        const dy0 = sy[i] - start.y
        // The ring the anchor sits on, as it was before Whorl: its base's (see the top of the file).
        let size: number
        if (base && base[i]) {
          const q = to ? whorlUnturn(to, tx[i] - end.x, ty[i] - end.y, ringB) : { x: tx[i] - end.x, y: ty[i] - end.y }
          size = ringB.size(q.x, q.y)
        } else {
          const q = from ? whorlUnturn(from, dx0, dy0, ringA) : { x: dx0, y: dy0 }
          size = ringA.size(q.x, q.y)
        }
        const angle0 = Math.atan2(dy0, dx0)
        const d = turnAtSize(to, size) - turnAtSize(from, size)
        a0[i] = angle0
        turn[i] = d
        ox[i] = dx0
        oy[i] = dy0
        sizeA[i] = ringA.size(dx0, dy0)
        sizeB[i] = twoRings ? ringB.size(dx0, dy0) : sizeA[i]
        const e = ringB.at(angle0 + d, sizeB[i])
        ex[i] = e.x
        ey[i] = e.y
        rx[i] = tx[i] - end.x - e.x
        ry[i] = ty[i] - end.y - e.y
        if (mx && my) {
          const m = angle0 + d / 2
          const pa = ringA.at(m, sizeA[i])
          const pb = ringB.at(m, sizeB[i])
          mx[i] = (pa.x + pb.x) / 2
          my[i] = (pa.y + pb.y) / 2
        }
      }
      return (p, xs, ys) => {
        const cx = start.x + (end.x - start.x) * p
        const cy = start.y + (end.y - start.y) * p
        for (let i = 0; i < n; i++) {
          const angle = a0[i] + turn[i] * p
          const a1 = a0[i] + turn[i]
          if (!mx || !my) along(ringA, sizeA[i], a0[i], ox[i], oy[i], a1, ex[i], ey[i], angle)
          else if (p < 0.5) along(ringA, sizeA[i], a0[i], ox[i], oy[i], a0[i] + turn[i] / 2, mx[i], my[i], angle)
          else along(ringB, sizeB[i], a0[i] + turn[i] / 2, mx[i], my[i], a1, ex[i], ey[i], angle)
          xs[i] = cx + at.x + rx[i] * p
          ys[i] = cy + at.y + ry[i] * p
        }
      }
    },
  }
}

const sameWhorl = (a: WhorlMotion | undefined, b: WhorlMotion | undefined) =>
  !!a && !!b && a.amount === b.amount && a.rings === b.rings && a.sides === b.sides && a.pinned === b.pinned

export const WHORL_MODEL: TrajectoryModel = {
  id: 'whorl',
  plan(from, to) {
    // Whorl's own settings changed (or it came on or went off); a moved centre alone is another effect's doing.
    if (!from?.whorl && !to?.whorl) return null
    if (sameWhorl(from?.whorl, to?.whorl)) return null
    return whorlTrajectory(from?.whorl, to?.whorl)
  },
}

/** The effects with paths of their own, first match first. A new one adds its model here and its data to GlyphMotion. */
export const TRAJECTORY_MODELS: readonly TrajectoryModel[] = [WHORL_MODEL]

/** The trajectory for a glyph whose motion data went from `from` to `to`: the first model's that plans one, or straight. */
export function chooseTrajectory(
  from: GlyphMotion | undefined,
  to: GlyphMotion | undefined,
  models: readonly TrajectoryModel[] = TRAJECTORY_MODELS,
): Trajectory {
  for (const model of models) {
    const planned = model.plan(from, to)
    if (planned) return planned
  }
  return STRAIGHT
}
