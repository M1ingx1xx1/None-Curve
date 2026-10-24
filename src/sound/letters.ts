// Letters that react to Sound by their own amounts (Motion contrast and Pitch reactive, see docs/SOUND_PLAN.md §5,
// §10). A letter is one glyph occurrence of the text, counted as placePolygons counts them (scene.ts). Pure: no
// React, no DOM, no Web Audio.
//
// Each letter has a weight: its Motion contrast gain (a stable share per letter plus a slow wave over time, so which
// letters lead drifts every few seconds) times its Pitch reactive weight (a bell around the pitch across the text
// block: the low notes of the recent melody favour the letters on the left, its high notes those on the right). Weights are sorted into three
// levels, fixed per setting: quiet, shared (1) and strong, with hysteresis so a letter near a boundary does not
// flicker between two. The shared level is the live values the markers show and Freeze writes; a level's values are
// the shared ones with every driven slider's offset from its slider value scaled by the level's gain, clamped and
// snapped to the slider's step (Thorn's sliders excepted). So every letter on screen is still a result the sliders
// could produce, and without Thorn one frame asks for at most three parameter sets.
//
// Thorn turns (THORN_TURNS): while Thorn is on, the settings that decide where the thorns sit and which way they point
// (isTurnTarget: Thorn's own but Reach, the Experimental seed, and the shapes Thorn picks its anchors on or follows them
// through) reach the letters a few at a time. The drawn letters are split into turn groups of whole glyph ids (turnGroups), each
// showing the turn state it took at its last turn (live.ts hands the live state to one group per turn); levels never
// scale them. A letter shows its level's values with its group's turn state (turnSets), so a frame asks for at most a
// parameter set per level and group, each for the glyph ids that show it.

import type { GeometryJob, GeometryParams } from '../geometry/types'
import type { ShapedSpecimen } from '../specimen/scene'
import { FLASH_LIMITS } from './flash'
import { TARGETS, targetById, withinBounds, type Mapping, type Modulated, type TargetSpec } from './mapping'
import { THORN_TURNS, type FeatureFrame, type ResponseSettings } from './types'

/** The letters of the shaped text, one slot per occurrence in placePolygons' order (lines, then glyphs; spaces and missing glyphs counted). */
export interface LetterSlots {
  count: number
  /** Glyph id per occurrence. */
  index: Int32Array
  /** Where the letter's pen centre sits across the text block, 0 (left) to 1 (right); 0.5 when the block has no width. */
  t: Float32Array
  /** The letter's share of the text: its advance over the sum of the active letters' advances (equal shares when that is 0); 0 when inactive. */
  share: Float32Array
  /** 1 for a letter that is drawn (not missing, not white space); the others always show the shared level. */
  active: Uint8Array
  activeCount: number
}

export const NO_SLOTS: LetterSlots = {
  count: 0,
  index: new Int32Array(0),
  t: new Float32Array(0),
  share: new Float32Array(0),
  active: new Uint8Array(0),
  activeCount: 0,
}

export const LETTER_LIMITS = {
  /** Motion contrast 100 %: a letter's gain runs from 1/contrastRange to contrastRange (levels at those two). */
  contrastRange: 3.6,
  /** A letter's contrast share: hashShare from its stable hash, the rest from a wave of wavePeriodMs, shifted by wavePhase per letter. */
  hashShare: 0.38,
  wavePeriodMs: 6000,
  wavePhase: 2.4,
  /** Pitch reactive 200 % at full confidence: letters far from the pitch weigh pitchFar, the letter at the pitch pitchFar + pitchPeak. */
  pitchFar: 0.38,
  pitchPeak: 1.95,
  /** Width (σ, a share of the text block) of the bell around the pitch: widthWide at 0 %, narrowing to widthNarrow at 200 %. */
  widthWide: 0.42,
  widthNarrow: 0.16,
  /** The quiet and strong levels stay within these gains. */
  minGain: 1 / 16,
  maxGain: 4,
  /** Share of a boundary's distance from ln 1 that a weight must pass beyond it to leave a level. */
  hysteresis: 0.15,
} as const

/** Levels, as LetterFrame.assign holds them. */
export const QUIET = 0
export const SHARED = 1
export const STRONG = 2

const clamp01 = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0)

const slotsOf = new WeakMap<ShapedSpecimen, LetterSlots>()

/** The letters of shaped text; the same object for the same `shaped` (whose identity changes with the text and typography). */
export function letterSlots(shaped: ShapedSpecimen): LetterSlots {
  const known = slotsOf.get(shaped)
  if (known) return known
  const glyphs = shaped.lines.flatMap((line) => line.glyphs)
  const count = glyphs.length
  const index = new Int32Array(count)
  const t = new Float32Array(count)
  const share = new Float32Array(count)
  const active = new Uint8Array(count)
  const width = shaped.blockWidth
  let activeCount = 0
  let total = 0
  glyphs.forEach((g, j) => {
    index[j] = g.index
    // The pen position already holds kerning, tracking and alignment; slant and Free position do not move it.
    t[j] = width > 0 ? clamp01((g.x + g.advance / 2) / width) : 0.5
    if (g.missing || g.text.trim() === '') return
    active[j] = 1
    activeCount++
    total += Math.max(0, g.advance)
  })
  glyphs.forEach((g, j) => {
    if (active[j]) share[j] = total > 0 ? Math.max(0, g.advance) / total : 1 / activeCount
  })
  const slots: LetterSlots = { count, index, t, share, active, activeCount }
  slotsOf.set(shaped, slots)
  return slots
}

/** A stable value in [0, 1) per letter (the murmur3 finaliser). */
function hash01(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/**
 * Motion contrast's gain for a letter at a time: exactly 1 at contrast 0; at contrast 1 from 1/3.6 to 3.6, spread
 * evenly in log space around 1 (as many calm letters as lively ones), led by a different set every few seconds.
 */
export function contrastGain(contrast: number, occurrence: number, timeMs: number): number {
  if (!(contrast > 0)) return 1
  const { contrastRange, hashShare, wavePeriodMs, wavePhase } = LETTER_LIMITS
  const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * timeMs) / wavePeriodMs + wavePhase * occurrence)
  const spread = hashShare * hash01(occurrence) + (1 - hashShare) * wave
  return contrastRange ** (contrast * (2 * spread - 1))
}

/**
 * Where the pitch sits across the text block, 0 (left) to 1 (right): its place in the recent melody's range
 * (FeatureFrame.pitchLow to pitchHigh, at least an octave), so any tune sweeps the whole text, whatever its register.
 * Pitch itself (55 to 1760 Hz) before a note is heard.
 */
export function pitchPlace(frame: FeatureFrame): number {
  const span = frame.pitchHigh - frame.pitchLow
  return span > 0 ? clamp01((frame.pitch - frame.pitchLow) / span) : clamp01(frame.pitch)
}

/**
 * Pitch reactive's weight for a letter at `t` across the text block, for a pitch at `pitch` across it (0–1,
 * pitchPlace) heard with `confidence`: a bell around the pitch, exactly 1 when Pitch reactive or the confidence is 0.
 * Symmetric in t − pitch.
 */
export function pitchWeight(pitchReactive: number, t: number, pitch: number, confidence: number): number {
  if (!(pitchReactive > 0) || !(confidence > 0)) return 1
  const { pitchFar, pitchPeak, widthWide, widthNarrow } = LETTER_LIMITS
  const half = pitchReactive / 2
  const amount = half * Math.min(1, confidence)
  const width = widthWide + (widthNarrow - widthWide) * half
  const d = t - pitch
  return 1 + amount * (pitchFar + pitchPeak * Math.exp(-(d * d) / (2 * width * width)) - 1)
}

/** The three levels for a setting: their gains, the boundaries between them (ln of the weight) and the hysteresis margins. */
export interface LetterLevels {
  gains: readonly [quiet: number, shared: 1, strong: number]
  /** Below edges[0] a letter is quiet, above edges[1] strong: halfway (in log space) from 1 to each level's gain. */
  edges: readonly [lo: number, hi: number]
  margins: readonly [lo: number, hi: number]
}

/** The levels for these response settings, or null when every letter reacts alike (Motion contrast and Pitch reactive at 0). */
export function letterLevels(r: ResponseSettings): LetterLevels | null {
  const c = r.contrast > 0 ? r.contrast : 0
  const p = r.pitchReactive > 0 ? r.pitchReactive : 0
  if (c === 0 && p === 0) return null
  const { contrastRange, pitchFar, pitchPeak, minGain, maxGain, hysteresis } = LETTER_LIMITS
  // The extremes of the two weights together, capped.
  const quiet = Math.max(minGain, contrastRange ** -c * (1 - (1 - pitchFar) * (p / 2)))
  const strong = Math.min(maxGain, contrastRange ** c * (1 + (pitchFar + pitchPeak - 1) * (p / 2)))
  const lo = Math.log(quiet) / 2
  const hi = Math.log(strong) / 2
  return { gains: [quiet, 1, strong], edges: [lo, hi], margins: [hysteresis * Math.abs(lo), hysteresis * hi] }
}

/**
 * The level each letter goes to in this frame (QUIET, SHARED or STRONG), from its weight and, with hysteresis, the
 * level it was on (`previous`; ignored when null or of another length). Inactive letters are always SHARED.
 */
export function assignLevels(
  slots: LetterSlots,
  r: ResponseSettings,
  frame: FeatureFrame,
  levels: LetterLevels,
  previous: Uint8Array | null,
  out?: Uint8Array,
): Uint8Array {
  const n = slots.count
  const assign = out && out.length === n ? out : new Uint8Array(n)
  const before = previous && previous.length === n ? previous : null
  const [lo, hi] = levels.edges
  const [mLo, mHi] = before ? levels.margins : [0, 0]
  const pitch = pitchPlace(frame)
  for (let j = 0; j < n; j++) {
    if (!slots.active[j]) {
      assign[j] = SHARED
      continue
    }
    const x = Math.log(
      contrastGain(r.contrast, j, frame.time) * pitchWeight(r.pitchReactive, slots.t[j], pitch, frame.pitchConfidence),
    )
    const was = before ? before[j] : SHARED
    if (was === STRONG && x > hi - mHi) assign[j] = STRONG
    else if (was === QUIET && x < lo + mLo) assign[j] = QUIET
    else assign[j] = x > hi + mHi ? STRONG : x < lo - mLo ? QUIET : SHARED
  }
  return assign
}

/** Thorn's sliders: never scaled by a level, with Thorn on (they come from the letters' turn groups) or off. */
export const isThornTarget = (id: string): boolean => id.startsWith('experimental.thorn.')

/**
 * What the thorns keep through (thorn.ts), as they keep through Distortion: Crumple's and Ripple's Amount, and Thorn's
 * Reach, which sets how long the thorns are, not where they sit or which way they point. They stay with the shared
 * values, so a beat on Reach grows and sinks every letter's thorns together.
 */
const KEPT_THROUGH = new Set([
  'experimental.crumple.amount',
  'experimental.ripple.amount',
  'experimental.thorn.canvasReach',
])

/** Dissolve runs after Thorn (experimental.ts), so its sliders never move a thorn. */
const AFTER_THORN = 'experimental.dissolve.'

/**
 * The targets that act on the whole canvas, never on one letter: the Typography sliders and the colours. Every letter
 * shows their shared live values; levels never scale them and turns never carry them.
 */
const isCanvasTarget = (id: string): boolean => id.startsWith('typography.') || id.startsWith('palette.')

/** A variable font's axes: the turn state does not carry them, so turn groups show them as the shared values do. */
const isAxisTarget = (id: string): boolean => id.startsWith('axis.')

/**
 * Whether a target reaches the letters by Thorn turns while Thorn is on (THORN_TURNS): it decides where the thorns sit
 * or which way they point, so a change of it moves a letter's thorns. Thorn's sliders but Reach, its switches and the
 * Experimental seed; every Geometry step before Distortion (Thorn picks its anchors on the letter they make); and every
 * slider and switch of Crumple, Ripple, Whorl and Slipstream but Crumple's and Ripple's Amount. Not Distortion, nor
 * those two Amounts, nor Thorn's Reach: the thorns keep their anchors and directions through their moves (thorn.ts), so
 * they stay with the shared values (and the two Amounts with the levels). Nor Dissolve's: it runs after Thorn. Nor the
 * canvas targets (isCanvasTarget) or the font's axes.
 */
export const isTurnTarget = (id: string): boolean =>
  !id.startsWith('distortion.') &&
  !KEPT_THROUGH.has(id) &&
  !id.startsWith(AFTER_THORN) &&
  !isCanvasTarget(id) &&
  !isAxisTarget(id)

/** Whether Thorn is on, so the turn targets come from the letters' turn groups (with Thorn off, levels scale them). */
const turnsOn = (params: GeometryParams): boolean => params.experimental.thorn?.enabled === true

/**
 * Whether levels leave this target at its shared position: Thorn's sliders always, the canvas targets always (they act
 * on every letter alike), the other turn targets while Thorn is on.
 */
const unscaled = (id: string, params: GeometryParams): boolean =>
  isThornTarget(id) || isCanvasTarget(id) || (turnsOn(params) && isTurnTarget(id))

/** A level's value and slider position for a target whose shared live position is `position` (see levelPosition). */
function scaled(
  spec: TargetSpec,
  base: GeometryParams,
  position: number,
  gain: number,
  bounds?: readonly [number, number],
): { value: number; position: number } {
  const value = spec.get(base)
  const bp = spec.toSlider(value)
  if (position === bp) return { value, position: bp }
  // Kept to the mappings' Range (withinBounds), clamped and snapped to the slider's step (fromSlider).
  const live = spec.fromSlider(withinBounds(bp + gain * (position - bp), bp, bounds))
  // Still within the base value's own step: the slider's exact value, as modulate keeps it.
  return live === value || live === spec.fromSlider(bp)
    ? { value, position: bp }
    : { value: live, position: spec.toSlider(live) }
}

/**
 * The slider position letters at `gain` show for a target whose shared live position is `position`: the offset from
 * the slider's own position scaled by `gain`, clamped and snapped to the step. Monotone in `position`, so a level
 * turns back only when the shared value does. The identity at gain 1, for Thorn's sliders (isThornTarget), the canvas
 * targets (isCanvasTarget), and the other turn targets while Thorn is on in the shared values `shared` (isTurnTarget;
 * `base` unless a switch flips Thorn). `bounds`: the span the mappings' Range keeps the target to (Modulated.bounds);
 * missing, the slider.
 */
export function levelPosition(
  spec: TargetSpec,
  base: GeometryParams,
  position: number,
  gain: number,
  bounds?: readonly [number, number],
  shared: GeometryParams = base,
): number {
  return gain === 1 || unscaled(spec.id, shared) ? position : scaled(spec, base, position, gain, bounds).position
}

/** One level's live parameters: their key and the driven sliders' positions. */
export interface LevelSet {
  params: GeometryParams
  key: string
  positions: ReadonlyMap<string, number>
}

function levelSet(
  base: GeometryParams,
  shared: Modulated,
  gain: number,
  middle: LevelSet,
  keyOf: (p: GeometryParams) => string,
): LevelSet {
  if (gain === 1) return middle
  let params = shared.params
  let positions: Map<string, number> | null = null
  for (const [id, position] of shared.positions) {
    const spec = targetById(id)
    // Thorn's sliders, and the other turn targets while Thorn is on, come from the letters' turn groups, unscaled.
    if (!spec || unscaled(id, shared.params)) continue
    const at = scaled(spec, base, position, gain, shared.bounds?.get(id))
    if (at.position !== position) (positions ??= new Map(shared.positions)).set(id, at.position)
    // Seeds, held values and Thorn's canvasEm come with the shared parameters.
    if (spec.get(params) !== at.value) params = spec.set(params, at.value)
  }
  if (params === shared.params && !positions) return middle
  return {
    params,
    key: params === shared.params ? middle.key : keyOf(params),
    positions: positions ?? shared.positions,
  }
}

/**
 * The quiet, shared and strong parameter sets of a frame whose shared (flash-limited) live values are `shared`.
 * The shared set is `shared` itself; a level whose gain changes no slider is the shared set (the same object).
 * `keyOf` gives a parameter set's key (paramsKey; the scheduler answers the base and shared sets from its own).
 */
export function levelSets(
  base: GeometryParams,
  shared: Modulated,
  levels: LetterLevels,
  keyOf: (p: GeometryParams) => string,
): readonly [LevelSet, LevelSet, LevelSet] {
  const middle: LevelSet = { params: shared.params, key: keyOf(shared.params), positions: shared.positions }
  const [quiet, , strong] = levels.gains
  return [levelSet(base, shared, quiet, middle, keyOf), middle, levelSet(base, shared, strong, middle, keyOf)]
}

/**
 * How large a change moving letters between levels makes: for each active letter whose level changes, its share of
 * the text times how far the two levels' sliders lie apart (summed over the driven sliders, each in slider travel).
 * 0 when `previous` is null or of another length (a first assignment is no change). Direction is ignored.
 */
export function switchSwing(
  previous: Uint8Array | null,
  next: Uint8Array,
  slots: LetterSlots,
  sets: readonly [LevelSet, LevelSet, LevelSet],
): number {
  if (!previous || previous.length !== next.length || next.length !== slots.count) return 0
  const shared = sets[SHARED].positions
  let quietShared = 0
  let sharedStrong = 0
  let quietStrong = 0
  for (const [id, position] of shared) {
    const q = sets[QUIET].positions.get(id) ?? position
    const s = sets[STRONG].positions.get(id) ?? position
    quietShared += Math.abs(q - position)
    sharedStrong += Math.abs(s - position)
    quietStrong += Math.abs(s - q)
  }
  const apart = [
    [0, quietShared, quietStrong],
    [quietShared, 0, sharedStrong],
    [quietStrong, sharedStrong, 0],
  ]
  let swing = 0
  for (let j = 0; j < next.length; j++) {
    const a = previous[j]
    const b = next[j]
    if (a !== b && slots.active[j]) swing += slots.share[j] * apart[a][b]
  }
  return swing
}

// ---- Thorn turns ----

/** The drawn letters split into Thorn turn groups (THORN_TURNS). */
export interface TurnGroups {
  /**
   * How many: THORN_TURNS.groups, 0 when no letter is drawn. With fewer letters than that (or a text of few glyphs),
   * some groups hold none: their turns only pass the time, so a letter still turns at most once in `groups` turns.
   */
  count: number
  /** The most drawn letters a group holds: ceil(drawn letters / count). */
  capacity: number
  /** The group of each occurrence (0 for a letter that is not drawn, which always shows the shared parameters). */
  of: Uint8Array
  /** How many drawn letters each group holds. */
  letters: Int32Array
  /** Each group's share of the text: the sum of its letters' shares. */
  share: Float64Array
}

const groupsOf = new WeakMap<LetterSlots, TurnGroups>()

/**
 * The turn groups of these letters (the same object for the same `slots`). Groups are made of whole glyph ids, so
 * every occurrence of a glyph turns with the others and a group costs no glyph twice; they hold at most `capacity`
 * letters each. Glyphs go largest first (ties in the order of a hash of the glyph id, so a group's letters lie all
 * over the text rather than in reading order) to the group with the most room. Only a glyph that fits whole in no
 * group (one with more than `capacity` occurrences, say) is split, over as few groups as hold it, its occurrences
 * picked by a hash. The same letters set differently get the same groups.
 */
export function turnGroups(slots: LetterSlots): TurnGroups {
  const known = groupsOf.get(slots)
  if (known) return known
  const drawn = slots.activeCount
  const count = drawn > 0 ? THORN_TURNS.groups : 0
  const capacity = count ? Math.ceil(drawn / count) : 0
  const of = new Uint8Array(slots.count)
  const letters = new Int32Array(count)
  const share = new Float64Array(count)
  const byGlyph = new Map<number, number[]>()
  for (let j = 0; j < slots.count; j++) {
    if (!slots.active[j]) continue
    const glyph = slots.index[j]
    const occurrences = byGlyph.get(glyph)
    if (occurrences) occurrences.push(j)
    else byGlyph.set(glyph, [j])
  }
  const glyphs = [...byGlyph].sort(([a, x], [b, y]) => y.length - x.length || hash01(a) - hash01(b) || a - b)
  const room = new Array<number>(count).fill(capacity)
  const roomiest = () => {
    let best = 0
    for (let g = 1; g < count; g++) if (room[g] > room[best]) best = g
    return best
  }
  for (const [, occurrences] of glyphs) {
    const g = roomiest()
    if (occurrences.length <= room[g]) {
      for (const j of occurrences) of[j] = g
      room[g] -= occurrences.length
      continue
    }
    // The groups have room for every letter (count × capacity ≥ drawn letters), so this ends.
    const order = occurrences.slice().sort((a, b) => hash01(a) - hash01(b) || a - b)
    for (let k = 0; k < order.length;) {
      const h = roomiest()
      const take = Math.min(room[h], order.length - k)
      for (const end = k + take; k < end; k++) of[order[k]] = h
      room[h] -= take
    }
  }
  for (let j = 0; j < slots.count; j++) {
    if (!slots.active[j]) continue
    letters[of[j]]++
    share[of[j]] += slots.share[j]
  }
  const groups: TurnGroups = { count, capacity, of, letters, share }
  groupsOf.set(slots, groups)
  return groups
}

/** What a turn hands on: every turn target (isTurnTarget), sliders and seeds, in TARGETS order. */
const STATE_TARGETS: readonly TargetSpec[] = TARGETS.filter((t) => isTurnTarget(t.id))
const THORN_COUNT = targetById('experimental.thorn.count')!

/**
 * The turn state a turn group shows: whether Thorn is on, and the values of the turn targets (isTurnTarget): Thorn's
 * sliders, the Experimental seed (which Crumple and Slipstream share, so they re-seed by turns too), and the shapes
 * Thorn picks its anchors on or follows them through. Thorn's canvasEm is not in it: it follows the canvas at once.
 */
export interface ThornState {
  enabled: boolean
  /** Each value, in STATE_TARGETS order (the sliders as TargetSpec.get reads them, missing ones at their fallback). */
  values: readonly number[]
}

export function thornState(params: GeometryParams): ThornState {
  return { enabled: params.experimental.thorn?.enabled === true, values: STATE_TARGETS.map((spec) => spec.get(params)) }
}

export function sameThornState(a: ThornState, b: ThornState): boolean {
  if (a === b) return true
  if (a.enabled !== b.enabled) return false
  for (let i = 0; i < a.values.length; i++) if (a.values[i] !== b.values[i]) return false
  return true
}

/** The parameters with this Thorn state; the same object when they already have it. */
export function withThornState(params: GeometryParams, state: ThornState): GeometryParams {
  let next = params
  STATE_TARGETS.forEach((spec, i) => {
    if (spec.get(next) !== state.values[i]) next = spec.set(next, state.values[i])
  })
  const { thorn } = next.experimental
  if (thorn && thorn.enabled !== state.enabled) {
    next = { ...next, experimental: { ...next.experimental, thorn: { ...thorn, enabled: state.enabled } } }
  }
  return next
}

/**
 * The turn state's sliders and switches (their places in ThornState.values) that an enabled Trigger or Toggle mapping
 * drives: hits on the beat, which every letter takes at once (ThornTurns.setPulsed), so each one shows on every letter
 * together and the letters return to the sliders' own values between hits. Seeds keep their turns.
 */
export function pulsedTargets(mappings: readonly Mapping[], also: readonly string[] = []): readonly number[] {
  const ids = new Set(
    mappings.filter((m) => m.enabled && (m.mode === 'trigger' || m.mode === 'toggle')).map((m) => m.target),
  )
  for (const id of also) ids.add(id)
  const out: number[] = []
  STATE_TARGETS.forEach((spec, i) => {
    if (ids.has(spec.id) && spec.kind !== 'jump') out.push(i)
  })
  return out
}

/** `state` with the values at `pulsed` taken from `live` (the same object when they are there already). */
function withPulsed(state: ThornState, live: ThornState, pulsed: readonly number[]): ThornState {
  if (pulsed.every((i) => state.values[i] === live.values[i])) return state
  const values = state.values.slice()
  for (const i of pulsed) values[i] = live.values[i]
  return { enabled: state.enabled, values }
}

/** How long a turn group keeps its state before a small difference reaches it too: two rounds of turns. */
const THORN_SETTLE_MS = 2 * THORN_TURNS.groups * THORN_TURNS.gapMs

/**
 * Whether a turn group showing `shown` takes the live state at its turn: Thorn switched, another seed or number of
 * thorns, a slider at least half a flash swing (FLASH_LIMITS.swing / 2 of its travel) away, or one the sound has put
 * back on its own value (in `own`, the sliders' turn state) where the group's is not, so quiet ends exactly there.
 * `settled`: the group has kept its state THORN_SETTLE_MS, and any slider away counts, so a sound that keeps a slider
 * moving by less than that still reaches the letters.
 */
export function thornDiffers(shown: ThornState, live: ThornState, own: ThornState, settled = false): boolean {
  if (shown.enabled !== live.enabled) return true
  for (let i = 0; i < STATE_TARGETS.length; i++) {
    const was = shown.values[i]
    const is = live.values[i]
    if (was === is) continue
    const spec = STATE_TARGETS[i]
    if (settled || spec === THORN_COUNT || spec.kind === 'jump' || is === own.values[i]) return true
    if (Math.abs(spec.toSlider(is) - spec.toSlider(was)) >= FLASH_LIMITS.swing / 2 - 1e-9) return true
  }
  return false
}

/**
 * How large a change a turn makes, as switchSwing measures letters moving between levels: the group's share of the
 * text times how far its turn targets' sliders move (each in slider travel), a new seed counting as a whole travel
 * (every thorn is picked afresh).
 */
export function turnSwing(share: number, from: ThornState, to: ThornState): number {
  let apart = 0
  for (let i = 0; i < STATE_TARGETS.length; i++) {
    if (from.values[i] === to.values[i]) continue
    const spec = STATE_TARGETS[i]
    apart += spec.kind === 'jump' ? 1 : Math.abs(spec.toSlider(to.values[i]) - spec.toSlider(from.values[i]))
  }
  return share * apart
}

/**
 * Whose turn state each turn group of the letters shows (THORN_TURNS); live.ts feeds it every update while Thorn is
 * on and letters are drawn, and tells it when the frames showing its turns reach the screen.
 *
 * Every group takes the live state at once, as no turn and with nothing charged, when the turns start afresh: the
 * first update after `clear` (Sound starts driving, Thorn is switched on) or when the letters of the text change
 * (sameLetters). A slider moved by hand that the sound does not drive now reaches every group at once too, as without
 * Sound. Otherwise, once the last turn has reached the screen and THORN_TURNS.gapMs has passed since, the group whose
 * turn is next takes the live state if it differs from its own (thornDiffers): one group per turn, round robin, so a
 * group turns at most once in `groups` turns. A large change (turnSwing at least FLASH_LIMITS.swing) asks the flash
 * budget first; refused, the turn waits and is asked again on the next update. A group whose state does not differ,
 * or that holds no letter, gives its turn up (the turn passes gapMs on with nothing changed), so the groups after it
 * do not wait on it, and a letter of a short text still turns at most once every groups × gapMs. A group that has kept
 * its state THORN_SETTLE_MS takes even a small difference (thornDiffers, `settled`). A mapping added or
 * removed starts nothing afresh: its changes reach the groups by turns.
 *
 * Except the sliders and switches a Trigger or Toggle mapping drives (setPulsed, pulsedTargets): every group takes
 * their live values on every update, outside the turns, so a hit on the beat shows on every letter together, and the
 * letters return to their own values together after it (the flash limit still counts them, as any driven slider).
 */
export class ThornTurns {
  /**
   * The letters the groups are for, the groups, the state each shows, and the sliders' own state at the last update;
   * null after a clear.
   */
  private current: {
    slots: LetterSlots
    groups: TurnGroups
    states: ThornState[]
    takenAt: number[]
    own: ThornState
  } | null = null
  private next = 0
  /** Turns made, and the newest on screen: the next turn waits for the last to reach the screen. */
  private made = 0
  private shown = 0
  /** When the last turn reached the screen, or the last group gave its turn up (or the turns started). */
  private slotAt = -Infinity
  /** The turn state's places every group takes at once (pulsedTargets). */
  private pulsed: readonly number[] = []

  /** The turn state's places that skip the turns (pulsedTargets): every group takes them on each update. */
  setPulsed(pulsed: readonly number[]): void {
    this.pulsed = pulsed
  }

  /** The groups, null until the first update after a clear. */
  get groups(): TurnGroups | null {
    return this.current?.groups ?? null
  }

  /** The turn state each group shows. */
  get states(): readonly ThornState[] {
    return this.current?.states ?? []
  }

  /** How many turns have been made: a frame records it, and shownUpTo hears it back. */
  get turns(): number {
    return this.made
  }

  /**
   * One update.
   * @param live the live turn state (the shared, flash-limited values)
   * @param own the sliders' own turn state: a slider the sound puts back on its own value always counts as a difference
   * @param now the time (ms) the screen's frames are timed in
   * @param take asks the flash budget for a large change; false: the turn waits
   */
  update(slots: LetterSlots, live: ThornState, own: ThornState, now: number, take: () => boolean): void {
    const current = this.current
    if (!current || !sameLetters(current.slots, slots)) {
      const groups = turnGroups(slots)
      const takenAt = new Array<number>(groups.count).fill(now)
      this.current = { slots, groups, states: new Array<ThornState>(groups.count).fill(live), takenAt, own }
      this.next = 0
      this.shown = this.made
      this.slotAt = now
      return
    }
    // The same letters set differently: the same groups, with their new shares of the text.
    if (current.slots !== slots) {
      current.slots = slots
      current.groups = turnGroups(slots)
    }
    if (!sameThornState(current.own, own)) moveByHand(current.states, current.own, own, live)
    current.own = own
    const { groups, states, takenAt } = current
    if (this.pulsed.length) for (let h = 0; h < states.length; h++) states[h] = withPulsed(states[h], live, this.pulsed)
    if (this.shown < this.made || now - this.slotAt < THORN_TURNS.gapMs || groups.count === 0) return
    const g = this.next
    const differs = (h: number) =>
      groups.letters[h] > 0 && thornDiffers(states[h], live, own, now - takenAt[h] >= THORN_SETTLE_MS)
    if (!differs(g)) {
      if (states.some((_, h) => differs(h))) {
        // A group without letters keeps up with the live state, unseen.
        if (groups.letters[g] === 0) states[g] = live
        this.next = (g + 1) % groups.count
        this.slotAt = now
      }
      return
    }
    if (turnSwing(groups.share[g], states[g], live) >= FLASH_LIMITS.swing - 1e-9 && !take()) return
    states[g] = live
    takenAt[g] = now
    this.next = (g + 1) % groups.count
    this.made++
  }

  /** A frame showing the turns up to `turn` (a value of `turns`) reached the screen at `now`. */
  shownUpTo(turn: number, now: number): void {
    if (turn <= this.shown) return
    this.shown = turn
    this.slotAt = now
  }

  /** No groups (Thorn is off, no letter is drawn, or Sound stopped driving): the next update starts afresh. */
  clear(): void {
    this.current = null
    this.shown = this.made
    this.slotAt = -Infinity
  }
}

/**
 * The sliders' own turn state went from `was` to `own`: a value that moved and that the sound leaves at the slider's
 * value (the live value is the new one) reaches every group at once, as the slider shows it. Groups that showed the
 * same state still do.
 */
function moveByHand(states: ThornState[], was: ThornState, own: ThornState, live: ThornState): void {
  const moved: number[] = []
  for (let i = 0; i < own.values.length; i++)
    if (own.values[i] !== was.values[i] && live.values[i] === own.values[i]) moved.push(i)
  if (!moved.length) return
  const made = new Map<ThornState, ThornState>()
  for (let g = 0; g < states.length; g++) {
    const state = states[g]
    let next = made.get(state)
    if (!next) {
      next = moved.some((i) => state.values[i] !== own.values[i])
        ? { enabled: state.enabled, values: state.values.slice() }
        : state
      if (next !== state) for (const i of moved) (next.values as number[])[i] = own.values[i]
      made.set(state, next)
    }
    states[g] = next
  }
}

/**
 * Each turn group's quiet, shared and strong sets: the levels' `sets` (with the live Thorn state, which levels never
 * scale) with the group's Thorn state; a group showing the live state has `sets` themselves, and groups showing the
 * same state object the same sets. Their positions are the sliders' with the group's Thorn values.
 */
export function turnSets(
  sets: readonly [LevelSet, LevelSet, LevelSet],
  states: readonly ThornState[],
  keyOf: (p: GeometryParams) => string,
): (readonly [LevelSet, LevelSet, LevelSet])[] {
  const live = thornState(sets[SHARED].params)
  const byState = new Map<ThornState, readonly [LevelSet, LevelSet, LevelSet]>()
  return states.map((state) => {
    if (sameThornState(state, live)) return sets
    const known = byState.get(state)
    if (known) return known
    const made = new Map<LevelSet, LevelSet>()
    const withState = (set: LevelSet): LevelSet => {
      let out = made.get(set)
      if (out) return out
      const params = withThornState(set.params, state)
      let positions: Map<string, number> | null = null
      for (const [id, position] of set.positions) {
        const spec = isTurnTarget(id) ? targetById(id) : undefined
        const at = spec ? spec.toSlider(spec.get(params)) : position
        if (at !== position) (positions ??= new Map(set.positions)).set(id, at)
      }
      out = { params, key: keyOf(params), positions: positions ?? set.positions }
      made.set(set, out)
      return out
    }
    const group = [withState(sets[QUIET]), withState(sets[SHARED]), withState(sets[STRONG])] as const
    byState.set(state, group)
    return group
  })
}

/** The letters of a live frame: which parameter set each shows, and the extra parameter sets they need. */
export interface LetterFrame {
  /** The text this belongs to (identity). */
  slots: LetterSlots
  /**
   * The keys of the parameter sets letters show: the quiet, shared and strong levels ('' for a level no letter shows;
   * the shared one is the frame's own, which every other letter shows), then, with Thorn turns, those of letters whose
   * turn group shows other Thorn settings (THORN_TURNS).
   */
  keys: readonly string[]
  /** Per occurrence, which of `keys` it shows; a set whose key is the shared key counts as SHARED. */
  assign: Uint8Array
  /**
   * Strong, then quiet, then the others in order: each used set's parameters, key and the glyph ids of its active
   * letters (each once, in reading order).
   */
  jobs: readonly GeometryJob[]
  /**
   * With Thorn turns, the glyph ids of the occurrences that show the shared key (spaces included): the shared set is
   * computed only for them (and the selected glyph, for its statistics; see FrameJob.within). Null without Thorn turns:
   * for every glyph shown.
   */
  sharedGlyphs: ReadonlySet<number> | null
  /**
   * Stands for the whole frame: the keys, the text and the assignment. With Thorn turns and no drawn letter on the
   * shared key, it leaves that key out: the shared values can then move (a turn waits) without a new frame to show.
   */
  key: string
}

/**
 * Whether two sets of letters are the same letters: the same glyph at every occurrence, the same ones drawn. The same
 * text set differently (tracking, line height, alignment, slant) is: only where the letters sit (`t`) and their
 * shares move, so a frame assigned for one shows on the other.
 */
export function sameLetters(a: LetterSlots, b: LetterSlots): boolean {
  if (a === b) return true
  if (a.count !== b.count || a.activeCount !== b.activeCount) return false
  for (let j = 0; j < a.count; j++) if (a.index[j] !== b.index[j] || a.active[j] !== b.active[j]) return false
  return true
}

/** Whether `shaped` sets the glyphs `slots` were made for, in the same order (the same text set otherwise). */
export function setsSlots(shaped: ShapedSpecimen, slots: LetterSlots): boolean {
  let j = 0
  for (const line of shaped.lines) {
    for (const glyph of line.glyphs) if (j >= slots.count || slots.index[j++] !== glyph.index) return false
  }
  return j === slots.count
}

/** The frame when it was assigned for these letters (sameLetters: a restyled text keeps it), else null. */
export function lettersOn(frame: LetterFrame | null | undefined, slots: LetterSlots): LetterFrame | null {
  return frame && sameLetters(frame.slots, slots) ? frame : null
}

/**
 * A serial per LetterSlots object, so frames for another text never share a key (nor the same text set differently,
 * whose letters may take other levels).
 */
const slotsSerial = new WeakMap<LetterSlots, number>()
let nextSerial = 1

function serialOf(slots: LetterSlots): number {
  let serial = slotsSerial.get(slots)
  if (serial === undefined) slotsSerial.set(slots, (serial = nextSerial++))
  return serial
}

/** A frame's Thorn turn groups (THORN_TURNS): each occurrence's group, and each group's level sets (turnSets). */
export interface TurnSets {
  /** The group of each occurrence (TurnGroups.of). */
  of: Uint8Array
  /** Per group: the quiet, shared and strong sets with the group's Thorn state. */
  sets: readonly (readonly [LevelSet, LevelSet, LevelSet])[]
}

/**
 * The letter frame for an assignment, or null when every letter shows the shared key (after a set whose key is the
 * shared key is folded into it). `sets` are the levels of the shared key's own Thorn state; with `turns`, each letter
 * shows its level of its turn group's sets instead.
 */
export function buildLetterFrame(
  sets: readonly [LevelSet, LevelSet, LevelSet],
  assign: Uint8Array,
  slots: LetterSlots,
  sharedKey: string,
  turns: TurnSets | null = null,
): LetterFrame | null {
  const n = slots.count
  if (assign.length !== n) return null
  const folded = new Uint8Array(n)
  const keys: string[] = ['', sharedKey, '']
  const params: GeometryParams[] = [sets[QUIET].params, sets[SHARED].params, sets[STRONG].params]
  const ids: Set<number>[] = [new Set(), new Set(), new Set()]
  const others = new Map<string, number>()
  const sharedGlyphs = turns ? new Set<number>() : null
  let drawnShared = false
  for (let j = 0; j < n; j++) {
    const level = assign[j] === QUIET || assign[j] === STRONG ? assign[j] : SHARED
    const set = turns ? turns.sets[turns.of[j]][level] : level === SHARED ? null : sets[level]
    if (!slots.active[j] || !set || set.key === sharedKey) {
      folded[j] = SHARED
      sharedGlyphs?.add(slots.index[j])
      if (slots.active[j]) drawnShared = true
      continue
    }
    let k = set.key === sets[QUIET].key ? QUIET : set.key === sets[STRONG].key ? STRONG : others.get(set.key)
    if (k === undefined) {
      k = keys.length
      others.set(set.key, k)
      keys.push(set.key)
      params.push(set.params)
      ids.push(new Set())
    }
    folded[j] = k
    ids[k].add(slots.index[j])
  }
  if (ids.every((used) => used.size === 0)) return null
  keys[QUIET] = ids[QUIET].size ? sets[QUIET].key : ''
  keys[STRONG] = ids[STRONG].size ? sets[STRONG].key : ''
  const jobs: GeometryJob[] = []
  let extra = ''
  for (const k of [STRONG, QUIET]) if (ids[k].size) jobs.push({ params: params[k], key: keys[k], indices: [...ids[k]] })
  for (let k = 3; k < keys.length; k++) {
    jobs.push({ params: params[k], key: keys[k], indices: [...ids[k]] })
    extra += `${keys[k]}\u001f`
  }
  // One character per occurrence: '0'–'2' for the levels, as before Thorn turns, then on for the other sets.
  let digits = ''
  for (let j = 0; j < n; j++) digits += String.fromCharCode(48 + folded[j])
  const shown = turns && !drawnShared ? '' : sharedKey
  const key = `${shown}\u001f${keys[QUIET]}\u001f${keys[STRONG]}\u001f${extra}${serialOf(slots)}:${digits}`
  return { slots, keys, assign: folded, jobs, sharedGlyphs, key }
}

/**
 * The key of the parameters this occurrence shows: its set's, or `sharedKey` when it shows the shared key (or there
 * is no frame). The frame must be for the letters shown (lettersOn).
 */
export function levelKeyAt(frame: LetterFrame | null, occurrence: number, sharedKey: string): string {
  if (!frame) return sharedKey
  const k = frame.assign[occurrence]
  return k !== SHARED && frame.keys[k] ? frame.keys[k] : sharedKey
}
