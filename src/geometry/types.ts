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
  /** Only a few seeded anchors move; the rest, and every anchor that holds the letter's shape, stay put. Set by the
      Sound tab's Flicker preset only (no control); Reset distortion turns it off. Missing in older settings: false. */
  sparse: boolean
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

/** Experimental Crumple: crumples the letter along straight creases of three seeded triangle meshes (large, medium, fine). */
export interface CrumpleParams {
  enabled: boolean
  /** 0–5: how far lattice points move, as a share of the safe maximum (the most that keeps the warp one-to-one); above 1, facets fold. */
  amount: number
  /** The medium mesh's cell size as a fraction of the em; the large mesh's is 2.25 times it, the fine mesh's 0.4 times. */
  facet: number
  /** Degrees every lattice point's movement is turned by (counter-clockwise). Missing in older saved settings: 0. */
  turn: number
  /** 0–1: strength moved from the large mesh to the medium and fine ones, and how much of the letter is busy. Missing in older saved settings: 0.5. */
  detail: number
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
  /** 0–3: how far each ring is bent into a flower, one petal per side (1 = notches at 10% of their distance). Missing in older saved settings: 0. */
  petals: number
}

/** Experimental Whorl: a swirl around the middle of each letter, along the straight creases of a ring mesh. */
export interface WhorlParams {
  enabled: boolean
  /** -4 to 4: how far the rings turn, as a share of the safe maximum (above 1 either way, the letter folds); negative turns clockwise. */
  amount: number
  /** Rings from the centre to half the ink box's height (2–12): fewer give bigger, chunkier facets. */
  rings: number
  /** Sides of the ring polygons (3–12). */
  sides: number
  /** True: the outside (head and foot) stays put and the middle turns. False: the middle stays put and the outside turns with it. */
  pinned: boolean
}

/**
 * Experimental Slipstream: bands across the stream slide past each other and are drawn out along it, with trails
 * streaming off the letter and thin cuts running into it, all along straight edges.
 */
export interface SlipstreamParams {
  enabled: boolean
  /** Where the stream flows to, in degrees counter-clockwise from the right (0 = right, 90 = up). */
  direction: number
  /** 0–8: extra length per unit of distance downwind at a full gust (1 = up to twice as long); also how long trails get. */
  strength: number
  /** Width of each gust band across the stream, as a fraction of the em. */
  gust: number
  /** 0–2: how much the bands differ (0 = every band at full strength; above 1 some blow backwards and fold the letter). */
  gustiness: number
  /** 0–0.6: how far apart the bands slide along the stream, as a fraction of the em. Missing in older settings: 0. */
  slip: number
  /** 0–8: thin wedge-shaped cuts along the stream per letter. Missing in older settings: 0. */
  cuts: number
  /** 0–8: thin streaks trailing downwind out of each letter. Missing in older settings: 0. */
  trails: number
}

/** Experimental Thorn: a few anchors of each letter grow long straight thorns that pull the letter along. */
export interface ThornParams {
  enabled: boolean
  /** Anchors per letter that jump (1–12), on the letter's outside only. */
  count: number
  /** How far they jump, as a share of the canvas diagonal (0–1; 1 = the whole diagonal): each goes a seeded 35–100% of it. */
  canvasReach: number
  /**
   * The canvas diagonal in em (see canvasDiagonalEm in thorn.ts), which canvasReach is a share of. Set by the app from
   * the artboard and the text size only while Thorn is on, and never saved. Missing: the default canvas at the default size.
   */
  canvasEm?: number
  /** 0–1: 0 = straight out from the outline, 1 = anywhere up to 90° to either side. */
  spread: number
  /** 0–1: how far each thorn's base reaches along the outline, as a share of its root's inner ring (or of the anchor's shorter edge, if longer). */
  width: number
  /** 0–1: how far around each anchor the letter is pulled along with its thorn (0 = the thorns are only added on; 1 = 60% of the em). Missing in older saved settings: 50%. */
  root: number
  /** 0–1: the letter as seen through fluted glass (0 = off). Missing in older saved settings: off. */
  refraction: number
  /** Width of each glass strip, as a share of the em (0.04–0.3). Missing in older saved settings: 10%. */
  flute: number
}

/** The Experimental tab: effects that run after Geometry and can all be on at once. */
export interface ExperimentalParams {
  /** Integer seed shared by every effect; the same seed always gives the same result. */
  seed: number
  crumple: CrumpleParams
  ripple: RippleParams
  whorl: WhorlParams
  slipstream: SlipstreamParams
  /** Missing in older saved settings: off. */
  thorn: ThornParams
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

/** Glyphs to compute under one parameter set (`key` stands for `params`), most important first. */
export interface GeometryJob {
  params: GeometryParams
  key: string
  indices: readonly number[]
}

/**
 * A live frame's parameter set (a GeometryJob): without `indices`, the glyphs the canvas shows; with `within` too, only
 * the first of those (the selected glyph, or the text's first) and the ones in `within` (see shownGlyphs).
 */
export type FrameJob = Omit<GeometryJob, 'indices'> & { indices?: readonly number[]; within?: ReadonlySet<number> }

// ---- Canonical polygon geometry (single source of truth for canvas and export) ----

export interface PolygonContour {
  points: Point[]
  clockwise: boolean
}

export interface PolygonGlyph {
  ref: GlyphRef
  metrics: GlyphMetrics
  contours: PolygonContour[]
  /**
   * With Thorn applied: the ink box of the letter before its thorns grew (font units, glyph space). Layout measures
   * this instead of the outline, so thorns never move or fit the text block. Missing without Thorn.
   */
  layoutBox?: { minX: number; minY: number; maxX: number; maxY: number }
  /**
   * With Thorn applied: the convex hull of that same letter (font units, glyph space, counterclockwise), so slanted
   * text measures the letter exactly rather than the slanted corners of its box. Missing without Thorn.
   */
  layoutHull?: Point[]
  /**
   * With Thorn applied: the font's own outline of the letter as Curve flattening draws it, before Random anchors and
   * every later step (font units, glyph space; straight segments only). The canvas catches the letter's clicks by it
   * instead of the outline, so thorns, and petals or trails the effects drew out of the letter, take none. Missing
   * without Thorn.
   */
  clickOutline?: PolygonContour[]
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
