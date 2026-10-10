// Type boundary for the geometry core. This folder must not depend on React;
// parsing, flattening, and export in later phases are built around these types.

import type { AnchorStats } from './anchors'
import type { ConstraintStats } from './constraints'
import type { BreakRule } from './curveRuns'
import type { DistortionStats } from './distortion'
import type { ExperimentalStats } from './experimental'
import type { RandomAnchorStats } from './randomAnchors'
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
  /**
   * With mergeCurves: straight segments that join smoothly (turn ≤ cornerAngle) are merged into the
   * neighbouring curve as well, so stems flowing into arches are resampled too.
   */
  mergeLines: boolean
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

/** Seeded random anchors on the original curves, used instead of Flatten's sampling. */
export interface RandomAnchorParams {
  enabled: boolean
  /** Anchors per 1000 font units of outline length. */
  density: number
  /** 0 = evenly spaced along the outline, 1 = each anchor anywhere within its own stretch. */
  randomness: number
  /** Keep the source's sharp corners as fixed anchors. */
  keepCorners: boolean
  /** Integer seed; the same seed always gives the same anchors. */
  seed: number
}

/** Experimental Noise: crumples the letter along straight creases of a seeded triangle mesh. */
export interface NoiseParams {
  enabled: boolean
  /** 0–2: how far lattice points move, as a share of the safe maximum (30% of the facet size); above 1, a second pass. */
  amount: number
  /** Lattice cell size as a fraction of the em; creases fall about 40% of it apart along the outline. */
  facet: number
}

/** Experimental Ripple: polygonal waves spreading from a point, along the straight creases of a ring mesh. */
export interface RippleParams {
  enabled: boolean
  /** 0–1: how far the rings move, as a share of the safe maximum (48% of the ring spacing). */
  amount: number
  /** Distance from one crest to the next, as a fraction of the em; rings fall half of it apart. */
  wavelength: number
  /** Sides of the ring polygons (3–12). */
  sides: number
  /** Centre as a fraction of the glyph's ink box (0 = left / bottom, 1 = right / top); may lie outside it. */
  centerX: number
  centerY: number
  /** 0–1: how much the waves die down toward the farthest point of the glyph (1: to nothing). */
  fade: number
}

/** Experimental Wind: letters drawn out along the wind, dragged further in gusts, along straight creases. */
export interface WindParams {
  enabled: boolean
  /** Where the wind blows to, in degrees counter-clockwise from the right (0 = right, 90 = up). */
  direction: number
  /** 0–3: extra length per unit of distance downwind at a full gust (1 = up to twice as long). */
  strength: number
  /** Width of each gust band across the wind, as a fraction of the em. */
  gust: number
  /** 0–1: how much the bands differ (0 = every band at full strength). */
  gustiness: number
}

/** The Experimental tab: effects that run after Geometry and can all be on at once. */
export interface ExperimentalParams {
  /** Integer seed shared by every effect; the same seed always gives the same result. */
  seed: number
  noise: NoiseParams
  ripple: RippleParams
  wind: WindParams
}

export interface GeometryParams {
  flatten: FlattenParams
  random: RandomAnchorParams
  squaring: SquaringParams
  anchors: AnchorParams
  grid: GridParams
  distortion: DistortionParams
  experimental: ExperimentalParams
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
  random: RandomAnchorStats
  squaring: SquaringStats
  anchors: AnchorStats
  constraints: ConstraintStats
  distortion: DistortionStats
  experimental: ExperimentalStats
}

/** Geometry pipeline entry point: source curves + params → canonical polygon. See pipeline.ts. */
export type GeometryPipeline = (source: SourceGlyph, params: GeometryParams) => DerivedGeometry
