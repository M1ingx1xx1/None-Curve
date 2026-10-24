// Hand-built Glide plans as data (PlanData) for the GPU tests, each with the CPU evaluation it must match: straight and
// still tracks against morphAt itself; Whorl tracks built exactly as trajectory.ts builds its sweep, against that
// trajectory's own path; Whorl's mesh against whorlGlide.ts's formulas over trajectory.ts `along`.

import type { PolygonGlyph, WhorlMotion } from '../../src/geometry/types'
import { morphAt, type MorphPlan } from '../../src/specimen/morph'
import { PLAN_DATA_VERSION, type MeshData, type PlanData, type StraightTrack, type WhorlTrack } from '../../src/specimen/planData'
import { along, ringPolygon, STRAIGHT, turnAtSize, whorlTrajectory, whorlUnturn } from '../../src/specimen/trajectory'
import { square } from './fixtures'

/** A plan and its CPU positions at p (x, y pairs in anchor order). */
export interface PlanFixture {
  name: string
  plan: Pick<MorphPlan, 'from' | 'to'>
  data: PlanData
  cpu(p: number): Float64Array
}

function glyph(points: [number, number][][]): PolygonGlyph {
  const base = square(0, 0, 1, 1)
  return { ...base, contours: points.map((pts) => ({ points: pts.map(([x, y]) => ({ x, y })), clockwise: false })) }
}

const flat = (g: PolygonGlyph) => Float64Array.from(g.contours.flatMap((c) => c.points.flatMap((p) => [p.x, p.y])))

/** A straight track (a square sliding and growing) and a still contour, as morphAt draws them. */
export function straightFixture(): PlanFixture {
  const from = glyph([
    [
      [0, 0],
      [200, 0],
      [200, 300],
      [0, 300],
    ],
    [
      [50, 50],
      [80, 50],
      [80, 80],
    ],
  ])
  const to = glyph([
    [
      [100, -40],
      [420, 10],
      [380, 520],
      [60, 470],
    ],
    [
      [50, 50],
      [80, 50],
      [80, 80],
    ],
  ])
  const sx = Float64Array.from(from.contours[0].points.map((p) => p.x))
  const sy = Float64Array.from(from.contours[0].points.map((p) => p.y))
  const tx = Float64Array.from(to.contours[0].points.map((p) => p.x))
  const ty = Float64Array.from(to.contours[0].points.map((p) => p.y))
  const kept = new Uint8Array(4).fill(1)
  const base = new Uint8Array(4)
  const track: StraightTrack = { kind: 'straight', clockwise: false, sx, sy, tx, ty, kept, base }
  const data: PlanData = {
    version: PLAN_DATA_VERSION,
    trajectory: 'straight',
    points: 7,
    longest: 4,
    whorl: null,
    mesh: null,
    tracks: [track, { kind: 'still', clockwise: false, contour: 1, kept: new Uint8Array(3).fill(1) }],
    settled: null,
  }
  const plan: MorphPlan = {
    from,
    to,
    trajectory: 'straight',
    tracks: [
      { clockwise: false, sx, sy, tx, ty, kept, base, path: STRAIGHT.path(sx, sy, tx, ty), still: null },
      { clockwise: false, sx: new Float64Array(0), sy: new Float64Array(0), tx: new Float64Array(0), ty: new Float64Array(0), kept: new Uint8Array(3).fill(1), base: new Uint8Array(0), path: null, still: to.contours[1] },
    ],
    points: 7,
    xs: new Float64Array(4),
    ys: new Float64Array(4),
  }
  return { name: 'straight and still', plan, data, cpu: (p) => flat(morphAt(plan, p)) }
}

export const whorlMotion = (patch: Partial<WhorlMotion> = {}): WhorlMotion => ({
  x: 0,
  y: 0,
  sides: 6,
  rings: 2,
  amount: 1,
  pinned: false,
  radius: 300,
  turns: [0, 0.6, 1.2],
  ...patch,
})

/** A Whorl track's arrays, worked out as whorlTrajectory's `path` works them out. */
export function whorlTrackData(from: WhorlMotion | undefined, to: WhorlMotion | undefined, sx: Float64Array, sy: Float64Array, tx: Float64Array, ty: Float64Array, base: Uint8Array): { track: WhorlTrack; startX: number; startY: number; endX: number; endY: number; sidesA: number; sidesB: number } {
  const start = (from ?? to)!
  const end = (to ?? from)!
  const ringA = ringPolygon(start.sides)
  const ringB = ringPolygon(end.sides)
  const twoRings = ringA.n !== ringB.n
  const n = sx.length
  const f = () => new Float64Array(n)
  const track: WhorlTrack = {
    kind: 'whorl',
    clockwise: false,
    kept: new Uint8Array(n).fill(1),
    base,
    sx,
    sy,
    tx,
    ty,
    a0: f(),
    turn: f(),
    sizeA: f(),
    sizeB: f(),
    ox: f(),
    oy: f(),
    ex: f(),
    ey: f(),
    rx: f(),
    ry: f(),
    mx: twoRings ? f() : null,
    my: twoRings ? f() : null,
  }
  for (let i = 0; i < n; i++) {
    const dx0 = sx[i] - start.x
    const dy0 = sy[i] - start.y
    let size: number
    if (base[i]) {
      const q = to ? whorlUnturn(to, tx[i] - end.x, ty[i] - end.y, ringB) : { x: tx[i] - end.x, y: ty[i] - end.y }
      size = ringB.size(q.x, q.y)
    } else {
      const q = from ? whorlUnturn(from, dx0, dy0, ringA) : { x: dx0, y: dy0 }
      size = ringA.size(q.x, q.y)
    }
    const angle0 = Math.atan2(dy0, dx0)
    const d = turnAtSize(to, size) - turnAtSize(from, size)
    track.a0[i] = angle0
    track.turn[i] = d
    track.ox[i] = dx0
    track.oy[i] = dy0
    track.sizeA[i] = ringA.size(dx0, dy0)
    track.sizeB[i] = twoRings ? ringB.size(dx0, dy0) : track.sizeA[i]
    const e = ringB.at(angle0 + d, track.sizeB[i])
    track.ex[i] = e.x
    track.ey[i] = e.y
    track.rx[i] = tx[i] - end.x - e.x
    track.ry[i] = ty[i] - end.y - e.y
    if (track.mx && track.my) {
      const m = angle0 + d / 2
      const pa = ringA.at(m, track.sizeA[i])
      const pb = ringB.at(m, track.sizeB[i])
      track.mx[i] = (pa.x + pb.x) / 2
      track.my[i] = (pa.y + pb.y) / 2
    }
  }
  return { track, startX: start.x, startY: start.y, endX: end.x, endY: end.y, sidesA: start.sides, sidesB: end.sides }
}

/** A Whorl sweep (Sides kept, or changed), checked against whorlTrajectory's own path. */
export function whorlFixture(two: boolean): PlanFixture {
  const from = whorlMotion({ x: 10, y: 20, turns: [0, 0.2, 0.4] })
  const to = whorlMotion({ x: 40, y: -10, amount: 2, sides: two ? 4 : 6, turns: [0, 1.1, 2.3] })
  const pts: [number, number][] = [
    [10, -180],
    [150, -60],
    [170, 120],
    [30, 230],
    [-140, 140],
    [-160, -90],
  ]
  const sx = Float64Array.from(pts.map(([x]) => x + 10))
  const sy = Float64Array.from(pts.map(([, y]) => y + 20))
  const tx = Float64Array.from(pts.map(([, y]) => -y * 0.8 + 40))
  const ty = Float64Array.from(pts.map(([x]) => x * 0.9 - 10))
  const base = Uint8Array.from([0, 0, 1, 0, 1, 0])
  const built = whorlTrackData(from, to, sx, sy, tx, ty, base)
  const data: PlanData = {
    version: PLAN_DATA_VERSION,
    trajectory: 'whorl',
    points: sx.length,
    longest: sx.length,
    whorl: { startX: built.startX, startY: built.startY, endX: built.endX, endY: built.endY, sidesA: built.sidesA, sidesB: built.sidesB },
    mesh: null,
    tracks: [built.track],
    settled: null,
  }
  const path = whorlTrajectory(from, to)!.path(sx, sy, tx, ty, base)
  const g = glyph([pts])
  const toGlyph = glyph([pts.map(([x, y]) => [-y * 0.8 + 40, x * 0.9 - 10] as [number, number])])
  return {
    name: two ? 'whorl, two rings' : 'whorl, one ring',
    plan: { from: g, to: toGlyph },
    data,
    cpu(p) {
      const xs = new Float64Array(sx.length)
      const ys = new Float64Array(sx.length)
      path(p, xs, ys)
      const out = new Float64Array(2 * sx.length)
      for (let i = 0; i < sx.length; i++) {
        out[2 * i] = xs[i]
        out[2 * i + 1] = ys[i]
      }
      return out
    },
  }
}

/**
 * Whorl's mesh: a hexagonal ring of corners turning about the centre, three anchors mixed from them and one beyond the
 * outermost ring, evaluated as whorlGlide.ts's `at`.
 */
export function meshFixture(): PlanFixture {
  const sides = 6
  const ring = ringPolygon(sides)
  const centreX = 250
  const centreY = 300
  const spacing = 120
  // Corner 0 is the centre; corners 1..6 the first ring; then one outer point.
  const corners = 1 + sides
  const paths = corners + 1
  const a0 = new Float64Array(paths)
  const a1 = new Float64Array(paths)
  const size = new Float64Array(paths)
  const x0 = new Float64Array(paths)
  const y0 = new Float64Array(paths)
  const x1 = new Float64Array(paths)
  const y1 = new Float64Array(paths)
  for (let c = 1; c < corners; c++) {
    const angle = ring.first + (c - 1) * ring.step
    const start = angle + 0.1
    const end = angle + 1.4
    const r = spacing / ring.cosHalf
    a0[c] = start
    a1[c] = end
    size[c] = spacing
    x0[c] = r * Math.cos(start)
    y0[c] = r * Math.sin(start)
    x1[c] = r * Math.cos(end)
    y1[c] = r * Math.sin(end)
  }
  // The outer point: its own ring polygon, turned by the last ring's turn.
  const outerAngle = 0.3
  const outerSize = 200
  const outerR = outerSize / ring.facing(outerAngle)
  a0[corners] = outerAngle
  a1[corners] = outerAngle + 1.3
  size[corners] = outerSize
  x0[corners] = outerR * Math.cos(outerAngle)
  y0[corners] = outerR * Math.sin(outerAngle)
  const endR = outerSize / ring.facing(outerAngle + 1.3)
  x1[corners] = endR * Math.cos(outerAngle + 1.3)
  y1[corners] = endR * Math.sin(outerAngle + 1.3)
  const ids = Int32Array.from([0, 1, 2, 0, 2, 3, 0, 3, 4, -1, 0, 0])
  const weights = Float64Array.from([0.2, 0.5, 0.3, 0.6, 0.2, 0.2, 0.1, 0.1, 0.8, 0, 0, 0])
  const outerOf = Int32Array.from([-1, -1, -1, 0])
  const mesh: MeshData = {
    meshKey: 'test',
    sides,
    centreX,
    centreY,
    corners,
    a0,
    a1,
    size,
    x0,
    y0,
    x1,
    y1,
    ids,
    weights,
    outerOf,
    contours: [{ start: 0, n: 4, clockwise: false }],
    startTurns: Float64Array.from([0, 0.1]),
    endTurns: Float64Array.from([0, 1.4]),
  }
  const data: PlanData = { version: PLAN_DATA_VERSION, trajectory: 'whorl-mesh', points: 4, longest: 0, whorl: null, mesh, tracks: [], settled: null }
  const g = glyph([
    [
      [centreX, centreY],
      [centreX + 100, centreY],
      [centreX, centreY + 100],
      [centreX - 100, centreY],
    ],
  ])
  return {
    name: 'whorl mesh',
    plan: { from: g, to: g },
    data,
    cpu(p) {
      const out = { x: 0, y: 0 }
      const px = new Float64Array(paths)
      const py = new Float64Array(paths)
      for (let q = 0; q < paths; q++) {
        along(ring, size[q], a0[q], x0[q], y0[q], a1[q], x1[q], y1[q], a0[q] + (a1[q] - a0[q]) * p, out)
        px[q] = centreX + out.x
        py[q] = centreY + out.y
      }
      const result = new Float64Array(8)
      for (let i = 0; i < 4; i++) {
        const o = outerOf[i]
        if (o >= 0) {
          result[2 * i] = px[corners + o]
          result[2 * i + 1] = py[corners + o]
          continue
        }
        for (let k = 0; k < 3; k++) {
          result[2 * i] += weights[3 * i + k] * px[ids[3 * i + k]]
          result[2 * i + 1] += weights[3 * i + k] * py[ids[3 * i + k]]
        }
      }
      return result
    },
  }
}

export const allFixtures = (): PlanFixture[] => [straightFixture(), whorlFixture(false), whorlFixture(true), meshFixture()]
