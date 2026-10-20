// The playback director (src/sound/director.ts) with a fake playhead, planner, scheduler, commit sink and AheadGeometry
// (ready by a predicate): it takes over only when the next enterReadyMs are ready, shows the newest ready commit at or
// before the playhead, adopts before it commits, maps media time to page time for Glide, holds a late commit at most
// holdMs before handing back to the live path, and plans nothing again after a seek (the plan is the whole file,
// NOCUR-85). Background work waits while an edit settles, stops while the page is hidden, pauses while the director
// backs off, and goes on while the file is paused (warm). Without an ahead lane it fetches each commit's glyphs on the
// canvas lane.

import { describe, expect, it } from 'vitest'
import type { FrameJob } from '../../src/geometry/types'
import type { BufferSnapshot } from '../../src/sound/bufferStore'
import { PlaybackDirector, type DirectorPlanner } from '../../src/sound/director'
import { FLASH_LIMITS } from '../../src/sound/flash'
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

function planned(seq: number, mediaMs: number, generation = 1, edges: number[] = []): PlannedCommit {
  const job: FrameJob = { params: BASE, key: `k${seq}` }
  return {
    generation,
    seq,
    mediaMs,
    commit: { params: BASE, letters: null, look: null },
    jobs: [job],
    keys: [`k${seq}`, `k${seq}`],
    indices: Int32Array.from([3, 4]),
    adopted: { brand: 'adopted', edges } as unknown as AdoptedState,
  }
}

/** A whole-file plan of commits every 1/30 s; new inputs make a new generation, planned from 0 again. */
class FakePlanner implements DirectorPlanner {
  generation = 1
  commits: PlannedCommit[] = []
  /** Inputs planned, in order. */
  planned: LiveInputs[] = []
  until = 0
  focused = 0
  private seq = 0
  private memo: { from: number; to: number; commits: PlannedCommit[]; value: PlannedCommit[] } | null = null
  constructor(
    private readonly lengthMs = 20_000,
    private readonly edgesOf: (seq: number, mediaMs: number) => number[] = () => [],
  ) {
    this.fill()
  }
  setInputs(inputs: LiveInputs) {
    this.planned.push(inputs)
    this.newPlan()
  }
  /** A new generation (as new inputs make). */
  newPlan() {
    this.generation++
    this.fill()
  }
  reset() {
    this.commits = []
    this.until = -1
  }
  focus(ms: number) {
    this.focused = ms
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
  range(from: number, to: number) {
    const memo = this.memo
    if (memo && memo.from === from && memo.to === to && memo.commits === this.commits) return memo.value
    let start = 0
    while (start + 1 < this.commits.length && this.commits[start + 1].mediaMs <= from) start++
    const value = this.commits.filter((c, i) => i >= start && c.mediaMs <= to)
    this.memo = { from, to, commits: this.commits, value }
    return value
  }
  edgesIn(after: number, until: number) {
    return this.commits.filter((c) => c.mediaMs > after && c.mediaMs <= until).flatMap((c) => [...plannedEdges(c.adopted)])
  }
  glyphRate() {
    return 60
  }
  bytes() {
    return 0
  }
  cpuMs() {
    return 0
  }
  private fill() {
    this.commits = []
    for (let t = 0; t < this.lengthMs; t += STEP) {
      const seq = ++this.seq
      this.commits.push(planned(seq, t, this.generation, this.edgesOf(seq, t)))
    }
    this.until = this.lengthMs
  }
}

function rig(
  options: {
    ahead?: boolean
    ready?: (seq: number) => boolean
    prefetchMisses?: Set<string>
    fetchMs?: number
    /** The page budget's edges in the last window. */
    recentEdges?: (since: number) => readonly number[]
    /** Each planned commit's flash edges (planner frame times). */
    edgesOf?: (seq: number, mediaMs: number) => number[]
    lengthMs?: number
    /** The ahead lane has the commit's shapes (default: when it is ready). */
    shapesReady?: (seq: number) => boolean
  } = {},
) {
  let now = 1000
  let ph: Playhead = { mediaMs: 0, wallMs: now, playing: true, generation: 0 }
  let following = false
  let inputs = INPUTS
  let hidden = false
  let pointerDownAt: number | null = null
  const log: string[] = []
  const commits: (LiveCommit | null)[] = []
  const planner = new FakePlanner(options.lengthMs, options.edgesOf)
  const adoptedEdges: (readonly number[] | undefined)[] = []
  let ready = options.ready ?? (() => true)
  const windows: AheadWindow[] = []
  const released: number[] = []
  const reserved: number[] = []
  const buffers: { snapshot: Omit<BufferSnapshot, 'version'>; force: boolean }[] = []
  // Pauses of the ahead lane: a run of pause calls until the next want counts once.
  let pausedNow = false
  let pauses = 0
  let clears = 0
  const ahead: AheadGeometry = {
    want: (w) => {
      pausedNow = false
      windows.push(w)
    },
    setPlayhead: (playheadMs, dueSeq) => {
      const last = windows.at(-1)
      if (last) windows.push({ ...last, playheadMs, dueSeq })
    },
    ready: (seq) => ready(seq),
    shapesReady: (seq) => (options.shapesReady ?? ready)(seq),
    stats: () => ({ glyphsPerSecond: 0, backlogMs: 0 }),
    release: (seq) => released.push(seq),
    pause: () => {
      if (!pausedNow) pauses++
      pausedNow = true
    },
    readyRanges: () => ({ generation: planner.generation, ranges: Float64Array.of(0, ph.mediaMs + 1000) }),
    subscribeReady: () => () => {},
    clear: () => {
      clears++
    },
  }
  const prefetched: string[] = []
  // The canvas lane: one request at a time, each taking `fetchMs` (0: there at once, unless it misses).
  const fetched = new Set<string>()
  let inFlight: { key: string; until: number } | null = null
  const settle = () => {
    if (inFlight && now >= inFlight.until) {
      fetched.add(inFlight.key)
      inFlight = null
    }
  }
  const missing = (key: string) => (options.prefetchMisses?.has(key) ?? false) || (options.fetchMs !== undefined && !fetched.has(key))
  let adoptSeq = 100
  const director = new PlaybackDirector({
    now: () => now,
    playhead: () => ph,
    timeline: { isLoaded: () => true, setSettings: () => {}, measuredUntil: () => planner.until },
    planner,
    scheduler: {
      follow: (on) => {
        following = on
        log.push(on ? 'follow' : 'back')
      },
      isFollowing: () => following,
      adopt: (_, toWall, edges) => {
        log.push(`adopt ${Math.round(toWall(PLANNER_CLOCK_OFFSET))}`)
        adoptedEdges.push(edges)
        return ++adoptSeq
      },
      inputs: () => inputs,
      recentEdges: (since: number) => options.recentEdges?.(since) ?? [],
      reserveFlashes: (until: number) => {
        reserved.push(until)
      },
    },
    commit: (commit) => {
      commits.push(commit)
      log.push(`commit ${commit?.timing?.seq ?? 'null'}`)
    },
    ahead: () => (options.ahead === false ? null : ahead),
    prefetch: (jobs) => {
      prefetched.push(jobs[0].key)
      if (!missing(jobs[0].key)) return false
      if (options.fetchMs !== undefined) inFlight = { key: jobs[0].key, until: now + options.fetchMs }
      return true
    },
    has: (jobs) => {
      settle()
      return !missing(jobs[0].key)
    },
    busy: () => {
      settle()
      return inFlight !== null
    },
    shown: () => ({ fontId: 'font', indices: [3, 4] }),
    glideMs: () => 150,
    settings: () => DEFAULT_FEATURE_SETTINGS,
    pointerDownAt: () => pointerDownAt,
    hidden: () => hidden,
    durationMs: () => options.lengthMs ?? 20_000,
    buffer: (snapshot, _, force) => buffers.push({ snapshot, force }),
  })
  /** Plays to media ms `to`, one tick per 1/60 s. */
  const play = (to: number) => {
    while (ph.mediaMs < to - 1e-9) {
      now += 1000 / 60
      ph = { ...ph, mediaMs: Math.min(to, ph.mediaMs + 1000 / 60), wallMs: now }
      director.tick()
    }
  }
  /** Waits `ms` of page time while paused, warming every 1/60 s. */
  const idle = (ms: number) => {
    const until = now + ms
    let more = false
    while (now < until - 1e-9) {
      now += 1000 / 60
      more = director.warm()
    }
    return more
  }
  return {
    director,
    planner,
    log,
    commits,
    windows,
    released,
    prefetched,
    adoptedEdges,
    buffers,
    play,
    idle,
    get following() {
      return following
    },
    reserved,
    get clears() {
      return clears
    },
    get pauses() {
      return pauses
    },
    setReady: (fn: (seq: number) => boolean) => (ready = fn),
    setInputs: (next: LiveInputs) => (inputs = next),
    setHidden: (on: boolean) => (hidden = on),
    pointer: (down: boolean) => (pointerDownAt = down ? now : null),
    seek: (mediaMs: number) => {
      ph = { ...ph, mediaMs, generation: ph.generation + 1 }
    },
    pause: () => {
      ph = { ...ph, playing: false }
      director.tick()
      director.stop()
    },
    resume: () => {
      ph = { ...ph, playing: true }
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
  it('takes over with the commit due when only its shapes are ready (it glides in from the screen, not its chain)', () => {
    // Every commit is fully ready except the first ones' Glide steps; their shapes are there.
    const r = rig({ shapesReady: () => true })
    // The commit due at the playhead (looked up each time: the first tick plans afresh, with new seqs) lacks its steps.
    r.setReady((seq) => seq !== lastAt(r.planner.commits, r.ph.mediaMs).seq)
    r.play(1000 / 60)
    expect(r.following).toBe(true)
  })

  it('still waits for the commits after the one due to be fully ready', () => {
    const r = rig({ ready: () => false, shapesReady: () => true })
    r.play(200)
    expect(r.following).toBe(false)
  })

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

  it('plans nothing again after a seek: picks the plan up there, checking the flash limit first', () => {
    const r = rig()
    r.play(300)
    expect(r.following).toBe(true)
    const generation = r.planner.generation
    r.seek(100)
    r.play(120)
    expect(r.planner.generation).toBe(generation)
    expect(r.planner.planned).toHaveLength(1)
    expect(r.following).toBe(true)
    expect(r.commits.at(-1)!.timing!.seq).toBe(lastAt(r.planner.commits, 120).seq)
    // The window moved with the playhead.
    expect(r.windows.at(-1)!.playheadMs).toBeGreaterThan(100)
    r.seek(15_000)
    r.play(15_020)
    expect(r.planner.generation).toBe(generation)
    expect(r.commits.at(-1)!.timing!.mediaMs).toBeGreaterThan(14_900)
  })

  it('after a seek shows only the commit due, never a ready one from before the jump', () => {
    const r = rig({ lengthMs: 60_000 })
    r.play(300)
    expect(r.following).toBe(true)
    // Ready up to 10 s; the playhead jumps to 12 s, where nothing is ready.
    r.setReady((seq) => r.planner.commits.find((c) => c.seq === seq)!.mediaMs <= 10_000)
    const shown = r.commits.length
    r.seek(12_000)
    r.play(12_000 + PRECOMPUTE_LIMITS.holdMs / 2)
    expect(r.commits.slice(shown).every((c) => c!.timing!.mediaMs > 11_000)).toBe(true)
    r.play(12_000 + 2 * PRECOMPUTE_LIMITS.holdMs)
    expect(r.following).toBe(false)
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
    const next = r.planner.range(-Infinity, Infinity).find((c) => c.mediaMs > 50 + STEP)!
    misses.add(`k${next.seq}`)
    r.play(next.mediaMs + 10)
    expect(r.prefetched).toContain(`k${next.seq}`)
    expect(r.commits.at(-1)!.timing!.seq).toBeLessThan(next.seq)
    misses.clear()
    r.play(next.mediaMs + 30)
    expect(r.commits.some((c) => c!.timing!.seq === next.seq)).toBe(true)
  })

  it('without an ahead lane, keeps one canvas request in flight and keeps showing when geometry is slower than 30 Hz', () => {
    const r = rig({ ahead: false, fetchMs: 50 })
    r.play(3000)
    // Never handed back: each commit shows late, but the screen keeps moving.
    expect(r.log).not.toContain('back')
    expect(r.following).toBe(true)
    // One request per commit fetched, never a second one replacing it.
    expect(new Set(r.prefetched).size).toBe(r.prefetched.length)
    const shown = r.commits.map((c) => c!.timing!.seq)
    expect(shown.length).toBeGreaterThan(30)
    expect(shown.length).toBeLessThan(3000 / STEP)
  })
})

describe('the director and the flash limit', () => {
  // A planned edge on every 6th commit: about 5 a second, 6 within a window.
  const edgesOf = (seq: number, mediaMs: number) => (seq % 6 === 0 ? [mediaMs + PLANNER_CLOCK_OFFSET] : [])

  // `count` edges the screen showed just now (the newest window ends at since + windowMs).
  const lately = (count: number) => (since: number) =>
    Array.from({ length: count }, (_, k) => since + FLASH_LIMITS.windowMs - 1 - (count - k))

  it('keeps the live path from new flash edges for a window when only the flash limit stands in the way, then takes over', () => {
    // The live path keeps the budget spent (an edge every 100 ms, the six newest kept) until the director reserves it.
    const reservations: number[] = []
    const r = rig({
      edgesOf,
      recentEdges: (since) => {
        const now = since + FLASH_LIMITS.windowMs
        const stop = reservations.length ? reservations[0] - FLASH_LIMITS.windowMs : Infinity
        const edges: number[] = []
        for (let t = Math.floor(Math.min(now, stop - 1) / 100) * 100; t >= since && edges.length < 6; t -= 100) edges.unshift(t)
        return edges
      },
    })
    const reservedBy = () => reservations.splice(0, reservations.length, ...r.reserved)
    r.play(200)
    reservedBy()
    expect(r.following).toBe(false)
    expect(r.reserved).toHaveLength(1)
    // As soon as the live path's last edges are old enough for the plan's to fit (within a window), it takes over;
    // the reservation was asked for once.
    r.play(200 + FLASH_LIMITS.windowMs + 200)
    expect(r.following).toBe(true)
    expect(r.reserved).toHaveLength(1)
  })

  it('takes over only when the edges the screen showed lately and the planned ones fit every window', () => {
    let recent = lately(3)
    const r = rig({ recentEdges: (since) => recent(since), edgesOf })
    r.play(400)
    // 3 just now and about 6 planned within the next window: more than 2 × maxFlashes in one window.
    expect(r.following).toBe(false)
    recent = lately(0)
    r.play(420)
    expect(r.following).toBe(true)
  })


  it('takes over at once without recent edges, and a new generation waits for room too', () => {
    let recent = lately(0)
    const r = rig({ recentEdges: (since) => recent(since), edgesOf })
    r.play(300)
    expect(r.following).toBe(true)
    const shown = r.commits.length
    recent = lately(6)
    r.planner.newPlan()
    r.play(300 + PRECOMPUTE_LIMITS.holdMs / 2)
    // Nothing of the new generation shows while the budget is full.
    expect(r.commits.length).toBe(shown)
    r.play(300 + PRECOMPUTE_LIMITS.holdMs + 60)
    expect(r.following).toBe(false)
  })

  it('brings the edges of planned commits it skipped along with the next one it shows', () => {
    const r = rig({ edgesOf })
    r.play(300)
    expect(r.following).toBe(true)
    // The next commit with an edge is not ready; the one after it is.
    const edged = r.planner.range(-Infinity, Infinity).find((c) => c.mediaMs > 300 && plannedEdges(c.adopted).length > 0)!
    r.setReady((seq) => seq !== edged.seq)
    r.play(edged.mediaMs + STEP + 1)
    expect(r.commits.some((c) => c!.timing!.seq === edged.seq)).toBe(false)
    const edges = r.adoptedEdges.at(-1)!
    expect(edges).toContain(plannedEdges(edged.adopted)[0])
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
    planner.setInputs(inputs)
    planner.ensure(Infinity, Infinity)
    const withEdges = planner.range(-Infinity, Infinity).find((c) => c.commit && plannedEdges(c.adopted).length > 0)!
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

  it('hands back with the flash state on screen: a move back from the planned sliders is a turn, and the seeds stay', () => {
    const frames = Array.from({ length: 180 }, (_, k) => frameAt(k))
    const planner = new PlaybackPlanner({ hz: 60, frameCount: () => frames.length, isCovered: () => true, frameAt: (i) => frames[i] ?? null })
    planner.setInputs(inputs)
    planner.ensure(Infinity, Infinity)
    // A commit in a loud stretch after the sliders turned, with the seed moved on by its jumps.
    const high = planner.range(-Infinity, Infinity).find(
      (c) => c.mediaMs > 1000 && c.commit?.params && frames[Math.round((c.mediaMs * 60) / 1000)].level > 0.5 && c.commit.params.distortion.seed !== inputs.base!.distortion.seed,
    )!
    expect(high).toBeDefined()
    const p = page()
    p.at(6000)
    p.live.follow(true)
    // Its own edges far in the past, apart from the one counted below.
    p.live.adopt(high.adopted, (t) => t - 100_000)
    // Quiet now: the slider falls back from where the screen shows it.
    p.live.setFrame({ ...frameAt(15), time: 6000 })
    p.live.follow(false)
    expect(p.live.recentEdges(5999)).toHaveLength(1)
    expect(p.commits.at(-1)?.params?.distortion.seed).toBe(high.commit!.params!.distortion.seed)
  })

  it('stops with the sliders’ own when the sound stops after handing back', () => {
    const frames = Array.from({ length: 60 }, (_, k) => frameAt(k))
    const planner = new PlaybackPlanner({ hz: 60, frameCount: () => frames.length + 600, isCovered: (i) => i < frames.length, frameAt: (i) => frames[i] ?? null })
    planner.setInputs(inputs)
    planner.ensure(Infinity, Infinity)
    const driving = planner.range(-Infinity, Infinity).find((c) => c.commit)!
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

describe('the director backing off', () => {
  const { tryMs } = PRECOMPUTE_LIMITS
  const [firstPause] = PRECOMPUTE_LIMITS.backoffMs

  it('pauses preparing geometry when it cannot take over for tryMs, and tries again after a pause twice as long each time', () => {
    const r = rig({ ready: () => false, lengthMs: 60_000 })
    r.play(tryMs - 100)
    expect(r.pauses).toBe(0)
    r.play(tryMs + 100)
    // The workers stop on the window; what was prepared stays, and nothing more is asked for during the pause.
    expect(r.pauses).toBe(1)
    expect(r.clears).toBe(0)
    const asked = r.windows.length
    r.play(tryMs + firstPause - 100)
    expect(r.windows.length).toBe(asked)
    // After the pause it asks for geometry again; nothing is planned again.
    r.play(tryMs + firstPause + 200)
    expect(r.windows.length).toBeGreaterThan(asked)
    expect(r.planner.planned).toHaveLength(1)
    // A second failed try: the pause doubles.
    const second = 2 * tryMs + firstPause + 200
    r.play(second)
    expect(r.pauses).toBe(2)
    const asked2 = r.windows.length
    r.play(second + 2 * firstPause - 200)
    expect(r.windows.length).toBe(asked2)
    r.play(second + 2 * firstPause + 200)
    expect(r.windows.length).toBeGreaterThan(asked2)
    expect(r.following).toBe(false)
  })

  it('takes over after a pause when the geometry keeps up again, and starts the pauses over', () => {
    const r = rig({ ready: () => false, lengthMs: 60_000 })
    r.play(tryMs + 100)
    expect(r.pauses).toBe(1)
    r.setReady(() => true)
    r.play(tryMs + firstPause + 500)
    expect(r.following).toBe(true)
    // Not following again: the next pause is the first one's length.
    r.setReady(() => false)
    const from = r.ph.mediaMs
    r.play(from + PRECOMPUTE_LIMITS.holdMs + tryMs + 200)
    expect(r.pauses).toBe(2)
    const asked = r.windows.length
    r.play(from + PRECOMPUTE_LIMITS.holdMs + tryMs + firstPause + 300)
    expect(r.windows.length).toBeGreaterThan(asked)
  })

  it('does not back off while following, nor count a pause in playback', () => {
    const r = rig({ lengthMs: 60_000 })
    r.play(tryMs * 2)
    expect(r.following).toBe(true)
    expect(r.pauses).toBe(0)
  })
})

describe('the director in the background', () => {
  it('prepares the window around the playhead while the file is paused, so Play starts on planned commits', () => {
    const r = rig({ lengthMs: 60_000 })
    r.seek(15_000)
    r.pause()
    expect(r.idle(100)).toBe(true)
    expect(r.following).toBe(false)
    const w = r.windows.at(-1)!
    expect(w.playheadMs).toBe(15_000)
    expect(w.commits[0].mediaMs).toBeLessThanOrEqual(15_000 - PRECOMPUTE_LIMITS.windowBehindMs + STEP)
    expect(w.commits.at(-1)!.mediaMs).toBeGreaterThan(15_000 + PRECOMPUTE_LIMITS.windowAheadMs - 2 * STEP)
    expect(r.planner.focused).toBe(15_000)
    r.resume()
    r.play(15_000 + 1000 / 60)
    expect(r.following).toBe(true)
  })

  it('waits while an edit settles: hands back at once, plans after settleMs, or once the pointer is up', () => {
    const r = rig()
    r.play(300)
    expect(r.following).toBe(true)
    expect(r.planner.planned).toHaveLength(1)
    r.setInputs({ ...INPUTS, mappings: [] })
    r.play(320)
    expect(r.following).toBe(false)
    expect(r.pauses).toBe(1)
    expect(r.planner.planned).toHaveLength(1)
    r.play(300 + PRECOMPUTE_LIMITS.settleMs + 50)
    expect(r.planner.planned).toHaveLength(2)
    expect(r.following).toBe(true)
    // A drag: the pointer went down before the edit; it settles only after the pointer is up.
    r.pointer(true)
    r.setInputs({ ...INPUTS, mappings: [] })
    const from = r.ph.mediaMs
    r.play(from + 2 * PRECOMPUTE_LIMITS.settleMs)
    expect(r.planner.planned).toHaveLength(2)
    r.pointer(false)
    r.play(from + 2 * PRECOMPUTE_LIMITS.settleMs + 50)
    expect(r.planner.planned).toHaveLength(3)
  })

  it('stops the workers while the page is hidden', () => {
    const r = rig()
    r.play(200)
    r.setHidden(true)
    const asked = r.windows.length
    r.play(400)
    expect(r.pauses).toBe(1)
    expect(r.windows.length).toBe(asked)
    r.setHidden(false)
    r.play(420)
    expect(r.windows.length).toBeGreaterThan(asked)
  })

  it('publishes what is prepared for the buffered bar: at once for a new plan or file', () => {
    const r = rig()
    r.play(100)
    // Offered at once, then at most every bufferEveryMs.
    expect(r.buffers).toHaveLength(1)
    expect(r.buffers[0].force).toBe(true)
    r.play(100 + PRECOMPUTE_LIMITS.bufferEveryMs)
    expect(r.buffers).toHaveLength(2)
    expect(r.buffers.at(-1)!.snapshot.durationMs).toBe(20_000)
    expect(r.buffers.at(-1)!.snapshot.plannedMs).toBe(20_000)
    expect(r.buffers.at(-1)!.snapshot.ready[0]).toBe(0)
    expect(r.buffers.at(-1)!.snapshot.ready[1]).toBeGreaterThan(r.buffers[0].snapshot.ready[1] + 200)
    expect(r.buffers.slice(1).every((b) => !b.force)).toBe(true)
    // An edit: the bar drops back at once while it settles (the old plan's ranges no longer hold), and once.
    const offered = r.buffers.length
    r.setInputs({ ...INPUTS, mappings: [] })
    r.play(r.ph.mediaMs + PRECOMPUTE_LIMITS.settleMs / 2)
    expect(r.buffers.slice(offered)).toEqual([{ snapshot: { durationMs: 20_000, plannedMs: 0, ready: new Float32Array(0) }, force: true }])
    r.play(r.ph.mediaMs + PRECOMPUTE_LIMITS.settleMs)
    expect(r.buffers.filter((b) => b.force)).toHaveLength(3)
    expect(r.buffers.at(-1)!.snapshot.plannedMs).toBe(20_000)
    r.director.reset()
    expect(r.buffers.at(-1)).toEqual({ snapshot: { durationMs: 0, plannedMs: 0, ready: new Float32Array(0) }, force: true })
    expect(r.clears).toBe(1)
  })
})
