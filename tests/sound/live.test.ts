// The live scheduler (src/sound/live.ts) with fake dependencies: a fake clock and timers, a geometry client that
// computes a frame's glyphs before it is committed (request), and a React that renders each commit. It drives only
// when it can, asks for each frame's glyphs before handing it to React, commits at most 30 times a second and one
// frame at a time, restores the sliders exactly when it stops, and Freeze writes what is on screen.

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/cache'
import type { GeometryParams } from '../../src/geometry/types'
import { LIVE_LIMITS, LiveScheduler, type LiveCommit, type LiveDeps } from '../../src/sound/live'
import type { Mapping } from '../../src/sound/mapping'
import { SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { BASE as DEFAULTS } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }

const frame = (level: number, time: number): FeatureFrame => ({
  ...SILENT_FRAME,
  time,
  level,
  bass: level,
  mids: level,
  treble: level,
  brightness: level,
  silent: level === 0,
  levelDb: level ? -20 : -Infinity,
})
const row = (target: string, depth = 0.5, feature: Mapping['feature'] = 'level'): Mapping => ({ id: `${target} ${depth}`, enabled: true, feature, target, depth })

/** Fake time and timers; the geometry client computes a frame's glyphs in `computeMs` (unless cached), React renders a commit in 2 ms. */
function rig(options: { computeMs?: number; render?: boolean; cache?: boolean } = {}) {
  let now = 0
  let running = true
  let computing = false
  let pauses = 0
  let nextId = 1
  const timers: { at: number; id: number; run: () => void }[] = []
  const later = (ms: number, run: () => void) => {
    const id = nextId++
    timers.push({ at: now + Math.max(0, ms), id, run })
    return id
  }
  const known = new Set<string>()
  const requests: string[] = []
  const commits: (LiveCommit | null)[] = []
  const commitTimes: number[] = []
  const deps: LiveDeps = {
    now: () => now,
    sourceRunning: () => running,
    isComputing: () => computing,
    request: (params, key) => {
      expect(key).toBe(paramsKey(params))
      requests.push(key)
      if (options.cache !== false && known.has(key)) return false
      computing = true
      later(options.computeMs ?? 5, () => {
        computing = false
        known.add(key)
        live.idle()
      })
      return true
    },
    commit: (commit) => {
      // A live frame reaches React only once its glyphs are known.
      if (commit?.params) expect(known.has(paramsKey(commit.params))).toBe(true)
      commits.push(commit)
      commitTimes.push(now)
      if (commit && options.render !== false) later(2, () => live.rendered(commit.seq))
    },
    pauseSound: () => {
      pauses++
      running = false
      live.sourceChanged()
    },
    setTimer: (run, ms) => later(ms, run),
    clearTimer: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
  }
  const live = new LiveScheduler(deps)
  const advance = (to: number) => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = timers[0]
      if (!next || next.at > to) break
      timers.shift()
      now = Math.max(now, next.at)
      next.run()
    }
    now = Math.max(now, to)
  }
  /** Frames every 1/60 s until `until`, at the level `level(t)`. */
  const play = (until: number, level: (t: number) => number) => {
    for (let t = now; t <= until; t += 1000 / 60) {
      advance(t)
      live.setFrame(frame(level(t), t))
    }
    advance(until)
  }
  return {
    live,
    commits,
    commitTimes,
    requests,
    play,
    advance,
    get now() {
      return now
    },
    get last() {
      return commits[commits.length - 1]
    },
    get pauses() {
      return pauses
    },
    setRunning(value: boolean) {
      running = value
      live.sourceChanged()
    },
  }
}

const loud = () => 0.8
const sweep = (t: number) => 0.5 + 0.5 * Math.sin(t / 100)

describe('live scheduler', () => {
  it.each([
    ['the source is stopped', { running: false }],
    ['Drive letters is off', { drive: false }],
    ['there are no mappings', { mappings: [] as Mapping[] }],
    ['the depth is 0', { mappings: [row('distortion.amount', 0)] }],
    ['the target does not act (Ripple off)', { mappings: [row('experimental.ripple.amount', 1)] }],
    ['no font is loaded', { font: false }],
  ])('does not drive when %s', (_, setup: { running?: boolean; drive?: boolean; mappings?: Mapping[]; font?: boolean }) => {
    const r = rig()
    r.setRunning(setup.running ?? true)
    r.live.setBase(BASE, setup.font ?? true)
    r.live.setMappings(setup.mappings ?? [row('distortion.amount')], setup.drive ?? true)
    r.play(1000, loud)
    expect(r.commits).toEqual([])
    expect(r.requests).toEqual([])
    expect(r.live.status.get().driving).toBe(false)
    expect(r.live.positions.get('distortion.amount')).toBeNull()
  })

  it('shows markers in silence without committing, and commits live parameters on sound', () => {
    const r = rig()
    r.live.setBase(BASE)
    r.live.setMappings([row('distortion.amount')], true)
    r.play(500, () => 0)
    expect(r.live.status.get()).toMatchObject({ driving: true, differs: false })
    expect(r.commits).toEqual([])
    expect(r.live.positions.get('distortion.amount')).toBeGreaterThan(0)
    r.play(1000, loud)
    const params = r.last?.params
    expect(params?.distortion.amount).toBeGreaterThan(BASE.distortion.amount)
    expect(params?.experimental).toBe(BASE.experimental)
    expect(r.live.status.get().differs).toBe(true)
    // Each live frame was asked for before it was committed.
    expect(r.requests.length).toBeGreaterThanOrEqual(r.commits.filter((c) => c?.params).length)
  })

  it('commits at most 30 times a second, one frame at a time, about 30 when the geometry keeps up', () => {
    const r = rig({ computeMs: 5 })
    r.live.setBase(BASE)
    r.live.setMappings([row('distortion.amount', 1)], true)
    r.play(3000, sweep)
    const gaps = r.commitTimes.slice(1).map((t, i) => t - r.commitTimes[i])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / LIVE_LIMITS.maxFps - 1e-9)
    const rate = r.commitTimes.filter((t) => t >= 1000).length / 2
    expect(rate).toBeGreaterThan(25)
    expect(rate).toBeLessThanOrEqual(30.5)
    expect(r.live.status.get()).toMatchObject({ fps: 30, slow: false })
  })

  it('slows down with heavy frames, and says so after 2 s below 8 a second', () => {
    const r = rig({ computeMs: 200, cache: false })
    r.live.setBase(BASE)
    r.live.setMappings([row('distortion.amount', 1)], true)
    r.play(1000, sweep)
    expect(r.live.status.get().slow).toBe(false)
    r.play(4000, sweep)
    const gaps = r.commitTimes.slice(1).map((t, i) => t - r.commitTimes[i])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(200)
    expect(r.live.status.get().fps).toBeLessThanOrEqual(5)
    expect(r.live.status.get().slow).toBe(true)
  })

  it('goes on after a commit that never renders, a second later', () => {
    const r = rig({ render: false })
    r.live.setBase(BASE)
    r.live.setMappings([row('distortion.amount', 1)], true)
    r.play(900, sweep)
    expect(r.commits).toHaveLength(1)
    r.play(1500, sweep)
    expect(r.commits.length).toBeGreaterThanOrEqual(2)
  })

  it('restores the sliders exactly when it stops, and drives again on play', () => {
    const r = rig()
    r.live.setBase(BASE)
    r.live.setMappings([row('distortion.amount')], true)
    r.play(500, loud)
    expect(r.last?.params).toBeTruthy()
    r.setRunning(false)
    expect(r.last).toBeNull()
    expect(r.live.positions.get('distortion.amount')).toBeNull()
    expect(r.live.status.get()).toMatchObject({ driving: false, fps: 0 })
    const n = r.commits.length
    r.play(1000, loud)
    expect(r.commits).toHaveLength(n)
    r.setRunning(true)
    r.play(1500, loud)
    expect(r.last?.params).toBeTruthy()
    r.live.setMappings([], true)
    expect(r.last).toBeNull()
  })

  it('Freeze writes the group on screen, then pauses the sound', () => {
    const r = rig()
    r.live.setBase(BASE)
    r.live.setMappings([row('distortion.amount')], true)
    r.play(300, () => 0)
    expect(r.live.freezeChanges()).toBeNull()
    r.play(800, loud)
    const shown = r.last?.params
    const changes = r.live.freezeChanges()
    expect(Object.keys(changes ?? {})).toEqual(['distortion'])
    expect(changes?.distortion).toEqual(shown?.distortion)
    expect(paramsKey({ ...BASE, ...changes })).toBe(paramsKey(shown!))
    r.live.pauseSound()
    expect(r.pauses).toBe(1)
    expect(r.last).toBeNull()
    expect(r.live.freezeChanges()).toBeNull()
  })

  it('starts driving when a font is loaded and stops when it goes', () => {
    const r = rig()
    r.live.setBase(BASE, false)
    r.live.setMappings([row('squaring.amount', 1)], true)
    r.play(500, sweep)
    expect(r.commits).toEqual([])
    r.live.setBase(BASE, true)
    r.play(1500, sweep)
    expect(r.commits.length).toBeGreaterThanOrEqual(20)
    r.live.setBase(BASE, false)
    expect(r.last).toBeNull()
    expect(r.live.status.get().driving).toBe(false)
  })
})
