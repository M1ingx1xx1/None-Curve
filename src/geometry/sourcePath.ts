// Pure helpers that describe source curves for rendering. No React, no DOM.

import type { Point, PolygonGlyph, SourceGlyph } from './types'

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()
const pt = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`

/** SVG path data in font units (y-up) for the original curves. */
// Path strings are cached per outline object: a text repeats the same glyphs many times, and every
// copy on the canvas and the preview would otherwise build the same (long) string again.
const sourcePaths = new WeakMap<SourceGlyph, string>()
const polygonPaths = new WeakMap<PolygonGlyph, string>()

export function sourceGlyphToPath(glyph: SourceGlyph): string {
  let path = sourcePaths.get(glyph)
  if (path === undefined) {
    path = buildSourcePath(glyph)
    sourcePaths.set(glyph, path)
  }
  return path
}

function buildSourcePath(glyph: SourceGlyph): string {
  const parts: string[] = []
  for (const contour of glyph.contours) {
    parts.push(`M${pt(contour.start)}`)
    for (const seg of contour.segments) {
      if (seg.type === 'line') parts.push(`L${pt(seg.to)}`)
      else if (seg.type === 'quad') parts.push(`Q${pt(seg.control)} ${pt(seg.to)}`)
      else parts.push(`C${pt(seg.control1)} ${pt(seg.control2)} ${pt(seg.to)}`)
    }
    parts.push('Z')
  }
  return parts.join('')
}

export interface Skeleton {
  /** On-curve points. */
  anchors: Point[]
  /** Off-curve control points. */
  controls: Point[]
  /** Handle lines from an anchor to its control point. */
  handles: [Point, Point][]
}

export function sourceGlyphSkeleton(glyph: SourceGlyph): Skeleton {
  const skeleton: Skeleton = { anchors: [], controls: [], handles: [] }
  for (const contour of glyph.contours) {
    let prev = contour.start
    skeleton.anchors.push(prev)
    for (const seg of contour.segments) {
      if (seg.type === 'quad') {
        skeleton.controls.push(seg.control)
        skeleton.handles.push([prev, seg.control], [seg.control, seg.to])
      } else if (seg.type === 'cubic') {
        skeleton.controls.push(seg.control1, seg.control2)
        skeleton.handles.push([prev, seg.control1], [seg.control2, seg.to])
      }
      skeleton.anchors.push(seg.to)
      prev = seg.to
    }
  }
  return skeleton
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Bounds of all on- and off-curve points, or null for an empty glyph. */
export function sourceGlyphBounds(glyph: SourceGlyph): Bounds | null {
  let bounds: Bounds | null = null
  const add = (p: Point) => {
    if (!bounds) bounds = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
    else {
      bounds.minX = Math.min(bounds.minX, p.x)
      bounds.minY = Math.min(bounds.minY, p.y)
      bounds.maxX = Math.max(bounds.maxX, p.x)
      bounds.maxY = Math.max(bounds.maxY, p.y)
    }
  }
  for (const contour of glyph.contours) {
    add(contour.start)
    for (const seg of contour.segments) {
      if (seg.type === 'quad') add(seg.control)
      if (seg.type === 'cubic') {
        add(seg.control1)
        add(seg.control2)
      }
      add(seg.to)
    }
  }
  return bounds
}

/** SVG path data (font units, y-up) for a polygon: only M, L, and Z commands. */
export function polygonGlyphToPath(polygon: PolygonGlyph): string {
  let path = polygonPaths.get(polygon)
  if (path === undefined) {
    path = polygon.contours.map((c) => `M${c.points.map(pt).join('L')}Z`).join('')
    polygonPaths.set(polygon, path)
  }
  return path
}
