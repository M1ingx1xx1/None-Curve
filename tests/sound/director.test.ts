// The playback director (src/sound/director.ts) with a fake playhead, planner, scheduler, commit sink and AheadGeometry
// (ready by a predicate): it takes over only when the next enterReadyMs are ready, shows the newest ready commit at or
// before the playhead, adopts before it commits, maps media time to page time for Glide, holds a late commit at most
// holdMs before handing back to the live path, and plans again after a seek. Without an ahead lane it fetches each
// commit's glyphs on the canvas lane.

import { describe, expect, it } from 'vitest'
import type { FrameJob } from '../../src/geometry/types'
import { PlaybackDirector, type DirectorPlanner } from '../../src/sound/director'
import { LiveScheduler, PLANNER_CLOCK_OFFSET, plannedEdges, type LiveCommit, type LiveDeps, type LiveInputs } from '../../src/sound/live'
import type { Mapping } from '../../src/sound/mapping'
import { PlaybackPlanner } from '../../src/sound/planner'
import { NO_SLOTS } from '../../src/sound/letters'
import type { AheadGeometry, AheadWindow } from '../../src/state/aheadTypes'
import { PRECOMPUTE_LIMITS, type AdoptedState, type PlannedCommit, type Playhead } from '../../src/sound/timelineTypes'
import { DEFAULT_FEATURE_SETTINGS, NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { BASE } from '../helpers/params'

const STEP = 1000 / 30

/** The last commit at or before media ms `ms`. */
const lastAt = (commits: readonly PlannedCommit[], ms: number) => commits.filter((c) => c.mediaMs <= ms).at(-1)!
const INPUTS: LiveInputs = { base: BASE, hasFont: true, mappings: [], drive: true, response: NEUTRAL_RESPONSE, slots: NO_SLOTS }

function planned(seq: number, mediaMs: number, generation = 1): PlannedCommit {
  const job: FrameJob = { params: BASE, key: `k${seq}` }
  return {
    generation,
    seq,
    mediaMs,
    commit: { params: BASE, letters: null, look: null },
    jobs: [job],
    keys: [`k${seq}`, `k${seq}`],
    indices: Int32Array.from([3, 4]),
    adopted: { brand: 'adopted', edges: [] } as unknown as AdoptedState,
  }
}

/** A plan of commits every 1/30 s from `from` to `to` media ms; reseed makes a new generation from `at`. */
class FakePlanner implements DirectorPlanner {
  generation = 1
  commits: PlannedCommit[] = []
  reseeds: number[] = []
  until = 0
  private seq = 0
  constructor(private readonly lengthMs = 20_000) {
    this.fill(0)
  }
  setInputs(_: LiveInputs, atMs: number) {
    this.reseed(atMs)
  }
  reseed(atMs: number) {
    this.reseeds.push(atMs)
    this.generation++
    this.fill(Math.max(0, atMs - STEP / 2))
  }
  ensure() {
    return true
  }
  plannedUntil() {
    return this.until
  }
  isDone() {
    return false
  }
  prune(beforeMs: number) {
    while (this.commits.length > 1 && this.commits[1].mediaMs <= beforeMs) this.commits.shift()
  }
  private fill(from: number) {
    this.commits = []
    for (let t = from; t < this.lengthMs; t += STEP) this.commits.push(planned(++this.seq, t, this.generation))
    this.until = this.lengthMs
  }
}

function rig(options: { ahead?: boolean; ready?: (seq: number) => boolean; prefetchMisses?: Set<string> } = {}) {
  let now = 1000
  let ph: Playhead = { mediaMs: 0, wallMs: now, playing: true, generation: 0 }
  let following = false
  const log: string[] = []
  const commits: (LiveCommit | null)[] = []
  const planner = new FakePlanner()
  let ready = options.ready ?? (() => true)
  const windows: AheadWindow[] = []
  const released: number[] = []
  const ahead: AheadGeometry = {
    want: (w) => windows.push(w),
    ready: (seq) => ready(seq),
    stats: () => ({ glyphsPerSecond: 0, backlogMs: 0 }),
    release: (seq) => released.push(seq),
    subscribeReady: () => () => {},
    clear: () => {},
  }
  const prefetched: string[] = []
  let adoptSeq = 100
  const director = new PlaybackDirector({
    now: () => now,
    playhead: () => ph,
    timeline: { isLoaded: () => true, seek: () => {}, setSettings: () => {} },
    planner,
    scheduler: {
      follow: (on) => {
        following = on
        log.push(on ? 'follow' : 'back')
      },
      isFollowing: () => following,
      adopt: (_, toWall) => {
        log.push(`adopt ${Math.round(toWall(PLANNER_CLOCK_OFFSET))}`)
        return ++adoptSeq
      },
      inputs: () => INPUTS,
    },
    commit: (commit) => {
      commits.push(commit)
      log.push(`commit ${commit?.timing?.seq ?? 'null'}`)
    },
    ahead: () => (options.ahead === false ? null : ahead),
    prefetch: (jobs) => {
      prefetched.push(jobs[0].key)
      return options.prefetchMisses?.has(jobs[0].key) ?? false
    },
    resolve: (jobs) => ({ fontId: 'font', jobs: jobs.map((j) => ({ params: j.params, key: j.key, indices: [3, 4] })) }),
    glideMs: () => 150,
    settings: () => DEFAULT_FEATURE_SETTINGS,
  })
  /** Plays to media ms `to`, one tick per 1/60 s. */
  const play = (to: number) => {
    while (ph.mediaMs < to - 1e-9) {
      now += 1000 / 60
      ph = { ...ph, mediaMs: Math.min(to, ph.mediaMs + 1000 / 60), wallMs: now }
      director.tick()
    }
  }
  return {
    director,
    planner,
    log,
    commits,
    windows,
    released,
    prefetched,
    play,
    get following() {
      return following
    },
    setReady: (fn: (seq: number) => boolean) => (ready = fn),
    seek: (mediaMs: number) => {
      ph = { ...ph, mediaMs, generation: ph.generation + 1 }
    },
    pause: () => {
      ph = { ...ph, playing: false }
      director.tick()
    },
    get now() {
      return now
    },
    get ph() {
      return ph
    },
  }
}

describe('playback director', () => {
  it('takes over only when the commits of the next enterReadyMs are ready', () => {
    let readyUpTo = 0
    const r = rig({ ready: (seq) => seq <= readyUpTo })
    r.play(200)
    expect(r.following).toBe(false)
    expect(r.windows.length).toBeGreaterThan(0)
    // The window is for one generation and font, from the commit due, with each commit's glide steps.
    const w = r.windows.at(-1)!
    expect(w.fontId).toBe('font')
    expect(w.glideMs).toBe(150)
    expect(w.commits[0].mediaMs).toBeLessThanOrEqual(200)
    expect(w.commits[0].jobs[0].indices).toEqual([3, 4])
    expect(w.commits[1].steps.length).toBe(2)
    expect(w.commits[1].prevSeq).toBe(w.commits[0].seq)
    // Ready up to 300 ms past the playhead: not enough.
    const seqAt = (ms: number) => lastAt(r.planner.commits, ms).seq
    readyUpTo = seqAt(r.ph.mediaMs + 300)
    r.play(220)
    expect(r.following).toBe(false)
    readyUpTo = Infinity
    r.play(240)
    expect(r.following).toBe(true)
    expect(r.log.slice(-3, -1)).toEqual(['follow', expect.stringMatching(/^adopt/)])
  })

  it('shows the newest ready commit at or before the playhead, adopting it first, timed in page time', () => {
    const r = rig()
    r.play(100)
    expect(r.following).toBe(true)
    const last = r.commits.at(-1)!
    const due = lastAt(r.planner.commits, 100)
    expect(last.timing!.seq).toBe(due.seq)
    expect(last.timing!.mediaMs).toBe(due.mediaMs)
    // Media time maps to page time through the playhead: wall = ph.wall - (ph.media - media).
    expect(last.timing!.wallMs).toBeCloseTo(r.ph.wallMs - (r.ph.mediaMs - due.mediaMs), 9)
    expect(last.timing!.lineage).toHaveLength(2)
    // Adopt comes right before each commit, and every commit gets a new page seq.
    const adoptAt = r.log.lastIndexOf(r.log.filter((l) => l.startsWith('adopt')).at(-1)!)
    expect(r.log[adoptAt + 1]).toBe(`commit ${due.seq}`)
    const seqs = r.commits.map((c) => c!.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    // Each shown commit's chain predecessor is the one before it in the selection.
    const shown = r.commits.map((c) => c!.timing!)
    for (let i = 1; i < shown.length; i++) expect(shown[i].prevSeq).toBe(shown[i - 1].seq)
  })

  it('holds a late commit up to holdMs, then hands back to the live path', () => {
    const r = rig()
    r.play(500)
    expect(r.following).toBe(true)
    // Nothing after 520 ms is ready.
    const lastReady = lastAt(r.planner.commits, 520).seq
    r.setReady((seq) => seq <= lastReady)
    r.play(520 + PRECOMPUTE_LIMITS.holdMs - 30)
    expect(r.following).toBe(true)
    expect(r.commits.at(-1)!.timing!.seq).toBe(lastReady)
    r.play(520 + PRECOMPUTE_LIMITS.holdMs + 60)
    expect(r.following).toBe(false)
    expect(r.log.at(-1)).toBe('back')
    // Ready again: back in.
    r.setReady(() => true)
    r.play(1200)
    expect(r.following).toBe(true)
  })

  it('shows an older ready commit when the newest is not ready yet', () => {
    const r = rig()
    r.play(300)
    const due = lastAt(r.planner.commits, 400)
    r.setReady((seq) => seq !== due.seq)
    r.play(400)
    expect(r.commits.at(-1)!.timing!.seq).toBe(due.seq - 1)
    r.setReady(() => true)
    r.play(410)
    expect(r.commits.at(-1)!.timing!.seq).toBe(due.seq)
  })

  it('plans again after a seek beyond the plan, and hands back until ready', () => {
    const r = rig()
    r.play(300)
    expect(r.following).toBe(true)
    const generation = r.planner.generation
    // Pruned behind the playhead, so a seek back is not covered.
    r.planner.prune(250)
    r.seek(100)
    r.play(120)
    // The first tick after the seek is a frame later.
    expect(r.planner.reseeds.at(-1)).toBeCloseTo(100 + 1000 / 60, 9)
    expect(r.planner.generation).toBe(generation + 1)
    expect(r.log).toContain('back')
    expect(r.following).toBe(true)
    expect(r.commits.at(-1)!.timing!.generation).toBe(generation + 1)
    // A seek within the plan keeps it.
    const reseeds = r.planner.reseeds.length
    r.seek(2000)
    r.play(2020)
    expect(r.planner.reseeds.length).toBe(reseeds)
  })

  it('hands back when playback stops', () => {
    const r = rig()
    r.play(200)
    expect(r.following).toBe(true)
    r.pause()
    expect(r.following).toBe(false)
  })

  it('without an ahead lane, fetches each commit’s glyphs on the canvas lane and waits for them', () => {
    const misses = new Set<string>()
    const r = rig({ ahead: false, prefetchMisses: misses })
    r.play(50)
    expect(r.following).toBe(true)
    const next = r.planner.commits.find((c) => c.mediaMs > 50 + STEP)!
    misses.add(`k${next.seq}`)
    r.play(next.mediaMs + 10)
    expect(r.prefetched).toContain(`k${next.seq}`)
    expect(r.commits.at(-1)!.timing!.seq).toBeLessThan(next.seq)
    misses.clear()
    r.play(next.mediaMs + 30)
    expect(r.commits.some((c) => c!.timing!.seq === next.seq)).toBe(true)
  })
})

describe('the page scheduler following planned commits', () => {
  const mapping: Mapping = { id: 'm', enabled: true, feature: 'level', target: 'distortion.amount', depth: 1 }
  const seedMapping: Mapping = { id: 's', enabled: true, feature: 'level', target: 'distortion.seed', depth: 1 }
  const inputs: LiveInputs = { ...INPUTS, mappings: [mapping, seedMapping], base: { ...BASE, distortion: { ...BASE.distortion, amount: 10 } } }
  const frameAt = (k: number): FeatureFrame => {
    const level = k % 20 < 10 ? 0.9 : 0.1
    return { ...SILENT_FRAME, time: (k * 1000) / 60, level, silent: false, levelDb: -20 }
  }

  function page() {
    let now = 0
    const commits: (LiveCommit | null)[] = []
    const deps: LiveDeps = {
      now: () => now,
      sourceRunning: () => true,
      isComputing: () => false,
      request: () => false,
      commit: (commit) => commits.push(commit),
      pauseSound: () => {},
      setTimer: () => 0,
      clearTimer: () => {},
    }
    const live = new LiveScheduler(deps)
    live.setMappings(inputs.mappings, inputs.drive, inputs.response)
    live.setBase(inputs.base!, true)
    return { live, commits, at: (ms: number) => (now = ms) }
  }

  it('is off by default, and adopts markers, status and Freeze from a planned commit without committing', () => {
    const frames = Array.from({ length: 180 }, (_, k) => frameAt(k))
    const planner = new PlaybackPlanner({ hz: 60, frameCount: () => frames.length, isCovered: () => true, frameAt: (i) => frames[i] ?? null })
    planner.setInputs(inputs, 0)
    planner.ensure(Infinity, Infinity)
    const withEdges = planner.commits.find((c) => c.commit && plannedEdges(c.adopted).length > 0)!
    expect(withEdges).toBeDefined()

    const p = page()
    expect(p.live.isFollowing()).toBe(false)
    p.at(5000)
    p.live.follow(true)
    const seq = p.live.adopt(withEdges.adopted, (t) => 4000 + t)
    expect(seq).toBeGreaterThan(0)
    expect(p.live.status.get()).toMatchObject({ driving: true, differs: true })
    expect(p.live.positions.get('distortion.amount')).not.toBeNull()
    expect(p.live.freezeChanges()?.distortion?.amount).toBe(withEdges.commit!.params!.distortion.amount)
    // Frames are kept, not committed.
    const before = p.commits.length
    for (let k = 0; k < 30; k++) {
      p.at(5000 + k * 16)
      p.live.setFrame({ ...frameAt(k), time: 5000 + k * 16 })
    }
    expect(p.commits.length).toBe(before)
    // Back on the live path: the next frame commits again.
    p.live.follow(false)
    p.at(6000)
    // A level no planned commit showed.
    p.live.setFrame({ ...frameAt(3), level: 0.5, time: 6000 })
    expect(p.commits.length).toBeGreaterThan(before)
  })

  it('stops with the sliders’ own when the sound stops after handing back', () => {
    const frames = Array.from({ length: 60 }, (_, k) => frameAt(k))
    const planner = new PlaybackPlanner({ hz: 60, frameCount: () => frames.length + 600, isCovered: (i) => i < frames.length, frameAt: (i) => frames[i] ?? null })
    planner.setInputs(inputs, 0)
    planner.ensure(Infinity, Infinity)
    const driving = planner.commits.find((c) => c.commit)!
    const p = page()
    p.live.follow(true)
    p.live.adopt(driving.adopted, (t) => t)
    let running = true
    const live = p.live as unknown as { deps: LiveDeps }
    live.deps.sourceRunning = () => running
    running = false
    p.live.follow(false)
    expect(p.commits.at(-1)).toBeNull()
    expect(p.live.status.get().driving).toBe(false)
  })
})
