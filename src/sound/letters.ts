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
// snapped to the slider's step. So every letter on screen is still a result the sliders could produce, and one frame
// asks for at most three parameter sets.

import type { GeometryJob, GeometryParams } from '../geometry/types'
import type { ShapedSpecimen } from '../specimen/scene'
import { targetById, type Modulated, type TargetSpec } from './mapping'
import type { FeatureFrame, ResponseSettings } from './types'

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
    const x = Math.log(contrastGain(r.contrast, j, frame.time) * pitchWeight(r.pitchReactive, slots.t[j], pitch, frame.pitchConfidence))
    const was = before ? before[j] : SHARED
    if (was === STRONG && x > hi - mHi) assign[j] = STRONG
    else if (was === QUIET && x < lo + mLo) assign[j] = QUIET
    else assign[j] = x > hi + mHi ? STRONG : x < lo - mLo ? QUIET : SHARED
  }
  return assign
}

/** A level's value and slider position for a target whose shared live position is `position` (see levelPosition). */
function scaled(spec: TargetSpec, base: GeometryParams, position: number, gain: number): { value: number; position: number } {
  const value = spec.get(base)
  const bp = spec.toSlider(value)
  if (position === bp) return { value, position: bp }
  // Clamped and snapped to the slider's step (fromSlider).
  const live = spec.fromSlider(bp + gain * (position - bp))
  // Still within the base value's own step: the slider's exact value, as modulate keeps it.
  return live === value || live === spec.fromSlider(bp) ? { value, position: bp } : { value: live, position: spec.toSlider(live) }
}

/**
 * The slider position letters at `gain` show for a target whose shared live position is `position`: the offset from
 * the slider's own position scaled by `gain`, clamped and snapped to the step. Monotone in `position`, so a level
 * turns back only when the shared value does. The identity at gain 1.
 */
export function levelPosition(spec: TargetSpec, base: GeometryParams, position: number, gain: number): number {
  return gain === 1 ? position : scaled(spec, base, position, gain).position
}

/** One level's live parameters: their key and the driven sliders' positions. */
export interface LevelSet {
  params: GeometryParams
  key: string
  positions: ReadonlyMap<string, number>
}

function levelSet(base: GeometryParams, shared: Modulated, gain: number, middle: LevelSet, keyOf: (p: GeometryParams) => string): LevelSet {
  if (gain === 1) return middle
  let params = shared.params
  let positions: Map<string, number> | null = null
  for (const [id, position] of shared.positions) {
    const spec = targetById(id)
    if (!spec) continue
    const at = scaled(spec, base, position, gain)
    if (at.position !== position) (positions ??= new Map(shared.positions)).set(id, at.position)
    // Seeds, held values and Thorn's canvasEm come with the shared parameters.
    if (spec.get(params) !== at.value) params = spec.set(params, at.value)
  }
  if (params === shared.params && !positions) return middle
  return { params, key: params === shared.params ? middle.key : keyOf(params), positions: positions ?? shared.positions }
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

/** The letters of a live frame: which level each shows, and the extra parameter sets they need. */
export interface LetterFrame {
  /** The text this belongs to (identity). */
  slots: LetterSlots
  /** Each level's key; '' for a level no letter shows. */
  keys: readonly [quiet: string, shared: string, strong: string]
  /** The level per occurrence; a level whose key is the shared key counts as SHARED. */
  assign: Uint8Array
  /** Strong, then quiet: each used level's parameters, key and the glyph ids of its active letters (each once, in reading order). */
  jobs: readonly GeometryJob[]
  /** Stands for the whole frame: the keys, the text and the assignment. */
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

/**
 * The letter frame for an assignment, or null when every letter shows the shared level (after a level whose key is
 * the shared key is folded into it).
 */
export function buildLetterFrame(
  sets: readonly [LevelSet, LevelSet, LevelSet],
  assign: Uint8Array,
  slots: LetterSlots,
  sharedKey: string,
): LetterFrame | null {
  const n = slots.count
  if (assign.length !== n) return null
  const folded = new Uint8Array(n)
  const ids: [Set<number>, Set<number>] = [new Set(), new Set()]
  for (let j = 0; j < n; j++) {
    const level = assign[j]
    if (!slots.active[j] || (level !== QUIET && level !== STRONG) || sets[level].key === sharedKey) {
      folded[j] = SHARED
      continue
    }
    folded[j] = level
    ids[level === QUIET ? 0 : 1].add(slots.index[j])
  }
  if (ids[0].size === 0 && ids[1].size === 0) return null
  const keys = [ids[0].size ? sets[QUIET].key : '', sharedKey, ids[1].size ? sets[STRONG].key : ''] as const
  const jobs: GeometryJob[] = []
  if (ids[1].size) jobs.push({ params: sets[STRONG].params, key: keys[2], indices: [...ids[1]] })
  if (ids[0].size) jobs.push({ params: sets[QUIET].params, key: keys[0], indices: [...ids[0]] })
  let digits = ''
  for (let j = 0; j < n; j++) digits += folded[j]
  return { slots, keys, assign: folded, jobs, key: `${sharedKey}\u001f${keys[0]}\u001f${keys[2]}\u001f${serialOf(slots)}:${digits}` }
}

/**
 * The key of the parameters this occurrence shows: its level's, or `sharedKey` when it is on the shared level (or
 * there is no frame). The frame must be for the letters shown (lettersOn).
 */
export function levelKeyAt(frame: LetterFrame | null, occurrence: number, sharedKey: string): string {
  if (!frame) return sharedKey
  const level = frame.assign[occurrence]
  return level === QUIET || level === STRONG ? frame.keys[level] : sharedKey
}
