// The output latency (src/sound/engine.ts, live.ts): a context's base plus output latency, the file's frames held back
// by it so the live path shows them when they are heard (the microphone's not at all), and the delay a recording's audio
// gets, which follows that latency on both paths, so the sound in the video lines up with its letters on a Bluetooth
// headset (about 200 ms) as on built-in speakers. Also the state listeners that skip position ticks.

import { describe, expect, it } from 'vitest'
import { contextLatencyMs, FrameDelay, subscribeStateKeys, type SoundStateSource } from '../../src/sound/engine'
import { soundToLettersMs } from '../../src/sound/live'
import { INITIAL_SOUND_STATE, SILENT_FRAME, type FeatureFrame, type SoundState } from '../../src/sound/types'

const FRAME_MS = 1000 / 60

const frameAt = (time: number): FeatureFrame => ({ ...SILENT_FRAME, time, level: 0.5, silent: false })

/** Runs a 60 Hz frame loop for `ms`, measuring a frame each tick held by `delayMs`; returns what left, and when. */
function loop(delayMs: number, ms: number) {
  const held = new FrameDelay()
  const out: { at: number; measured: number; time: number }[] = []
  for (let now = 1000; now < 1000 + ms; now += FRAME_MS) {
    held.push(frameAt(now), delayMs)
    for (let due = held.next(now); due; due = held.next(now))
      out.push({ at: now, measured: due.time - delayMs, time: due.time })
  }
  return { held, out }
}

describe('output latency', () => {
  it('adds the base and output latency, in ms, and reads 0 without them', () => {
    expect(contextLatencyMs({ baseLatency: 0.01, outputLatency: 0.2 })).toBeCloseTo(210, 9)
    // Safari has no outputLatency.
    expect(contextLatencyMs({ baseLatency: 0.005 })).toBeCloseTo(5, 9)
    expect(contextLatencyMs({})).toBe(0)
    expect(contextLatencyMs(null)).toBe(0)
    expect(contextLatencyMs({ baseLatency: Number.NaN, outputLatency: 0.02 })).toBeCloseTo(20, 9)
  })

  it('holds the file’s frames until they are heard, and sends them in order with that time', () => {
    const { out } = loop(210, 1000)
    expect(out.length).toBeGreaterThan(40)
    for (const frame of out) {
      // On the animation frame nearest the moment the frame is heard.
      expect(Math.abs(frame.at - frame.time)).toBeLessThanOrEqual(FRAME_MS / 2 + 1e-9)
      expect(frame.time - frame.measured).toBeCloseTo(210, 9)
    }
    for (let i = 1; i < out.length; i++) expect(out[i].time).toBeGreaterThan(out[i - 1].time)
  })

  it('keeps the times non-decreasing when the latency drops mid-play', () => {
    const held = new FrameDelay()
    const out: number[] = []
    let delay = 200
    for (let now = 1000; now < 1400; now += FRAME_MS) {
      // Bluetooth to built-in speakers at 1200 ms: new frames would be due 190 ms before the queued ones.
      if (now >= 1200) delay = 10
      held.push(frameAt(now), delay)
      for (let due = held.next(now); due; due = held.next(now)) out.push(due.time)
    }
    expect(out.length).toBeGreaterThan(10)
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
  })

  it('sends a frame at once with no latency (the microphone), and keeps it as it is', () => {
    const held = new FrameDelay()
    const frame = frameAt(5)
    held.push(frame, 0)
    expect(held.next(5)).toBe(frame)
    expect(held.next(5)).toBeNull()
  })

  it('drops the held frames when cleared', () => {
    const { held } = loop(200, 500)
    held.clear()
    expect(held.next(1e9)).toBeNull()
  })

  it('delays a recording’s audio by the output latency while planned commits show', () => {
    // Built-in speakers (about 10 ms): one frame, at least the tap's 40 ms, as before.
    expect(soundToLettersMs(true, null, 10)).toBe(40)
    expect(soundToLettersMs(true, 12, 0)).toBe(40)
    // A Bluetooth headset: the letters show the sound as heard, about 200 ms after the tap takes it.
    expect(soundToLettersMs(true, null, 210)).toBeCloseTo(210 + FRAME_MS, 9)
  })

  it('adds the output latency to the live path’s delay for the file, and nothing for the microphone', () => {
    expect(soundToLettersMs(false, null, 210)).toBeNull()
    expect(soundToLettersMs(false, 30, 210)).toBe(240)
    expect(soundToLettersMs(false, 30, 0)).toBe(30)
    expect(soundToLettersMs(false, 30, Number.NaN)).toBe(30)
  })
})

describe('subscribeStateKeys', () => {
  function fakeSource() {
    let state: SoundState = INITIAL_SOUND_STATE
    const listeners = new Set<() => void>()
    const source: SoundStateSource = {
      getState: () => state,
      subscribeState: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const set = (patch: Partial<SoundState>) => {
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    }
    return { source, set }
  }

  it('calls the listener only when one of its keys changes', () => {
    const { source, set } = fakeSource()
    let calls = 0
    const off = subscribeStateKeys(source, ['playing', 'listening'], () => calls++)
    set({ playing: true })
    expect(calls).toBe(1)
    for (let position = 0; position < 10; position++) set({ position })
    expect(calls).toBe(1)
    set({ listening: true, playing: false })
    expect(calls).toBe(2)
    off()
    set({ listening: false })
    expect(calls).toBe(2)
  })
})
