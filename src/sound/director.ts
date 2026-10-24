// The playback director: while a file plays with precompute on (state/flags.ts), it shows the commits planned for
// the file (planner.ts) at their media time, instead of the live path's. Every animation frame it reads the playhead
// (engine.ts: as heard), plans a little further, chooses which planned commits the screen shows (lineage.ts:
// decimation when the geometry cannot keep up), asks the geometry pool for a window of them around the playhead (the
// AheadGeometry registered in state/aheadTypes.ts; without one, the canvas lane fetches each commit's glyphs as it
// comes), and hands the newest ready commit at or before the playhead to React, with its timing for Glide.
//
// The live path fills every gap: the director takes over only when the commits of the next PRECOMPUTE_LIMITS
// .enterReadyMs are ready, holds a late commit at most holdMs, and otherwise hands back to the page's scheduler, which
// goes on from the analyser's frames (live.ts follow). The microphone never uses the director.
//
// Whole file and sliding window (NOCUR-85): the plan covers the whole file from its start, so a seek or a rewind
// plans nothing again; the geometry window (windowBehindMs behind, windowAheadMs ahead) moves with the playhead, and
// what was prepared near an old spot stays until the store needs the room. While the file is paused, the window
// around the playhead is prepared too (warm), so the first play starts on planned commits. Background work has the
// lowest priority: it waits while an edit settles (settleMs, or while the pointer is down after one), stops while the
// page is hidden, and pauses while the director backs off. What is prepared is published for the buffered bar
// (bufferStore.ts).

import type { FrameJob } from '../geometry/types'
import { probeOn, reportPrecompute, type PrecomputeProbe } from '../render/probe'
import { getAheadGeometry, type AheadCommit, type AheadGeometry } from '../state/aheadTypes'
import { geometryClient, shownGlyphs } from '../state/geometryClient'
import { bufferStore, type BufferSnapshot } from './bufferStore'
import { getSoundEngine, subscribeStateKeys } from './engine'
import { FeatureTimeline } from './featureTimeline'
import { DECIMATION_LEVELS, LineageBook, selectCommits, stepsOf } from './lineage'
import { edgesFit, FLASH_LIMITS } from './flash'
import { LIVE_LIMITS, PLANNER_CLOCK_OFFSET, type LiveCommit, type LiveInputs } from './live'
import { mappingStore } from './mappingStore'
import { PlaybackPlanner } from './planner'
import { PRECOMPUTE_LIMITS, type AdoptedState, type CommitTiming, type PlannedCommit, type Playhead } from './timelineTypes'
import type { FeatureSettings, ResponseSettings } from './types'

/** What the director needs of the page's scheduler (LiveScheduler). */
export interface DirectorScheduler {
  follow(on: boolean): void
  isFollowing(): boolean
  adopt(adopted: AdoptedState, toWall: (plannerTime: number) => number, edges?: readonly number[]): number
  inputs(): LiveInputs
  /** The flash edges the page's budget holds at page time `time` or later, oldest first. */
  recentEdges(time: number): readonly number[]
  /** No new flash edge on the live path before page time `until`. */
  reserveFlashes(until: number): void
}

/** What the director needs of the planner (PlaybackPlanner). */
export interface DirectorPlanner {
  readonly generation: number
  /** New inputs: a new generation, planned from the file's start. */
  setInputs(inputs: LiveInputs): void
  /** Another file (or none). */
  reset(): void
  /** Where the playhead is (the plan keeps its full commits around it). */
  focus(ms: number): void
  ensure(untilMs: number, budgetMs?: number): boolean
  plannedUntil(): number
  isDone(): boolean
  /** The commits in [fromMs, toMs] after the one on screen at fromMs, in media order (the same array while unchanged). */
  range(fromMs: number, toMs: number): readonly PlannedCommit[]
  /** Flash edges (planner frame times) of the commits in (afterMs, untilMs]. */
  edgesIn(afterMs: number, untilMs: number): number[]
  /** Glyph computations per media second the commits in [fromMs, toMs] ask for. */
  glyphRate(fromMs: number, toMs: number): number
  bytes(): number
  cpuMs(): number
}

/** What the director needs of the feature timeline (FeatureTimeline). */
export interface DirectorTimeline {
  isLoaded(): boolean
  /** New Sensitivity or Release: every frame is measured again from the start. */
  setSettings(settings: FeatureSettings): void
  measuredUntil(): number
}

export interface DirectorDeps {
  /** Page time (ms). */
  now(): number
  /** Where the file plays, as heard; null without one. */
  playhead(): Playhead | null
  timeline: DirectorTimeline
  planner: DirectorPlanner
  scheduler: DirectorScheduler
  /** Hands a commit to React (the page's commitTo). */
  commit(commit: LiveCommit | null): void
  /** The registered ahead lane, or null (then `prefetch` fetches each commit's glyphs on the canvas lane). */
  ahead(): AheadGeometry | null
  /** Asks the canvas lane for these glyphs: false when they are all there already (geometryClient.prefetchJobs). */
  prefetch(jobs: readonly FrameJob[]): boolean
  /** Every glyph of these jobs has its result (geometryClient.lookup, not stale). */
  has(jobs: readonly FrameJob[]): boolean
  /** The canvas lane has a request in flight (geometryClient.isComputing). */
  busy(): boolean
  /** The font and the glyphs the canvas shows (the selected one first); null without a font. */
  shown(): { fontId: string; indices: readonly number[] } | null
  /** Glide's time (0: no glide, no lineages). */
  glideMs(): number
  /** Sensitivity and Release (the feature timeline is measured again when they change). */
  settings(): FeatureSettings
  /** Page time the pointer went down, while it is down; null when it is up (an edit settles while it is down). */
  pointerDownAt?(): number | null
  /** The page is hidden: no background work. */
  hidden?(): boolean
  /** The file's length (ms). */
  durationMs?(): number
  /** Publishes what is prepared (bufferStore.offer). */
  buffer?(snapshot: Omit<BufferSnapshot, 'version'>, now: number, force: boolean): void
}

/** The decimation level is reconsidered at most this often (ms). */
const LEVEL_EVERY_MS = 1000
/** The ahead lane is planned for at most this share of the glyphs a second it sustains. */
const AHEAD_SHARE = 0.8
/** Frames slower than this get no background planning while following (ms). */
const FAST_FRAME_MS = 20

/** The same inputs for planning: Glide's time only changes how frames are shown, so it does not count. */
function sameInputs(a: LiveInputs | null, b: LiveInputs): boolean {
  if (!a) return false
  const r = a.response
  const s = b.response
  const sameResponse = (Object.keys(r) as (keyof ResponseSettings)[]).every((key) => key === 'glideMs' || r[key] === s[key])
  return a.base === b.base && a.hasFont === b.hasFont && a.mappings === b.mappings && a.drive === b.drive && a.slots === b.slots && sameResponse
}

export class PlaybackDirector {
  /** The commit on screen (its seq and media time), while following. */
  private shownSeq = -1
  private shownMs = -Infinity
  /** The plan generation of the commit on screen (−1: none since following began, or a seek since). */
  private shownGeneration = -1
  /**
   * Since when (page time) the screen has waited: the commit due is not ready (or the plan does not reach the
   * playhead) and nothing newer was shown since.
   */
  private holdSince: number | null = null
  private lastGeneration = -1
  private inputs: LiveInputs | null = null
  private settings: FeatureSettings | null = null
  /** Inputs changed and are not planned yet (they wait while the edit settles). */
  private pending = false
  /** Page time of the last edit (an input or a feature setting changed). */
  private lastEditAt = -Infinity
  private level = 1
  private levelAt = -Infinity
  private readonly book = new LineageBook()
  private windowKey = ''
  /** The window's commits as sent, by seq (valid for one generation, level, font, Glide time and glyph set). */
  private aheadCommits = new Map<number, AheadCommit>()
  private aheadCommitsKey = ''
  private shownIndices: readonly number[] | null = null
  /** The first commit of the window last wanted (the part behind is kept from there). */
  private windowFirst = -1
  /** The window's first commit when the part behind it was last released. */
  private releasedFirst = -1
  private selection: { range: readonly PlannedCommit[]; level: number; value: PlannedCommit[] } | null = null
  /** Commits whose glyphs the canvas lane has (no ahead lane). */
  private fetched = new Set<number>()
  private counters = { shown: 0, live: 0, misses: 0, held: 0, backoffs: 0 }
  /** Since when (page time) the director has tried to take over without success; null while following or paused. */
  private tryingSince: number | null = null
  /** Until when (page time) the live path keeps the flash budget free for a handover (reserveFlashes). */
  private flashReservedUntil = -Infinity
  /** Until when (page time) background work is paused, and how long the next pause lasts. */
  private backoffUntil = -Infinity
  private backoffMs: number = PRECOMPUTE_LIMITS.backoffMs[0]
  private lastTickAt = -Infinity
  private playing = false
  /** Live frames since Play, until the first planned commit is shown (null: shown already). */
  private firstPlay: number | null = null
  private paused: PrecomputeProbe['paused'] = null
  /** The next buffered snapshot is published even when it is soon after the last (a new plan, file or level). */
  private forceBuffer = true
  /** Page time of the last snapshot offered, and whether the last one was the empty one of an edit waiting. */
  private offeredAt = -Infinity
  private bufferMasked = false

  constructor(private readonly deps: DirectorDeps) {}

  /** Whether the screen shows planned commits now. */
  isFollowing(): boolean {
    return this.deps.scheduler.isFollowing()
  }

  /** One animation frame while the file plays. */
  tick() {
    const { deps } = this
    const ph = deps.playhead()
    if (!ph || !ph.playing || !deps.timeline.isLoaded()) {
      this.handBack()
      return
    }
    const now = deps.now()
    const frameMs = now - this.lastTickAt
    this.lastTickAt = now
    if (!this.playing) {
      this.playing = true
      this.firstPlay = 0
    }
    if (deps.hidden?.()) {
      this.pauseBackground('hidden')
      return
    }
    if (this.backingOff(ph, now)) return
    if (!this.syncInputs(now)) {
      this.counters.live++
      this.countLive()
      this.pauseBackground('settling')
      this.report(ph)
      this.publish(now)
      return
    }
    if (ph.generation !== this.lastGeneration) this.seeked(ph)
    const planner = deps.planner
    planner.focus(ph.mediaMs)
    // One planning slice a frame for the stretch just ahead; two while the plan is behind what the director needs. All
    // the planning of a frame stays within planTickMs.
    const planStarted = deps.now()
    const planLeft = () => PRECOMPUTE_LIMITS.planTickMs - (deps.now() - planStarted)
    const horizon = ph.mediaMs + PRECOMPUTE_LIMITS.planAheadMs
    if (!planner.ensure(horizon, Math.min(PRECOMPUTE_LIMITS.planSliceMs, planLeft())) && planner.plannedUntil() < ph.mediaMs + PRECOMPUTE_LIMITS.enterReadyMs && planLeft() > 0) {
      planner.ensure(horizon, Math.min(PRECOMPUTE_LIMITS.planSliceMs, planLeft()))
    }
    const planSpent = deps.now() - planStarted

    const ahead = deps.ahead()
    this.chooseLevel(ahead, now, ph)
    const selected = this.select(ph)
    const due = lastAtOrBefore(selected, ph.mediaMs)
    if (ahead) this.wantAhead(ahead, selected, due, ph)
    const ready = (i: number) => this.ready(ahead, selected[i])

    if (this.isFollowing()) {
      // The newest ready commit at or before the playhead that is newer than the one on screen; after a seek, only the
      // commit due (one from before the jump would show a moment far from the playhead).
      let pick = -1
      const floor = this.shownMs > -Infinity ? this.shownMs : due > 0 ? selected[due - 1].mediaMs : -Infinity
      for (let i = due; i >= 0 && selected[i].mediaMs > floor; i--) {
        if (ready(i)) {
          pick = i
          break
        }
      }
      // A new generation (or a seek) did not count the edges the screen showed: it waits until they fit.
      if (pick >= 0 && selected[pick].generation !== this.shownGeneration && !this.flashFits(selected, pick, ph, now)) pick = -1
      if (pick >= 0) {
        this.show(selected, pick, ph)
        // The screen moved on: a commit still late waits from now (geometry slower than 30 Hz still shows each).
        this.holdSince = null
      }
      const late = due < 0 || (selected[due].seq !== this.shownSeq && pick !== due)
      if (late) {
        this.holdSince ??= now
        if (now - this.holdSince > PRECOMPUTE_LIMITS.holdMs) {
          this.counters.misses++
          this.handBack()
        } else {
          this.counters.held++
        }
      } else {
        this.holdSince = null
      }
      // Without an ahead lane, the next commit's glyphs are fetched once the one due is there.
      if (!ahead && !late && due + 1 < selected.length) ready(due + 1)
    } else {
      this.counters.live++
      this.countLive()
      const enter = due >= 0 && this.canEnter(ahead, selected, due, ph)
      const fits = enter && this.flashFits(selected, due, ph, now)
      // Ready but for the flash limit: the live path, which keeps the budget spent on music with many beats, makes no
      // new edge for a window, so the recent ones age out and the plan's fit (the live path only holds big changes, as
      // it does when the budget is spent anyway).
      if (enter && !fits && now >= this.flashReservedUntil) {
        this.flashReservedUntil = now + FLASH_LIMITS.windowMs
        deps.scheduler.reserveFlashes(this.flashReservedUntil)
      }
      if (fits) {
        this.tryingSince = null
        this.backoffMs = PRECOMPUTE_LIMITS.backoffMs[0]
        deps.scheduler.follow(true)
        this.holdSince = null
        this.shownSeq = -1
        this.shownMs = -Infinity
        this.show(selected, due, ph)
        if (this.firstPlay !== null) {
          reportPrecompute({ firstPlayLiveFrames: this.firstPlay })
          this.firstPlay = null
        }
      }
    }

    this.releaseBehind(ahead, selected, due)
    // The rest of the file in the background: a little while frames are fast, more while the plan is behind the
    // playhead (the live path is on screen then anyway), less again when frames are slow; within the frame's planning.
    if (!planner.isDone()) {
      const behind = planner.plannedUntil() < ph.mediaMs
      const fast = frameMs < FAST_FRAME_MS
      const slice = Math.min(behind ? (fast ? PRECOMPUTE_LIMITS.boostSliceMs : PRECOMPUTE_LIMITS.bgSliceMs) : fast ? PRECOMPUTE_LIMITS.bgSliceMs : 0, PRECOMPUTE_LIMITS.planTickMs - planSpent)
      if (slice > 0) planner.ensure(Infinity, slice)
    }
    this.paused = null
    this.report(ph)
    this.publish(now)
  }

  /**
   * While the file is paused (idle time): plans, and prepares the geometry window around the playhead, within about
   * `budgetMs` of page time. True while there is more to do soon.
   */
  warm(budgetMs: number = PRECOMPUTE_LIMITS.idleSliceMs): boolean {
    const { deps } = this
    const ph = deps.playhead()
    if (!ph || ph.playing || !deps.timeline.isLoaded()) return false
    this.playing = false
    const now = deps.now()
    if (deps.hidden?.()) {
      this.pauseBackground('hidden')
      return false
    }
    if (!this.syncInputs(now)) {
      this.pauseBackground('settling')
      this.publish(now)
      return true
    }
    if (ph.generation !== this.lastGeneration) this.seeked(ph)
    const planner = deps.planner
    planner.focus(ph.mediaMs)
    const started = deps.now()
    planner.ensure(ph.mediaMs + PRECOMPUTE_LIMITS.planAheadMs, budgetMs)
    const left = budgetMs - (deps.now() - started)
    if (left > 0 && !planner.isDone()) planner.ensure(Infinity, left)
    const ahead = deps.ahead()
    this.chooseLevel(ahead, now, ph)
    const selected = this.select(ph)
    const due = lastAtOrBefore(selected, ph.mediaMs)
    if (ahead) this.wantAhead(ahead, selected, due, ph)
    this.releaseBehind(ahead, selected, due)
    this.paused = null
    this.report(ph)
    this.publish(now)
    return !planner.isDone()
  }

  /** Playback stopped (paused, ended, another source, unmounted): the live path takes over. */
  stop() {
    this.handBack()
    this.tryingSince = null
    this.playing = false
    reportPrecompute({ covered: this.deps.timeline.isLoaded() })
  }

  /** The page was hidden: the workers stop on the window (what they made stays). */
  hide() {
    this.pauseBackground('hidden')
  }

  /** Another file (or none): the live path takes over, and the plan, the window and the bar start over. */
  reset() {
    this.handBack()
    this.tryingSince = null
    this.backoffUntil = -Infinity
    this.backoffMs = PRECOMPUTE_LIMITS.backoffMs[0]
    this.lastGeneration = -1
    this.inputs = null
    this.settings = null
    this.pending = false
    this.lastEditAt = -Infinity
    this.bufferMasked = false
    this.deps.planner.reset()
    this.deps.ahead()?.clear()
    this.newGeneration()
    this.deps.buffer?.({ durationMs: 0, plannedMs: 0, ready: new Float32Array(0) }, this.deps.now(), true)
  }

  /**
   * The planner and timeline follow the scheduler's inputs and the feature settings. A change hands back at once (the
   * plan no longer matches what the sliders say) and is planned once the edit has settled. False while settling.
   */
  private syncInputs(now: number): boolean {
    const { deps } = this
    const settings = deps.settings()
    if (this.settings && (settings.sensitivity !== this.settings.sensitivity || settings.releaseMs !== this.settings.releaseMs)) {
      deps.timeline.setSettings(settings)
      this.edited(now)
    } else if (!this.settings) {
      // A new file was measured with the settings of when it was loaded: a change while it decoded is caught here (the
      // timeline does nothing when they are the same).
      deps.timeline.setSettings(settings)
    }
    this.settings = settings
    const inputs = deps.scheduler.inputs()
    if (!sameInputs(this.inputs, inputs)) {
      const first = this.inputs === null
      this.inputs = inputs
      this.pending = true
      // The first inputs of a file are no edit: planned at once.
      if (!first) this.edited(now)
    }
    if (this.settling(now)) return false
    if (this.pending) {
      this.pending = false
      deps.planner.setInputs(this.inputs!)
      this.newGeneration()
    }
    return true
  }

  private edited(now: number) {
    this.pending = true
    this.lastEditAt = now
    this.handBack()
  }

  /** An edit is settling: made within settleMs, or the pointer is down since before it (a drag goes on). */
  private settling(now: number): boolean {
    if (now - this.lastEditAt < PRECOMPUTE_LIMITS.settleMs) return true
    const down = this.deps.pointerDownAt?.() ?? null
    return down !== null && this.lastEditAt >= down
  }

  /** A seek or loop: the plan covers the whole file, so nothing is planned again; the screen picks up there. */
  private seeked(ph: Playhead) {
    this.lastGeneration = ph.generation
    this.shownSeq = -1
    this.shownMs = -Infinity
    // The edges the screen showed before the jump are checked against the plan there before it shows.
    this.shownGeneration = -1
    this.holdSince = null
  }

  /**
   * The back-off: after tryMs of playback in which the director could not take over although the plan covered the
   * playhead, it pauses the background work (planning past the playhead, the geometry window) for backoffMs,
   * doubling after each failed try; the live path plays on meanwhile, and what was prepared stays. True while paused.
   */
  private backingOff(ph: Playhead, now: number): boolean {
    if (now < this.backoffUntil) {
      this.counters.live++
      this.countLive()
      this.pauseBackground('backoff')
      reportPrecompute({ covered: true, ...this.counters, paused: 'backoff' })
      return true
    }
    if (this.backoffUntil > -Infinity) {
      // The pause is over: the window is wanted again (the plan is whole: nothing to plan again).
      this.backoffUntil = -Infinity
      this.windowKey = ''
      this.tryingSince = now
      return false
    }
    if (this.isFollowing()) {
      this.tryingSince = null
      return false
    }
    // While the plan does not reach the playhead yet, the geometry is not what holds the director back.
    const planner = this.deps.planner
    if (!planner.isDone() && planner.plannedUntil() < ph.mediaMs + PRECOMPUTE_LIMITS.enterReadyMs) {
      this.tryingSince = null
      return false
    }
    this.tryingSince ??= now
    if (now - this.tryingSince < PRECOMPUTE_LIMITS.tryMs) return false
    this.handBack()
    this.pauseBackground('backoff')
    this.tryingSince = null
    this.backoffUntil = now + this.backoffMs
    this.backoffMs = Math.min(PRECOMPUTE_LIMITS.backoffMs[1], this.backoffMs * 2)
    this.counters.backoffs++
    this.counters.live++
    this.countLive()
    reportPrecompute({ covered: true, ...this.counters, paused: 'backoff' })
    return true
  }

  /** The workers stop on the window (it is wanted again afterwards); the reason goes to the probe. */
  private pauseBackground(reason: NonNullable<PrecomputeProbe['paused']>) {
    this.deps.ahead()?.pause()
    this.windowKey = ''
    if (this.paused !== reason) reportPrecompute({ paused: reason })
    this.paused = reason
  }

  /** The plan starts afresh: lineages, the window and the selection too; the bar drops back at once. */
  private newGeneration() {
    this.book.clear()
    this.windowKey = ''
    this.aheadCommits.clear()
    this.aheadCommitsKey = ''
    this.windowFirst = -1
    this.releasedFirst = -1
    this.selection = null
    this.fetched.clear()
    this.shownMs = -Infinity
    this.forceBuffer = true
  }

  /** The live path takes over (when following). */
  private handBack() {
    this.holdSince = null
    if (!this.deps.scheduler.isFollowing()) return
    this.shownSeq = -1
    this.shownMs = -Infinity
    this.shownGeneration = -1
    this.deps.scheduler.follow(false)
  }

  private countLive() {
    if (this.firstPlay !== null) this.firstPlay++
  }

  /** The commits selected at the current level around the playhead (from the window's start, a second earlier). */
  private select(ph: Playhead): PlannedCommit[] {
    // The second before the window keeps selection's edge (its first commit is always kept) outside it. The bounds move
    // in windowStepMs steps, so the range and the selection stay the same arrays from one frame to the next.
    const { fromMs, toMs } = windowBounds(ph.mediaMs)
    const range = this.deps.planner.range(fromMs - 1000, toMs)
    const memo = this.selection
    if (memo && memo.range === range && memo.level === this.level) return memo.value
    const value = selectCommits(range, this.level)
    this.selection = { range, level: this.level, value }
    return value
  }

  /** What is behind the window will not be shown: its plans and lineages go (the store keeps glyphs by its own rule). */
  private releaseBehind(ahead: AheadGeometry | null, selected: readonly PlannedCommit[], due: number) {
    if (ahead) {
      const first = this.windowFirst
      if (first < 0 || first === this.releasedFirst) return
      this.releasedFirst = first
      ahead.release(first)
      const prev = this.book.prevOf(first)
      this.book.release(prev !== undefined && prev >= 0 ? prev : first)
      return
    }
    // Without an ahead lane: what is on screen and what is due stay; anything older will not be shown again.
    const dueSeq = due >= 0 ? selected[due].seq : -1
    const keep = this.isFollowing() && this.shownSeq >= 0 && dueSeq >= 0 ? Math.min(this.shownSeq, dueSeq) : dueSeq
    if (keep < 0) return
    const prev = this.book.prevOf(keep)
    this.book.release(prev !== undefined && prev >= 0 ? prev : keep)
    for (const seq of this.fetched) if (seq < keep) this.fetched.delete(seq)
  }

  /** The commit's glyphs (and, with Glide, its plans) are ready to show. */
  private ready(ahead: AheadGeometry | null, commit: PlannedCommit): boolean {
    if (commit.jobs.length === 0) return true
    if (ahead) return ahead.ready(commit.seq)
    if (this.has(commit)) return true
    // One request at a time: a newer request would replace the one in flight, and neither would arrive.
    if (this.deps.busy()) return false
    if (this.deps.prefetch(commit.jobs)) return false
    this.fetched.add(commit.seq)
    return true
  }

  /** Without an ahead lane: the canvas lane already has the commit's glyphs (asks for nothing). */
  private has(commit: PlannedCommit): boolean {
    if (commit.jobs.length === 0 || this.fetched.has(commit.seq)) return true
    if (!this.deps.has(commit.jobs)) return false
    this.fetched.add(commit.seq)
    return true
  }

  /**
   * Takes over when the commit due is ready and the plan covers the next enterReadyMs; with an ahead lane, every
   * selected commit in it must be ready too (without one, commits are fetched one at a time on the canvas lane).
   */
  private canEnter(ahead: AheadGeometry | null, selected: readonly PlannedCommit[], due: number, ph: Playhead): boolean {
    const until = ph.mediaMs + PRECOMPUTE_LIMITS.enterReadyMs
    if (!this.deps.planner.isDone() && this.deps.planner.plannedUntil() < until) return false
    if (!ahead) {
      if (this.has(selected[due])) return true
      // Fetches a commit holdMs ahead, so that it is there when the playhead reaches it (the one due would be past).
      this.ready(null, selected[Math.max(due, lastAtOrBefore(selected, ph.mediaMs + PRECOMPUTE_LIMITS.holdMs))])
      return false
    }
    // The commit due glides in from what the screen shows (the resting letters or the live path), not from its
    // predecessor in the plan: its shapes are enough, and its chained steps are not waited for.
    if (!this.ready(ahead, selected[due]) && !ahead.shapesReady(selected[due].seq)) return false
    for (let i = due + 1; i < selected.length && selected[i].mediaMs <= until; i++) if (!ahead.ready(selected[i].seq)) return false
    return true
  }

  /**
   * The flash limit across a switch of what the screen follows (from the live path into the plan, to a new
   * generation of it, or across a seek): the edges the page's budget counted in the last window (what the screen
   * showed) and the planned edges that will show within the next, on one clock, must fit every window across the
   * switch (flash.ts). Without recent edges nothing needs checking; otherwise the plan must reach a window past the
   * playhead.
   */
  private flashFits(selected: readonly PlannedCommit[], i: number, ph: Playhead, now: number): boolean {
    const recent = this.deps.scheduler.recentEdges(now - FLASH_LIMITS.windowMs)
    if (recent.length === 0) return true
    const planner = this.deps.planner
    const until = ph.mediaMs + FLASH_LIMITS.windowMs
    if (!planner.isDone() && planner.plannedUntil() < until) return false
    const times = [...recent]
    const toWall = (plannerTime: number) => ph.wallMs - (ph.mediaMs - (plannerTime - PLANNER_CLOCK_OFFSET))
    // Edges of the commit due (already past) reach the screen with the switch, now. Commits sit on the 60 Hz grid.
    for (const edge of planner.edgesIn(selected[i].mediaMs - 0.5, until)) times.push(Math.max(toWall(edge), now))
    times.sort((a, b) => a - b)
    return edgesFit(times)
  }

  /**
   * Hands commit `i` of the selection to React, adopted first. Planned commits skipped since the one on screen (not
   * selected, or late) bring their flash edges along, so the page's budget counts every edge the screen shows.
   */
  private show(selected: readonly PlannedCommit[], i: number, ph: Playhead) {
    const commit = selected[i]
    const toWall = (plannerTime: number) => ph.wallMs - (ph.mediaMs - (plannerTime - PLANNER_CLOCK_OFFSET))
    let edges: number[] | undefined
    if (this.shownMs > -Infinity && commit.generation === this.shownGeneration) edges = this.deps.planner.edgesIn(this.shownMs, commit.mediaMs)
    const seq = this.deps.scheduler.adopt(commit.adopted, toWall, edges)
    this.shownSeq = commit.seq
    this.shownMs = commit.mediaMs
    this.shownGeneration = commit.generation
    this.counters.shown++
    if (!commit.commit) {
      this.deps.commit(null)
      return
    }
    const lineage = this.lineageOf(selected, i)
    const timing: CommitTiming = {
      wallMs: toWall(commit.mediaMs + PLANNER_CLOCK_OFFSET),
      mediaMs: commit.mediaMs,
      generation: commit.generation,
      seq: commit.seq,
      prevSeq: lineage ? lineage.prevSeq : i > 0 ? selected[i - 1].seq : -1,
      lineage: lineage ? lineage.lineage : null,
    }
    this.deps.commit({ ...commit.commit, seq, timing })
  }

  /** Commit `i`'s lineages (after its predecessor in the selection), or null without Glide. */
  private lineageOf(selected: readonly PlannedCommit[], i: number): { lineage: Int32Array; prevSeq: number } | null {
    if (this.deps.glideMs() <= 0) return null
    const commit = selected[i]
    // The first one kept keeps the predecessor it was given while that was still kept.
    const prevSeq = i > 0 ? selected[i - 1].seq : (this.book.prevOf(commit.seq) ?? -1)
    if (i > 0 && this.book.prevOf(selected[i - 1].seq) === undefined) {
      // Made from the first selected commit whose lineages are known (or the selection's start), in order.
      let from = i - 1
      while (from > 0 && this.book.prevOf(selected[from - 1].seq) === undefined) from--
      for (let k = from; k < i; k++) this.lineageOf(selected, k)
    }
    return { lineage: this.book.lineagesOf(commit, prevSeq), prevSeq }
  }

  /**
   * Tells the ahead lane which commits to prepare: the selected ones of the window around the playhead (the commit due
   * always among them), each with its glyphs and, with Glide, its lineages' steps. Commits already worked out are
   * reused (by seq) while the plan, level, font, Glide time and glyphs shown stay.
   */
  private wantAhead(ahead: AheadGeometry, selected: readonly PlannedCommit[], due: number, ph: Playhead) {
    const shown = this.deps.shown()
    if (!shown || selected.length === 0) return
    const glideMs = this.deps.glideMs()
    const generation = this.deps.planner.generation
    const cacheKey = `${generation}|${this.level}|${shown.fontId}|${glideMs}`
    if (cacheKey !== this.aheadCommitsKey || this.shownIndices !== shown.indices) {
      this.aheadCommitsKey = cacheKey
      this.shownIndices = shown.indices
      this.aheadCommits.clear()
    }
    const { fromMs, toMs } = windowBounds(ph.mediaMs)
    let lo = Math.max(0, lastAtOrBefore(selected, fromMs))
    if (due >= 0) lo = Math.min(lo, due)
    const hi = lastAtOrBefore(selected, toMs)
    if (hi < lo) return
    const dueSeq = due >= 0 ? selected[due].seq : selected[lo].seq
    const key = `${cacheKey}|${selected[lo].seq}|${selected[hi].seq}|${selected.length}`
    this.windowFirst = selected[lo].seq
    // The same commits: only the playhead and the commit due move.
    if (key === this.windowKey) {
      ahead.setPlayhead(ph.mediaMs, dueSeq)
      return
    }
    this.windowKey = key
    const commits: AheadCommit[] = []
    for (let i = lo; i <= hi; i++) {
      const commit = selected[i]
      const prevSeq = i > 0 ? selected[i - 1].seq : -1
      const endMs = i + 1 < selected.length ? selected[i + 1].mediaMs : commit.mediaMs + 1000 / LIVE_LIMITS.maxFps
      const lineage = glideMs > 0 ? this.lineageOf(selected, i) : null
      let made = this.aheadCommits.get(commit.seq)
      if (!made || made.prevSeq !== (lineage ? lineage.prevSeq : prevSeq)) {
        made = {
          seq: commit.seq,
          prevSeq: lineage ? lineage.prevSeq : prevSeq,
          mediaMs: commit.mediaMs,
          endMs,
          jobs: commit.jobs.map(({ params, key, indices, within }) => ({ params, key, indices: indices ?? shownGlyphs(shown.indices, within) })),
          steps: lineage ? stepsOf(commit, lineage.lineage, this.book.parentsAt(commit.seq)) : [],
        }
        this.aheadCommits.set(commit.seq, made)
      } else if (made.endMs !== endMs) {
        made = { ...made, endMs }
        this.aheadCommits.set(commit.seq, made)
      }
      commits.push(made)
    }
    for (const seq of this.aheadCommits.keys()) if (seq < this.windowFirst) this.aheadCommits.delete(seq)
    ahead.want({ generation, level: this.level, fontId: shown.fontId, glideMs, playheadMs: ph.mediaMs, dueSeq, commits })
  }

  /**
   * Decimation: the finest level whose glyphs a second (just ahead of the playhead) the ahead lane sustains
   * (AHEAD_SHARE of it), reconsidered at most every LEVEL_EVERY_MS. Without an ahead lane (or before it has a rate),
   * every commit.
   */
  private chooseLevel(ahead: AheadGeometry | null, now: number, ph: Playhead) {
    if (now - this.levelAt < LEVEL_EVERY_MS) return
    this.levelAt = now
    const rate = ahead?.stats().glyphsPerSecond ?? 0
    if (!ahead || !(rate > 0)) {
      this.setLevel(1)
      return
    }
    const perSecond = this.deps.planner.glyphRate(ph.mediaMs, ph.mediaMs + PRECOMPUTE_LIMITS.nearMs)
    if (perSecond <= 0) return
    this.setLevel(DECIMATION_LEVELS.find((l) => perSecond / l <= AHEAD_SHARE * rate) ?? DECIMATION_LEVELS[DECIMATION_LEVELS.length - 1])
  }

  private setLevel(level: number) {
    if (level === this.level) return
    this.level = level
    this.windowKey = ''
    this.forceBuffer = true
  }

  /** The probe: what is planned and prepared. */
  private report(ph: Playhead) {
    reportPrecompute({ covered: true, generation: this.deps.planner.generation, ...this.counters })
    if (!probeOn) return
    const { planner, timeline } = this.deps
    const ranges = this.readyRanges()
    let readyAheadMs = 0
    let readyBehindMs = 0
    for (let k = 0; k + 1 < ranges.length; k += 2) {
      if (ranges[k] > ph.mediaMs || ranges[k + 1] < ph.mediaMs) continue
      readyAheadMs = ranges[k + 1] - ph.mediaMs
      readyBehindMs = ph.mediaMs - ranges[k]
    }
    reportPrecompute({
      plannedMs: Math.max(0, planner.plannedUntil()),
      measuredMs: timeline.measuredUntil(),
      planBytes: planner.bytes(),
      planCpuMs: planner.cpuMs(),
      readyAheadMs,
      readyBehindMs,
      paused: this.paused,
    })
  }

  /** The current plan's ready geometry ranges (empty while the lane's are another generation's). */
  private readyRanges(): Float64Array {
    const ready = this.deps.ahead()?.readyRanges()
    return ready && ready.generation === this.deps.planner.generation ? ready.ranges : new Float64Array(0)
  }

  /**
   * Offers the buffered snapshot at most every bufferEveryMs (a new plan, file or level goes out at once). While an edit
   * waits to be planned, the old plan's ranges no longer hold: the bar drops back at once.
   */
  private publish(now: number) {
    const buffer = this.deps.buffer
    if (!buffer) return
    const durationMs = this.deps.durationMs?.() ?? 0
    if (this.pending) {
      if (!this.bufferMasked) buffer({ durationMs, plannedMs: 0, ready: new Float32Array(0) }, now, true)
      this.bufferMasked = true
      this.forceBuffer = true
      return
    }
    this.bufferMasked = false
    if (!this.forceBuffer && now - this.offeredAt < PRECOMPUTE_LIMITS.bufferEveryMs) return
    this.offeredAt = now
    const planner = this.deps.planner
    const plannedMs = planner.isDone() ? durationMs : Math.max(0, Math.min(durationMs, planner.plannedUntil()))
    buffer({ durationMs, plannedMs, ready: Float32Array.from(this.readyRanges()) }, now, this.forceBuffer)
    this.forceBuffer = false
  }
}

/** The window around media ms `ms`, its bounds moved out to windowStepMs steps (it covers at least the window). */
function windowBounds(ms: number): { fromMs: number; toMs: number } {
  const step = PRECOMPUTE_LIMITS.windowStepMs
  return {
    fromMs: Math.floor((ms - PRECOMPUTE_LIMITS.windowBehindMs) / step) * step,
    toMs: Math.ceil((ms + PRECOMPUTE_LIMITS.windowAheadMs) / step) * step,
  }
}

/** Index of the last commit at or before media ms `ms` (−1: none). */
function lastAtOrBefore(commits: readonly PlannedCommit[], ms: number): number {
  let lo = 0
  let hi = commits.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (commits[mid].mediaMs <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** Calls `run` in idle time after `delayMs` (or a little later where there is no idle callback); returns a cancel. */
function idleLater(run: (budgetMs: number) => void, delayMs: number): () => void {
  let idle: number | null = null
  const timer = setTimeout(() => {
    if (typeof requestIdleCallback === 'function') {
      idle = requestIdleCallback(
        (deadline) => run(deadline.didTimeout ? PRECOMPUTE_LIMITS.planSliceMs : Math.min(PRECOMPUTE_LIMITS.idleSliceMs, Math.max(1, deadline.timeRemaining()))),
        { timeout: 100 },
      )
    } else {
      run(PRECOMPUTE_LIMITS.idleSliceMs)
    }
  }, delayMs)
  return () => {
    clearTimeout(timer)
    if (idle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle)
  }
}

/** While paused with nothing left to do, the idle loop looks again this often (ms). */
const IDLE_CHECK_MS = 250

/**
 * Connects a director to the page: the engine's file and playhead, the scheduler `scheduler`, React (`commit`), the
 * geometry client and the registered ahead lane. It runs on animation frames while a precomputed file plays, in idle
 * time while it is paused, and not at all while the page is hidden. Returns the disconnect function (the live path
 * takes over).
 */
export function connectDirector(scheduler: DirectorScheduler, commit: (commit: LiveCommit | null) => void): () => void {
  const engine = getSoundEngine()
  const timeline = new FeatureTimeline()
  const planner = new PlaybackPlanner(timeline)
  const hidden = () => typeof document !== 'undefined' && document.hidden
  let pointerDownAt: number | null = null
  const director = new PlaybackDirector({
    now: () => performance.now(),
    playhead: () => engine.playhead(),
    timeline,
    planner,
    scheduler,
    commit,
    ahead: getAheadGeometry,
    prefetch: (jobs) => geometryClient.prefetchJobs(jobs),
    has: (jobs) => {
      const shown = geometryClient.shownGlyphSet()
      if (!shown) return true
      return jobs.every(({ key, indices, within }) => (indices ?? shownGlyphs(shown.indices, within)).every((i) => geometryClient.lookup(key, i)?.stale === false))
    },
    busy: () => geometryClient.isComputing(),
    shown: () => geometryClient.shownGlyphSet(),
    glideMs: () => {
      const { response, reducedMotion } = mappingStore.getState()
      return reducedMotion ? 0 : response.glideMs
    },
    settings: () => engine.getState().settings,
    pointerDownAt: () => pointerDownAt,
    hidden,
    durationMs: () => (engine.getState().duration || 0) * 1000,
    buffer: (snapshot, now, force) => {
      bufferStore.offer(snapshot, now, force)
    },
  })
  let frame: number | null = null
  let cancelIdle: (() => void) | null = null
  // A tick that throws stops the director until the next file: the live path plays on, and the error shows once.
  let failed = false
  const fail = (error: unknown) => {
    console.error('Sound: precomputed playback stopped; the live path goes on', error)
    failed = true
    sync()
  }
  const loop = () => {
    frame = requestAnimationFrame(loop)
    try {
      director.tick()
    } catch (error) {
      fail(error)
    }
  }
  const idle = (budgetMs: number) => {
    cancelIdle = null
    let more = false
    try {
      more = director.warm(budgetMs)
    } catch (error) {
      fail(error)
      return
    }
    if (!failed && cancelIdle === null) cancelIdle = idleLater(idle, more ? 0 : IDLE_CHECK_MS)
  }
  const sync = () => {
    const s = engine.getState()
    const ready = !failed && s.source === 'file' && timeline.isLoaded() && !hidden()
    const play = ready && s.playing
    const warm = ready && !s.playing
    if (play) {
      if (frame === null && typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(loop)
        // The first frame of a play is taken at once, before the live path's first: its jump from the resting letters
        // would count as a flash edge and keep the director from taking over for a whole flash window.
        try {
          director.tick()
        } catch (error) {
          fail(error)
        }
      }
    } else if (frame !== null) {
      cancelAnimationFrame(frame)
      frame = null
    }
    if (warm) {
      if (cancelIdle === null) cancelIdle = idleLater(idle, 0)
    } else if (cancelIdle !== null) {
      cancelIdle()
      cancelIdle = null
    }
    if (play) return
    try {
      director.stop()
      if (hidden()) director.hide()
    } catch (error) {
      console.error('Sound: precomputed playback could not hand back', error)
    }
  }
  const onPointer = (event: PointerEvent) => {
    pointerDownAt = event.type === 'pointerdown' ? performance.now() : null
  }
  const hasWindow = typeof window !== 'undefined'
  if (hasWindow) {
    for (const type of ['pointerdown', 'pointerup', 'pointercancel'] as const) window.addEventListener(type, onPointer, true)
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)
  let loading = 0
  const off = [
    // Only what sync reads: not the position, which changes about 4 times a second while a file plays.
    subscribeStateKeys(engine, ['source', 'playing'], sync),
    engine.subscribeTimelineEvents((event) => {
      const token = ++loading
      failed = false
      director.reset()
      // A file longer than precompute keeps in memory is not even decoded: it plays on the live path.
      const { duration } = engine.getState()
      if (event.type === 'unload' || !(duration <= PRECOMPUTE_LIMITS.maxSeconds)) {
        timeline.clear()
        sync()
        return
      }
      // Measured from the start, in order: the plan is made from the start too.
      timeline.load(event.file, event.decode, engine.getState().settings, 0).then(
        () => {
          if (token === loading) sync()
        },
        (error) => console.error('Sound: the file could not be precomputed; it plays live', error),
      )
    }),
  ]
  return () => {
    for (const unsubscribe of off) unsubscribe()
    if (hasWindow) {
      for (const type of ['pointerdown', 'pointerup', 'pointercancel'] as const) window.removeEventListener(type, onPointer, true)
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync)
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    cancelIdle?.()
    cancelIdle = null
    director.stop()
    planner.dispose()
    timeline.dispose()
  }
}
