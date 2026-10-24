// The whole-file plan of a six-minute file (src/sound/planner.ts, NOCUR-85) with every effect's parameters moving
// and the letters on: planned from the start with the playhead at the middle, it stays within planMaxBytes, keeps its
// full commits around the playhead, and a stretch planned again comes back the same.

import { describe, expect, it } from 'vitest'
import type { GeometryParams } from '../../src/geometry/types'
import type { LetterSlots } from '../../src/sound/letters'
import type { LiveInputs } from '../../src/sound/live'
import type { Mapping } from '../../src/sound/mapping'
import { PlaybackPlanner } from '../../src/sound/planner'
import { PRECOMPUTE_LIMITS } from '../../src/sound/timelineTypes'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { BASE as DEFAULTS } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }
const HZ = PRECOMPUTE_LIMITS.gridHz
const SECONDS = 360

const row = (target: string, feature: Mapping['feature']): Mapping => ({
  id: `${target} ${feature}`,
  enabled: true,
  feature,
  target,
  depth: 1,
})

function letters(count: number): LetterSlots {
  return {
    count,
    index: Int32Array.from({ length: count }, (_, j) => j % 5),
    t: Float32Array.from({ length: count }, (_, j) => (j + 0.5) / count),
    share: new Float32Array(count).fill(1 / count),
    active: new Uint8Array(count).fill(1),
    activeCount: count,
  }
}

describe('a six-minute plan', () => {
  it('stays within planMaxBytes and plans a thinned stretch again the same', () => {
    const frames: FeatureFrame[] = Array.from({ length: SECONDS * HZ }, (_, k) => {
      const t = (k * 1000) / HZ
      const v = 0.5 + 0.45 * Math.sin(t / 211) * Math.cos(t / 1777)
      const onset = k % 23 === 0 && k > 0
      return {
        ...SILENT_FRAME,
        time: t,
        level: v,
        bass: v,
        mids: 1 - v,
        treble: v * v,
        brightness: v,
        activity: v,
        beat: onset ? 1 : 0,
        onset,
        silent: false,
        levelDb: -40 + 40 * v,
      }
    })
    const planner = new PlaybackPlanner({
      hz: HZ,
      frameCount: () => frames.length,
      isCovered: () => true,
      frameAt: (i) => frames[i] ?? null,
    })
    const inputs: LiveInputs = {
      base: BASE,
      hasFont: true,
      mappings: [row('distortion.amount', 'level'), row('anchors.spacing', 'treble'), row('palette.inkHue', 'bass')],
      drive: true,
      response: { ...NEUTRAL_RESPONSE, contrast: 1 },
      slots: letters(40),
    }
    planner.setInputs(inputs)
    const middle = (SECONDS * 1000) / 2
    planner.focus(middle)
    planner.ensure(Infinity, Infinity)
    expect(planner.isDone()).toBe(true)
    expect(planner.records().some((r) => !r.full)).toBe(true)
    expect(planner.bytes()).toBeLessThanOrEqual(PRECOMPUTE_LIMITS.planMaxBytes)
    const near = planner.range(middle - 5000, middle + 5000)
    expect(near.length).toBeGreaterThan(200)
    // Back to the start: planned again there, the same as a plan that never thinned.
    const fresh = new PlaybackPlanner({
      hz: HZ,
      frameCount: () => frames.length,
      isCovered: () => true,
      frameAt: (i) => frames[i] ?? null,
    })
    fresh.setInputs(inputs)
    fresh.ensure(10_000, Infinity)
    planner.focus(0)
    planner.ensure(Infinity, Infinity)
    expect(planner.mismatches).toBe(0)
    const again = planner.range(0, 5000)
    expect(again.map((c) => [c.seq - planner.generation * 1e6, c.mediaMs, c.keys])).toEqual(
      fresh.range(0, 5000).map((c) => [c.seq - fresh.generation * 1e6, c.mediaMs, c.keys]),
    )
  })
})
