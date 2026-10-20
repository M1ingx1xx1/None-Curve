// A glyph's derived geometry packed into typed arrays (NOCUR-85): the precompute window keeps thousands of glyphs, and
// as objects each polygon point costs 100-200 bytes of heap; packed, its coordinates take 16. The worker packs what it
// computes for the window before posting it (the arrays are transferred, not cloned), the stores on both sides keep
// the packed form, and a glyph is turned back into objects only when it is looked up. Unpacking is exact: the same
// numbers (-0 and NaN included), contours, order and flags.

import type { WorkerGeometry } from './protocol'
import type { Point, PolygonContour } from './types'

/** Contours as flat coordinates: contour c holds points starts[c] to starts[c + 1] (x, y pairs in `xy`). */
export interface PackedContours {
  xy: Float64Array
  starts: Uint32Array
  clockwise: Uint8Array
}

export interface PackedGlyph {
  contours: PackedContours
  /** The click outline (Thorn): packed apart, 'same' when it is the outline itself, null when there is none. */
  click: PackedContours | 'same' | null
  /** The layout hull (Thorn) as x, y pairs, or null. */
  hull: Float64Array | null
  /** What is small or not made of points, kept as it is: the glyph's ref, metrics, layout box and motion. */
  rest: Pick<WorkerGeometry['polygon'], 'ref' | 'metrics' | 'layoutBox' | 'motion'>
  vertexCount: number
  /** The pipeline's statistics (the panels read them for the selected glyph). */
  stats: Omit<WorkerGeometry, 'polygon' | 'vertexCount'>
}

/** Bytes a packed glyph's statistics and small objects take on the heap (estimate, measured on Roboto). */
const STATS_BYTES = 1800
const ENTRY_BYTES = 200

function packContours(contours: readonly PolygonContour[]): PackedContours {
  let points = 0
  for (const contour of contours) points += contour.points.length
  const xy = new Float64Array(2 * points)
  const starts = new Uint32Array(contours.length + 1)
  const clockwise = new Uint8Array(contours.length)
  let n = 0
  contours.forEach((contour, c) => {
    starts[c] = n
    clockwise[c] = contour.clockwise ? 1 : 0
    for (const p of contour.points) {
      xy[2 * n] = p.x
      xy[2 * n + 1] = p.y
      n++
    }
  })
  starts[contours.length] = n
  return { xy, starts, clockwise }
}

function unpackContours(packed: PackedContours): PolygonContour[] {
  const { xy, starts, clockwise } = packed
  const out: PolygonContour[] = new Array(clockwise.length)
  for (let c = 0; c < clockwise.length; c++) {
    const points: Point[] = new Array(starts[c + 1] - starts[c])
    for (let n = starts[c], k = 0; n < starts[c + 1]; n++, k++) points[k] = { x: xy[2 * n], y: xy[2 * n + 1] }
    out[c] = { points, clockwise: clockwise[c] === 1 }
  }
  return out
}

const buffersOf = (packed: PackedContours) => [packed.xy.buffer, packed.starts.buffer, packed.clockwise.buffer] as ArrayBuffer[]

/** Packs a glyph's geometry; `transfer` lists the typed arrays' buffers (to post the glyph without copying them). */
export function packGeometry(geometry: WorkerGeometry): { packed: PackedGlyph; transfer: ArrayBuffer[] } {
  const { polygon, vertexCount, ...stats } = geometry
  const contours = packContours(polygon.contours)
  const click = polygon.clickOutline === undefined ? null : polygon.clickOutline === polygon.contours ? 'same' : packContours(polygon.clickOutline)
  let hull: Float64Array | null = null
  if (polygon.layoutHull) {
    hull = new Float64Array(2 * polygon.layoutHull.length)
    polygon.layoutHull.forEach((p, k) => {
      hull![2 * k] = p.x
      hull![2 * k + 1] = p.y
    })
  }
  const rest: PackedGlyph['rest'] = { ref: polygon.ref, metrics: polygon.metrics }
  if ('layoutBox' in polygon) rest.layoutBox = polygon.layoutBox
  if ('motion' in polygon) rest.motion = polygon.motion
  const transfer = buffersOf(contours)
  if (click && click !== 'same') transfer.push(...buffersOf(click))
  if (hull) transfer.push(hull.buffer as ArrayBuffer)
  return { packed: { contours, click, hull, rest, vertexCount, stats }, transfer }
}

/** A copy of a packed glyph with arrays of its own (to post one while keeping the other); the small objects are shared. */
export function clonePacked(packed: PackedGlyph): { packed: PackedGlyph; transfer: ArrayBuffer[] } {
  const copy = (p: PackedContours): PackedContours => ({ xy: p.xy.slice(), starts: p.starts.slice(), clockwise: p.clockwise.slice() })
  const contours = copy(packed.contours)
  const click = packed.click && packed.click !== 'same' ? copy(packed.click) : packed.click
  const hull = packed.hull ? packed.hull.slice() : null
  const transfer = buffersOf(contours)
  if (click && click !== 'same') transfer.push(...buffersOf(click))
  if (hull) transfer.push(hull.buffer as ArrayBuffer)
  return { packed: { ...packed, contours, click, hull }, transfer }
}

/** The glyph's geometry as objects again, as it was packed. */
export function unpackGeometry(packed: PackedGlyph): WorkerGeometry {
  const contours = unpackContours(packed.contours)
  const polygon: WorkerGeometry['polygon'] = { ref: packed.rest.ref, metrics: packed.rest.metrics, contours }
  // The optional fields in the pipeline's order, so a glyph unpacked reads like the one packed.
  if ('layoutBox' in packed.rest) polygon.layoutBox = packed.rest.layoutBox
  if (packed.hull) {
    const hull = packed.hull
    polygon.layoutHull = Array.from({ length: hull.length / 2 }, (_, k) => ({ x: hull[2 * k], y: hull[2 * k + 1] }))
  }
  if (packed.click) polygon.clickOutline = packed.click === 'same' ? contours : unpackContours(packed.click)
  if ('motion' in packed.rest) polygon.motion = packed.rest.motion
  return { polygon, vertexCount: packed.vertexCount, ...packed.stats }
}

/** Points the glyph holds (its outline and click outline), for the stores' statistics. */
export function packedPoints(packed: PackedGlyph): number {
  const click = packed.click && packed.click !== 'same' ? packed.click.xy.length / 2 : 0
  return packed.contours.xy.length / 2 + click
}

/** Bytes the packed glyph takes (estimate): its typed arrays, plus its statistics and small objects. */
export function packedBytes(packed: PackedGlyph): number {
  const arrays = (p: PackedContours) => p.xy.byteLength + p.starts.byteLength + p.clockwise.byteLength
  const click = packed.click && packed.click !== 'same' ? arrays(packed.click) : 0
  return arrays(packed.contours) + click + (packed.hull?.byteLength ?? 0) + STATS_BYTES + ENTRY_BYTES
}

/** Bytes an error result takes (estimate). */
export const ERROR_BYTES = ENTRY_BYTES
