// The parameter timeline (src/sound/planner.ts): a LiveScheduler on a virtual clock fed the precomputed frames. It
// commits exactly as the page's scheduler would with instant geometry and React (the fake rig of live.test.ts with
// computeMs 0 and renders in 0 ms), at most every 1/30 s of media time, keeps to the flash limit, records the sliders'
// own when nothing acts or the file ends, and plans the whole file from its start (NOCUR-85): the same inputs give the
// same keys, new inputs plan again from 0 (keys of unchanged parameters stay), and a thinned stretch planned again
// comes back the same.

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/paramsKey'
import type { GeometryParams } from '../../src/geometry/types'
import { FLASH_LIMITS } from '../../src/sound/flash'
import type { LetterSlots } from '../../src/sound/letters'
import {
  LIVE_LIMITS,
  LiveScheduler,
  PLANNER_CLOCK_OFFSET,
  plannedEdges,
  type LiveCommit,
  type LiveInputs,
} from '../../src/sound/live'
import type { Mapping } from '../../src/sound/mapping'
import { PlaybackPlanner, SEQ_SPAN, type FeatureSource } from '../../src/sound/planner'
import { PRECOMPUTE_LIMITS } from '../../src/sound/timelineTypes'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame, type ResponseSettings } from '../../src/sound/types'
import { BASE as DEFAULTS } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }
const HZ = PRECOMPUTE_LIMITS.gridHz
const MIN_COMMIT_MS = 1000 / LIVE_LIMITS.maxFps

const row = (target: string, depth = 0.5, feature: Mapping['feature'] = 'level'): Mapping => ({
  id: `${target} ${feature} ${depth}`,
  enabled: true,
  feature,
  target,
  depth,
})
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
    return {
      ...SILENT_FRAME,
      time,
      level: v,
      bass: v,
      mids: 1 - v,
      treble: v * v,
      brightness: v,
      activity: v,
      beat: onset ? 1 : 0,
      onset,
      silent: v === 0,
      levelDb: v ? -40 + 40 * v : -Infinity,
    }
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
  return {
    base: BASE,
    hasFont: true,
    mappings: [row('distortion.amount')],
    drive: true,
    response: response(),
    slots: lettersOf(12),
    ...patch,
  }
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

function plan(frames: FeatureFrame[], setup: LiveInputs) {
  const planner = new PlaybackPlanner(source(frames))
  planner.setInputs(setup)
  planner.ensure(Infinity, Infinity)
  return planner
}

/** Every commit of the plan (none thinned in these files). */
const all = (planner: PlaybackPlanner) => planner.range(-Infinity, Infinity)

describe('playback planner', () => {
  it('commits every 1/30 s of media time while the sound keeps changing', () => {
    const frames = stream(3, (t) => 0.5 + 0.4 * Math.sin(t / 97))
    const planner = plan(frames, inputs())
    const driving = all(planner).filter((c) => c.commit !== null)
    expect(driving.length).toBeGreaterThan(80)
    for (let i = 1; i < driving.length; i++)
      expect(driving[i].mediaMs - driving[i - 1].mediaMs).toBeCloseTo(MIN_COMMIT_MS, 6)
  })

  it.each([
    ['one slider', inputs()],
    [
      'a seed and two sliders',
      inputs({
        mappings: [
          row('distortion.amount', 1),
          row('anchors.spacing', 0.7, 'treble'),
          row('distortion.seed', 1, 'beat'),
        ],
      }),
    ],
    ['Motion contrast across the letters', inputs({ response: response({ contrast: 1 }) })],
    [
      'Pitch reactive and Strength',
      inputs({
        response: response({ pitchReactive: 1, strength: 0.6 }),
        mappings: [row('distortion.amount', 1, 'bass')],
      }),
    ],
  ])('shows what the page scheduler would with instant geometry: %s', (_, setup) => {
    const frames = stream(4, (t) => (Math.floor(t / 230) % 2 ? 0.9 : 0.2) + 0.08 * Math.sin(t / 31), 13)
    const page = pageRun(frames, setup).map(shows)
    const planned = all(plan(frames, setup)).map((c) => shows(c.commit))
    // Both end with the sliders' own (exact restore) as the file ends.
    expect(planned.at(-1)).toBeNull()
    expect(planned).toEqual(page)
  })

  it('keeps to the flash limit: no window of 1250 ms holds more than 6 planned edges', () => {
    const setup = inputs({
      mappings: [row('distortion.amount', 1), row('squaring.amount', 1, 'bass'), row('distortion.seed', 1, 'level')],
    })
    const frames = stream(10, (t) => (Math.floor(t / 125) % 2 ? 1 : 0))
    const commits = all(plan(frames, setup))
    // The file's end puts the sliders back whatever the budget says (exact restore spends an edge, as on the page).
    expect(commits.at(-1)!.commit).toBeNull()
    const edges = commits.slice(0, -1).flatMap((c) => plannedEdges(c.adopted))
    expect(edges.length).toBeGreaterThan(10)
    for (const a of edges)
      expect(edges.filter((b) => b >= a && b - a < FLASH_LIMITS.windowMs).length).toBeLessThanOrEqual(
        2 * FLASH_LIMITS.maxFlashes,
      )
  })

  it('plans the whole file from its start: the same inputs give the same commits, numbered by generation', () => {
    const frames = stream(6, (t) => 0.5 + 0.4 * Math.sin(t / 97), 17)
    const setup = inputs({ response: response({ contrast: 1 }) })
    const a = plan(frames, setup)
    const b = plan(frames, setup)
    expect(all(a)[0].mediaMs).toBe(0)
    expect(all(a).map((c) => [c.seq, c.mediaMs, c.keys])).toEqual(all(b).map((c) => [c.seq, c.mediaMs, c.keys]))
    expect(all(a).every((c, i) => c.seq === a.generation * SEQ_SPAN + i + 1)).toBe(true)
    // A range is the commits in it after the one on screen at its start, the same array while nothing changed.
    const range = a.range(1000, 2000)
    expect(range[0].mediaMs).toBeLessThanOrEqual(1000)
    expect(range[1].mediaMs).toBeGreaterThan(1000)
    expect(range.at(-1)!.mediaMs).toBeLessThanOrEqual(2000)
    expect(a.range(1000, 2000)).toBe(range)
    // Flash edges and decimation read the records without the commits.
    expect(a.edgesIn(1000, 3000)).toEqual(
      all(a)
        .filter((c) => c.mediaMs > 1000 && c.mediaMs <= 3000)
        .flatMap((c) => plannedEdges(c.adopted)),
    )
    expect(a.glyphRate(0, 3000)).toBeGreaterThan(20)
  })

  it('new inputs plan again from 0; keys of parameters a change does not touch stay (a colour mapping)', () => {
    const frames = stream(4, (t) => (Math.floor(t / 230) % 2 ? 0.9 : 0.2) + 0.08 * Math.sin(t / 31), 13)
    const setup = inputs({ mappings: [row('distortion.amount', 1), row('anchors.spacing', 0.7, 'treble')] })
    const planner = plan(frames, setup)
    const before = all(planner).map((c) => [c.mediaMs, c.keys])
    const generation = planner.generation
    planner.setInputs({ ...setup, mappings: [...setup.mappings, row('palette.inkHue', 1, 'bass')] })
    expect(planner.generation).toBe(generation + 1)
    expect(planner.plannedUntil()).toBe(-1)
    planner.ensure(Infinity, Infinity)
    expect(all(planner).map((c) => [c.mediaMs, c.keys])).toEqual(before)
  })

  it('keeps the commits compact: one key string and one parameter set per key', () => {
    const frames = stream(3, (t) => (Math.floor(t / 230) % 2 ? 0.9 : 0.2))
    const planner = plan(frames, inputs({ response: response({ contrast: 1 }) }))
    const commits = all(planner)
    const byKey = new Map<string, unknown>()
    for (const c of commits) {
      for (const job of c.jobs) {
        const known = byKey.get(job.key)
        if (known) expect(job.params).toBe(known)
        else byKey.set(job.key, job.params)
      }
    }
    // Commits that show every letter on the shared key share their key list.
    const lists = new Set(commits.map((c) => c.keys))
    expect(lists.size).toBeLessThan(commits.length)
    expect(planner.bytes()).toBeGreaterThan(0)
    expect(planner.bytes() / commits.length).toBeLessThan(12_000)
  })

  it('past its byte budget, thins the commits far from the playhead, and plans them again the same when it comes back', () => {
    const frames = stream(150, (t) => 0.5 + 0.4 * Math.sin(t / 97), 29)
    const setup = inputs({ response: response({ contrast: 1 }) })
    const full = plan(frames, setup)
    const expected = all(full).map((c) => [c.seq, c.mediaMs, c.keys, c.commit?.letters?.key ?? null])
    const limits = PRECOMPUTE_LIMITS as { planMaxBytes: number }
    const max = limits.planMaxBytes
    limits.planMaxBytes = full.bytes() * 0.6
    try {
      const planner = new PlaybackPlanner(source(frames))
      planner.setInputs(setup)
      planner.focus(0)
      planner.ensure(Infinity, Infinity)
      const thin = planner.records().filter((r) => !r.full)
      expect(thin.length).toBeGreaterThan(0)
      expect(thin.every((r) => r.mediaMs > PRECOMPUTE_LIMITS.planThinMs)).toBe(true)
      expect(planner.bytes()).toBeLessThanOrEqual(limits.planMaxBytes)
      // Thinned records still give the flash edges and decimation.
      expect(planner.edgesIn(0, Infinity)).toEqual(full.edgesIn(0, Infinity))
      // The playhead goes to 140 s: the range there is empty until the stretch is planned again.
      planner.focus(140_000)
      const range = () => planner.range(140_000 - PRECOMPUTE_LIMITS.windowBehindMs, 145_000)
      planner.ensure(Infinity, Infinity)
      expect(planner.mismatches).toBe(0)
      const again = range()
      expect(again.length).toBeGreaterThan(100)
      const want = expected.filter(
        ([, mediaMs]) => (mediaMs as number) >= again[0].mediaMs && (mediaMs as number) <= 145_000,
      )
      expect(again.map((c) => [c.seq, c.mediaMs, c.keys, c.commit?.letters?.key ?? null])).toEqual(want)
    } finally {
      limits.planMaxBytes = max
    }
  })

  it('keeps a thinned stretch full ahead of a playhead that plays on, in short slices, and within budget after seeks', () => {
    const frames = stream(150, (t) => 0.5 + 0.4 * Math.sin(t / 97), 29)
    const setup = inputs({ response: response({ contrast: 1 }) })
    const full = plan(frames, setup)
    const limits = PRECOMPUTE_LIMITS as { planMaxBytes: number }
    const max = limits.planMaxBytes
    const thinMs = PRECOMPUTE_LIMITS.planThinMs
    limits.planMaxBytes = full.bytes() * 0.6
    try {
      // A clock that moves with every reading: a slice plans a fixed stretch, whatever the machine.
      let clock = 0
      const planner = new PlaybackPlanner(source(frames), () => (clock += 0.05))
      planner.setInputs(setup)
      planner.focus(0)
      planner.ensure(Infinity, Infinity)
      expect(planner.records().some((r) => !r.full && r.mediaMs > 90_000)).toBe(true)
      planner.focus(90_000)
      planner.ensure(Infinity, Infinity)
      // Plays on from 90 s, a planning slice each 1/60 s: the stretch ahead stays full (the refill goes on, not over).
      for (let ms = 90_000; ms <= 140_000; ms += 1000 / 60) {
        planner.focus(ms)
        planner.ensure(Infinity, PRECOMPUTE_LIMITS.planSliceMs)
        if (Math.round(ms) % 5000 !== 0) continue
        const ahead = planner.range(ms, ms + 5000)
        expect(ahead.at(-1)!.mediaMs).toBeGreaterThan(ms + 4900)
      }
      expect(planner.mismatches).toBe(0)
      // Seeks across the finished plan: refills keep thinning what is far from the playhead (the full span around the
      // playhead narrowed and the budget widened, so that the span fits this short file's budget). Without thinning,
      // the refills would make most of the file full again.
      ;(PRECOMPUTE_LIMITS as { planThinMs: number }).planThinMs = 35_000
      limits.planMaxBytes = full.bytes() * 0.75
      for (const at of [10_000, 140_000, 40_000, 120_000, 0]) {
        planner.focus(at)
        planner.ensure(Infinity, Infinity)
        expect(planner.bytes()).toBeLessThanOrEqual(limits.planMaxBytes)
        expect(planner.range(at, at + 5000).length).toBeGreaterThan(100)
      }
    } finally {
      limits.planMaxBytes = max
      ;(PRECOMPUTE_LIMITS as { planThinMs: number }).planThinMs = thinMs
    }
  })

  it('records the sliders’ own when no mapping acts, and when the file ends', () => {
    const frames = stream(2, () => 0.7)
    const idle = plan(frames, inputs({ mappings: [row('distortion.amount', 0)] }))
    expect(all(idle).map((c) => c.commit)).toEqual([null])
    expect(all(idle)[0].jobs).toEqual([])
    expect(all(idle)[0].keys.every((k) => k === paramsKey(BASE))).toBe(true)
    const driven = plan(frames, inputs())
    expect(all(driven)[0].commit).not.toBeNull()
    expect(all(driven).at(-1)!.commit).toBeNull()
    expect(driven.isDone()).toBe(true)
  })

  it('stops at frames not measured yet, and goes on when they are', () => {
    const frames = stream(3, (t) => 0.5 + 0.4 * Math.sin(t / 97))
    let measured = 60
    const planner = new PlaybackPlanner({
      ...source(frames),
      isCovered: (i) => i < measured,
      frameAt: (i) => (i < measured ? frames[i] : null),
    })
    planner.setInputs(inputs())
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
    for (const c of all(planner)) {
      expect(c.keys).toHaveLength(setup.slots.count)
      expect(c.indices).toBe(setup.slots.index)
      if (!c.commit?.params) continue
      const shared = paramsKey(c.commit.params)
      expect(c.jobs[0].key).toBe(shared)
      const letters = c.commit.letters
      c.keys.forEach((key, j) =>
        expect(key).toBe(letters && letters.assign[j] !== 1 ? letters.keys[letters.assign[j]] : shared),
      )
      for (const key of new Set(c.keys)) expect(c.jobs.some((job) => job.key === key)).toBe(true)
    }
  })
})
