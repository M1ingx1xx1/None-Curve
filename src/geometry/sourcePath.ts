// Pure helpers that describe source curves for rendering. No React, no DOM.

import type { Point, SourceGlyph } from './types'

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()
const pt = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`

/** SVG path data in font units (y-up) for the original curves. */
export function sourceGlyphToPath(glyph: SourceGlyph): string {
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
