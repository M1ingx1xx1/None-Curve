// What the WebGL renderer keeps on the GPU: Glide plans (PlanData, planData.ts) laid out as rows the evaluation shader
// reads, and static polygons as positions. For each, the triangle fans the stencil fill draws, the segments (with their
// neighbours) the stroke draws, and a conservative box the cover quad spans. The layout builders are pure (tested in
// tests/render/gpuPlans.test.ts); the upload functions take the WebGL2 context. Everything is kept in an LRU by GPU
// bytes, capped at GPU_LIMITS.maxBytes, and what has not been drawn for GPU_LIMITS.idleMs goes first.
//
// Anchor rows (Float32, ANCHOR_STRIDE floats, one per in-between anchor: the mesh's contours first, then the tracks):
//   [0] kind (KIND)
//   straight:   [1..4] sx, sy, tx, ty
//   still:      [1..2] x, y (the target's point)
//   whorl:      [1] a0 [2] turn [3] sizeA [4] sizeB [5] ox [6] oy [7] ex [8] ey [9] rx [10] ry [11] mx [12] my
//   mesh:       [1..3] path ids (exact as floats below 2^24) [4..6] weights;  mesh-outer: [1] path id
// Path rows (mesh plans; Float32, PATH_STRIDE floats): a0, a1, size, x0, y0, x1, y1, pad.

import type { PolygonContour, PolygonGlyph } from '../geometry/types'
import type { MorphPlan } from '../specimen/morph'
import type { PlanData } from '../specimen/planData'
import { ringPolygon } from '../specimen/trajectory'

export const ANCHOR_STRIDE = 16
export const PATH_STRIDE = 8

/** Row kinds of the anchor layout. */
export const KIND = { still: 0, straight: 1, whorl: 2, whorlTwo: 3, mesh: 4, meshOuter: 5 } as const

export const GPU_LIMITS = {
  /** GPU bytes kept for plans, shapes and their textures. */
  maxBytes: 48 * 1024 * 1024,
  /** Plans and shapes not drawn for this long are evicted first. */
  idleMs: 2000,
  /** Positions textures are this many texels wide (RG32F), with as many rows as needed. */
  texWidth: 2048,
} as const

/** One contour of the in-between glyph: its first anchor and its anchor count. */
export interface GpuContour {
  start: number
  n: number
}

/** The in-between glyph's contours in anchor order (as morphAt builds them: the mesh's, then one per track). */
export function planContours(data: PlanData, to: PolygonGlyph): GpuContour[] {
  const contours: GpuContour[] = []
  let start = 0
  for (const c of data.mesh?.contours ?? []) {
    contours.push({ start, n: c.n })
    start += c.n
  }
  for (const track of data.tracks) {
    const n = track.kind === 'still' ? (to.contours[track.contour]?.points.length ?? 0) : track.sx.length
    contours.push({ start, n })
    start += n
  }
  return contours
}

/** The polygon's contours in point order. */
export function shapeContours(contours: readonly PolygonContour[]): GpuContour[] {
  const out: GpuContour[] = []
  let start = 0
  for (const c of contours) {
    out.push({ start, n: c.points.length })
    start += c.points.length
  }
  return out
}

/** The anchor rows of a plan (see the top of the file). */
export function anchorRows(data: PlanData, to: PolygonGlyph): Float32Array<ArrayBuffer> {
  const contours = planContours(data, to)
  const count = contours.reduce((n, c) => n + c.n, 0)
  const rows = new Float32Array(count * ANCHOR_STRIDE)
  let i = 0
  const mesh = data.mesh
  if (mesh) {
    const meshPoints = mesh.contours.reduce((n, c) => n + c.n, 0)
    for (let k = 0; k < meshPoints; k++, i++) {
      const o = i * ANCHOR_STRIDE
      const outer = mesh.outerOf[k]
      if (outer >= 0) {
        rows[o] = KIND.meshOuter
        rows[o + 1] = mesh.corners + outer
        continue
      }
      rows[o] = KIND.mesh
      for (let j = 0; j < 3; j++) {
        rows[o + 1 + j] = mesh.ids[3 * k + j]
        rows[o + 4 + j] = mesh.weights[3 * k + j]
      }
    }
  }
  for (const track of data.tracks) {
    if (track.kind === 'still') {
      for (const p of to.contours[track.contour]?.points ?? []) {
        const o = i++ * ANCHOR_STRIDE
        rows[o] = KIND.still
        rows[o + 1] = p.x
        rows[o + 2] = p.y
      }
    } else if (track.kind === 'straight') {
      for (let k = 0; k < track.sx.length; k++) {
        const o = i++ * ANCHOR_STRIDE
        rows[o] = KIND.straight
        rows[o + 1] = track.sx[k]
        rows[o + 2] = track.sy[k]
        rows[o + 3] = track.tx[k]
        rows[o + 4] = track.ty[k]
      }
    } else {
      const two = track.mx !== null && track.my !== null
      for (let k = 0; k < track.sx.length; k++) {
        const o = i++ * ANCHOR_STRIDE
        rows[o] = two ? KIND.whorlTwo : KIND.whorl
        rows[o + 1] = track.a0[k]
        rows[o + 2] = track.turn[k]
        rows[o + 3] = track.sizeA[k]
        rows[o + 4] = track.sizeB[k]
        rows[o + 5] = track.ox[k]
        rows[o + 6] = track.oy[k]
        rows[o + 7] = track.ex[k]
        rows[o + 8] = track.ey[k]
        rows[o + 9] = track.rx[k]
        rows[o + 10] = track.ry[k]
        if (two) {
          rows[o + 11] = track.mx![k]
          rows[o + 12] = track.my![k]
        }
      }
    }
  }
  return rows
}

/** The path rows of a mesh plan, or null without a mesh. */
export function pathRows(data: PlanData): Float32Array<ArrayBuffer> | null {
  const mesh = data.mesh
  if (!mesh) return null
  const count = mesh.a0.length
  const rows = new Float32Array(count * PATH_STRIDE)
  for (let q = 0; q < count; q++) {
    const o = q * PATH_STRIDE
    rows[o] = mesh.a0[q]
    rows[o + 1] = mesh.a1[q]
    rows[o + 2] = mesh.size[q]
    rows[o + 3] = mesh.x0[q]
    rows[o + 4] = mesh.y0[q]
    rows[o + 5] = mesh.x1[q]
    rows[o + 6] = mesh.y1[q]
  }
  return rows
}

/** Triangle fans for the stencil fill: (s, s + i, s + i + 1), i = 1 … n − 2, for every contour of 3 anchors or more. */
export function fanIndices(contours: readonly GpuContour[], base = 0): Uint32Array<ArrayBuffer> {
  let count = 0
  for (const { n } of contours) if (n >= 3) count += 3 * (n - 2)
  const out = new Uint32Array(count)
  let k = 0
  for (const { start, n } of contours) {
    if (n < 3) continue
    const s = base + start
    for (let i = 1; i <= n - 2; i++) {
      out[k++] = s
      out[k++] = s + i
      out[k++] = s + i + 1
    }
  }
  return out
}

/** One instance per side: (prev, a, b, next), wrapping within its contour, for every contour of 2 anchors or more. */
export function segmentIndices(contours: readonly GpuContour[], base = 0): Uint32Array<ArrayBuffer> {
  let count = 0
  for (const { n } of contours) if (n >= 2) count += n
  const out = new Uint32Array(count * 4)
  let k = 0
  for (const { start, n } of contours) {
    if (n < 2) continue
    const s = base + start
    for (let i = 0; i < n; i++) {
      out[k++] = s + ((i - 1 + n) % n)
      out[k++] = s + i
      out[k++] = s + ((i + 1) % n)
      out[k++] = s + ((i + 2) % n)
    }
  }
  return out
}

/** A glyph-space box: minX, minY, maxX, maxY. */
export type Box = [number, number, number, number]

const emptyBox = (): Box => [Infinity, Infinity, -Infinity, -Infinity]

function addPoint(box: Box, x: number, y: number) {
  if (x < box[0]) box[0] = x
  if (y < box[1]) box[1] = y
  if (x > box[2]) box[2] = x
  if (y > box[3]) box[3] = y
}

function addContours(box: Box, contours: readonly PolygonContour[]) {
  for (const { points } of contours) for (const p of points) addPoint(box, p.x, p.y)
}

/** The box of a polygon's points (empty glyphs give a zero box at the origin). */
export function shapeBounds(polygon: PolygonGlyph): Box {
  const box = emptyBox()
  addContours(box, polygon.contours)
  return Number.isFinite(box[0]) ? box : [0, 0, 0, 0]
}

/**
 * A box every in-between anchor of the plan stays inside for every p: the from and to boxes (and the settled from), each
 * Whorl track's ring polygons about the centre at both ends (every corner the sweep reaches, plus the straight rest), and
 * the mesh's ring about its centre with its corners' ends; padded by 1 % of an em.
 */
export function planBounds(plan: Pick<MorphPlan, 'from' | 'to'>, data: PlanData): Box {
  const box = emptyBox()
  addContours(box, plan.from.contours)
  addContours(box, plan.to.contours)
  if (data.settled) {
    const pts = data.settled.points
    for (let i = 0; i + 1 < pts.length; i += 2) addPoint(box, pts[i], pts[i + 1])
  }
  const w = data.whorl
  if (w) {
    const cosHalf = Math.min(ringPolygon(w.sidesA).cosHalf, ringPolygon(w.sidesB).cosHalf)
    let reach = 0
    for (const track of data.tracks) {
      if (track.kind !== 'whorl') continue
      for (let k = 0; k < track.sx.length; k++) {
        const size = Math.max(Math.abs(track.sizeA[k]), Math.abs(track.sizeB[k]))
        reach = Math.max(reach, size / cosHalf + Math.hypot(track.rx[k], track.ry[k]))
      }
      for (let k = 0; k < track.sx.length; k++) {
        addPoint(box, track.sx[k], track.sy[k])
        addPoint(box, track.tx[k], track.ty[k])
      }
    }
    if (reach > 0) {
      for (const [cx, cy] of [
        [w.startX, w.startY],
        [w.endX, w.endY],
      ]) {
        addPoint(box, cx - reach, cy - reach)
        addPoint(box, cx + reach, cy + reach)
      }
    }
  }
  for (const track of data.tracks) {
    if (track.kind !== 'straight') continue
    for (let k = 0; k < track.sx.length; k++) {
      addPoint(box, track.sx[k], track.sy[k])
      addPoint(box, track.tx[k], track.ty[k])
    }
  }
  const mesh = data.mesh
  if (mesh) {
    const cosHalf = ringPolygon(mesh.sides).cosHalf
    let reach = 0
    for (let q = 0; q < mesh.size.length; q++) {
      reach = Math.max(reach, Math.abs(mesh.size[q]) / cosHalf)
      addPoint(box, mesh.centreX + mesh.x0[q], mesh.centreY + mesh.y0[q])
      addPoint(box, mesh.centreX + mesh.x1[q], mesh.centreY + mesh.y1[q])
    }
    addPoint(box, mesh.centreX - reach, mesh.centreY - reach)
    addPoint(box, mesh.centreX + reach, mesh.centreY + reach)
  }
  if (!Number.isFinite(box[0])) return [0, 0, 0, 0]
  const em = plan.to.metrics.unitsPerEm > 0 ? plan.to.metrics.unitsPerEm : 1000
  const pad = 0.01 * em
  return [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad]
}

/** Texture rows for `n` positions. */
export const texRows = (n: number) => Math.max(1, Math.ceil(n / GPU_LIMITS.texWidth))

/** Bytes of a padded positions buffer plus its texture (both RG32F-sized). */
export const slotBytes = (n: number) => 2 * texRows(n) * GPU_LIMITS.texWidth * 8

interface LruEntry<V> {
  value: V
  bytes: number
  lastUsed: number
}

/**
 * Least recently used, by bytes: `evict` drops what has not been used for `idleMs`, then the oldest until the total is
 * within `maxBytes`. Entries used in the current frame (lastUsed === now) are never dropped.
 */
export class GpuLru<K extends object, V> {
  private entries = new Map<K, LruEntry<V>>()
  bytes = 0

  constructor(private readonly dispose: (value: V) => void) {}

  get(key: K, now: number): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    entry.lastUsed = now
    return entry.value
  }

  set(key: K, value: V, bytes: number, now: number) {
    const old = this.entries.get(key)
    if (old) {
      this.bytes -= old.bytes
      this.dispose(old.value)
    }
    this.entries.set(key, { value, bytes, lastUsed: now })
    this.bytes += bytes
  }

  /** Adds `bytes` to an entry that grew (a plan's new slot). */
  grow(key: K, bytes: number) {
    const entry = this.entries.get(key)
    if (!entry || bytes === 0) return
    entry.bytes += bytes
    this.bytes += bytes
  }

  get size() {
    return this.entries.size
  }

  evict(now: number, maxBytes: number = GPU_LIMITS.maxBytes, idleMs: number = GPU_LIMITS.idleMs) {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastUsed > idleMs) this.drop(key, entry)
    }
    if (this.bytes <= maxBytes) return
    const byAge = [...this.entries].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [key, entry] of byAge) {
      if (this.bytes <= maxBytes || entry.lastUsed === now) break
      this.drop(key, entry)
    }
  }

  clear() {
    for (const entry of this.entries.values()) this.dispose(entry.value)
    this.entries.clear()
    this.bytes = 0
  }

  private drop(key: K, entry: LruEntry<V>) {
    this.entries.delete(key)
    this.bytes -= entry.bytes
    this.dispose(entry.value)
  }
}

// ---- Upload (WebGL2) ----

/** Attribute locations fixed in the shaders (webglShaders.ts, layout(location = …)). */
export const ATTRIB = { row0: 0, row1: 1, row2: 2, row3: 3, path0: 0, path1: 1, position: 0, segment: 0 } as const

/** Positions written by the evaluation pass (or uploaded), as a buffer and as an RG32F texture for the strokes. */
export interface GpuSlot {
  positions: WebGLBuffer
  texture: WebGLTexture
  /** The fill's vertex array: positions plus the fan's element buffer. */
  fill: WebGLVertexArrayObject
  /** The progress last evaluated into it (NaN: none), and whether the texture holds it yet. */
  p: number
  textured: boolean
}

/** The parts shared by shapes and plans: fans, segments, and the box. */
export interface GpuGeometry {
  points: number
  fan: WebGLBuffer
  fanCount: number
  segments: WebGLBuffer
  segmentCount: number
  /** The stroke's vertex array: one segment instance (prev, a, b, next) at a time. */
  stroke: WebGLVertexArrayObject
  bounds: Box
}

export interface GpuShape extends GpuGeometry {
  slot: GpuSlot
}

export interface GpuPlan extends GpuGeometry {
  data: PlanData
  anchors: WebGLBuffer
  anchorArray: WebGLVertexArrayObject
  /** Mesh plans: the path rows, their vertex array, and where the path pass writes (buffer and texture). */
  paths: { rows: WebGLBuffer; array: WebGLVertexArrayObject; count: number; positions: WebGLBuffer; texture: WebGLTexture } | null
  /** One per distinct progress drawn in a frame (copies of a glyph mid-glide from different starts). */
  slots: GpuSlot[]
  /** Slots handed out in the current frame: slots[0, used). */
  used: number
}

function buffer(gl: WebGL2RenderingContext, target: number, data: BufferSource | number, usage: number): WebGLBuffer {
  const b = gl.createBuffer()
  if (!b) throw new Error('WebGL buffer')
  gl.bindBuffer(target, b)
  if (typeof data === 'number') gl.bufferData(target, data, usage)
  else gl.bufferData(target, data, usage)
  return b
}

/** An RG32F texture GPU_LIMITS.texWidth wide with rows for `n` positions. */
export function positionsTexture(gl: WebGL2RenderingContext, n: number): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('WebGL texture')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, GPU_LIMITS.texWidth, texRows(n))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return tex
}

/** Copies a padded positions buffer into its texture (PIXEL_UNPACK_BUFFER: no trip through the CPU). */
export function copyToTexture(gl: WebGL2RenderingContext, positions: WebGLBuffer, texture: WebGLTexture, n: number) {
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, positions)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GPU_LIMITS.texWidth, texRows(n), gl.RG, gl.FLOAT, 0)
  gl.bindTexture(gl.TEXTURE_2D, null)
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
}

function createSlot(gl: WebGL2RenderingContext, n: number, fan: WebGLBuffer, data: Float32Array | null): GpuSlot {
  const padded = 2 * texRows(n) * GPU_LIMITS.texWidth
  let positions: WebGLBuffer
  if (data) {
    const full = new Float32Array(padded)
    full.set(data)
    positions = buffer(gl, gl.ARRAY_BUFFER, full, gl.STATIC_DRAW)
  } else positions = buffer(gl, gl.ARRAY_BUFFER, padded * 4, gl.DYNAMIC_COPY)
  const texture = positionsTexture(gl, n)
  const fill = gl.createVertexArray()
  if (!fill) throw new Error('WebGL vertex array')
  gl.bindVertexArray(fill)
  gl.bindBuffer(gl.ARRAY_BUFFER, positions)
  gl.enableVertexAttribArray(ATTRIB.position)
  gl.vertexAttribPointer(ATTRIB.position, 2, gl.FLOAT, false, 8, 0)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fan)
  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  const slot: GpuSlot = { positions, texture, fill, p: NaN, textured: false }
  if (data) {
    copyToTexture(gl, positions, texture, n)
    slot.textured = true
  }
  return slot
}

function deleteSlot(gl: WebGL2RenderingContext, slot: GpuSlot) {
  gl.deleteBuffer(slot.positions)
  gl.deleteTexture(slot.texture)
  gl.deleteVertexArray(slot.fill)
}

function createGeometry(gl: WebGL2RenderingContext, contours: GpuContour[], bounds: Box): GpuGeometry {
  const points = contours.reduce((n, c) => n + c.n, 0)
  const fanData = fanIndices(contours)
  const segData = segmentIndices(contours)
  const fan = buffer(gl, gl.ELEMENT_ARRAY_BUFFER, fanData.length ? fanData : new Uint32Array(3), gl.STATIC_DRAW)
  const segments = buffer(gl, gl.ARRAY_BUFFER, segData.length ? segData : new Uint32Array(4), gl.STATIC_DRAW)
  const stroke = gl.createVertexArray()
  if (!stroke) throw new Error('WebGL vertex array')
  gl.bindVertexArray(stroke)
  gl.bindBuffer(gl.ARRAY_BUFFER, segments)
  gl.enableVertexAttribArray(ATTRIB.segment)
  gl.vertexAttribIPointer(ATTRIB.segment, 4, gl.UNSIGNED_INT, 16, 0)
  gl.vertexAttribDivisor(ATTRIB.segment, 1)
  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
  return { points, fan, fanCount: fanData.length, segments, segmentCount: segData.length / 4, stroke, bounds }
}

function deleteGeometry(gl: WebGL2RenderingContext, g: GpuGeometry) {
  gl.deleteBuffer(g.fan)
  gl.deleteBuffer(g.segments)
  gl.deleteVertexArray(g.stroke)
}

/** A static polygon: its points uploaded as they are. Returns the shape and its GPU bytes. */
export function uploadShape(gl: WebGL2RenderingContext, polygon: PolygonGlyph): { shape: GpuShape; bytes: number } {
  const contours = shapeContours(polygon.contours)
  const geometry = createGeometry(gl, contours, shapeBounds(polygon))
  const data = new Float32Array(2 * geometry.points)
  let i = 0
  for (const { points } of polygon.contours) {
    for (const p of points) {
      data[i++] = p.x
      data[i++] = p.y
    }
  }
  const slot = createSlot(gl, geometry.points, geometry.fan, data)
  const bytes = slotBytes(geometry.points) + 4 * (3 * geometry.fanCount + 4 * geometry.segmentCount)
  return { shape: { ...geometry, slot }, bytes }
}

export function deleteShape(gl: WebGL2RenderingContext, shape: GpuShape) {
  deleteGeometry(gl, shape)
  deleteSlot(gl, shape.slot)
}

/** A plan: its anchor rows (and path rows), fans and segments; slots are made as frames need them. */
export function uploadPlan(gl: WebGL2RenderingContext, plan: MorphPlan, data: PlanData): { plan: GpuPlan; bytes: number } {
  const contours = planContours(data, plan.to)
  const geometry = createGeometry(gl, contours, planBounds(plan, data))
  const rows = anchorRows(data, plan.to)
  const anchors = buffer(gl, gl.ARRAY_BUFFER, rows.length ? rows : new Float32Array(ANCHOR_STRIDE), gl.STATIC_DRAW)
  const anchorArray = gl.createVertexArray()
  if (!anchorArray) throw new Error('WebGL vertex array')
  gl.bindVertexArray(anchorArray)
  for (let k = 0; k < 4; k++) {
    gl.enableVertexAttribArray(ATTRIB.row0 + k)
    gl.vertexAttribPointer(ATTRIB.row0 + k, 4, gl.FLOAT, false, ANCHOR_STRIDE * 4, 16 * k)
  }
  gl.bindVertexArray(null)
  let paths: GpuPlan['paths'] = null
  let bytes = rows.byteLength + 4 * (3 * geometry.fanCount + 4 * geometry.segmentCount)
  const prow = pathRows(data)
  if (prow && data.mesh) {
    const count = data.mesh.a0.length
    const rowsBuffer = buffer(gl, gl.ARRAY_BUFFER, prow.length ? prow : new Float32Array(PATH_STRIDE), gl.STATIC_DRAW)
    const array = gl.createVertexArray()
    if (!array) throw new Error('WebGL vertex array')
    gl.bindVertexArray(array)
    for (let k = 0; k < 2; k++) {
      gl.enableVertexAttribArray(ATTRIB.path0 + k)
      gl.vertexAttribPointer(ATTRIB.path0 + k, 4, gl.FLOAT, false, PATH_STRIDE * 4, 16 * k)
    }
    gl.bindVertexArray(null)
    const positions = buffer(gl, gl.ARRAY_BUFFER, 2 * texRows(count) * GPU_LIMITS.texWidth * 4, gl.DYNAMIC_COPY)
    paths = { rows: rowsBuffer, array, count, positions, texture: positionsTexture(gl, count) }
    bytes += prow.byteLength + slotBytes(count)
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  return { plan: { ...geometry, data, anchors, anchorArray, paths, slots: [], used: 0 }, bytes }
}

/**
 * The slot for progress `p` this frame: one handed out this frame at p, else one an earlier frame left at p (moved into
 * this frame's slots, its positions still valid: only an evaluation writes a slot, and it sets `p`), else the next free
 * one, made when there is none (`fresh`: p must be evaluated into it). Pure, so `make` stands in for the GPU.
 */
export function claimSlot<S extends { p: number }>(plan: { slots: S[]; used: number }, p: number, make: () => S): { slot: S; fresh: boolean } {
  const { slots } = plan
  for (let i = 0; i < plan.used; i++) if (slots[i].p === p) return { slot: slots[i], fresh: false }
  for (let i = plan.used; i < slots.length; i++) {
    if (slots[i].p !== p) continue
    const slot = slots[i]
    slots[i] = slots[plan.used]
    slots[plan.used++] = slot
    return { slot, fresh: false }
  }
  let slot = slots[plan.used]
  if (!slot) {
    slot = make()
    slots.push(slot)
  }
  plan.used++
  return { slot, fresh: true }
}

/** claimSlot on the GPU: a new slot's bytes are added to `grew`. */
export function planSlot(gl: WebGL2RenderingContext, plan: GpuPlan, p: number, grew: { bytes: number }): { slot: GpuSlot; fresh: boolean } {
  return claimSlot(plan, p, () => {
    grew.bytes += slotBytes(plan.points)
    return createSlot(gl, plan.points, plan.fan, null)
  })
}

export function deletePlan(gl: WebGL2RenderingContext, plan: GpuPlan) {
  deleteGeometry(gl, plan)
  gl.deleteBuffer(plan.anchors)
  gl.deleteVertexArray(plan.anchorArray)
  if (plan.paths) {
    gl.deleteBuffer(plan.paths.rows)
    gl.deleteVertexArray(plan.paths.array)
    gl.deleteBuffer(plan.paths.positions)
    gl.deleteTexture(plan.paths.texture)
  }
  for (const slot of plan.slots) deleteSlot(gl, slot)
}
