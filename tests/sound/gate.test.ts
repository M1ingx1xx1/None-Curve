// The Beat detectors' energy-novelty gate (SOUND_LIMITS.onsetRiseDb): an onset counts only while some band's energy
// rises. A sustained buzzy bass makes the kick band's flux pulse as its harmonics beat inside the analyser's window,
// which used to fire Beat several times a second; kicks over such a hum must still be caught. On an ideal analyser
// and on a browser-like one (render quanta, frame jitter).

import { describe, expect, it } from 'vitest'
import {
  analyse,
  drumHits,
  from,
  harmonics,
  hits,
  hitTimes,
  mix,
  pink,
  reseed,
  score,
  sine,
  square,
  type ProbedFrame,
  type Rig,
} from '../helpers/audio'

const SECONDS = 8
const RIGS: [string, Rig][] = [
  ['ideal analyser', {}],
  ['browser-like analyser', { jitterMs: 1, quantum: 128 }],
]

/** Pulse restarts a second (an onset or the kick detector), from 1 s in. */
const restartsPerSecond = (frames: ProbedFrame[]) =>
  from(frames, 1000).filter((f) => f.onset || f.kick).length / (SECONDS - 1)

/** Sustained low sounds that must not read as beats. */
const STEADY: [string, () => Float64Array][] = [
  ['sawtooth 41.2 Hz', () => harmonics(41.2, -12, SECONDS)],
  ['sawtooth 55 Hz', () => harmonics(55, -12, SECONDS)],
  ['sawtooth 80 Hz', () => harmonics(80, -12, SECONDS)],
  ['sawtooth 110 Hz', () => harmonics(110, -12, SECONDS)],
  ['6 harmonics of 45 Hz', () => harmonics(45, -12, SECONDS, 6, 0.3)],
  ['6 harmonics of 60 Hz', () => harmonics(60, -12, SECONDS, 6, 0.3)],
  ['square 55 Hz', () => square(55, -12, SECONDS)],
  ['sine 45 Hz', () => sine(45, -12, SECONDS)],
  ['sine 60 Hz', () => sine(60, -12, SECONDS)],
  ['pink noise', () => (reseed(14), pink(-20, SECONDS))],
]

/** Kicks at 2 a second over a hum. */
const KICK_TIMES = hitTimes(2, SECONDS)
const kicks = () => drumHits(KICK_TIMES, SECONDS, -6)
const OVER_HUM: [string, () => Float64Array][] = [
  ['kicks alone', kicks],
  ['kicks over a 45 Hz sine', () => mix(kicks(), sine(45, -12, SECONDS))],
  ['kicks over a 60 Hz sine', () => mix(kicks(), sine(60, -12, SECONDS))],
  ['kicks over an 80 Hz sine', () => mix(kicks(), sine(80, -12, SECONDS))],
  ['kicks over 6 harmonics of 45 Hz', () => mix(kicks(), harmonics(45, -12, SECONDS, 6, 0.3))],
]

/** Each signal made once, for both analysers. */
const made = new Map<string, Float64Array>()
const signalOf = (name: string, make: () => Float64Array) => {
  let signal = made.get(name)
  if (!signal) made.set(name, (signal = make()))
  return signal
}

describe.each(RIGS)('Beat gate: %s', (_, rig) => {
  it.each(STEADY)('a sustained %s stays under 0.5 beats a second', (name, make) => {
    expect(restartsPerSecond(analyse(signalOf(name, make), null, rig))).toBeLessThan(0.5)
  })

  it.each(OVER_HUM)('%s: at least 85% caught, under 0.5 false beats a second', (name, make) => {
    const frames = analyse(signalOf(name, make), null, rig)
    const { recall, falsePerSecond } = score(hits(frames, 1000), KICK_TIMES, 1000, frames[frames.length - 1].time)
    expect(recall).toBeGreaterThanOrEqual(0.85)
    expect(falsePerSecond).toBeLessThan(0.5)
  })

  // Under a full sawtooth (every harmonic up to Nyquist) the gate also holds back some real kicks (half of them on
  // the ideal analyser): a known limit of the fix. What must not come back is the stream of false beats.
  it('kicks over a 55 Hz sawtooth: under 0.5 false beats a second', () => {
    const frames = analyse(
      signalOf('kicks over a 55 Hz sawtooth', () => mix(kicks(), harmonics(55, -12, SECONDS))),
      null,
      rig,
    )
    const { recall, falsePerSecond } = score(hits(frames, 1000), KICK_TIMES, 1000, frames[frames.length - 1].time)
    expect(falsePerSecond).toBeLessThan(0.5)
    expect(recall).toBeGreaterThan(0)
  })
})
