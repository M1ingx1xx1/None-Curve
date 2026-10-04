// Type boundary for the geometry core. This folder must not depend on React;
// parsing, flattening, and export in later phases are built around these types.

import type { AnchorStats } from './anchors'
import type { ConstraintStats } from './constraints'
import type { BreakRule } from './curveRuns'
import type { DistortionStats } from './distortion'
import type { SquaringParams, SquaringStats } from './squaring'
import type { FlattenStats } from './flatten'

export interface Point {
  x: number
  y: number
}

/** Reference to a glyph within a font. */
export interface GlyphRef {
  index: number
  name: string
  unicode: number | null
}

/** Advance width and side bearings, preserved for preview and export. In font units. */
export interface GlyphMetrics {
  unitsPerEm: number
  advanceWidth: number
  leftSideBearing: number
  rightSideBearing: number
  ascender: number
  descender: number
}

// ---- Source curves (from font parsing, used by the skeleton overlay) ----

export type SourceSegment =
  | { type: 'line'; to: Point }
  | { type: 'quad'; control: Point; to: Point }
  | { type: 'cubic'; control1: Point; control2: Point; to: Point }

export interface SourceContour {
  start: Point
  segments: SourceSegment[]
}

export interface SourceGlyph {
  ref: GlyphRef
  metrics: GlyphMetrics
  contours: SourceContour[]
}

// ---- Geometry parameters ----

export type FlattenMode = 'adaptive' | 'segments'

export interface FlattenParams {
  mode: FlattenMode
  /** Maximum deviation in adaptive mode (font units). */
  tolerance: number
  /** Number of line segments per curve in fixed mode. */
  segmentsPerCurve: number
  /**
   * Fixed mode only: treat consecutive curve segments that join smoothly as one curve, so
   * segmentsPerCurve applies to the whole visible curve instead of every font segment.
   */
  mergeCurves: boolean
  /** Where merged curves break: at corners and extrema (horizontal / vertical points), or at corners only. */
  breakAt: BreakRule
  /** A joint that turns by more than this many degrees is a corner and always breaks a merged curve. */
  cornerAngle: number
}

export interface AnchorParams {
  /** Maximum edge length after subdivision (font units); 0 turns spacing off. */
  spacing: number
  /** RDP distance threshold (font units); 0 turns reduction off. */
  simplify: number
}

export interface GridParams {
  snap: boolean
  /** Grid spacing in font units, anchored at the glyph origin; 0 turns snapping off. */
  size: number
  angleLock: boolean
  /** Allowed edge directions are multiples of this many degrees (90, 45, 30, or 15). */
  angleStep: number
}

export interface DistortionParams {
  /** Largest vertex displacement (font units); 0 turns distortion off. */
  amount: number
  /** Noise features per 1000 font units of outline length. */
  frequency: number
  /** 0 = displacement along the outline (tangent), 1 = across it (normal). */
  normalBias: number
  /** Integer seed; the same seed always gives the same result. */
  seed: number
}

export interface GeometryParams {
  flatten: FlattenParams
  squaring: SquaringParams
  anchors: AnchorParams
  grid: GridParams
  distortion: DistortionParams
}

// ---- Canonical polygon geometry (single source of truth for canvas and export) ----

export interface PolygonContour {
  points: Point[]
  clockwise: boolean
}

export interface PolygonGlyph {
  ref: GlyphRef
  metrics: GlyphMetrics
  contours: PolygonContour[]
}

export interface DerivedGeometry {
  source: SourceGlyph
  polygon: PolygonGlyph
  /** Vertices in the final polygon, after every pipeline step. */
  vertexCount: number
  flatten: FlattenStats
  squaring: SquaringStats
  anchors: AnchorStats
  constraints: ConstraintStats
  distortion: DistortionStats
}

/** Geometry pipeline entry point: source curves + params → canonical polygon. See pipeline.ts. */
export type GeometryPipeline = (source: SourceGlyph, params: GeometryParams) => DerivedGeometry
