// The playback director: while a file plays with precompute on (state/flags.ts), it shows the commits planned ahead of
// the playhead (planner.ts) at their media time, instead of the live path's. Every animation frame it reads the
// playhead (engine.ts: as heard), plans a little further, chooses which planned commits the screen shows (lineage.ts:
// decimation when the geometry cannot keep up), asks the geometry pool for them ahead (the AheadGeometry registered
// in state/aheadTypes.ts; without one, the canvas lane fetches each commit's glyphs as it comes), and hands the newest
// ready commit at or before the playhead to React, with its timing for Glide.
//
// The live path fills every gap: the director takes over only when the commits of the next PRECOMPUTE_LIMITS
// .enterReadyMs are ready, holds a late commit at most holdMs, and otherwise hands back to the page's scheduler, which
// goes on from the analyser's frames (live.ts follow). The microphone never uses the director.

import type { FrameJob, GeometryJob } from '../geometry/types'
import { reportPrecompute } from '../render/probe'
import { getAheadGeometry, type AheadCommit, type AheadGeometry } from '../state/aheadTypes'
import { geometryClient, shownGlyphs } from '../state/geometryClient'
import { getSoundEngine } from './engine'
import { FeatureTimeline } from './featureTimeline'
import { DECIMATION_LEVELS, LineageBook, selectCommits, stepsOf } from './lineage'
import { edgesFit, FLASH_LIMITS } from './flash'
import { PLANNER_CLOCK_OFFSET, plannedEdges, type LiveCommit, type LiveInputs } from './live'
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
}

/** What the director needs of the planner (PlaybackPlanner). */
export interface DirectorPlanner {
  readonly generation: number
  readonly commits: readonly PlannedCommit[]
  setInputs(inputs: LiveInputs, atMs: number): void
  reseed(atMs: number): void
  ensure(untilMs: number, budgetMs?: number): boolean
  plannedUntil(): number
  isDone(): boolean
  prune(beforeMs: number): void
}

/** What the director needs of the feature timeline (FeatureTimeline). */
export interface DirectorTimeline {
  isLoaded(): boolean
  seek(ms: number): void
  setSettings(settings: FeatureSettings, playheadMs: number): void
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
  /** The jobs with their glyph ids filled (the glyphs the canvas shows), and the font; null without a font. */
  resolve(jobs: readonly FrameJob[]): { fontId: string; jobs: GeometryJob[] } | null
  /** Glide's time (0: no glide, no lineages). */
  glideMs(): number
  /** Sensitivity and Release (the feature timeline is measured again when they change). */
  settings(): FeatureSettings
}

/** The decimation level is reconsidered at most this often (ms). */
const LEVEL_EVERY_MS = 1000
/** The ahead lane is planned for at most this share of the glyphs a second it sustains. */
const AHEAD_SHARE = 0.8

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
  /** The plan generation of the commit on screen (−1: none since following began). */
  private shownGeneration = -1
  /**
   * Since when (page time) the screen has waited: the commit due is not ready (or the plan does not reach the
   * playhead) and nothing newer was shown since.
   */
  private holdSince: number | null = null
  private lastGeneration = -1
  private inputs: LiveInputs | null = null
  private settings: FeatureSettings | null = null
  private level = 1
  private levelAt = -Infinity
  private readonly book = new LineageBook()
  private windowKey = ''
  /** Commits whose glyphs the canvas lane has (no ahead lane). */
  private fetched = new Set<number>()
  private counters = { shown: 0, live: 0, misses: 0, held: 0 }

  constructor(private readonly deps: DirectorDeps) {}

  /** Whether the screen shows planned commits now. */
  isFollowing(): boolean {
    return this.deps.scheduler.isFollowing()
  }

  /** One animation frame. */
  tick() {
    const { deps } = this
    const ph = deps.playhead()
    if (!ph || !ph.playing || !deps.timeline.isLoaded()) {
      this.handBack()
      return
    }
    const now = deps.now()
    const planner = deps.planner
    const reseeded = this.syncInputs(ph)
    if (ph.generation !== this.lastGeneration) this.seeked(ph, reseeded)
    // One planning slice a frame; two while the plan is behind what the director needs to take over.
    const horizon = ph.mediaMs + PRECOMPUTE_LIMITS.planAheadMs
    if (!planner.ensure(horizon) && planner.plannedUntil() < ph.mediaMs + PRECOMPUTE_LIMITS.enterReadyMs) planner.ensure(horizon)

    const selected = selectCommits(planner.commits, this.level)
    const due = lastAtOrBefore(selected, ph.mediaMs)
    const ahead = deps.ahead()
    this.chooseLevel(ahead, now)
    if (ahead) this.wantAhead(ahead, selected, due, ph)
    const ready = (i: number) => this.ready(ahead, selected[i])

    if (this.isFollowing()) {
      // The newest ready commit at or before the playhead that is newer than the one on screen.
      let pick = -1
      for (let i = due; i >= 0 && selected[i].mediaMs > this.shownMs; i--) {
        if (ready(i)) {
          pick = i
          break
        }
      }
      // A new generation of the plan did not count the edges the screen showed: it waits until they fit.
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
      if (due >= 0 && this.canEnter(ahead, selected, due, ph) && this.flashFits(selected, due, ph, now)) {
        deps.scheduler.follow(true)
        this.holdSince = null
        this.shownSeq = -1
        this.shownMs = -Infinity
        this.show(selected, due, ph)
      }
    }

    // What is on screen and what is due stay; anything older will not be shown again.
    const dueSeq = due >= 0 ? selected[due].seq : -1
    const keep = this.isFollowing() && this.shownSeq >= 0 && dueSeq >= 0 ? Math.min(this.shownSeq, dueSeq) : dueSeq
    if (keep >= 0) {
      ahead?.release(keep)
      const prev = this.book.prevOf(keep)
      this.book.release(prev !== undefined && prev >= 0 ? prev : keep)
      for (const seq of this.fetched) if (seq < keep) this.fetched.delete(seq)
    }
    planner.prune(ph.mediaMs - PRECOMPUTE_LIMITS.keepBehindMs)
    reportPrecompute({ covered: true, generation: planner.generation, ...this.counters })
  }

  /** Playback stopped (paused, ended, another source, unmounted): the live path takes over. */
  stop() {
    this.handBack()
    reportPrecompute({ covered: this.deps.timeline.isLoaded() })
  }

  /** Another file (or none): the live path takes over, and the plan starts again from the start. */
  reset() {
    this.handBack()
    this.lastGeneration = -1
    this.deps.planner.reseed(0)
    this.newGeneration()
  }

  /** The planner and timeline follow the scheduler's inputs and the feature settings. True when the plan started afresh. */
  private syncInputs(ph: Playhead): boolean {
    const { deps } = this
    let reseeded = false
    const settings = deps.settings()
    if (this.settings && (settings.sensitivity !== this.settings.sensitivity || settings.releaseMs !== this.settings.releaseMs)) {
      deps.timeline.setSettings(settings, ph.mediaMs)
      deps.planner.reseed(ph.mediaMs)
      this.newGeneration()
      reseeded = true
    }
    this.settings = settings
    const inputs = deps.scheduler.inputs()
    if (sameInputs(this.inputs, inputs)) return reseeded
    this.inputs = inputs
    deps.planner.setInputs(inputs, ph.mediaMs)
    this.newGeneration()
    return true
  }

  /** A seek or loop: measured there first; planned again unless the plan already covers it (or was just made). */
  private seeked(ph: Playhead, reseeded: boolean) {
    this.lastGeneration = ph.generation
    const { planner, timeline } = this.deps
    timeline.seek(ph.mediaMs)
    if (reseeded) return
    const first = planner.commits[0]
    const covered = first !== undefined && first.mediaMs <= ph.mediaMs && (ph.mediaMs <= planner.plannedUntil() || planner.isDone())
    if (covered && this.shownMs <= ph.mediaMs) return
    planner.reseed(ph.mediaMs)
    this.newGeneration()
    this.handBack()
  }

  /** The plan starts afresh: lineages and the wanted window too. */
  private newGeneration() {
    this.book.clear()
    this.windowKey = ''
    this.fetched.clear()
    this.shownMs = -Infinity
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
    if (!this.ready(ahead, selected[due])) return false
    for (let i = due + 1; i < selected.length && selected[i].mediaMs <= until; i++) if (!ahead.ready(selected[i].seq)) return false
    return true
  }

  /**
   * The flash limit across a switch of what the screen follows (from the live path into the plan, or to a new
   * generation of it): the edges the page's budget counted in the last window (what the screen showed) and the planned
   * edges that will show within the next, on one clock, must fit every window across the switch (flash.ts). Without
   * recent edges nothing needs checking; otherwise the plan must reach a window past the playhead.
   */
  private flashFits(selected: readonly PlannedCommit[], i: number, ph: Playhead, now: number): boolean {
    const recent = this.deps.scheduler.recentEdges(now - FLASH_LIMITS.windowMs)
    if (recent.length === 0) return true
    const planner = this.deps.planner
    const until = ph.mediaMs + FLASH_LIMITS.windowMs
    if (!planner.isDone() && planner.plannedUntil() < until) return false
    const times = [...recent]
    const toWall = (plannerTime: number) => ph.wallMs - (ph.mediaMs - (plannerTime - PLANNER_CLOCK_OFFSET))
    for (const commit of planner.commits) {
      if (commit.mediaMs < selected[i].mediaMs || commit.mediaMs > until) continue
      // Edges of the commit due (already past) reach the screen with the switch, now.
      for (const edge of plannedEdges(commit.adopted)) times.push(Math.max(toWall(edge), now))
    }
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
    if (this.shownMs > -Infinity && commit.generation === this.shownGeneration) {
      edges = []
      for (const c of this.deps.planner.commits) if (c.mediaMs > this.shownMs && c.mediaMs <= commit.mediaMs) edges.push(...plannedEdges(c.adopted))
    }
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
    if (i > 0 && this.book.prevOf(selected[i - 1].seq) === undefined) this.lineageOf(selected, i - 1)
    return { lineage: this.book.lineagesOf(commit, prevSeq), prevSeq }
  }

  /** Tells the ahead lane which commits to prepare: from the one due to the adaptive geometry horizon. */
  private wantAhead(ahead: AheadGeometry, selected: readonly PlannedCommit[], due: number, ph: Playhead) {
    const { backlogMs } = ahead.stats()
    const [near, far] = PRECOMPUTE_LIMITS.geometryAheadMs
    const until = ph.mediaMs + Math.min(far, Math.max(near, far - backlogMs))
    const glideMs = this.deps.glideMs()
    const commits: AheadCommit[] = []
    let fontId: string | null = null
    for (let i = Math.max(0, due); i < selected.length && selected[i].mediaMs <= until; i++) {
      const commit = selected[i]
      const resolved = this.deps.resolve(commit.jobs)
      if (!resolved && commit.jobs.length > 0) return
      if (resolved) fontId = resolved.fontId
      const lineage = glideMs > 0 ? this.lineageOf(selected, i) : null
      commits.push({
        seq: commit.seq,
        prevSeq: lineage ? lineage.prevSeq : i > 0 ? selected[i - 1].seq : -1,
        mediaMs: commit.mediaMs,
        jobs: resolved?.jobs ?? [],
        steps: lineage ? stepsOf(commit, lineage.lineage, this.book.parentsAt(commit.seq)) : [],
      })
    }
    if (fontId === null) fontId = this.deps.resolve([])?.fontId ?? null
    if (fontId === null) return
    const key = `${this.deps.planner.generation}|${fontId}|${glideMs}|${commits.map((c) => `${c.seq}:${c.prevSeq}`).join(',')}`
    if (key === this.windowKey) return
    this.windowKey = key
    ahead.want({ generation: this.deps.planner.generation, fontId, glideMs, commits })
  }

  /**
   * Decimation: the finest level whose glyphs a second the ahead lane sustains (AHEAD_SHARE of it), reconsidered at
   * most every LEVEL_EVERY_MS. Without an ahead lane (or before it has a rate), every commit.
   */
  private chooseLevel(ahead: AheadGeometry | null, now: number) {
    if (now - this.levelAt < LEVEL_EVERY_MS) return
    this.levelAt = now
    const rate = ahead?.stats().glyphsPerSecond ?? 0
    if (!ahead || !(rate > 0)) {
      this.level = 1
      return
    }
    const commits = this.deps.planner.commits
    if (commits.length < 2) return
    const span = (commits[commits.length - 1].mediaMs - commits[0].mediaMs) / 1000
    let glyphs = 0
    for (const commit of commits) for (const job of commit.jobs) glyphs += job.indices?.length ?? job.within?.size ?? 1
    const perSecond = span > 0 ? glyphs / span : glyphs
    const level = DECIMATION_LEVELS.find((l) => perSecond / l <= AHEAD_SHARE * rate) ?? DECIMATION_LEVELS[DECIMATION_LEVELS.length - 1]
    if (level !== this.level) {
      this.level = level
      this.windowKey = ''
    }
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

/**
 * Connects a director to the page: the engine's file and playhead, the scheduler `scheduler`, React (`commit`), the
 * geometry client and the registered ahead lane. It runs on animation frames while a precomputed file plays. Returns
 * the disconnect function (the live path takes over).
 */
export function connectDirector(scheduler: DirectorScheduler, commit: (commit: LiveCommit | null) => void): () => void {
  const engine = getSoundEngine()
  const timeline = new FeatureTimeline()
  const planner = new PlaybackPlanner(timeline)
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
    resolve: (jobs) => {
      const shown = geometryClient.shownGlyphSet()
      if (!shown) return null
      return {
        fontId: shown.fontId,
        jobs: jobs.map(({ params, key, indices, within }) => ({ params, key, indices: indices ?? shownGlyphs(shown.indices, within) })),
      }
    },
    glideMs: () => {
      const { response, reducedMotion } = mappingStore.getState()
      return reducedMotion ? 0 : response.glideMs
    },
    settings: () => engine.getState().settings,
  })
  let frame: number | null = null
  // A tick that throws stops the director until the next file: the live path plays on, and the error shows once.
  let failed = false
  const loop = () => {
    frame = requestAnimationFrame(loop)
    try {
      director.tick()
    } catch (error) {
      console.error('Sound: precomputed playback stopped; the live path goes on', error)
      failed = true
      sync()
    }
  }
  const sync = () => {
    const s = engine.getState()
    const run = !failed && s.playing && s.source === 'file' && timeline.isLoaded()
    if (run) {
      if (frame === null && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(loop)
      return
    }
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    try {
      director.stop()
    } catch (error) {
      console.error('Sound: precomputed playback could not hand back', error)
    }
  }
  let loading = 0
  const off = [
    engine.subscribeState(sync),
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
      const at = engine.playhead()?.mediaMs ?? 0
      timeline.load(event.file, event.decode, engine.getState().settings, at).then(
        () => {
          if (token === loading) sync()
        },
        (error) => console.error('Sound: the file could not be precomputed; it plays live', error),
      )
    }),
  ]
  return () => {
    for (const unsubscribe of off) unsubscribe()
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    director.stop()
    planner.dispose()
    timeline.dispose()
  }
}
