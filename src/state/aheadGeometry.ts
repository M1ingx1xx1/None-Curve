// The page's side of the precompute window and of Glide plans made in the workers (state/aheadTypes.ts): registered
// at import, so the director (sound/director.ts) and Glide (useGlide.ts) find them through aheadTypes.
//
// AheadGeometry: the director names the commits of a sliding window around the playhead (NOCUR-85: windowBehindMs
// behind, windowAheadMs ahead), and this asks the workers' ahead lane (geometryClient.sendAhead) for what is missing,
// nearest first: the near ring ahead (nearMs) in media order, each commit's glyphs then, with Glide on, each lineage's
// glide step; then the rest of the window by weighted distance (aheadTypes.ts weightedDistance), glyphs only. The
// work goes out in leases (about leaseMs of it per worker); a lease that ends, a seek or a new plan sends the next.
// The store (aheadStore.ts) keeps what the budget allows, evicting by the same distance, and the fill stops at the
// edge where nothing farther would be kept. A commit is ready once all its glyphs are in the ahead store (the canvas's
// and the live path's small stores evict without telling this lane, so they do not count) and every step's plan
// record has come; plan records stay while their commit is in the window, so a rewind finds them. Between moves of the
// window's bounds, the director only moves the playhead (setPlayhead).
//
// Readiness is memoised per commit (glyphs only), kept in media order, cleared through a reverse index when the store
// evicts a glyph, and forgotten memoMarginMs beyond the window; readyRanges turns it into the media time ranges whose
// geometry is ready (the buffered bar).
//
// PlanSource: a chained plan is used only when the shape Glide shows matches the `from` the worker planned from (the
// computed outline of that key, or the in-between shape of the same lineage, commit and progress); a plan on demand is
// asked of a worker with the shape sent by value, or made here when no worker can take it.

import type { AheadItem } from '../geometry/protocol'
import type { PolygonGlyph } from '../geometry/types'
import { probeOn, reportPrecompute } from '../render/probe'
import { planMorph, settleInBetween, type MorphPlan } from '../specimen/morph'
import { decodePlan, encodeGlyph } from '../specimen/planCodec'
import type { PlanData, PlanFrom } from '../specimen/planData'
import { PRECOMPUTE_LIMITS } from '../sound/timelineTypes'
import {
  setAheadGeometry,
  setPlanSource,
  type AheadCommit,
  type AheadGeometry,
  type AheadStats,
  type AheadWindow,
  type ChainTag,
  type PlanRequest,
  type PlanSource,
  type ReadyRanges,
} from './aheadTypes'
import { geometryClient, type GeometryClient } from './geometryClient'

export const AHEAD_PAGE_LIMITS = {
  /** How far apart (eased progress) the page's in-between shape and the worker's may be and still count as one. */
  matchQ: 1e-3,
  /** How much the newest rate counts in the ahead lane's glyphs per second (the rest is the earlier estimate). */
  rateWeight: 0.2,
  /** The rate assumed before the lane has computed anything (glyphs per second). */
  defaultRate: 100,
  /** A glide step counts as this much of a glyph's work in a lease. */
  stepWork: 0.25,
  /** The store forgets the uses of glyphs it does not hold once the window has moved this far (media ms). */
  pruneEveryMs: 5000,
  /** Readiness is remembered this far beyond the window (media ms): the bar shows what is kept near an old spot. */
  memoMarginMs: 60_000,
  /** The probe's store statistics are reported at most this often (ms of page time). */
  reportEveryMs: 250,
  /**
   * While a lease is on its way and the playhead only moves forward, the next lease waits for it to end, up to this
   * far (media ms): one sent sooner would make the workers redo the work whose results are still coming.
   */
  leaseKeepMs: 500,
} as const

/** A commit's chain step as the worker sent it. */
interface PlanRecord {
  from: PlanFrom
  data: PlanData | null
  unchanged: boolean
  /** Decoded onto the page's glyphs, by from and to (occurrences of one lineage share it). */
  decoded: WeakMap<PolygonGlyph, WeakMap<PolygonGlyph, MorphPlan>>
}

/** Values by key and glyph id: keys are long (paramsKey), so they are never joined with the id into one string. */
class PairMap<T> {
  private map = new Map<string, Map<number, T>>()
  get(key: string, index: number): T | undefined {
    return this.map.get(key)?.get(index)
  }
  set(key: string, index: number, value: T) {
    let byIndex = this.map.get(key)
    if (!byIndex) this.map.set(key, (byIndex = new Map()))
    byIndex.set(index, value)
  }
  delete(key: string, index: number) {
    const byIndex = this.map.get(key)
    if (!byIndex) return
    byIndex.delete(index)
    if (!byIndex.size) this.map.delete(key)
  }
  /** Drops the values the test refuses. */
  retain(keep: (value: T) => boolean) {
    for (const [key, byIndex] of this.map) {
      for (const [index, value] of byIndex) if (!keep(value)) byIndex.delete(index)
      if (!byIndex.size) this.map.delete(key)
    }
  }
  clear() {
    this.map.clear()
  }
}

/** Runs `callback` before the next frame (or soon, where there are no frames). */
const nextFrame = (callback: () => void) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => callback())
  else setTimeout(callback, 16)
}

const pageNow = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

/** Index of the first seq ≥ `seq` in rising `seqs`. */
function firstSeqAtOrAfter(seqs: readonly number[], seq: number): number {
  let lo = 0
  let hi = seqs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (seqs[mid] < seq) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Index of the first commit with seq ≥ `seq` (commits in media order have rising seqs). */
function firstAtOrAfter(commits: readonly AheadCommit[], seq: number): number {
  let lo = 0
  let hi = commits.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (commits[mid].seq < seq) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class PageAhead implements AheadGeometry, PlanSource {
  private window: AheadWindow | null = null
  private bySeq = new Map<number, AheadCommit>()
  /** Step records by commit, then lineage. */
  private records = new Map<number, Map<number, PlanRecord>>()
  /** Glyphs the workers' ahead stores hold (their results came, Glide on), with the newest commit that uses them. */
  private held = new PairMap<number>()
  /** The work last sent, so the same work is not sent again while it is on its way. */
  private lastSent = ''
  /** Where the playhead was when the work last sent went out. */
  private sentPlayheadMs = -Infinity
  /** Glyphs in the work last sent, not arrived yet. */
  private backlog = 0
  private rate = 0
  private paused = false
  private listeners = new Set<() => void>()
  private notifying = false
  private listening = false
  /** Commits whose glyphs are all held (current plan and level), with the span they are on screen and their glyphs. */
  private memo = new Map<number, { mediaMs: number; endMs: number; glyphs: number }>()
  /** The memoised seqs in order (seqs rise with media time); `memoOrderDirty`: some are gone from the memo. */
  private memoOrder: number[] = []
  private memoOrderDirty = false
  /** For each glyph, the memoised commits that use it (an eviction clears them). */
  private memoBy = new PairMap<number[]>()
  /** Seqs in memoBy's lists, and how many of them belong to memoised commits (the rest are dropped ones). */
  private memoRefs = 0
  private memoLive = 0
  private memoVersion = 0
  private rangesCache: { version: number; value: ReadyRanges } | null = null
  /** Commits whose uses the store has. */
  private marked = new Set<number>()
  private lastDueSeq = -1
  private prunedAt = -Infinity
  /** Glyphs found held or computed since the plan changed (probe). */
  private reuse = { hits: 0, misses: 0 }
  private seen = new PairMap<true>()
  private reportedAt = -Infinity

  /** `client`: the geometry client whose workers do the work (read when first needed). */
  constructor(private readonly client: () => GeometryClient) {}

  want(window: AheadWindow): void {
    this.listen()
    const before = this.window
    const store = this.client().aheadStore
    const newPlan =
      !before ||
      before.generation !== window.generation ||
      before.level !== window.level ||
      before.fontId !== window.fontId
    if (newPlan || before.glideMs !== window.glideMs) {
      this.records.clear()
      this.lastSent = ''
    }
    if (before && before.fontId !== window.fontId) this.held.clear()
    if (newPlan) {
      // Every glyph is an orphan until the new window uses it again: those whose keys did not change hit at once.
      store.orphanAll()
      this.marked.clear()
      this.forgetReadiness()
      this.reuse = { hits: 0, misses: 0 }
      this.seen.clear()
    }
    this.window = window
    this.paused = false
    this.bySeq = new Map(window.commits.map((c) => [c.seq, c]))
    store.setPlayhead(window.playheadMs)
    for (const commit of window.commits) {
      if (this.marked.has(commit.seq)) continue
      this.marked.add(commit.seq)
      for (const { key, indices } of commit.jobs) for (const index of indices) store.use(key, index, commit.mediaMs)
    }
    for (const seq of this.marked) if (!this.bySeq.has(seq)) this.marked.delete(seq)
    this.moved(window)
    if (!newPlan && before.glideMs === window.glideMs && this.leaseGoesOn(window.playheadMs)) return
    this.send()
  }

  setPlayhead(playheadMs: number, dueSeq: number): void {
    const before = this.window
    if (!before) return
    const window = { ...before, playheadMs, dueSeq }
    this.window = window
    this.client().aheadStore.setPlayhead(playheadMs)
    this.moved(window)
    if (this.leaseGoesOn(playheadMs)) return
    this.send()
  }

  shapesReady(seq: number): boolean {
    const commit = this.bySeq.get(seq)
    return this.window !== null && commit !== undefined && this.glyphsReady(commit)
  }

  ready(seq: number): boolean {
    const window = this.window
    const commit = this.bySeq.get(seq)
    if (!window || !commit || !this.glyphsReady(commit)) return false
    if (window.glideMs > 0) {
      const records = this.records.get(seq)
      for (const step of commit.steps) if (!records?.has(step.lineage)) return false
    }
    return true
  }

  stats(): AheadStats {
    const rate = this.rate > 0 ? this.rate : AHEAD_PAGE_LIMITS.defaultRate
    return { glyphsPerSecond: rate, backlogMs: (this.backlog / rate) * 1000 }
  }

  release(beforeSeq: number): void {
    for (const seq of this.records.keys()) if (seq < beforeSeq) this.records.delete(seq)
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    const window = this.window
    if (!window || !this.listening || this.lastSent === '') return
    this.client().sendAhead(window.fontId, window.generation, window.glideMs, window.playheadMs, [])
    this.lastSent = ''
    this.backlog = 0
  }

  readyRanges(): ReadyRanges {
    const generation = this.window?.generation ?? -1
    const cached = this.rangesCache
    if (cached && cached.version === this.memoVersion && cached.value.generation === generation) return cached.value
    if (this.memoOrderDirty) {
      // A commit forgotten and remembered again sits next to its old place: kept once.
      this.memoOrder = this.memoOrder.filter((seq, i, order) => this.memo.has(seq) && (i === 0 || order[i - 1] !== seq))
      this.memoOrderDirty = false
    }
    const out: number[] = []
    for (const seq of this.memoOrder) {
      const { mediaMs, endMs } = this.memo.get(seq)!
      // Neighbours on the 60 Hz grid touch: a millisecond of slack.
      if (out.length && mediaMs <= out[out.length - 1] + 1) out[out.length - 1] = Math.max(out[out.length - 1], endMs)
      else out.push(mediaMs, endMs)
    }
    const value = { generation, ranges: Float64Array.from(out) }
    this.rangesCache = { version: this.memoVersion, value }
    return value
  }

  subscribeReady(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  clear(): void {
    const window = this.window
    this.window = null
    this.bySeq = new Map()
    this.records.clear()
    this.held.clear()
    this.marked.clear()
    this.forgetReadiness()
    this.lastSent = ''
    this.lastDueSeq = -1
    this.backlog = 0
    if (!this.listening) return
    const client = this.client()
    if (window) client.sendAhead(window.fontId, window.generation, 0, window.playheadMs, [])
    client.releaseAhead(Infinity)
    client.aheadStore.clear()
  }

  chained(
    lineage: number,
    seq: number,
    from: PolygonGlyph,
    to: PolygonGlyph,
    fromTag: ChainTag | null,
    fromComputedKey: string | null,
  ): MorphPlan | null | undefined {
    const record = this.records.get(seq)?.get(lineage)
    if (!record) return undefined
    const planned = record.from
    const matches =
      planned.kind === 'computed'
        ? fromComputedKey === planned.key
        : planned.kind === 'between' &&
          fromTag !== null &&
          fromTag.lineage === planned.lineage &&
          fromTag.seq === planned.seq &&
          Math.abs(fromTag.q - planned.q) < AHEAD_PAGE_LIMITS.matchQ
    if (!matches) return undefined
    if (record.unchanged || !record.data) return null
    let byTarget = record.decoded.get(from)
    if (!byTarget) record.decoded.set(from, (byTarget = new WeakMap()))
    let plan = byTarget.get(to)
    if (!plan) byTarget.set(to, (plan = decodePlan(record.data, from, to)))
    return plan
  }

  request(job: PlanRequest, done: (plan: MorphPlan | null) => void): () => void {
    const { from, to } = job
    const cancel = this.client().requestPlan(encodeGlyph(from), encodeGlyph(to), (data) =>
      done(data ? decodePlan(data, from, to) : null),
    )
    if (cancel) return cancel
    // No worker can take it: paired here, as without worker plans.
    done(planMorph(settleInBetween(from, to), to))
    return () => {}
  }

  /**
   * The playhead moved (and maybe the commit due): the store's uses and the memo are pruned now and then, and the
   * workers drop what is behind the commit due.
   */
  private moved(window: AheadWindow) {
    if (Math.abs(window.playheadMs - this.prunedAt) > AHEAD_PAGE_LIMITS.pruneEveryMs) {
      this.prunedAt = window.playheadMs
      const margin = AHEAD_PAGE_LIMITS.pruneEveryMs
      this.client().aheadStore.pruneUses(
        window.playheadMs - PRECOMPUTE_LIMITS.windowBehindMs - margin,
        window.playheadMs + PRECOMPUTE_LIMITS.windowAheadMs + margin,
      )
      this.pruneMemo(window.playheadMs)
    }
    if (window.dueSeq !== this.lastDueSeq) {
      // The workers keep only the part ahead: what is behind the commit due goes there (the page keeps its own).
      this.lastDueSeq = window.dueSeq
      this.client().releaseAhead(window.dueSeq)
      this.held.retain((seq) => seq >= window.dueSeq)
    }
  }

  /** The memo of ready commits starts over (a new plan, level or font). */
  private forgetReadiness() {
    this.memo.clear()
    this.memoOrder = []
    this.memoOrderDirty = false
    this.memoBy.clear()
    this.memoRefs = 0
    this.memoLive = 0
    this.memoVersion++
  }

  /** Every glyph of the commit is in the ahead store (memoised until one of them is evicted). */
  private glyphsReady(commit: AheadCommit): boolean {
    if (this.memo.has(commit.seq)) return true
    const store = this.client().aheadStore
    for (const { key, indices } of commit.jobs) for (const index of indices) if (!store.has(key, index)) return false
    this.remember(commit)
    return true
  }

  private remember(commit: AheadCommit) {
    let glyphs = 0
    for (const { key, indices } of commit.jobs) {
      for (const index of indices) {
        const seqs = this.memoBy.get(key, index)
        if (seqs) seqs.push(commit.seq)
        else this.memoBy.set(key, index, [commit.seq])
        glyphs++
      }
    }
    this.memo.set(commit.seq, { mediaMs: commit.mediaMs, endMs: commit.endMs, glyphs })
    this.memoRefs += glyphs
    this.memoLive += glyphs
    // Kept in order: mostly appended (the window fills ahead), otherwise put in its place.
    const order = this.memoOrder
    if (!order.length || commit.seq > order[order.length - 1]) order.push(commit.seq)
    else order.splice(firstSeqAtOrAfter(order, commit.seq), 0, commit.seq)
    this.memoVersion++
  }

  /** A memoised commit is no longer ready (its seq stays in memoBy's lists until they are cleaned). */
  private forget(seq: number): boolean {
    const entry = this.memo.get(seq)
    if (!entry) return false
    this.memo.delete(seq)
    this.memoLive -= entry.glyphs
    this.memoOrderDirty = true
    return true
  }

  /** Forgets readiness memoMarginMs beyond the window around `playheadMs`, and cleans memoBy once most of it is stale. */
  private pruneMemo(playheadMs: number) {
    const from = playheadMs - PRECOMPUTE_LIMITS.windowBehindMs - AHEAD_PAGE_LIMITS.memoMarginMs
    const to = playheadMs + PRECOMPUTE_LIMITS.windowAheadMs + AHEAD_PAGE_LIMITS.memoMarginMs
    let changed = false
    for (const [seq, { mediaMs }] of this.memo)
      if (mediaMs < from || mediaMs > to) changed = this.forget(seq) || changed
    if (changed) this.memoVersion++
    if (this.memoRefs <= 2 * this.memoLive + 1024) return
    let refs = 0
    this.memoBy.retain((seqs) => {
      let n = 0
      for (const seq of seqs) if (this.memo.has(seq)) seqs[n++] = seq
      seqs.length = n
      refs += n
      return n > 0
    })
    this.memoRefs = refs
  }

  /** Hears the client's ahead lane and store (once). */
  private listen() {
    if (this.listening) return
    this.listening = true
    const client = this.client()
    client.aheadStore.onEvict((evicted) => {
      let changed = false
      for (const { key, index } of evicted) {
        const seqs = this.memoBy.get(key, index)
        if (!seqs) continue
        this.memoBy.delete(key, index)
        this.memoRefs -= seqs.length
        for (const seq of seqs) changed = this.forget(seq) || changed
      }
      if (changed) this.memoVersion++
    })
    client.setAheadListener({
      results: (generation, seq, key, indices, times) => {
        // How fast the workers compute holds whatever plan the glyphs were for.
        const timed = times.filter((t): t is number => t !== null && t > 0)
        if (timed.length) {
          const rate = (1000 * timed.length) / timed.reduce((a, b) => a + b, 0)
          this.rate = this.rate > 0 ? this.rate + AHEAD_PAGE_LIMITS.rateWeight * (rate - this.rate) : rate
        }
        // A superseded plan's commits are not this one's (its seqs name other commits), as for plans below.
        if (generation !== this.window?.generation) return
        if (this.window.glideMs > 0)
          for (const index of indices) this.held.set(key, index, Math.max(seq, this.held.get(key, index) ?? seq))
        this.backlog = Math.max(0, this.backlog - indices.length)
        this.notifyReady()
      },
      plans: (message) => {
        if (message.generation !== this.window?.generation) return
        let records = this.records.get(message.seq)
        if (!records) this.records.set(message.seq, (records = new Map()))
        for (const plan of message.plans)
          records.set(plan.lineage, {
            from: plan.from,
            data: plan.data,
            unchanged: plan.unchanged === true,
            decoded: new WeakMap(),
          })
        this.notifyReady()
      },
      ended: (stopped) => {
        // A request cut short (a restarted worker) is sent again; one that ended goes on with whatever is left, once
        // every worker's part of the lease has ended (sooner, the others would redo what they are still sending).
        if (stopped) this.lastSent = ''
        else if (this.client().aheadInFlight()) return
        this.send()
      },
    })
  }

  /**
   * The window's commits in the order they are filled: the near ring ahead in media order, then the rest by weighted
   * distance (ahead at its distance, behind at behindWeight times it).
   */
  private *order(window: AheadWindow): Generator<{ commit: AheadCommit; near: boolean; distance: number }> {
    const { commits, playheadMs: ph } = window
    const due = firstAtOrAfter(commits, window.dueSeq)
    const nearEnd = ph + PRECOMPUTE_LIMITS.nearMs
    let a = due
    for (; a < commits.length && commits[a].mediaMs <= nearEnd; a++)
      yield { commit: commits[a], near: true, distance: Math.max(0, commits[a].mediaMs - ph) }
    let b = due - 1
    const weight = PRECOMPUTE_LIMITS.behindWeight
    while (a < commits.length || b >= 0) {
      const ahead = a < commits.length ? commits[a].mediaMs - ph : Infinity
      const behind = b >= 0 ? weight * Math.max(0, ph - commits[b].mediaMs) : Infinity
      if (ahead <= behind) yield { commit: commits[a++], near: false, distance: ahead }
      else yield { commit: commits[b--], near: false, distance: behind }
    }
  }

  /**
   * The lease on its way goes on: the playhead moved forward from where it was sent, by less than leaseKeepMs. Each
   * frame's lease would otherwise replace it while its results are still coming, and the workers would compute those
   * again (the page has not seen them yet): with many glide steps per commit, the near ring would never fill.
   */
  private leaseGoesOn(playheadMs: number): boolean {
    if (this.lastSent === '' || !this.client().aheadInFlight()) return false
    const moved = playheadMs - this.sentPlayheadMs
    return moved >= 0 && moved < AHEAD_PAGE_LIMITS.leaseKeepMs
  }

  /** Sends the workers the next lease of missing work, nearest first, unless that is what they have. */
  private send() {
    const window = this.window
    if (!window || this.paused) return
    const client = this.client()
    const store = client.aheadStore
    const glide = window.glideMs > 0
    const workers = client.workerCount()
    const rate = this.rate > 0 ? this.rate : AHEAD_PAGE_LIMITS.defaultRate
    const lease = Math.max(
      PRECOMPUTE_LIMITS.leaseMinGlyphs * workers,
      (PRECOMPUTE_LIMITS.leaseMs / 1000) * rate * workers,
    )
    const full = store.full()
    const edge = full ? store.farthest() : Infinity
    const items: AheadItem[] = []
    const parts: string[] = []
    const queued = new PairMap<true>()
    let glyphs = 0
    let work = 0
    // Ids for keys within this lease's signature: within a generation a seq names its jobs, so the order they first
    // appear in tells two leases apart as well as the keys would.
    const keyIds = new Map<string, number>()
    const idOf = (key: string) => {
      let id = keyIds.get(key)
      if (id === undefined) keyIds.set(key, (id = keyIds.size))
      return id
    }
    for (const { commit, near, distance } of this.order(window)) {
      if (work >= lease) break
      // Nothing farther than what the full store keeps would stay.
      if (!near && distance >= edge) break
      const ahead = commit.seq >= window.dueSeq
      const chained = glide && near && ahead
      if (!this.memo.has(commit.seq) || chained) {
        let all = true
        for (const { params, key, indices } of commit.jobs) {
          const missing: number[] = []
          for (const index of indices) {
            const has = store.has(key, index)
            if (probeOn && this.seen.get(key, index) === undefined) {
              this.seen.set(key, index, true)
              if (has) this.reuse.hits++
              else this.reuse.misses++
            }
            if (!has) all = false
            // With Glide on, a step needs its glyph in the worker's own store too.
            const wanted = !has || (chained && this.held.get(key, index) === undefined)
            if (wanted && queued.get(key, index) === undefined) {
              queued.set(key, index, true)
              missing.push(index)
            }
          }
          if (!missing.length) continue
          items.push({ kind: 'glyphs', seq: commit.seq, mediaMs: commit.mediaMs, key, params, indices: missing })
          parts.push(`g${commit.seq}|${idOf(key)}|${missing.join(',')}`)
          glyphs += missing.length
          work += missing.length
        }
        if (all && !this.memo.has(commit.seq)) this.remember(commit)
      }
      if (!chained) continue
      const records = this.records.get(commit.seq)
      for (const step of commit.steps) {
        if (records?.has(step.lineage)) continue
        items.push({ kind: 'step', seq: commit.seq, mediaMs: commit.mediaMs, ...step })
        parts.push(`s${commit.seq}|${step.lineage}`)
        work += AHEAD_PAGE_LIMITS.stepWork
        // Sending the step reserves its glyph in the worker for this commit (aheadCore.ts reserve).
        const seq = this.held.get(step.key, step.index)
        if (seq !== undefined && seq < commit.seq) this.held.set(step.key, step.index, commit.seq)
      }
    }
    this.report()
    const signature = `${window.generation}\u001e${parts.join('\u001f')}`
    if (signature === this.lastSent) return
    if (!items.length && this.lastSent === '') return
    if (client.sendAhead(window.fontId, window.generation, window.glideMs, window.playheadMs, items)) {
      this.lastSent = items.length ? signature : ''
      this.sentPlayheadMs = window.playheadMs
      this.backlog = glyphs
    }
  }

  /** The store's statistics for the probe, at most every reportEveryMs. */
  private report() {
    if (!probeOn) return
    const now = pageNow()
    if (now - this.reportedAt < AHEAD_PAGE_LIMITS.reportEveryMs) return
    this.reportedAt = now
    const client = this.client()
    const store = client.aheadStore
    reportPrecompute({
      store: {
        entries: store.size(),
        points: store.points(),
        bytes: store.bytes(),
        evictions: store.evictions,
        orphans: store.orphans(),
      },
      workers: { bytes: client.aheadWorkerBytes() },
      reuse: { ...this.reuse },
    })
  }

  /** Tells the ready listeners, at most once per animation frame. */
  private notifyReady() {
    if (this.notifying) return
    this.notifying = true
    nextFrame(() => {
      this.notifying = false
      for (const listener of this.listeners) listener()
    })
  }
}

const pageAhead = new PageAhead(() => geometryClient)
setAheadGeometry(pageAhead)
setPlanSource(pageAhead)
