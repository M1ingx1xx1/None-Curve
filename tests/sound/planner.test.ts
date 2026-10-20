// The parameter timeline (src/sound/planner.ts): a LiveScheduler on a virtual clock fed the precomputed frames. It
// commits exactly as the page's scheduler would with instant geometry and React (the fake rig of live.test.ts with
// computeMs 0 and renders in 0 ms), at most every 1/30 s of media time, keeps to the flash limit, drops a reseed's
// warm-up commits, and records the sliders' own when nothing acts or the file ends.

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/cache'
import type { GeometryParams } from '../../src/geometry/types'
import { FLASH_LIMITS } from '../../src/sound/flash'
import type { LetterSlots } from '../../src/sound/letters'
import { LIVE_LIMITS, LiveScheduler, PLANNER_CLOCK_OFFSET, plannedEdges, type LiveCommit, type LiveInputs } from '../../src/sound/live'
import type { Mapping } from '../../src/sound/mapping'
import { PlaybackPlanner, type FeatureSource } from '../../src/sound/planner'
import { PRECOMPUTE_LIMITS } from '../../src/sound/timelineTypes'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame, type ResponseSettings } from '../../src/sound/types'
import { BASE as DEFAULTS } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }
const HZ = PRECOMPUTE_LIMITS.gridHz
const MIN_COMMIT_MS = 1000 / LIVE_LIMITS.maxFps

const row = (target: string, depth = 0.5, feature: Mapping['feature'] = 'level'): Mapping => ({ id: `${target} ${feature} ${depth}`, enabled: true, feature, target, depth })
const response = (patch: Partial<ResponseSettings> = {}): ResponseSettings => ({ ...NEUTRAL_RESPONSE, ...patch })

function lettersOf(count: number, ids = 3): LetterSlots {
  const active = Array.from({ length: count }, (_, j) => (j % 6 === 5 ? 0 : 1))
  const activeCount = active.filter(Boolean).length
  return {
    count,
    index: Int32Array.from({ length: count }, (_, j) => (active[j] ? j % ids : 99)),
    t: Float32Array.from({ length: count }, (_, j) => (j + 0.5) / count),
    share: Float32Array.from(active, (a) => (a ? 1 / activeCount : 0)),
    active: Uint8Array.from(active),
    activeCount,
  }
}

/** Grid frames from `level(t)` (t in media ms); every `onsetEvery`-th frame has an onset. */
function stream(seconds: number, level: (t: number) => number, onsetEvery = 0): FeatureFrame[] {
  return Array.from({ length: Math.round(seconds * HZ) }, (_, k) => {
    const time = (k * 1000) / HZ
    const v = Math.min(1, Math.max(0, level(time)))
    const onset = onsetEvery > 0 && k % onsetEvery === 0 && k > 0
    return { ...SILENT_FRAME, time, level: v, bass: v, mids: 1 - v, treble: v * v, brightness: v, activity: v, beat: onset ? 1 : 0, onset, silent: v === 0, levelDb: v ? -40 + 40 * v : -Infinity }
  })
}

function source(frames: FeatureFrame[], measured = frames.length): FeatureSource {
  return {
    hz: HZ,
    frameCount: () => frames.length,
    isCovered: (i) => i < measured,
    frameAt: (i) => (i < measured ? frames[i] : null),
  }
}

function inputs(patch: Partial<LiveInputs> = {}): LiveInputs {
  return { base: BASE, hasFont: true, mappings: [row('distortion.amount')], drive: true, response: response(), slots: lettersOf(12), ...patch }
}

/** What a commit shows: the shared parameters' key, the letters' key and the look. */
const shows = (commit: Omit<LiveCommit, 'seq' | 'timing'> | null) =>
  commit && commit.params ? [paramsKey(commit.params), commit.letters?.key ?? null, JSON.stringify(commit.look)] : null

/** The page's scheduler in the live.test.ts rig: fake clock and timers, geometry in 0 ms (new keys), renders in 0 ms. */
function pageRun(frames: FeatureFrame[], setup: LiveInputs) {
  let now = 0
  let running = true
  let computing = false
  let nextId = 1
  const timers: { at: number; id: number; run: () => void }[] = []
  const later = (ms: number, run: () => void) => {
    const id = nextId++
    timers.push({ at: now + Math.max(0, ms), id, run })
    return id
  }
  const known = new Set<string>()
  const commits: (LiveCommit | null)[] = []
  const live: LiveScheduler = new LiveScheduler({
    now: () => now,
    sourceRunning: () => running,
    isComputing: () => computing,
    request: (jobs) => {
      const missing = jobs.map((j) => j.key).filter((k) => !known.has(k))
      if (missing.length === 0) return false
      computing = true
      later(0, () => {
        computing = false
        for (const k of missing) known.add(k)
        live.idle()
      })
      return true
    },
    commit: (commit) => {
      commits.push(commit)
      if (commit) later(0, () => live.rendered(commit.seq))
    },
    pauseSound: () => {},
    setTimer: (run, ms) => later(ms, run),
    clearTimer: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
  })
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
  live.setMappings(setup.mappings, setup.drive, setup.response)
  live.setSlots(setup.slots)
  live.setBase(setup.base!, setup.hasFont)
  for (const frame of frames) {
    const time = frame.time + PLANNER_CLOCK_OFFSET
    advance(time)
    live.setFrame({ ...frame, time })
  }
  // The file ends one frame after its last.
  advance(now + 1000 / HZ)
  running = false
  live.sourceChanged()
  advance(now + 1000)
  return commits
}

function plan(frames: FeatureFrame[], setup: LiveInputs, atMs = 0) {
  const planner = new PlaybackPlanner(source(frames))
  planner.setInputs(setup, atMs)
  planner.ensure(Infinity, Infinity)
  return planner
}

describe('playback planner', () => {
  it('commits every 1/30 s of media time while the sound keeps changing', () => {
    const frames = stream(3, (t) => 0.5 + 0.4 * Math.sin(t / 97))
    const planner = plan(frames, inputs())
    const driving = planner.commits.filter((c) => c.commit !== null)
    expect(driving.length).toBeGreaterThan(80)
    for (let i = 1; i < driving.length; i++) expect(driving[i].mediaMs - driving[i - 1].mediaMs).toBeCloseTo(MIN_COMMIT_MS, 6)
  })

  it.each([
    ['one slider', inputs()],
    ['a seed and two sliders', inputs({ mappings: [row('distortion.amount', 1), row('anchors.spacing', 0.7, 'treble'), row('distortion.seed', 1, 'beat')] })],
    ['Motion contrast across the letters', inputs({ response: response({ contrast: 1 }) })],
    ['Pitch reactive and Strength', inputs({ response: response({ pitchReactive: 1, strength: 0.6 }), mappings: [row('distortion.amount', 1, 'bass')] })],
  ])('shows what the page scheduler would with instant geometry: %s', (_, setup) => {
    const frames = stream(4, (t) => (Math.floor(t / 230) % 2 ? 0.9 : 0.2) + 0.08 * Math.sin(t / 31), 13)
    const page = pageRun(frames, setup).map(shows)
    const planned = plan(frames, setup).commits.map((c) => shows(c.commit))
    // Both end with the sliders' own (exact restore) as the file ends.
    expect(planned.at(-1)).toBeNull()
    expect(planned).toEqual(page)
  })

  it('keeps to the flash limit: no window of 1250 ms holds more than 6 planned edges', () => {
    const setup = inputs({ mappings: [row('distortion.amount', 1), row('squaring.amount', 1, 'bass'), row('distortion.seed', 1, 'level')] })
    const frames = stream(10, (t) => (Math.floor(t / 125) % 2 ? 1 : 0))
    const commits = plan(frames, setup).commits
    // The file's end puts the sliders back whatever the budget says (exact restore spends an edge, as on the page).
    expect(commits.at(-1)!.commit).toBeNull()
    const edges = commits.slice(0, -1).flatMap((c) => plannedEdges(c.adopted))
    expect(edges.length).toBeGreaterThan(10)
    for (const a of edges) expect(edges.filter((b) => b >= a && b - a < FLASH_LIMITS.windowMs).length).toBeLessThanOrEqual(2 * FLASH_LIMITS.maxFlashes)
  })

  it('reseeds for a seek: a new generation, and the warm-up commits are dropped but the one on screen', () => {
    const frames = stream(12, (t) => 0.5 + 0.4 * Math.sin(t / 97))
    const planner = plan(frames, inputs())
    const first = planner.generation
    const atMs = 9000
    planner.reseed(atMs)
    expect(planner.generation).toBe(first + 1)
    expect(planner.commits).toEqual([])
    planner.ensure(Infinity, Infinity)
    const [onScreen, ...rest] = planner.commits
    expect(onScreen.mediaMs).toBeLessThan(atMs)
    expect(onScreen.mediaMs).toBeGreaterThan(atMs - 2 * MIN_COMMIT_MS)
    expect(rest.every((c) => c.mediaMs >= atMs && c.generation === first + 1)).toBe(true)
    // Warmed up from 4 s before: the same commits as planning straight through, from the seek on.
    const straight = plan(frames, inputs()).commits.filter((c) => c.mediaMs >= atMs)
    expect(rest.map((c) => [c.mediaMs, shows(c.commit)])).toEqual(straight.map((c) => [c.mediaMs, shows(c.commit)]))
  })

  it('records the sliders’ own when no mapping acts, and when the file ends', () => {
    const frames = stream(2, () => 0.7)
    const idle = plan(frames, inputs({ mappings: [row('distortion.amount', 0)] }))
    expect(idle.commits.map((c) => c.commit)).toEqual([null])
    expect(idle.commits[0].jobs).toEqual([])
    expect(idle.commits[0].keys.every((k) => k === paramsKey(BASE))).toBe(true)
    const driven = plan(frames, inputs())
    expect(driven.commits[0].commit).not.toBeNull()
    expect(driven.commits.at(-1)!.commit).toBeNull()
    expect(driven.isDone()).toBe(true)
  })

  it('stops at frames not measured yet, and goes on when they are', () => {
    const frames = stream(3, (t) => 0.5 + 0.4 * Math.sin(t / 97))
    let measured = 60
    const planner = new PlaybackPlanner({ ...source(frames), isCovered: (i) => i < measured, frameAt: (i) => (i < measured ? frames[i] : null) })
    planner.setInputs(inputs(), 0)
    expect(planner.ensure(2000, Infinity)).toBe(false)
    expect(planner.plannedUntil()).toBeCloseTo((59 * 1000) / HZ, 6)
    measured = frames.length
    expect(planner.ensure(2000, Infinity)).toBe(true)
    expect(planner.plannedUntil()).toBeGreaterThanOrEqual(2000 - 1000 / HZ)
  })

  it('lists each occurrence’s key and glyph id, and the jobs its geometry needs', () => {
    const setup = inputs({ response: response({ contrast: 1 }) })
    const frames = stream(2, (t) => (Math.floor(t / 230) % 2 ? 0.9 : 0.2))
    const planner = plan(frames, setup)
    for (const c of planner.commits) {
      expect(c.keys).toHaveLength(setup.slots.count)
      expect(c.indices).toBe(setup.slots.index)
      if (!c.commit?.params) continue
      const shared = paramsKey(c.commit.params)
      expect(c.jobs[0].key).toBe(shared)
      const letters = c.commit.letters
      c.keys.forEach((key, j) => expect(key).toBe(letters && letters.assign[j] !== 1 ? letters.keys[letters.assign[j]] : shared))
      for (const key of new Set(c.keys)) expect(c.jobs.some((job) => job.key === key)).toBe(true)
    }
  })
})
