// Which planned commits the screen shows, and each letter's glide history through them, for the director
// (director.ts) and the geometry pool's chains (state/aheadTypes.ts).
//
// Selection (decimation): when the geometry cannot keep up with every planned commit (30 a second at most), the
// director shows every 2nd, 3rd or 4th one's worth (15, 10, 7.5 Hz) by media time. A commit is never dropped when it
// carries a flash edge (the budget counted it), when it is the sliders' own (exact restore), or when it stays on screen
// for a whole step (nothing replaces it soon). Otherwise the first commit of each step on the media grid is kept, so a
// commit's choice depends only on it and its neighbours: it stays as later commits arrive and older ones are pruned.
//
// Lineages: an occurrence's glide history is the run of glyphs (key and glyph id) it showed at the selected commits.
// Each (parent lineage, key, glyph id) gets one id, so occurrences with the same history share one, and the worker
// steps each lineage's glide once. A history starts afresh (parent −1) at the first selected commit of a run.

import { LIVE_LIMITS, plannedEdges } from './live'
import { PRECOMPUTE_LIMITS, type PlannedCommit } from './timelineTypes'

/** Show every n-th commit's worth: 30, 15, 10 and 7.5 Hz. */
export const DECIMATION_LEVELS = [1, 2, 3, 4] as const

/** Planned commits sit on the 60 Hz grid; spacing is checked a little under a step. */
const SPACING_SLACK_MS = 1

/** Commits that are always shown: a flash edge, or the sliders' own. */
function mandatory(commit: PlannedCommit): boolean {
  return commit.commit === null || plannedEdges(commit.adopted).length > 0
}

/**
 * The commits shown at decimation `level` (1–4), in media order: the first, then the first of each step on the media
 * grid (level 30 Hz frames, counted from media time 0), each mandatory one, and each one nothing replaces within a step.
 */
export function selectCommits(commits: readonly PlannedCommit[], level: number): PlannedCommit[] {
  if (level <= 1) return commits.slice()
  // live.ts is read here, not at load: it imports this module through the director.
  const step = (level * 1000) / LIVE_LIMITS.maxFps - SPACING_SLACK_MS
  /** Grid frames (PRECOMPUTE_LIMITS.gridHz) per step: planned commits sit on that grid. */
  const frames = (level * PRECOMPUTE_LIMITS.gridHz) / LIVE_LIMITS.maxFps
  const stepOf = (commit: PlannedCommit) => Math.floor(Math.round((commit.mediaMs * PRECOMPUTE_LIMITS.gridHz) / 1000) / frames)
  const out: PlannedCommit[] = []
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    const prev = commits[i - 1]
    const next = commits[i + 1]
    const keep = !prev || stepOf(commit) !== stepOf(prev) || mandatory(commit) || !next || next.mediaMs - commit.mediaMs >= step
    if (keep) out.push(commit)
  }
  return out
}

/**
 * Lineage ids by (parent, key, glyph id), kept per selected commit so the old ones can go. The same inputs always give
 * the same id; a root (parent −1) is also told apart by its commit.
 */
export class LineageBook {
  private bySeq = new Map<number, Map<string, number>>()
  private next = 0
  /** Lineages per selected commit (reading order), with the selected commit before it (−1: a root). */
  private made = new Map<number, { prevSeq: number; lineage: Int32Array }>()

  /**
   * The lineages of `commit`'s occurrences after the selected commit `prevSeq` (−1: none, every history starts here).
   * Remembered: asked again with the same predecessor, the same array comes back.
   */
  lineagesOf(commit: PlannedCommit, prevSeq: number): Int32Array {
    const known = this.made.get(commit.seq)
    if (known && known.prevSeq === prevSeq && known.lineage.length === commit.keys.length) return known.lineage
    const parents = prevSeq >= 0 ? this.made.get(prevSeq)?.lineage : undefined
    let nodes = this.bySeq.get(commit.seq)
    if (!nodes) this.bySeq.set(commit.seq, (nodes = new Map()))
    const n = commit.keys.length
    const lineage = new Int32Array(n)
    // Keys are long (paramsKey): within a commit each gets a small number; nodes are kept per commit anyway.
    const keyIds = new Map<string, number>()
    for (let j = 0; j < n; j++) {
      const parent = parents && parents.length === n ? parents[j] : -1
      let keyId = keyIds.get(commit.keys[j])
      if (keyId === undefined) keyIds.set(commit.keys[j], (keyId = keyIds.size))
      const node = `${parent < 0 ? `r${commit.seq}` : parent}|${keyId}|${commit.indices[j]}`
      let id = nodes.get(node)
      if (id === undefined) {
        id = this.next++
        nodes.set(node, id)
      }
      lineage[j] = id
    }
    this.made.set(commit.seq, { prevSeq, lineage })
    return lineage
  }

  /** The selected commit `seq`'s lineages were made after (−1: a root), or undefined when none were made. */
  prevOf(seq: number): number | undefined {
    return this.made.get(seq)?.prevSeq
  }

  /** The parent of each lineage made at `seq` (−1 for a root), by lineage id. */
  parentsAt(seq: number): Map<number, number> {
    const out = new Map<number, number>()
    for (const [node, id] of this.bySeq.get(seq) ?? []) {
      const parent = node.startsWith('r') ? -1 : Number(node.slice(0, node.indexOf('|')))
      out.set(id, parent)
    }
    return out
  }

  /** Commits before `seq` will not be selected again: their lineages go. */
  release(beforeSeq: number) {
    for (const seq of this.bySeq.keys()) if (seq < beforeSeq) this.bySeq.delete(seq)
    for (const seq of this.made.keys()) if (seq < beforeSeq) this.made.delete(seq)
  }

  clear() {
    this.bySeq.clear()
    this.made.clear()
  }
}

/**
 * The distinct glide steps of a selected commit (one per lineage): its glyph and the lineage it continues. `lineage`
 * comes from LineageBook.lineagesOf for this commit.
 */
export function stepsOf(commit: PlannedCommit, lineage: Int32Array, parents: ReadonlyMap<number, number>): { lineage: number; parent: number; index: number; key: string }[] {
  const seen = new Set<number>()
  const steps: { lineage: number; parent: number; index: number; key: string }[] = []
  for (let j = 0; j < lineage.length; j++) {
    const id = lineage[j]
    if (seen.has(id)) continue
    seen.add(id)
    steps.push({ lineage: id, parent: parents.get(id) ?? -1, index: commit.indices[j], key: commit.keys[j] })
  }
  return steps
}
