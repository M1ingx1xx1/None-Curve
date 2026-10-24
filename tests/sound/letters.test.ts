// Letters that react by their own amounts (src/sound/letters.ts): Motion contrast's gain and Pitch reactive's weight
// are exactly neutral at 0, the pitch is placed in the melody's range, the three levels and their hysteresis, the
// level values (each a value the slider could produce), how large a change moving letters between levels is, the
// letter frame handed to the canvas, and the letters of shaped text in the order placePolygons numbers them.

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/paramsKey'
import type { GeometryParams } from '../../src/geometry/types'
import {
  assignLevels,
  buildLetterFrame,
  contrastGain,
  LETTER_LIMITS,
  letterLevels,
  letterSlots,
  lettersOn,
  levelKeyAt,
  levelPosition,
  levelSets,
  NO_SLOTS,
  pitchPlace,
  pitchWeight,
  QUIET,
  sameLetters,
  SHARED,
  STRONG,
  switchSwing,
  type LetterLevels,
  type LetterSlots,
  type LevelSet,
} from '../../src/sound/letters'
import { modulate, targetById, type Mapping } from '../../src/sound/mapping'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame, type ResponseSettings } from '../../src/sound/types'
import { DEFAULT_TEXT } from '../../src/specimen/samples'
import { placePolygons, shapeSpecimen, type SceneLayout } from '../../src/specimen/scene'
import { loadFixture } from '../helpers/fonts'
import { BASE as DEFAULTS } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }
const AMOUNT = targetById('distortion.amount')!
const response = (patch: Partial<ResponseSettings>): ResponseSettings => ({ ...NEUTRAL_RESPONSE, ...patch })

/** Letters by hand: glyph ids, positions across the block, and which are drawn (equal shares of the drawn ones). */
function slotsOf(index: number[], t: number[], active: number[]): LetterSlots {
  const activeCount = active.filter(Boolean).length
  return {
    count: index.length,
    index: Int32Array.from(index),
    t: Float32Array.from(t),
    share: Float32Array.from(active.map((a) => (a ? 1 / activeCount : 0))),
    active: Uint8Array.from(active),
    activeCount,
  }
}

const set = (key: string, positions: Record<string, number>, params: GeometryParams = BASE): LevelSet => ({
  params,
  key,
  positions: new Map(Object.entries(positions)),
})

describe('Motion contrast and Pitch reactive weights', () => {
  it('Motion contrast 0 gives exactly 1 for every letter at every time', () => {
    for (let occurrence = 0; occurrence < 1000; occurrence++) {
      for (let k = 0; k < 10; k++) expect(contrastGain(0, occurrence, k * 1234.5)).toBe(1)
    }
  })

  it('Motion contrast stays within 1/3.6^c and 3.6^c, is the same for the same letter and time, and drifts over time', () => {
    for (const c of [0.25, 0.6, 1]) {
      const low = LETTER_LIMITS.contrastRange ** -c
      const high = LETTER_LIMITS.contrastRange ** c
      for (let occurrence = 0; occurrence < 300; occurrence++) {
        for (const time of [0, 777, 3000, 59_999]) {
          const g = contrastGain(c, occurrence, time)
          expect(g).toBeGreaterThanOrEqual(low - 1e-12)
          expect(g).toBeLessThanOrEqual(high + 1e-12)
          expect(contrastGain(c, occurrence, time)).toBe(g)
        }
      }
    }
    // Half a wave period later, another letter leads.
    const leader = (time: number) => {
      let best = 0
      for (let j = 1; j < 200; j++) if (contrastGain(1, j, time) > contrastGain(1, best, time)) best = j
      return best
    }
    expect(leader(0)).not.toBe(leader(LETTER_LIMITS.wavePeriodMs / 2))
  })

  it('Motion contrast is balanced: as many quiet letters as strong ones, most on the shared level', () => {
    const n = 1000
    const slots = slotsOf(new Array(n).fill(1), new Array(n).fill(0.5), new Array(n).fill(1))
    const r = response({ contrast: 1 })
    const levels = letterLevels(r)!
    const counts = [0, 0, 0]
    for (const time of [0, 1500, 3000, 4500]) for (const level of assignLevels(slots, r, { ...SILENT_FRAME, time }, levels, null)) counts[level]++
    const [quiet, shared, strong] = counts.map((k) => k / (4 * n))
    expect(Math.abs(quiet - strong)).toBeLessThan(0.05)
    expect(quiet).toBeGreaterThan(0.1)
    expect(shared).toBeGreaterThan(0.5)
  })

  it('Pitch reactive is 1 at 0 % or without confidence, peaks at the pitch and is symmetric around it', () => {
    for (const t of [0, 0.3, 0.5, 1]) {
      expect(pitchWeight(0, t, 0.4, 1)).toBe(1)
      expect(pitchWeight(2, t, 0.4, 0)).toBe(1)
    }
    const at = (t: number) => pitchWeight(2, t, 0.4, 1)
    expect(at(0.4)).toBeCloseTo(LETTER_LIMITS.pitchFar + LETTER_LIMITS.pitchPeak, 12)
    for (const d of [0.05, 0.2, 0.35]) {
      expect(at(0.4 + d)).toBeLessThan(at(0.4))
      expect(at(0.4 + d)).toBeCloseTo(at(0.4 - d), 12)
    }
    // Far from the pitch the letters calm down; low confidence weighs less.
    expect(pitchWeight(2, 1, 0, 1)).toBeCloseTo(LETTER_LIMITS.pitchFar, 3)
    expect(pitchWeight(2, 0.4, 0.4, 0.5)).toBeCloseTo(1 + 0.5 * (LETTER_LIMITS.pitchFar + LETTER_LIMITS.pitchPeak - 1), 12)
  })

  it('Pitch reactive places the pitch in the recent melody\'s range: the whole of Pitch without one, clamped at its ends', () => {
    for (const pitch of [0, 0.3, 0.55, 1]) expect(pitchPlace({ ...SILENT_FRAME, pitch })).toBe(pitch)
    const octave = (pitch: number): FeatureFrame => ({ ...SILENT_FRAME, pitch, pitchLow: 0.45, pitchHigh: 0.65 })
    expect(pitchPlace(octave(0.45))).toBe(0)
    expect(pitchPlace(octave(0.55))).toBeCloseTo(0.5, 12)
    expect(pitchPlace(octave(0.65))).toBe(1)
    expect(pitchPlace(octave(0.2))).toBe(0)
    expect(pitchPlace(octave(0.9))).toBe(1)
    // An empty range falls back to the pitch itself.
    expect(pitchPlace({ ...SILENT_FRAME, pitch: 0.3, pitchLow: 0.5, pitchHigh: 0.5 })).toBe(0.3)
  })

  it('a melody\'s low and high notes put the strong letters at either end of the text, quiet ones at the other', () => {
    const n = 41
    const slots = slotsOf([...Array(n)].map((_, j) => j), [...Array(n)].map((_, j) => j / (n - 1)), Array(n).fill(1))
    const r = response({ pitchReactive: 1 })
    const levels = letterLevels(r)!
    const where = (pitch: number, pitchLow = 0.45, pitchHigh = 0.65) => {
      const frame: FeatureFrame = { ...SILENT_FRAME, time: 1000, pitch, pitchConfidence: 1, pitchLow, pitchHigh }
      const assign = assignLevels(slots, r, frame, levels, null)
      const mean = (level: number) => {
        const ts = [...slots.t].filter((_, j) => assign[j] === level)
        return ts.reduce((a, b) => a + b, 0) / ts.length
      }
      return { strong: mean(STRONG), quiet: mean(QUIET) }
    }
    // C4 and C5 an octave apart: one at each end of the text.
    expect(where(0.45).strong).toBeLessThan(0.2)
    expect(where(0.45).quiet).toBeGreaterThan(0.7)
    expect(where(0.65).strong).toBeGreaterThan(0.8)
    expect(where(0.65).quiet).toBeLessThan(0.3)
    expect(where(0.55).strong).toBeCloseTo(0.5, 6)
    // On the whole of Pitch the same octave moves the strong letters a fifth of the way.
    expect(where(0.65, 0, 1).strong - where(0.45, 0, 1).strong).toBeCloseTo(0.2, 1)
  })
})

describe('levels', () => {
  it('none when every letter reacts alike; fixed per setting, capped at 1/16 and 4', () => {
    expect(letterLevels(NEUTRAL_RESPONSE)).toBeNull()
    expect(letterLevels(response({ strength: 3, melody: 2 }))).toBeNull()
    const gains = (r: Partial<ResponseSettings>) => letterLevels(response(r))!.gains
    expect(gains({ contrast: 1 })[0]).toBeCloseTo(1 / 3.6, 12)
    expect(gains({ contrast: 1 })[2]).toBeCloseTo(3.6, 12)
    expect(gains({ pitchReactive: 2 })[0]).toBeCloseTo(0.38, 12)
    expect(gains({ pitchReactive: 2 })[2]).toBeCloseTo(2.33, 12)
    expect(gains({ contrast: 1, pitchReactive: 2 })[0]).toBeCloseTo(0.38 / 3.6, 12)
    expect(gains({ contrast: 1, pitchReactive: 2 })[2]).toBe(LETTER_LIMITS.maxGain)
    // Beyond the slider (contrast 3) the quiet level stops at 1/16.
    expect(gains({ contrast: 3 })[0]).toBe(LETTER_LIMITS.minGain)
    const levels = letterLevels(response({ contrast: 0.5 }))!
    expect(levels.gains[1]).toBe(1)
    expect(levels.edges[0]).toBeCloseTo(Math.log(levels.gains[0]) / 2, 12)
    expect(levels.edges[1]).toBeCloseTo(Math.log(levels.gains[2]) / 2, 12)
    expect(levels.margins[1]).toBeCloseTo(LETTER_LIMITS.hysteresis * levels.edges[1], 12)
  })

  it('a letter keeps its level while its weight wavers 5 % around a boundary, and moves on a 30 % change; inactive letters stay shared', () => {
    // Pitch reactive 200 % with the pitch on the first two letters: the weight is 1 + confidence × (peak − 1).
    const r = response({ pitchReactive: 2 })
    const levels = letterLevels(r)!
    const slots = slotsOf([1, 1, 1], [0.5, 0.5, 0.5], [1, 1, 0])
    const peak = pitchWeight(2, 0.5, 0.5, 1)
    const frameFor = (weight: number): FeatureFrame => ({ ...SILENT_FRAME, time: 1000, pitch: 0.5, pitchConfidence: (weight - 1) / (peak - 1) })
    const boundary = Math.exp(levels.edges[1])
    expect(pitchWeight(2, 0.5, 0.5, frameFor(boundary).pitchConfidence)).toBeCloseTo(boundary, 12)

    // Just over the boundary (strong) and just under it (shared), from a first assignment without hysteresis.
    let strong = assignLevels(slotsOf([1], [0.5], [1]), r, frameFor(boundary * 1.05), levels, null)
    let shared = assignLevels(slotsOf([1], [0.5], [1]), r, frameFor(boundary * 0.95), levels, null)
    expect([strong[0], shared[0]]).toEqual([STRONG, SHARED])
    for (let k = 0; k < 20; k++) {
      const weight = boundary * (k % 2 ? 1.05 : 0.95)
      strong = assignLevels(slotsOf([1], [0.5], [1]), r, frameFor(weight), levels, strong)
      shared = assignLevels(slotsOf([1], [0.5], [1]), r, frameFor(weight), levels, shared)
      expect([strong[0], shared[0]]).toEqual([STRONG, SHARED])
    }
    expect(assignLevels(slotsOf([1], [0.5], [1]), r, frameFor((boundary * 1.05) / 1.3), levels, strong)[0]).toBe(SHARED)
    expect(assignLevels(slotsOf([1], [0.5], [1]), r, frameFor(boundary * 0.95 * 1.3), levels, shared)[0]).toBe(STRONG)

    // The quiet boundary: letters far from the pitch.
    const far = pitchWeight(2, 0, 1, 1)
    const quietFrame = (weight: number): FeatureFrame => ({ ...SILENT_FRAME, time: 1000, pitch: 1, pitchConfidence: (weight - 1) / (far - 1) })
    const low = Math.exp(levels.edges[0])
    let quiet = assignLevels(slotsOf([1], [0], [1]), r, quietFrame(low * 0.95), levels, null)
    expect(quiet[0]).toBe(QUIET)
    for (const weight of [low * 1.05, low * 0.95, low * 1.05]) {
      quiet = assignLevels(slotsOf([1], [0], [1]), r, quietFrame(weight), levels, quiet)
      expect(quiet[0]).toBe(QUIET)
    }
    expect(assignLevels(slotsOf([1], [0], [1]), r, quietFrame(low * 0.95 * 1.3), levels, quiet)[0]).toBe(SHARED)

    // An inactive letter stays shared whatever its weight; `out` is filled in place; another length is no history.
    const out = new Uint8Array(3)
    expect(assignLevels(slots, r, frameFor(peak), levels, null, out)).toBe(out)
    expect([...out]).toEqual([STRONG, STRONG, SHARED])
    expect([...assignLevels(slots, r, frameFor(boundary * 1.05), levels, Uint8Array.of(SHARED, SHARED))]).toEqual([STRONG, STRONG, SHARED])
  })
})

describe('level values', () => {
  it('levelPosition: the identity at gain 1, monotone, on the step grid, kept in the base step, clamped', () => {
    const bp = AMOUNT.toSlider(10)
    expect(levelPosition(AMOUNT, BASE, 0.3, 1)).toBe(0.3)
    expect(levelPosition(AMOUNT, BASE, bp, 3.6)).toBe(bp)
    // 0.05 + 2.33 × 0.15 = 0.3995: 79.9 steps, snapped to 80.
    expect(levelPosition(AMOUNT, BASE, 0.2, 2.33)).toBe(AMOUNT.toSlider(80))
    // Clamped at both ends.
    expect(levelPosition(AMOUNT, BASE, 0.5, 4)).toBe(1)
    expect(levelPosition(AMOUNT, BASE, 0, 4)).toBe(0)
    // A value between steps (10.4): a level within its step keeps it exactly.
    const between: GeometryParams = { ...BASE, distortion: { ...BASE.distortion, amount: 10.4 } }
    const bpBetween = AMOUNT.toSlider(10.4)
    expect(levelPosition(AMOUNT, between, AMOUNT.toSlider(11), 0.1)).toBe(bpBetween)
    expect(levelPosition(AMOUNT, between, AMOUNT.toSlider(14), 0.5)).toBe(AMOUNT.toSlider(12))
    for (const gain of [1 / 16, 0.278, 0.38, 2.33, 3.6, 4]) {
      let last = -Infinity
      for (let k = 0; k <= 200; k++) {
        const position = levelPosition(AMOUNT, BASE, k / 200, gain)
        expect(position).toBeGreaterThanOrEqual(last)
        last = position
        // A value the slider produces: a whole step, or the base value itself.
        const steps = position * 200
        expect(position === bp || Math.abs(steps - Math.round(steps)) < 1e-9).toBe(true)
      }
    }
  })

  it('levelSets: the shared set is the shared values; the others scale every driven slider and keep the seeds', () => {
    const mappings: Mapping[] = [
      { id: 'a', enabled: true, feature: 'level', target: 'distortion.amount', depth: 0.5 },
      { id: 'b', enabled: true, feature: 'level', target: 'squaring.amount', depth: 0.4 },
      { id: 'c', enabled: true, feature: 'beat', target: 'distortion.seed', depth: 1 },
    ]
    const shared = modulate(BASE, { ...SILENT_FRAME, time: 100, level: 0.5, silent: false, levelDb: -20 }, mappings, new Map([['distortion.seed', 2]]))
    const levels = letterLevels(response({ contrast: 1 }))!
    const keys: GeometryParams[] = []
    const keyOf = (p: GeometryParams) => {
      keys.push(p)
      return paramsKey(p)
    }
    const [quiet, middle, strong] = levelSets(BASE, shared, levels, keyOf)
    expect(middle.params).toBe(shared.params)
    expect(middle.positions).toBe(shared.positions)
    expect(middle.key).toBe(paramsKey(shared.params))
    for (const level of [quiet, strong]) {
      expect(level.key).toBe(paramsKey(level.params))
      expect(level.params.distortion.seed).toBe(shared.params.distortion.seed)
      expect(level.params.experimental).toBe(shared.params.experimental)
      for (const [id, position] of shared.positions) {
        const spec = targetById(id)!
        expect(level.positions.get(id)).toBe(levelPosition(spec, BASE, position, level === quiet ? levels.gains[0] : levels.gains[2]))
        expect(spec.toSlider(spec.get(level.params))).toBeCloseTo(level.positions.get(id)!, 12)
      }
    }
    expect(quiet.params.distortion.amount).toBeLessThan(shared.params.distortion.amount)
    expect(strong.params.distortion.amount).toBeGreaterThan(shared.params.distortion.amount)
    expect(strong.params.squaring.amount).toBeGreaterThan(shared.params.squaring.amount)

    // Gain 1, or shared values still on the sliders' own: the shared set itself.
    const flat: LetterLevels = { gains: [1, 1, 1], edges: [0, 0], margins: [0, 0] }
    const same = levelSets(BASE, shared, flat, paramsKey)
    expect(same[0]).toBe(same[1])
    expect(same[2]).toBe(same[1])
    const still = modulate(BASE, { ...SILENT_FRAME, time: 100 }, mappings.slice(0, 2))
    expect(still.params).toBe(BASE)
    const atBase = levelSets(BASE, still, levels, paramsKey)
    expect(atBase[0]).toBe(atBase[1])
    expect(atBase[2]).toBe(atBase[1])
  })
})

describe('switches between levels', () => {
  const sets = [set('Q', { a: 0.2, b: 0.5 }), set('S', { a: 0.3, b: 0.5 }), set('T', { a: 0.6, b: 0.7 })] as const
  // Apart: quiet–shared 0.1, shared–strong 0.5, quiet–strong 0.6.

  it('switchSwing weighs each letter that changes level by its share and how far apart the two levels are', () => {
    const slots = slotsOf([1, 2, 3, 4, 5], [0, 0.25, 0.5, 0.75, 1], [1, 1, 1, 1, 0])
    expect(switchSwing(null, Uint8Array.of(0, 1, 2, 1, 1), slots, sets)).toBe(0)
    expect(switchSwing(Uint8Array.of(1, 1), Uint8Array.of(0, 1, 2, 1, 1), slots, sets)).toBe(0)
    const before = Uint8Array.of(SHARED, SHARED, QUIET, STRONG, SHARED)
    expect(switchSwing(before, before, slots, sets)).toBe(0)
    // Letter 0: shared → quiet (0.1); letter 2: quiet → strong (0.6); letter 3: strong → shared (0.5); letter 4 is inactive.
    const after = Uint8Array.of(QUIET, SHARED, STRONG, SHARED, STRONG)
    expect(switchSwing(before, after, slots, sets)).toBeCloseTo(0.25 * (0.1 + 0.6 + 0.5), 6)
    expect(switchSwing(after, before, slots, sets)).toBeCloseTo(0.25 * (0.1 + 0.6 + 0.5), 6)
  })

  it('buildLetterFrame folds levels equal to the shared one, asks for strong then quiet glyphs once each, and keys the whole frame', () => {
    // Glyph ids by occurrence; the third is a space.
    const slots = slotsOf([5, 7, 3, 5, 9, 7], [0, 0.2, 0.4, 0.6, 0.8, 1], [1, 1, 0, 1, 1, 1])
    const assign = Uint8Array.of(STRONG, QUIET, STRONG, STRONG, STRONG, QUIET)
    const frame = buildLetterFrame(sets, assign, slots, 'S')!
    expect([...frame.assign]).toEqual([STRONG, QUIET, SHARED, STRONG, STRONG, QUIET])
    expect(frame.keys).toEqual(['Q', 'S', 'T'])
    expect(frame.jobs.map((job) => [job.key, job.indices])).toEqual([
      ['T', [5, 9]],
      ['Q', [7]],
    ])
    expect(frame.jobs[0].params).toBe(sets[2].params)
    expect(frame.slots).toBe(slots)
    expect(frame.key.startsWith('S\u001fQ\u001fT\u001f')).toBe(true)
    expect(frame.key.endsWith(':201220')).toBe(true)
    // The same letters of another text (or the same text set differently): another key.
    const again = slotsOf([5, 7, 3, 5, 9, 7], [0, 0.2, 0.4, 0.6, 0.8, 1], [1, 1, 0, 1, 1, 1])
    expect(buildLetterFrame(sets, assign, again, 'S')!.key).not.toBe(frame.key)
    expect(buildLetterFrame(sets, assign, slots, 'S')!.key).toBe(frame.key)

    // A quiet level that is the shared one folds away: only the strong job, no quiet key.
    const folded = buildLetterFrame([set('S', {}), sets[1], sets[2]], assign, slots, 'S')!
    expect([...folded.assign]).toEqual([STRONG, SHARED, SHARED, STRONG, STRONG, SHARED])
    expect(folded.keys).toEqual(['', 'S', 'T'])
    expect(folded.jobs.map((job) => job.key)).toEqual(['T'])
    // Nothing off the shared level: no frame.
    expect(buildLetterFrame([set('S', {}), sets[1], set('S', {})], assign, slots, 'S')).toBeNull()
    expect(buildLetterFrame(sets, new Uint8Array(6).fill(SHARED), slots, 'S')).toBeNull()

    // What each occurrence shows.
    expect([0, 1, 2, 4].map((k) => levelKeyAt(frame, k, 'S'))).toEqual(['T', 'Q', 'S', 'T'])
    expect(levelKeyAt(null, 0, 'S')).toBe('S')
    // The same letters set differently keep the frame; other letters (another glyph, another count, a letter drawn
    // or not) do not.
    expect(sameLetters(again, slots)).toBe(true)
    expect(lettersOn(frame, again)).toBe(frame)
    expect(lettersOn(frame, slotsOf([5, 7, 3, 5, 9, 8], [0, 0.2, 0.4, 0.6, 0.8, 1], [1, 1, 0, 1, 1, 1]))).toBeNull()
    expect(lettersOn(frame, slotsOf([5, 7, 3, 5, 9], [0, 0.2, 0.4, 0.6, 0.8], [1, 1, 0, 1, 1]))).toBeNull()
    expect(lettersOn(frame, slotsOf([5, 7, 3, 5, 9, 7], [0, 0.2, 0.4, 0.6, 0.8, 1], [1, 1, 1, 1, 1, 1]))).toBeNull()
    expect(lettersOn(null, slots)).toBeNull()
  })
})

describe('letterSlots', async () => {
  const font = await loadFixture('Roboto')

  it.each(['left', 'center', 'right'] as const)('%s: t runs from 0 to 1 across the block, in reading order', (align) => {
    const shaped = shapeSpecimen(font, DEFAULT_TEXT, { tracking: 0, lineHeight: 1, align, slant: 0 })
    const slots = letterSlots(shaped)
    expect(letterSlots(shaped)).toBe(slots)
    expect(slots.count).toBe(shaped.glyphCount)
    let j = 0
    const lines = shaped.lines.map((line) => {
      const ts = line.glyphs.map(() => slots.t[j++])
      for (let k = 1; k < ts.length; k++) expect(ts[k]).toBeGreaterThanOrEqual(ts[k - 1])
      return ts
    })
    const longest = shaped.lines.reduce((best, line, k) => (line.width > shaped.lines[best].width ? k : best), 0)
    expect(lines[longest][0]).toBeLessThan(0.03)
    expect(lines[longest][lines[longest].length - 1]).toBeGreaterThan(0.97)
    for (const ts of lines) {
      const first = ts[0]
      const last = ts[ts.length - 1]
      if (align === 'left') expect(first).toBeLessThan(0.03)
      if (align === 'right') expect(last).toBeGreaterThan(0.97)
      if (align === 'center') expect((first + last) / 2).toBeCloseTo(0.5, 1)
    }
  })

  it('shares sum to 1 over the drawn letters; spaces and missing glyphs are inactive; the order is placePolygons\'', () => {
    const shaped = shapeSpecimen(font, 'Ab c\n\nd\u{1F600}e')
    const slots = letterSlots(shaped)
    const flat = shaped.lines.flatMap((line) => line.glyphs)
    expect([...slots.active]).toEqual([1, 1, 0, 1, 1, 0, 1])
    expect(slots.activeCount).toBe(5)
    expect([...slots.share].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    expect(slots.share[2]).toBe(0)
    expect(slots.share[5]).toBe(0)
    flat.forEach((g, k) => {
      expect(slots.index[k]).toBe(g.index)
      if (slots.active[k]) expect(slots.share[k]).toBeCloseTo(g.advance / [0, 1, 3, 4, 6].reduce((s, i) => s + flat[i].advance, 0), 6)
    })
    const placed: [number, number][] = []
    placePolygons(shaped, (index, occurrence) => {
      placed.push([index, occurrence])
      return null
    })
    for (const [index, occurrence] of placed) expect(slots.index[occurrence]).toBe(index)

    const lorem = letterSlots(shapeSpecimen(font, DEFAULT_TEXT))
    expect([...lorem.share].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    expect(NO_SLOTS.count).toBe(0)
  })

  it('a frame assigned before a typography change still shows its levels on the restyled text (as useGeometry places it)', () => {
    const plain: SceneLayout = { tracking: 0, lineHeight: 1, align: 'left', slant: 0 }
    const before = letterSlots(shapeSpecimen(font, DEFAULT_TEXT, plain))
    // Strong letters for the first half of the text, quiet ones for the rest.
    const assign = new Uint8Array(before.count).map((_, j) => (j < before.count / 2 ? STRONG : QUIET))
    const shared = modulate(BASE, { ...SILENT_FRAME, time: 1000, silent: false, levelDb: -20, level: 0.8 }, [
      { id: 'a', enabled: true, feature: 'level', target: AMOUNT.id, depth: 0.5 },
    ])
    const sets = levelSets(BASE, shared, letterLevels(response({ contrast: 1 }))!, paramsKey)
    const sharedKey = sets[SHARED].key
    const frame = buildLetterFrame(sets, assign, before, sharedKey)!
    const keysOn = (layout: SceneLayout, text = DEFAULT_TEXT) => {
      const shaped = shapeSpecimen(font, text, layout)
      const letters = lettersOn(frame, letterSlots(shaped))
      const keys: string[] = []
      placePolygons(shaped, (_index, occurrence) => {
        keys.push(levelKeyAt(letters, occurrence, sharedKey))
        return null
      })
      return keys
    }
    const shown = keysOn(plain)
    expect(new Set(shown)).toEqual(new Set([sets[QUIET].key, sharedKey, sets[STRONG].key]))
    // Tracking, line height, alignment and slant: new slots, the same letters on the same levels.
    const restyled: SceneLayout[] = [
      { ...plain, tracking: 120 },
      { ...plain, lineHeight: 1.6 },
      { ...plain, align: 'right' },
      { ...plain, slant: 12 },
    ]
    for (const layout of restyled) {
      expect(letterSlots(shapeSpecimen(font, DEFAULT_TEXT, layout))).not.toBe(before)
      expect(keysOn(layout)).toEqual(shown)
    }
    // A text edit: every letter waits on the shared level for the next frame.
    expect(new Set(keysOn(plain, `${DEFAULT_TEXT}!`))).toEqual(new Set([sharedKey]))
  })
})
