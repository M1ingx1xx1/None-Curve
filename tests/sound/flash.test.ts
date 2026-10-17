// The flash limit (WCAG 2.3.1; src/sound/flash.ts): at most 3 flashes, so 6 large changes, in any second, however
// many sliders and seeds Sound drives. Square-wave features at 4 Hz, 60 frames a second, for 10 s, through the
// sliders' FlashLimiter and the seeds' JumpTracker sharing one FlashBudget, and through the whole LiveScheduler on a
// fake clock (what reaches the screen). Large changes are counted independently of the limiter.

import { describe, expect, it } from 'vitest'
import type { GeometryParams } from '../../src/geometry/types'
import { FLASH_LIMITS, FlashBudget } from '../../src/sound/flash'
import { JumpTracker } from '../../src/sound/jumps'
import { FlashLimiter, LiveScheduler, type LiveDeps } from '../../src/sound/live'
import { modulate, targetById, type Mapping } from '../../src/sound/mapping'
import { SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { BASE as DEFAULTS } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }
const SLIDERS = ['squaring.amount', 'anchors.spacing', 'distortion.amount', 'anchors.simplify', 'distortion.normalBias']
const FEATURES = ['bass', 'mids', 'treble', 'brightness', 'activity'] as const
const SEED = 'distortion.seed'
const MOST = 2 * FLASH_LIMITS.maxFlashes
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

/** The limiter and the jumps sharing one budget, frame by frame. */
function limited(c: Case): number[] {
  const mappings = mappingsOf(c)
  const budget = new FlashBudget()
  const limiter = new FlashLimiter(budget)
  const jumps = new JumpTracker(budget)
  const counter = changeCounter()
  for (let t = FRAME_MS; t <= 10_000; t += FRAME_MS) {
    const frame = frameAt(c, t)
    const seeds = c.seed ? jumps.advance(frame, mappings, BASE) : new Map<string, number>()
    const out = limiter.limit(modulate(BASE, frame, mappings, seeds), t)
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
