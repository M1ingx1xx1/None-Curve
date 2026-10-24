// The parameter timeline for a playing file: a second LiveScheduler (live.ts) on a virtual clock, fed the precomputed
// feature frames (featureTimeline.ts) on the 60 Hz media grid. Its geometry counts as instant (request returns false)
// and React as rendering at once, so every rule of the live path applies as it is (shaping, jumps, the flash limit,
// letter levels, Thorn turns, exact restore), and each commit is the frame shown at its media time. The director
// (director.ts) shows them when the playhead reaches them.
//
// The whole file is planned (NOCUR-85), always from media 0 and in order, so seeds, smoothing, the flash budget and
// letter levels carry forward exactly; a seek never plans again. New inputs start a new generation, planned from 0
// once more. The director plans the stretch just past the playhead first and the rest in the background, in short
// slices on the page (modulate needs the registered font axes, mapping.ts setTargetFont). The commits are kept
// compact (planStore.ts); past the plan's byte budget, those far from the playhead are thinned, and a thinned stretch
// the playhead comes back to is planned again from the start (the same commits: the plan is deterministic).

import { paramsKey } from '../geometry/paramsKey'
import type { FrameJob } from '../geometry/types'
import { SHARED } from './letters'
import { LiveScheduler, PLANNER_CLOCK_OFFSET, type LiveCommit, type LiveInputs } from './live'
import { PlanStore, type PlanRecord } from './planStore'
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

/** After a thin, the next waits until the playhead moved this far (media ms), unless the plan grew. */
const THIN_AGAIN_MS = 5000

/** A generation's commits are numbered from generation × SEQ_SPAN, so a commit planned again keeps its seq. */
export const SEQ_SPAN = 1_000_000

/** A timer on the virtual clock. */
interface VirtualTimer {
  at: number
  id: number
  run: () => void
}

/**
 * One pass of planning through the file from its start: a scheduler on its own virtual clock. `emit` hears each
 * commit with its number in the pass (0, 1, …) and the key of the parameters it shows.
 */
class PlanPass {
  private scheduler: LiveScheduler | null
  private clock = PLANNER_CLOCK_OFFSET
  private timers: VirtualTimer[] = []
  private nextTimer = 1
  /** The next grid frame to feed. */
  nextIndex = 0
  ended = false
  private running = true
  private started = false
  /** The jobs of the frame being committed (request comes just before commit). */
  private jobs: readonly FrameJob[] = []
  private count = 0

  constructor(
    private readonly source: FeatureSource,
    private readonly inputs: LiveInputs,
    private readonly generation: number,
    private readonly emit: (commit: PlannedCommit, ordinal: number, sharedKey: string) => void,
  ) {
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

  /** Feeds frames up to index `last` until page time `deadline`; false when it stopped at a frame not measured yet. */
  feed(last: number, deadline: number, wallNow: () => number): boolean {
    const scheduler = this.scheduler
    if (!scheduler || this.ended) return true
    const hz = this.source.hz
    const count = this.source.frameCount()
    const end = Math.min(count - 1, last)
    while (this.nextIndex <= end) {
      const frame = this.source.frameAt(this.nextIndex)
      if (!frame) return false
      const time = (this.nextIndex * 1000) / hz + PLANNER_CLOCK_OFFSET
      this.advance(time)
      this.nextIndex++
      scheduler.setFrame({ ...frame, time })
      if (!this.started) {
        // The playhead always has a commit to show: without one at the first frame, the sliders' own.
        this.started = true
        if (this.count === 0) this.push(scheduler, null, [], 0)
      }
      if ((this.nextIndex & 7) === 0 && wallNow() >= deadline) return true
    }
    if (this.nextIndex >= count && count > 0 && !this.ended) {
      // The end of the file: the scheduler sees the source stop, and the sliders' own come back (exact restore).
      this.advance(this.clock + 1000 / hz)
      this.ended = true
      this.running = false
      scheduler.sourceChanged()
    }
    return true
  }

  dispose() {
    // Detached first: what the scheduler commits as it goes is no commit of the plan.
    const scheduler = this.scheduler
    this.scheduler = null
    scheduler?.dispose()
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
      for (const timer of this.timers)
        if (timer.at <= to && (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id)))
          next = timer
      if (!next) break
      this.timers.splice(this.timers.indexOf(next), 1)
      this.clock = Math.max(this.clock, next.at)
      next.run()
    }
    this.clock = Math.max(this.clock, to)
  }

  private record(scheduler: LiveScheduler, commit: LiveCommit | null) {
    const jobs = this.jobs
    this.jobs = []
    // React renders at once: the scheduler hears it before the next frame, as after a page render.
    if (commit) this.later(0, () => scheduler.rendered(commit.seq))
    this.push(scheduler, commit, jobs, this.clock - PLANNER_CLOCK_OFFSET)
  }

  /** A commit as planned at media ms `mediaMs`: its keys and glyph ids per occurrence and what the page adopts. */
  private push(scheduler: LiveScheduler, commit: LiveCommit | null, jobs: readonly FrameJob[], mediaMs: number) {
    const inputs = this.inputs
    const slots = inputs.slots
    const shared = commit?.params ? paramsKey(commit.params) : inputs.base ? paramsKey(inputs.base) : ''
    const letters = commit?.params ? commit.letters : null
    const keys: string[] = new Array(slots.count)
    for (let j = 0; j < slots.count; j++)
      keys[j] =
        letters && letters.slots === slots && letters.assign[j] !== SHARED ? letters.keys[letters.assign[j]] : shared
    const ordinal = this.count++
    this.emit(
      {
        generation: this.generation,
        seq: this.generation * SEQ_SPAN + ordinal + 1,
        mediaMs,
        commit: commit
          ? commit.keyframes
            ? { params: commit.params, letters: commit.letters, look: commit.look, keyframes: commit.keyframes }
            : { params: commit.params, letters: commit.letters, look: commit.look }
          : null,
        jobs: commit?.params || commit?.keyframes ? jobs : [],
        keys,
        indices: slots.index,
        adopted: scheduler.plannedState(),
      },
      ordinal,
      shared,
    )
  }
}

export class PlaybackPlanner {
  /** Bumps with every new set of inputs and every reset; the commits belong to it. */
  generation = 0
  private inputs: LiveInputs | null = null
  private store: PlanStore | null = null
  private pass: PlanPass | null = null
  /** A second pass from the start that makes thinned records full again near the playhead. */
  private refill: PlanPass | null = null
  /** The span the refill pass makes full again, from a record to a media time (moves with the playhead). */
  private refillFrom = 0
  private refillTo = 0
  private focusMs = 0
  /** Where the playhead was at the last thin, and the bytes after it. */
  private lastThin: { focusMs: number; bytes: number } | null = null
  /** Bumps whenever records are thinned or filled again (range's memo). */
  private epoch = 0
  private memo: { generation: number; epoch: number; lo: number; hi: number; value: readonly PlannedCommit[] } | null =
    null
  private spent = 0
  /** Re-planned commits that did not match what was planned (expected 0). */
  mismatches = 0

  constructor(
    private readonly source: FeatureSource,
    private readonly wallNow: () => number = () => performance.now(),
  ) {}

  /** Media ms of the last frame fed (−1 before any). */
  plannedUntil(): number {
    const pass = this.pass
    return pass && pass.nextIndex > 0 ? ((pass.nextIndex - 1) * 1000) / this.source.hz : -1
  }

  /** Whether every frame of the file is planned. */
  isDone(): boolean {
    return this.pass?.ended ?? false
  }

  /** New inputs (sliders, mappings, text), or the same after the features were measured again: a new generation, from 0. */
  setInputs(inputs: LiveInputs) {
    this.inputs = inputs
    this.restart()
  }

  /** Another file (or none): nothing planned until the next inputs. */
  reset() {
    this.inputs = null
    this.restart()
  }

  /** Where the playhead is: the full records are kept around it (and made full again there). */
  focus(ms: number) {
    this.focusMs = ms
  }

  /**
   * Plans up to media ms `untilMs`, for at most `budgetMs` of page time (frames not measured yet stop it). True when
   * the plan reaches `untilMs` or the end of the file. Thinned records near the playhead are made full first.
   */
  ensure(untilMs: number, budgetMs: number = PRECOMPUTE_LIMITS.planSliceMs): boolean {
    const pass = this.pass
    if (!pass) return false
    const started = this.wallNow()
    const deadline = started + budgetMs
    try {
      this.refillNear(deadline)
      let reached = pass.ended
      if (!reached && this.wallNow() < deadline) {
        const last = Math.floor((untilMs * this.source.hz) / 1000)
        reached =
          pass.feed(last, deadline, this.wallNow) &&
          (pass.ended || pass.nextIndex > Math.min(last, this.source.frameCount() - 1))
      }
      // Refills only add bytes: the budget is checked after every slice, the main pass ended or not.
      this.keepWithinBudget()
      this.store?.compactStep(deadline, this.wallNow)
      return reached
    } finally {
      this.spent += this.wallNow() - started
    }
  }

  /**
   * The full commits with media time in [fromMs, toMs], after the one on screen at fromMs, in media order; the same
   * array while nothing changed. It stops before the first thinned record (empty when the one on screen is thinned).
   */
  range(fromMs: number, toMs: number): readonly PlannedCommit[] {
    const records = this.store?.records ?? []
    const lo = Math.max(0, lastAtOrBefore(records, fromMs))
    let hi = lastAtOrBefore(records, toMs)
    if (hi < lo) hi = lo - 1
    const memo = this.memo
    if (memo && memo.generation === this.generation && memo.epoch === this.epoch && memo.lo === lo && memo.hi === hi)
      return memo.value
    const value: PlannedCommit[] = []
    for (let i = lo; i <= hi && i < records.length; i++) {
      const full = records[i].full
      if (!full) break
      value.push(full)
    }
    this.memo = { generation: this.generation, epoch: this.epoch, lo, hi, value }
    return value
  }

  /** The flash edges (planner frame times) of the commits with media time in (afterMs, untilMs], in order. */
  edgesIn(afterMs: number, untilMs: number): number[] {
    const records = this.store?.records ?? []
    const out: number[] = []
    for (let i = lastAtOrBefore(records, afterMs) + 1; i < records.length && records[i].mediaMs <= untilMs; i++)
      out.push(...records[i].edges)
    return out
  }

  /** Glyph computations per media second the commits in [fromMs, toMs] ask for (0 with fewer than two of them). */
  glyphRate(fromMs: number, toMs: number): number {
    const records = this.store?.records ?? []
    const first = Math.max(0, lastAtOrBefore(records, fromMs))
    let glyphs = 0
    let last = -1
    for (let i = first; i < records.length && records[i].mediaMs <= toMs; i++) {
      glyphs += records[i].glyphs
      last = i
    }
    if (last <= first) return 0
    const span = (records[last].mediaMs - records[first].mediaMs) / 1000
    return span > 0 ? glyphs / span : glyphs
  }

  /** Bytes the plan holds (estimate). */
  bytes(): number {
    return this.store?.bytes() ?? 0
  }

  /** Page time spent planning so far (ms). */
  cpuMs(): number {
    return this.spent
  }

  /** The records (tests, the probe). */
  records(): readonly PlanRecord[] {
    return this.store?.records ?? []
  }

  dispose() {
    this.pass?.dispose()
    this.refill?.dispose()
    this.pass = null
    this.refill = null
    this.store = null
  }

  private restart() {
    this.generation++
    this.pass?.dispose()
    this.refill?.dispose()
    this.pass = null
    this.refill = null
    this.memo = null
    this.lastThin = null
    this.epoch++
    const inputs = this.inputs
    this.store = inputs ? new PlanStore(inputs.base) : null
    if (!inputs) return
    const store = this.store!
    this.pass = new PlanPass(this.source, inputs, this.generation, (commit, _ordinal, sharedKey) => {
      store.append(commit, sharedKey)
    })
  }

  /**
   * Past the plan's budget, the records far from the playhead are thinned. When the span kept full does not fit, a thin
   * frees little: the next waits until the playhead moved THIN_AGAIN_MS or the plan grew by a twentieth.
   */
  private keepWithinBudget() {
    const store = this.store
    // While the shared tables are rebuilt after a thin, bytes() still counts the old ones: no thin until it is done.
    if (!store || store.compacting() || store.bytes() <= PRECOMPUTE_LIMITS.planMaxBytes) return
    const last = this.lastThin
    if (last && Math.abs(this.focusMs - last.focusMs) < THIN_AGAIN_MS && store.bytes() < 1.05 * last.bytes) return
    const near = PRECOMPUTE_LIMITS.planThinMs
    if (store.thin(this.focusMs - near, this.focusMs + near, PRECOMPUTE_LIMITS.planMaxBytes, true) > 0) this.epoch++
    this.lastThin = { focusMs: this.focusMs, bytes: store.bytes() }
  }

  /** The span the director reads around the playhead: thinned records there are planned again. */
  private refillNear(deadline: number) {
    const store = this.store
    const inputs = this.inputs
    if (!store || !inputs) return
    const records = store.records
    const from = this.focusMs - PRECOMPUTE_LIMITS.windowBehindMs - 1000
    const to = this.focusMs + PRECOMPUTE_LIMITS.windowAheadMs + PRECOMPUTE_LIMITS.planAheadMs
    // The pass reads the span as it is now: while the playhead plays on, it goes on filling ahead of it. The span starts
    // at the record on screen at `from` (it may be earlier).
    const first = Math.max(0, lastAtOrBefore(records, from))
    this.refillFrom = first
    this.refillTo = to
    let wanted = -1
    for (let i = first; i < records.length && records[i].mediaMs <= to; i++) {
      if (!records[i].full) {
        wanted = i
        break
      }
    }
    if (wanted < 0) return
    let pass = this.refill
    // A pass already beyond the stretch cannot go back: a new one from the start.
    if (pass && pass.nextIndex > Math.ceil((records[wanted].mediaMs * this.source.hz) / 1000)) {
      pass.dispose()
      pass = null
    }
    if (!pass) {
      const generation = this.generation
      pass = new PlanPass(this.source, inputs, generation, (commit, ordinal, sharedKey) => {
        const record = store.records[ordinal]
        if (!record || record.full || ordinal < this.refillFrom || commit.mediaMs > this.refillTo + 1000) return
        if (store.refill(ordinal, commit, sharedKey)) this.epoch++
        else this.mismatches++
      })
      this.refill = pass
    }
    const last = Math.floor((to * this.source.hz) / 1000)
    pass.feed(Math.min(last, (this.pass?.nextIndex ?? 0) - 1), deadline, this.wallNow)
  }
}

/** Index of the last record at or before media ms `ms` (−1: none). */
function lastAtOrBefore(records: readonly { mediaMs: number }[], ms: number): number {
  let lo = 0
  let hi = records.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (records[mid].mediaMs <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}
