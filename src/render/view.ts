// What the canvas renderers (Canvas2D, WebGL2) share about the view: the backing store's size, the base transform from
// scene units to device pixels (the canvas's, with the Free drag, and the artboard's, which drawArtboard uses too), the
// culling SpecimenView does (a line or glyph is drawn when its metric box, widened by an em, or its ink is in view), and
// the hit options a style gives, and the drawing constants both renderers and the hit test share. Pure: no DOM.

import type { PlacedGlyph, Extent } from '../specimen/scene'
import type { HitOptions } from './hitTest'
import { multiply, type Matrix } from './strokes'
import type { CanvasView, RenderStyle, RenderView, SourceLookup } from './types'

/** Outline strokes, in CSS px (styles.css: .outline-stroke, .compare-source, .strip-missing). */
export const OUTLINE_PX = 1.5
/** Miter joins up to this many half-widths, bevelled past it (SVG's stroke-miterlimit). */
export const MITER_LIMIT = 4
/** Vertex dots are this share of the marker radius (GlyphLayers' VERTEX_SCALE). */
export const VERTEX_SCALE = 0.4
/** Compare's polygon fill opacity (styles.css). */
export const COMPARE_ALPHA = 0.35

/** A missing character's box (scene units, y down, not slanted): 80 % of its advance, 70 % of the ascender tall. */
export function missingBox(g: { x: number; y: number; advance: number }, ascender: number) {
  return { x: g.x + g.advance * 0.1, y: g.y - ascender * 0.7, width: g.advance * 0.8, height: ascender * 0.7 }
}

/** The canvas element's backing store. */
export interface CanvasBacking {
  width: number
  height: number
}

/** Sizes the backing store to the view's CSS size at its DPR (at least 1 × 1), touching it only when that changes. */
export function sizeBackingStore(canvas: CanvasBacking, view: RenderView) {
  const width = Math.max(1, Math.round(view.cssWidth * view.dpr))
  const height = Math.max(1, Math.round(view.cssHeight * view.dpr))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

/** The main canvas: scene units (y down) to device pixels, after the Free drag (font units). */
export function canvasMatrix(view: CanvasView, offsetX: number, offsetY: number): Matrix {
  const k = view.dpr / view.u
  return multiply([k, 0, 0, k, -view.left * k, view.top * k], [1, 0, 0, 1, offsetX, offsetY])
}

/**
 * The artboard stretched over a canvas `width` × `height`: the SVG group's `scale(1/unitsPerPx) translate(-x -y)`,
 * then the artboard's pixels to the canvas's.
 */
export function artboardMatrix(
  width: number,
  height: number,
  artboard: { width: number; height: number },
  layout: { x: number; y: number; unitsPerPx: number },
): Matrix {
  const kx = width / artboard.width
  const ky = height / artboard.height
  const s = 1 / layout.unitsPerPx
  return [kx * s, 0, 0, ky * s, -layout.x * kx * s, -layout.y * ky * s]
}

/** Which lines and glyphs to draw. A line off its band and off its ink is skipped whole (its glyphs' ink is in its own). */
export interface ViewCull {
  /** The line's metric band (ascender to descender, widened by an em) crosses the view. */
  band(baseline: number): boolean
  /** The box (scene units) is in view; never a null one. */
  ink(box: Extent | null): boolean
  /** The glyph is drawn: on a band in view and near by its advance, or by its ink. */
  glyph(g: PlacedGlyph, band: boolean): boolean
}

/** Every line and glyph (the preview draws the whole artboard). */
export const NO_CULL: ViewCull = { band: () => true, ink: () => true, glyph: () => true }

/** SpecimenView's culling for the canvas view. The Free drag is left out, as there. */
export function canvasCull(
  view: CanvasView,
  style: Pick<RenderStyle, 'unitsPerEm' | 'ascender' | 'descender'>,
): ViewCull {
  const left = view.left
  const right = left + view.cssWidth * view.u
  const top = -view.top
  const bottom = top + view.cssHeight * view.u
  const margin = style.unitsPerEm
  const { ascender, descender } = style
  const ink = (b: Extent | null) => b !== null && b.maxX >= left && b.minX <= right && b.maxY >= top && b.minY <= bottom
  return {
    band: (baseline) => baseline - ascender - margin <= bottom && baseline - descender + margin >= top,
    ink,
    glyph: (g, band) => (band && g.x + g.advance + margin >= left && g.x - margin <= right) || ink(g.ink),
  }
}

/** CSS px from the canvas's top-left to scene units (y down). */
export function scenePoint(view: CanvasView, x: number, y: number): [number, number] {
  return [view.left + x * view.u, -view.top + y * view.u]
}

/** What the style draws, as hitScene tests it (the block is the surface's: freeMove is false). */
export function hitOptions(
  view: CanvasView,
  style: RenderStyle,
  offsetX: number,
  offsetY: number,
  source: SourceLookup | null,
): HitOptions {
  return {
    outline: style.outline,
    fill: style.fill,
    showSkeleton: style.showSkeleton,
    showVertices: style.showVertices,
    showMarkers: style.showMarkers,
    markerRadius: style.markerRadius,
    u: view.u,
    ascender: style.ascender,
    descender: style.descender,
    freeMove: false,
    offsetX,
    offsetY,
    source,
  }
}
