// The Sound features (src/sound/features.ts) on synthetic signals through an emulated AnalyserNode
// (tests/helpers/audio.ts): silence, tones, white noise, a kick train, hi-hats, and left/right signals for Pan.

import { describe, expect, it } from 'vitest'
import { DEFAULT_FEATURE_SETTINGS, SILENT_FRAME, SOUND_LIMITS } from '../../src/sound/types'
import { analyse, drumHits, from, hiHat, hits, hitTimes, mean, noise, reseed, samplesIn, sine, type ProbedFrame } from '../helpers/audio'

const FEATURES = ['level', 'swell', 'bass', 'mids', 'treble', 'brightness', 'pitch', 'beat', 'activity', 'pan'] as const
const avg = (frames: ProbedFrame[], key: (typeof FEATURES)[number]) => mean(frames.map((f) => f[key]))
const onsets = (frames: ProbedFrame[]) => frames.filter((f) => f.onset).length
const kicks = (frames: ProbedFrame[]) => frames.filter((f) => f.kick).length

describe('sound features', () => {
  it('reads silence as silence: every feature 0, no onsets', () => {
    expect(FEATURES.every((k) => SILENT_FRAME[k] === 0)).toBe(true)
    reseed(1)
    for (const signal of [new Float64Array(samplesIn(3)), noise(-90, 3)]) {
      const frames = analyse(signal)
      expect(frames.every((f) => f.silent)).toBe(true)
      expect(Math.max(...frames.flatMap((f) => FEATURES.map((k) => Math.abs(f[k]))))).toBe(0)
      expect(onsets(frames) + kicks(frames)).toBe(0)
    }
  })

  it('reads a 100 Hz sine as bass and dark, a 5 kHz sine as treble and bright', () => {
    const low = from(analyse(sine(100, -12, 3)), 1000)
    const high = from(analyse(sine(5000, -12, 3)), 1000)
    expect(avg(low, 'bass') - avg(low, 'treble')).toBeGreaterThan(0.5)
    expect(avg(low, 'brightness')).toBeLessThan(0.25)
    expect(avg(high, 'treble') - avg(high, 'bass')).toBeGreaterThan(0.5)
    expect(avg(high, 'brightness')).toBeGreaterThan(0.75)
  })

  it('reads white noise as bright, and fires no beats on it', () => {
    reseed(3)
    const frames = from(analyse(noise(-12, 3)), 500)
    expect(Math.min(...frames.map((f) => f.brightness))).toBeGreaterThan(0.7)
    expect(from(frames, SOUND_LIMITS.onsetWarmupMs).filter((f) => f.onset || f.kick).length).toBeLessThanOrEqual(1)
  })

  it('raises Level with the amplitude, and with Sensitivity', () => {
    const level = (db: number, sensitivity = 0) => avg(from(analyse(sine(1000, db, 1.5), null, { settings: { ...DEFAULT_FEATURE_SETTINGS, sensitivity } }), 500), 'level')
    const levels = [-48, -36, -24, -12].map((db) => level(db))
    expect(levels[0]).toBeGreaterThan(0)
    expect(levels.every((v, i) => i === 0 || v > levels[i - 1])).toBe(true)
    expect(level(-24, 12)).toBeGreaterThan(levels[2] + 0.1)
  })

  it('fires nothing on steady tones after the warm-up', () => {
    for (const freq of [60, 100, 440, 1000, 5000]) {
      const late = from(analyse(sine(freq, -12, 3)), SOUND_LIMITS.onsetWarmupMs)
      expect(onsets(late) + kicks(late), `${freq} Hz`).toBe(0)
    }
  })

  it('catches a kick train at 2 a second on both detectors, with a pulse and higher Activity than a steady tone', () => {
    const seconds = 10
    const expected = hitTimes(2, seconds)
    const frames = analyse(drumHits(expected, seconds))
    expect(onsets(frames) / seconds).toBeCloseTo(2, 0)
    expect(Math.abs(kicks(frames) / seconds - 2)).toBeLessThanOrEqual(0.3)
    expect(hits(frames)).toHaveLength(expected.length)
    // The Beat pulse is 1 on each hit and falls back between them.
    const onFrames = frames.filter((f) => f.onset || f.kick)
    expect(Math.min(...onFrames.map((f) => f.beat))).toBe(1)
    expect(Math.min(...from(frames, 1000).map((f) => f.beat))).toBeLessThan(0.2)
    const steady = from(analyse(sine(60, -12, seconds)), 1000)
    expect(avg(from(frames, 1000), 'activity')).toBeGreaterThan(avg(steady, 'activity') + 0.2)
  })

  it('counts hi-hats at 8 a second as beats but not as kicks', () => {
    reseed(6)
    const seconds = 10
    const frames = analyse(hiHat(8, seconds))
    expect(Math.abs(onsets(frames) / seconds - 8)).toBeLessThanOrEqual(1.6)
    expect(kicks(frames) / seconds).toBeLessThan(0.5)
  })

  it('reads Pan from the left and right channels', () => {
    reseed(12)
    const tone = sine(440, -12, 3)
    const quiet = new Float64Array(tone.length)
    const pan = (left: Float64Array, right: Float64Array, stereo = true) => avg(from(analyse(left, right, { stereo }), 1500), 'pan')
    expect(pan(tone, quiet)).toBeLessThan(-0.99)
    expect(pan(quiet, tone)).toBeGreaterThan(0.99)
    expect(Math.abs(pan(tone, tone))).toBeLessThan(1e-9)
    // -6 dB on the left: (1 - 0.5) / (1 + 0.5).
    expect(pan(tone.map((v) => v / 2), tone)).toBeCloseTo(1 / 3, 2)
    expect(Math.abs(pan(noise(-20, 3), noise(-20, 3)))).toBeLessThan(0.05)
    // Without the channels, Pan reads 0.
    expect(pan(tone, quiet, false)).toBe(0)
  })
})
