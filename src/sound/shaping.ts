// A mapping's shaping over time: Smooth, Trigger's pulse and Toggle's state, from the measured frames (see
// Shaping in mapping.ts). Pure: no React, no DOM, no Web Audio.
//
// Each frame, every enabled mapping's feature becomes one shaped value, in this order:
// - Follow: the Gate, then Smooth (a one-pole smoothing with time constant Smooth), then the Curve;
// - Trigger: a rise past the Gate starts a pulse at 1 that falls back to 0 in a straight line over Smooth (at least
//   SHAPING_LIMITS.pulseMs), then the Curve;
// - Toggle: a rise past the Gate flips a state between 0 and 1, eased by Smooth, then the Curve.
// A rise is the feature going above its firing level (the Gate, but at least SHAPING_LIMITS.minFire) after it had fallen
// SHAPING_LIMITS.rearm below that level; with Beat (an event feature), every hit is a rise. modulate() puts the shaped value in place of the feature value on a
// slider; on a seed, JumpTracker reads Follow's shaped value as the feature and counts each rise in Trigger and Toggle
// as one jump.
//
// Time comes from frame.time only (a gap counts as at most SHAPING_LIMITS.maxStepMs), so the same frames always give
// the same values: live, in a recording, or in a test run over the test track. Everything starts from 0 (smoothing,
// pulse, toggle) when a mapping first drives, when its Mode or Feature changes, and after reset(): Sound stopped
// driving (pause, Drive letters off) or the file was sought (LiveScheduler.seeked).

import { curveValue, featureById, featureValue, gateValue, SHAPING_LIMITS, shapingOf, targetById, type Mapping } from './mapping'
import { SILENT_FRAME, type FeatureFrame } from './types'

/** One frame's shaping: the shaped value of every enabled mapping, and the mappings that rose past their Gate. */
export interface ShapedFrame {
  /** Shaped feature value by mapping id (−1…1 for Pan, else 0…1). */
  values: ReadonlyMap<string, number>
  /** Mapping ids whose feature rose past the Gate in this frame (every mode; Trigger and Toggle act on them). */
  rises: ReadonlySet<string>
}

export const NO_SHAPING: ShapedFrame = { values: new Map(), rises: new Set() }

interface MappingState {
  /** The Mode and Feature this state was built for: a change of either starts the mapping afresh. */
  mode: Mapping['mode']
  feature: Mapping['feature']
  /** The smoothed value (Follow, Toggle). */
  smooth: number
  /** A rise can fire: the feature has fallen far enough below the Gate since the last one. */
  armed: boolean
  /** Trigger's pulse, 1 at a rise falling to 0. */
  pulse: number
  /** Toggle's state, 0 or 1. */
  toggled: number
}

/**
 * The shaped values of every enabled mapping (see the file comment). Feed it every measured frame while Sound can
 * drive the letters, before JumpTracker; modulate() and JumpTracker take what it returns.
 */
export class ShapingTracker {
  private states = new Map<string, MappingState>()
  private current: ShapedFrame = NO_SHAPING
  private lastTime: number | null = null

  /**
   * Advances with one measured frame and returns its shaped values. SILENT_FRAME / time <= 0: no change. A frame
   * earlier than the last (the clock went back) starts afresh, as reset() does.
   */
  advance(frame: FeatureFrame, mappings: readonly Mapping[]): ShapedFrame {
    if (frame === SILENT_FRAME || !(frame.time > 0)) return this.current
    if (this.lastTime !== null && frame.time < this.lastTime) this.reset()
    const dt = this.lastTime === null ? 0 : Math.min(SHAPING_LIMITS.maxStepMs, frame.time - this.lastTime)
    this.lastTime = frame.time
    const values = new Map<string, number>()
    const rises = new Set<string>()
    const seen = new Set<string>()
    for (const mapping of mappings) {
      if (!mapping.enabled || !targetById(mapping.target)) continue
      seen.add(mapping.id)
      const shaping = shapingOf(mapping)
      const raw = featureValue(frame, mapping.feature)
      let state = this.states.get(mapping.id)
      if (!state || state.mode !== shaping.mode || state.feature !== mapping.feature) {
        state = { mode: shaping.mode, feature: mapping.feature, smooth: 0, armed: true, pulse: 0, toggled: 0 }
        this.states.set(mapping.id, state)
      }

      // A rise past the Gate: with an event feature (Beat) each hit; else above the firing level once re-armed below
      // it. The band never closes, so a feature that never reaches exactly 0 still re-arms at a low Gate.
      const event = featureById(mapping.feature)?.event
      let rose = false
      if (event) {
        rose = frame[event] === true
      } else {
        const size = Math.abs(raw)
        const fire = Math.max(shaping.gate, SHAPING_LIMITS.minFire)
        if (state.armed && size > fire) {
          rose = true
          state.armed = false
        } else if (!state.armed && size <= fire - SHAPING_LIMITS.rearm) {
          state.armed = true
        }
      }
      if (rose) rises.add(mapping.id)

      let value: number
      if (shaping.mode === 'trigger') {
        const fall = Math.max(shaping.smoothMs, SHAPING_LIMITS.pulseMs)
        state.pulse = rose ? 1 : Math.max(0, state.pulse - dt / fall)
        value = state.pulse
      } else {
        if (shaping.mode === 'toggle' && rose) state.toggled = 1 - state.toggled
        const target = shaping.mode === 'toggle' ? state.toggled : gateValue(raw, shaping.gate)
        // Smooth 0: the value itself, bit for bit (no smoothing arithmetic at the default).
        state.smooth = shaping.smoothMs > 0 ? state.smooth + (target - state.smooth) * (1 - Math.exp(-dt / shaping.smoothMs)) : target
        value = state.smooth
      }
      values.set(mapping.id, curveValue(value, shaping.curve))
    }
    // Mappings that are gone or switched off start afresh when they come back.
    for (const id of this.states.keys()) if (!seen.has(id)) this.states.delete(id)
    this.current = { values, rises }
    return this.current
  }

  get shaped(): ShapedFrame {
    return this.current
  }

  /** Forgets every smoothing, pulse and toggle (Sound stopped driving, or the file was sought): all start from 0. */
  reset(): void {
    this.states.clear()
    this.lastTime = null
    this.current = NO_SHAPING
  }
}
