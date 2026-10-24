// The Sound targets and modulate (src/sound/mapping.ts): every slider target takes its range and step from
// SLIDER_RANGES, as the panels' sliders do, so a live value is always one the slider itself can produce; silence and
// switched-off rows restore the sliders' values exactly. The Response group's Strength and Melody tracking act in
// modulate; at their neutral values it is exactly the call without them.

import { describe, expect, it } from 'vitest'
import { FEATURES, featureValue, modulate, TARGETS, targetById, type Mapping } from '../../src/sound/mapping'
import { PRESETS, presetSettings } from '../../src/sound/presets'
import { MAPPING_LIMITS } from '../../src/sound/mappingStore'
import {
  NEUTRAL_RESPONSE,
  RESPONSE_LIMITS,
  SILENT_FRAME,
  type FeatureFrame,
  type ResponseSettings,
} from '../../src/sound/types'
import { reachFromSlider, reachToSlider, SLIDER_RANGES, THORN_REACH, type SliderId } from '../../src/state/sliderScales'
import { BASE } from '../helpers/params'

// The Geometry and Experimental sliders (Typography and Color have their own targets.test.ts). Tolerance (logarithmic) and Thorn's Reach (cubic) have curved scales of their own.
const sliders = TARGETS.filter(
  (t) =>
    t.kind === 'slider' &&
    (t.tab === 'geometry' || t.tab === 'experimental') &&
    t.id !== 'flatten.tolerance' &&
    t.id !== 'experimental.thorn.canvasReach',
)
const loud: FeatureFrame = {
  ...SILENT_FRAME,
  time: 1,
  silent: false,
  levelDb: 0,
  level: 1,
  bass: 1,
  mids: 1,
  treble: 1,
  brightness: 1,
  pitch: 1,
  beat: 1,
  activity: 1,
  pan: 1,
}

describe('Sound targets', () => {
  it('take every slider range and step from SLIDER_RANGES', () => {
    const ids = Object.keys(SLIDER_RANGES) as SliderId[]
    for (const target of sliders) {
      expect(ids, `${target.id} has a range`).toContain(target.id)
      const range = SLIDER_RANGES[target.id as SliderId]
      expect([target.min, target.max, target.step], target.id).toEqual([range.min, range.max, range.step])
    }
    // And every Geometry and Experimental slider is a target.
    for (const id of ids) expect(targetById(id), id).toBeDefined()
  })

  it('give back only values their slider can produce', () => {
    for (const target of sliders) {
      for (const position of [0, 0.13, 0.5, 0.77, 1, -1, 2, Number.NaN]) {
        const value = target.fromSlider(position)
        expect(value, `${target.id} at ${position}`).toBeGreaterThanOrEqual(target.min - 1e-9)
        expect(value).toBeLessThanOrEqual(target.max + 1e-9)
        const steps = (value - target.min) / target.step
        expect(Math.abs(steps - Math.round(steps)), `${target.id}: ${value} off the step`).toBeLessThan(1e-6)
        expect(target.fromSlider(target.toSlider(value))).toBeCloseTo(value, 9)
      }
    }
  })

  it("move Thorn's Reach on the cubic slider the panel uses", () => {
    const reach = targetById('experimental.thorn.canvasReach')!
    expect([reach.min, reach.max, reach.label, reach.section]).toEqual([0, THORN_REACH.max, 'Reach', 'Thorn'])
    // Every position of the range input gives the value the panel reads from it, and sits where the panel puts its thumb.
    const { min, max, step } = THORN_REACH.slider
    const values = new Set<number>()
    for (let k = 0; k <= Math.round((max - min) / step); k++) {
      const position = min + k * step
      const value = reach.fromSlider(position)
      expect(value, `at ${position}`).toBe(reachFromSlider(position))
      expect(reach.toSlider(value)).toBeCloseTo(reachToSlider(value), 12)
      expect(reach.fromSlider(reach.toSlider(value))).toBe(value)
      values.add(value)
    }
    // Every step is a reach of its own, near 0 too, so a row moves the slider from its first step.
    expect(values.size).toBe(Math.round((max - min) / step) + 1)
    expect(reach.fromSlider(step)).toBe(reach.step)
    for (const position of [-1, 2, Number.NaN]) {
      const value = reach.fromSlider(position)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(THORN_REACH.max)
    }
    // Half the travel is an eighth of the canvas diagonal.
    expect(reach.fromSlider(0.5)).toBe(0.125)
  })

  it('have unique ids, and seeds are whole numbers from 0', () => {
    expect(new Set(TARGETS.map((t) => t.id)).size).toBe(TARGETS.length)
    for (const seed of TARGETS.filter((t) => t.kind === 'jump')) expect([seed.min, seed.step], seed.id).toEqual([0, 1])
  })
})

describe('modulate', () => {
  const row = (target: string, depth: number, feature: Mapping['feature'] = 'level'): Mapping => ({
    id: target,
    enabled: true,
    feature,
    target,
    depth,
  })

  it('returns the sliders themselves in silence, with depth 0, or with the row off', () => {
    const mappings = [row('distortion.amount', 1), row('anchors.spacing', -0.5)]
    expect(modulate(BASE, SILENT_FRAME, mappings).params).toBe(BASE)
    expect(
      modulate(
        BASE,
        loud,
        mappings.map((m) => ({ ...m, depth: 0 })),
      ).params,
    ).toBe(BASE)
    expect(
      modulate(
        BASE,
        loud,
        mappings.map((m) => ({ ...m, enabled: false })),
      ).params,
    ).toBe(BASE)
  })

  it('moves a slider by depth times the feature, within its range, on its step', () => {
    const target = targetById('distortion.amount')!
    const { params, positions } = modulate(BASE, { ...loud, level: 0.5 }, [row(target.id, 0.4)])
    const expected = target.fromSlider(target.toSlider(target.get(BASE)) + 0.2)
    expect(target.get(params)).toBeCloseTo(expected, 9)
    expect(positions.get(target.id)).toBeCloseTo(target.toSlider(expected), 9)
    // Past the end of the slider: clamped to it.
    const twice = [
      { ...row(target.id, 1), id: 'a' },
      { ...row(target.id, 1), id: 'b' },
    ]
    expect(target.get(modulate(BASE, loud, twice).params)).toBe(target.max)
    // Other groups stay the same objects.
    expect(params.experimental).toBe(BASE.experimental)
  })

  it('leaves out a target that does not act (its effect is off)', () => {
    expect(targetById('experimental.ripple.amount')!.inactive(BASE)).not.toBeNull()
    expect(modulate(BASE, loud, [row('experimental.ripple.amount', 1)]).params).toBe(BASE)
  })

  it('knows every feature and target the presets use, with at most 8 rows each', () => {
    const features = new Set(FEATURES.map((f) => f.id))
    for (const preset of PRESETS) {
      expect(preset.mappings.length, preset.name).toBeLessThanOrEqual(MAPPING_LIMITS.maxMappings)
      const { params } = presetSettings(BASE, preset)
      for (const m of preset.mappings) {
        expect(features.has(m.feature), `${preset.name}: ${m.feature}`).toBe(true)
        const target = targetById(m.target)
        expect(target, `${preset.name}: ${m.target}`).toBeDefined()
        // After Load, every row acts without switching anything on.
        expect(target!.inactive(params), `${preset.name}: ${m.target}`).toBeNull()
      }
    }
  })
})

describe('modulate with the Response group', () => {
  const row = (target: string, depth: number, feature: Mapping['feature'] = 'level', id = target): Mapping => ({
    id,
    enabled: true,
    feature,
    target,
    depth,
  })
  const response = (patch: Partial<ResponseSettings>): ResponseSettings => ({ ...NEUTRAL_RESPONSE, ...patch })
  /** A grid of sounding frames: every feature at a few values, Melody and Pan included, with and without an onset. */
  const grid: FeatureFrame[] = []
  for (const a of [0, 0.3, 1]) {
    for (const b of [0.05, 0.6]) {
      grid.push({
        ...loud,
        level: a,
        swell: b,
        bass: 1 - a,
        mids: b,
        treble: a * b,
        brightness: b,
        pitch: a,
        melody: b,
        beat: a,
        activity: 1 - b,
        pan: a * 2 - 1,
        onset: a === 1,
      })
    }
  }

  it('is the call without it at the neutral values, for every preset, and the sliders themselves in silence', () => {
    for (const preset of PRESETS) {
      const { params } = presetSettings(BASE, preset)
      const mappings = preset.mappings.map((m, i) => ({ ...m, id: `${preset.id} ${i}` }))
      const seeds = new Map(mappings.filter((m) => targetById(m.target)?.kind === 'jump').map((m) => [m.target, 2]))
      for (const frame of grid) {
        for (const jumps of [undefined, seeds]) {
          expect(modulate(params, frame, mappings, jumps, NEUTRAL_RESPONSE), preset.name).toEqual(
            modulate(params, frame, mappings, jumps),
          )
        }
      }
      expect(modulate(params, SILENT_FRAME, mappings, undefined, NEUTRAL_RESPONSE).params, preset.name).toBe(params)
    }
  })

  it('scales the offset by Strength before it is clamped; 0 keeps the sliders exactly', () => {
    const target = targetById('distortion.amount')!
    const base = target.toSlider(target.get(BASE))
    const frame = { ...loud, level: 0.5 }
    for (const strength of [0.5, 2, 4]) {
      const { params, positions } = modulate(BASE, frame, [row(target.id, 0.1)], undefined, response({ strength }))
      const expected = target.fromSlider(base + 0.05 * strength)
      expect(target.get(params), `Strength ${strength}`).toBeCloseTo(expected, 9)
      expect(positions.get(target.id)).toBeCloseTo(target.toSlider(expected), 9)
    }
    // Past the slider's end it stops there.
    expect(target.get(modulate(BASE, loud, [row(target.id, 0.5)], undefined, response({ strength: 4 })).params)).toBe(
      target.max,
    )
    const still = modulate(
      BASE,
      loud,
      [row(target.id, 1), row('anchors.spacing', -1)],
      undefined,
      response({ strength: 0 }),
    )
    expect(still.params).toBe(BASE)
    expect(still.positions.get(target.id)).toBe(base)
  })

  it('adds the Melody pulse to every slider row but Pan and Melody rows; Melody tracking 0 adds nothing', () => {
    const level = targetById('distortion.amount')!
    const spacing = targetById('anchors.spacing')!
    const squaring = targetById('squaring.amount')!
    const at = (id: string, params: typeof BASE) => targetById(id)!.toSlider(targetById(id)!.get(params))
    const frame = { ...loud, level: 0.2, pan: 0.4, melody: 0.6 }
    const mappings = [row(level.id, 0.5), row(spacing.id, 0.5, 'pan'), row(squaring.id, 0.5, 'melody')]
    const plain = modulate(BASE, frame, mappings)
    expect(modulate(BASE, frame, mappings, undefined, response({ melody: 0 }))).toEqual(plain)

    const melody = 1.5
    const boosted = modulate(BASE, frame, mappings, undefined, response({ melody }))
    const boost = RESPONSE_LIMITS.melodyBoost * melody * 0.6
    expect(at(level.id, boosted.params)).toBeCloseTo(
      level.toSlider(level.fromSlider(at(level.id, BASE) + 0.5 * (0.2 + boost))),
      9,
    )
    // Pan and the Melody row move as without it.
    expect(spacing.get(boosted.params)).toBe(spacing.get(plain.params))
    expect(squaring.get(boosted.params)).toBe(squaring.get(plain.params))
    expect(squaring.get(plain.params)).not.toBe(squaring.get(BASE))
    // The boosted feature caps at 1.
    const capped = modulate(
      BASE,
      { ...frame, level: 0.9, melody: 1 },
      [row(level.id, 0.5)],
      undefined,
      response({ melody: 2 }),
    )
    expect(at(level.id, capped.params)).toBeCloseTo(level.toSlider(level.fromSlider(at(level.id, BASE) + 0.5)), 9)
  })

  it('lists Melody as a Tone feature after Pitch, and reads it from the frame', () => {
    const ids = FEATURES.map((f) => f.id)
    expect(ids.indexOf('melody')).toBe(ids.indexOf('pitch') + 1)
    expect(FEATURES.find((f) => f.id === 'melody')).toMatchObject({ label: 'Melody', group: 'Tone' })
    expect(featureValue({ ...loud, melody: 0.7 }, 'melody')).toBe(0.7)
    expect(featureValue({ ...loud, melody: 3 }, 'melody')).toBe(1)
  })
})
