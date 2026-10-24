// The page's side of the sliding precompute window (src/state/aheadGeometry.ts, NOCUR-85): it asks for the near ring
// ahead in media order first, then the rest of the window by weighted distance (behind counts behindWeight times), in
// leases of about leaseMs of work per worker; it asks for a glyph once however many commits use it, and not again
// while it is on its way. A new plan keeps the glyphs (they are found again by key) and drops the step records; the
// ready commits become media time ranges for the buffered bar, and an eviction takes them back.

import { describe, expect, it } from 'vitest'
import type { AheadItem } from '../../src/geometry/protocol'
import { PRECOMPUTE_LIMITS } from '../../src/sound/timelineTypes'
import { weightedDistance, type AheadCommit, type AheadWindow } from '../../src/state/aheadTypes'
import { AheadStore } from '../../src/state/aheadStore'
import { AHEAD_PAGE_LIMITS, PageAhead } from '../../src/state/aheadGeometry'
import type { AheadListener, GeometryClient } from '../../src/state/geometryClient'
import { BASE } from '../helpers/params'

/** A client with one worker and a real ahead store; records what is sent. Results arrive by `arrive`. */
function fakeClient(budget = 1 << 20) {
  const sent: AheadItem[][] = []
  const released: number[] = []
  const aheadStore = new AheadStore(budget)
  let listener: AheadListener | null = null
  const lease = { inFlight: false }
  /** The plan generation of the newest lease (results arrive for it unless a test says otherwise). */
  let generation = -1
  const client = {
    aheadStore,
    setAheadListener: (l: AheadListener | null) => (listener = l),
    has: (key: string, index: number) => aheadStore.has(key, index),
    workerCount: () => 1,
    aheadInFlight: () => lease.inFlight,
    sendAhead: (_font: string, sentGeneration: number, _glide: number, _playhead: number, items: readonly AheadItem[]) => {
      generation = sentGeneration
      sent.push([...items])
      return true
    },
    releaseAhead: (seq: number) => released.push(seq),
    aheadWorkerBytes: () => 0,
    requestPlan: () => null,
  } as unknown as GeometryClient
  /** The results of these items come (as errors: small, and held like any glyph), for the newest lease's plan or `of`. */
  const arrive = (items: readonly AheadItem[], of = generation) => {
    for (const item of items) {
      if (item.kind !== 'glyphs') continue
      for (const index of item.indices) aheadStore.put(item.key, index, { error: 'x' })
      listener!.results(of, item.seq, item.key, item.indices, item.indices.map(() => 5))
    }
  }
  return { client, sent, released, aheadStore, arrive, lease, listener: () => listener! }
}

/** Commits every 100 ms of media time over 20 s, one glyph each (`keyOf` names its key). */
function commitsOf(keyOf: (seq: number) => string = (seq) => `k${seq}`, steps = false): AheadCommit[] {
  return Array.from({ length: 200 }, (_, seq) => ({
    seq,
    prevSeq: seq - 1,
    mediaMs: seq * 100,
    endMs: seq * 100 + 100,
    jobs: [{ params: BASE, key: keyOf(seq), indices: [3] }],
    steps: steps ? [{ lineage: 0, parent: -1, index: 3, key: keyOf(seq) }] : [],
  }))
}

function windowOf(commits: AheadCommit[], playheadMs: number, patch: Partial<AheadWindow> = {}): AheadWindow {
  const dueSeq = commits.filter((c) => c.mediaMs <= playheadMs).at(-1)!.seq
  return { generation: 1, level: 1, fontId: 'f', glideMs: 0, playheadMs, dueSeq, commits, ...patch }
}

const seqsOf = (items: readonly AheadItem[]) => items.map((item) => item.seq)

describe('the page ahead window', () => {
  it('asks for the near ring ahead in media order, then the rest by weighted distance, a lease at a time', () => {
    const { client, sent, arrive, listener } = fakeClient()
    const ahead = new PageAhead(() => client)
    const commits = commitsOf()
    const window = windowOf(commits, 10_000)
    ahead.want(window)
    // One worker at the default rate: a lease is leaseMs of its glyphs, at least leaseMinGlyphs.
    const lease = Math.max(PRECOMPUTE_LIMITS.leaseMinGlyphs, (PRECOMPUTE_LIMITS.leaseMs / 1000) * 100)
    expect(sent).toHaveLength(1)
    expect(seqsOf(sent[0])).toEqual(Array.from({ length: lease }, (_, k) => 100 + k))
    // The same window again: the lease is on its way, nothing is sent again.
    ahead.want({ ...window })
    expect(sent).toHaveLength(1)
    // Its results come and the lease ends: the next one.
    let ended = 0
    while (sent.length > ended && ended < 20) {
      arrive(sent[ended])
      ended++
      listener().ended(false)
    }
    const order = sent.flat().map((item) => commits[item.seq].mediaMs)
    const nearEnd = 10_000 + PRECOMPUTE_LIMITS.nearMs
    const near = order.filter((ms) => ms >= 10_000 && ms <= nearEnd)
    expect(order.slice(0, near.length)).toEqual(near)
    const rest = order.slice(near.length).map((ms) => weightedDistance(ms, ms, 10_000))
    for (let i = 1; i < rest.length; i++) expect(rest[i]).toBeGreaterThanOrEqual(rest[i - 1])
    // Behind counts behindWeight times: the commit 100 ms behind comes before the one 3.1 s ahead.
    expect(order[near.length]).toBe(9900)
    // The whole window, once each.
    expect(new Set(order).size).toBe(order.length)
    expect(order.length).toBe(commits.filter((c) => c.mediaMs >= 10_000 - PRECOMPUTE_LIMITS.windowBehindMs).length)
  })

  it('asks for a glyph many commits use once, and finds commits ready once their glyphs are held', () => {
    const { client, sent, arrive } = fakeClient()
    const ahead = new PageAhead(() => client)
    // Ten commits in a row share each key.
    const commits = commitsOf((seq) => `k${Math.floor(seq / 10)}`)
    ahead.want(windowOf(commits, 0))
    const keys = sent[0].map((item) => (item.kind === 'glyphs' ? item.key : ''))
    expect(new Set(keys).size).toBe(keys.length)
    expect(ahead.ready(0)).toBe(false)
    arrive(sent[0])
    for (let seq = 0; seq < 10 * keys.length; seq++) expect(ahead.ready(seq)).toBe(true)
  })

  it('counts only results of the current plan against what is on its way', () => {
    const { client, sent, arrive } = fakeClient()
    const ahead = new PageAhead(() => client)
    ahead.want(windowOf(commitsOf(), 0, { generation: 2 }))
    /** Glyphs still on their way. */
    const left = () => (ahead.stats().backlogMs * ahead.stats().glyphsPerSecond) / 1000
    const backlog = left()
    expect(backlog).toBeGreaterThan(0)
    // A superseded plan's answers (its seqs name other commits) leave the backlog as it is; the current plan's take it down.
    arrive(sent[0], 1)
    expect(left()).toBeCloseTo(backlog)
    arrive(sent[0])
    expect(left()).toBe(0)
  })

  it('turns the ready commits into merged media time ranges, and an eviction takes them back', () => {
    const { client, sent, arrive, aheadStore } = fakeClient()
    const ahead = new PageAhead(() => client)
    const commits = commitsOf()
    ahead.want(windowOf(commits, 0))
    arrive(sent[0])
    for (const c of commits.slice(0, 5)) ahead.ready(c.seq)
    for (const c of commits.slice(7, 9)) ahead.ready(c.seq)
    expect([...ahead.readyRanges().ranges]).toEqual([0, 500, 700, 900])
    expect(ahead.readyRanges().generation).toBe(1)
    expect(ahead.readyRanges()).toBe(ahead.readyRanges())
    aheadStore.clear()
    expect([...ahead.readyRanges().ranges]).toEqual([])
  })

  it('counts only the ahead store: a glyph the canvas or live stores hold is still asked for', () => {
    const { client, sent, arrive } = fakeClient()
    // The canvas's small stores hold k0 (they evict without telling the lane).
    ;(client as unknown as { has: (key: string, index: number) => boolean }).has = (key, index) => key === 'k0' || client.aheadStore.has(key, index)
    const ahead = new PageAhead(() => client)
    ahead.want(windowOf(commitsOf(), 0))
    expect(ahead.ready(0)).toBe(false)
    expect(sent[0].some((item) => item.kind === 'glyphs' && item.key === 'k0')).toBe(true)
    arrive(sent[0])
    expect(ahead.ready(0)).toBe(true)
  })

  it('moves the playhead without diffing the window again, and forgets readiness far beyond the window', () => {
    const { client, sent, arrive, released } = fakeClient()
    const ahead = new PageAhead(() => client)
    const commits = commitsOf()
    ahead.want(windowOf(commits, 0))
    arrive(sent[0])
    for (const c of commits.slice(0, 5)) ahead.ready(c.seq)
    ahead.setPlayhead(300, 3)
    expect(released.at(-1)).toBe(3)
    expect(ahead.readyRanges().ranges[0]).toBe(0)
    expect(ahead.readyRanges().ranges[1]).toBeGreaterThanOrEqual(500)
    // Far ahead (beyond the window and memoMarginMs): what was ready near 0 s is no longer shown as ready.
    const far = PRECOMPUTE_LIMITS.windowBehindMs + 120_000
    ahead.setPlayhead(far, 199)
    expect([...ahead.readyRanges().ranges]).toEqual([])
  })

  it('a new plan keeps the glyphs (unchanged keys are ready at once) and drops the step records', () => {
    const { client, sent, arrive, listener } = fakeClient()
    const ahead = new PageAhead(() => client)
    const commits = commitsOf((seq) => `k${seq}`, true)
    ahead.want(windowOf(commits, 0, { glideMs: 150 }))
    arrive(sent[0])
    listener().plans({ type: 'ahead-plans', requestId: 1, generation: 1, seq: 0, plans: [{ lineage: 0, from: { kind: 'computed', key: 'k0' }, data: null, unchanged: true }] })
    expect(ahead.ready(0)).toBe(true)
    ahead.want(windowOf(commits, 0, { glideMs: 150, generation: 2 }))
    // The glyph is there; the step's plan must come again for the new plan.
    expect(client.has('k0', 3)).toBe(true)
    expect(ahead.ready(0)).toBe(false)
    expect(sent.at(-1)!.some((item) => item.kind === 'step' && item.seq === 0)).toBe(true)
    expect(sent.at(-1)!.some((item) => item.kind === 'glyphs' && item.seq === 0)).toBe(false)
    // Without Glide, the glyphs alone make it ready.
    ahead.want(windowOf(commits, 0, { generation: 3 }))
    expect(ahead.ready(0)).toBe(true)
  })

  it('pauses the workers (an empty request) and resumes with the next window; the commit due releases the part behind', () => {
    const { client, sent, released } = fakeClient()
    const ahead = new PageAhead(() => client)
    const commits = commitsOf()
    ahead.want(windowOf(commits, 5000))
    expect(released).toEqual([50])
    ahead.pause()
    expect(sent.at(-1)).toEqual([])
    ahead.pause()
    expect(sent.filter((items) => items.length === 0)).toHaveLength(1)
    ahead.want(windowOf(commits, 5000))
    expect(sent.at(-1)!.length).toBeGreaterThan(0)
  })

  it('keeps the lease on its way while the playhead moves forward, and sends the next when every part has ended', () => {
    const { client, sent, lease, listener } = fakeClient()
    const ahead = new PageAhead(() => client)
    const commits = commitsOf((seq) => `k${seq}`, true)
    ahead.want(windowOf(commits, 1000, { glideMs: 150 }))
    expect(sent).toHaveLength(1)
    lease.inFlight = true
    // Frame after frame forward: the steps whose plans are still coming are not asked for again.
    for (let ms = 1016; ms < 1000 + AHEAD_PAGE_LIMITS.leaseKeepMs; ms += 16) ahead.setPlayhead(ms, Math.floor(ms / 100))
    expect(sent).toHaveLength(1)
    // Another worker's part is still on its way: one ending sends nothing yet.
    listener().ended(false)
    expect(sent).toHaveLength(1)
    lease.inFlight = false
    listener().ended(false)
    expect(sent).toHaveLength(2)
    // A seek back replaces the lease at once, and so does the playhead leaseKeepMs past where the lease went out.
    lease.inFlight = true
    ahead.setPlayhead(500, 5)
    expect(sent).toHaveLength(3)
    ahead.setPlayhead(500 + AHEAD_PAGE_LIMITS.leaseKeepMs, 10)
    expect(sent).toHaveLength(4)
  })
})
