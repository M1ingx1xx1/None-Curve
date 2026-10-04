// Type boundary for the geometry core. This folder must not depend on React;
// parsing, flattening, and export in later phases are built around these types.

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
}

export interface AnchorParams {
  /** Target anchor spacing (font units); 0 disables resampling. */
  spacing: number
  /** Simplification threshold; 0 disables simplification. */
  simplify: number
}

export interface GridParams {
  snap: boolean
  size: number
  angleLock: boolean
  angleStep: number
}

export interface DistortionParams {
  amount: number
  seed: number
}

export interface GeometryParams {
  flatten: FlattenParams
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
  vertexCount: number
}

/** Geometry pipeline entry point: source curves + params → canonical polygon. Implemented in Phase B. */
export type GeometryPipeline = (source: SourceGlyph, params: GeometryParams) => DerivedGeometry
