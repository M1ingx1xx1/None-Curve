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
//   bottom). When Whorl's own settings change, an anchor sweeps around that centre rather than cutting across: its angle
//   about the centre and its ring (the size of the regular polygon through it) go from the old to the new, and at each
//   moment it sits on that ring polygon, so its path runs along the polygon's straight sides and turns at its corners —
//   a "curve" built from straight lines, never a smooth circle. The glyph carries how far Whorl turned each ring
//   (WhorlMotion.turns): the anchors are paired with every ring turned back (where both outlines are nearly the letter
//   before Whorl), and each turns the way, and as far, as its ring turned (the whole turn, more than half a circle if so).
//
// The first model that plans a path for a glyph wins (TRAJECTORY_MODELS, in order); with none, the anchors go straight.
// So when several effects change at once, Whorl's sweep wins whenever Whorl's own settings changed (the others' moves
// ride along the sweep); otherwise, say when only Distortion shifted the box Whorl centres on, the anchors go straight.

import type { GlyphMotion, WhorlMotion } from '../geometry/types'

/** How the anchors of two outlines are paired before they travel (morph.ts). */
export type Correspondence =
  /** Each anchor to the nearest point of the other outline (kept in order): features grow from and sink to their base. */
  | 'nearest'
  /** By the share of the way round the outline (arc length), after the best turn: for outlines that slide round as a whole. */
  | 'arc'

/** Writes the in-between positions of a contour's anchors at progress `p` (0 at the start, 1 at the end; eased). */
export type TrackPath = (p: number, xs: Float64Array, ys: Float64Array) => void

export interface Trajectory {
  id: string
  correspondence: Correspondence
  /**
   * A point of the old outline ('from') or the new one ('to') with the effect's own move undone, when the effect knows
   * it (Whorl: each ring turned back): the anchors are paired there, where both outlines are nearly the same letter.
   */
  straighten?: (x: number, y: number, side: 'from' | 'to') => { x: number; y: number }
  /** The path of every anchor of one contour, from (sx, sy) to (tx, ty), with anything it needs worked out once. */
  path(sx: Float64Array, sy: Float64Array, tx: Float64Array, ty: Float64Array): TrackPath
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

const TWO_PI = 2 * Math.PI

/** The angle `d` wrapped into (−π, π]. */
function wrap(d: number): number {
  let r = d % TWO_PI
  if (r <= -Math.PI) r += TWO_PI
  else if (r > Math.PI) r -= TWO_PI
  return r
}

/**
 * The regular polygon Whorl's rings follow: `sides` sides around the origin, flat side at the bottom (font units, y up).
 * `size` is a point's ring: its distance from the centre along the normal of the side it faces (the polygon's apothem
 * through it); `at` is the point on the ring of that size in the direction `angle`.
 */
export function ringPolygon(sides: number) {
  const n = Math.max(3, Math.round(sides))
  const half = Math.PI / n
  // Side normals point at -π/2 + k·2·half: one straight down, so the polygon sits on a flat side.
  const facing = (angle: number) => {
    const k = Math.round((angle + Math.PI / 2) / (2 * half))
    return Math.cos(angle - (-Math.PI / 2 + k * 2 * half))
  }
  return {
    size(dx: number, dy: number): number {
      return Math.hypot(dx, dy) * facing(Math.atan2(dy, dx))
    },
    at(angle: number, size: number): { x: number; y: number } {
      const r = size / facing(angle)
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
    },
  }
}

/** How far Whorl turned a point `r` from its centre (its ring, r / spacing; between rings, in proportion). */
function turnAt(w: WhorlMotion | undefined, r: number): number {
  if (!w || w.turns.length === 0) return 0
  const rings = w.turns.length - 1
  const s = w.radius > 0 ? (r / w.radius) * rings : 0
  if (!(s > 0)) return w.turns[0]
  if (s >= rings) return w.turns[rings]
  const k = Math.floor(s)
  return w.turns[k] + (w.turns[k + 1] - w.turns[k]) * (s - k)
}

/** The swirl around Whorl's centre (see the top of the file). */
export function whorlTrajectory(from: WhorlMotion | undefined, to: WhorlMotion | undefined): Trajectory | null {
  const start = from ?? to
  const end = to ?? from
  if (!start || !end) return null
  const ring = ringPolygon(end.sides)
  return {
    id: 'whorl',
    correspondence: 'nearest',
    // Each ring turned back by as far as Whorl turned it (a turn keeps the distance from the centre, so a point's ring
    // is known on either side), about the new centre: both outlines become nearly the letter before Whorl.
    straighten(x, y, side) {
      const w = side === 'from' ? from : to
      const c = side === 'from' ? start : end
      const dx = x - c.x
      const dy = y - c.y
      const angle = -turnAt(w, Math.hypot(dx, dy))
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      return { x: end.x + cos * dx - sin * dy, y: end.y + sin * dx + cos * dy }
    },
    path(sx, sy, tx, ty) {
      const n = sx.length
      const a0 = new Float64Array(n)
      const turn = new Float64Array(n)
      const s0 = new Float64Array(n)
      const grow = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const dx0 = sx[i] - start.x
        const dy0 = sy[i] - start.y
        const dx1 = tx[i] - end.x
        const dy1 = ty[i] - end.y
        const angle0 = Math.atan2(dy0, dx0)
        s0[i] = ring.size(dx0, dy0)
        grow[i] = ring.size(dx1, dy1) - s0[i]
        // As far round as the rings turned between the two (each end at its own ring), the whole way if more than a
        // half turn; the rest is the pair's own offset, the short way.
        const expected = turnAt(to, Math.hypot(dx1, dy1)) - turnAt(from, Math.hypot(dx0, dy0))
        const d = wrap(Math.atan2(dy1, dx1) - angle0)
        a0[i] = angle0
        turn[i] = d + TWO_PI * Math.round((expected - d) / TWO_PI)
      }
      return (p, xs, ys) => {
        const cx = start.x + (end.x - start.x) * p
        const cy = start.y + (end.y - start.y) * p
        for (let i = 0; i < n; i++) {
          const q = ring.at(a0[i] + turn[i] * p, s0[i] + grow[i] * p)
          xs[i] = cx + q.x
          ys[i] = cy + q.y
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
