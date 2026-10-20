// The page's ahead store keeps to its memory budget (src/state/aheadGeometry.ts AHEAD_PAGE_LIMITS.maxPoints): past it,
// only the window's nearest stretch (PRECOMPUTE_LIMITS.geometryAheadMs[0]) is asked for and kept.

import { describe, expect, it } from 'vitest'
import type { AheadItem } from '../../src/geometry/protocol'
import { PRECOMPUTE_LIMITS } from '../../src/sound/timelineTypes'
import type { AheadCommit } from '../../src/state/aheadTypes'
import { AHEAD_PAGE_LIMITS, PageAhead } from '../../src/state/aheadGeometry'
import type { GeometryClient } from '../../src/state/geometryClient'
import { BASE } from '../helpers/params'

/** A client holding nothing, with `points` in its ahead store; records what is sent and what the store keeps. */
function fakeClient(points: number) {
  const sent: AheadItem[][] = []
  const retained: string[][] = []
  const store = new Set(Array.from({ length: 200 }, (_, seq) => `k${seq}|3`))
  const client = {
    setAheadListener: () => {},
    has: () => false,
    sendAhead: (_font: string, _generation: number, _glide: number, items: readonly AheadItem[]) => {
      sent.push([...items])
      return true
    },
    releaseAhead: () => {},
    retainAhead: (keep: (key: string, index: number) => boolean) => {
      for (const id of store) if (!keep(id.slice(0, id.indexOf('|')), 3)) store.delete(id)
      retained.push([...store])
    },
    aheadPoints: () => points,
    requestPlan: () => null,
  } as unknown as GeometryClient
  return { client, sent, retained }
}

const commits: AheadCommit[] = Array.from({ length: 90 }, (_, seq) => ({
  seq,
  prevSeq: seq - 1,
  mediaMs: (seq * 1000) / 30,
  jobs: [{ params: BASE, key: `k${seq}`, indices: [3] }],
  steps: [],
}))
const seqsOf = (items: readonly AheadItem[]) => items.map((item) => item.seq)

describe('the page ahead store', () => {
  it('asks for the whole window within its budget', () => {
    const { client, sent, retained } = fakeClient(1000)
    new PageAhead(() => client).want({ generation: 1, fontId: 'f', glideMs: 0, commits })
    expect(seqsOf(sent.at(-1)!)).toEqual(commits.map((c) => c.seq))
    expect(retained).toEqual([])
  })

  it('past its budget, asks for and keeps only the nearest stretch of the window', () => {
    const { client, sent, retained } = fakeClient(AHEAD_PAGE_LIMITS.maxPoints + 1)
    new PageAhead(() => client).want({ generation: 1, fontId: 'f', glideMs: 0, commits })
    const near = commits.filter((c) => c.mediaMs <= PRECOMPUTE_LIMITS.geometryAheadMs[0]).map((c) => c.seq)
    expect(near.length).toBeLessThan(commits.length)
    expect(seqsOf(sent.at(-1)!)).toEqual(near)
    expect(retained.at(-1)).toEqual(near.map((seq) => `k${seq}|3`))
  })
})
