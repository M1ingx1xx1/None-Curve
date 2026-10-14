// The live scheduler (src/sound/live.ts) with fake dependencies: a fake clock and timers, a geometry client that
// computes a frame's glyphs before it is committed (request), and a React that renders each commit. It drives only
// when it can, asks for each frame's glyphs before handing it to React, commits at most 30 times a second and one
// frame at a time, restores the sliders exactly when it stops, and Freeze writes what is on screen. With Motion
// contrast, letters show up to three levels from one request per frame, and Freeze writes the shared values.

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/cache'
import type { FrameJob, GeometryParams } from '../../src/geometry/types'
import { assignLevels, letterLevels, SHARED, type LetterSlots } from '../../src/sound/letters'
import { LIVE_LIMITS, LiveScheduler, type LiveCommit, type LiveDeps } from '../../src/sound/live'
import type { Mapping } from '../../src/sound/mapping'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame, type ResponseSettings } from '../../src/sound/types'
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
const response = (patch: Partial<ResponseSettings>): ResponseSettings => ({ ...NEUTRAL_RESPONSE, ...patch })

/** `count` letters across one line, glyph ids cycling through `ids`, every sixth a space. */
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

/**
 * Fake time and timers; the geometry client computes the glyphs a request lacks in `computeMs` (all of them with
 * `cache: false`), React renders a commit in 2 ms. Glyphs are known by (key, glyph id); a job without indices asks
 * for the `shown` glyphs.
 */
function rig(options: { computeMs?: number; render?: boolean; cache?: boolean; shown?: readonly number[]; onCommit?: (commit: LiveCommit | null) => void } = {}) {
  let now = 0
  let running = true
  let computing = false
  let pauses = 0
  let nextId = 1
  let computeMs = options.computeMs ?? 5
  const shown = options.shown ?? [0, 1, 2]
  const timers: { at: number; id: number; run: () => void }[] = []
  const later = (ms: number, run: () => void) => {
    const id = nextId++
    timers.push({ at: now + Math.max(0, ms), id, run })
    return id
  }
  const known = new Set<string>()
  const pair = (key: string, index: number) => `${key}|${index}`
  /** The shared key of each request. */
  const requests: string[] = []
  /** Each request's jobs, and how many glyphs it computed. */
  const asked: { jobs: readonly FrameJob[]; computed: number; at: number; frameTime: number }[] = []
  const commits: (LiveCommit | null)[] = []
  const commitTimes: number[] = []
  const deps: LiveDeps = {
    now: () => now,
    sourceRunning: () => running,
    isComputing: () => computing,
    request: (jobs) => {
      for (const job of jobs) expect(job.key).toBe(paramsKey(job.params))
      requests.push(jobs[0].key)
      const pairs = jobs.flatMap((job) => (job.indices ?? shown).map((index) => pair(job.key, index)))
      const missing = options.cache === false ? pairs : pairs.filter((p) => !known.has(p))
      // A request is always for the newest frame.
      asked.push({ jobs, computed: missing.length, at: now, frameTime: lastFrame.time })
      if (missing.length === 0) return false
      computing = true
      later(computeMs, () => {
        computing = false
        for (const p of missing) known.add(p)
        live.idle()
      })
      return true
    },
    commit: (commit) => {
      // A live frame reaches React only once its glyphs are known, every letter's level included.
      if (commit?.params) for (const index of shown) expect(known.has(pair(paramsKey(commit.params), index))).toBe(true)
      const letters = commit?.letters
      if (letters) {
        letters.assign.forEach((level, j) => {
          if (level !== SHARED) expect(known.has(pair(letters.keys[level], letters.slots.index[j]))).toBe(true)
        })
      }
      commits.push(commit)
      commitTimes.push(now)
      options.onCommit?.(commit)
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
  let lastFrame: FeatureFrame = SILENT_FRAME
  /** Frames every 1/60 s until `until`, at the level `level(t)`. */
  const play = (until: number, level: (t: number) => number) => {
    for (let t = now; t <= until; t += 1000 / 60) {
      advance(t)
      lastFrame = frame(level(t), t)
      live.setFrame(lastFrame)
    }
    advance(until)
  }
  return {
    live,
    commits,
    commitTimes,
    requests,
    asked,
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
    get lastFrame() {
      return lastFrame
    },
    setRunning(value: boolean) {
      running = value
      live.sourceChanged()
    },
    setComputeMs(ms: number) {
      computeMs = ms
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
    ['Strength is 0', { strength: 0 }],
  ])('does not drive when %s', (_, setup: { running?: boolean; drive?: boolean; mappings?: Mapping[]; font?: boolean; strength?: number }) => {
    const r = rig()
    r.setRunning(setup.running ?? true)
    r.live.setBase(BASE, setup.font ?? true)
    r.live.setMappings(setup.mappings ?? [row('distortion.amount')], setup.drive ?? true, response({ strength: setup.strength ?? 1 }))
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
    // Each live frame was asked for before it was committed, in one request of one job (every glyph shown).
    expect(r.requests.length).toBeGreaterThanOrEqual(r.commits.filter((c) => c?.params).length)
    expect(r.asked.every(({ jobs }) => jobs.length === 1 && jobs[0].indices === undefined)).toBe(true)
    expect(r.commits.every((c) => c?.letters === null)).toBe(true)
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

  it('Freeze leaves out Thorn\'s canvasEm, which rides only on the geometry parameters', () => {
    const r = rig()
    const thorned: GeometryParams = {
      ...BASE,
      experimental: { ...BASE.experimental, thorn: { ...BASE.experimental.thorn, enabled: true, canvasReach: 0.01, canvasEm: 30.04 } },
    }
    r.live.setBase(thorned)
    r.live.setMappings([row('experimental.thorn.canvasReach')], true)
    r.play(800, loud)
    const shown = r.last!.params!
    // The live frames keep it: they are keyed and computed with the canvas the sliders use.
    expect(shown.experimental.thorn.canvasEm).toBe(30.04)
    expect(shown.experimental.thorn.canvasReach).toBeGreaterThan(0.01)
    const changes = r.live.freezeChanges()!
    expect(Object.keys(changes)).toEqual(['experimental'])
    const { canvasEm: _derived, ...frozen } = shown.experimental.thorn
    expect(changes.experimental!.thorn).toEqual(frozen)
    expect('canvasEm' in changes.experimental!.thorn).toBe(false)
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

  it('Strength 0 stops driving: the sliders\' own parameters, the seeds back on their fields, no markers', () => {
    const r = rig()
    const mappings = [row('distortion.amount'), row('distortion.seed', 1, 'beat')]
    r.live.setBase(BASE)
    r.live.setMappings(mappings, true)
    // A beat every 250 ms moves the seed on.
    r.play(1000, (t) => (t % 250 < 20 ? 1 : 0.6))
    for (let t = 1000; t < 1500; t += 1000 / 60) {
      r.advance(t)
      r.live.setFrame({ ...frame(0.6, t), beat: 1, onset: Math.floor(t / 250) !== Math.floor((t - 1000 / 60) / 250) })
    }
    expect(r.live.seeds.get('distortion.seed')).not.toBe(BASE.distortion.seed)
    expect(r.last?.params).toBeTruthy()
    r.live.setMappings(mappings, true, response({ strength: 0 }))
    expect(r.last).toBeNull()
    expect(r.live.status.get().driving).toBe(false)
    expect(r.live.positions.get('distortion.amount')).toBeNull()
    expect(r.live.seeds.get('distortion.seed')).toBeNull()
    const n = r.commits.length
    r.play(2000, loud)
    expect(r.commits).toHaveLength(n)
    // Back at 100 %: the seed starts again from its field.
    r.live.setMappings(mappings, true)
    r.play(2100, loud)
    expect(r.live.seeds.get('distortion.seed')).toBe(BASE.distortion.seed)
    expect(r.last?.params).toBeTruthy()
  })

  it('Strength scales the live values', () => {
    const at = (strength: number) => {
      const r = rig()
      r.live.setBase(BASE)
      r.live.setMappings([row('distortion.amount', 0.2)], true, response({ strength }))
      r.play(500, loud)
      return r.last!.params!.distortion.amount
    }
    // 10 + 200 × 0.2 × 0.8 × S.
    expect(at(1)).toBe(42)
    expect(at(2)).toBe(74)
    expect(at(0.5)).toBe(26)
  })

  it('measures the delay from a frame to its commit, smoothed', () => {
    const delays: number[] = []
    let expected: number | null = null
    const r = rig({
      cache: false,
      onCommit: (commit) => {
        if (!commit?.params) return
        // The committed frame is the one its request was made for.
        const delay = r.now - r.asked[r.asked.length - 1].frameTime
        expected = expected === null ? delay : expected + 0.3 * (delay - expected)
        expect(r.live.latencyMs()).toBeCloseTo(expected, 9)
        delays.push(delay)
      },
    })
    r.live.setBase(BASE)
    r.live.setMappings([row('distortion.amount', 1)], true)
    expect(r.live.latencyMs()).toBeNull()
    r.play(1000, sweep)
    expect(delays.length).toBeGreaterThan(20)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(5)
    expect(r.live.latencyMs()!).toBeLessThan(5 + 2 * (1000 / 60))
    // Slower geometry: the delay follows.
    r.setComputeMs(80)
    r.play(3000, sweep)
    expect(r.live.latencyMs()!).toBeGreaterThan(80)
    // Kept while Sound is stopped.
    r.setRunning(false)
    expect(r.live.latencyMs()).toBeGreaterThan(80)
  })
})

describe('live scheduler: letters on their own levels', () => {
  const slots = lettersOf(40)

  it('neutral: the letters change nothing, the same requests and commits as without them', () => {
    const run = (withSlots: boolean, r2: ResponseSettings) => {
      const r = rig()
      r.live.setBase(BASE)
      if (withSlots) r.live.setSlots(slots)
      r.live.setMappings([row('distortion.amount', 1), row('distortion.seed', 1, 'beat')], true, r2)
      r.play(2000, sweep)
      return {
        asked: r.asked.map(({ jobs, at }) => `${at}:${jobs.map((job) => `${job.key}#${job.indices?.join(',') ?? 'shown'}`).join('+')}`),
        commits: r.commits.map((c, i) => (c ? `${c.params ? paramsKey(c.params) : 'null'}|${c.seq}|${c.letters === null}|${r.commitTimes[i]}` : 'stop')),
      }
    }
    const without = run(false, NEUTRAL_RESPONSE)
    expect(without.commits.length).toBeGreaterThan(30)
    expect(run(true, NEUTRAL_RESPONSE)).toEqual(without)
    // Motion contrast without letters (no text) acts as neutral too.
    expect(run(false, response({ contrast: 1 }))).toEqual(without)
  })

  it('Motion contrast: up to three levels from one request; a steady sound drifts to new frames without new glyphs', () => {
    const r = rig()
    r.live.setBase(BASE)
    r.live.setSlots(slots)
    r.live.setMappings([row('distortion.amount', 0.5)], true, response({ contrast: 1 }))
    r.play(6000, loud)
    const lettered = r.commits.filter((c) => c?.letters)
    expect(lettered.length).toBeGreaterThan(20)
    for (const commit of lettered) {
      const { keys, jobs, slots: of } = commit!.letters!
      expect(of).toBe(slots)
      const used = new Set(keys.filter(Boolean))
      expect(used.size).toBeLessThanOrEqual(3)
      expect(used.has(paramsKey(commit!.params!))).toBe(true)
      expect(jobs.length).toBe(used.size - 1)
    }
    // One request per frame: the shared set for every glyph shown first, then the levels with their glyph ids.
    for (const { jobs } of r.asked) {
      expect(jobs[0].indices).toBeUndefined()
      expect(jobs.slice(1).every((job) => job.indices && job.indices.length > 0)).toBe(true)
    }
    // The sound is steady: the shared values and both levels stay; once their glyphs are known, the letters keep
    // moving between levels with nothing more to compute.
    const after = r.asked.filter(({ at }) => at > 3000)
    const sharedKeys = new Set(after.map(({ jobs }) => jobs[0].key))
    const levelKeys = new Set(after.flatMap(({ jobs }) => jobs.slice(1).map((job) => job.key)))
    expect(sharedKeys.size).toBe(1)
    expect(levelKeys.size).toBe(2)
    expect(after.length).toBeGreaterThan(10)
    expect(after.every(({ computed }) => computed === 0)).toBe(true)
    const frames = new Set(r.commits.filter((c, i) => c?.letters && r.commitTimes[i] > 3000).map((c) => c!.letters!.key))
    expect(frames.size).toBeGreaterThan(10)
  })

  it('a text edit (another number of letters) starts the levels afresh; the same text set differently keeps them', () => {
    const r2 = response({ contrast: 1 })
    const levels = letterLevels(r2)!
    const r = rig()
    r.live.setBase(BASE)
    r.live.setSlots(slots)
    r.live.setMappings([row('distortion.amount', 0.5)], true, r2)
    r.play(2500, loud)
    r.advance(3000)
    const shown = r.last!.letters!.assign
    const lastFrame = r.lastFrame

    // The same letters, set differently (a new object of the same length): hysteresis from the levels shown.
    const restyled = lettersOf(40)
    const kept = assignLevels(restyled, r2, lastFrame, levels, shown)
    const fresh = assignLevels(restyled, r2, lastFrame, levels, null)
    expect([...kept]).not.toEqual([...fresh])
    r.live.setSlots(restyled)
    r.advance(3100)
    expect(r.last!.letters!.slots).toBe(restyled)
    expect([...r.last!.letters!.assign]).toEqual([...kept])

    // Another text: no hysteresis from the old letters.
    const edited = lettersOf(41)
    r.live.setSlots(edited)
    r.advance(3200)
    expect(r.last!.letters!.slots).toBe(edited)
    expect([...r.last!.letters!.assign]).toEqual([...assignLevels(edited, r2, lastFrame, levels, null)])
  })

  it('Freeze with Motion contrast writes the shared values on screen, held values included', () => {
    let checked = 0
    const r = rig({
      onCommit: (commit) => {
        if (!commit?.params || !commit.letters) return
        const changes = r.live.freezeChanges()
        expect(paramsKey({ ...BASE, ...changes })).toBe(paramsKey(commit.params))
        checked++
      },
    })
    r.live.setBase(BASE)
    r.live.setSlots(slots)
    // Square waves at Strength 400 %: the flash limit holds the slider back often.
    r.live.setMappings([row('distortion.amount', 0.5), row('squaring.amount', 0.5, 'bass')], true, response({ strength: 4, contrast: 1 }))
    r.play(3000, (t) => (Math.floor(t / 125) % 2 ? 1 : 0.1))
    expect(checked).toBeGreaterThan(10)
    const shown = r.last!.params!
    const changes = r.live.freezeChanges()!
    expect(Object.keys(changes).sort()).toEqual(['distortion', 'squaring'])
    r.live.pauseSound()
    expect(r.last).toBeNull()
    expect(paramsKey({ ...BASE, ...changes })).toBe(paramsKey(shown))
  })
})
