// The Sound tab's 42 s test track (scripts/test-track.ts, rendered in memory) through the emulated analyser
// (tests/helpers/audio.ts) at its own 44.1 kHz, ideal and browser-like: each section reads as the track's header
// says it should. Section means skip the first 0.3 s, while the features settle.

import { describe, expect, it } from 'vitest'
import { encodeWav, renderTestTrack } from '../../scripts/test-track'
import { analyse, between, mean, rises, type ProbedFrame, type Rig } from '../helpers/audio'

const RIGS: [string, Rig][] = [
  ['ideal analyser', { sr: 44100, fps: 60 }],
  ['browser-like analyser', { sr: 44100, fps: 60, jitterMs: 1, quantum: 128 }],
]

type Key = 'level' | 'bass' | 'mids' | 'treble' | 'brightness' | 'pitch' | 'activity' | 'pan'

const track = renderTestTrack()
const left = Float64Array.from(track.left, (v) => v / 32768)
const right = Float64Array.from(track.right, (v) => v / 32768)

describe.each(RIGS)('test track: %s', (_, rig) => {
  let analysed: ProbedFrame[] | null = null
  const frames = () => (analysed ??= analyse(left, right, rig))
  const section = (a: number, b: number) => between(frames(), (a + 0.3) * 1000, b * 1000)
  const avg = (a: number, b: number, key: Key) => mean(section(a, b).map((f) => f[key]))
  const perSecond = (a: number, b: number, test: (f: ProbedFrame) => boolean) => section(a, b).filter(test).length / (b - a - 0.3)

  it('is the same file the Sound tab offers', () => {
    expect(encodeWav(track).length).toBe(7_408_844)
  })

  it('0-4 s, kick only: bass, about 2 beats and 2 kicks a second', () => {
    expect(avg(0, 4, 'bass') - avg(0, 4, 'treble')).toBeGreaterThan(0.4)
    expect(perSecond(0, 4, (f) => f.onset)).toBeCloseTo(2, 0)
    expect(perSecond(0, 4, (f) => f.kick)).toBeCloseTo(2, 0)
  })

  it('4-8 s, kick and hi-hats at 8 a second: treble and bright, 8 beats and 2 kicks a second', () => {
    expect(avg(4, 8, 'treble')).toBeGreaterThan(0.6)
    expect(avg(4, 8, 'brightness')).toBeGreaterThan(0.9)
    expect(Math.abs(perSecond(4, 8, (f) => f.onset) - 8)).toBeLessThanOrEqual(1)
    expect(perSecond(4, 8, (f) => f.kick)).toBeCloseTo(2, 0)
  })

  it('8-12 s, kick and a mid chord: mids, and calm', () => {
    expect(avg(8, 12, 'mids')).toBeGreaterThan(0.9)
    expect(avg(8, 12, 'mids') - avg(8, 12, 'treble')).toBeGreaterThan(0.8)
    expect(avg(8, 12, 'activity')).toBeLessThan(0.5)
  })

  it('reads the busy sections as busier than the chord: Activity', () => {
    const calm = avg(8, 12, 'activity')
    for (const [a, b] of [
      [4, 8],
      [15.5, 21.5],
      [21.5, 26],
      [32, 38],
    ]) {
      const busy = avg(a, b, 'activity')
      expect(busy, `${a}-${b} s`).toBeGreaterThan(0.6)
      expect(busy, `${a}-${b} s`).toBeGreaterThanOrEqual(1.5 * calm)
    }
  })

  it('12-15.5 s, silence: silent, no beats', () => {
    const quiet = section(12, 15.5)
    expect(quiet.every((f) => f.silent)).toBe(true)
    expect(quiet.filter((f) => f.onset || f.kick)).toEqual([])
  })

  it('15.5-21.5 s, full mix: kicks and hats', () => {
    expect(perSecond(15.5, 21.5, (f) => f.kick)).toBeCloseTo(2, 0)
    expect(Math.abs(perSecond(15.5, 21.5, (f) => f.onset) - 8)).toBeLessThanOrEqual(1)
  })

  it('21.5-26 s, hi-hats only: treble, no bass, no kicks', () => {
    expect(avg(21.5, 26, 'treble')).toBeGreaterThan(0.8)
    expect(avg(21.5, 26, 'bass')).toBeLessThan(0.05)
    expect(perSecond(21.5, 26, (f) => f.kick)).toBe(0)
  })

  it('26-32 s, the melody A2 A3 A4 A5 A4 A3: Pitch steps a fifth of its range an octave', () => {
    const expected = [0.2, 0.4, 0.6, 0.8, 0.6, 0.4, 0.2, 0.4, 0.6, 0.8, 0.6, 0.4]
    const notes = expected.map((_, i) => mean(between(frames(), (26.15 + i / 2) * 1000, (26.45 + i / 2) * 1000).map((f) => f.pitch)))
    notes.forEach((pitch, i) => expect(pitch, `note ${i + 1}`).toBeCloseTo(expected[i], 1))
    expect(avg(26, 32, 'pan')).toBeCloseTo(0, 2)
  })

  it('26-32 s, the melody: a Melody pulse on each of the 11 note changes, and a sure pitch; none on the hats before', () => {
    const changes = rises(between(frames(), 26000, 32000))
    expect(Math.abs(changes.length - 11), changes.map((f) => (f.time / 1000).toFixed(2)).join(' ')).toBeLessThanOrEqual(1)
    expect(mean(changes.map((f) => f.melody))).toBeGreaterThan(0.8)
    expect(mean(section(26, 32).map((f) => f.pitchConfidence))).toBeGreaterThan(0.6)
    expect(rises(between(frames(), 21500, 26000))).toEqual([])
  })

  it('32-38 s, hats switching side every half second: Pan about -0.45, +0.45 and so on', () => {
    for (let i = 0; i < 12; i++) {
      const t = 32 + i / 2
      const pan = mean(between(frames(), (t + 0.25) * 1000, (t + 0.5) * 1000).map((f) => f.pan))
      expect(pan * (i % 2 ? 1 : -1), `${t} s`).toBeGreaterThan(0.35)
      expect(Math.abs(pan), `${t} s`).toBeLessThan(0.6)
    }
  })

  it('38-42 s, unrelated noise left and right: wide, but Pan stays centred', () => {
    expect(Math.abs(avg(38, 42, 'pan'))).toBeLessThan(0.05)
    expect(mean(section(38, 42).map((f) => Math.abs(f.pan)))).toBeLessThan(0.05)
    expect(avg(38, 42, 'brightness')).toBeGreaterThan(0.9)
  })
})
