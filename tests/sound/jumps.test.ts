// Seeds that jump with the sound (src/sound/jumps.ts) under the Response group's Strength: it multiplies every Rate,
// which still caps at 100%, and Strength 100% is exactly the tracker without it.

import { describe, expect, it } from 'vitest'
import type { GeometryParams } from '../../src/geometry/types'
import { JumpTracker, JUMP_LIMITS } from '../../src/sound/jumps'
import type { FeatureId, Mapping } from '../../src/sound/mapping'
import { SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { BASE } from '../helpers/params'

const SEED = 'distortion.seed'
/** Noise amplitude on, so its seed acts. */
const base: GeometryParams = { ...BASE, distortion: { ...BASE.distortion, amount: 10 } }
const row = (depth: number, feature: FeatureId): Mapping => ({ id: 'm1', enabled: true, feature, target: SEED, depth })

/** Frames every 1/60 s for `seconds`: Level at `level`, an onset every 500 ms. */
function frames(seconds: number, level = 1): FeatureFrame[] {
  const out: FeatureFrame[] = []
  for (let f = 1; f <= seconds * 60; f++) {
    const time = (f * 1000) / 60
    const onset = f % 30 === 0
    out.push({ ...SILENT_FRAME, time, silent: false, level, beat: onset ? 1 : 0, onset })
  }
  return out
}

/** The jumps so far after each frame. */
function run(mapping: Mapping, strength: number | undefined, input: readonly FeatureFrame[]): number[] {
  const tracker = new JumpTracker()
  return input.map(
    (frame) =>
      (strength === undefined
        ? tracker.advance(frame, [mapping], base)
        : tracker.advance(frame, [mapping], base, strength)
      ).get(SEED) ?? 0,
  )
}

/** How many jumps a run made (the seed wraps at its largest, so count the changes). */
const count = (jumps: readonly number[]) => jumps.filter((j, i) => j !== (i > 0 ? jumps[i - 1] : 0)).length

describe('JumpTracker with Strength', () => {
  it('is the tracker without it at 100%', () => {
    const input = frames(6, 0.7)
    for (const mapping of [row(0.5, 'beat'), row(0.35, 'level'), row(-0.8, 'level')]) {
      expect(run(mapping, 1, input)).toEqual(run(mapping, undefined, input))
    }
  })

  it('scales a Beat Rate: 25% at Strength 200% jumps on every other hit, and the Rate caps at 100%', () => {
    const input = frames(6)
    const hits = input.filter((f) => f.onset).length
    expect(count(run(row(0.25, 'beat'), 2, input))).toBe(hits / 2)
    expect(count(run(row(0.5, 'beat'), 1, input))).toBe(hits / 2)
    // 50% at 400% would be 200%: every hit, no more.
    expect(count(run(row(0.5, 'beat'), 4, input))).toBe(hits)
    expect(count(run(row(1, 'beat'), 1, input))).toBe(hits)
  })

  it('scales a continuous Rate', () => {
    const seconds = 10
    const input = frames(seconds)
    const jumps = count(run(row(0.1, 'level'), 3, input))
    expect(jumps).toBe(count(run(row(0.3, 'level'), 1, input)))
    expect(jumps).toBeCloseTo(0.3 * JUMP_LIMITS.maxRate * seconds, -1)
    expect(count(run(row(0.1, 'level'), 1, input))).toBeLessThan(jumps / 2)
  })

  it('makes no jumps at Strength 0', () => {
    const input = frames(6)
    expect(count(run(row(1, 'beat'), 0, input))).toBe(0)
    expect(count(run(row(1, 'level'), 0, input))).toBe(0)
  })
})
