// The flash limit (WCAG 2.3.1; src/sound/flash.ts): at most 3 flashes, so 6 large changes, in any second, however
// many sliders and seeds Sound drives. Square-wave features at 4 Hz, 60 frames a second, for 10 s, through the
// sliders' FlashLimiter and the seeds' JumpTracker sharing one FlashBudget, and through the whole LiveScheduler on a
// fake clock (what reaches the screen). Large changes are counted independently of the limiter. With letters on
// their own levels (Motion contrast, Pitch reactive) the limit holds for every letter on screen: each level's turns
// and letters moving between levels count. A melody heard through FeatureExtractor moves the strong letters across
// the text with its notes, within the limit.

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/cache'
import type { GeometryParams } from '../../src/geometry/types'
import { edgesFit, FLASH_LIMITS, FlashBudget } from '../../src/sound/flash'
import { JumpTracker } from '../../src/sound/jumps'
import { assignLevels, letterLevels, letterSlots, levelPosition, levelSets, STRONG, switchSwing, type LetterSlots } from '../../src/sound/letters'
import { FlashLimiter, LiveScheduler, type LevelSpread, type LiveDeps } from '../../src/sound/live'
import { modulate, targetById, type Mapping, type Modulated } from '../../src/sound/mapping'
import { NEUTRAL_RESPONSE, SILENT_FRAME, SOUND_LIMITS, type FeatureFrame, type ResponseSettings } from '../../src/sound/types'
import { DEFAULT_TEXT } from '../../src/specimen/samples'
import { shapeSpecimen } from '../../src/specimen/scene'
import { analyse, notes } from '../helpers/audio'
import { loadFixture } from '../helpers/fonts'
import { BASE as DEFAULTS } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }
const SLIDERS = ['squaring.amount', 'anchors.spacing', 'distortion.amount', 'anchors.simplify', 'distortion.normalBias']
const FEATURES = ['bass', 'mids', 'treble', 'brightness', 'activity'] as const
const SEED = 'distortion.seed'
const MOST = 2 * FLASH_LIMITS.maxFlashes
/** Letters moving between levels over the frames shown within this long (ms) make one change on screen (lettersOnScreen). */
const SPREAD_MS = 250
const FRAME_MS = 1000 / 60

interface Case {
  name: string
  sliders: number
  seed: boolean
  depth: number
  /** The sliders' features out of phase with each other. */
  phased: boolean
}

const CASES: Case[] = [
  { name: 'one slider', sliders: 1, seed: false, depth: 1, phased: false },
  { name: 'three sliders in phase', sliders: 3, seed: false, depth: 1, phased: false },
  { name: 'three sliders out of phase', sliders: 3, seed: false, depth: 1, phased: true },
  { name: 'five sliders out of phase', sliders: 5, seed: false, depth: 1, phased: true },
  { name: 'a Beat seed alone (4 beats a second)', sliders: 0, seed: true, depth: 1, phased: false },
  { name: 'three sliders out of phase and a Beat seed', sliders: 3, seed: true, depth: 1, phased: true },
  { name: 'five sliders out of phase and a Beat seed', sliders: 5, seed: true, depth: 1, phased: true },
  { name: 'five sliders in phase, 4% each', sliders: 5, seed: false, depth: 0.04, phased: false },
  { name: 'five sliders in phase, 4% each, and a Beat seed', sliders: 5, seed: true, depth: 0.04, phased: false },
]

const mappingsOf = (c: Case): Mapping[] => [
  ...SLIDERS.slice(0, c.sliders).map((target, i) => ({ id: `m${i}`, enabled: true, feature: FEATURES[i], target, depth: c.depth })),
  ...(c.seed ? [{ id: 'seed', enabled: true, feature: 'beat' as const, target: SEED, depth: 1 }] : []),
]

function frameAt(c: Case, t: number): FeatureFrame {
  const frame: FeatureFrame = { ...SILENT_FRAME, time: t, silent: false, levelDb: -20, level: 0.5 }
  for (let i = 0; i < c.sliders; i++) {
    ;(frame as unknown as Record<string, number>)[FEATURES[i]] = Math.sin(2 * Math.PI * ((4 * t) / 1000 - (c.phased ? i / c.sliders : 0))) >= 0 ? 1 : 0
  }
  frame.onset = Math.floor(t / 250) !== Math.floor((t - FRAME_MS) / 250)
  frame.beat = frame.onset ? 1 : 0
  return frame
}

/**
 * Times of large changes in a sequence of shown states: a slider turning back by a swing of its travel, the sliders'
 * moves back adding up to a swing together, or the seed changing.
 */
function changeCounter() {
  const swing = FLASH_LIMITS.swing - 1e-9
  const one = new Map<string, { dir: number; extreme: number }>()
  const all = new Map<string, { dir: number; extreme: number }>()
  let lastSeed: number | undefined
  const times: number[] = []
  const follow = (state: { dir: number; extreme: number }, p: number) => {
    if ((state.dir > 0 && p > state.extreme) || (state.dir < 0 && p < state.extreme)) state.extreme = p
  }
  return {
    times,
    see(t: number, positions: ReadonlyMap<string, number>, seed: number | undefined) {
      let turned = false
      for (const [id, p] of positions) {
        const state = one.get(id)
        if (!state) {
          one.set(id, { dir: 0, extreme: p })
          continue
        }
        const turn = state.dir >= 0 && p <= state.extreme - swing ? -1 : state.dir <= 0 && p >= state.extreme + swing ? 1 : 0
        if (turn) [state.dir, state.extreme, turned] = [turn, p, true]
        else follow(state, p)
      }
      let back = 0
      const moving = new Set<string>()
      for (const [id, p] of positions) {
        const state = all.get(id)
        if (!state) continue
        const amount = state.dir > 0 ? state.extreme - p : state.dir < 0 ? p - state.extreme : Math.abs(p - state.extreme)
        if (amount > 0) {
          moving.add(id)
          back += amount
        }
      }
      const together = back >= swing
      for (const [id, p] of positions) {
        const state = all.get(id)
        if (!state) all.set(id, { dir: 0, extreme: p })
        else if (together && moving.has(id)) [state.dir, state.extreme] = [p > state.extreme ? 1 : -1, p]
        else follow(state, p)
      }
      const seedChanged = seed !== undefined && lastSeed !== undefined && seed !== lastSeed
      lastSeed = seed
      if (turned || together || seedChanged) times.push(t)
    },
  }
}

/** The most changes within any `window` ms. */
function mostWithin(times: readonly number[], window: number): number {
  let most = 0
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] >= window) j++
    most = Math.max(most, i - j + 1)
  }
  return most
}

const positionsOf = (params: GeometryParams, c: Case) =>
  new Map(SLIDERS.slice(0, c.sliders).map((id) => [id, targetById(id)!.toSlider(targetById(id)!.get(params))]))

/** Without any limit: what the features alone would show (the seed jumping on every beat). */
function unlimited(c: Case): number[] {
  const counter = changeCounter()
  let beats = 0
  for (let t = FRAME_MS; t <= 10_000; t += FRAME_MS) {
    const frame = frameAt(c, t)
    if (frame.onset) beats++
    const params = modulate(BASE, frame, mappingsOf(c), new Map(c.seed ? [[SEED, beats]] : [])).params
    counter.see(t, positionsOf(params, c), c.seed ? params.distortion.seed : undefined)
  }
  return counter.times
}

/** The limiter and the jumps sharing one budget, frame by frame; `shown` hears each frame's limited values. */
function limited(c: Case, spread?: LevelSpread, shown?: (out: { modulated: Modulated; holds: ReadonlyMap<string, number> | null }) => void): number[] {
  const mappings = mappingsOf(c)
  const budget = new FlashBudget()
  const limiter = new FlashLimiter(budget)
  const jumps = new JumpTracker(budget)
  const counter = changeCounter()
  for (let t = FRAME_MS; t <= 10_000; t += FRAME_MS) {
    const frame = frameAt(c, t)
    const seeds = c.seed ? jumps.advance(frame, mappings, BASE) : new Map<string, number>()
    const out = limiter.limit(modulate(BASE, frame, mappings, seeds), t, spread)
    shown?.(out)
    counter.see(t, out.modulated.positions, out.modulated.seeds.get(SEED))
  }
  return counter.times
}

/** Through the live scheduler on a fake clock: each frame's glyphs take 5 ms, its render 1 ms; counted as committed. */
function onScreen(c: Case): number[] {
  let now = 0
  let computing = false
  const timers: { at: number; run: () => void }[] = []
  const later = (ms: number, run: () => void) => timers.push({ at: now + ms, run })
  const counter = changeCounter()
  const deps: LiveDeps = {
    now: () => now,
    sourceRunning: () => true,
    isComputing: () => computing,
    request: () => {
      computing = true
      later(5, () => {
        computing = false
        live.idle()
      })
      return true
    },
    commit: (commit) => {
      const params = commit?.params ?? BASE
      counter.see(now, positionsOf(params, c), c.seed ? params.distortion.seed : undefined)
      if (commit) later(1, () => live.rendered(commit.seq))
    },
    pauseSound: () => {},
    setTimer: (run, ms) => {
      later(ms, run)
      return 0
    },
    clearTimer: () => {},
  }
  const live = new LiveScheduler(deps)
  live.setBase(BASE)
  live.setMappings(mappingsOf(c), true)
  for (let t = FRAME_MS; t <= 10_000; t += FRAME_MS) {
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > t) break
      timers.shift()
      now = Math.max(now, next.at)
      next.run()
    }
    now = t
    live.setFrame(frameAt(c, t))
  }
  return counter.times
}

describe('flash limit', () => {
  it.each(CASES)('$name: at most 6 large changes in any second, and still moving', (c) => {
    const raw = mostWithin(unlimited(c), 1000)
    const sliders = limited(c)
    const screen = onScreen(c)
    // With a slider, the features ask for more than the limit allows (a seed alone jumps 4 times a second).
    if (c.sliders > 0) expect(raw).toBeGreaterThan(MOST)
    expect(mostWithin(sliders, 1000)).toBeLessThanOrEqual(MOST)
    expect(mostWithin(sliders, FLASH_LIMITS.windowMs)).toBeLessThanOrEqual(MOST)
    expect(mostWithin(screen, 1000)).toBeLessThanOrEqual(MOST)
    // The letters still move with the music: at least 4 large changes a second get through.
    expect(mostWithin(sliders, 1000)).toBeGreaterThanOrEqual(Math.min(4, raw))
    expect(mostWithin(screen, 1000)).toBeGreaterThanOrEqual(Math.min(4, raw))
  })
})

const AMOUNT = targetById('distortion.amount')!

/** One driven slider (Noise amplitude, base 10) at `position`, as modulate gives it. */
function amountAt(position: number): Modulated {
  const value = AMOUNT.fromSlider(position)
  return { params: AMOUNT.set(BASE, value), positions: new Map([[AMOUNT.id, AMOUNT.toSlider(value)]]), seeds: new Map() }
}

/** Whether a move of Noise amplitude from `from` back to `to` is held while the budget is spent: an edge. */
function heldBack(from: number, to: number, gains?: readonly number[]): boolean {
  const budget = new FlashBudget()
  for (let k = 0; k < MOST; k++) budget.spend(k * 10)
  const limiter = new FlashLimiter(budget)
  limiter.limit(amountAt(from), 100, gains && { base: BASE, gains })
  const out = limiter.limit(amountAt(to), 117, gains && { base: BASE, gains })
  return out.holds !== null
}

describe('flash limit with letters on other levels', async () => {
  const font = await loadFixture('Roboto')
  const slots = letterSlots(shapeSpecimen(font, DEFAULT_TEXT))
  const response = (patch: Partial<ResponseSettings>): ResponseSettings => ({ ...NEUTRAL_RESPONSE, ...patch })
  const level = (depth: number) => [{ id: 'a', enabled: true, feature: 'level' as const, target: AMOUNT.id, depth }]
  const steady = (t: number, pitch = 0.5): FeatureFrame => ({ ...SILENT_FRAME, time: t, level: 0.8, silent: false, levelDb: -20, pitch, pitchConfidence: 1 })

  it.each(CASES)('$name: no levels (an empty spread) is the shared limit exactly', (c) => {
    const plain: string[] = []
    const empty: string[] = []
    const record = (into: string[]) => (out: { modulated: Modulated; holds: ReadonlyMap<string, number> | null }) =>
      into.push(`${paramsKey(out.modulated.params)}|${JSON.stringify([...out.modulated.positions])}|${JSON.stringify([...(out.holds ?? [])])}`)
    expect(limited(c, { base: BASE, gains: [] }, record(empty))).toEqual(limited(c, undefined, record(plain)))
    expect(empty).toEqual(plain)
  })

  it('a slider\'s move back is the largest over the levels letters show, clamped at the slider\'s ends', () => {
    // Noise amplitude 0.2 → 0.15 (40 → 30): 0.05 back on the shared level, under a swing.
    expect(heldBack(0.2, 0.15)).toBe(false)
    // The strong level (2.33) moves back 0.4 → 0.285: an edge. The quiet level (0.38) alone moves 0.015: none.
    expect(levelPosition(AMOUNT, BASE, 0.2, 2.33) - levelPosition(AMOUNT, BASE, 0.15, 2.33)).toBeCloseTo(0.115, 9)
    expect(heldBack(0.2, 0.15, [2.33])).toBe(true)
    expect(heldBack(0.2, 0.15, [0.38])).toBe(false)
    expect(heldBack(0.2, 0.15, [0.38, 2.33])).toBe(true)
    // Clamped: at gain 4 both 0.4 and 0.35 put the strong level at the slider's end, so it does not move back;
    // at 2.5 it moves 0.925 → 0.8.
    expect(levelPosition(AMOUNT, BASE, 0.4, 4)).toBe(1)
    expect(levelPosition(AMOUNT, BASE, 0.35, 4)).toBe(1)
    expect(heldBack(0.4, 0.35, [4])).toBe(false)
    expect(heldBack(0.4, 0.35, [2.5])).toBe(true)
  })

  it.each([
    [1, 0],
    [0.3, 0],
    [1, 2],
  ])('Motion contrast %s with Pitch reactive %s: the drift alone never makes an edge, at 60 or 20 frames a second', (contrast, pitchReactive) => {
    const r = response({ contrast, pitchReactive })
    const levels = letterLevels(r)!
    for (const depth of [0.25, 0.5, 1]) {
      for (const fps of [60, 20]) {
        let shown: Uint8Array | null = null
        let most = 0
        let moves = 0
        for (let t = 1000; t < 13_000; t += 1000 / fps) {
          const frame = steady(t)
          const shared = modulate(BASE, frame, level(depth))
          const wanted = assignLevels(slots, r, frame, levels, shown)
          if (shown && wanted.some((l, j) => l !== shown![j])) moves++
          most = Math.max(most, switchSwing(shown, wanted, slots, levelSets(BASE, shared, levels, paramsKey)))
          shown = wanted
        }
        // Letters do move between levels, a few at a time.
        expect(moves).toBeGreaterThan(20)
        expect(most).toBeLessThan(FLASH_LIMITS.swing)
      }
    }
  })

  it('the pitch moving an octave at Pitch reactive 200 % moves half the text: an edge', () => {
    const r = response({ pitchReactive: 2 })
    const levels = letterLevels(r)!
    const shared = modulate(BASE, steady(1000, 0.4), level(0.25))
    // Σ = 0.2 of the slider's travel.
    expect(shared.positions.get(AMOUNT.id)! - AMOUNT.toSlider(10)).toBeCloseTo(0.2, 9)
    const before = assignLevels(slots, r, steady(1000, 0.4), levels, null)
    const after = assignLevels(slots, r, steady(1017, 0.6), levels, before)
    let moved = 0
    for (let j = 0; j < slots.count; j++) if (before[j] !== after[j]) moved += slots.share[j]
    expect(moved).toBeGreaterThan(0.5)
    expect(switchSwing(before, after, slots, levelSets(BASE, shared, levels, paramsKey))).toBeGreaterThanOrEqual(FLASH_LIMITS.swing)
  })

  // The last case moves the shared slider by 6 % of its travel (under a swing), but the strong letters by four times that.
  const SMALL: Case = { name: 'one slider at 1.5 %', sliders: 1, seed: false, depth: 0.015, phased: false }

  it.each([...CASES, SMALL])('$name, at Strength 400 %, Motion contrast 100 %, Pitch reactive 200 % and an octave at 6 Hz: every letter on screen keeps to the limit', (c) => {
    const { times, turns } = lettersOnScreen(c, slots, shapeSpecimen(font, DEFAULT_TEXT).indices)
    expect(mostWithin(times, 1000)).toBeLessThanOrEqual(MOST)
    // Still moving with the music.
    expect(mostWithin(times, 1000)).toBeGreaterThanOrEqual(4)
    if (c === SMALL) {
      // Only the strong level swings: the shared values alone would never count.
      expect(turns[1]).toBe(0)
      expect(turns[2]).toBeGreaterThan(20)
    }
  })

  // Updates come every animation frame, frames reach the screen at most 30 times a second (fewer while the glyphs
  // take long): a move between levels split over several updates still counts once it shows.
  it.each([
    { fps: 120, computeMs: 5 },
    { fps: 60, computeMs: 100 },
    { fps: 120, computeMs: 100 },
  ])('an octave at 6 Hz, updates at $fps a second, $computeMs ms per frame: every letter on screen keeps to the limit', (run) => {
    const indices = shapeSpecimen(font, DEFAULT_TEXT).indices
    for (const c of [CASES[0], CASES[5]]) {
      const { times, switches } = lettersOnScreen(c, slots, indices, run)
      expect(mostWithin(times, 1000)).toBeLessThanOrEqual(MOST)
      // With one slider, letters do move between levels on screen in large steps (with more, the budget can all go
      // to the sliders and the seed).
      if (c === CASES[0]) expect(switches).toBeGreaterThan(0)
    }
  })

  it.each([{ fps: 60 }, { fps: 120 }])('Pitch reactive 200 % alone, a steady slider and the pitch gliding over two octaves at 2 and 3 Hz, $fps updates a second: letters moving between levels keep to the limit', ({ fps }) => {
    const indices = shapeSpecimen(font, DEFAULT_TEXT).indices
    // Noise amplitude (the third of SLIDERS, counted on screen) on a steady Level, 0.4 of its travel up: only the
    // letters' levels move.
    const steadySlider: Case = { name: 'a steady slider', sliders: 3, seed: false, depth: 0, phased: false }
    for (const hz of [2, 3]) {
      const glide = (t: number) => {
        const phase = ((t * hz) / 1000) % 1
        return 0.3 + 0.4 * (phase < 0.5 ? 2 * phase : 2 - 2 * phase)
      }
      const { times, switches } = lettersOnScreen(steadySlider, slots, indices, {
        fps,
        computeMs: 5,
        pitch: glide,
        response: { ...NEUTRAL_RESPONSE, pitchReactive: 2 },
        mappings: level(0.8),
      })
      expect(mostWithin(times, 1000)).toBeLessThanOrEqual(MOST)
      expect(switches).toBeGreaterThan(0)
    }
  })

  // Pitch reactive places the pitch in the recent melody's range: an octave that is the whole range moves the strong
  // letters from one end of the text to the other.
  it.each([
    { fps: 60, computeMs: 5 },
    { fps: 120, computeMs: 100 },
  ])('an octave at 6 Hz that is the whole melody range, $fps updates a second, $computeMs ms per frame: every letter on screen keeps to the limit', (run) => {
    const indices = shapeSpecimen(font, DEFAULT_TEXT).indices
    for (const c of [CASES[0], CASES[5], SMALL]) {
      const { times, switches } = lettersOnScreen(c, slots, indices, { ...run, range: [0.4, 0.6] })
      expect(mostWithin(times, 1000)).toBeLessThanOrEqual(MOST)
      // With one slider, the letters' moves across the text show as large steps (see the default range above).
      if (c === CASES[0]) expect(switches).toBeGreaterThan(0)
    }
  })

  describe('a melody heard through FeatureExtractor', () => {
    const indices = shapeSpecimen(font, DEFAULT_TEXT).indices
    const C4 = 261.63
    const C5 = 523.25
    const A2 = 110
    // Level → Noise amplitude 60 % and Brightness → Noise frequency 30 %, 40 ms per frame's glyphs.
    const MELODY: Case = { name: 'a melody', sliders: 0, seed: false, depth: 0, phased: false }
    const play = (frames: readonly FeatureFrame[], pitchReactive: number) =>
      lettersOnScreen(MELODY, slots, indices, {
        fps: 60,
        computeMs: 40,
        frames,
        response: response({ pitchReactive }),
        mappings: [
          { id: 'a', enabled: true, feature: 'level', target: AMOUNT.id, depth: 0.6 },
          { id: 'b', enabled: true, feature: 'brightness', target: 'distortion.frequency', depth: 0.3 },
        ],
        targets: [AMOUNT.id, 'distortion.frequency'],
      })
    /** Where across the text (0 to 1) the strong letters shown at the end of each `stepMs` note sit, on average. */
    const strongAt = (shown: { time: number; assign: Uint8Array }[], count: number, stepMs: number) =>
      [...Array(count)].map((_, k) => {
        const last = shown.filter((s) => s.time < (k + 1) * stepMs).at(-1)
        let sum = 0
        let n = 0
        for (let j = 0; j < slots.count; j++) {
          if (slots.active[j] && last?.assign[j] === STRONG) {
            sum += slots.t[j]
            n++
          }
        }
        return n ? sum / n : NaN
      })

    // At 200 % each move across the text is larger, and the frames on which the analysis window spans both notes
    // show a step on the way: the budget lets most notes through, not all.
    it.each([
      { pitchReactive: 1, followed: 1 },
      { pitchReactive: 2, followed: 0.8 },
    ])('notes an octave apart (C4, C5, 500 ms each) at Pitch reactive $pitchReactive: the strong letters cross the text with every note, within the limit', ({ pitchReactive, followed }) => {
      const frames = analyse(notes([...Array(12)].map((_, k) => (k % 2 ? C5 : C4)), 500, -12))
      const { times, shown } = play(frames, pitchReactive)
      const at = strongAt(shown, 12, 500)
      // From the second note on, at each note's end: C4's on the left, C5's on the right.
      const placed = at.slice(1).filter((t, k) => ((k + 1) % 2 ? t > 0.65 : t < 0.35))
      expect(placed.length / 11, at.map((t) => t.toFixed(2)).join(' ')).toBeGreaterThanOrEqual(followed)
      expect(mostWithin(times, 1000)).toBeLessThanOrEqual(MOST)
      // On the whole scale (55 to 1760 Hz) the same octave is a fifth of the text: the strong letters barely move.
      const whole = strongAt(play(frames.map((f) => ({ ...f, pitchLow: 0, pitchHigh: 1 })), pitchReactive).shown, 12, 500)
      for (let k = 2; k < 12; k++) expect(Math.abs(whole[k] - whole[k - 1])).toBeLessThan(0.25)
    })

    it('the test track\'s melody (A2 A3 A4 A5 A4 A3, twice) at Pitch reactive 1: once its range is heard, each note has its own place, low to high across the text', () => {
      const run = [0, 1, 2, 3, 2, 1].map((octave) => A2 * 2 ** octave)
      const { times, shown } = play(analyse(notes([...run, ...run], 500, -12)), 1)
      const at = strongAt(shown, 12, 500)
      // The second time: A2, A3, A4, A5 from left to right, and back.
      const [a2, a3, a4, a5, b4, b3] = at.slice(6)
      expect(a2).toBeLessThan(0.3)
      expect(a5).toBeGreaterThan(0.7)
      for (const [lower, higher] of [[a2, a3], [a3, a4], [a4, a5], [b4, a5], [b3, b4]]) expect(higher - lower).toBeGreaterThan(0.1)
      expect(mostWithin(times, 1000)).toBeLessThanOrEqual(MOST)
    })
  })
})

interface OnScreenRun {
  /** Updates (measured frames) a second. */
  fps: number
  /** How long each frame's glyphs take (ms). */
  computeMs: number
  /** The pitch the music asks for at a time (before FeatureExtractor follows it); an octave at 6 Hz by default. */
  pitch?: (t: number) => number
  /** Strength 400 %, Motion contrast 100 % and Pitch reactive 200 % by default. */
  response?: ResponseSettings
  /** The case's own mappings by default. */
  mappings?: Mapping[]
  /** The recent melody's range (pitchLow, pitchHigh) the frames carry; the whole scale by default. */
  range?: readonly [number, number]
  /** Measured frames to play as they are, instead of the case's features and `pitch` at `fps`. */
  frames?: readonly FeatureFrame[]
  /** The sliders counted on screen; the case's own by default. */
  targets?: readonly string[]
}

/**
 * Through the live scheduler with letters (as onScreen): by default Strength 400 %, Motion contrast 100 %, Pitch
 * reactive 200 %, the pitch moving an octave and back at 6 Hz, followed as FeatureExtractor follows it (a one-pole of
 * pitchSmoothingMs, so each move is spread over several updates). Counted as committed: each level's own turns (while some
 * letter shows it), the seed, and letters moving between levels (each by its share, by how far apart its two
 * levels are), from one frame to the next and from any frame shown within SPREAD_MS (a move the screen shows over
 * several frames), all independently of the limiter. Also how many large changes each level made (quiet, shared,
 * strong).
 * The budget counts edges on the frames' times over windowMs, so on screen (up to a few frames later) at most 6 fall
 * within any second.
 */
function lettersOnScreen(
  c: Case,
  slots: LetterSlots,
  shown: readonly number[],
  run: OnScreenRun = { fps: 60, computeMs: 5 },
): { times: number[]; turns: number[]; switches: number; shown: { time: number; assign: Uint8Array }[] } {
  const r: ResponseSettings = run.response ?? { ...NEUTRAL_RESPONSE, strength: 4, contrast: 1, pitchReactive: 2 }
  const levels = letterLevels(r)!
  let now = 0
  let computing = false
  const timers: { at: number; run: () => void }[] = []
  const later = (ms: number, run: () => void) => timers.push({ at: now + ms, run })
  const counters = [changeCounter(), changeCounter(), changeCounter()]
  const seeds = changeCounter()
  const switches: number[] = []
  const recent: { time: number; assign: Uint8Array }[] = []
  let before: Uint8Array | null = null
  const sliders = run.targets ?? SLIDERS.slice(0, c.sliders)
  const positionsOn = (params: GeometryParams) => new Map(sliders.map((id) => [id, targetById(id)!.toSlider(targetById(id)!.get(params))]))
  const shownLevels: { time: number; assign: Uint8Array }[] = []
  const deps: LiveDeps = {
    now: () => now,
    sourceRunning: () => true,
    isComputing: () => computing,
    request: (jobs) => {
      // The shared set for every glyph shown, then each level's glyphs.
      expect(jobs[0].indices).toBeUndefined()
      expect(jobs.slice(1).every((job) => job.indices!.every((index) => shown.includes(index)))).toBe(true)
      computing = true
      later(run.computeMs, () => {
        computing = false
        live.idle()
      })
      return true
    },
    commit: (commit) => {
      const params = commit?.params ?? BASE
      const letters = commit?.letters ?? null
      const assign = letters?.assign ?? new Uint8Array(slots.count).fill(1)
      // Every level's slider positions, from the shared ones; the levels' parameters match them.
      const shared = positionsOn(params)
      const at = levels.gains.map((gain) => new Map(sliders.map((id) => [id, levelPosition(targetById(id)!, BASE, shared.get(id)!, gain)])))
      for (const job of letters?.jobs ?? []) {
        const level = job.key === letters!.keys[0] ? 0 : 2
        for (const [id, position] of positionsOn(job.params)) expect(position).toBeCloseTo(at[level].get(id)!, 9)
        expect(job.params.distortion.seed).toBe(params.distortion.seed)
      }
      // A level is on screen while letters show it, or while it is the shared values themselves (back on the
      // sliders' own values every level is).
      for (let level = 0; level < 3; level++) {
        const shownLevel = assign.some((l, j) => l === level && slots.active[j])
        const sameAsShared = [...at[level]].every(([id, position]) => position === shared.get(id))
        if (shownLevel || sameAsShared) counters[level].see(now, at[level], undefined)
      }
      seeds.see(now, new Map(), c.seed ? params.distortion.seed : undefined)
      if (before) {
        // Letters moving between levels: each by its share, by how far apart its two levels are now.
        const moved = (from: Uint8Array) => {
          let swing = 0
          for (let j = 0; j < slots.count; j++) {
            if (!slots.active[j] || from[j] === assign[j]) continue
            let apart = 0
            for (const id of sliders) apart += Math.abs(at[assign[j]].get(id)! - at[from[j]].get(id)!)
            swing += slots.share[j] * apart
          }
          return swing
        }
        // From the last frame, or, for a move the screen shows over several frames (the pitch is smoothed), from any
        // frame shown within SPREAD_MS since the last large change (a frame's changes count once).
        while (recent.length && recent[0].time <= now - SPREAD_MS) recent.shift()
        const large = (from: Uint8Array) => moved(from) >= FLASH_LIMITS.swing - 1e-9
        if (large(before) || recent.some((r) => large(r.assign))) switches.push(now)
        if (switches.at(-1) === now || seeds.times.at(-1) === now || counters.some((counter) => counter.times.at(-1) === now)) recent.length = 0
      }
      recent.push({ time: now, assign: assign.slice() })
      before = assign
      shownLevels.push({ time: now, assign: assign.slice() })
      if (commit) later(1, () => live.rendered(commit.seq))
    },
    pauseSound: () => {},
    setTimer: (run, ms) => {
      later(ms, run)
      return 0
    },
    clearTimer: () => {},
  }
  const live = new LiveScheduler(deps)
  live.setBase(BASE)
  live.setSlots(slots)
  live.setMappings(run.mappings ?? mappingsOf(c), true, r)
  // An octave is a fifth of Pitch (55 to 1760 Hz).
  const target = run.pitch ?? ((t: number) => (Math.floor(t / (1000 / 12)) % 2 ? 0.6 : 0.4))
  const step = 1000 / run.fps
  let pitch = target(0)
  const range = run.range ? { pitchLow: run.range[0], pitchHigh: run.range[1] } : {}
  const synthetic: FeatureFrame[] = []
  for (let t = step; !run.frames && t <= 10_000; t += step) {
    // As FeatureExtractor follows the pitch: a one-pole of SOUND_LIMITS.pitchSmoothingMs, so a move is spread over updates.
    pitch += (1 - Math.exp(-step / SOUND_LIMITS.pitchSmoothingMs)) * (target(t) - pitch)
    const features = frameAt(c, t)
    // One beat per quarter second whatever the update rate.
    features.onset = Math.floor(t / 250) !== Math.floor((t - step) / 250)
    features.beat = features.onset ? 1 : 0
    synthetic.push({ ...features, pitch, pitchConfidence: 1, ...range })
  }
  for (const frame of run.frames ?? synthetic) {
    const t = frame.time
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > t) break
      timers.shift()
      now = Math.max(now, next.at)
      next.run()
    }
    now = t
    live.setFrame(frame)
  }
  return {
    times: [...new Set([...counters.flatMap((counter) => counter.times), ...seeds.times, ...switches])].sort((a, b) => a - b),
    turns: counters.map((counter) => counter.times.length),
    switches: switches.length,
    shown: shownLevels,
  }
}

describe('edgesFit (the handover check across a switch)', () => {
  const most = 2 * FLASH_LIMITS.maxFlashes
  const w = FLASH_LIMITS.windowMs

  it('allows a full budget in each window when the windows do not overlap', () => {
    const before = Array.from({ length: most }, (_, k) => k)
    const after = Array.from({ length: most }, (_, k) => w + k)
    expect(edgesFit([...before, ...after])).toBe(true)
  })

  it('refuses one edge too many in any window, wherever it starts', () => {
    const before = Array.from({ length: most }, (_, k) => 500 + k)
    expect(edgesFit([...before, 500 + w - 1])).toBe(false)
    expect(edgesFit([...before, 500 + w])).toBe(true)
  })

  it('keeps what FlashBudget remembers', () => {
    const budget = new FlashBudget()
    for (let t = 0; t < 5000; t += 50) budget.take(t)
    expect(edgesFit(budget.since(0))).toBe(true)
    expect(budget.since(5000 - w).length).toBeLessThanOrEqual(most)
  })
})

describe('FlashBudget.reserve (the precompute handover)', () => {
  it('allows no new edge before the time given, while spend still counts', () => {
    const budget = new FlashBudget()
    budget.reserve(1000)
    expect(budget.take(500)).toBe(false)
    budget.spend(600)
    expect(budget.since(0)).toEqual([600])
    expect(budget.take(1000)).toBe(true)
    // A shorter reservation never shortens a longer one.
    budget.reserve(3000)
    budget.reserve(2000)
    expect(budget.take(2500)).toBe(false)
  })
})
