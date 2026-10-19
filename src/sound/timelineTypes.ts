// The precomputed file timeline: packed feature frames, the playhead, and the planned commits the director shows.

import type { FrameJob } from '../geometry/types'
import type { LiveCommit } from './live'
import type { FeatureFrame } from './types'

export const PRECOMPUTE_LIMITS = {
  /** Feature frames per media second. */
  gridHz: 60,
  /** Longer files stay on the live path (PCM memory). */
  maxSeconds: 360,
  /** The parameter timeline's horizon. */
  planAheadMs: 3000,
  /** The adaptive geometry horizon. */
  geometryAheadMs: [1000, 3000] as const,
  keepBehindMs: 1000,
  /** Priority segments and re-plans start this far before the playhead. */
  warmupMs: 4000,
  /** Planned commits ready ahead before the director takes over. */
  enterReadyMs: 500,
  /** A late commit is waited for this long before handing back to live. */
  holdMs: 250,
  planSliceMs: 4,
} as const

/** FeatureFrame's numeric fields in pack order (time is the grid's; onset and silent as 0/1). */
export const FEATURE_FIELDS = [
  'levelDb', 'level', 'swell', 'bass', 'mids', 'treble', 'brightness', 'pitch', 'melody', 'pitchConfidence',
  'pitchLow', 'pitchHigh', 'beat', 'activity', 'pan', 'onset', 'silent',
] as const satisfies readonly Exclude<keyof FeatureFrame, 'time'>[]
export const FEATURE_STRIDE: number = FEATURE_FIELDS.length

type FeatureField = (typeof FEATURE_FIELDS)[number]
type NumericField = Exclude<FeatureField, 'onset' | 'silent'>
/** Fails to compile when FeatureFrame gains a field FEATURE_FIELDS does not pack. */
const PACKS_EVERY_FIELD: [Exclude<keyof FeatureFrame, 'time' | FeatureField>] extends [never] ? true : never = true
void PACKS_EVERY_FIELD

/** A run of frames on the grid: frame k is at media ms (start + k)·1000/gridHz; values row-major, Float64. */
export interface FeatureColumns { start: number; count: number; values: Float64Array }

/** Writes `frame` into row `row` of `into` (FEATURE_STRIDE values); -Infinity (digital silence) is kept as is. */
export function packFrame(frame: FeatureFrame, into: Float64Array, row: number): void {
  const at = row * FEATURE_STRIDE
  for (let f = 0; f < FEATURE_STRIDE; f++) {
    const field = FEATURE_FIELDS[f]
    const value = field === 'onset' || field === 'silent' ? (frame[field] ? 1 : 0) : frame[field]
    into[at + f] = value
  }
}

/** Reads row `row` of `values` back into a frame measured at `time`. */
export function unpackFrame(values: Float64Array, row: number, time: number): FeatureFrame {
  const at = row * FEATURE_STRIDE
  const frame = { time } as FeatureFrame
  for (let f = 0; f < FEATURE_STRIDE; f++) {
    const field = FEATURE_FIELDS[f]
    if (field === 'onset' || field === 'silent') frame[field] = values[at + f] !== 0
    else frame[field as NumericField] = values[at + f]
  }
  return frame
}

/** Where playback is: media ms as heard now (latency compensated) at page time `wallMs`. */
export interface Playhead {
  mediaMs: number
  wallMs: number
  playing: boolean
  /** Bumps on seek, loop and load. */
  generation: number
}

/** When a commit the director handed to React is shown, for Glide (useSceneGlide) and the plan chain. */
export interface CommitTiming {
  /** Page time the commit's media time corresponds to (may be a little in the past). */
  wallMs: number
  mediaMs: number
  generation: number
  seq: number
  /** The previous selected commit's seq (the chain's), or -1. */
  prevSeq: number
  /** Per occurrence (reading order), its glide lineage id; null without Glide. */
  lineage: Int32Array | null
}

/** What the page scheduler adopts with a planned commit (markers, seeds, status, Freeze). Opaque outside live.ts. */
export interface AdoptedState { readonly brand: 'adopted' }

export interface PlannedCommit {
  generation: number
  seq: number
  mediaMs: number
  /** null: the sliders' own (exact restore). */
  commit: Omit<LiveCommit, 'seq' | 'timing'> | null
  /** The geometry this commit needs (shared set with `within`, then the letters' jobs); [] for the sliders' own. */
  jobs: readonly FrameJob[]
  /** Per occurrence (reading order) the key it shows and its glyph index (letterSlots order). */
  keys: readonly string[]
  indices: Int32Array
  adopted: AdoptedState
}
