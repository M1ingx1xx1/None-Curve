// Messages between the page and the font export worker (fontExport.worker.ts), and the packing of the
// canvas's polygons into flat arrays, so even a million points cross to the worker as two transfers.

import type { FontSource } from '../font/model'
import type { GeometryParams, GlyphMetrics, GlyphRef, PolygonGlyph } from '../geometry/types'
import type { FontExportPlan, FontExportResult, FontExportStage, FontNaming, KnownGlyph } from './fontFile'

/** Known glyphs (KnownGlyph by source glyph index) as flat arrays. */
export interface PackedGlyphs {
  /** Per polygon, in order: its glyph, its metrics, and how many contours it has. */
  polygons: { index: number; ref: GlyphRef; metrics: GlyphMetrics; contours: number }[]
  /** Per contour, in order: its point count and whether it runs clockwise (1) or not (0). */
  contours: Int32Array
  /** Every point's x and y, in order. */
  coords: Float64Array
  /** Glyphs that failed on the canvas, with the reason. */
  errors: { index: number; error: string }[]
}

export type FontExportRequest = {
  type: 'build'
  /** A copy of the font file: the worker opens its own font. */
  bytes: Uint8Array
  source: FontSource
  plan: FontExportPlan
  params: GeometryParams
  key: string
  naming: FontNaming
  known: PackedGlyphs
}

export type FontExportResponse =
  /** Sent at most every ~100 ms while outlines are processed, and at each new stage. */
  | { type: 'progress'; done: number; total: number; stage: FontExportStage }
  /** The verified font; its bytes are transferred. */
  | { type: 'built'; result: FontExportResult }
  | { type: 'failed'; message: string }

/** Packs known glyphs; the arrays' buffers go in the transfer list. */
export function packGlyphs(known: ReadonlyMap<number, KnownGlyph>): { packed: PackedGlyphs; transfer: ArrayBuffer[] } {
  const polygons: PackedGlyphs['polygons'] = []
  const errors: PackedGlyphs['errors'] = []
  let contourCount = 0
  let pointCount = 0
  for (const [index, glyph] of known) {
    if ('error' in glyph) {
      errors.push({ index, error: glyph.error })
      continue
    }
    const { ref, metrics, contours } = glyph.polygon
    polygons.push({ index, ref, metrics, contours: contours.length })
    contourCount += contours.length
    for (const contour of contours) pointCount += contour.points.length
  }
  const contours = new Int32Array(contourCount * 2)
  const coords = new Float64Array(pointCount * 2)
  let c = 0
  let p = 0
  for (const glyph of known.values()) {
    if ('error' in glyph) continue
    for (const contour of glyph.polygon.contours) {
      contours[c++] = contour.points.length
      contours[c++] = contour.clockwise ? 1 : 0
      for (const point of contour.points) {
        coords[p++] = point.x
        coords[p++] = point.y
      }
    }
  }
  return { packed: { polygons, contours, coords, errors }, transfer: [contours.buffer, coords.buffer] }
}

export function unpackGlyphs(packed: PackedGlyphs): Map<number, KnownGlyph> {
  const known = new Map<number, KnownGlyph>()
  let c = 0
  let p = 0
  for (const { index, ref, metrics, contours: count } of packed.polygons) {
    const contours: PolygonGlyph['contours'] = []
    for (let k = 0; k < count; k++) {
      const length = packed.contours[c++]
      const clockwise = packed.contours[c++] === 1
      const points = new Array(length)
      for (let i = 0; i < length; i++) {
        points[i] = { x: packed.coords[p], y: packed.coords[p + 1] }
        p += 2
      }
      contours.push({ points, clockwise })
    }
    known.set(index, { polygon: { ref, metrics, contours } })
  }
  for (const { index, error } of packed.errors) known.set(index, { error })
  return known
}
