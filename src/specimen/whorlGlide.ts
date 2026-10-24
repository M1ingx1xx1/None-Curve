// Glide for Whorl on its own: when only Whorl's turn changes (Amount, Pinned, or Whorl coming on or going off) and
// nothing after Whorl reshapes the letter, the in-between shapes are Whorl's own mesh turning part of the way, not two
// outlines paired. Pure: no React, no DOM.
//
// Whorl cuts the letter as it received it (WhorlMotion.outline) into the triangles of its mesh and moves each triangle
// as a whole with its corners; every ring of corners turns about the centre. Here every corner travels from where it
// is shown to where the new turn puts it, round its ring polygon in straight pieces from corner to corner of that
// polygon (trajectory.ts, `along`), as far as its ring's turn changed, and every point of the letter (its anchors and
// the points where its sides cross the mesh) moves with its triangle's corners: a fixed mix of three such paths, so it
// too travels in straight pieces. Beyond the outermost ring the letter turned as one: each point there travels round
// its own ring polygon. So the letter swirls the way Whorl swirls it, where it folds as well, every side stays a
// straight line, and every path is built from straight lines.
//
// The shape at the ends is Whorl's turn of the letter before the overlaps are merged (and before the warp's tidying
// of its smallest creases), which fills the same ink as the computed outline. A glide that goes on from an in-between
// shape starts from the corners as shown. Whorl with other settings changed (Rings, Sides, the box it centres on) or
// with an effect after it (Slipstream, Thorn, Dissolve) is glided by pairing outlines instead (morph.ts).

import type { Point, PolygonGlyph, WhorlMotion } from '../geometry/types'
import { whorlMesh, type WhorlMesh } from '../geometry/whorl'
import type { MeshData } from './planData'
import { along, ringPolygon, type RingPolygon } from './trajectory'

/** The letter before Whorl cut along Whorl's mesh, ready to move with it. */
export interface Prepared {
  mesh: WhorlMesh
  ring: RingPolygon
  outline: Point[][]
  /** Each contour's points (before the turn, the creases added): their range in the arrays below, and their winding. */
  contours: { start: number; n: number; clockwise: boolean }[]
  preX: Float64Array
  preY: Float64Array
  /** Each point's triangle (three corners and weights), or for a point beyond the outermost ring, ids[3i] = -1. */
  ids: Int32Array
  weights: Float64Array
  /** The points beyond the outermost ring, and each one's place among them (or -1). */
  outer: Int32Array
  outerOf: Int32Array
  cornerAngle: Float64Array
}

/** Where the corners (and the points beyond the outermost ring) are shown, and how far each ring has turned. */
export interface MeshPose {
  prepared: Prepared
  turns: Float64Array
  cornerX: Float64Array
  cornerY: Float64Array
  outerX: Float64Array
  outerY: Float64Array
}

export interface MeshGlide {
  /** The glide as data (planData.ts); `at` and `pose` run on it. */
  data: MeshData
  /** Anchors in all. */
  points: number
  contours: MeshData['contours']
  /** Writes every point at progress `p` (eased, 0–1), contour after contour. */
  at(p: number, xs: Float64Array, ys: Float64Array): void
  /** Where the corners are at `p`, for a glide that goes on from there. */
  pose(p: number): MeshPose
}

function sameOutline(a: readonly (readonly Point[])[], b: readonly (readonly Point[])[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let c = 0; c < a.length; c++) {
    const p = a[c]
    const q = b[c]
    if (p.length !== q.length) return false
    for (let i = 0; i < p.length; i++) if (p[i].x !== q[i].x || p[i].y !== q[i].y) return false
  }
  return true
}

/** Prepared letters, by outline and mesh (repeated letters and glides that go on share them). */
const prepared = new WeakMap<Point[][], Map<string, Prepared>>()

function prepare(outline: Point[][], mesh: WhorlMesh): Prepared {
  let byMesh = prepared.get(outline)
  if (!byMesh) prepared.set(outline, (byMesh = new Map()))
  const known = byMesh.get(mesh.key)
  if (known) return known
  const xs: number[] = []
  const ys: number[] = []
  const contours: Prepared['contours'] = []
  for (const pts of outline) {
    const start = xs.length
    let twice = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      twice += a.x * b.y - b.x * a.y
      xs.push(a.x)
      ys.push(a.y)
      for (const t of mesh.creases(a, b)) {
        xs.push(a.x + (b.x - a.x) * t)
        ys.push(a.y + (b.y - a.y) * t)
      }
    }
    contours.push({ start, n: xs.length - start, clockwise: twice < 0 })
  }
  const n = xs.length
  const ids = new Int32Array(3 * n)
  const weights = new Float64Array(3 * n)
  const outerOf = new Int32Array(n).fill(-1)
  const outer: number[] = []
  for (let i = 0; i < n; i++) {
    const at = mesh.locate({ x: xs[i], y: ys[i] })
    if (!at) {
      ids[3 * i] = -1
      outerOf[i] = outer.length
      outer.push(i)
      continue
    }
    for (let k = 0; k < 3; k++) {
      ids[3 * i + k] = at.ids[k]
      weights[3 * i + k] = at.weights[k]
    }
  }
  const corners = mesh.cornerX.length
  const cornerAngle = new Float64Array(corners)
  for (let c = 0; c < corners; c++)
    cornerAngle[c] = Math.atan2(mesh.cornerY[c] - mesh.centre.y, mesh.cornerX[c] - mesh.centre.x)
  const result: Prepared = {
    mesh,
    ring: ringPolygon(mesh.sides),
    outline,
    contours,
    preX: Float64Array.from(xs),
    preY: Float64Array.from(ys),
    ids,
    weights,
    outer: Int32Array.from(outer),
    outerOf,
    cornerAngle,
  }
  byMesh.set(mesh.key, result)
  return result
}

/** The pose of a computed glyph: every ring turned by `turns` (all 0 for the letter without Whorl). */
function poseOf(p: Prepared, turns: Float64Array): MeshPose {
  const { mesh } = p
  const corners = mesh.cornerX.length
  const cornerX = new Float64Array(corners)
  const cornerY = new Float64Array(corners)
  const turn = (k: number) => turns[Math.min(k, turns.length - 1)]
  const rotate = (x: number, y: number, angle: number, out: Float64Array[], i: number) => {
    const dx = x - mesh.centre.x
    const dy = y - mesh.centre.y
    out[0][i] = mesh.centre.x + Math.cos(angle) * dx - Math.sin(angle) * dy
    out[1][i] = mesh.centre.y + Math.sin(angle) * dx + Math.cos(angle) * dy
  }
  for (let c = 0; c < corners; c++)
    rotate(mesh.cornerX[c], mesh.cornerY[c], turn(mesh.cornerRing[c]), [cornerX, cornerY], c)
  const outerX = new Float64Array(p.outer.length)
  const outerY = new Float64Array(p.outer.length)
  for (let o = 0; o < p.outer.length; o++)
    rotate(p.preX[p.outer[o]], p.preY[p.outer[o]], turn(mesh.rings), [outerX, outerY], o)
  return { prepared: p, turns, cornerX, cornerY, outerX, outerY }
}

/** The turns of `w` ring by ring, for a mesh of `rings` rings (all 0 without Whorl). */
function turnsOf(w: WhorlMotion | undefined, rings: number): Float64Array {
  const turns = new Float64Array(rings + 1)
  if (w) for (let k = 0; k <= rings; k++) turns[k] = w.turns[Math.min(k, w.turns.length - 1)] ?? 0
  return turns
}

/**
 * The glide `from` → `to` by Whorl's mesh (see the top of the file), or null when it does not apply. `pose`: where the
 * corners are shown when `from` is an in-between shape of such a glide; `inBetween`: `from` is an in-between shape
 * (of any glide), which only a pose can continue.
 */
export function planWhorlMesh(
  from: PolygonGlyph,
  to: PolygonGlyph,
  pose: MeshPose | undefined,
  inBetween: boolean,
): MeshGlide | null {
  const a = from.motion?.whorl
  const b = to.motion?.whorl
  const on = b ?? a
  if (!on?.outline) return null
  // Whorl alone, on whichever side it is on; the side without it shows the very letter Whorl turns.
  for (const w of [a, b]) if (w && (!w.last || !w.outline || !sameOutline(w.outline, on.outline))) return null
  if (
    !a &&
    !sameOutline(
      from.contours.map((c) => c.points),
      on.outline,
    )
  )
    return null
  if (
    !b &&
    !sameOutline(
      to.contours.map((c) => c.points),
      on.outline,
    )
  )
    return null
  if (a && b && a.amount === b.amount && a.pinned === b.pinned && !pose) return null
  const meshA = a ? whorlMesh(a) : null
  const meshB = b ? whorlMesh(b) : null
  if (meshA && meshB && meshA.key !== meshB.key) return null
  const mesh = (meshB ?? meshA)!
  let start: MeshPose
  if (pose) {
    if (pose.prepared.mesh.key !== mesh.key || !sameOutline(pose.prepared.outline, on.outline)) return null
    start = pose
  } else {
    if (inBetween) return null
    start = poseOf(prepare(on.outline, mesh), turnsOf(a, mesh.rings))
  }
  const p = start.prepared
  return meshGlideFrom(meshData(p, start, poseOf(p, turnsOf(b, mesh.rings))), () => p)
}

/** The mesh glide from pose `start` to pose `end` of the letter `p`, as data (planData.ts MeshData). */
function meshData(p: Prepared, start: MeshPose, end: MeshPose): MeshData {
  const { centre, spacing } = p.mesh
  const corners = p.mesh.cornerX.length
  const outers = p.outer.length
  // Each path: angles from and to, the ends (from the centre), the ring size; corners first, then the outer points.
  const paths = corners + outers
  const a0 = new Float64Array(paths)
  const a1 = new Float64Array(paths)
  const size = new Float64Array(paths)
  const x0 = new Float64Array(paths)
  const y0 = new Float64Array(paths)
  const x1 = new Float64Array(paths)
  const y1 = new Float64Array(paths)
  const last = start.turns.length - 1
  for (let c = 0; c < corners; c++) {
    const k = p.mesh.cornerRing[c]
    a0[c] = p.cornerAngle[c] + start.turns[k]
    a1[c] = p.cornerAngle[c] + end.turns[k]
    size[c] = k * spacing
    x0[c] = start.cornerX[c] - centre.x
    y0[c] = start.cornerY[c] - centre.y
    x1[c] = end.cornerX[c] - centre.x
    y1[c] = end.cornerY[c] - centre.y
  }
  for (let o = 0; o < outers; o++) {
    const i = p.outer[o]
    const dx = p.preX[i] - centre.x
    const dy = p.preY[i] - centre.y
    const angle = Math.atan2(dy, dx)
    const q = corners + o
    a0[q] = angle + start.turns[last]
    a1[q] = angle + end.turns[last]
    size[q] = p.ring.size(dx, dy)
    x0[q] = start.outerX[o] - centre.x
    y0[q] = start.outerY[o] - centre.y
    x1[q] = end.outerX[o] - centre.x
    y1[q] = end.outerY[o] - centre.y
  }
  return {
    meshKey: p.mesh.key,
    sides: p.mesh.sides,
    centreX: centre.x,
    centreY: centre.y,
    corners,
    a0,
    a1,
    size,
    x0,
    y0,
    x1,
    y1,
    ids: p.ids,
    weights: p.weights,
    outerOf: p.outerOf,
    contours: p.contours,
    startTurns: start.turns,
    endTurns: end.turns,
  }
}

/**
 * The mesh glide a plan's data describes. `prepared` gives the letter cut along the mesh, asked for only when a glide
 * goes on from an in-between shape (pose).
 */
export function meshGlideFrom(data: MeshData, prepared: () => Prepared): MeshGlide {
  const { a0, a1, size, x0, y0, x1, y1, ids, weights, outerOf, corners, startTurns, endTurns } = data
  const ring = ringPolygon(data.sides)
  const centre = { x: data.centreX, y: data.centreY }
  const paths = a0.length
  const n = outerOf.length
  const px = new Float64Array(paths)
  const py = new Float64Array(paths)
  const out = { x: 0, y: 0 }
  let atP = NaN
  const move = (t: number) => {
    if (t === atP) return
    atP = t
    for (let q = 0; q < paths; q++) {
      along(ring, size[q], a0[q], x0[q], y0[q], a1[q], x1[q], y1[q], a0[q] + (a1[q] - a0[q]) * t, out)
      px[q] = centre.x + out.x
      py[q] = centre.y + out.y
    }
  }
  return {
    data,
    points: n,
    contours: data.contours,
    at(t, xs, ys) {
      move(t)
      for (let i = 0; i < n; i++) {
        const o = outerOf[i]
        if (o >= 0) {
          xs[i] = px[corners + o]
          ys[i] = py[corners + o]
          continue
        }
        let x = 0
        let y = 0
        for (let k = 0; k < 3; k++) {
          const c = ids[3 * i + k]
          const w = weights[3 * i + k]
          x += w * px[c]
          y += w * py[c]
        }
        xs[i] = x
        ys[i] = y
      }
    },
    pose(t) {
      move(t)
      const turns = startTurns.map((v, k) => v + (endTurns[k] - v) * t)
      return {
        prepared: prepared(),
        turns,
        cornerX: px.slice(0, corners),
        cornerY: py.slice(0, corners),
        outerX: px.slice(corners),
        outerY: py.slice(corners),
      }
    },
  }
}

/** The Whorl a mesh glide between these outlines turns by: the new outline's, or the old one's when it has none. */
function meshWhorl(from: PolygonGlyph | null, to: PolygonGlyph): WhorlMotion | undefined {
  return to.motion?.whorl ?? from?.motion?.whorl
}

/**
 * The letter cut along the mesh of a plan's data, rebuilt from the outlines it runs between (the page and the workers
 * each prepare their own); null when they do not carry that mesh.
 */
export function preparedFor(meshKey: string, from: PolygonGlyph | null, to: PolygonGlyph): Prepared | null {
  const on = meshWhorl(from, to)
  if (!on?.outline) return null
  const mesh = whorlMesh(on)
  return mesh.key === meshKey ? prepare(on.outline, mesh) : null
}

/** A mesh pose sent by value (planCodec.ts), back onto this side's prepared letter; null when the mesh differs. */
export function poseFrom(
  encoded: {
    meshKey: string
    turns: Float64Array
    cornerX: Float64Array
    cornerY: Float64Array
    outerX: Float64Array
    outerY: Float64Array
  },
  glyph: PolygonGlyph,
): MeshPose | null {
  const p = preparedFor(encoded.meshKey, null, glyph)
  if (!p) return null
  const { turns, cornerX, cornerY, outerX, outerY } = encoded
  return { prepared: p, turns, cornerX, cornerY, outerX, outerY }
}
