// Packed feature frames (src/sound/timelineTypes.ts): a frame survives packFrame → unpackFrame exactly.

import { describe, expect, it } from 'vitest'
import { FEATURE_FIELDS, FEATURE_STRIDE, packFrame, unpackFrame } from '../../src/sound/timelineTypes'
import { SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'

const loud: FeatureFrame = {
  time: 123,
  levelDb: -6.5,
  level: 0.8,
  swell: 0.7,
  bass: 0.9,
  mids: 0.4,
  treble: 0.2,
  brightness: 0.55,
  pitch: 0.375,
  melody: 0.25,
  pitchConfidence: 0.6,
  pitchLow: 0.1,
  pitchHigh: 0.9,
  beat: 1,
  activity: 0.33,
  pan: -0.5,
  onset: true,
  silent: false,
}

describe('packFrame / unpackFrame', () => {
  it('packs every field but time', () => {
    expect(FEATURE_STRIDE).toBe(FEATURE_FIELDS.length)
    expect(new Set([...FEATURE_FIELDS, 'time'])).toEqual(new Set(Object.keys(loud)))
  })

  it('round-trips frames in any row, -Infinity and booleans included', () => {
    const values = new Float64Array(FEATURE_STRIDE * 3)
    packFrame(loud, values, 0)
    packFrame(SILENT_FRAME, values, 2)
    expect(unpackFrame(values, 0, 123)).toEqual(loud)
    expect(unpackFrame(values, 2, SILENT_FRAME.time)).toEqual(SILENT_FRAME)
    // Row 1 was never written: zeros, onset and silent false.
    expect(unpackFrame(values, 1, 50)).toMatchObject({ time: 50, level: 0, onset: false, silent: false })
  })

  it('takes the time from the grid, not the packed frame', () => {
    const values = new Float64Array(FEATURE_STRIDE)
    packFrame(loud, values, 0)
    expect(unpackFrame(values, 0, 999).time).toBe(999)
  })
})
