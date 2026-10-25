// A glyph's derived geometry packed into typed arrays (NOCUR-85): the precompute window keeps thousands of glyphs, and
// as objects each polygon point costs 100-200 bytes of heap; packed, its coordinates take 16. The worker packs what it
// computes before posting it (the arrays are transferred, not cloned; the canvas lane's glyphs too), the stores on both
// sides keep the packed form, and a glyph is turned back into objects only when it is looked up. Unpacking is exact:
// the same numbers (-0 and NaN included), contours, order and flags.

import type { GlyphStats, LeanGeometry, WorkerGeometry } from './protocol'
import type { GlyphMotion, Point, PolygonContour } from './types'

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
  /** The outline from before the effects' merge (glideOutline, for Glide): packed apart, or null. */
  glide: PackedContours | null
  /** The layout hull (Thorn) as x, y pairs, or null. */
  hull: Float64Array | null
  /** The letter as Whorl received it (its motion's `outline`, the whole letter): packed apart, or null. */
  outline: PackedContours | null
  /** What is small or not made of points, kept as it is: the glyph's ref, metrics, layout box and motion (its outline apart). */
  rest: Pick<WorkerGeometry['polygon'], 'ref' | 'metrics' | 'layoutBox' | 'motion'>
  vertexCount: number
  /** The pipeline's statistics (the panels read them for the selected glyph); null when they were left out. */
  stats: GlyphStats | null
}

/** A packed glyph as the page keeps it: as objects again, marked `lean` when its statistics were left out. */
export type UnpackedEntry = { geometry: WorkerGeometry } | { geometry: LeanGeometry; lean: true }

/** Bytes a packed glyph's statistics and small objects take on the heap (estimate, measured on Roboto). */
const STATS_BYTES = 1800
const ENTRY_BYTES = 200
/** Bytes a point takes on the heap as an object in an array (estimate). */
const POINT_OBJECT_BYTES = 150

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

const buffersOf = (packed: PackedContours) =>
  [packed.xy.buffer, packed.starts.buffer, packed.clockwise.buffer] as ArrayBuffer[]

/** The buffers of a packed glyph's typed arrays (to post it without copying them). */
function transferOf(packed: PackedGlyph): ArrayBuffer[] {
  const transfer = buffersOf(packed.contours)
  if (packed.click && packed.click !== 'same') transfer.push(...buffersOf(packed.click))
  if (packed.glide) transfer.push(...buffersOf(packed.glide))
  if (packed.hull) transfer.push(packed.hull.buffer as ArrayBuffer)
  if (packed.outline) transfer.push(...buffersOf(packed.outline))
  return transfer
}

/**
 * Packs a glyph's geometry; `transfer` lists the typed arrays' buffers (to post the glyph without copying them).
 * `withStats` false leaves the pipeline's statistics out (the canvas lane sends them only for the glyph asked).
 */
export function packGeometry(
  geometry: WorkerGeometry,
  withStats = true,
): { packed: PackedGlyph; transfer: ArrayBuffer[] } {
  const { polygon, vertexCount, ...stats } = geometry
  const contours = packContours(polygon.contours)
  const click =
    polygon.clickOutline === undefined
      ? null
      : polygon.clickOutline === polygon.contours
        ? 'same'
        : packContours(polygon.clickOutline)
  const glide = polygon.glideOutline ? packContours(polygon.glideOutline) : null
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
  let outline: PackedContours | null = null
  if ('motion' in polygon) {
    const whorl = polygon.motion?.whorl
    if (whorl?.outline) {
      // Whorl's outline is the whole letter again: packed with the contours, the motion kept without it (a copy).
      const { outline: rings, ...kept } = whorl
      outline = packContours(rings.map((points) => ({ points, clockwise: false })))
      rest.motion = { ...polygon.motion, whorl: kept }
    } else rest.motion = polygon.motion
  }
  const packed: PackedGlyph = {
    contours,
    click,
    glide,
    hull,
    outline,
    rest,
    vertexCount,
    stats: withStats ? stats : null,
  }
  return { packed, transfer: transferOf(packed) }
}

/** A copy of a packed glyph with arrays of its own (to post one while keeping the other); the small objects are shared. */
export function clonePacked(packed: PackedGlyph): { packed: PackedGlyph; transfer: ArrayBuffer[] } {
  const copy = (p: PackedContours): PackedContours => ({
    xy: p.xy.slice(),
    starts: p.starts.slice(),
    clockwise: p.clockwise.slice(),
  })
  const contours = copy(packed.contours)
  const click = packed.click && packed.click !== 'same' ? copy(packed.click) : packed.click
  const glide = packed.glide ? copy(packed.glide) : null
  const hull = packed.hull ? packed.hull.slice() : null
  const outline = packed.outline ? copy(packed.outline) : null
  const copied: PackedGlyph = { ...packed, contours, click, glide, hull, outline }
  return { packed: copied, transfer: transferOf(copied) }
}

/** The glyph's geometry as objects again, as it was packed (without statistics when they were left out). */
export function unpackGeometry(packed: PackedGlyph): WorkerGeometry | LeanGeometry {
  const contours = unpackContours(packed.contours)
  const polygon: WorkerGeometry['polygon'] = { ref: packed.rest.ref, metrics: packed.rest.metrics, contours }
  // The optional fields in the pipeline's order, so a glyph unpacked reads like the one packed.
  if ('layoutBox' in packed.rest) polygon.layoutBox = packed.rest.layoutBox
  if (packed.hull) {
    const hull = packed.hull
    polygon.layoutHull = Array.from({ length: hull.length / 2 }, (_, k) => ({ x: hull[2 * k], y: hull[2 * k + 1] }))
  }
  if (packed.click) polygon.clickOutline = packed.click === 'same' ? contours : unpackContours(packed.click)
  if ('motion' in packed.rest) polygon.motion = withOutline(packed.rest.motion, packed.outline)
  if (packed.glide) polygon.glideOutline = unpackContours(packed.glide)
  const { vertexCount, stats } = packed
  return stats ? { polygon, vertexCount, ...stats } : { polygon, vertexCount }
}

/** The motion with Whorl's outline back in it (a copy: the packed glyph's motion stays without it). */
function withOutline(motion: GlyphMotion | undefined, outline: PackedContours | null): GlyphMotion | undefined {
  if (!outline || !motion?.whorl) return motion
  return { ...motion, whorl: { ...motion.whorl, outline: unpackContours(outline).map((contour) => contour.points) } }
}

/** The glyph as the page keeps it (geometryClient.ts GeometryEntry): as objects, marked `lean` without statistics. */
export function unpackEntry(packed: PackedGlyph): UnpackedEntry {
  const geometry = unpackGeometry(packed)
  return packed.stats ? { geometry: geometry as WorkerGeometry } : { geometry, lean: true }
}

/** Points the glyph holds (its outline, click, glide and Whorl's outlines), for the stores' statistics and budgets. */
export function packedPoints(packed: PackedGlyph): number {
  const click = packed.click && packed.click !== 'same' ? packed.click.xy.length / 2 : 0
  const glide = packed.glide ? packed.glide.xy.length / 2 : 0
  return packed.contours.xy.length / 2 + click + glide + (packed.outline ? packed.outline.xy.length / 2 : 0)
}

/** Bytes the packed glyph takes (estimate): its typed arrays, plus its statistics and small objects. */
export function packedBytes(packed: PackedGlyph): number {
  const arrays = (p: PackedContours) => p.xy.byteLength + p.starts.byteLength + p.clockwise.byteLength
  const click = packed.click && packed.click !== 'same' ? arrays(packed.click) : 0
  const outline = packed.outline ? arrays(packed.outline) : 0
  return (
    arrays(packed.contours) +
    click +
    (packed.glide ? arrays(packed.glide) : 0) +
    (packed.hull?.byteLength ?? 0) +
    outline +
    (packed.stats ? STATS_BYTES : 0) +
    ENTRY_BYTES
  )
}

/** Bytes the glyph takes once unpacked (estimate): an object per point, plus its statistics and small objects. */
export function unpackedBytes(packed: PackedGlyph): number {
  const hull = packed.hull ? packed.hull.length / 2 : 0
  return POINT_OBJECT_BYTES * (packedPoints(packed) + hull) + (packed.stats ? STATS_BYTES : 0) + ENTRY_BYTES
}

/** Bytes an error result takes (estimate). */
export const ERROR_BYTES = ENTRY_BYTES
