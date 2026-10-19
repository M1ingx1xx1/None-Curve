// The parameter timeline for a playing file: a second LiveScheduler (live.ts) on a virtual clock, fed the precomputed
// feature frames (featureTimeline.ts) on the 60 Hz media grid, ahead of the playhead. Its geometry counts as instant
// (request returns false) and React as rendering at once, so every rule of the live path applies as it is (shaping,
// jumps, the flash limit, letter levels, Thorn turns, exact restore), and each commit is the frame shown at its media
// time. The director (director.ts) shows them when the playhead reaches them.
//
// The planner runs on the page (modulate needs the registered font axes, mapping.ts setTargetFont), in short slices.
// A reseed starts a new generation from PRECOMPUTE_LIMITS.warmupMs before the playhead: the frames before it feed the
// scheduler, and their commits are dropped except the one still on screen when the warm-up ends.

import { paramsKey } from '../geometry/cache'
import type { FrameJob } from '../geometry/types'
import { SHARED } from './letters'
import { LiveScheduler, PLANNER_CLOCK_OFFSET, type LiveCommit, type LiveInputs } from './live'
import { PRECOMPUTE_LIMITS, type PlannedCommit } from './timelineTypes'
import type { FeatureFrame } from './types'

/** The precomputed feature frames, by grid index. */
export interface FeatureSource {
  /** Grid frames per media second. */
  readonly hz: number
  /** Frames in the file (0: none loaded). */
  frameCount(): number
  isCovered(index: number): boolean
  /** The frame at `index` with its grid time, or null when it is not measured yet. */
  frameAt(index: number): FeatureFrame | null
}

/** A timer on the virtual clock. */
interface VirtualTimer {
  at: number
  id: number
  run: () => void
}

export class PlaybackPlanner {
  /** Bumps on every reseed; the commits belong to it. */
  generation = 0
  /** The current generation's commits, in media order (pruned behind the playhead). */
  commits: PlannedCommit[] = []
  private scheduler: LiveScheduler | null = null
  private inputs: LiveInputs | null = null
  /** The virtual clock (planner frame time: media ms + PLANNER_CLOCK_OFFSET) and its timers. */
  private clock = 0
  private timers: VirtualTimer[] = []
  private nextTimer = 1
  /** The next grid frame to feed. */
  private nextIndex = 0
  /** Commits before this media time are the warm-up's. */
  private warmUntil = 0
  /** The warm-up's newest commit: on screen when the warm-up ends. */
  private warmLast: PlannedCommit | null = null
  private warming = true
  private ended = false
  private running = true
  /** The jobs of the frame being committed (request comes just before commit). */
  private jobs: readonly FrameJob[] = []
  private seq = 0

  constructor(
    private readonly source: FeatureSource,
    private readonly wallNow: () => number = () => performance.now(),
  ) {}

  /** Media ms of the last frame fed (−1 before any). */
  plannedUntil(): number {
    return this.nextIndex > 0 ? ((this.nextIndex - 1) * 1000) / this.source.hz : -1
  }

  /** Whether every frame of the file is planned. */
  isDone(): boolean {
    return this.ended
  }

  /** New inputs (sliders, mappings, text): planned from scratch around `atMs`. */
  setInputs(inputs: LiveInputs, atMs: number) {
    this.inputs = inputs
    this.reseed(atMs)
  }

  /**
   * A new generation: a fresh scheduler fed from warmupMs before `atMs`, whose commits before `atMs` are dropped
   * (except the one on screen at `atMs`).
   */
  reseed(atMs: number) {
    this.generation++
    this.commits = []
    this.warmLast = null
    this.warming = true
    this.timers = []
    this.ended = false
    this.running = true
    this.jobs = []
    const hz = this.source.hz
    this.nextIndex = Math.max(0, Math.floor(((atMs - PRECOMPUTE_LIMITS.warmupMs) * hz) / 1000))
    this.warmUntil = Math.max(0, atMs)
    this.clock = (this.nextIndex * 1000) / hz + PLANNER_CLOCK_OFFSET
    // The old scheduler hands its last commit (exact restore) to nobody: its plan is gone.
    const old = this.scheduler
    this.scheduler = null
    old?.dispose()
    const inputs = this.inputs
    if (!inputs) return
    const scheduler = new LiveScheduler(
      {
        now: () => this.clock,
        sourceRunning: () => this.running,
        isComputing: () => false,
        request: (jobs) => {
          this.jobs = jobs
          return false
        },
        commit: (commit) => {
          if (this.scheduler === scheduler) this.record(scheduler, commit)
        },
        pauseSound: () => {},
        setTimer: (run, ms) => this.later(ms, run),
        clearTimer: (handle) => {
          const i = this.timers.findIndex((t) => t.id === handle)
          if (i >= 0) this.timers.splice(i, 1)
        },
      },
      { recordEdges: true },
    )
    this.scheduler = scheduler
    scheduler.setMappings(inputs.mappings, inputs.drive, inputs.response)
    scheduler.setSlots(inputs.slots)
    if (inputs.base) scheduler.setBase(inputs.base, inputs.hasFont)
  }

  /**
   * Plans up to media ms `untilMs`, for at most `budgetMs` of page time (frames not measured yet stop it). True when
   * the plan reaches `untilMs` or the end of the file.
   */
  ensure(untilMs: number, budgetMs: number = PRECOMPUTE_LIMITS.planSliceMs): boolean {
    const scheduler = this.scheduler
    if (!scheduler || this.ended) return this.ended
    const hz = this.source.hz
    const count = this.source.frameCount()
    const last = Math.min(count - 1, Math.floor((untilMs * hz) / 1000))
    const started = this.wallNow()
    while (this.nextIndex <= last) {
      const frame = this.source.frameAt(this.nextIndex)
      if (!frame) return false
      const time = (this.nextIndex * 1000) / hz + PLANNER_CLOCK_OFFSET
      this.advance(time)
      this.nextIndex++
      scheduler.setFrame({ ...frame, time })
      this.endWarmup(scheduler)
      if ((this.nextIndex & 7) === 0 && this.wallNow() - started >= budgetMs) return this.nextIndex > last
    }
    if (this.nextIndex >= count && count > 0 && !this.ended) {
      // The end of the file: the scheduler sees the source stop, and the sliders' own come back (exact restore).
      this.advance(this.clock + 1000 / hz)
      this.ended = true
      this.running = false
      scheduler.sourceChanged()
      this.endWarmup(scheduler)
    }
    return true
  }

  /** Drops the commits that ended before media ms `beforeMs` (the one on screen then stays). */
  prune(beforeMs: number) {
    const commits = this.commits
    let drop = 0
    while (drop + 1 < commits.length && commits[drop + 1].mediaMs <= beforeMs) drop++
    if (drop > 0) this.commits = commits.slice(drop)
  }

  dispose() {
    this.scheduler?.dispose()
    this.scheduler = null
    this.timers = []
  }

  private later(ms: number, run: () => void): number {
    const id = this.nextTimer++
    this.timers.push({ at: this.clock + Math.max(0, ms), id, run })
    return id
  }

  /** Moves the virtual clock to `to`, firing the timers due on the way in order. */
  private advance(to: number) {
    for (;;) {
      let next: VirtualTimer | null = null
      for (const timer of this.timers) if (timer.at <= to && (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) next = timer
      if (!next) break
      this.timers.splice(this.timers.indexOf(next), 1)
      this.clock = Math.max(this.clock, next.at)
      next.run()
    }
    this.clock = Math.max(this.clock, to)
  }

  /**
   * Once the playhead's frame is fed, the warm-up's commit on screen joins the plan; without one (Sound never drove
   * in the warm-up), the sliders' own, so the playhead always has a commit to show.
   */
  private endWarmup(scheduler: LiveScheduler) {
    if (!this.warming || this.clock - PLANNER_CLOCK_OFFSET < this.warmUntil) return
    this.warming = false
    const warm = this.warmLast ?? (this.commits.length === 0 ? this.planned(scheduler, null, [], this.warmUntil) : null)
    this.warmLast = null
    if (warm) this.commits.unshift(warm)
  }

  private record(scheduler: LiveScheduler, commit: LiveCommit | null) {
    const jobs = this.jobs
    this.jobs = []
    // React renders at once: the scheduler hears it before the next frame, as after a page render.
    if (commit) this.later(0, () => scheduler.rendered(commit.seq))
    const planned = this.planned(scheduler, commit, jobs, this.clock - PLANNER_CLOCK_OFFSET)
    if (!planned) return
    if (planned.mediaMs < this.warmUntil) {
      this.warmLast = planned
      return
    }
    this.commits.push(planned)
  }

  /** A commit as planned at media ms `mediaMs`: its keys and glyph ids per occurrence and what the page adopts. */
  private planned(scheduler: LiveScheduler, commit: LiveCommit | null, jobs: readonly FrameJob[], mediaMs: number): PlannedCommit | null {
    const inputs = this.inputs
    if (!inputs) return null
    const slots = inputs.slots
    const shared = commit?.params ? paramsKey(commit.params) : inputs.base ? paramsKey(inputs.base) : ''
    const letters = commit?.params ? commit.letters : null
    const keys: string[] = new Array(slots.count)
    for (let j = 0; j < slots.count; j++) keys[j] = letters && letters.slots === slots && letters.assign[j] !== SHARED ? letters.keys[letters.assign[j]] : shared
    return {
      generation: this.generation,
      seq: ++this.seq,
      mediaMs,
      commit: commit ? { params: commit.params, letters: commit.letters, look: commit.look } : null,
      jobs: commit?.params ? jobs : [],
      keys,
      indices: slots.index,
      adopted: scheduler.plannedState(),
    }
  }
}
