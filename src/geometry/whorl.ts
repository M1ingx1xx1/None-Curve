// Experimental Whorl: a swirl around the middle of each letter. Pure functions in font units; no React,
// no DOM, no Math.random.
//
// The mesh is the one Ripple uses: concentric regular polygons (Sides) around the centre of the
// glyph's ink box, flat side at the bottom, cut into cells by rays through the corners, each cell split
// into two triangles. The outermost of the Rings lies half the ink box's height from the centre, so
// the top and bottom of the letter sit on it. Instead of moving out and in, every ring turns as a whole
// about the centre, so it stays a regular polygon, and points in between move linearly with their
// triangle (see warp.ts): straight edges bend only where they cross the mesh, and the swirl is built
// from straight pieces.
//
// Two ways to turn:
// - Pinned (head and foot held): the outermost ring and everything beyond it stay put; the rings turn
//   more toward the centre.
// - Whole: the centre stays put and the rings turn more toward the outside; everything beyond the
//   outermost ring turns with it, as one piece.
//
// Neighbouring rings turn by the same step relative to each other. Turned too far, the triangles
// between them flip, and the further out the ring, the smaller the step that does it. At 100% the step
// is 90% of the largest that keeps every triangle the same way round (worked out for the Sides and
// Rings in use, with the cell diagonals laid along the swirl), so the warp is one-to-one. Above 100%
// triangles flip, the letter folds onto itself, and the overlaps are merged into one outline (see
// overlaps.ts).

import { clamp } from './primitives'
import type { Box } from './ripple'
import type { PolygonGlyph, WhorlMotion, WhorlParams, Point } from './types'
import type { Warp } from './warp'

export const WHORL_LIMITS = {
  minRings: 2,
  maxRings: 12,
  minSides: 3,
  maxSides: 12,
  /** -4 to 4: above 1 either way (the safe range), the letter folds. */
  maxAmount: 4,
  /** At 100%, the share of the largest step between rings that keeps every triangle the same way round. */
  safety: 0.9,
  /** The swirl reaches at least this far from the centre (× the em), so flat glyphs such as a hyphen still turn. */
  minRadius: 0.05,
} as const

export function whorlIsOn(params: WhorlParams | undefined): boolean {
  return !!params && params.enabled && finite(params.amount, 0) !== 0
}

/** True when Whorl goes beyond its safe range, so the letter folds onto itself. */
export function whorlFolds(params: WhorlParams | undefined): boolean {
  return whorlIsOn(params) && Math.abs(params!.amount) > 1
}

/**
 * What Glide needs to turn the letter's anchors the way Whorl turns them (PolygonGlyph.motion): its centre, Sides,
 * settings, the outermost ring's distance from the centre (along a side's normal), how far each ring turned, and the
 * letter as Whorl received it (`before`).
 */
export function whorlMotion(params: WhorlParams, box: Box, unitsPerEm: number, before?: PolygonGlyph): WhorlMotion {
  const { rings, sides, amount, pinned, centre, radius, turn } = whorlSetup(params, box, unitsPerEm, 1)
  const motion: WhorlMotion = { x: centre.x, y: centre.y, sides, rings, amount, pinned, radius, turns: Array.from({ length: rings + 1 }, (_, k) => turn(k)) }
  if (before) motion.outline = before.contours.map((c) => c.points)
  return motion
}

/** Whorl's mesh and turns for a glyph with this ink box, at `scale` × its strength (shared by the warp and Glide). */
function whorlSetup(params: WhorlParams, box: Box, unitsPerEm: number, scale: number) {
  const rings = Math.round(clamp(finite(params.rings, 6), WHORL_LIMITS.minRings, WHORL_LIMITS.maxRings))
  const sides = Math.round(clamp(finite(params.sides, 8), WHORL_LIMITS.minSides, WHORL_LIMITS.maxSides))
  const amount = clamp(finite(params.amount, 0), -WHORL_LIMITS.maxAmount, WHORL_LIMITS.maxAmount) * scale
  const pinned = params.pinned !== false
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  const radius = Math.max((box.maxY - box.minY) / 2, WHORL_LIMITS.minRadius * unitsPerEm)
  const spacing = radius / rings
  const half = Math.PI / sides
  const tanHalf = Math.tan(half)
  // Ray j points at angle first + j × 2·half; wedge j lies between rays j and j + 1, one wedge centred
  // straight down, so the polygons sit on a flat side.
  const first = -Math.PI / 2 + half

  // Which way ring k + 1 turns relative to ring k: Whole turns the outside more, Pinned the inside.
  const sign = amount < 0 ? -1 : 1
  const relative = pinned ? -sign : sign
  // Lay the cell diagonals along the swirl: whichever way lets the rings turn further.
  const limits = [true, false].map((rising) => ({ rising, step: largestStep(rings, half, rising, relative) }))
  const best = limits[0].step >= limits[1].step ? limits[0] : limits[1]
  const rising = best.rising
  const step = Math.abs(amount) * WHORL_LIMITS.safety * best.step
  /** How far ring k turns (radians, counter-clockwise); beyond the outermost ring, as that ring. */
  const turn = (k: number) => {
    const r = Math.min(k, rings)
    return sign * step * (pinned ? rings - r : r)
  }
  return { rings, sides, amount, pinned, centre, radius, spacing, half, tanHalf, first, rising, turn }
}

/** The Whorl warp for a glyph with this ink box, at `scale` × its strength. */
export function whorlWarp(params: WhorlParams, box: Box, unitsPerEm: number, scale = 1): Warp {
  const { rings, sides, centre, spacing, half, tanHalf, first, rising, turn } = whorlSetup(params, box, unitsPerEm, scale)

  const frames = Array.from({ length: sides }, (_, j) => {
    const mid = first + (2 * j + 1) * half
    return { mx: Math.cos(mid), my: Math.sin(mid) }
  })
  const toWedge = (j: number, p: Point) => {
    const { mx, my } = frames[j]
    const dx = p.x - centre.x
    const dy = p.y - centre.y
    return { s: (mx * dx + my * dy) / spacing, x: (mx * dy - my * dx) / (spacing * tanHalf) }
  }
  const fromWedge = (j: number, s: number, x: number): Point => {
    const { mx, my } = frames[j]
    const along = s * spacing
    const across = x * spacing * tanHalf
    return { x: centre.x + mx * along - my * across, y: centre.y + my * along + mx * across }
  }
  const wedgeOf = (p: Point) => {
    const angle = (Math.atan2(p.y - centre.y, p.x - centre.x) - first) / (2 * half)
    return ((Math.floor(angle) % sides) + sides) % sides
  }
  const rotate = (p: Point, angle: number): Point => {
    if (angle === 0) return p
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const dx = p.x - centre.x
    const dy = p.y - centre.y
    return { x: centre.x + c * dx - s * dy, y: centre.y + s * dx + c * dy }
  }

  return {
    map(p) {
      if (p.x === centre.x && p.y === centre.y) return p
      const j = wedgeOf(p)
      const { s, x } = toWedge(j, p)
      if (s >= rings) return rotate(p, turn(rings))
      const k = Math.floor(s)
      // The cell's corners: ring k on rays j and j + 1, ring k + 1 on rays j + 1 and j (at the centre,
      // ring 0 is a single point).
      const a: Corner = [k, -k]
      const b: Corner = [k, k]
      const c: Corner = [k + 1, k + 1]
      const d: Corner = [k + 1, -(k + 1)]
      let triangle: [Corner, Corner, Corner]
      if (k === 0) triangle = [a, c, d]
      else if (rising) triangle = x >= -k + (2 * k + 1) * (s - k) ? [a, b, c] : [a, c, d]
      else triangle = x >= k - (2 * k + 1) * (s - k) ? [b, c, d] : [a, b, d]
      const w = barycentric(s, x, ...triangle)
      let mx = 0
      let my = 0
      for (let n = 0; n < 3; n++) {
        const [cs, cx] = triangle[n]
        const image = rotate(fromWedge(j, cs, cx), turn(cs))
        mx += w[n] * image.x
        my += w[n] * image.y
      }
      return { x: mx, y: my }
    },

    creases(a, b) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      // Rays first: they split the segment into pieces that each lie in one wedge. Only inside the
      // rings are they creases; beyond them everything turns as one.
      const ts: { t: number; crease: boolean }[] = []
      for (let j = 0; j < sides; j++) {
        const angle = first + 2 * j * half
        const ux = Math.cos(angle)
        const uy = Math.sin(angle)
        const denominator = dx * uy - dy * ux
        if (denominator === 0) continue
        const ax = centre.x - a.x
        const ay = centre.y - a.y
        const t = (ax * uy - ay * ux) / denominator
        const along = (ax * dy - ay * dx) / denominator
        if (t > 0 && t < 1 && along > 0) ts.push({ t, crease: (along * Math.cos(half)) / spacing < rings })
      }
      // A segment through the centre crosses every ray there at once: split it at the centre.
      const length2 = dx * dx + dy * dy
      const tc = length2 > 0 ? ((centre.x - a.x) * dx + (centre.y - a.y) * dy) / length2 : -1
      if (tc > 0 && tc < 1 && Math.hypot(a.x + dx * tc - centre.x, a.y + dy * tc - centre.y) <= 1e-9 * Math.sqrt(length2)) ts.push({ t: tc, crease: true })
      ts.sort((p, q) => p.t - q.t)

      const out: number[] = []
      let t0 = 0
      for (let n = 0; n <= ts.length; n++) {
        const t1 = n < ts.length ? ts[n].t : 1
        if (t1 > t0) wedgeCreases(t0, t1)
        if (n < ts.length && ts[n].crease && (out.length === 0 || out[out.length - 1] < t1)) out.push(t1)
        t0 = t1
      }
      return out

      /** Ring sides and cell diagonals crossed between t0 and t1, which lie in one wedge. */
      function wedgeCreases(from: number, to: number) {
        const mid = (from + to) / 2
        const j = wedgeOf({ x: a.x + dx * mid, y: a.y + dy * mid })
        const pa = toWedge(j, a)
        const pb = toWedge(j, b)
        const ds = pb.s - pa.s
        const dxw = pb.x - pa.x
        const crossings: number[] = []
        if (ds !== 0) {
          const lo = Math.min(pa.s + ds * from, pa.s + ds * to)
          const hi = Math.max(pa.s + ds * from, pa.s + ds * to)
          for (let k = Math.max(1, Math.floor(lo) + 1); k < hi && k <= rings; k++) {
            const t = (k - pa.s) / ds
            if (t > from && t < to) crossings.push(t)
          }
          crossings.sort((p, q) => p - q)
        }
        let r0 = from
        for (let n = 0; n <= crossings.length; n++) {
          const r1 = n < crossings.length ? crossings[n] : to
          const k = Math.floor(pa.s + ds * ((r0 + r1) / 2))
          if (k >= 1 && k < rings) {
            // Rising diagonal of cell k: x = -k + (2k + 1)(s - k); falling: x = k - (2k + 1)(s - k).
            const t = rising
              ? ((2 * k + 1) * (pa.s - k) - k - pa.x) / (dxw - (2 * k + 1) * ds)
              : (k - (2 * k + 1) * (pa.s - k) - pa.x) / (dxw + (2 * k + 1) * ds)
            if (t > r0 && t < r1) out.push(t)
          }
          if (n < crossings.length) out.push(r1)
          r0 = r1
        }
      }
    },
  }
}

/**
 * The inverse of Whorl's warp, for Glide (specimen/trajectory.ts): where a point of the turned letter lay before Whorl
 * turned it, found exactly by the mesh triangle whose turned image holds it (the warp moves each triangle as a whole).
 * The turns are the motion's own (an in-between glyph's may lie part of the way). Where the letter folds, several
 * triangles hold the point: the answer with the lowest `score` wins. Null when none holds it.
 */
export function whorlUnwarp(motion: WhorlMotion): (p: Point, score: (x: number, y: number) => number) => Point | null {
  const params: WhorlParams = { enabled: true, amount: motion.amount, rings: motion.rings, sides: motion.sides, pinned: motion.pinned }
  const box: Box = { minX: motion.x - 1, maxX: motion.x + 1, minY: motion.y - motion.radius, maxY: motion.y + motion.radius }
  const { rings, sides, centre, spacing, half, tanHalf, first, rising } = whorlSetup(params, box, 0, 1)
  const last = motion.turns.length - 1
  const turn = (k: number) => (last >= 0 ? motion.turns[Math.min(k, last)] : 0)
  const frames = Array.from({ length: sides }, (_, j) => {
    const mid = first + (2 * j + 1) * half
    return { mx: Math.cos(mid), my: Math.sin(mid) }
  })
  // Every triangle: its corners before (pre) and after (image) the turn, flat: x0 y0 x1 y1 x2 y2.
  const pre: number[] = []
  const image: number[] = []
  for (let j = 0; j < sides; j++) {
    const { mx, my } = frames[j]
    for (let k = 0; k < rings; k++) {
      const a: Corner = [k, -k]
      const b: Corner = [k, k]
      const c: Corner = [k + 1, k + 1]
      const d: Corner = [k + 1, -(k + 1)]
      const triangles: Corner[][] = k === 0 ? [[a, c, d]] : rising ? [[a, b, c], [a, c, d]] : [[b, c, d], [a, b, d]]
      for (const triangle of triangles)
        for (const [cs, cx] of triangle) {
          const along = cs * spacing
          const across = cx * spacing * tanHalf
          const px = mx * along - my * across
          const py = my * along + mx * across
          const t = turn(cs)
          pre.push(centre.x + px, centre.y + py)
          image.push(centre.x + Math.cos(t) * px - Math.sin(t) * py, centre.y + Math.sin(t) * px + Math.cos(t) * py)
        }
    }
  }
  const count = pre.length / 6
  const outer = turn(rings)
  return (p, score) => {
    let best: Point | null = null
    let bestD = Infinity
    const consider = (x: number, y: number) => {
      const d = score(x, y)
      if (d < bestD) {
        bestD = d
        best = { x, y }
      }
    }
    for (let t = 0; t < count; t++) {
      const o = 6 * t
      const x0 = image[o]
      const y0 = image[o + 1]
      const e1x = image[o + 2] - x0
      const e1y = image[o + 3] - y0
      const e2x = image[o + 4] - x0
      const e2y = image[o + 5] - y0
      const area = e1x * e2y - e2x * e1y
      if (Math.abs(area) < 1e-12 * (e1x * e1x + e1y * e1y + e2x * e2x + e2y * e2y)) continue
      const qx = p.x - x0
      const qy = p.y - y0
      const w1 = (qx * e2y - e2x * qy) / area
      const w2 = (e1x * qy - qx * e1y) / area
      const eps = 1e-9
      if (w1 < -eps || w2 < -eps || w1 + w2 > 1 + eps) continue
      const w0 = 1 - w1 - w2
      consider(w0 * pre[o] + w1 * pre[o + 2] + w2 * pre[o + 4], w0 * pre[o + 1] + w1 * pre[o + 3] + w2 * pre[o + 5])
    }
    // Beyond the outermost ring everything turned as one.
    const c = Math.cos(-outer)
    const s = Math.sin(-outer)
    const dx = p.x - centre.x
    const dy = p.y - centre.y
    const ux = c * dx - s * dy
    const uy = s * dx + c * dy
    const angle = (Math.atan2(uy, ux) - first) / (2 * half)
    const j = ((Math.floor(angle) % sides) + sides) % sides
    if ((frames[j].mx * ux + frames[j].my * uy) / spacing >= rings - 1e-9) consider(centre.x + ux, centre.y + uy)
    return best
  }
}

/** Whorl's mesh as Glide moves it (specimen/whorlGlide.ts). */
export interface WhorlMesh {
  /** Equal for the same mesh (centre, size, Rings, Sides and diagonals): the same corners and triangles. */
  key: string
  rings: number
  sides: number
  centre: Point
  /** The distance between rings, along a side's normal. */
  spacing: number
  /** The corners before the turn and their rings: corner 0 is the centre, then ring by ring (1 to Rings), ray by ray. */
  cornerX: Float64Array
  cornerY: Float64Array
  cornerRing: Int32Array
  /** The triangle a point (before the turn) lies in, as its corners and weights; null beyond the outermost ring. */
  locate(p: Point): { ids: [number, number, number]; weights: [number, number, number] } | null
  /** Where the segment a → b (before the turn) crosses the mesh, as in Warp.creases. */
  creases(a: Point, b: Point): number[]
}

/** The mesh Whorl turned a glyph's letter with, from its motion (PolygonGlyph.motion). */
export function whorlMesh(motion: WhorlMotion): WhorlMesh {
  const params: WhorlParams = { enabled: true, amount: motion.amount, rings: motion.rings, sides: motion.sides, pinned: motion.pinned }
  const box: Box = { minX: motion.x - 1, maxX: motion.x + 1, minY: motion.y - motion.radius, maxY: motion.y + motion.radius }
  const { rings, sides, centre, spacing, half, tanHalf, first, rising } = whorlSetup(params, box, 0, 1)
  const count = 1 + rings * sides
  const cornerX = new Float64Array(count)
  const cornerY = new Float64Array(count)
  const cornerRing = new Int32Array(count)
  cornerX[0] = centre.x
  cornerY[0] = centre.y
  const corner = (k: number, ray: number) => (k === 0 ? 0 : 1 + (k - 1) * sides + (((ray % sides) + sides) % sides))
  for (let k = 1; k <= rings; k++)
    for (let ray = 0; ray < sides; ray++) {
      const angle = first + 2 * ray * half
      // Ray corners lie on the ring polygon's corners: the apothem over cos(half) from the centre.
      const r = (k * spacing) / Math.cos(half)
      const id = corner(k, ray)
      cornerX[id] = centre.x + r * Math.cos(angle)
      cornerY[id] = centre.y + r * Math.sin(angle)
      cornerRing[id] = k
    }
  const warp = whorlWarp(params, box, 0, 1)
  return {
    key: [centre.x, centre.y, motion.radius, rings, sides, rising].join(' '),
    rings,
    sides,
    centre,
    spacing,
    cornerX,
    cornerY,
    cornerRing,
    locate(p) {
      if (p.x === centre.x && p.y === centre.y) return { ids: [0, 0, 0], weights: [1, 0, 0] }
      const angle = (Math.atan2(p.y - centre.y, p.x - centre.x) - first) / (2 * half)
      const j = ((Math.floor(angle) % sides) + sides) % sides
      const mid = first + (2 * j + 1) * half
      const mx = Math.cos(mid)
      const my = Math.sin(mid)
      const dx = p.x - centre.x
      const dy = p.y - centre.y
      const s = (mx * dx + my * dy) / spacing
      const x = (mx * dy - my * dx) / (spacing * tanHalf)
      if (s >= rings) return null
      const k = Math.floor(s)
      const a: Corner = [k, -k]
      const b: Corner = [k, k]
      const c: Corner = [k + 1, k + 1]
      const d: Corner = [k + 1, -(k + 1)]
      let triangle: [Corner, Corner, Corner]
      if (k === 0) triangle = [a, c, d]
      else if (rising) triangle = x >= -k + (2 * k + 1) * (s - k) ? [a, b, c] : [a, c, d]
      else triangle = x >= k - (2 * k + 1) * (s - k) ? [b, c, d] : [a, b, d]
      const weights = barycentric(s, x, ...triangle)
      // [k, -k] lies on ray j, [k, k] on ray j + 1.
      const ids = triangle.map(([cs, cx]) => corner(cs, cx < 0 || (cs > 0 && cx === -cs) ? j : j + 1)) as [number, number, number]
      return { ids, weights }
    },
    creases: (a, b) => warp.creases(a, b),
  }
}

/** A mesh corner in wedge coordinates: ring index s and across position x. */
type Corner = [number, number]

/** largestStep's answers: it depends only on its arguments (whole Rings and Sides), and searches step by step. */
const largestSteps = new Map<string, number>()

/**
 * The largest turn (radians) of each ring relative to the one inside it, in direction `relative`, that
 * keeps every triangle between the rings the same way round, with rising or falling cell diagonals.
 * Only how far neighbouring rings turn apart matters, and the outer cells allow the least.
 */
function largestStep(rings: number, half: number, rising: boolean, relative: number): number {
  const key = `${rings} ${half} ${rising} ${relative}`
  let step = largestSteps.get(key)
  if (step === undefined) largestSteps.set(key, (step = searchStep(rings, half, rising, relative)))
  return step
}

function searchStep(rings: number, half: number, rising: boolean, relative: number): number {
  const tanHalf = Math.tan(half)
  // Wedge 0's frame with the wedge's middle along +x; ring spacing 1.
  const at = (s: number, x: number, angle: number) => {
    const px = s
    const py = x * tanHalf
    return { x: Math.cos(angle) * px - Math.sin(angle) * py, y: Math.sin(angle) * px + Math.cos(angle) * py }
  }
  const area = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  /** True when every triangle of cell k keeps its orientation with ring k + 1 turned by `angle` against ring k. */
  const keeps = (k: number, angle: number) => {
    const a = at(k, -k, 0)
    const b = at(k, k, 0)
    const c = at(k + 1, k + 1, angle)
    const d = at(k + 1, -(k + 1), angle)
    const triangles = rising ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]]
    // These corner orders run clockwise in the unturned mesh.
    return triangles.every(([p, q, r]) => area(p, q, r) < 0)
  }
  let limit = Math.PI
  for (let k = 1; k < rings; k++) {
    // Walk out in small steps to the first flip, then narrow it down.
    let lo = 0
    let hi = 0
    const stride = Math.PI / 720
    while (hi < limit && keeps(k, relative * (hi + stride))) hi += stride
    if (hi >= limit) continue
    lo = hi
    hi = Math.min(limit, hi + stride)
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2
      if (keeps(k, relative * mid)) lo = mid
      else hi = mid
    }
    limit = Math.min(limit, lo)
  }
  return limit
}

/** Barycentric weights of (s, x) in the triangle t1, t2, t3. */
function barycentric(s: number, x: number, t1: Corner, t2: Corner, t3: Corner): [number, number, number] {
  const area = (t2[0] - t1[0]) * (t3[1] - t1[1]) - (t3[0] - t1[0]) * (t2[1] - t1[1])
  const w2 = ((s - t1[0]) * (t3[1] - t1[1]) - (t3[0] - t1[0]) * (x - t1[1])) / area
  const w3 = ((t2[0] - t1[0]) * (x - t1[1]) - (s - t1[0]) * (t2[1] - t1[1])) / area
  return [1 - w2 - w3, w2, w3]
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}
