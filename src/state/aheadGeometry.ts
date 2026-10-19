// The page's side of the precompute window and of Glide plans made in the workers (state/aheadTypes.ts): registered
// at import, so the director (sound/director.ts) and Glide (useGlide.ts) find them through aheadTypes.
//
// AheadGeometry: the director names the commits it will show ahead of the playhead (a window), and this asks the
// workers' ahead lane (geometryClient.sendAhead) for what is missing: each commit's glyphs, then, with Glide on, each
// lineage's glide step. A commit is ready once all its glyphs are held (in any of the client's stores) and every step's
// plan record has come. The workers are sent the remaining work again whenever the window changes or a request ends.
//
// PlanSource: a chained plan is used only when the shape Glide shows matches the `from` the worker planned from (the
// computed outline of that key, or the in-between shape of the same lineage, commit and progress); a plan on demand is
// asked of a worker with the shape sent by value, or made here when no worker can take it.

import type { AheadItem } from '../geometry/protocol'
import type { PolygonGlyph } from '../geometry/types'
import { planMorph, settleInBetween, type MorphPlan } from '../specimen/morph'
import { decodePlan, encodeGlyph } from '../specimen/planCodec'
import type { PlanData, PlanFrom } from '../specimen/planData'
import {
  setAheadGeometry,
  setPlanSource,
  type AheadGeometry,
  type AheadStats,
  type AheadWindow,
  type ChainTag,
  type PlanRequest,
  type PlanSource,
} from './aheadTypes'
import { geometryClient, type GeometryClient } from './geometryClient'

export const AHEAD_PAGE_LIMITS = {
  /** How far apart (eased progress) the page's in-between shape and the worker's may be and still count as one. */
  matchQ: 1e-3,
  /** How much the newest rate counts in the ahead lane's glyphs per second (the rest is the earlier estimate). */
  rateWeight: 0.2,
  /** The rate assumed before the lane has computed anything (glyphs per second). */
  defaultRate: 100,
} as const

/** A commit's chain step as the worker sent it. */
interface PlanRecord {
  from: PlanFrom
  data: PlanData | null
  unchanged: boolean
  /** Decoded onto the page's glyphs, by from and to (occurrences of one lineage share it). */
  decoded: WeakMap<PolygonGlyph, WeakMap<PolygonGlyph, MorphPlan>>
}

const pairId = (key: string, index: number) => `${index}|${key}`
const recordId = (lineage: number, seq: number) => `${lineage}:${seq}`

/** Runs `callback` before the next frame (or soon, where there are no frames). */
const nextFrame = (callback: () => void) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => callback())
  else setTimeout(callback, 16)
}

export class PageAhead implements AheadGeometry, PlanSource {
  private window: AheadWindow | null = null
  private records = new Map<string, PlanRecord>()
  /** Glyphs the workers' ahead stores hold (their results came), for the chain steps that need them there. */
  private held = new Set<string>()
  /** The work last sent, so the same work is not sent again while it is on its way. */
  private lastSent = ''
  /** Glyphs in the work last sent, not arrived yet. */
  private backlog = 0
  private rate = 0
  private listeners = new Set<() => void>()
  private notifying = false
  private listening = false

  /** `client`: the geometry client whose workers do the work (read when first needed). */
  constructor(private readonly client: () => GeometryClient) {}

  want(window: AheadWindow): void {
    this.listen()
    const before = this.window
    if (!before || before.generation !== window.generation || before.fontId !== window.fontId || before.glideMs !== window.glideMs) {
      this.records.clear()
      this.lastSent = ''
      if (before && before.fontId !== window.fontId) this.held.clear()
    }
    this.window = window
    this.send()
  }

  ready(seq: number): boolean {
    const window = this.window
    const commit = window?.commits.find((c) => c.seq === seq)
    if (!window || !commit) return false
    const client = this.client()
    for (const { key, indices } of commit.jobs) for (const index of indices) if (!client.has(key, index)) return false
    if (window.glideMs > 0) for (const step of commit.steps) if (!this.records.has(recordId(step.lineage, seq))) return false
    return true
  }

  stats(): AheadStats {
    const rate = this.rate > 0 ? this.rate : AHEAD_PAGE_LIMITS.defaultRate
    return { glyphsPerSecond: rate, backlogMs: (this.backlog / rate) * 1000 }
  }

  release(beforeSeq: number): void {
    const client = this.client()
    client.releaseAhead(beforeSeq)
    for (const id of this.records.keys()) if (Number(id.slice(id.indexOf(':') + 1)) < beforeSeq) this.records.delete(id)
    const window = this.window
    if (!window) return
    const commits = window.commits.filter((c) => c.seq >= beforeSeq)
    this.window = { ...window, commits }
    const kept = new Set<string>()
    for (const commit of commits) for (const { key, indices } of commit.jobs) for (const index of indices) kept.add(pairId(key, index))
    client.retainAhead((key, index) => kept.has(pairId(key, index)))
    for (const id of this.held) if (!kept.has(id)) this.held.delete(id)
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
    this.records.clear()
    this.held.clear()
    this.lastSent = ''
    this.backlog = 0
    if (!this.listening) return
    const client = this.client()
    if (window) client.sendAhead(window.fontId, window.generation, 0, [])
    client.retainAhead(() => false)
    client.releaseAhead(Infinity)
  }

  chained(lineage: number, seq: number, from: PolygonGlyph, to: PolygonGlyph, fromTag: ChainTag | null, fromComputedKey: string | null): MorphPlan | null | undefined {
    const record = this.records.get(recordId(lineage, seq))
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
    const cancel = this.client().requestPlan(encodeGlyph(from), job.toRef ?? encodeGlyph(to), (data) => done(data ? decodePlan(data, from, to) : null))
    if (cancel) return cancel
    // No worker can take it: paired here, as without worker plans.
    done(planMorph(settleInBetween(from, to), to))
    return () => {}
  }

  /** Hears the client's ahead lane (once). */
  private listen() {
    if (this.listening) return
    this.listening = true
    this.client().setAheadListener({
      results: (_seq, key, indices, times) => {
        for (const index of indices) this.held.add(pairId(key, index))
        this.backlog = Math.max(0, this.backlog - indices.length)
        const timed = times.filter((t): t is number => t !== null && t > 0)
        if (timed.length) {
          const rate = (1000 * timed.length) / timed.reduce((a, b) => a + b, 0)
          this.rate = this.rate > 0 ? this.rate + AHEAD_PAGE_LIMITS.rateWeight * (rate - this.rate) : rate
        }
        this.notifyReady()
      },
      plans: (message) => {
        if (message.generation !== this.window?.generation) return
        for (const plan of message.plans) {
          this.records.set(recordId(plan.lineage, message.seq), { from: plan.from, data: plan.data, unchanged: plan.unchanged === true, decoded: new WeakMap() })
        }
        this.notifyReady()
      },
      ended: (stopped) => {
        // A request cut short (a restarted worker) is sent again; one that ended goes on with whatever is left.
        if (stopped) this.lastSent = ''
        this.send()
      },
    })
  }

  /** Sends the workers the window's work not done yet, unless that is what they have. */
  private send() {
    const window = this.window
    if (!window) return
    const client = this.client()
    const glide = window.glideMs > 0
    const items: AheadItem[] = []
    let glyphs = 0
    const parts: string[] = []
    for (const commit of window.commits) {
      for (const { params, key, indices } of commit.jobs) {
        // With Glide on, a step needs its glyph in the worker's own store too.
        const missing = indices.filter((index) => !client.has(key, index) || (glide && !this.held.has(pairId(key, index))))
        if (!missing.length) continue
        items.push({ kind: 'glyphs', seq: commit.seq, key, params, indices: missing })
        parts.push(`g${commit.seq}|${key}|${missing.join(',')}`)
        glyphs += missing.length
      }
      if (!glide) continue
      for (const step of commit.steps) {
        if (this.records.has(recordId(step.lineage, commit.seq))) continue
        items.push({ kind: 'step', seq: commit.seq, mediaMs: commit.mediaMs, ...step })
        parts.push(`s${commit.seq}|${step.lineage}`)
      }
    }
    const signature = `${window.generation}\u001e${parts.join('\u001f')}`
    if (signature === this.lastSent) return
    if (!items.length && this.lastSent === '') return
    if (client.sendAhead(window.fontId, window.generation, window.glideMs, items)) {
      this.lastSent = items.length ? signature : ''
      this.backlog = glyphs
    }
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
