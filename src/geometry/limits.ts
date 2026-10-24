// The effects' limits and fallbacks, and the cheap readers of their settings (on or off, folds, sizes): what the page
// needs of the effects (sliders, saved settings, Sound, the status line) without their geometry, which runs only in the
// workers. The effects read them from here too. Pure functions; no React, no DOM.

import { clamp, finite } from './primitives'
import type { CrumpleParams, DissolveParams, ExperimentalParams, RippleParams, SlipstreamParams, ThornParams, WhorlParams } from './types'

/** Angle lock's steps, in degrees (constraints.ts). */
export const ANGLE_STEPS = [90, 45, 30, 15] as const

export const DISTORTION_LIMITS = {
  maxAmount: 200,
  minFrequency: 0.5,
  maxFrequency: 50,
  /** Largest seed the Seed field takes. */
  maxSeed: 999_999,
  /**
   * The two ends of an edge may move toward each other along the edge by at most this fraction of its
   * length, so no edge can collapse or reverse. Movement across the edge is not limited: it only turns
   * the edge, and limiting it would weaken the distortion the denser the outline (neighbouring vertices
   * of a dense outline are close, so any difference in their movement is large next to their edge).
   */
  edgeFraction: 0.5,
  /** Passes of the edge protection; each pass only shortens displacements. */
  protectionPasses: 4,
  /**
   * Where a distorted contour crosses itself or another contour (dense outlines at inner corners, thin
   * strokes), the amplitude is halved around the crossing, smoothly over one amplitude of outline on
   * each side, up to this many times; the rest of the contour keeps the full amplitude.
   */
  localRepairs: 12,
  /** Amplitude scales tried for the whole contour, in order, when local repairs are not enough. */
  retryScales: [0.5, 0.25, 0.125, 0.0625] as const,
} as const

export const RANDOM_ANCHOR_LIMITS = {
  minDensity: 1,
  maxDensity: 100,
  maxSeed: 999_999,
  /** A source joint that turns by more than this many degrees is kept as a corner anchor. */
  cornerAngle: 30,
  /** Hard cap per contour, whatever the density. */
  maxAnchorsPerContour: 2000,
  /** Arc-length table samples per curve segment. */
  samplesPerCurve: 32,
  /** Anchors closer than this (font units) are merged. */
  minGap: 0.5,
  /** Different random draws tried, in order, before a contour falls back to Flatten's result. */
  attempts: 4,
} as const

export const EXPERIMENTAL_LIMITS = {
  maxSeed: 999_999,
  /**
   * The vertex budget (see budget.ts), on top of the vertices the glyph brings in, so dense Geometry is never cut: at
   * most this many vertices more after any effect, and this many grid points (vertices and crossings) more in a merge.
   * No single effect reaches them, even at the ends of its sliders; only several dense ones together do.
   */
  maxAddedVertices: 6000,
  maxMergePoints: 30_000,
} as const

/** True when the outlines are merged: Thorn is on, so a thorn may cross the letter, or Slipstream cuts the letters. */
export function experimentalMerges(params: ExperimentalParams): boolean {
  return experimentalFolds(params) || thornIsOn(params.thorn) || slipstreamMerges(params.slipstream)
}

/** True when any effect goes beyond its safe range, so the letters fold onto themselves. */
export function experimentalFolds(params: ExperimentalParams): boolean {
  return crumpleFolds(params.crumple) || rippleFolds(params.ripple) || whorlFolds(params.whorl) || slipstreamFolds(params.slipstream)
}

// Crumple (crumple.ts).

export const CRUMPLE_LIMITS = {
  /** Facet sizes, as fractions of the em; 0 leaves the letter as it is (see crumple.ts). */
  minFacet: 0,
  maxFacet: 1,
  /**
   * The finest lattice. Creases fall about 40% of a facet apart along the outline, so this keeps them about 3% of the
   * em apart or more: far enough to read as corners rather than as a wobbly curve at any text size. Smaller facet
   * sizes keep this lattice and fade the movement out.
   */
  finestFacet: 0.08,
  /** Above 1 (the safe range), facets fold over each other. */
  maxAmount: 5,
  /** Largest lattice-point movement at 100% Amount, as a fraction of the facet size. */
  maxMove: 0.3,
} as const

export function crumpleIsOn(params: CrumpleParams): boolean {
  return params.enabled && params.amount > 0 && crumpleFade(params) > 0
}

/** True when Crumple goes beyond its safe range, so the letter folds onto itself. */
export function crumpleFolds(params: CrumpleParams): boolean {
  return crumpleIsOn(params) && params.amount * crumpleFade(params) > 1
}

/** The facet size (× the em), from 0 (off) up. */
export function crumpleFacet(params: CrumpleParams): number {
  return clamp(finite(params.facet, 0.18), CRUMPLE_LIMITS.minFacet, CRUMPLE_LIMITS.maxFacet)
}

/** How much of the movement is left: 1 from the finest facet up, falling to 0 at facet size 0. */
export function crumpleFade(params: CrumpleParams): number {
  return Math.min(crumpleFacet(params) / CRUMPLE_LIMITS.finestFacet, 1)
}

/** The lattice Crumple uses (its facet size, × the em) and how much of the movement is left there (0–1). */
export function crumpleLattice(params: CrumpleParams): { facet: number; fade: number } {
  return { facet: Math.max(crumpleFacet(params), CRUMPLE_LIMITS.finestFacet), fade: crumpleFade(params) }
}

// Ripple (ripple.ts).

export const RIPPLE_LIMITS = {
  /** Wavelengths, as fractions of the em: rings fall half a wavelength apart. 0 stills the waves (see ripple.ts). */
  minWavelength: 0,
  maxWavelength: 2,
  /** The shortest ring spacing's wavelength: shorter wavelengths keep it and fade the waves out. */
  shortestWavelength: 0.08,
  minSides: 3,
  maxSides: 12,
  /** Centre, as a fraction of the glyph's ink box; it may lie outside the letter. */
  minCenter: -0.5,
  maxCenter: 1.5,
  /** Above 1 (the safe range), rings pass each other and fold. */
  maxAmount: 4,
  /**
   * Largest ring movement at 100% Amount, as a fraction of the ring spacing (half a wavelength). Rings
   * stay apart below 0.5; at 0.45 neighbouring rings come within 10% of the spacing of each other.
   * Closer still, strokes between them get thinner than a font unit and no longer survive rounding
   * for font export.
   */
  maxMove: 0.45,
  /**
   * Petal depth at 100%: the tips reach out 90% further, the notches keep 10% of their distance. Above
   * 100% the tips keep growing while the notches stay at 10%.
   */
  maxPetal: 0.9,
  maxPetals: 3,
} as const

export function rippleIsOn(params: RippleParams): boolean {
  return params.enabled && ((params.amount > 0 && rippleWaves(params) > 0) || ripplePetals(params) > 0)
}

/** True when Ripple goes beyond its safe range, so the letter folds onto itself (Petals never folds). */
export function rippleFolds(params: RippleParams): boolean {
  return rippleIsOn(params) && params.amount * rippleWaves(params) > 1
}

/** The wavelength (× the em), from 0 (no waves) up. */
export function rippleWavelength(params: RippleParams): number {
  return clamp(finite(params.wavelength, 0.3), RIPPLE_LIMITS.minWavelength, RIPPLE_LIMITS.maxWavelength)
}

/** How much of the waves is left: 1 from the shortest wavelength up, falling to 0 at wavelength 0. */
export function rippleWaves(params: RippleParams): number {
  return Math.min(rippleWavelength(params) / RIPPLE_LIMITS.shortestWavelength, 1)
}

/** The wavelength Ripple's rings use (× the em) and how much of the waves is left there (0–1; 0: no rings). */
export function rippleRings(params: RippleParams): { wavelength: number; waves: number } {
  return { wavelength: Math.max(rippleWavelength(params), RIPPLE_LIMITS.shortestWavelength), waves: rippleWaves(params) }
}

/** The Petals setting (0 when missing, as in settings saved before it existed). */
export function ripplePetals(params: RippleParams): number {
  return clamp(finite(params.petals, 0), 0, RIPPLE_LIMITS.maxPetals)
}

// Whorl (whorl.ts).

export const WHORL_LIMITS = {
  minRings: 2,
  maxRings: 12,
  minSides: 3,
  maxSides: 12,
  /** -4 to 4: above 1 either way (the safe range), the letter folds. */
  maxAmount: 4,
  /** At 100%, the share of the largest step between rings that keeps every triangle the same way round. */
  safety: 0.9,
  /** The swirl reaches at least this far from the centre (× the em), so flat glyphs such as a hyphen still turn. */
  minRadius: 0.05,
} as const

export function whorlIsOn(params: WhorlParams | undefined): boolean {
  return !!params && params.enabled && finite(params.amount, 0) !== 0
}

/** True when Whorl goes beyond its safe range, so the letter folds onto itself. */
export function whorlFolds(params: WhorlParams | undefined): boolean {
  return whorlIsOn(params) && Math.abs(params!.amount) > 1
}

// Slipstream (slipstream.ts).

export const SLIPSTREAM_LIMITS = {
  /** Strength: extra length per unit of distance downwind at a full gust (1 = up to twice as long). */
  maxStrength: 8,
  /**
   * No point moves further than this (× the em), however far downwind it lies: beyond it the letter
   * is carried along without stretching further. This keeps strong streams and backward gusts within
   * the coordinates a font file can store.
   */
  maxReach: 4,
  /** Above 1 (the safe range), some gusts blow backwards. */
  maxGustiness: 2,
  /** Band (gust) sizes, as fractions of the em; 0: no gusts (see slipstream.ts). */
  minGust: 0,
  maxGust: 0.5,
  /** The narrowest band: smaller gust sizes keep it and fade Gustiness and Slip out. */
  smallestGust: 0.06,
  /** Slip: how far apart the sway bands may slide, as a fraction of the em. Safe at any amount (a shear). */
  maxSlip: 0.6,
  /** Cuts and trails per letter. */
  maxCuts: 8,
  maxTrails: 8,
} as const

export function slipstreamIsOn(params: SlipstreamParams): boolean {
  return (
    params.enabled &&
    (finite(params.strength, 0) > 0 || finite(params.slip, 0) * slipstreamFade(params) > 0 || wholeCount(params.cuts, SLIPSTREAM_LIMITS.maxCuts) > 0 || wholeCount(params.trails, SLIPSTREAM_LIMITS.maxTrails) > 0)
  )
}

/**
 * True when Slipstream goes beyond its safe range (gusts blowing backwards), so the letter can fold onto itself. Only the
 * stretch can fold: without Strength, Slip is a shear and never does.
 */
export function slipstreamFolds(params: SlipstreamParams): boolean {
  return slipstreamIsOn(params) && finite(params.strength, 0) > 0 && params.gustiness * slipstreamFade(params) > 1
}

/** The gust size (× the em), from 0 (no gusts) up. */
export function slipstreamGust(params: SlipstreamParams): number {
  return clamp(finite(params.gust, 0.12), SLIPSTREAM_LIMITS.minGust, SLIPSTREAM_LIMITS.maxGust)
}

/** How much of Gustiness and Slip is left: 1 from the smallest band up, falling to 0 at gust size 0. */
export function slipstreamFade(params: SlipstreamParams): number {
  return Math.min(slipstreamGust(params) / SLIPSTREAM_LIMITS.smallestGust, 1)
}

/** The band size Slipstream uses (× the em) and how much of Gustiness and Slip is left there (0–1; 0: steady). */
export function slipstreamBands(params: SlipstreamParams): { gust: number; fade: number } {
  return { gust: Math.max(slipstreamGust(params), SLIPSTREAM_LIMITS.smallestGust), fade: slipstreamFade(params) }
}

/** True when Slipstream redraws the outline to make its cuts (see slipstreamTrailsAndCuts). */
export function slipstreamMerges(params: SlipstreamParams): boolean {
  return slipstreamIsOn(params) && wholeCount(params.cuts, SLIPSTREAM_LIMITS.maxCuts) > 0
}

/** A whole count from 0 to max (0 when missing, as in older saved settings). */
export function wholeCount(value: number, max: number): number {
  return Math.round(clamp(finite(value, 0), 0, max))
}

// Thorn (thorn.ts).

/** A canvas's diagonal over the text size: the diagonal in em, to 0.01 em. */
const diagonalEm = (width: number, height: number, size: number) => Math.round((Math.hypot(width, height) / size) * 100) / 100

export const THORN_LIMITS = {
  /** Anchors that jump; 0: none, and Thorn leaves the letter as it is. */
  minCount: 0,
  maxCount: 12,
  /**
   * The canvas diagonal in em that Reach is a share of when the app gives none (ThornParams.canvasEm): the default
   * canvas, 1200 × 800 px, at the default 48 px text (about 30 em).
   */
  defaultCanvasEm: diagonalEm(1200, 800, 48),
  /**
   * The longest jump in em, whatever the canvas (small text on a large canvas spans over 1000 em): a safety cap that
   * keeps every merge within its exact grid (see OVERLAP_LIMITS.maxCoordinate).
   */
  maxReachEm: 256,
  /** Each anchor jumps at least this share of Reach (the rest is random, up to all of it). */
  minShare: 0.35,
  /** The narrowest base (Width 0), as a share of how far a base may reach: the root's inner ring, or the anchor's shorter edge. */
  minWidth: 0.02,
  /** The root's radius at Root 100%, as a share of the em (Root 0: no root, the thorns are only added on). */
  maxRoot: 0.6,
  /** Flute width range, as a share of the em; 0 clears the glass (see thorn.ts). */
  minFlute: 0,
  maxFlute: 0.3,
  /** The narrowest strip: narrower flute widths keep it and fade Refraction out. */
  finestFlute: 0.04,
  /** Spikes per letter in Burst; 0: none, and Thorn leaves the letter as it is. */
  minSpikes: 0,
  maxSpikes: 80,
} as const

/**
 * In Burst, the longest spike is this share of Reach's length (a share of the canvas diagonal, as for thorns): a burst
 * rings each letter, so at the default Reach (10%, about 3 em on the default canvas) its longest spikes reach about 0.9 em.
 */
export const BURST_REACH = 0.3

/** Used where older saved settings lack the newer sliders (Refraction: off, Burst: off). */
export const THORN_FALLBACK = { root: 0.5, flute: 0.1, spikes: 40, dent: 0.8 } as const

/** The strip width Thorn's glass uses (× the em) and how much of Refraction is left there (0–1; 0: no glass). */
export function thornFlutes(params: ThornParams): { flute: number; fade: number } {
  const width = clamp(finite(params.flute, THORN_FALLBACK.flute), THORN_LIMITS.minFlute, THORN_LIMITS.maxFlute)
  return { flute: Math.max(width, THORN_LIMITS.finestFlute), fade: Math.min(width / THORN_LIMITS.finestFlute, 1) }
}

export function thornIsOn(params: ThornParams | undefined): params is ThornParams {
  if (!params || !params.enabled || !(finite(params.canvasReach, 0) > 0)) return false
  // Older saved settings have no Burst and no spikes (THORN_FALLBACK.spikes).
  return params.burst === true ? finite(params.spikes, THORN_FALLBACK.spikes) >= 1 : finite(params.count, 0) >= 1
}

/**
 * The canvas diagonal in em (ThornParams.canvasEm): the artboard's diagonal over the text size, both in px, to 0.01 em.
 * The default canvas's (THORN_LIMITS.defaultCanvasEm) for sizes that are not finite and positive.
 */
export function canvasDiagonalEm(width: number, height: number, size: number): number {
  if (![width, height, size].every((v) => Number.isFinite(v) && v > 0)) return THORN_LIMITS.defaultCanvasEm
  const em = diagonalEm(width, height, size)
  return Number.isFinite(em) && em > 0 ? em : THORN_LIMITS.defaultCanvasEm
}

// Dissolve (dissolve.ts).

export const DISSOLVE_LIMITS = {
  /** Grain: one noise period as a share of the stroke width. */
  minGrain: 0.15,
  maxGrain: 1,
  /** How far the ragged edge reaches past the outline, in half-strokes. */
  maxSpread: 1.5,
  /** Grid nodes per glyph at most: a larger glyph (one with long thorns) is sampled on a coarser grid. */
  maxNodes: 1_000_000,
} as const

export function dissolveIsOn(params: DissolveParams | undefined): params is DissolveParams {
  return !!params && params.enabled
}
