// The geometry invariants, run per fixture font by tests/geometry/invariants-*.test.ts (one file per font, so the
// fonts run in parallel) and over every glyph by tests/slow/audit-*.test.ts (see auditPart). For every sample glyph under every configuration:
// - deriving never throws, and every coordinate is finite;
// - no proper crossings where the same Geometry with Experimental off has none and nothing touches (fonts may overlap
//   their own contours, STIX Two Text does in many glyphs; edges that already cross or touch may cross after a warp,
//   as warp.ts and contourLayout.ts allow), and none at all where the effects merged the outlines;
// - deriving again gives the same outline;
// - rounding for export (quantizePolygon) at 0 and 2 decimals neither throws nor leaves a contour out;
// - the SVG export of the sample text has path data of M, L and Z only.

import { describe, expect, it } from 'vitest'
import { quantizePolygon } from '../../src/export/quantize'
import { specimenToSvg } from '../../src/export/svg'
import type { LoadedFont } from '../../src/font/model'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { DerivedGeometry, GeometryParams } from '../../src/geometry/types'
import { DEFAULT_ARTBOARD, DEFAULT_PALETTE, DEFAULT_TYPOGRAPHY, layoutArtboard } from '../../src/specimen/artboard'
import { placePolygons, shapeSpecimen } from '../../src/specimen/scene'
import { LATIN_SAMPLE, loadFixture, sampleGlyphs, type FixtureFont } from './fonts'
import { allFinite, contoursOf, outlineCrossings, sameContours } from './outline'
import {
  ALL_DEFAULT,
  BURST_MAX,
  EFFECTS,
  GEOMETRY,
  on,
  paramsWith,
  SLIDER_MAX,
  THORN_FARTHEST,
  withoutEffects,
} from './params'

/** Path data of the SVG export: moves, lines and closes, with plain decimal numbers. */
export const STRAIGHT_PATH = /^[MLZ0-9 .-]+$/

export interface Config {
  name: string
  params: GeometryParams
  /** Re-derive every n-th glyph for the determinism check (heavy configurations check fewer). */
  recheckEvery: number
}

export const CONFIGS: Config[] = [
  { name: 'Experimental off', params: paramsWith(GEOMETRY.plain, {}), recheckEvery: 3 },
  ...EFFECTS.map((effect) => ({
    name: `${effect} default`,
    params: paramsWith(GEOMETRY.plain, on(effect)),
    recheckEvery: 3,
  })),
  { name: 'all six default', params: paramsWith(GEOMETRY.plain, ALL_DEFAULT), recheckEvery: 3 },
  { name: 'all six default, dense Geometry', params: paramsWith(GEOMETRY.dense, ALL_DEFAULT), recheckEvery: 6 },
  { name: 'all six default, heavy Geometry', params: paramsWith(GEOMETRY.heavy, ALL_DEFAULT), recheckEvery: 6 },
  {
    name: 'Anchor spacing 1, Crumple at max',
    params: paramsWith(GEOMETRY.spacing1, SLIDER_MAX.crumple),
    recheckEvery: 10,
  },
  { name: 'Anchor spacing 1, Thorn default', params: paramsWith(GEOMETRY.spacing1, on('thorn')), recheckEvery: 10 },
  // Thorns across a large canvas: far beyond the letter, where the merge works with the largest coordinates.
  {
    name: 'Thorn default, Reach 100% of a 150 em canvas',
    params: paramsWith(GEOMETRY.plain, on('thorn', { canvasReach: 1, canvasEm: 150 })),
    recheckEvery: 3,
  },
  { name: 'Thorn at slider max, reaching 256 em', params: paramsWith(GEOMETRY.plain, THORN_FARTHEST), recheckEvery: 6 },
  // Reverse: Ripple swaps out and in (petals at mid-side), Thorn shoots into the letter, its slits and spikes merged.
  {
    name: 'Ripple reversed, with petals',
    params: paramsWith(GEOMETRY.plain, on('ripple', { petals: 1, reverse: true })),
    recheckEvery: 3,
  },
  {
    name: 'Ripple at slider max, reversed',
    params: paramsWith(GEOMETRY.plain, on('ripple', { ...SLIDER_MAX.ripple.ripple, reverse: true })),
    recheckEvery: 6,
  },
  { name: 'Thorn reversed', params: paramsWith(GEOMETRY.plain, on('thorn', { reverse: true })), recheckEvery: 3 },
  {
    name: 'Thorn at slider max (Reach 100%), reversed',
    params: paramsWith(GEOMETRY.plain, on('thorn', { ...SLIDER_MAX.thorn.thorn, reverse: true })),
    recheckEvery: 6,
  },
  // Burst: up to 80 spikes round every contour, crossing the letter and each other, and dents between them, merged.
  { name: 'Thorn burst', params: paramsWith(GEOMETRY.plain, on('thorn', { burst: true })), recheckEvery: 3 },
  {
    name: 'Thorn burst at slider max (80 spikes, Reach and Dent 100%)',
    params: paramsWith(GEOMETRY.plain, BURST_MAX),
    recheckEvery: 6,
  },
  {
    name: 'Thorn burst at slider max, reversed',
    params: paramsWith(GEOMETRY.plain, on('thorn', { ...BURST_MAX.thorn, reverse: true })),
    recheckEvery: 6,
  },
  {
    name: 'all five default, Thorn burst, dense Geometry',
    params: paramsWith(GEOMETRY.dense, { ...ALL_DEFAULT, ...on('thorn', { burst: true }) }),
    recheckEvery: 6,
  },
]

/**
 * Which part of the slow audit runs a configuration: those with Dissolve on take the longest, so they run in two files
 * of their own per font (on plain Geometry, and on dense and heavy), and the files run in parallel.
 */
export function auditPart(config: Config): 'main' | 'dissolve' | 'dissolve-geometry' {
  if (config.params.experimental.dissolve?.enabled !== true) return 'main'
  return /dense|heavy/.test(config.name) ? 'dissolve-geometry' : 'dissolve'
}

/** What went wrong with one glyph under one configuration, as readable lines (empty when nothing did). */
/** What the same glyph has with Experimental off: proper crossings, and places where edges touch or pinch. */
interface Baseline {
  cross: number
  contacts: number
}

function checkGlyph(
  font: LoadedFont,
  index: number,
  label: string,
  config: Config,
  recheck: boolean,
  baseline: Baseline,
): { problems: string[]; derived: DerivedGeometry | null } {
  const problems: string[] = []
  let derived: DerivedGeometry
  try {
    derived = deriveGeometry(font.getGlyph(index), config.params)
  } catch (error) {
    return { problems: [`${label}: threw ${String(error)}`], derived: null }
  }
  const contours = contoursOf(derived.polygon)
  if (!allFinite(contours)) problems.push(`${label}: non-finite coordinate`)
  const { cross } = outlineCrossings(contours)
  const folds = derived.experimental.folds
  if (cross > 0 && baseline.cross === 0 && baseline.contacts === 0)
    problems.push(`${label}: ${cross} new proper crossings`)
  if (cross > 0 && folds.applied && !folds.failed && !folds.tooComplex)
    problems.push(`${label}: ${cross} proper crossings after a merge`)
  if (recheck && !sameContours(contoursOf(deriveGeometry(font.getGlyph(index), config.params).polygon), contours)) {
    problems.push(`${label}: not deterministic`)
  }
  for (const decimals of [0, 2]) {
    try {
      const rounded = quantizePolygon(derived.polygon, decimals, label)
      if (rounded.length < contours.length)
        problems.push(`${label}: precision ${decimals} left out ${contours.length - rounded.length} contours`)
    } catch (error) {
      problems.push(`${label}: precision ${decimals} threw ${String(error)}`)
    }
  }
  return { problems, derived }
}

/** Every path's data in an SVG document. */
export function pathData(svg: string): string[] {
  return [...svg.matchAll(/<path [^>]*\bd="([^"]*)"/g)].map((m) => m[1])
}

/** Every glyph of the font that has an outline, labelled by index (the slow audit). */
export function allGlyphs(font: LoadedFont): { index: number; char: string }[] {
  const glyphs: { index: number; char: string }[] = []
  for (let index = 1; index < font.glyphCount; index++) {
    if (font.getGlyph(index).contours.length > 0) glyphs.push({ index, char: '' })
  }
  return glyphs
}

export interface InvariantOptions {
  /** Which glyphs to check: the Latin sample (default) or every glyph with an outline. */
  glyphs?: 'sample' | 'all'
  /** Multiplies each configuration's recheckEvery (the audit re-derives fewer glyphs). */
  recheckScale?: number
}

export function geometryInvariants(
  fontName: FixtureFont,
  configs: readonly Config[] = CONFIGS,
  options: InvariantOptions = {},
) {
  const which = options.glyphs ?? 'sample'
  describe(`geometry invariants: ${fontName}${which === 'all' ? ', every glyph' : ''}`, async () => {
    const font = await loadFixture(fontName)
    const glyphs = which === 'all' ? allGlyphs(font) : sampleGlyphs(font)
    /** Crossings and contacts with Experimental off, by Geometry variant (JSON of the params without the effects) and glyph. */
    const baselines = new Map<string, Map<number, Baseline>>()
    const baselineOf = (params: GeometryParams) => {
      const off = withoutEffects(params)
      const key = JSON.stringify(off)
      let crossings = baselines.get(key)
      if (!crossings) {
        crossings = new Map(
          glyphs.map((g) => {
            const { cross, touch, pinch } = outlineCrossings(
              contoursOf(deriveGeometry(font.getGlyph(g.index), off).polygon),
            )
            return [g.index, { cross, contacts: touch + pinch }]
          }),
        )
        baselines.set(key, crossings)
      }
      return crossings
    }

    it('has the sample glyphs', () => {
      expect(glyphs.length).toBeGreaterThanOrEqual(60)
    })

    for (const config of configs) {
      it(config.name, () => {
        const baseline = baselineOf(config.params)
        const problems: string[] = []
        const polygons = new Map<number, DerivedGeometry>()
        glyphs.forEach((g, k) => {
          const recheck = k % (config.recheckEvery * (options.recheckScale ?? 1)) === 0
          const result = checkGlyph(
            font,
            g.index,
            g.char ? `"${g.char}" #${g.index}` : `#${g.index}`,
            config,
            recheck,
            baseline.get(g.index)!,
          )
          problems.push(...result.problems)
          if (result.derived) polygons.set(g.index, result.derived)
        })
        expect(problems).toEqual([])

        // The SVG export of the whole sample, as the Export dialog writes it.
        const shaped = shapeSpecimen(font, LATIN_SAMPLE)
        const scene = placePolygons(shaped, (index) => {
          const derived = polygons.get(index) ?? deriveGeometry(font.getGlyph(index), config.params)
          return { polygon: derived.polygon }
        })
        const layout = layoutArtboard(scene, DEFAULT_TYPOGRAPHY, DEFAULT_ARTBOARD, font.metrics.unitsPerEm)
        const doc = specimenToSvg(
          scene,
          layout,
          DEFAULT_ARTBOARD,
          2,
          { fontName: font.familyName, subject: LATIN_SAMPLE, pipeline: [config.name] },
          { ink: DEFAULT_PALETTE.ink, paper: DEFAULT_PALETTE.paper, background: true, blur: 0 },
        )
        const paths = pathData(doc.svg)
        expect(paths.length).toBe(doc.paths)
        expect(paths.length).toBeGreaterThanOrEqual(sampleGlyphs(font).length)
        expect(paths.filter((d) => !STRAIGHT_PATH.test(d))).toEqual([])
      })
    }
  })
}
