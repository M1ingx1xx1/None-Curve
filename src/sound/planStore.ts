// The whole-file parameter plan's storage (planner.ts, NOCUR-85): every planned commit of the file, kept compact.
//
// A commit is kept as a record. Its full form (the PlannedCommit the director shows) shares what repeats: each long
// string (paramsKey is about 1 KB) is kept once, each parameter set once per key, each letter frame once per key,
// each look once per content, and each occurrence key list once per content. Past PRECOMPUTE_LIMITS.planMaxBytes
// (an estimate), the records far from the playhead keep only a thin form: what selection, the flash limit and
// decimation read (media time, flash edges, the sliders' own, glyph count) and a hash of what it shows. The planner
// makes a thin stretch full again by planning from the file's start once more (the plan is deterministic) and checks
// the hash. After thinning, the shared tables are rebuilt from the full records a slice at a time (compactStep), so
// a thin never costs a frame more than the planner's slice.

import type { FrameJob, GeometryParams } from '../geometry/types'
import type { LetterFrame } from './letters'
import { compactPlanned, plannedEdges } from './live'
import type { LookChanges } from './mapping'
import type { PlannedCommit } from './timelineTypes'

export interface PlanRecord {
  seq: number
  mediaMs: number
  /** Glyph computations the commit asks for (decimation reads it). */
  glyphs: number
  /** Its flash edges (planner frame times). */
  edges: readonly number[]
  /** The sliders' own (exact restore): always selected. */
  own: boolean
  /** A hash of what it shows (its shared and letters' keys): a re-plan must give the same. */
  hash: number
  /** The full commit, or null when thinned. */
  full: PlannedCommit | null
  /** Bytes its full form takes beyond what it shares (estimate). */
  fullBytes: number
}

/** Heap estimates (bytes): a record, a full commit's own objects, its adopted state. */
const RECORD_BYTES = 120
const COMMIT_BYTES = 400
const ADOPTED_BYTES = 1600
const PARAMS_BYTES = 650
const LETTERS_BYTES = 300
const LOOK_BYTES = 200

/** FNV-1a over a string. */
export function hashText(text: string, h = 0x811c9dc5): number {
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Glyph computations a commit's jobs ask for (a job without indices counts once, as the director always counted). */
export function glyphCount(jobs: readonly FrameJob[]): number {
  let glyphs = 0
  for (const job of jobs) glyphs += job.indices?.length ?? job.within?.size ?? 1
  return glyphs
}

/** The shared values (each kept once) and the bytes they take. */
interface Tables {
  strings: Map<string, string>
  params: Map<string, GeometryParams>
  letters: Map<string, LetterFrame>
  looks: Map<string, LookChanges>
  keyLists: Map<string, readonly string[]>
  keyIds: Map<string, number>
  shared: number
}

const newTables = (): Tables => ({
  strings: new Map(),
  params: new Map(),
  letters: new Map(),
  looks: new Map(),
  keyLists: new Map(),
  keyIds: new Map(),
  shared: 0,
})

export class PlanStore {
  readonly records: PlanRecord[] = []
  private tables = newTables()
  /** The tables being rebuilt after a thin, and the next record to move into them (compactStep). */
  private next: Tables | null = null
  private cursor = 0
  private shownCopies = new WeakMap<object, object>()
  /** Each look's JSON (looks are compared by content; a rebuild does not stringify them again). */
  private lookTexts = new WeakMap<LookChanges, string>()
  private own = 0

  constructor(private readonly base: GeometryParams | null) {}

  /** Bytes held (estimate). */
  bytes(): number {
    return this.tables.shared + this.own
  }

  /** The shared tables are being rebuilt after a thin (bytes() still counts the old ones). */
  compacting(): boolean {
    return this.next !== null
  }

  /** Records whose full form is kept. */
  fullCount(): number {
    let n = 0
    for (const record of this.records) if (record.full) n++
    return n
  }

  /** Adds the next commit of the plan (compacted), with `sharedKey` the key of the parameters it shows. */
  append(commit: PlannedCommit, sharedKey: string): PlanRecord {
    const full = this.compact(commit)
    const fullBytes = COMMIT_BYTES + ADOPTED_BYTES + 64 * commit.jobs.length
    const record: PlanRecord = {
      seq: commit.seq,
      mediaMs: commit.mediaMs,
      glyphs: glyphCount(commit.jobs),
      edges: plannedEdges(full.adopted),
      own: commit.commit === null,
      hash: hashOf(commit, sharedKey),
      full,
      fullBytes,
    }
    this.records.push(record)
    this.own += RECORD_BYTES + fullBytes
    return record
  }

  /** Makes a thinned record full again from a re-planned commit; false when the commit does not match (hash). */
  refill(at: number, commit: PlannedCommit, sharedKey: string): boolean {
    const record = this.records[at]
    if (!record || record.full) return true
    if (record.hash !== hashOf(commit, sharedKey)) return false
    // Behind the rebuild's cursor, it goes into the new tables (the old ones are dropped when the rebuild ends).
    record.full = this.compact(commit, this.next && at < this.cursor ? this.next : this.tables)
    this.own += record.fullBytes
    return true
  }

  /**
   * Thins the full records outside [fromMs, toMs] while the store is over `maxBytes`, farthest first, then forgets
   * the shared values no full record uses any more: at once, or (`deferred`) a slice at a time through compactStep.
   */
  thin(fromMs: number, toMs: number, maxBytes: number, deferred = false): number {
    if (this.bytes() <= maxBytes) return 0
    const records = this.records
    // Records are in media order: the farthest outside the span are at the two ends.
    let i = 0
    let j = records.length - 1
    let thinned = 0
    // Estimates only: thin a quarter beyond the budget, so this does not run again at once.
    const target = 0.75 * maxBytes
    while (this.bytes() > target) {
      while (i < records.length && records[i].mediaMs < fromMs && !records[i].full) i++
      while (j >= 0 && records[j].mediaMs > toMs && !records[j].full) j--
      const left = i < records.length && records[i].mediaMs < fromMs ? fromMs - records[i].mediaMs : -1
      const right = j >= 0 && records[j].mediaMs > toMs ? records[j].mediaMs - toMs : -1
      if (left < 0 && right < 0) break
      const record = left >= right ? records[i++] : records[j--]
      record.full = null
      this.own -= record.fullBytes
      thinned++
    }
    if (!thinned) return 0
    this.next = newTables()
    this.cursor = 0
    if (!deferred) this.compactStep(Infinity, () => 0)
    return thinned
  }

  /**
   * Moves the full records into the tables being rebuilt until page time `deadline` (`now` reads it); the old tables go
   * once every record is moved. True when no rebuild is left.
   */
  compactStep(deadline: number, now: () => number): boolean {
    const next = this.next
    if (!next) return true
    const records = this.records
    while (this.cursor < records.length) {
      const record = records[this.cursor++]
      if (record.full) record.full = this.compact(record.full, next)
      if ((this.cursor & 15) === 0 && now() >= deadline) return false
    }
    this.tables = next
    this.next = null
    return true
  }

  private intern(t: Tables, text: string): string {
    const known = t.strings.get(text)
    if (known !== undefined) return known
    t.strings.set(text, text)
    t.shared += 2 * text.length + 40
    return text
  }

  private internParams(t: Tables, params: GeometryParams, key: string): GeometryParams {
    if (params === this.base) return params
    const known = t.params.get(key)
    if (known) return known
    t.params.set(this.intern(t, key), params)
    t.shared += PARAMS_BYTES
    return params
  }

  private internJob<J extends FrameJob>(t: Tables, job: J): J {
    const key = this.intern(t, job.key)
    const params = this.internParams(t, job.params, key)
    return params === job.params && key === job.key ? job : { ...job, params, key }
  }

  private internLetters(t: Tables, letters: LetterFrame): LetterFrame {
    const known = t.letters.get(letters.key)
    if (known) return known
    const frame: LetterFrame = {
      ...letters,
      keys: letters.keys.map((k) => this.intern(t, k)),
      jobs: letters.jobs.map((job) => this.internJob(t, job)),
      key: this.intern(t, letters.key),
    }
    t.letters.set(frame.key, frame)
    t.shared += LETTERS_BYTES + letters.assign.length
    return frame
  }

  private internLook(t: Tables, look: LookChanges): LookChanges {
    let text = this.lookTexts.get(look)
    if (text === undefined) this.lookTexts.set(look, (text = JSON.stringify(look)))
    const known = t.looks.get(text)
    if (known) return known
    t.looks.set(text, look)
    t.shared += LOOK_BYTES + 2 * text.length
    return look
  }

  private internKeys(t: Tables, keys: readonly string[]): readonly string[] {
    let signature = ''
    for (const key of keys) {
      let id = t.keyIds.get(key)
      if (id === undefined) t.keyIds.set(this.intern(t, key), (id = t.keyIds.size))
      signature += `${id},`
    }
    const known = t.keyLists.get(signature)
    if (known) return known
    const list = keys.map((k) => this.intern(t, k))
    t.keyLists.set(signature, list)
    t.shared += 8 * list.length + 40 + 2 * signature.length
    return list
  }

  private compact(commit: PlannedCommit, t: Tables = this.tables): PlannedCommit {
    const inner = commit.commit
    let compacted: PlannedCommit['commit'] = inner
    if (inner && inner.params) {
      const sharedKey = commit.jobs[0]?.key
      const params =
        sharedKey !== undefined ? this.internParams(t, inner.params, this.intern(t, sharedKey)) : inner.params
      const letters = inner.letters ? this.internLetters(t, inner.letters) : null
      const look = inner.look ? this.internLook(t, inner.look) : null
      if (params !== inner.params || letters !== inner.letters || look !== inner.look)
        compacted = inner.keyframes ? { params, letters, look, keyframes: inner.keyframes } : { params, letters, look }
    }
    return {
      ...commit,
      commit: compacted,
      jobs: commit.jobs.map((job) => this.internJob(t, job)),
      keys: this.internKeys(t, commit.keys),
      adopted: compactPlanned(commit.adopted, (text) => this.intern(t, text), this.shownCopies),
    }
  }
}

function hashOf(commit: PlannedCommit, sharedKey: string): number {
  const letters = commit.commit?.letters?.key ?? ''
  return hashText(letters, hashText(sharedKey, hashText(commit.commit === null ? 'own' : 'driven')))
}
