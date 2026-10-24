// Keyframes (NOCUR-91, src/sound/keyframes.ts): the in-between parameter sets a large change passes through while
// Glide is on, and the live scheduler computing their glyphs with the frame's and handing them to React with it.

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/paramsKey'
import type { FrameJob, GeometryParams } from '../../src/geometry/types'
import { isLargeChange, keyframeParams, keyframesBetween, KEYFRAME_LIMITS } from '../../src/sound/keyframes'
import { LiveScheduler, type LiveCommit, type LiveDeps } from '../../src/sound/live'
import type { Mapping } from '../../src/sound/mapping'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { BASE } from '../helpers/params'

const withEffects = (patch: Partial<GeometryParams['experimental']>): GeometryParams => ({
  ...BASE,
  experimental: { ...BASE.experimental, ...patch },
})
const crumple = (enabled: boolean, amount = 1.5) =>
  withEffects({ crumple: { ...BASE.experimental.crumple, enabled, amount } })

describe('keyframes', () => {
  it('fade an effect switching on in from nothing and one switching off out to nothing, with it on all the way', () => {
    const off = crumple(false)
    const on = crumple(true)
    const growing = keyframesBetween(off, on)!
    expect(growing).toHaveLength(KEYFRAME_LIMITS.count)
    expect(growing.map((k) => [k.params.experimental.crumple.enabled, k.params.experimental.crumple.amount])).toEqual([
      [true, 0.5],
      [true, 1],
    ])
    for (const k of growing) expect(k.key).toBe(paramsKey(k.params))
    const fading = keyframesBetween(on, off)!
    expect(fading.map((k) => k.params.experimental.crumple.amount)).toEqual([1, 0.5])
    // Everything else is the new frame's already.
    const moved = { ...on, distortion: { ...on.distortion, amount: 40 } }
    expect(keyframeParams(off, moved, 0.5).distortion).toBe(moved.distortion)
  })

  it('come only with a large change: a switch, or a strength moving a quarter of its slider or more', () => {
    expect(isLargeChange(crumple(true, 1), crumple(true, 1.1))).toBe(false)
    expect(keyframesBetween(crumple(true, 1), crumple(true, 1.1))).toBeNull()
    // Crumple's Amount runs 0–5: 1 → 2.5 is 30% of it.
    expect(isLargeChange(crumple(true, 1), crumple(true, 2.5))).toBe(true)
    expect(
      keyframesBetween(crumple(true, 1), crumple(true, 2.5))!.map((k) => k.params.experimental.crumple.amount),
    ).toEqual([1.5, 2])
    // An effect that stays off changes nothing, whatever its values.
    expect(keyframesBetween(crumple(false, 0), crumple(false, 5))).toBeNull()
    expect(keyframesBetween(BASE, BASE)).toBeNull()
  })

  it('fade Whorl through its neutral 0, not its slider end, and Thorn by its Reach', () => {
    const whorl = withEffects({ whorl: { ...BASE.experimental.whorl, enabled: true, amount: -1.5 } })
    expect(keyframesBetween(BASE, whorl)!.map((k) => k.params.experimental.whorl.amount)).toEqual([-0.5, -1])
    const thorn = withEffects({ thorn: { ...BASE.experimental.thorn, enabled: true, canvasReach: 0.6, refraction: 0 } })
    expect(keyframesBetween(thorn, BASE)!.map((k) => k.params.experimental.thorn.canvasReach)).toEqual([
      expect.closeTo(0.4, 12),
      expect.closeTo(0.2, 12),
    ])
  })
})

describe('keyframes in the live scheduler', () => {
  /** Fake clock and timers; a request's glyphs arrive 5 ms later; React renders each commit at once. */
  function rig() {
    let now = 0
    let computing = false
    let nextId = 1
    const timers: { at: number; id: number; run: () => void }[] = []
    const later = (ms: number, run: () => void) => {
      timers.push({ at: now + ms, id: nextId++, run })
      return nextId - 1
    }
    const known = new Set<string>()
    const asked: (readonly FrameJob[])[] = []
    const commits: (LiveCommit | null)[] = []
    const deps: LiveDeps = {
      now: () => now,
      sourceRunning: () => true,
      isComputing: () => computing,
      request: (jobs) => {
        asked.push(jobs)
        computing = true
        later(5, () => {
          computing = false
          for (const job of jobs) known.add(job.key)
          live.idle()
        })
        return true
      },
      commit: (commit) => {
        // Every keyframe's glyphs are computed before the frame reaches React.
        for (const k of commit?.keyframes ?? []) expect(known.has(k.key)).toBe(true)
        commits.push(commit)
        if (commit) later(0, () => live.rendered(commit.seq))
      },
      pauseSound: () => {},
      setTimer: (run, ms) => later(ms, run),
      clearTimer: (handle) => {
        const i = timers.findIndex((t) => t.id === handle)
        if (i >= 0) timers.splice(i, 1)
      },
    }
    const live = new LiveScheduler(deps)
    const play = (until: number, level: (t: number) => number) => {
      for (let t = now; t <= until; t += 1000 / 60) {
        for (;;) {
          timers.sort((a, b) => a.at - b.at || a.id - b.id)
          if (!timers[0] || timers[0].at > t) break
          const next = timers.shift()!
          now = Math.max(now, next.at)
          next.run()
        }
        now = t
        const frame: FeatureFrame = { ...SILENT_FRAME, time: t, level: level(t), silent: false, levelDb: -20 }
        live.setFrame(frame)
      }
    }
    return { live, asked, commits, play }
  }
  // Crumple switched on while the sound is loud.
  const sw: Mapping = { id: 'm1', enabled: true, feature: 'level', target: 'experimental.crumple.enabled', depth: 1 }
  const pulses = (t: number) => (Math.floor(t / 400) % 2 === 1 ? 0.9 : 0)

  it('with Glide on, computes the keyframes of each switch with the frame and hands them to React with it', () => {
    const r = rig()
    r.live.setBase(crumple(false))
    r.live.setMappings([sw], true, { ...NEUTRAL_RESPONSE, glideMs: 150 })
    r.play(2000, pulses)
    const switched = r.commits.filter((c) => c?.keyframes)
    // On and off, about twice each.
    expect(switched.length).toBeGreaterThanOrEqual(3)
    for (const commit of switched) {
      const amounts = commit!.keyframes!.map((k) => k.params.experimental.crumple.amount)
      expect(amounts).toEqual(commit!.params ? [0.5, 1] : [1, 0.5])
    }
    // Back to the sliders' own (params null) still asks for the keyframes' glyphs, in a request of their own.
    expect(switched.some((c) => c!.params === null)).toBe(true)
    expect(r.asked.some((jobs) => jobs.length === KEYFRAME_LIMITS.count)).toBe(true)
  })

  it('with Glide at 0, sends no keyframes and asks for nothing more', () => {
    const r = rig()
    r.live.setBase(crumple(false))
    r.live.setMappings([sw], true, NEUTRAL_RESPONSE)
    r.play(2000, pulses)
    expect(r.commits.length).toBeGreaterThan(2)
    expect(r.commits.every((c) => !c?.keyframes)).toBe(true)
    expect(r.asked.every((jobs) => jobs.length === 1)).toBe(true)
  })
})
