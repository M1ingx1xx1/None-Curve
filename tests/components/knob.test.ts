// The Sound tab's knobs (src/components/Knob.tsx): values on the step, the pointer's angle, and the lit ticks.

import { describe, expect, it } from 'vitest'
import { KNOB_SWEEP, KNOB_TICKS, knobAngle, litTicks, snapKnob } from '../../src/components/Knob'

describe('knob values', () => {
  it('clamps to the range and rounds to the step, as the sliders it replaces', () => {
    expect(snapKnob(150.4, 20, 1000, 1)).toBe(150)
    expect(snapKnob(1200, 20, 1000, 1)).toBe(1000)
    expect(snapKnob(-30, -24, 24, 1)).toBe(-24)
    expect(snapKnob(0.304, 0, 4, 0.01)).toBe(0.3)
    expect(snapKnob(-0.6, -100, 100, 1)).toBe(-1)
  })

  it('turns from −135° at the minimum to +135° at the maximum', () => {
    expect(knobAngle(0, 0, 100)).toBe(-KNOB_SWEEP)
    expect(knobAngle(100, 0, 100)).toBe(KNOB_SWEEP)
    expect(knobAngle(0, -100, 100)).toBe(0)
    expect(knobAngle(500, 0, 100)).toBe(KNOB_SWEEP)
  })
})

describe('knob ticks', () => {
  const count = (lit: boolean[]) => lit.filter(Boolean).length
  const centre = (KNOB_TICKS - 1) / 2

  it('lights from the first tick up to the value', () => {
    expect(litTicks(0, 0, 100)).toHaveLength(KNOB_TICKS)
    expect(count(litTicks(0, 0, 100))).toBe(1)
    expect(count(litTicks(50, 0, 100))).toBe(centre + 1)
    expect(count(litTicks(100, 0, 100))).toBe(KNOB_TICKS)
  })

  it('lights a bipolar knob from the centre, to either side', () => {
    const zero = litTicks(0, -100, 100, true)
    expect(count(zero)).toBe(1)
    expect(zero[centre]).toBe(true)
    const up = litTicks(100, -100, 100, true)
    expect(up.slice(centre).every(Boolean)).toBe(true)
    expect(up.slice(0, centre).some(Boolean)).toBe(false)
    const down = litTicks(-50, -100, 100, true)
    expect(down[0]).toBe(false)
    expect(down[centre]).toBe(true)
    expect(down[centre + 1]).toBe(false)
    expect(count(down)).toBe(centre / 2 + 1)
  })
})
