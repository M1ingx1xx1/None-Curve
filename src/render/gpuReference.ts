// The WebGL renderer's morph evaluation, written again in JavaScript line for line with its shaders
// (webglShaders.ts): what the GPU computes for a Glide plan's anchors at eased progress p, from the very rows it uploads
// (gpuPlans.ts). Tests hold it against morphAt's own formulas (morph.ts, trajectory.ts `along`, whorlGlide.ts), and the
// renderer uses it for nothing else. Whorl's paths stay faceted here as on the CPU: `along` runs straight from corner to
// corner of the ring polygon, each piece at an even pace, so a position is piecewise linear in p.

import { ringPolygon } from '../specimen/trajectory'
import type { PlanData } from '../specimen/planData'
import { ANCHOR_STRIDE, KIND, PATH_STRIDE } from './gpuPlans'

/** A ring polygon as the shaders take it: the first corner's angle, the angle between corners, cos(π/Sides). */
export interface RingUniform {
  first: number
  step: number
  cosHalf: number
}

function ringUniform(sides: number): RingUniform {
  const ring = ringPolygon(sides)
  return { first: ring.first, step: ring.step, cosHalf: ring.cosHalf }
}

/** The uniforms of one plan (webgl2.ts sets the same). */
export interface PlanUniforms {
  startX: number
  startY: number
  endX: number
  endY: number
  ringA: RingUniform
  ringB: RingUniform
  meshX: number
  meshY: number
  meshRing: RingUniform
}

export function planUniforms(data: PlanData): PlanUniforms {
  const w = data.whorl
  const m = data.mesh
  return {
    startX: w?.startX ?? 0,
    startY: w?.startY ?? 0,
    endX: w?.endX ?? 0,
    endY: w?.endY ?? 0,
    ringA: ringUniform(w?.sidesA ?? 3),
    ringB: ringUniform(w?.sidesB ?? 3),
    meshX: m?.centreX ?? 0,
    meshY: m?.centreY ?? 0,
    meshRing: ringUniform(m?.sides ?? 3),
  }
}

/** The shaders' along(): trajectory.ts `along`, with the ring as uniforms. Writes into `out`. */
function alongRef(
  ring: RingUniform,
  size: number,
  a0: number,
  p0x: number,
  p0y: number,
  a1: number,
  p1x: number,
  p1y: number,
  angle: number,
  out: { x: number; y: number },
) {
  const lo = Math.min(a0, a1)
  const hi = Math.max(a0, a1)
  if (!(hi > lo)) {
    out.x = p0x
    out.y = p0y
    return
  }
  const t = Math.min(Math.max(angle, lo), hi)
  const k = Math.floor((t - ring.first) / ring.step)
  const c0 = ring.first + k * ring.step
  const c1 = c0 + ring.step
  // The piece's ends: an end of the way (when the sector reaches past it), or a corner of the polygon.
  const fromEnd = c0 <= lo
  const toEnd = c1 >= hi
  const from = fromEnd ? lo : c0
  const to = toEnd ? hi : c1
  const corner = size / ring.cosHalf
  const forward = a0 <= a1
  const fx = fromEnd ? (forward ? p0x : p1x) : corner * Math.cos(from)
  const fy = fromEnd ? (forward ? p0y : p1y) : corner * Math.sin(from)
  const tx = toEnd ? (forward ? p1x : p0x) : corner * Math.cos(to)
  const ty = toEnd ? (forward ? p1y : p0y) : corner * Math.sin(to)
  const w = to > from ? (t - from) / (to - from) : 0
  out.x = fx + (tx - fx) * w
  out.y = fy + (ty - fy) * w
}

/** The path pass (mesh plans): each path's point at p, from Whorl's centre round the mesh's ring polygon. */
export function evaluatePaths(paths: Float32Array, count: number, p: number, u: PlanUniforms): Float64Array {
  const out = new Float64Array(2 * count)
  const at = { x: 0, y: 0 }
  for (let q = 0; q < count; q++) {
    const o = q * PATH_STRIDE
    const a0 = paths[o]
    const a1 = paths[o + 1]
    alongRef(
      u.meshRing,
      paths[o + 2],
      a0,
      paths[o + 3],
      paths[o + 4],
      a1,
      paths[o + 5],
      paths[o + 6],
      a0 + (a1 - a0) * p,
      at,
    )
    out[2 * q] = u.meshX + at.x
    out[2 * q + 1] = u.meshY + at.y
  }
  return out
}

/** The anchor pass: every anchor's position at p (x, y pairs), as the evaluation shader writes them. */
export function evaluateAnchors(
  rows: Float32Array,
  count: number,
  p: number,
  u: PlanUniforms,
  pathPos: Float64Array | null,
): Float64Array {
  const out = new Float64Array(2 * count)
  const at = { x: 0, y: 0 }
  const cx = u.startX + (u.endX - u.startX) * p
  const cy = u.startY + (u.endY - u.startY) * p
  for (let i = 0; i < count; i++) {
    const o = i * ANCHOR_STRIDE
    const kind = rows[o]
    let x = 0
    let y = 0
    if (kind === KIND.still) {
      x = rows[o + 1]
      y = rows[o + 2]
    } else if (kind === KIND.straight) {
      x = rows[o + 1] + (rows[o + 3] - rows[o + 1]) * p
      y = rows[o + 2] + (rows[o + 4] - rows[o + 2]) * p
    } else if (kind === KIND.whorl || kind === KIND.whorlTwo) {
      const a0 = rows[o + 1]
      const turn = rows[o + 2]
      const angle = a0 + turn * p
      const a1 = a0 + turn
      if (kind === KIND.whorl)
        alongRef(u.ringA, rows[o + 3], a0, rows[o + 5], rows[o + 6], a1, rows[o + 7], rows[o + 8], angle, at)
      else if (p < 0.5)
        alongRef(
          u.ringA,
          rows[o + 3],
          a0,
          rows[o + 5],
          rows[o + 6],
          a0 + turn / 2,
          rows[o + 11],
          rows[o + 12],
          angle,
          at,
        )
      else
        alongRef(
          u.ringB,
          rows[o + 4],
          a0 + turn / 2,
          rows[o + 11],
          rows[o + 12],
          a1,
          rows[o + 7],
          rows[o + 8],
          angle,
          at,
        )
      x = cx + at.x + rows[o + 9] * p
      y = cy + at.y + rows[o + 10] * p
    } else if (kind === KIND.mesh && pathPos) {
      for (let k = 0; k < 3; k++) {
        const id = rows[o + 1 + k]
        const w = rows[o + 4 + k]
        x += w * pathPos[2 * id]
        y += w * pathPos[2 * id + 1]
      }
    } else if (kind === KIND.meshOuter && pathPos) {
      const id = rows[o + 1]
      x = pathPos[2 * id]
      y = pathPos[2 * id + 1]
    }
    out[2 * i] = x
    out[2 * i + 1] = y
  }
  return out
}
