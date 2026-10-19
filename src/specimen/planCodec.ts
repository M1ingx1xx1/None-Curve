// Glide plans and in-between glyphs across postMessage: the geometry workers plan glides (aheadCore.ts, 'plan'
// requests) and the page runs them on its own glyphs. A plan travels as its data (planData.ts) and is rebuilt on the
// other side by planFromData, so it draws exactly what it drew where it was made. An in-between glyph travels with its
// side tables (morph.ts: which anchors the new outline brought, and where Whorl's mesh stands), so a glide planned from
// it in a worker goes on as it would on the page.

import type { EncodedGlyph, EncodedPose } from '../geometry/protocol'
import type { PolygonGlyph } from '../geometry/types'
import { planFromData, registerSideTables, sideTablesOf, type MorphPlan } from './morph'
import type { PlanData } from './planData'
import { poseFrom } from './whorlGlide'

/**
 * A plan's data and its buffers. The workers post the data without transferring them (structured clone): they keep
 * their own plan for the chain, and a mesh plan shares its arrays with the worker's prepared letter.
 */
export function encodePlan(plan: MorphPlan): { data: PlanData; transfer: ArrayBuffer[] } {
  const data = plan.data!
  const buffers = new Set<ArrayBuffer>()
  const add = (array: ArrayBufferView | null) => {
    if (array) buffers.add(array.buffer as ArrayBuffer)
  }
  for (const track of data.tracks) {
    add(track.kept)
    if (track.kind === 'still') continue
    for (const array of [track.sx, track.sy, track.tx, track.ty, track.base]) add(array)
    if (track.kind === 'whorl') {
      for (const array of [track.a0, track.turn, track.sizeA, track.sizeB, track.ox, track.oy, track.ex, track.ey, track.rx, track.ry, track.mx, track.my]) add(array)
    }
  }
  const mesh = data.mesh
  if (mesh) {
    for (const array of [mesh.a0, mesh.a1, mesh.size, mesh.x0, mesh.y0, mesh.x1, mesh.y1, mesh.ids, mesh.weights, mesh.outerOf, mesh.startTurns, mesh.endTurns]) add(array)
  }
  if (data.settled) for (const array of [data.settled.points, data.settled.counts, data.settled.clockwise]) add(array)
  return { data, transfer: [...buffers] }
}

/** A plan received as data, run between the page's own `from` and `to` (planFromData). */
export function decodePlan(data: PlanData, from: PolygonGlyph, to: PolygonGlyph): MorphPlan {
  return planFromData(data, from, to)
}

/** The settled shape a plan starts from, as data (PlanData.settled). */
export function encodeSettled(glyph: PolygonGlyph): NonNullable<PlanData['settled']> {
  const total = glyph.contours.reduce((n, c) => n + c.points.length, 0)
  const points = new Float64Array(2 * total)
  const counts = new Int32Array(glyph.contours.length)
  const clockwise = new Uint8Array(glyph.contours.length)
  let at = 0
  glyph.contours.forEach((c, k) => {
    counts[k] = c.points.length
    clockwise[k] = c.clockwise ? 1 : 0
    for (const p of c.points) {
      points[at++] = p.x
      points[at++] = p.y
    }
  })
  return { points, counts, clockwise }
}

/** An in-between glyph by value, with its side tables. */
export function encodeGlyph(glyph: PolygonGlyph): EncodedGlyph {
  const { kept, pose } = sideTablesOf(glyph)
  const encoded: EncodedPose | null = pose
    ? { meshKey: pose.prepared.mesh.key, turns: pose.turns, cornerX: pose.cornerX, cornerY: pose.cornerY, outerX: pose.outerX, outerY: pose.outerY }
    : null
  return { glyph, kept, pose: encoded }
}

/** The glyph received by value, its side tables registered on this side (a pose for another mesh is left out). */
export function decodeGlyph(encoded: EncodedGlyph): PolygonGlyph {
  const { glyph, kept } = encoded
  registerSideTables(glyph, kept, encoded.pose ? poseFrom(encoded.pose, glyph) : null)
  return glyph
}
