// Thorn turns (THORN_TURNS; turnGroups, ThornTurns in src/sound/letters.ts, the live scheduler in src/sound/live.ts):
// while Sound drives the letters with Thorn on, their thorns change a few letters at a time. The letters fall into five
// groups of whole glyph ids (some empty when fewer than five letters are drawn); a turn hands the live turn state
// (Thorn's sliders, the Experimental seed and every other setting that moves the thorns: isTurnTarget) to the next
// group, at most one group every 250 ms after the last turn reached the screen, so a letter's thorns change at most once
// every 1.25 s, however short the text, and at most about a fifth of the letters every 250 ms. A large turn takes from
// the flash budget, and waits when it is spent. Per-letter levels never scale the turn targets while Thorn is on. With
// Thorn off nothing changes: the scheduler's frames are pinned to those of develop before Thorn turns (f4483b5).

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/cache'
import type { FrameJob, GeometryParams } from '../../src/geometry/types'
import {
  isThornTarget,
  isTurnTarget,
  letterLevels,
  letterSlots,
  levelKeyAt,
  levelPosition,
  levelSets,
  QUIET,
  sameThornState,
  SHARED,
  STRONG,
  thornDiffers,
  thornState,
  ThornTurns,
  turnGroups,
  turnSwing,
  withThornState,
  type LetterSlots,
  type ThornState,
} from '../../src/sound/letters'
import { LiveScheduler, type LiveCommit, type LiveDeps } from '../../src/sound/live'
import { modulate, targetById, TARGETS, type Mapping } from '../../src/sound/mapping'
import { PRESETS, presetSettings } from '../../src/sound/presets'
import { FLASH_LIMITS } from '../../src/sound/flash'
import { NEUTRAL_RESPONSE, SILENT_FRAME, THORN_TURNS, type FeatureFrame, type ResponseSettings } from '../../src/sound/types'
import { DEFAULT_TEXT } from '../../src/specimen/samples'
import { shapeSpecimen } from '../../src/specimen/scene'
import { shownGlyphs } from '../../src/state/geometryClient'
import { loadFixture } from '../helpers/fonts'
import { BASE as DEFAULTS, on } from '../helpers/params'

const BASE: GeometryParams = { ...DEFAULTS, distortion: { ...DEFAULTS.distortion, amount: 10 } }
/** Thorn on as Flare starts it. */
const THORN_ON: GeometryParams = { ...BASE, experimental: { ...BASE.experimental, ...on('thorn', { count: 1, canvasReach: 0, root: 0.25 }) } }

const REACH = targetById('experimental.thorn.canvasReach')!
const SPREAD = targetById('experimental.thorn.spread')!
const DISTORTION = targetById('distortion.amount')!
const THORN_IDS = TARGETS.filter((t) => isThornTarget(t.id)).map((t) => t.id)

const row = (target: string, depth: number, feature: Mapping['feature'] = 'level'): Mapping => ({ id: `${target} ${feature}`, enabled: true, feature, target, depth })
const response = (patch: Partial<ResponseSettings>): ResponseSettings => ({ ...NEUTRAL_RESPONSE, ...patch })

/** The params with these Thorn settings and Experimental seed. */
function thornWith(params: GeometryParams, patch: Partial<NonNullable<GeometryParams['experimental']['thorn']>>, seed = params.experimental.seed): GeometryParams {
  return { ...params, experimental: { ...params.experimental, seed, thorn: { ...params.experimental.thorn!, ...patch } } }
}
const seedState = (seed: number): ThornState => thornState(thornWith(THORN_ON, {}, seed))
/** Thorn's own state with Spread `dp` of its travel away (Spread moves in steps of 5%). */
const spreadState = (dp: number): ThornState => thornState(SPREAD.set(THORN_ON, SPREAD.fromSlider(SPREAD.toSlider(SPREAD.get(THORN_ON)) + dp)))
/** Thorn with Reach half way along its (cubic, finely stepped) slider. */
const MID_REACH = thornWith(THORN_ON, { canvasReach: 0.125 })
/** MID_REACH's Thorn state with Reach `dp` of its travel away. */
const reachState = (dp: number): ThornState => thornState(REACH.set(MID_REACH, REACH.fromSlider(REACH.toSlider(REACH.get(MID_REACH)) + dp)))

/** `count` letters across one line, glyph ids cycling through `ids`, every sixth a space. */
function lettersOf(count: number, ids = 8): LetterSlots {
  const active = Array.from({ length: count }, (_, j) => (j % 6 === 5 ? 0 : 1))
  const activeCount = active.filter(Boolean).length
  return {
    count,
    index: Int32Array.from({ length: count }, (_, j) => (active[j] ? j % ids : 99)),
    t: Float32Array.from({ length: count }, (_, j) => (j + 0.5) / count),
    share: Float32Array.from(active, (a) => (a ? 1 / activeCount : 0)),
    active: Uint8Array.from(active),
    activeCount,
  }
}

/** One drawn letter per glyph id, in reading order, each the same size. */
function lettersOfIds(ids: readonly number[]): LetterSlots {
  const n = ids.length
  return {
    count: n,
    index: Int32Array.from(ids),
    t: Float32Array.from(ids, (_, j) => (j + 0.5) / n),
    share: Float32Array.from(ids, () => 1 / n),
    active: Uint8Array.from(ids, () => 1),
    activeCount: n,
  }
}

/** The turn groups of each glyph id, and how many letters each group holds. */
function groupsByGlyph(slots: LetterSlots) {
  const groups = turnGroups(slots)
  const of = new Map<number, Set<number>>()
  const occurrences = new Map<number, number>()
  const sizes = new Array<number>(groups.count).fill(0)
  for (let j = 0; j < slots.count; j++) {
    if (!slots.active[j]) continue
    const id = slots.index[j]
    if (!of.has(id)) of.set(id, new Set())
    of.get(id)!.add(groups.of[j])
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1)
    sizes[groups.of[j]]++
  }
  return { groups, of, occurrences, sizes }
}

/** mulberry32: uniform in [0, 1). */
function random(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A sounding frame at `time` with every feature from `rand`, an onset in about `onsets` of the frames. */
function soundFrame(rand: () => number, time: number, onsets = 1 / 6): FeatureFrame {
  const level = rand()
  const onset = rand() < onsets
  return {
    ...SILENT_FRAME,
    time,
    levelDb: -20,
    level,
    swell: rand(),
    bass: rand(),
    mids: rand(),
    treble: rand(),
    brightness: rand(),
    pitch: rand(),
    pitchConfidence: rand(),
    beat: onset ? 1 : rand() / 2,
    activity: rand(),
    onset,
    silent: false,
  }
}

/**
 * Music with a beat: an onset on each beat (`bpm` a minute, one in eight left out), the level and bands leaping on it
 * and dying away within about a fifth of a second, the pitch and brightness wandering. Frames at `time` in order.
 */
function beatStream(seed: number, bpm = 120): (time: number) => FeatureFrame {
  const rand = random(seed)
  let beat = -1
  let env = 0
  let pitch = 0.5
  let bright = 0.5
  const wander = (x: number) => Math.min(1, Math.max(0, x + (rand() - 0.5) * 0.04))
  return (time) => {
    const at = Math.floor(time / (60_000 / bpm))
    const onset = at !== beat && rand() >= 1 / 8
    beat = at
    env = onset ? 1 : env * 0.9
    pitch = wander(pitch)
    bright = wander(bright)
    const level = 0.15 + 0.75 * env + 0.05 * rand()
    return {
      ...SILENT_FRAME,
      time,
      levelDb: -30 + 20 * level,
      level,
      swell: 0.3 + 0.4 * env,
      bass: 0.1 + 0.8 * env,
      mids: 0.3 + 0.3 * env,
      treble: bright * 0.6,
      brightness: bright,
      pitch,
      pitchConfidence: 0.8,
      beat: onset ? 1 : env / 2,
      activity: 0.4 + 0.3 * env,
      onset,
      silent: false,
    }
  }
}

/**
 * The live scheduler on a fake clock: a request computes the (key, glyph) pairs it lacks in 1 ms each plus 4 ms, React
 * renders a commit in 2 ms. A job without indices asks for the glyphs the letters of `slots` draw (with `within`, only
 * the first of them and those in `within`, as the page's client does: shownGlyphs).
 */
function rig(slots: LetterSlots) {
  let now = 0
  let running = true
  let computing = false
  let nextId = 1
  const shown = [...new Set([...slots.index].filter((_, j) => slots.active[j]))]
  const timers: { at: number; id: number; run: () => void }[] = []
  const later = (ms: number, run: () => void) => {
    const id = nextId++
    timers.push({ at: now + Math.max(0, ms), id, run })
    return id
  }
  const known = new Set<string>()
  const asked: { at: number; jobs: readonly FrameJob[]; computed: number }[] = []
  const commits: { at: number; commit: LiveCommit | null }[] = []
  const deps: LiveDeps = {
    now: () => now,
    sourceRunning: () => running,
    isComputing: () => computing,
    request: (jobs) => {
      for (const job of jobs) expect(job.key).toBe(paramsKey(job.params))
      const missing = jobs.flatMap((job) => (job.indices ?? shownGlyphs(shown, job.within)).map((i) => `${job.key}|${i}`)).filter((pair) => !known.has(pair))
      asked.push({ at: now, jobs, computed: missing.length })
      if (!missing.length) return false
      computing = true
      later(4 + missing.length, () => {
        computing = false
        for (const pair of missing) known.add(pair)
        live.idle()
      })
      return true
    },
    commit: (commit) => {
      // A live frame reaches React only once every letter's glyph is known: the shared set's for the letters that show it.
      const letters = commit?.letters
      const sharedShown = shownGlyphs(shown, letters?.sharedGlyphs ?? undefined)
      if (commit?.params) for (const index of sharedShown) expect(known.has(`${paramsKey(commit.params)}|${index}`)).toBe(true)
      if (letters) letters.assign.forEach((k, j) => k !== SHARED && expect(known.has(`${letters.keys[k]}|${letters.slots.index[j]}`)).toBe(true))
      commits.push({ at: now, commit })
      if (commit) later(2, () => live.rendered(commit.seq))
    },
    pauseSound: () => {
      running = false
      live.sourceChanged()
    },
    setTimer: (run, ms) => later(ms, run),
    clearTimer: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
  }
  const live = new LiveScheduler(deps)
  const advance = (to: number) => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = timers[0]
      if (!next || next.at > to) break
      timers.shift()
      now = Math.max(now, next.at)
      next.run()
    }
    now = Math.max(now, to)
  }
  return {
    live,
    asked,
    commits,
    advance,
    get now() {
      return now
    },
    /** Frames every 1/60 s until `until`. */
    play(until: number, frameAt: (t: number) => FeatureFrame) {
      for (let t = now; t <= until; t += 1000 / 60) {
        advance(t)
        live.setFrame(frameAt(t))
      }
      advance(until)
    },
    setRunning(value: boolean) {
      running = value
      live.sourceChanged()
    },
  }
}

/**
 * Thorn's settings (but canvasEm, which follows the canvas) and the values of every turn target (thornState: the
 * Experimental seed, Geometry before Distortion, the warps' shapes), as one string.
 */
function thornOf(params: GeometryParams): string {
  const { canvasEm: _canvasEm, ...thorn } = params.experimental.thorn ?? {}
  return JSON.stringify([thorn, thornState(params).values])
}

/** What each drawn letter shows at a commit: its parameter set's key, and its turn state (thornOf). */
function lettersAt(commit: LiveCommit | null, slots: LetterSlots, base: GeometryParams) {
  const params = commit?.params ?? base
  const key = paramsKey(params)
  const byKey = new Map<string, GeometryParams>([[key, params]])
  for (const job of commit?.letters?.jobs ?? []) byKey.set(job.key, job.params)
  const thorns = new Map<string, string>()
  const keys: string[] = []
  const states: string[] = []
  for (let j = 0; j < slots.count; j++) {
    if (!slots.active[j]) continue
    const at = levelKeyAt(commit?.params ? (commit.letters ?? null) : null, j, key)
    if (!thorns.has(at)) thorns.set(at, thornOf(byKey.get(at)!))
    keys.push(at)
    states.push(thorns.get(at)!)
  }
  return { byKey, keys, states }
}

/** The drawn letters (their positions among the drawn ones) whose Thorn settings change from one commit to the next. */
function thornChanges(commits: readonly { at: number; commit: LiveCommit | null }[], slots: LetterSlots, base: GeometryParams) {
  const changes: { at: number; letters: number[] }[] = []
  let before: string[] | null = null
  for (const { at, commit } of commits) {
    const { states } = lettersAt(commit, slots, base)
    if (before) {
      const was = before
      const letters = states.flatMap((state, i) => (state !== was[i] ? [i] : []))
      if (letters.length) changes.push({ at, letters })
    }
    before = states
  }
  return changes
}

/**
 * Every slider and seed in `params` is one the panel could set: within its range, and on its step or at the sliders'
 * own value (as modulate keeps it); a seed a whole number. Returns the targets that are not.
 */
function outOfRange(params: GeometryParams, own: GeometryParams): string[] {
  return TARGETS.filter((spec) => {
    const value = spec.get(params)
    if (!(value >= spec.min && value <= spec.max)) return true
    if (spec.kind === 'jump') return !Number.isInteger(value)
    return value !== spec.get(own) && spec.fromSlider(spec.toSlider(value)) !== value
  }).map((spec) => `${spec.id}=${spec.get(params)}`)
}

/** FNV-1a (32 bits) over UTF-16 code units; each part ends with a separator. */
function fnv1a() {
  let h = 0x811c9dc5
  const unit = (u: number) => {
    h ^= u & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= u >>> 8
    h = Math.imul(h, 0x01000193)
  }
  return {
    add(part: string) {
      for (let i = 0; i < part.length; i++) unit(part.charCodeAt(i))
      unit(0x1f)
    },
    get hex() {
      return (h >>> 0).toString(16).padStart(8, '0')
    },
  }
}

const FLARE = PRESETS.find((preset) => preset.id === 'flare')!
const FLARE_MAPPINGS: Mapping[] = FLARE.mappings.map((mapping, i) => ({ ...mapping, id: `flare ${i}` }))
/** Flare with Level driving Distortion's amount: every frame moves the outline Thorn grows from. */
const FLARE_DISTORTION: Mapping[] = [...FLARE_MAPPINGS, row('distortion.amount', 0.3)]
const FLARE_BASE: GeometryParams = (() => {
  const params = presetSettings(BASE, FLARE).params
  return { ...params, distortion: { ...params.distortion, amount: 20 } }
})()

describe('turnGroups', () => {
  it('makes five groups of at most ceil(N / 5) letters, splitting glyphs over at most four extra groups in all', () => {
    for (const slots of [lettersOf(40), lettersOf(97, 13), lettersOf(300, 31), lettersOfIds([...Array(25).keys()])]) {
      const { groups, of, sizes } = groupsByGlyph(slots)
      expect(groups.count).toBe(THORN_TURNS.groups)
      expect(groups.capacity).toBe(Math.ceil(slots.activeCount / THORN_TURNS.groups))
      expect(sizes.reduce((a, b) => a + b)).toBe(slots.activeCount)
      expect([...groups.letters]).toEqual(sizes)
      for (const size of sizes) expect(size).toBeLessThanOrEqual(groups.capacity)
      // A glyph is split only when it fits whole in no group, and each piece but the last fills a group: at most four
      // (glyph, group) pairs beyond one per glyph, which is all the extra a group's job can ask for.
      let extra = 0
      for (const [, set] of of) extra += set.size - 1
      expect(extra).toBeLessThanOrEqual(THORN_TURNS.groups - 1)
      let share = 0
      groups.share.forEach((s, g) => {
        let sum = 0
        for (let j = 0; j < slots.count; j++) if (slots.active[j] && groups.of[j] === g) sum += slots.share[j]
        expect(s).toBeCloseTo(sum, 12)
        share += s
      })
      expect(share).toBeCloseTo(1, 6)
    }
  })

  it('keeps every glyph whole unless it fits whole in no group', async () => {
    // Seven of one glyph, two to a group: it fills three groups and part of a fourth; the other glyph stays whole.
    const many = groupsByGlyph(lettersOfIds([0, 0, 0, 0, 0, 0, 0, 1]))
    expect(many.groups.capacity).toBe(2)
    expect(many.of.get(0)!.size).toBe(4)
    expect(many.of.get(1)!.size).toBe(1)
    for (const size of many.sizes) expect(size).toBeLessThanOrEqual(2)
    // Six glyphs of two letters and one of one, three to a group: five pairs fill a group each to 2, so the sixth pair
    // fits whole in none and is split over two; the single letter fills the last place.
    const pairs = groupsByGlyph(lettersOfIds([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6]))
    expect(pairs.groups.capacity).toBe(3)
    expect([...pairs.of.values()].filter((set) => set.size > 1).map((set) => set.size)).toEqual([2])
    expect(pairs.sizes.sort()).toEqual([2, 2, 3, 3, 3])
    // A real text, with many glyphs of many sizes: every glyph whole.
    const font = await loadFixture('Roboto')
    const text = groupsByGlyph(letterSlots(shapeSpecimen(font, DEFAULT_TEXT)))
    expect(text.groups.count).toBe(5)
    for (const [, set] of text.of) expect(set.size).toBe(1)
    for (const size of text.sizes) expect(size).toBeLessThanOrEqual(text.groups.capacity)
  })

  it('spreads each group across the text rather than sweeping it in reading order', () => {
    const slots = lettersOfIds([...Array(25).keys()])
    const { groups } = groupsByGlyph(slots)
    for (let g = 0; g < groups.count; g++) {
      const at = [...groups.of].flatMap((k, j) => (k === g ? [j] : []))
      // Not a run of neighbours: each group's letters lie over a good part of the line.
      expect(at[at.length - 1] - at[0]).toBeGreaterThanOrEqual(8)
    }
  })

  it('gives five groups however few letters are drawn, one letter each and the rest empty, and none without letters', () => {
    for (const n of [1, 2, 4]) {
      const { groups, sizes } = groupsByGlyph(lettersOfIds([...Array(n).keys()]))
      // Five groups, so a letter still turns at most once every five turns (THORN_TURNS); the empty ones pass time.
      expect(groups.count).toBe(THORN_TURNS.groups)
      expect(groups.capacity).toBe(1)
      expect([...sizes].sort()).toEqual([...new Array(THORN_TURNS.groups - n).fill(0), ...new Array(n).fill(1)])
      expect([...groups.letters]).toEqual(sizes)
    }
    const none = turnGroups({ ...lettersOfIds([0]), active: Uint8Array.of(0), share: Float32Array.of(0), activeCount: 0 })
    expect(none.count).toBe(0)
  })

  it('gives the same letters set differently the same groups (their shares follow)', () => {
    const slots = lettersOf(60, 12)
    const restyled: LetterSlots = { ...slots, t: slots.t.map((t) => t * 0.8), share: slots.share.map((s, j) => (s ? (j + 1) / 1830 : 0)) }
    expect(turnGroups(slots)).toBe(turnGroups(slots))
    expect([...turnGroups(restyled).of]).toEqual([...turnGroups(slots).of])
    expect(turnGroups(restyled).share).not.toEqual(turnGroups(slots).share)
  })
})

describe('Thorn state', () => {
  it('levels never scale Thorn sliders or the Experimental seed; they still scale every other slider', () => {
    const base = thornWith(THORN_ON, { canvasReach: 0.05, spread: 0.3 })
    const mappings = [row(REACH.id, 0.5), row(SPREAD.id, 0.4), row('experimental.seed', 1, 'beat'), row(DISTORTION.id, 0.5)]
    const loud: FeatureFrame = { ...SILENT_FRAME, time: 0, level: 0.8, levelDb: -10, silent: false }
    const shared = modulate(base, loud, mappings, new Map([['experimental.seed', 3]]))
    expect(shared.params.experimental.seed).toBe(base.experimental.seed + 3)
    expect(REACH.get(shared.params)).not.toBe(REACH.get(base))
    const levels = letterLevels(response({ contrast: 1, pitchReactive: 1 }))!
    const sets = levelSets(base, shared, levels, paramsKey)
    for (const level of [QUIET, STRONG]) {
      expect(sameThornState(thornState(sets[level].params), thornState(shared.params))).toBe(true)
      expect(DISTORTION.get(sets[level].params)).not.toBe(DISTORTION.get(shared.params))
      for (const id of THORN_IDS) expect(sets[level].positions.get(id)).toBe(shared.positions.get(id))
    }
    // The letters' slider positions: Thorn's are the shared ones at every gain.
    for (const gain of [0.25, 3]) {
      expect(levelPosition(REACH, base, 0.7, gain)).toBe(0.7)
      expect(levelPosition(DISTORTION, base, 0.7, gain)).not.toBe(0.7)
    }
  })

  it('while Thorn is on, levels leave every turn target at its shared value; with Thorn off only the Thorn sliders', () => {
    const SQUARING = targetById('squaring.amount')!
    const WHORL = targetById('experimental.whorl.amount')!
    const CRUMPLE = targetById('experimental.crumple.amount')!
    const warped = { ...THORN_ON.experimental, ...on('whorl', { amount: 0.2 }), ...on('crumple', { amount: 0.2 }) }
    const thornOn: GeometryParams = { ...THORN_ON, experimental: warped }
    const thornOff = thornWith(thornOn, { enabled: false })
    const mappings = [row(SQUARING.id, 0.5), row(WHORL.id, 0.5), row(CRUMPLE.id, 0.5), row(DISTORTION.id, 0.5)]
    const loud: FeatureFrame = { ...SILENT_FRAME, time: 0, level: 0.8, levelDb: -10, silent: false }
    const levels = letterLevels(response({ contrast: 1, pitchReactive: 1 }))!
    for (const [base, unscaled] of [[thornOn, true], [thornOff, false]] as const) {
      const shared = modulate(base, loud, mappings, new Map())
      const sets = levelSets(base, shared, levels, paramsKey)
      for (const level of [QUIET, STRONG]) {
        // Squaring (before Distortion) and Whorl's Amount move the thorns: they reach the letters by turns, unscaled.
        for (const spec of [SQUARING, WHORL]) expect(spec.get(sets[level].params) === spec.get(shared.params), `${spec.id} ${level}`).toBe(unscaled)
        // Distortion and Crumple's Amount, which the thorns keep through, are scaled either way.
        for (const spec of [DISTORTION, CRUMPLE]) expect(spec.get(sets[level].params), `${spec.id} ${level}`).not.toBe(spec.get(shared.params))
      }
      expect(levelPosition(SQUARING, base, 0.7, 3) === 0.7).toBe(unscaled)
      expect(levelPosition(CRUMPLE, base, 0.7, 3)).not.toBe(0.7)
    }
  })

  it('the turn state holds every target that moves the thorns: not Distortion, nor the Amounts the thorns keep through', () => {
    const ids = TARGETS.filter((t) => isTurnTarget(t.id)).map((t) => t.id)
    const upstream = ['flatten.segmentsPerCurve', 'squaring.amount', 'anchors.simplify', 'grid.size', 'random.seed']
    const warps = ['experimental.crumple.facet', 'experimental.ripple.petals', 'experimental.whorl.amount', 'experimental.slipstream.slip']
    expect(ids).toEqual(expect.arrayContaining([...THORN_IDS, 'experimental.seed', ...upstream, ...warps]))
    for (const id of ['distortion.amount', 'distortion.frequency', 'distortion.seed', 'experimental.crumple.amount', 'experimental.ripple.amount']) {
      expect(ids).not.toContain(id)
    }
    expect(thornState(THORN_ON).values).toHaveLength(ids.length)
    // A Geometry seed is a jump, a whole travel, as the Experimental seed.
    const RANDOM_SEED = targetById('random.seed')!
    const reseeded = thornState(RANDOM_SEED.set(THORN_ON, RANDOM_SEED.get(THORN_ON) + 1))
    expect(thornDiffers(thornState(THORN_ON), reseeded, thornState(THORN_ON))).toBe(true)
    expect(turnSwing(0.2, thornState(THORN_ON), reseeded)).toBeCloseTo(0.2, 12)
  })

  it('withThornState sets the Thorn settings and the seed, and keeps the same object when they are there', () => {
    const state = thornState(thornWith(THORN_ON, { count: 3, canvasReach: 0.2 }, 77))
    const changed = withThornState(FLARE_BASE, state)
    expect(sameThornState(thornState(changed), state)).toBe(true)
    expect(changed.distortion).toBe(FLARE_BASE.distortion)
    expect(withThornState(changed, state)).toBe(changed)
    expect(thornState(withThornState(changed, { ...state, enabled: false })).enabled).toBe(false)
  })

  it('a group takes the live state on a new seed, number of thorns or switch, half a swing of a slider, or back to its own value', () => {
    const own = thornState(MID_REACH)
    const half = FLASH_LIMITS.swing / 2
    expect(thornDiffers(own, own, own)).toBe(false)
    expect(thornDiffers(own, thornState(thornWith(MID_REACH, {}, MID_REACH.experimental.seed + 1)), own)).toBe(true)
    expect(thornDiffers(own, thornState(thornWith(MID_REACH, { count: 2 })), own)).toBe(true)
    expect(thornDiffers(own, thornState(thornWith(MID_REACH, { enabled: false })), own)).toBe(true)
    expect(thornDiffers(own, reachState(half - 0.01), own)).toBe(false)
    expect(thornDiffers(own, reachState(half + 0.01), own)).toBe(true)
    expect(thornDiffers(own, reachState(-half - 0.01), own)).toBe(true)
    // Back on the sliders' own value: taken however near, so quiet ends exactly there.
    expect(thornDiffers(reachState(0.02), own, own)).toBe(true)
    expect(thornDiffers(reachState(0.02), reachState(0.03), own)).toBe(false)
  })

  it('a turn is as large as its share of the text times how far its sliders move, a new seed a whole travel', () => {
    const own = thornState(THORN_ON)
    expect(turnSwing(0.2, own, own)).toBe(0)
    expect(turnSwing(0.2, own, seedState(THORN_ON.experimental.seed + 1))).toBeCloseTo(0.2, 12)
    expect(turnSwing(0.5, own, spreadState(0.3))).toBeCloseTo(0.15, 6)
  })
})

describe('ThornTurns', () => {
  const own = thornState(THORN_ON)
  const slots = lettersOf(60, 12)

  /**
   * Frames every 1/60 s until `until`, the live state `liveAt(t)`, for the letters `slots` (the 60 above by default);
   * each turn reaches the screen `showMs` later.
   */
  function run(
    turns: ThornTurns,
    until: number,
    liveAt: (t: number) => ThornState,
    options: { showMs?: number; take?: () => boolean; from?: number; slots?: LetterSlots } = {},
  ) {
    const letters = options.slots ?? slots
    const drawn = turnGroups(letters).letters
    const log: { at: number; group: number; shownAt: number }[] = []
    let showAt: number | null = null
    for (let k = 0; ; k++) {
      const now = (options.from ?? 0) + (k * 1000) / 60
      if (now > until) break
      if (showAt !== null && now >= showAt) {
        turns.shownUpTo(turns.turns, now)
        log[log.length - 1].shownAt = now
        showAt = null
      }
      const before = turns.states.slice()
      const made = turns.turns
      turns.update(letters, liveAt(now), own, now, options.take ?? (() => true))
      // Groups without letters keep up with the live state unseen, as no turn.
      const changed = turns.states.flatMap((state, g) => (before.length && drawn[g] > 0 && state !== before[g] ? [g] : []))
      if (turns.turns === made) {
        if (before.length) expect(changed).toEqual([])
        continue
      }
      // At most one group per turn.
      expect(changed).toHaveLength(1)
      log.push({ at: now, group: changed[0], shownAt: Infinity })
      showAt = now + (options.showMs ?? 40)
      if (showAt <= now) {
        turns.shownUpTo(turns.turns, now)
        log[log.length - 1].shownAt = now
        showAt = null
      }
    }
    return log
  }

  it('turns one group at a time, round robin, gapMs after the last turn reached the screen', () => {
    const turns = new ThornTurns()
    // A new seed every frame: every group always differs.
    const log = run(turns, 10_000, (t) => seedState(Math.round(t)))
    expect(log.length).toBeGreaterThan(25)
    log.forEach(({ group }, i) => expect(group).toBe(i % THORN_TURNS.groups))
    for (let i = 1; i < log.length; i++) {
      expect(log[i].at - log[i - 1].shownAt).toBeGreaterThanOrEqual(THORN_TURNS.gapMs)
      expect(log[i].at - log[i - 1].shownAt).toBeLessThan(THORN_TURNS.gapMs + 17)
    }
    // A letter's thorns change at most once in five turns, so at most once in 1.25 s.
    for (let i = THORN_TURNS.groups; i < log.length; i++) {
      expect(log[i].group).toBe(log[i - THORN_TURNS.groups].group)
      expect(log[i].at - log[i - THORN_TURNS.groups].at).toBeGreaterThanOrEqual(THORN_TURNS.groups * THORN_TURNS.gapMs)
    }
  })

  it('waits for the last turn to reach the screen', () => {
    const turns = new ThornTurns()
    const log = run(turns, 5000, (t) => seedState(Math.round(t)), { showMs: Infinity })
    expect(log).toHaveLength(1)
  })

  it('a turn the flash budget refuses waits, and the same group takes it when the budget allows', () => {
    const turns = new ThornTurns()
    let asked = 0
    let allow = false
    const take = () => {
      asked++
      return allow
    }
    turns.update(slots, own, own, 0, take)
    const next = seedState(THORN_ON.experimental.seed + 1)
    // A new seed for a fifth of the text is a large change: it asks, and waits while refused.
    expect(turnSwing(turnGroups(slots).share[0], own, next)).toBeGreaterThanOrEqual(FLASH_LIMITS.swing)
    for (let t = 300; t < 2000; t += 100) turns.update(slots, next, own, t, take)
    expect(turns.turns).toBe(0)
    expect(asked).toBe(17)
    expect(turns.states.every((state) => state === own)).toBe(true)
    allow = true
    turns.update(slots, next, own, 2000, take)
    expect(turns.turns).toBe(1)
    expect(turns.states.map((state) => state === next)).toEqual([true, false, false, false, false])
    // A small change does not ask.
    turns.shownUpTo(1, 2000)
    const asks = asked
    turns.update(slots, spreadState(0.1), own, 2300, take)
    expect(turns.turns).toBe(2)
    expect(asked).toBe(asks)
  })

  it('a group already showing the live state gives its turn up, so the groups after it do not wait on it', () => {
    const turns = new ThornTurns()
    const s1 = seedState(5)
    const s2 = seedState(9)
    let asked = 0
    const take = () => {
      asked++
      return true
    }
    // From the sliders' own state, groups 0 and 1 take s1, then the sound goes back to the sliders' own state, then on to s2.
    const log = run(turns, 2600, (t) => (t < 1 || (t >= 600 && t < 2500) ? own : t < 600 ? s1 : s2), { showMs: 0, take })
    expect(log.map(({ group }) => group)).toEqual([0, 1, 0, 1, 2])
    // Groups 2, 3 and 4 already show the sliders' own state: they give their turns up, one gapMs each.
    expect(log[2].at - log[1].at).toBeGreaterThanOrEqual(4 * THORN_TURNS.gapMs)
    expect(log[2].at - log[1].at).toBeLessThan(4 * THORN_TURNS.gapMs + 4 * 17)
    // With every group on the live state nothing moves on: a new state is taken at once.
    expect(log[4].at).toBeLessThan(2500 + 17)
    expect(asked).toBe(5)
    expect(turns.states.map((state) => state === s2)).toEqual([false, false, true, false, false])
  })

  it('turns the letters of a short text at most once every groups × gapMs: the groups without letters pass time', () => {
    for (const n of [1, 2, 4]) {
      const short = lettersOfIds([...Array(n).keys()])
      const groups = turnGroups(short)
      const turns = new ThornTurns()
      // A new seed every frame: every group with letters always differs.
      const log = run(turns, 10_000, (t) => seedState(Math.round(t)), { slots: short })
      expect(log.length, `${n}`).toBeGreaterThanOrEqual(6 * n)
      const last = new Map<number, number>()
      for (const { at, group } of log) {
        expect(groups.letters[group]).toBe(1)
        if (last.has(group)) expect(at - last.get(group)!, `${n}`).toBeGreaterThanOrEqual(THORN_TURNS.groups * THORN_TURNS.gapMs)
        last.set(group, at)
      }
    }
  })

  it('starts afresh, every group on the live state at once with nothing asked, on a clear or other letters', () => {
    const turns = new ThornTurns()
    let asked = 0
    const take = () => {
      asked++
      return true
    }
    let letters = slots
    let now = 0
    let seed = 1
    turns.update(letters, seedState(seed), own, now, take)
    expect(turns.states.every((state) => state === turns.states[0])).toBe(true)
    expect(turns.groups).toBe(turnGroups(letters))
    const starts: [string, () => void][] = [
      ['clear', () => turns.clear()],
      ['other letters', () => (letters = lettersOf(61, 12))],
    ]
    for (const [, start] of starts) {
      // One turn: the groups differ.
      now += 1000
      turns.update(letters, seedState(++seed), own, now, take)
      turns.shownUpTo(turns.turns, now)
      expect(new Set(turns.states).size).toBe(2)
      const made = turns.turns
      const asks = asked
      start()
      now += 1000
      const live = seedState(++seed)
      turns.update(letters, live, own, now, take)
      expect(turns.states.every((state) => state === live)).toBe(true)
      expect(turns.groups).toBe(turnGroups(letters))
      expect(turns.turns).toBe(made)
      expect(asked).toBe(asks)
      // The next turn comes gapMs later.
      turns.update(letters, seedState(++seed), own, now + THORN_TURNS.gapMs - 1, take)
      expect(turns.turns).toBe(made)
    }
    // The same letters set differently keep their groups and states.
    now += 1000
    turns.update(letters, seedState(++seed), own, now, take)
    turns.shownUpTo(turns.turns, now)
    const states = turns.states.slice()
    const restyled: LetterSlots = { ...letters, t: letters.t.map((t) => t / 2) }
    turns.update(restyled, states[1], own, now + 1, take)
    expect(turns.states).toEqual(states)
    expect([...turns.groups!.of]).toEqual([...turnGroups(letters).of])
  })

  it('a slider moved by hand that the sound leaves alone reaches every group at once; a driven one, and a new mapping, by turns', () => {
    const turns = new ThornTurns()
    const take = () => true
    const SEED = targetById('experimental.seed')!
    /** THORN_ON with this seed and Spread at slider position `spread`. */
    const at = (seed: number, spread: number) => thornState(SPREAD.set(thornWith(THORN_ON, {}, seed), SPREAD.fromSlider(spread)))
    const own0 = at(1, 0.1)
    turns.update(slots, own0, own0, 0, take)
    // Group 0 turns to seed 2; the others keep seed 1.
    turns.update(slots, at(2, 0.1), own0, 1000, take)
    turns.shownUpTo(turns.turns, 1000)
    const made = turns.turns
    expect(made).toBe(1)
    const seeds = () => turns.states.map((state) => SEED.get(withThornState(THORN_ON, state)))
    const spreads = () => turns.states.map((state) => SPREAD.toSlider(SPREAD.get(withThornState(THORN_ON, state))))
    expect(seeds()).toEqual([2, 1, 1, 1, 1])
    // Spread moved by hand, not driven (the live value is the slider's): every group at once, their seeds kept, no turn.
    turns.update(slots, at(2, 0.4), at(1, 0.4), 1001, take)
    expect(turns.turns).toBe(made)
    expect(seeds()).toEqual([2, 1, 1, 1, 1])
    for (const spread of spreads()) expect(spread).toBeCloseTo(0.4, 9)
    // Groups that showed one state still show one object.
    expect(new Set(turns.states).size).toBe(2)
    // Spread moved by hand while the sound drives it (the live value is not the slider's): it waits for the turns.
    turns.update(slots, at(2, 0.5), at(1, 0.7), 1002, take)
    expect(turns.turns).toBe(made)
    for (const spread of spreads()) expect(spread).toBeCloseTo(0.4, 9)
    // A new mapping changes only the live state, so its change comes by turns too: the next group only.
    turns.update(slots, at(5, 0.5), at(1, 0.7), 1000 + THORN_TURNS.gapMs, take)
    expect(turns.turns).toBe(made + 1)
    expect(seeds()).toEqual([2, 5, 1, 1, 1])
  })
})

describe('the live scheduler with Thorn turns', () => {
  // Crumple on (so the shared seed acts), Thorn off: its mappings do nothing.
  const THORN_OFF: GeometryParams = {
    ...BASE,
    experimental: { ...BASE.experimental, crumple: { ...BASE.experimental.crumple, enabled: true, amount: 0.3 } },
  }
  const THORN_OFF_MAPPINGS: Mapping[] = [
    row('distortion.amount', 0.5, 'level'),
    row('experimental.crumple.amount', 0.3, 'bass'),
    row('experimental.seed', 1, 'beat'),
    row('experimental.thorn.canvasReach', 0.5, 'level'),
    row('experimental.thorn.count', 0.3, 'beat'),
  ]
  const THORN_OFF_RESPONSE: ResponseSettings = { ...NEUTRAL_RESPONSE, contrast: 1, pitchReactive: 1 }

  it('with Thorn off makes no turns: requests, commits (letters included) and Freeze as before Thorn turns', () => {
    const slots = lettersOf(40)
    const r = rig(slots)
    r.live.setBase(THORN_OFF)
    r.live.setSlots(slots)
    r.live.setMappings(THORN_OFF_MAPPINGS, true, THORN_OFF_RESPONSE)
    const rand = random(31)
    r.play(3000, (t) => soundFrame(rand, t))
    const freeze = r.live.freezeChanges()
    r.setRunning(false)
    const hash = fnv1a()
    for (const { at, jobs } of r.asked) hash.add(`${at}:${jobs.map((job) => `${job.key}#${job.indices?.join(',') ?? 'shown'}`).join('+')}`)
    for (const { at, commit } of r.commits) {
      const letters = commit?.letters
      hash.add(commit ? `${at}|${commit.seq}|${commit.params ? paramsKey(commit.params) : 'null'}|${letters ? `${letters.key}|${letters.keys.join('+')}|${[...letters.assign].join('')}` : '-'}` : `stop|${at}`)
      // Only the three levels.
      if (letters) expect(letters.keys).toHaveLength(3)
    }
    hash.add(freeze ? JSON.stringify(freeze) : 'null')
    expect(r.commits.filter(({ commit }) => commit?.letters).length).toBeGreaterThan(20)
    // Pinned on develop at f4483b5, before Thorn turns. Never edit, except for a change of the params' shape: pinned
    // again when Crumple lost Detail (NOCUR-60); with that field put back it gives the f4483b5 value (12b619b8).
    // Pinned again when the sliders got finer steps (NOCUR-63): live values snap to the finer steps; with the old
    // steps put back in SLIDER_RANGES it gives 50d3f31c. Pinned again when Dissolve was added (NOCUR-69, off by
    // default): with its default left out of the params it gives 82cf3338.
    expect(hash.hex).toBe('f3f39452')
  })

  it('every letter shows slider values and seeds the panel could set, the same turn state across its group and levels', () => {
    // Flare with Level on Distortion, and with the Mids on Squaring too (a Geometry step before Distortion: a turn target).
    const cases: [ResponseSettings, Mapping[]][] = [
      [NEUTRAL_RESPONSE, FLARE_DISTORTION],
      [response({ contrast: 1, pitchReactive: 1 }), FLARE_DISTORTION],
      [response({ contrast: 1, pitchReactive: 1 }), [...FLARE_DISTORTION, row('squaring.amount', 0.4, 'mids')]],
    ]
    for (const [r0, mappings] of cases) {
      const slots = lettersOf(40)
      const groups = turnGroups(slots)
      const drawn = [...slots.active.keys()].filter((j) => slots.active[j])
      const r = rig(slots)
      r.live.setBase(FLARE_BASE)
      r.live.setSlots(slots)
      r.live.setMappings(mappings, true, r0)
      const rand = random(7)
      r.play(6000, (t) => soundFrame(rand, t))
      const checked = new Set<string>()
      let split = 0
      for (const { commit } of r.commits) {
        const { byKey, keys, states } = lettersAt(commit, slots, FLARE_BASE)
        for (const [key, params] of byKey) {
          if (checked.has(key)) continue
          checked.add(key)
          expect(outOfRange(params, FLARE_BASE), key).toEqual([])
        }
        // A group's letters show one Thorn state, whatever their levels.
        const byGroup = new Map<number, string>()
        states.forEach((state, i) => {
          const g = groups.of[drawn[i]]
          if (!byGroup.has(g)) byGroup.set(g, state)
          expect(state).toBe(byGroup.get(g))
        })
        if (new Set(states).size > 1) split++
        expect(keys).toHaveLength(drawn.length)
      }
      // The groups did show different Thorn states.
      expect(split).toBeGreaterThan(10)
    }
  })

  it('starts the turns afresh on drive start, a new text and Thorn switched on', () => {
    let slots = lettersOf(40)
    let base = FLARE_BASE
    const r = rig(slots)
    r.live.setBase(base)
    r.live.setSlots(slots)
    r.live.setMappings(FLARE_DISTORTION, true)
    const rand = random(11)
    const thornOff = thornWith(FLARE_BASE, { enabled: false })
    // Each start: what leads to it, then what starts the turns afresh.
    const starts: [string, () => void, () => void][] = [
      ['drive start', () => r.setRunning(false), () => r.setRunning(true)],
      ['new text', () => {}, () => r.live.setSlots((slots = lettersOf(41)))],
      ['Thorn switched on', () => r.live.setBase((base = thornOff)), () => r.live.setBase((base = FLARE_BASE))],
    ]
    for (const [name, prepare, start] of starts) {
      // Turns under way: the letters show more than one Thorn state.
      let mixed = false
      for (let until = r.now + 1000; !mixed && until < 30_000; until += 1000) {
        r.play(until, (t) => soundFrame(rand, t))
        r.advance(r.now + 100)
        mixed = new Set(lettersAt(r.commits[r.commits.length - 1].commit, slots, base).states).size > 1
      }
      expect(mixed, name).toBe(true)
      prepare()
      r.advance(r.now + 100)
      const from = r.commits.length
      start()
      r.advance(r.now + 100)
      // The next frame is live, and every letter shows the live Thorn state.
      const first = r.commits[from]?.commit
      expect(first?.params, name).toBeTruthy()
      expect(new Set(lettersAt(first!, slots, base).states).size, name).toBe(1)
      expect(thornOf(first!.params!), name).toBe(thornOf(r.commits[r.commits.length - 1].commit!.params!))
    }
  })

  it('a new mapping starts nothing afresh: the letters keep their turn states, and its changes come one group at a time', () => {
    const slots = lettersOf(40)
    const r = rig(slots)
    r.live.setBase(FLARE_BASE)
    r.live.setSlots(slots)
    r.live.setMappings(FLARE_DISTORTION, true)
    const rand = random(13)
    let mixed = false
    for (let until = 1000; !mixed && until < 30_000; until += 1000) {
      r.play(until, (t) => soundFrame(rand, t))
      r.advance(r.now + 100)
      mixed = new Set(lettersAt(r.commits[r.commits.length - 1].commit, slots, FLARE_BASE).states).size > 1
    }
    expect(mixed).toBe(true)
    const from = r.commits.length - 1
    r.live.setMappings([...FLARE_DISTORTION, row(SPREAD.id, 0.3, 'mids'), row('squaring.amount', 0.4, 'mids')], true)
    r.play(r.now + 6000, (t) => soundFrame(rand, t))
    const groups = turnGroups(slots)
    const drawn = [...slots.active.keys()].filter((j) => slots.active[j])
    const changes = thornChanges(r.commits.slice(from), slots, FLARE_BASE)
    expect(changes.length).toBeGreaterThan(3)
    for (const { letters } of changes) expect(new Set(letters.map((k) => groups.of[drawn[k]])).size).toBe(1)
    // The first frame after the change still shows more than one turn state.
    expect(new Set(lettersAt(r.commits[from + 1].commit, slots, FLARE_BASE).states).size).toBeGreaterThan(1)
  })

  it('Freeze writes the shared live values, not those of a turn group', () => {
    const slots = lettersOf(40)
    const r = rig(slots)
    r.live.setBase(FLARE_BASE)
    r.live.setSlots(slots)
    r.live.setMappings(FLARE_DISTORTION, true)
    const rand = random(5)
    let frozen = 0
    for (let until = 1000; until <= 8000; until += 350) {
      r.play(until, (t) => soundFrame(rand, t))
      // Settled: the screen shows the newest update.
      r.advance(r.now + 100)
      const states = new Set(lettersAt(r.commits[r.commits.length - 1].commit, slots, FLARE_BASE).states)
      const freeze = r.live.freezeChanges()
      if (states.size < 2 || !freeze?.experimental) continue
      frozen++
      expect(freeze.experimental.seed).toBe(r.live.seeds.get('experimental.seed'))
      const reach = REACH.toSlider(freeze.experimental.thorn!.canvasReach)
      expect(Math.abs(reach - r.live.positions.get(REACH.id)!)).toBeLessThanOrEqual(0.0005 + 1e-9)
    }
    expect(frozen).toBeGreaterThan(3)
  })

  it('on the default text with Flare and Level on Distortion: at most a fifth of the letters every 250 ms, a letter at most every 1.25 s', async () => {
    const font = await loadFixture('Roboto')
    const slots = letterSlots(shapeSpecimen(font, DEFAULT_TEXT))
    const n = slots.activeCount
    const shown = [...new Set([...slots.index].filter((_, j) => slots.active[j]))]
    const glyphs = shown.length
    expect(n).toBeGreaterThan(150)
    for (const r0 of [NEUTRAL_RESPONSE, response({ contrast: 1, pitchReactive: 1 })]) {
      const r = rig(slots)
      r.live.setBase(FLARE_BASE)
      r.live.setSlots(slots)
      r.live.setMappings(FLARE_DISTORTION, true, r0)
      // A beat at 120 bpm: each onset moves the Experimental seed and the number of thorns on.
      const seconds = 12
      r.play(seconds * 1000, beatStream(2024))
      // From the first live commit on (which starts the turns: every letter leaves the sliders' own Thorn settings).
      const changes = thornChanges(r.commits, slots, FLARE_BASE)
      const perSecond = new Array<number>(seconds).fill(0)
      for (const { at, letters } of changes) perSecond[Math.min(seconds - 1, Math.floor(at / 1000))] += letters.length
      // Turns keep coming: about two and a half a second here.
      expect(changes.length).toBeGreaterThan(1.5 * seconds)
      const groups = turnGroups(slots)
      const drawn = [...slots.active.keys()].filter((j) => slots.active[j])
      const last = new Map<number, number>()
      for (let i = 0; i < changes.length; i++) {
        const { at, letters } = changes[i]
        // One group per change, at most a fifth of the letters, the changes at least 250 ms apart.
        expect(new Set(letters.map((k) => groups.of[drawn[k]])).size).toBe(1)
        expect(letters.length).toBeLessThanOrEqual(Math.ceil(0.2 * n))
        if (i > 0) expect(at - changes[i - 1].at).toBeGreaterThanOrEqual(THORN_TURNS.gapMs)
        for (const j of letters) {
          if (last.has(j)) expect(at - last.get(j)!).toBeGreaterThanOrEqual(THORN_TURNS.groups * THORN_TURNS.gapMs)
          last.set(j, at)
        }
      }
      // So at most four turns a second.
      for (const count of perSecond) expect(count).toBeLessThanOrEqual(4 * Math.ceil(0.2 * n))
      // One request a frame: the shared set for the glyphs of the letters showing it (and the first glyph), then each
      // other set's own glyphs, never twice. Without levels, each glyph once but for the at most four split over groups.
      for (const { jobs } of r.asked) {
        expect(new Set(jobs.map((job) => job.key)).size).toBe(jobs.length)
        const asked = jobs.reduce((sum, job) => sum + (job.indices ?? shownGlyphs(shown, job.within)).length, 0)
        expect(asked).toBeLessThanOrEqual(r0 === NEUTRAL_RESPONSE ? glyphs + THORN_TURNS.groups : 4 * glyphs)
      }
    }
  })
})
