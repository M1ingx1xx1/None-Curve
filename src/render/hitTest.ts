// What the pointer is over on a canvas renderer's glyph layer: the same targets the SVG canvas gives the browser
// (SpecimenView's SpecimenGlyph, .glyph-box and the .specimen-glyph-thorned rule in styles.css), tested on the CPU.
// Glyphs are tested topmost first (the reverse of drawing order). A glyph is hit by its advance by the line, and by what
// it draws: its fill (nonzero winding) or, with Fill off, its outline's stroke band; in Compare the original curves'
// band too; with markers shown, the skeleton and vertex markers. A glyph with thorns (PolygonGlyph.clickOutline) is hit
// only by its advance and that click outline, never by the thorns. Missing-character boxes are reported but cannot be
// selected, and with Free position the text block behind everything is the drag handle. Pure: no DOM.

import type { Point, PolygonContour, SourceGlyph } from '../geometry/types'
import { sourceGlyphSkeleton } from '../geometry/sourcePath'
import { textBox } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { RenderHit, SourceLookup } from './types'

export interface HitOptions {
  outline: 'source' | 'flattened' | 'compare'
  fill: boolean
  showSkeleton: boolean
  showVertices: boolean
  /** Markers are drawn (an em is large enough on screen). */
  showMarkers: boolean
  /** Marker radius in font units. */
  markerRadius: number
  /** Font units per CSS pixel. */
  u: number
  ascender: number
  descender: number
  /** Free position: the text block is a drag handle. */
  freeMove: boolean
  /** The Free drag in progress (font units, scene y down), applied to glyphs and the block alike. */
  offsetX: number
  offsetY: number
  source: SourceLookup | null
}

/** Half the outline's 1.5 px stroke, plus as much again so a thin outline is easy to hit (CSS px). */
export const STROKE_HIT_PX = 0.75 + 1.5 / 2

/** Vertex dots are this share of the marker radius (GlyphLayers' VERTEX_SCALE). */
const VERTEX_SCALE = 0.4

/** Nonzero winding number of `contours` around (x, y). */
export function windingAt(contours: readonly (readonly Point[])[], x: number, y: number): number {
  let wn = 0
  for (const pts of contours) {
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      if (a.y <= y) {
        if (b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) wn++
      } else if (b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) wn--
    }
  }
  return wn
}

/** Squared distance from (x, y) to the segment a–b. */
function segmentDistance2(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy
  const t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0
  const ex = x - ax - t * dx
  const ey = y - ay - t * dy
  return ex * ex + ey * ey
}

/** True when (x, y) lies within `d` of a side of the closed contours. */
export function nearOutline(contours: readonly (readonly Point[])[], x: number, y: number, d: number): boolean {
  const d2 = d * d
  for (const pts of contours) {
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      if (segmentDistance2(a.x, a.y, b.x, b.y, x, y) <= d2) return true
    }
  }
  return false
}

/** Steps per curve when the original outline is flattened for hit testing (never drawn). */
const CURVE_STEPS = 16

const flatSources = new WeakMap<SourceGlyph, Point[][]>()

/** The original outline as polylines, for hit testing only: the canvas draws the curves themselves. */
export function flattenSource(source: SourceGlyph): Point[][] {
  let flat = flatSources.get(source)
  if (flat) return flat
  flat = source.contours.map((contour) => {
    const pts: Point[] = [contour.start]
    let prev = contour.start
    for (const seg of contour.segments) {
      if (seg.type === 'line') pts.push(seg.to)
      else if (seg.type === 'quad') {
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS
          const s = 1 - t
          pts.push({ x: s * s * prev.x + 2 * s * t * seg.control.x + t * t * seg.to.x, y: s * s * prev.y + 2 * s * t * seg.control.y + t * t * seg.to.y })
        }
      } else {
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS
          const s = 1 - t
          const a = s * s * s
          const b = 3 * s * s * t
          const c = 3 * s * t * t
          const d = t * t * t
          pts.push({
            x: a * prev.x + b * seg.control1.x + c * seg.control2.x + d * seg.to.x,
            y: a * prev.y + b * seg.control1.y + c * seg.control2.y + d * seg.to.y,
          })
        }
      }
      prev = seg.to
    }
    return pts
  })
  flatSources.set(source, flat)
  return flat
}

const pointsOf = (contours: readonly PolygonContour[]) => contours.map((c) => c.points)

/** Whether a drawn glyph's layers (not its box) cover (x, y) in its own font units (y up). */
function hitsLayers(
  polygon: readonly PolygonContour[] | null,
  source: SourceGlyph,
  x: number,
  y: number,
  o: HitOptions,
): boolean {
  const band = STROKE_HIT_PX * o.u
  const poly = polygon ? pointsOf(polygon) : null
  if (o.outline === 'source') {
    const flat = flattenSource(source)
    if (o.fill ? windingAt(flat, x, y) !== 0 : nearOutline(flat, x, y, band)) return true
  } else if (o.outline === 'flattened') {
    if (poly && (o.fill ? windingAt(poly, x, y) !== 0 : nearOutline(poly, x, y, band))) return true
  } else {
    if (poly && o.fill && windingAt(poly, x, y) !== 0) return true
    if (poly && nearOutline(poly, x, y, band)) return true
    if (nearOutline(flattenSource(source), x, y, band)) return true
  }
  if (o.showSkeleton) {
    if (nearOutline(flattenSource(source), x, y, band)) return true
    if (o.showMarkers) {
      const r = o.markerRadius
      const skeleton = sourceGlyphSkeleton(source)
      for (const [a, b] of skeleton.handles) if (segmentDistance2(a.x, a.y, b.x, b.y, x, y) <= band * band) return true
      for (const p of skeleton.controls) if (Math.hypot(p.x - x, p.y - y) <= r) return true
      for (const p of skeleton.anchors) if (Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r) return true
    }
  }
  if (o.showVertices && o.showMarkers && poly) {
    const r = o.markerRadius * VERTEX_SCALE
    for (const pts of poly) for (const p of pts) if (Math.hypot(p.x - x, p.y - y) <= r) return true
  }
  return false
}

/**
 * The target under (sx, sy), in scene units (y down), or null over empty canvas. Occurrences count every glyph of the
 * text in reading order (as PolygonLookup's), spaces and missing glyphs included.
 */
export function hitScene(scene: SpecimenScene, sx: number, sy: number, o: HitOptions): RenderHit | null {
  const x = sx - o.offsetX
  const y = sy - o.offsetY
  const skew = scene.slant ? Math.tan((-scene.slant * Math.PI) / 180) : 0
  let occurrence = 0
  for (const line of scene.lines) occurrence += line.glyphs.length
  for (let l = scene.lines.length - 1; l >= 0; l--) {
    const glyphs = scene.lines[l].glyphs
    for (let i = glyphs.length - 1; i >= 0; i--) {
      occurrence--
      const g = glyphs[i]
      if (g.missing) {
        const bx = g.x + g.advance * 0.1
        const by = g.y - o.ascender * 0.7
        if (x >= bx && x <= bx + g.advance * 0.8 && y >= by && y <= by + o.ascender * 0.7) return { kind: 'missing', text: g.text }
        continue
      }
      // As the SVG canvas: a glyph without a source outline is not drawn, so it takes no clicks either.
      const source = o.source ? o.source(g.index) : null
      if (o.source && (!source || source.contours.length === 0)) continue
      // Into the glyph's own units: the inverse of translate(x y) skewX(-slant) scale(1 -1).
      const gy = g.y - y
      const gx = x - g.x + skew * gy
      const thorned = g.polygon?.clickOutline
      const inBox = gx >= 0 && gx <= g.advance && gy >= o.descender && gy <= o.ascender
      if (inBox) return { kind: 'glyph', index: g.index, text: g.text, occurrence }
      if (thorned) {
        if (windingAt(pointsOf(thorned), gx, gy) !== 0) return { kind: 'glyph', index: g.index, text: g.text, occurrence }
        continue
      }
      if (source && hitsLayers(g.polygon?.contours ?? null, source, gx, gy, o)) return { kind: 'glyph', index: g.index, text: g.text, occurrence }
    }
  }
  return o.freeMove && hitBlock(scene, sx, sy, o.offsetX, o.offsetY) ? { kind: 'block' } : null
}

/** Whether (sx, sy) in scene units lies on the text block (Free position's drag handle), moved by the drag in progress. */
export function hitBlock(scene: SpecimenScene, sx: number, sy: number, offsetX: number, offsetY: number): boolean {
  const x = sx - offsetX
  const y = sy - offsetY
  const block = textBox(scene)
  return x >= block.minX && x <= block.minX + block.width && y >= block.minY && y <= block.minY + block.height
}
