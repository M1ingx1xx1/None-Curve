// The Sound features (src/sound/features.ts) on synthetic signals through an emulated AnalyserNode
// (tests/helpers/audio.ts): silence, tones, white noise, a kick train, hi-hats, left/right signals for Pan, and
// melodies, glides and vibrato for Melody, the pitch confidence and the melody range.

import { describe, expect, it } from 'vitest'
import { analyserFftSize, FeatureExtractor } from '../../src/sound/features'
import { DEFAULT_FEATURE_SETTINGS, SILENT_FRAME, SOUND_LIMITS } from '../../src/sound/types'
import {
  analyse,
  between,
  drumHits,
  from,
  fromDb,
  glide,
  harmonics,
  hiHat,
  hits,
  hitTimes,
  mean,
  mix,
  noise,
  notes,
  reseed,
  rises,
  samplesIn,
  sine,
  SR,
  tone,
  vibrato,
  type ProbedFrame,
} from '../helpers/audio'

const FEATURES = ['level', 'swell', 'bass', 'mids', 'treble', 'brightness', 'pitch', 'melody', 'pitchConfidence', 'beat', 'activity', 'pan'] as const
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

describe('Release, pitch confidence and Melody', () => {
  /** `f` moved by `st` semitones. */
  const semitones = (f: number, st: number) => f * 2 ** (st / 12)

  it('lets the readings fall to 1/e after the Release time', () => {
    for (const releaseMs of [150, 300, 600]) {
      const signal = new Float64Array(samplesIn(3))
      signal.set(sine(440, -12, 1))
      const frames = analyse(signal, null, { settings: { ...DEFAULT_FEATURE_SETTINGS, releaseMs } })
      // The first frame whose window holds no sound: Level's target is 0 from there on.
      const start = frames.findIndex((f) => f.silent)
      const after = frames.find((f) => f.time >= frames[start].time + releaseMs - 1e-6)!
      const ratio = after.level / frames[start].level
      expect(ratio, `${releaseMs} ms`).toBeCloseTo(Math.exp(-(after.time - frames[start].time) / releaseMs), 9)
      expect(ratio, `${releaseMs} ms`).toBeCloseTo(1 / Math.E, 2)
    }
  })

  it('is sure of a sine and not of noise; a quiet note counts less', () => {
    expect(mean(from(analyse(sine(220, -12, 2)), 300).map((f) => f.pitchConfidence))).toBeGreaterThan(0.8)
    expect(mean(from(analyse(sine(880, -20, 2)), 300).map((f) => f.pitchConfidence))).toBeGreaterThan(0.8)
    reseed(21)
    expect(mean(from(analyse(noise(-20, 2)), 300).map((f) => f.pitchConfidence))).toBeLessThan(0.2)
    // -48 dBFS: Level about 0.2, under half of confidenceFullLevel.
    const quiet = mean(from(analyse(sine(220, -48, 2)), 300).map((f) => f.pitchConfidence))
    expect(quiet).toBeGreaterThan(0.2)
    expect(quiet).toBeLessThan(0.6)
  })

  it('pulses once, to full, on a 2 semitone step up or down', () => {
    for (const [a, st] of [
      [220, 2],
      [440, -2],
      [110, 2],
    ]) {
      const frames = analyse(notes([a, semitones(a, st)], 1000, -12))
      const pulses = rises(frames)
      expect(pulses, `${a} Hz ${st} st`).toHaveLength(1)
      // After the move has held for melodyHoldMs (and the analysis window has moved onto the new note).
      expect(pulses[0].time).toBeGreaterThan(1000 + SOUND_LIMITS.melodyHoldMs)
      expect(pulses[0].time).toBeLessThan(1150)
      expect(pulses[0].melody).toBeGreaterThanOrEqual(0.9)
      // Then it falls with Release.
      expect(between(frames, 1500, 2000).every((f) => f.melody < 0.1)).toBe(true)
    }
    // Half a full step: a smaller pulse.
    const small = rises(analyse(notes([220, semitones(220, 0.75)], 1000, -12)))
    expect(small).toHaveLength(1)
    expect(small[0].melody).toBeCloseTo(0.75 / SOUND_LIMITS.melodyFullSt, 1)
  })

  it('does not pulse on a steady note, vibrato, noise, the first note after silence, or a one-frame octave error', () => {
    const none = (frames: ProbedFrame[], name: string) => expect(Math.max(...frames.map((f) => f.melody)), name).toBe(0)
    for (const freq of [110, 220, 880]) none(analyse(sine(freq, -12, 2)), `${freq} Hz`)
    for (const freq of [110, 220, 440, 880]) {
      none(analyse(vibrato(freq, 30, 5.5, 3, -12)), `vibrato at ${freq} Hz`)
      none(analyse(vibrato(freq, 30, 5.5, 3, -12), null, { jitterMs: 1, quantum: 128 }), `vibrato at ${freq} Hz, browser-like`)
    }
    reseed(22)
    none(analyse(noise(-20, 3)), 'noise')
    // A note, half a second of silence, and a note 7 semitones higher: the new note starts afresh.
    const later = new Float64Array(samplesIn(3))
    later.set(sine(semitones(220, 7), -12, 1.5), samplesIn(1.5))
    none(analyse(mix(sine(220, -12, 1), later)), 'after silence')
    // One frame's window an octave up: Pitch reads it, Melody does not.
    const blip = analyse(sine(220, -12, 2), null, {
      edit: (frame, samples) => {
        if (frame === 60) for (let i = 0; i < samples.length; i++) samples[i] = fromDb(-12) * Math.sin((2 * Math.PI * 440 * i) / SR)
      },
    })
    expect(blip[59].pitch - blip[58].pitch).toBeGreaterThan(0.05)
    none(blip, 'octave error')
  })

  // Browser-like frames at the display's refresh rate: what reaches Melody must not depend on it.
  const browser = (fps: number) => ({ fps, jitterMs: 1, quantum: 128 })

  it('does not pulse on a kick drum under a held note, at any refresh rate', () => {
    // YIN reads the kick for a few overlapping windows (down, then back up to the note): never a new note.
    for (const freq of [220, 330]) {
      for (const kickDb of [-8, -14]) {
        const signal = mix(harmonics(freq, -14, 4, 6), drumHits(hitTimes(2, 4), 4, kickDb))
        for (const fps of [60, 75, 90, 120, 144]) {
          expect(rises(analyse(signal, null, browser(fps))), `${freq} Hz, kicks at ${kickDb} dB, ${fps} fps`).toHaveLength(0)
        }
      }
    }
  })

  it('does not pulse on a held note with a singer\'s vibrato of ±50 or ±80 cents', () => {
    for (const cents of [50, 80]) {
      for (const fps of [60, 120]) {
        const pulses = rises(analyse(vibrato(330, cents, 5.5, 3, -12), null, browser(fps)))
        expect(pulses.length, `±${cents} cents, ${fps} fps`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('does not pulse on a note that slides into its pitch after silence', () => {
    const semitone = (seconds: number, from: number) => (t: number) => (t < seconds ? semitones(330, -from * (1 - t / seconds)) : 330)
    for (const [from, seconds] of [
      [1, 0.04],
      [1, 0.08],
    ]) {
      const signal = new Float64Array(samplesIn(2))
      signal.set(tone(semitone(seconds, from), -12, 1.5), samplesIn(0.3))
      for (const fps of [60, 120]) {
        expect(Math.max(...analyse(signal, null, browser(fps)).map((f) => f.melody)), `${from} st over ${seconds * 1000} ms, ${fps} fps`).toBe(0)
      }
    }
  })

  it('pulses a few times along a glide of 3 semitones in a second', () => {
    for (const base of [110, 220, 523]) {
      const signal = new Float64Array(samplesIn(2.5))
      signal.set(sine(base, -12, 0.5))
      const rising = glide(base, semitones(base, 3), 1, -12)
      // Phase-continuous enough: each part starts at a zero crossing.
      signal.set(rising, samplesIn(0.5))
      signal.set(sine(semitones(base, 3), -12, 1), samplesIn(1.5))
      const count = rises(from(analyse(signal), 100)).length
      expect(count, `${base} Hz`).toBeGreaterThanOrEqual(3)
      expect(count, `${base} Hz`).toBeLessThanOrEqual(6)
    }
  })

  it('forgets the note and the pulse on reset', () => {
    const extractor = new FeatureExtractor(SR, analyserFftSize(SR))
    const first = analyse(notes([220, semitones(220, 2)], 300, -12), null, { extractor })
    expect(first[first.length - 1].melody).toBeGreaterThan(0.05)
    const next = notes([semitones(220, 7)], 600, -12)
    const clockMs = first[first.length - 1].time
    // Going on without a reset, the new note pulses...
    const control = new FeatureExtractor(SR, analyserFftSize(SR))
    analyse(notes([220, semitones(220, 2)], 300, -12), null, { extractor: control })
    expect(rises(analyse(next, null, { extractor: control, clockMs }))).toHaveLength(1)
    // ...after one, it is the first note.
    extractor.reset()
    const after = analyse(next, null, { extractor, clockMs })
    expect(after[0].melody).toBe(0)
    expect(Math.max(...after.map((f) => f.melody))).toBe(0)
    // The confidence starts again too: the first window, mostly from before the signal, is unvoiced.
    expect(after[0].pitchConfidence).toBe(0)
  })
})

describe('the melody range (pitchLow, pitchHigh)', () => {
  /** Where a frequency sits on Pitch (55 to 1760 Hz, 0 to 1): an octave is a fifth of it. */
  const place = (hz: number) => Math.log2(hz / 55) / 5
  const OCTAVE = SOUND_LIMITS.melodyRangeMinSt / 60
  const C4 = 261.63
  const C5 = 523.25
  const C6 = 1046.5
  const G5 = 783.99
  const G6 = 1567.98
  const leaps = (low: number, high: number, count: number) => [...Array(count)].map((_, k) => (k % 2 ? high : low))
  const rangeOf = (frames: ProbedFrame[], time: number) => {
    const f = frames.find((frame) => frame.time >= time)!
    return [f.pitchLow, f.pitchHigh]
  }
  const near = (frames: ProbedFrame[], low: number, high: number, within: number, name: string) => {
    for (const f of frames) {
      expect(Math.abs(f.pitchLow - low), `${name} at ${f.time.toFixed(0)} ms: low`).toBeLessThan(within)
      expect(Math.abs(f.pitchHigh - high), `${name} at ${f.time.toFixed(0)} ms: high`).toBeLessThan(within)
    }
  }

  it('is the whole of Pitch without a note, on noise, hi-hats, or the lowest and highest notes Pitch reads', () => {
    expect([SILENT_FRAME.pitchLow, SILENT_FRAME.pitchHigh]).toEqual([0, 1])
    reseed(5)
    const signals: [string, Float64Array][] = [
      ['silence', new Float64Array(samplesIn(1))],
      ['noise', noise(-20, 2)],
      ['hi-hats', hiHat(8, 2)],
      ['55 Hz', sine(55, -12, 2)],
      ['1760 Hz', sine(1760, -12, 2)],
    ]
    for (const [name, signal] of signals) near(analyse(signal), 0, 1, 1e-12, name)
  })

  it('is an octave around a held note, kept within Pitch, and not moved by a kick under it or a one-frame octave error', () => {
    near(analyse(sine(330, -12, 2)).filter((f) => f.time > 100), place(330) - OCTAVE / 2, place(330) + OCTAVE / 2, 0.005, '330 Hz')
    near(analyse(sine(65, -12, 2)).filter((f) => f.time > 300), 0, OCTAVE, 0.005, '65 Hz')
    near(analyse(sine(1500, -12, 2)).filter((f) => f.time > 300), 1 - OCTAVE, 1, 0.005, '1500 Hz')
    for (const freq of [220, 330]) {
      for (const db of [-8, -14]) {
        const frames = analyse(mix(harmonics(freq, -14, 4, 6), drumHits(hitTimes(2, 4), 4, db))).filter((f) => f.time > 300)
        near(frames, place(freq) - OCTAVE / 2, place(freq) + OCTAVE / 2, 0.005, `kicks at ${db} dB under ${freq} Hz`)
      }
    }
    const blip = analyse(sine(220, -12, 2), null, {
      edit: (frame, samples) => {
        if (frame === 60) for (let i = 0; i < samples.length; i++) samples[i] = fromDb(-12) * Math.sin((2 * Math.PI * 440 * i) / SR)
      },
    })
    near(blip.filter((f) => f.time > 300), place(220) - OCTAVE / 2, place(220) + OCTAVE / 2, 0.005, 'octave error')
  })

  it('spans a melody from its lowest to its highest note: C4 and C5, 500 ms each', () => {
    const frames = analyse(notes(leaps(C4, C5, 8), 500, -12))
    // The first note alone: an octave around it.
    const [low, high] = rangeOf(frames, 400)
    expect(low).toBeCloseTo(place(C4) - OCTAVE / 2, 2)
    expect(high).toBeCloseTo(place(C4) + OCTAVE / 2, 2)
    // From the third note on: C4 to C5, so each note sits at one end.
    near(frames.filter((f) => f.time > 1300), place(C4), place(C5), 0.015, 'C4 and C5')
    for (const f of frames.filter((f) => f.time > 1300 && f.time % 500 > 250)) {
      const at = (f.pitch - f.pitchLow) / (f.pitchHigh - f.pitchLow)
      expect(Math.min(at, 1 - at), `${f.time.toFixed(0)} ms`).toBeLessThan(0.1)
    }
  })

  it('follows the melody into a new register within seconds, keeps the range over a pause and starts afresh after melodyRangeReleaseMs', () => {
    // C4 and C5 for 4 s, then C5 and C6: the top follows at once, the bottom over a few seconds.
    const moved = analyse(notes([...leaps(C4, C5, 8), ...leaps(C5, C6, 24)], 500, -12))
    expect(rangeOf(moved, 6000)[1]).toBeCloseTo(place(C6), 2)
    expect(rangeOf(moved, 9000)[0]).toBeGreaterThan(place(C4) + 0.05)
    near(moved.filter((f) => f.time > 15_000), place(C5), place(C6), 0.015, 'C5 and C6')
    // C4 and C5 for 2 s, a pause, then G5 and G6.
    const after = (pauseS: number) => {
      const signal = new Float64Array(samplesIn(2 + pauseS + 3))
      signal.set(notes(leaps(C4, C5, 4), 500, -12))
      signal.set(notes(leaps(G5, G6, 6), 500, -12), samplesIn(2 + pauseS))
      return analyse(signal).filter((f) => f.time > (2 + pauseS) * 1000)
    }
    // After 2 s: still the old range, widened up to the new notes.
    const short = after(2)
    expect(short[short.length - 1].pitchLow).toBeLessThan(place(C5))
    expect(short[short.length - 1].pitchHigh).toBeCloseTo(place(G6), 2)
    // After 9 s: the new notes alone.
    near(after(9).filter((f) => f.time > 12_800), place(G5), place(G6), 0.015, 'after a long pause')
  })

  it('forgets the range on reset', () => {
    const extractor = new FeatureExtractor(SR, analyserFftSize(SR))
    analyse(notes(leaps(C4, C5, 4), 500, -12), null, { extractor })
    extractor.reset()
    const frames = analyse(sine(1500, -12, 1), null, { extractor, clockMs: 2000 })
    expect([frames[0].pitchLow, frames[0].pitchHigh]).toEqual([0, 1])
    near(frames.filter((f) => f.time > 2300), 1 - OCTAVE, 1, 0.005, 'after reset')
  })
})
