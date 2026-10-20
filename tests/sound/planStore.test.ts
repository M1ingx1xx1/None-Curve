// The whole-file plan's storage (src/sound/planStore.ts, NOCUR-85): records share what repeats (key strings, parameter
// sets, key lists), thin far from the playhead past a byte budget (keeping what selection, the flash limit and
// decimation read), and take a re-planned commit back only when it shows the same (hash).

import { describe, expect, it } from 'vitest'
import type { GeometryParams } from '../../src/geometry/types'
import type { Mapping } from '../../src/sound/mapping'
import { NO_SLOTS } from '../../src/sound/letters'
import type { LiveInputs } from '../../src/sound/live'
import { PlaybackPlanner } from '../../src/sound/planner'
import { glyphCount, hashText, PlanStore } from '../../src/sound/planStore'
import { PRECOMPUTE_LIMITS, type PlannedCommit } from '../../src/sound/timelineTypes'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { BASE as DEFAULTS } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }
const HZ = PRECOMPUTE_LIMITS.gridHz
const mapping: Mapping = { id: 'm', enabled: true, feature: 'level', target: 'distortion.amount', depth: 1 }

/** The planned commits of `seconds` of a level switching between two values (so keys repeat). */
function commitsOf(seconds: number): PlannedCommit[] {
  const frames: FeatureFrame[] = Array.from({ length: seconds * HZ }, (_, k) => {
    const level = Math.floor(k / 9) % 2 ? 0.9 : 0.2
    return { ...SILENT_FRAME, time: (k * 1000) / HZ, level, silent: false, levelDb: -20 }
  })
  const planner = new PlaybackPlanner({ hz: HZ, frameCount: () => frames.length, isCovered: () => true, frameAt: (i) => frames[i] ?? null })
  const inputs: LiveInputs = { base: BASE, hasFont: true, mappings: [mapping], drive: true, response: NEUTRAL_RESPONSE, slots: NO_SLOTS }
  planner.setInputs(inputs)
  planner.ensure(Infinity, Infinity)
  return planner.range(-Infinity, Infinity).slice()
}

const sharedKeyOf = (commit: PlannedCommit) => commit.jobs[0]?.key ?? 'own'

/** Plain copies (nothing shared with the planner's store). */
const copyOf = (commit: PlannedCommit): PlannedCommit => ({
  ...commit,
  jobs: commit.jobs.map((job) => ({ ...job, key: (' ' + job.key).slice(1), params: structuredClone(job.params) })),
  keys: commit.keys.map((k) => (' ' + k).slice(1)),
})

describe('the plan store', () => {
  const commits = commitsOf(4)

  it('shares the key strings and parameter sets that repeat', () => {
    const store = new PlanStore(BASE)
    for (const commit of commits) store.append(copyOf(commit), sharedKeyOf(commit))
    expect(store.fullCount()).toBe(commits.length)
    const byKey = new Map<string, { key: string; params: GeometryParams }>()
    let repeats = 0
    for (const record of store.records) {
      for (const job of record.full!.jobs) {
        const known = byKey.get(job.key)
        if (!known) byKey.set(job.key, job)
        else {
          repeats++
          expect(job.params).toBe(known.params)
          expect(job.key).toBe(known.key)
        }
      }
    }
    expect(repeats).toBeGreaterThan(0)
    expect(store.records.map((r) => r.mediaMs)).toEqual(commits.map((c) => c.mediaMs))
    expect(store.records.map((r) => r.glyphs)).toEqual(commits.map((c) => glyphCount(c.jobs)))
  })

  it('thins the records far outside the window past its budget, farthest first, and takes back only the same commit', () => {
    const store = new PlanStore(BASE)
    for (const commit of commits) store.append(copyOf(commit), sharedKeyOf(commit))
    const before = store.bytes()
    const edges = store.records.map((r) => r.edges)
    expect(store.thin(0, 4000, before)).toBe(0)
    const thinned = store.thin(0, 500, 0.6 * before)
    expect(thinned).toBeGreaterThan(0)
    expect(store.bytes()).toBeLessThanOrEqual(0.75 * 0.6 * before + 1)
    // The farthest went: every thinned record is later than every full one past the window.
    const lastFull = Math.max(...store.records.filter((r) => r.full).map((r) => r.mediaMs))
    const firstThin = Math.min(...store.records.filter((r) => !r.full).map((r) => r.mediaMs))
    expect(firstThin).toBeGreaterThan(lastFull)
    // What selection and the flash limit read stays.
    expect(store.records.map((r) => r.edges)).toEqual(edges)
    const at = store.records.findIndex((r) => !r.full)
    const commit = commits[at]
    expect(store.refill(at, copyOf(commit), 'another key')).toBe(false)
    expect(store.records[at].full).toBeNull()
    expect(store.refill(at, copyOf(commit), sharedKeyOf(commit))).toBe(true)
    expect(store.records[at].full!.keys).toEqual(commit.keys)
  })

  it('hashes text with FNV-1a', () => {
    expect(hashText('')).toBe(0x811c9dc5)
    expect(hashText('a')).toBe(0xe40c292c)
    expect(hashText('ab')).toBe(hashText('b', hashText('a')))
  })
})
