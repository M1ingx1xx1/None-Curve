// The vertex budget of the Experimental effects (src/geometry/budget.ts): it holds all five effects at the ends of
// their sliders to a bounded, valid outline, and never touches what one effect alone, the defaults, or the Sound
// presets make (EXPERIMENTAL_LIMITS: "No single effect reaches them, even at the ends of its sliders").

import { describe, expect, it } from 'vitest'
import { quantizePolygon } from '../../src/export/quantize'
import { EXPERIMENTAL_LIMITS } from '../../src/geometry/experimental'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { DerivedGeometry, GeometryParams } from '../../src/geometry/types'
import { modulate, targetById, type Mapping } from '../../src/sound/mapping'
import { PRESETS, presetSettings } from '../../src/sound/presets'
import { SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { FIXTURE_FONTS, loadFixture, sampleGlyphs } from '../helpers/fonts'
import { allFinite, contoursOf, outlineCrossings } from '../helpers/outline'
import { ALL_DEFAULT, ALL_MAX, BASE, EFFECTS, GEOMETRY, paramsWith, SLIDER_MAX, THORN_FARTHEST, withoutEffects } from '../helpers/params'

/** The glyphs under the budget, by index, where it fired, with each one's label. */
function budgetFired(font: Awaited<ReturnType<typeof loadFixture>>, glyphs: { index: number; char: string }[], params: GeometryParams) {
  return glyphs.filter((g) => deriveGeometry(font.getGlyph(g.index), params).experimental.budget.applied).map((g) => g.char)
}

/** Sound at its loudest: every feature at 1, on a beat; with pan to one side or the other. */
const LOUD = (pan: number): FeatureFrame => ({
  ...SILENT_FRAME,
  time: 1000,
  levelDb: 0,
  level: 1,
  swell: 1,
  bass: 1,
  mids: 1,
  treble: 1,
  brightness: 1,
  pitch: 1,
  beat: 1,
  activity: 1,
  pan,
  onset: true,
  silent: false,
})

describe.each(FIXTURE_FONTS)('vertex budget: %s', (fontName) => {
  it.each([
    ['', ALL_MAX],
    [', Thorn reaching 256 em', { ...ALL_MAX, ...THORN_FARTHEST }],
  ])('fires at all five effects at slider max%s, and keeps the outline bounded and valid', async (_, effects) => {
    const font = await loadFixture(fontName)
    const params = paramsWith(GEOMETRY.plain, effects)
    const problems: string[] = []
    const unmerged: string[] = []
    const glyphs = sampleGlyphs(font, 'AgQ@&W8')
    let fired = 0
    for (const g of glyphs) {
      const before = deriveGeometry(font.getGlyph(g.index), withoutEffects(params)).vertexCount
      const derived: DerivedGeometry = deriveGeometry(font.getGlyph(g.index), params)
      const { budget, folds } = derived.experimental
      if (budget.applied) fired++
      const contours = contoursOf(derived.polygon)
      const label = `"${g.char}"`
      if (derived.vertexCount > before + EXPERIMENTAL_LIMITS.maxMergePoints) problems.push(`${label}: ${derived.vertexCount} vertices from ${before}`)
      if (!allFinite(contours)) problems.push(`${label}: non-finite coordinate`)
      if (folds.failed) problems.push(`${label}: the merge failed ${JSON.stringify(folds)}`)
      else if (folds.tooComplex) {
        // The documented last resort (budget.ts): even the coarsest simplification has too many crossings to merge,
        // so it is left unmerged, its outlines crossing, but with few vertices.
        unmerged.push(g.char)
        if (derived.vertexCount > before + EXPERIMENTAL_LIMITS.maxAddedVertices) problems.push(`${label}: left unmerged with ${derived.vertexCount} vertices`)
      } else if (outlineCrossings(contours).cross > 0) problems.push(`${label}: crossings after the merge`)
      for (const decimals of [0, 2]) {
        try {
          if (quantizePolygon(derived.polygon, decimals, label).length < contours.length) problems.push(`${label}: precision ${decimals} left out contours`)
        } catch (error) {
          problems.push(`${label}: precision ${decimals} threw ${String(error)}`)
        }
      }
    }
    expect(problems).toEqual([])
    expect(fired).toBeGreaterThan(0)
    // Roboto's "@" (seed 1) is one such glyph; nearly all merge.
    expect(unmerged.length, `left unmerged: ${unmerged.join(' ')}`).toBeLessThanOrEqual(glyphs.length / 4)
  })

  it('does not fire at the defaults, or with one effect at slider max', async () => {
    const font = await loadFixture(fontName)
    const glyphs = sampleGlyphs(font)
    expect(budgetFired(font, glyphs, paramsWith(GEOMETRY.plain, ALL_DEFAULT)), 'all five default').toEqual([])
    for (const effect of EFFECTS) expect(budgetFired(font, glyphs, paramsWith(GEOMETRY.plain, SLIDER_MAX[effect])), `${effect} at slider max`).toEqual([])
    // Thorn's refraction covers only the letter, so however far the thorns reach, they add only a few points.
    expect(budgetFired(font, glyphs, paramsWith(GEOMETRY.plain, THORN_FARTHEST)), 'thorn at slider max, reaching 256 em').toEqual([])
  })

  it('does not fire on any Sound preset, quiet or at its loudest', async () => {
    const font = await loadFixture(fontName)
    const glyphs = sampleGlyphs(font, 'AGMQRSWaegks@&8%')
    for (const preset of PRESETS) {
      const { params } = presetSettings(BASE, preset)
      const mappings: Mapping[] = preset.mappings.map((m, k) => ({ ...m, id: `m${k}` }))
      // Every seed the preset drives moved on by a few jumps.
      const jumps = new Map(mappings.filter((m) => targetById(m.target)?.kind === 'jump').map((m) => [m.target, 3]))
      const frames = [params, modulate(params, LOUD(1), mappings, jumps).params, modulate(params, LOUD(-1), mappings, jumps).params]
      for (const [k, live] of frames.entries()) expect(budgetFired(font, glyphs, live), `${preset.name}, frame ${k}`).toEqual([])
    }
  })
})
