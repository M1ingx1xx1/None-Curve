// Selection and glide lineages (src/sound/lineage.ts): the same glyph history gives the same lineage id and a diverging
// one a new id; decimation at 30, 15, 10 and 7.5 Hz keeps media order, never drops a flash edge or the sliders' own, and
// keeps a commit nothing replaces soon; each lineage's parent is its history one selected commit before.

import { describe, expect, it } from 'vitest'
import { DECIMATION_LEVELS, LineageBook, selectCommits, stepsOf } from '../../src/sound/lineage'
import type { AdoptedState, PlannedCommit } from '../../src/sound/timelineTypes'

const STEP = 1000 / 30

/** A planned commit: keys and glyph ids per occurrence; `edges` makes it carry flash edges, `restore` the sliders' own. */
function commit(
  seq: number,
  mediaMs: number,
  keys: string[],
  options: { edges?: number[]; restore?: boolean; indices?: number[] } = {},
): PlannedCommit {
  const adopted = { brand: 'adopted', edges: options.edges ?? [] } as unknown as AdoptedState
  return {
    generation: 1,
    seq,
    mediaMs,
    commit: options.restore ? null : { params: null, letters: null, look: null },
    jobs: [],
    keys,
    indices: Int32Array.from(options.indices ?? keys.map((_, j) => j % 2)),
    adopted,
  }
}

describe('lineages', () => {
  it('gives the same history the same id and a diverging history a new one', () => {
    const book = new LineageBook()
    // Four occurrences: 0 and 2 show glyph 0, 1 and 3 glyph 1; at seq 2, occurrence 2 takes another key.
    const c1 = commit(1, 0, ['a', 'a', 'a', 'a'])
    const c2 = commit(2, STEP, ['b', 'b', 'c', 'b'])
    const c3 = commit(3, 2 * STEP, ['d', 'd', 'd', 'd'])
    const l1 = book.lineagesOf(c1, -1)
    expect(l1[0]).toBe(l1[2])
    expect(l1[1]).toBe(l1[3])
    expect(l1[0]).not.toBe(l1[1])
    const l2 = book.lineagesOf(c2, 1)
    expect(l2[1]).toBe(l2[3])
    expect(l2[0]).not.toBe(l2[2])
    const l3 = book.lineagesOf(c3, 2)
    // Same key now, but the histories differ: still apart.
    expect(l3[0]).not.toBe(l3[2])
    expect(l3[1]).toBe(l3[3])
    // Asked again: the same ids.
    expect(book.lineagesOf(c2, 1)).toBe(l2)
    const again = new LineageBook()
    again.lineagesOf(c1, -1)
    expect(Array.from(again.lineagesOf(c2, 1))).toEqual(
      Array.from(l2).map((id) => id - l2[0] + again.lineagesOf(c2, 1)[0]),
    )
  })

  it('names each lineage’s parent, and steps each lineage once', () => {
    const book = new LineageBook()
    const c1 = commit(1, 0, ['a', 'a', 'a', 'a'])
    const c2 = commit(2, STEP, ['b', 'b', 'c', 'b'])
    const l1 = book.lineagesOf(c1, -1)
    const l2 = book.lineagesOf(c2, 1)
    const roots = stepsOf(c1, l1, book.parentsAt(1))
    expect(roots).toEqual([
      { lineage: l1[0], parent: -1, index: 0, key: 'a' },
      { lineage: l1[1], parent: -1, index: 1, key: 'a' },
    ])
    const steps = stepsOf(c2, l2, book.parentsAt(2))
    expect(steps).toEqual([
      { lineage: l2[0], parent: l1[0], index: 0, key: 'b' },
      { lineage: l2[1], parent: l1[1], index: 1, key: 'b' },
      { lineage: l2[2], parent: l1[2], index: 0, key: 'c' },
    ])
    // A root at another commit is another lineage, even for the same glyph and key.
    const c5 = commit(5, 4 * STEP, ['a', 'a', 'a', 'a'])
    expect(book.lineagesOf(c5, -1)[0]).not.toBe(l1[0])
    book.release(2)
    expect(book.parentsAt(1).size).toBe(0)
    expect(book.parentsAt(2).size).toBe(3)
  })
})

describe('selection', () => {
  const steady = Array.from({ length: 31 }, (_, i) => commit(i + 1, i * STEP, ['k' + i]))

  it.each(DECIMATION_LEVELS.map((level) => [level]))('keeps media order and the spacing at level %i', (level) => {
    const selected = selectCommits(steady, level)
    for (let i = 1; i < selected.length; i++) expect(selected[i].mediaMs).toBeGreaterThan(selected[i - 1].mediaMs)
    // Every step's worth, and the last (nothing replaces it).
    const inner = selected.slice(0, -1)
    for (let i = 1; i < inner.length; i++) expect(inner[i].mediaMs - inner[i - 1].mediaMs).toBeCloseTo(level * STEP, 6)
    expect(selected[0]).toBe(steady[0])
    expect(selected.at(-1)).toBe(steady.at(-1))
    expect(selected.length).toBe(Math.floor(30 / level) + 1 + (30 % level ? 1 : 0))
  })

  it('never drops a flash edge, the sliders’ own, or a commit that stays on screen', () => {
    const commits = [
      commit(1, 0, ['a']),
      commit(2, STEP, ['b'], { edges: [STEP] }),
      commit(3, 2 * STEP, ['c']),
      commit(4, 3 * STEP, ['d'], { restore: true }),
      commit(5, 4 * STEP, ['e']),
      // Nothing comes for half a second: 6 stays on screen.
      commit(6, 5 * STEP, ['f']),
      commit(7, 5 * STEP + 500, ['g']),
      commit(8, 6 * STEP + 500, ['h']),
      commit(9, 7 * STEP + 500, ['i']),
    ]
    const seqs = selectCommits(commits, 4).map((c) => c.seq)
    expect(seqs).toEqual(expect.arrayContaining([1, 2, 4, 6, 9]))
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(seqs).not.toContain(3)
    expect(seqs).not.toContain(8)
  })

  it('keeps its choice near the start as later commits arrive', () => {
    const early = selectCommits(steady.slice(0, 20), 3).filter((c) => c.seq < 15)
    const later = selectCommits(steady, 3).filter((c) => c.seq < 15)
    expect(later).toEqual(early)
  })

  it.each([2, 3, 4])('keeps its choice as older commits are pruned (level %i)', (level) => {
    const all = selectCommits(steady, level).slice(1)
    for (let drop = 1; drop < 8; drop++) {
      // The first commit left is always kept; every later choice stays.
      const pruned = selectCommits(steady.slice(drop), level).slice(1)
      expect(pruned.filter((c) => c.seq > steady[drop].seq)).toEqual(all.filter((c) => c.seq > steady[drop].seq))
    }
  })
})
