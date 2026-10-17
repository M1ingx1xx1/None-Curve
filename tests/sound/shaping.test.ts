// A mapping's shaping (Range, Curve, Smooth, Gate, Mode: src/sound/mapping.ts, src/sound/shaping.ts): each setting
// does what it says on sliders and seeds; at the defaults everything is exactly what it was before shaping existed;
// the same frames always give the same values (live, a recording or a test run), and the state starts afresh on a
// reset or when time goes back; shaping is kept by the store, undo, presets, the saved session and config files, and
// older saved mappings read as the defaults.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GeometryParams } from '../../src/geometry/types'
import { JumpTracker } from '../../src/sound/jumps'
import { levelPosition } from '../../src/sound/letters'
import {
  clampShaping,
  curveValue,
  DEFAULT_SHAPING,
  FEATURES,
  featureValue,
  gateValue,
  modulate,
  SHAPING_LIMITS,
  shapingOf,
  sharedRange,
  targetById,
  type FeatureId,
  type Mapping,
  type Shaping,
} from '../../src/sound/mapping'
import { mappingStore } from '../../src/sound/mappingStore'
import { PRESETS } from '../../src/sound/presets'
import { NO_SHAPING, ShapingTracker } from '../../src/sound/shaping'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { undoHistory, type Snapshot } from '../../src/state/history'
import { parseConfig, readSession, serializeConfig, serializeSession, parseSession, type Session } from '../../src/state/persist'
import { DEFAULT_SETTINGS } from '../../src/state/reset'
import { BASE } from '../helpers/params'

const AMOUNT = 'squaring.amount'
const SEED = 'distortion.seed'
/** Noise amplitude on, so the Distortion seed acts. */
const base: GeometryParams = { ...BASE, distortion: { ...BASE.distortion, amount: 10 } }
const spec = targetById(AMOUNT)!
const basePosition = spec.toSlider(spec.get(base))

const row = (patch: Partial<Mapping> = {}): Mapping => ({ id: 'm1', enabled: true, feature: 'level', target: AMOUNT, depth: 0.5, ...patch })

/** A frame at `time` (ms) with every continuous feature at `value` (Pan too), and an onset when `onset`. */
const frameAt = (time: number, value: number, onset = false): FeatureFrame => ({
  ...SILENT_FRAME,
  time,
  silent: value === 0,
  levelDb: value ? -20 : -Infinity,
  level: value,
  swell: value,
  bass: value,
  mids: value,
  treble: value,
  brightness: value,
  pitch: value,
  melody: value,
  activity: value,
  pan: value,
  beat: onset ? 1 : value,
  onset,
})

/** A frame every 1/60 s, its features from `value(t)` (t in ms), an onset every 500 ms. */
function frames(seconds: number, value: (t: number) => number): FeatureFrame[] {
  return Array.from({ length: seconds * 60 }, (_, k) => {
    const time = ((k + 1) * 1000) / 60
    return frameAt(time, value(time), (k + 1) % 30 === 0)
  })
}

/** A small deterministic pseudo-random sequence (no Math.random: runs must repeat). */
function noise(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

/** The slider position modulate gives `mapping` on each frame, through a ShapingTracker. */
function positions(mapping: Mapping, input: readonly FeatureFrame[]): number[] {
  const tracker = new ShapingTracker()
  return input.map((f) => modulate(base, f, [mapping], undefined, undefined, tracker.advance(f, [mapping]).values).positions.get(AMOUNT)!)
}

/** The shaped value of `mapping` on each frame. */
function shaped(mapping: Mapping, input: readonly FeatureFrame[]): number[] {
  const tracker = new ShapingTracker()
  return input.map((f) => tracker.advance(f, [mapping]).values.get(mapping.id)!)
}

/** How many jumps the seed made over the frames (it wraps at its largest, so count the changes). */
function jumpCount(mapping: Mapping, input: readonly FeatureFrame[]): number {
  const shaping = new ShapingTracker()
  const jumps = new JumpTracker()
  let last = 0
  let count = 0
  for (const f of input) {
    const now = jumps.advance(f, [mapping], base, 1, shaping.advance(f, [mapping])).get(SEED) ?? 0
    if (now !== last) count++
    last = now
  }
  return count
}

describe('shaping at its defaults', () => {
  const random = noise(7)
  const input = frames(4, () => Math.round(random() * 1000) / 1000)

  it('gives every feature value itself, bit for bit, for every feature', () => {
    for (const feature of FEATURES) {
      const mapping = row({ feature: feature.id })
      const values = shaped(mapping, input)
      input.forEach((f, k) => expect(Object.is(values[k], featureValue(f, feature.id)), feature.id).toBe(true))
    }
  })

  it('leaves modulate exactly as without shaping, the same object when nothing moves', () => {
    const tracker = new ShapingTracker()
    const mappings = [row({ id: 'a' }), row({ id: 'b', feature: 'pan', depth: -0.3 }), row({ id: 'c', feature: 'beat', target: SEED, depth: 1 })]
    const response = { ...NEUTRAL_RESPONSE, melody: 0.2, strength: 1.5 }
    for (const f of input) {
      const values = tracker.advance(f, mappings).values
      const plain = modulate(base, f, mappings, undefined, response)
      const withShaping = modulate(base, f, mappings, undefined, response, values)
      expect(withShaping).toEqual(plain)
      expect(withShaping.bounds).toBeUndefined()
    }
    expect(modulate(base, frameAt(1, 0), mappings, undefined, undefined, NO_SHAPING.values).params).toBe(base)
  })

  it('leaves the jumps exactly as without shaping', () => {
    for (const mapping of [row({ feature: 'beat', target: SEED, depth: 0.5 }), row({ feature: 'level', target: SEED, depth: 0.7 })]) {
      const shaping = new ShapingTracker()
      const a = new JumpTracker()
      const b = new JumpTracker()
      for (const f of input) {
        expect(a.advance(f, [mapping], base, 1, shaping.advance(f, [mapping]))).toEqual(b.advance(f, [mapping], base, 1))
      }
    }
  })

  it('is what a mapping without shaping fields reads as, and clamps to itself', () => {
    expect(shapingOf(row())).toEqual(DEFAULT_SHAPING)
    expect(clampShaping({})).toEqual(DEFAULT_SHAPING)
    expect(DEFAULT_SHAPING).toEqual({ rangeMin: 0, rangeMax: 1, curve: 0, smoothMs: 0, gate: 0, mode: 'follow' })
  })
})

describe('Gate', () => {
  it('reads 0 up to the gate and spreads the rest over 0–1', () => {
    expect(gateValue(0.3, 0.4)).toBe(0)
    expect(gateValue(0.4, 0.4)).toBe(0)
    expect(gateValue(0.7, 0.4)).toBeCloseTo(0.5, 12)
    expect(gateValue(1, 0.4)).toBe(1)
    // Pan: on its size, with its sign.
    expect(gateValue(-0.7, 0.4)).toBeCloseTo(-0.5, 12)
  })

  it('keeps a slider still below it', () => {
    const quiet = positions(row({ gate: 0.5 }), [frameAt(10, 0.45)])
    expect(quiet[0]).toBe(basePosition)
    const loud = positions(row({ gate: 0.5, depth: 1 }), [frameAt(10, 1)])
    expect(loud[0]).toBeGreaterThan(basePosition)
  })

  it('slows a seed driven by a continuous feature, and stops it below the gate', () => {
    const input = frames(4, () => 0.6)
    const open = jumpCount(row({ target: SEED, depth: 1 }), input)
    const half = jumpCount(row({ target: SEED, depth: 1, gate: 0.2 }), input)
    const shut = jumpCount(row({ target: SEED, depth: 1, gate: 0.6 }), input)
    expect(open).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(0)
    expect(shut).toBe(0)
  })
})

describe('Curve', () => {
  it('is linear at 0, exponential above, logarithmic below, and keeps the ends', () => {
    expect(curveValue(0.5, 0)).toBe(0.5)
    expect(curveValue(0.5, 1)).toBeCloseTo(0.125, 12)
    expect(curveValue(0.5, -1)).toBeCloseTo(0.5 ** (1 / 3), 12)
    expect(curveValue(-0.5, 1)).toBeCloseTo(-0.125, 12)
    for (const curve of [-1, -0.4, 0.4, 1]) {
      expect(curveValue(0, curve)).toBe(0)
      expect(curveValue(1, curve)).toBe(1)
    }
  })

  it('moves a slider less (Exp) or more (Log) at the same sound', () => {
    const f = [frameAt(10, 0.5)]
    const lin = positions(row({ depth: 1 }), f)[0]
    const exp = positions(row({ depth: 1, curve: 1 }), f)[0]
    const log = positions(row({ depth: 1, curve: -1 }), f)[0]
    expect(exp).toBeLessThan(lin)
    expect(log).toBeGreaterThan(lin)
  })
})

describe('Smooth', () => {
  const step = frames(2, (t) => (t > 500 ? 1 : 0))

  it('eases a step with its time constant, from frame times only', () => {
    const values = shaped(row({ smoothMs: 200 }), step)
    const at = (ms: number) => values[Math.round((ms * 60) / 1000) - 1]
    expect(at(500)).toBe(0)
    // One time constant after the step: 1 − 1/e (to within a frame).
    expect(at(700)).toBeGreaterThan(0.6)
    expect(at(700)).toBeLessThan(0.66)
    expect(at(1900)).toBeGreaterThan(0.99)
    for (let k = 1; k < values.length; k++) expect(values[k]).toBeGreaterThanOrEqual(values[k - 1])
  })

  it('is the value itself at 0 ms', () => {
    const values = shaped(row(), step)
    step.forEach((f, k) => expect(values[k]).toBe(f.level))
  })

  it('counts a long gap between frames as SHAPING_LIMITS.maxStepMs', () => {
    const tracker = new ShapingTracker()
    const m = row({ smoothMs: 1000 })
    tracker.advance(frameAt(10, 0), [m])
    const after = tracker.advance(frameAt(10_010, 1), [m]).values.get('m1')!
    expect(after).toBeCloseTo(1 - Math.exp(-SHAPING_LIMITS.maxStepMs / 1000), 12)
  })
})

describe('Range', () => {
  it('keeps the slider within the span', () => {
    const p = positions(row({ depth: 1, rangeMin: 0, rangeMax: 0.3 }), [frameAt(10, 1)])[0]
    expect(basePosition).toBeLessThan(0.3)
    expect(p).toBeLessThanOrEqual(0.3 + 1e-9)
    expect(p).toBeGreaterThan(basePosition)
  })

  it('never pulls in a slider that sits outside it: sound moves it only towards the span', () => {
    const high = spec.set(base, spec.fromSlider(0.9))
    const hp = spec.toSlider(spec.get(high))
    const up = modulate(high, frameAt(10, 1), [row({ depth: 1, rangeMin: 0.2, rangeMax: 0.5 })])
    expect(up.positions.get(AMOUNT)).toBe(hp)
    expect(up.params).toBe(high)
    const down = modulate(high, frameAt(10, 1), [row({ depth: -1, rangeMin: 0.2, rangeMax: 0.5 })])
    expect(down.positions.get(AMOUNT)).toBeCloseTo(0.2, 2)
  })

  it('takes the outer edges of the spans on one slider, and reports them as sharedRange does', () => {
    const m = [row({ id: 'a', depth: 0.6, rangeMin: 0, rangeMax: 0.2 }), row({ id: 'b', depth: 0.6, rangeMin: 0.1, rangeMax: 0.4 })]
    const out = modulate(base, frameAt(10, 1), m)
    expect(out.bounds?.get(AMOUNT)).toEqual([0, 0.4])
    expect(sharedRange(m, AMOUNT)).toEqual([0, 0.4])
    expect(out.positions.get(AMOUNT)).toBeLessThanOrEqual(0.4 + 1e-9)
    // Two narrow spans apart give the whole slider between them; a row switched off or at Depth 0 takes no part.
    const apart = [row({ id: 'a', rangeMin: 0, rangeMax: 0.2 }), row({ id: 'b', rangeMin: 0.8, rangeMax: 1 })]
    expect(sharedRange(apart, AMOUNT)).toEqual([0, 1])
    expect(sharedRange([...apart, row({ id: 'c', enabled: false, rangeMin: 0.5, rangeMax: 0.6 })], AMOUNT)).toEqual([0, 1])
    expect(sharedRange([apart[0], { ...apart[1], depth: 0 }], AMOUNT)).toEqual([0, 0.2])
    expect(sharedRange(apart, SEED)).toBeUndefined()
  })

  it('keeps letters on a stronger level within it too', () => {
    const p = 0.3
    expect(levelPosition(spec, base, p, 3, [0, 0.35])).toBeLessThanOrEqual(0.35 + 1e-9)
    expect(levelPosition(spec, base, p, 3)).toBeGreaterThan(0.35)
  })

  it('does nothing on a seed', () => {
    const input = frames(3, () => 0.8)
    expect(jumpCount(row({ target: SEED, depth: 1, rangeMin: 0.4, rangeMax: 0.5 }), input)).toBe(jumpCount(row({ target: SEED, depth: 1 }), input))
  })
})

describe('Trigger', () => {
  // Level rises past 0.5 at 200 ms and 1200 ms, each for 100 ms, with noise around the gate in between.
  const bursts = frames(2, (t) => ((t > 200 && t < 300) || (t > 1200 && t < 1300) ? 0.9 : t > 600 && t < 900 ? (Math.round(t) % 3 ? 0.48 : 0.52) : 0))

  it('fires once per rise past the gate; noise around it fires once', () => {
    const tracker = new ShapingTracker()
    const m = row({ mode: 'trigger', gate: 0.5 })
    const rises = bursts.filter((f) => tracker.advance(f, [m]).rises.has('m1')).map((f) => f.time)
    expect(rises).toHaveLength(3)
    expect(rises[0]).toBeGreaterThan(200)
    expect(rises[0]).toBeLessThan(220)
    expect(rises[2]).toBeGreaterThan(1200)
  })

  it('re-arms at Gate 0 when the feature dips but never reaches 0', () => {
    // Three loud bursts over a floor of 0.02 (never 0), with noise around SHAPING_LIMITS.minFire in between.
    const floor = frames(2, (t) =>
      (t > 200 && t < 300) || (t > 800 && t < 900) || (t > 1400 && t < 1500) ? 0.6 : t > 1000 && t < 1300 ? (Math.round(t) % 3 ? 0.09 : 0.11) : 0.02,
    )
    for (const mode of ['trigger', 'toggle'] as const) {
      const tracker = new ShapingTracker()
      const m = row({ mode })
      expect(floor.filter((f) => tracker.advance(f, [m]).rises.has('m1'))).toHaveLength(4)
    }
  })

  it('pushes a slider to the full Depth and lets it fall back in a straight line over Smooth', () => {
    const values = shaped(row({ mode: 'trigger', gate: 0.5, smoothMs: 300 }), bursts)
    const first = bursts.findIndex((f) => f.time > 200)
    expect(values[first]).toBe(1)
    // 150 ms later: half way down; 300 ms later: back at 0.
    expect(values[first + 9]).toBeCloseTo(0.5, 6)
    expect(values[first + 18]).toBeCloseTo(0, 9)
    expect(values[first - 1]).toBe(0)
  })

  it('falls back over SHAPING_LIMITS.pulseMs at Smooth 0', () => {
    const values = shaped(row({ mode: 'trigger', gate: 0.5 }), bursts)
    const first = bursts.findIndex((f) => f.time > 200)
    const frames = Math.ceil((SHAPING_LIMITS.pulseMs * 60) / 1000)
    expect(values[first + frames - 1]).toBeGreaterThan(0)
    expect(values[first + frames]).toBe(0)
  })

  it('fires at every hit with Beat', () => {
    const tracker = new ShapingTracker()
    const m = row({ feature: 'beat', mode: 'trigger', gate: 0.9 })
    const input = frames(3, () => 0.2)
    const hits = input.filter((f) => tracker.advance(f, [m]).rises.has('m1')).length
    expect(hits).toBe(input.filter((f) => f.onset).length)
  })

  it('moves a seed on once per rise (Rate 50%: every other one)', () => {
    expect(jumpCount(row({ target: SEED, depth: 1, mode: 'trigger', gate: 0.5 }), bursts)).toBe(3)
    const beats = frames(4, () => 0)
    expect(jumpCount(row({ feature: 'beat', target: SEED, depth: 0.5, mode: 'trigger' }), beats)).toBe(4)
  })
})

describe('Toggle', () => {
  const bursts = frames(2, (t) => ((t > 200 && t < 300) || (t > 800 && t < 900) || (t > 1400 && t < 1500) ? 0.9 : 0))

  it('flips between the slider value and the full Depth at each rise', () => {
    const m = row({ mode: 'toggle', gate: 0.5, depth: 0.4 })
    const p = positions(m, bursts)
    const at = (ms: number) => p[Math.round((ms * 60) / 1000) - 1]
    expect(at(100)).toBe(basePosition)
    expect(at(600)).toBeCloseTo(spec.toSlider(spec.fromSlider(basePosition + 0.4)), 9)
    expect(at(1200)).toBe(basePosition)
    expect(at(1800)).toBeCloseTo(spec.toSlider(spec.fromSlider(basePosition + 0.4)), 9)
  })

  it('eases each flip over Smooth', () => {
    const values = shaped(row({ mode: 'toggle', gate: 0.5, smoothMs: 100 }), bursts)
    const first = bursts.findIndex((f) => f.time > 200)
    expect(values[first]).toBeGreaterThan(0)
    expect(values[first]).toBeLessThan(0.5)
    expect(values[first + 30]).toBeGreaterThan(0.99)
  })

  it('moves a seed on once per rise', () => {
    expect(jumpCount(row({ target: SEED, depth: 1, mode: 'toggle', gate: 0.5 }), bursts)).toBe(3)
  })
})

describe('determinism and restarts', () => {
  const random = noise(3)
  const input = frames(6, () => random())
  const mappings: Mapping[] = [
    row({ id: 'a', smoothMs: 250, curve: 0.4, gate: 0.1 }),
    row({ id: 'b', mode: 'trigger', gate: 0.6, smoothMs: 120 }),
    row({ id: 'c', mode: 'toggle', gate: 0.7, smoothMs: 60, feature: 'pan' }),
    row({ id: 'd', mode: 'trigger', feature: 'beat', target: SEED, depth: 1 }),
  ]
  const run = () => {
    const shaping = new ShapingTracker()
    const jumps = new JumpTracker()
    return input.map((f) => {
      const s = shaping.advance(f, mappings)
      const j = jumps.advance(f, mappings, base, 1, s)
      return JSON.stringify([[...s.values], [...s.rises], [...j], modulate(base, f, mappings, j, NEUTRAL_RESPONSE, s.values).positions.get(AMOUNT)])
    })
  }

  it('gives the same values from the same frames, every run', () => {
    expect(run()).toEqual(run())
  })

  it('starts afresh after reset, and when time goes back (a restart)', () => {
    const tracker = new ShapingTracker()
    const fresh = new ShapingTracker()
    for (const f of input.slice(0, 120)) tracker.advance(f, mappings)
    tracker.reset()
    expect(tracker.shaped).toBe(NO_SHAPING)
    const later = input.slice(120, 200)
    expect(later.map((f) => tracker.advance(f, mappings))).toEqual(later.map((f) => fresh.advance(f, mappings)))

    const again = new ShapingTracker()
    const restarted = new ShapingTracker()
    for (const f of input.slice(0, 120)) again.advance(f, mappings)
    const replay = input.slice(0, 60)
    expect(replay.map((f) => again.advance(f, mappings))).toEqual(replay.map((f) => restarted.advance(f, mappings)))
  })

  it('drops the state of a mapping switched off or removed', () => {
    const tracker = new ShapingTracker()
    const m = row({ mode: 'toggle', gate: 0.5 })
    tracker.advance(frameAt(10, 0), [m])
    expect(tracker.advance(frameAt(20, 1), [m]).values.get('m1')).toBe(1)
    tracker.advance(frameAt(30, 0), [{ ...m, enabled: false }])
    expect(tracker.advance(frameAt(40, 0), [m]).values.get('m1')).toBe(0)
  })

  it('starts a mapping afresh when its Mode or Feature changes', () => {
    const tracker = new ShapingTracker()
    const m = row({ mode: 'toggle', gate: 0.5 })
    tracker.advance(frameAt(10, 0), [m])
    expect(tracker.advance(frameAt(20, 1), [m]).values.get('m1')).toBe(1)
    tracker.advance(frameAt(30, 0), [{ ...m, mode: 'follow' }])
    // Back in Toggle: no flip is left over, so the target stays at its slider value until the next rise.
    expect(tracker.advance(frameAt(40, 0), [m]).values.get('m1')).toBe(0)
    expect(tracker.advance(frameAt(50, 1), [m]).values.get('m1')).toBe(1)
    // Still above the Gate, a new Feature re-arms at once: its first rise fires.
    expect(tracker.advance(frameAt(60, 1), [{ ...m, feature: 'swell' }]).rises.has('m1')).toBe(true)
  })
})

describe('shaping kept', () => {
  const SHAPED: Partial<Shaping> = { rangeMin: 0.1, rangeMax: 0.6, curve: -0.35, smoothMs: 250, gate: 0.2, mode: 'trigger' }
  const session = (mappings: Mapping[]): Session => ({
    params: DEFAULT_SETTINGS,
    view: readSession({})!.view,
    text: 'A',
    previewLook: readSession({})!.previewLook,
    precision: 2,
    mappings,
    sound: readSession({})!.sound,
    font: null,
    glyph: null,
  })

  it('round-trips through the saved session and a config file', () => {
    const s = session([{ ...row(), ...SHAPED }, row({ id: 'm2' })])
    expect(parseSession(serializeSession(s))).toEqual(s)
    const config = parseConfig(serializeConfig(s))
    expect(config.ok && config.session.mappings).toEqual(s.mappings)
  })

  it('reads older mappings (no shaping) as the defaults, adding no fields', () => {
    const old = readSession({ version: 1, mappings: [{ enabled: true, feature: 'bass', target: AMOUNT, depth: 0.5 }] })!
    expect(old.mappings[0]).toEqual({ id: 'm1', enabled: true, feature: 'bass', target: AMOUNT, depth: 0.5 })
    expect(shapingOf(old.mappings[0])).toEqual(DEFAULT_SHAPING)
  })

  it('clamps damaged shaping to its limits, and drops what is not a value', () => {
    const read = readSession({
      version: 2,
      mappings: [{ enabled: true, feature: 'bass', target: AMOUNT, depth: 0.5, rangeMin: 0.8, rangeMax: 0.2, curve: 7, smoothMs: 1e9, gate: 'x', mode: 'loop' }],
    })!.mappings[0]
    expect(shapingOf(read)).toEqual({ rangeMin: 0.8, rangeMax: 0.81, curve: 1, smoothMs: SHAPING_LIMITS.smoothMs.max, gate: 0, mode: 'follow' })
    expect(read).not.toHaveProperty('gate')
    expect(read).not.toHaveProperty('mode')
  })

  it('can be written into a preset row, and every preset keeps the defaults', () => {
    for (const preset of PRESETS) for (const m of preset.mappings) expect(shapingOf(m), preset.id).toEqual(DEFAULT_SHAPING)
  })

  describe('in the store, with undo', () => {
    let disconnect: () => void
    let snapshot: Snapshot
    beforeEach(() => {
      mappingStore.restore([])
      snapshot = { params: DEFAULT_SETTINGS, text: '', mappings: [] }
      disconnect = undoHistory.connect({
        read: () => ({ ...snapshot, mappings: mappingStore.getState().mappings }),
        restore: (s) => mappingStore.restore(s.mappings),
      })
    })
    afterEach(() => {
      disconnect()
      mappingStore.restore([])
    })

    it('clamps each change, stops a range end short of the other, and undoes it', () => {
      const id = mappingStore.add('level' as FeatureId, AMOUNT)!
      undoHistory.endGesture()
      mappingStore.update(id, { gate: 2 })
      undoHistory.endGesture()
      mappingStore.update(id, { mode: 'toggle' })
      undoHistory.endGesture()
      mappingStore.update(id, { rangeMax: 0.3 })
      undoHistory.endGesture()
      mappingStore.update(id, { rangeMin: 0.5 })
      const m = mappingStore.getState().mappings[0]
      expect(shapingOf(m)).toEqual({ ...DEFAULT_SHAPING, gate: SHAPING_LIMITS.gate.max, mode: 'toggle', rangeMin: 0.29, rangeMax: 0.3 })
      expect(undoHistory.undo()).toBe(true)
      expect(shapingOf(mappingStore.getState().mappings[0])).toEqual({ ...DEFAULT_SHAPING, gate: SHAPING_LIMITS.gate.max, mode: 'toggle', rangeMax: 0.3 })
      undoHistory.undo()
      undoHistory.undo()
      expect(shapingOf(mappingStore.getState().mappings[0])).toEqual({ ...DEFAULT_SHAPING, gate: SHAPING_LIMITS.gate.max })
      undoHistory.undo()
      expect(mappingStore.getState().mappings[0]).not.toHaveProperty('gate')
    })

    it('keeps a preset row\'s shaping on Load, clamped', () => {
      mappingStore.replace([{ enabled: true, feature: 'bass', target: AMOUNT, depth: 0.5, smoothMs: 333, mode: 'trigger' }])
      const m = mappingStore.getState().mappings[0]
      expect(m.smoothMs).toBe(330)
      expect(m.mode).toBe('trigger')
      expect(m).not.toHaveProperty('gate')
    })
  })
})
