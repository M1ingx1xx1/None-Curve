// The glyph layer's renderers (Canvas2D, WebGL2): what they draw, in which view, with which colours, and how a
// frame of Glide reaches them without React. The SVG renderer (SpecimenView) is the reference they match.

import type { MorphPlan } from '../specimen/morph'
import type { SpecimenScene } from '../specimen/scene'
import type { ArtboardLayout } from '../specimen/artboard'
import type { SourceGlyph } from '../geometry/types'

/** One occurrence's glide this frame: the plan and its eased progress (0 < p < 1). */
export interface GlyphMorph {
  plan: MorphPlan
  p: number
}

/**
 * A frame as Glide shows it. `layout` has every occurrence's x, y and the slant of this frame; an occurrence with a
 * morph keeps its target polygon in `layout` (the renderer draws the morph instead). `scene()` evaluates the morphs on
 * the CPU (memoised per frame) for the SVG view, the recording canvas and anything else that needs polygons.
 */
export interface GlideFrame {
  target: SpecimenScene | null
  layout: SpecimenScene | null
  /** Reading order, one per PlacedGlyph of `layout`; null when no glyph morphs this frame. */
  morphs: readonly (GlyphMorph | null)[] | null
  scene(): SpecimenScene | null
}

/** The main canvas's view: the visible box in font units (y up), font units per CSS px, the element's size and DPR. */
export interface CanvasView {
  kind: 'canvas'
  left: number
  top: number
  u: number
  cssWidth: number
  cssHeight: number
  dpr: number
}

/** The preview's view: the artboard stretched over the element (the element is sized to the artboard by its box). */
export interface ArtboardView {
  kind: 'artboard'
  layout: ArtboardLayout
  artboard: { width: number; height: number }
  cssWidth: number
  cssHeight: number
  dpr: number
}

export type RenderView = CanvasView | ArtboardView

/** Colours resolved to CSS rgb()/rgba() strings (theme.ts); never light-dark() text. */
export interface RenderColors {
  ink: string
  highlight: string
  accent: string
  control: string
  vertex: string
  danger: string
  /** The panel colour skeleton markers are cut out with (--canvas). */
  canvas: string
}

export interface RenderStyle {
  colors: RenderColors
  outline: 'source' | 'flattened' | 'compare'
  fill: boolean
  showSkeleton: boolean
  showVertices: boolean
  /** Markers are drawn (an em is at least MARKER_MIN_PX_PER_EM). */
  showMarkers: boolean
  /** Font units: 3.5·u on the canvas. */
  markerRadius: number
  /** The preview's outline width in font units (outlineStrokeWidth(upp)), scaling; null on the canvas (1.5 CSS px, not scaling). */
  scalingStroke: number | null
  /** Font units per em and the vertical metrics (glyph boxes, culling, missing boxes). */
  unitsPerEm: number
  ascender: number
  descender: number
}

/** The source outline of a glyph (curves), for Original and Compare. */
export type SourceLookup = (index: number) => SourceGlyph | null

export type RenderHit =
  | { kind: 'glyph'; index: number; text: string; occurrence: number }
  | { kind: 'block' }
  | { kind: 'missing'; text: string }

export interface GlyphRenderer {
  readonly kind: 'canvas' | 'webgl'
  setView(view: RenderView): void
  setStyle(style: RenderStyle): void
  /** A new frame (from GlideStore); `source` reads the source outlines when the style needs them. */
  setFrame(frame: GlideFrame, source: SourceLookup | null): void
  /** Free drag, font units (scene y down); 0, 0 clears it. */
  setTextOffset(dx: number, dy: number): void
  /** The occurrence under the pointer, highlighted alone (as :hover). */
  setHover(occurrence: number | null): void
  /** Every occurrence of this glyph index is highlighted. */
  setSelected(index: number | null): void
  /** CSS px from the canvas's top-left. Topmost (last drawn) wins. */
  hitTest(x: number, y: number): RenderHit | null
  /** Draws now if anything changed since the last draw. Returns false when nothing was drawn. */
  draw(): boolean
  /** Lost context or similar: the surface must make another renderer. */
  readonly broken: boolean
  dispose(): void
}
