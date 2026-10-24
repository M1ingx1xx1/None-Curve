// Live sound-driven parameters: the scheduler that turns each measured frame into live geometry
// parameters (at most one geometry request in flight), the live slider positions shown as markers,
// the live seeds, the live frame rate, the flash limit, and Freeze (see docs/SOUND_PLAN.md §5, §8, §9, §10).
//
// Every animation frame the engine measures, each mapping's feature is shaped (ShapingTracker: Smooth, Trigger,
// Toggle), the driven seeds' jumps are counted (JumpTracker), the mappings are applied to the slider values and seeds (modulate), and the flash limit holds back driven
// sliders that would turn back too often (FlashLimiter); the jumps and the sliders' turns share one flash
// budget (flash.ts). A new parameter set is sent to the geometry worker only when it differs from the last
// one, the previous one's results have all arrived, and at least 1/30 s has passed: the frame rate follows
// what the geometry can keep up with. It goes to React once its glyphs have arrived, so each frame renders
// once, complete. While Sound is not driving (no source runs, Drive letters is off, Strength is 0, or no font
// is loaded), the sliders' own parameters are used unchanged.
//
// With Motion contrast or Pitch reactive above 0, each letter of the text also takes one of three levels
// (letters.ts): the shared live values, or a quieter or stronger set derived from them. One request per frame
// asks for all of them (the shared set first, for every glyph shown). The flash limit counts every level that
// letters show, and letters moving between levels count as a change of their own, from the same budget.
//
// Sound also drives the canvas: the typography and colours (DrivenParams, never part of the geometry key) and a variable
// font's axes (GeometryParams.variation, which are). A frame's key is its geometry key with its look (lookKey); a frame
// whose glyphs are the sliders' own asks for nothing and is committed at once, its look changes (lookChanges) with it.
//
// While Thorn is on, the settings that decide where the thorns sit and which way they point (Thorn's own but Reach, the
// Experimental seed and the shapes before Thorn: isTurnTarget, letters.ts) reach the letters by turns (THORN_TURNS):
// each turn group of letters shows the turn state it took at its last turn, and a turn hands the live state to the
// next group, at most every THORN_TURNS.gapMs on screen, as a change of its own from the same budget. Levels do not
// scale them. The frame's own parameters stay the shared live values: the markers, the status and Freeze keep to them,
// and only the glyphs of letters that show them are computed with them.
//
// While a file plays with precompute on (state/flags.ts), the director (director.ts) shows commits planned ahead of the
// playhead by a second scheduler on a virtual clock (planner.ts). The page's scheduler then follows (follow): it
// measures nothing and commits nothing, and adopts each planned commit's markers, seeds, status, Freeze state and flash
// edges (adopt). When the plan cannot cover the playhead, the director hands back, and the scheduler goes on from the
// next measured frame as before.

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type Dispatch } from 'react'
import { paramsKey } from '../geometry/paramsKey'
import type { FrameJob, GeometryParams } from '../geometry/types'
import { withThornCanvasEm, type Action } from '../state/editorState'
import { RUNTIME_FLAGS } from '../state/flags'
import { geometryClient } from '../state/geometryClient'
import { connectDirector } from './director'
import { getSoundEngine, subscribeStateKeys } from './engine'
import { FLASH_LIMITS, FlashBudget } from './flash'
import { JumpTracker } from './jumps'
import {
  assignLevels,
  buildLetterFrame,
  letterLevels,
  levelPosition,
  levelSets,
  NO_SLOTS,
  pulsedTargets,
  QUIET,
  sameThornState,
  SHARED,
  STRONG,
  switchSwing,
  thornState,
  ThornTurns,
  turnSets,
  type LetterFrame,
  type LetterLevels,
  type LetterSlots,
  type LevelSet,
} from './letters'
import {
  lookChanges,
  lookKey,
  modulate,
  PLAIN_SWITCHES,
  plainPulse,
  targetById,
  type DrivenParams,
  type LookChanges,
  type Mapping,
  type Modulated,
  type ParamPatch,
} from './mapping'
import { mappingStore } from './mappingStore'
import { NO_SHAPING, ShapingTracker, type ShapedFrame } from './shaping'
import type { AdoptedState, CommitTiming } from './timelineTypes'
import { NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureFrame, type ResponseSettings, type SoundState } from './types'

export interface LiveStatus {
  /**
   * Sound is moving the letters now: a font is loaded, a source runs, Drive letters is on, and a mapping acts (on a
   * slider or a seed).
   */
  driving: boolean
  /**
   * Live frames per second the geometry keeps up with while driving: 1000 ms ÷ the smoothed time from
   * a commit to its last result, at most 30 (0 when not). Steady while the live values hold still.
   */
  fps: number
  /** Driving, but slower than about 8 fps: the Sound tab suggests lighter settings or a shorter text. */
  slow: boolean
  /** The live parameters differ from the sliders (Freeze would change something). */
  differs: boolean
}

export const LIVE_LIMITS = {
  /** Highest live frame rate: a new parameter set at most every 1/30 s. */
  maxFps: 30,
  /** Below this frame rate for slowSeconds, the Sound tab suggests lighter settings. */
  slowFps: 8,
  slowSeconds: 2,
  /** Markers move at most this often (per second). */
  markerRate: 15,
  /** The status line's frame rate changes at most this often (per second). */
  statusRate: 4,
  /**
   * Letters moving between levels over the frames shown within this many ms count as one move for the flash
   * limit: a note change reaches the screen over a few frames (the pitch is smoothed), and shows as one change.
   */
  switchSpanMs: 250,
} as const

const MIN_COMMIT_MS = 1000 / LIVE_LIMITS.maxFps
const MARKER_MS = 1000 / LIVE_LIMITS.markerRate
const STATUS_MS = 1000 / LIVE_LIMITS.statusRate
/** Weight of the newest frame in the smoothed frame time. */
const SMOOTHING = 0.3
/** Marker positions are rounded to this (a fraction of the slider): finer than a pixel on any slider. */
const POSITION_GRID = 1000
/** A commit that never rendered (it should always render) stops holding up the next one after this (ms). */
const STUCK_MS = 1000

const NOT_DRIVING: LiveStatus = { driving: false, fps: 0, slow: false, differs: false }

/** The parameter groups sound can drive (GeometryParams, then the canvas's typography and colours), in the order Freeze writes them. */
const GROUPS = [
  'flatten',
  'random',
  'squaring',
  'anchors',
  'grid',
  'distortion',
  'experimental',
  'typography',
  'palette',
] as const

/** What Freeze writes: whole groups, as the editor's updateParams action takes them. */
export type FrozenGroups = Partial<Pick<Required<DrivenParams>, ParamPatch['group']>>

/** Live values held back by the flash limit, by target id. */
type Holds = ReadonlyMap<string, number>

/** Jumps of the driven seeds, by target id (JumpTracker). */
type Jumps = ReadonlyMap<string, number>

const NO_JUMPS: Jumps = new Map()

/**
 * A frame as shown: its key, the frame, shaping, jumps and held values it came from, whether it is the sliders' own,
 * and whether its shared live values differ from the sliders (Freeze would change something).
 */
type Shown = {
  key: string
  frame: FeatureFrame
  shaped: ShapedFrame
  jumps: Jumps
  holds: Holds | null
  isBase: boolean
  differs: boolean
}
/** A frame waiting to be committed to React: its glyphs are being computed. `turn`: the Thorn turns it shows. */
type Next = {
  shown: Shown
  params: DrivenParams | null
  letters: LetterFrame | null
  look: LookChanges | null
  turn: number
}

/**
 * The planner's flash budget (planner.ts): also notes the time of every edge it lets through, so each planned commit
 * carries the edges that reach the screen with it, and the page's budget can count them (adopt).
 */
class RecordingBudget extends FlashBudget {
  private recorded: number[] = []

  take(time: number): boolean {
    const allowed = super.take(time)
    if (allowed) this.note(time)
    return allowed
  }

  spend(time: number): void {
    super.spend(time)
    this.note(time)
  }

  /** The edges noted since the last call. */
  drain(): number[] {
    const out = this.recorded
    this.recorded = []
    return out
  }

  private note(time: number) {
    const last = this.recorded[this.recorded.length - 1]
    // One measured frame's edges count once (FlashBudget's own rule).
    if (last === undefined || Math.abs(time - last) >= 1) this.recorded.push(time)
  }
}

/**
 * What a planned commit leaves the page's scheduler with (AdoptedState, opaque outside this file): whether Sound
 * drives, the frame as shown (Freeze, the status), the markers and seeds, the flash edges since the last commit
 * (in the planner's frame times: media ms + PLANNER_CLOCK_OFFSET), and the flash limit's state (the sliders' swings and
 * the seeds' jumps), which the live path goes on from when the director hands back.
 */
interface PlannedState extends AdoptedState {
  readonly brand: 'adopted'
  driving: boolean
  shown: Shown | null
  holdsCommit: boolean
  positions: ReadonlyMap<string, number>
  seeds: ReadonlyMap<string, number>
  edges: readonly number[]
  limiter: LimiterSnapshot
  jumps: ReadonlyMap<string, number>
}

/** The flash edges (planner frame times) a planned commit brings to the screen: selection keeps such commits. */
export function plannedEdges(adopted: AdoptedState): readonly number[] {
  return (adopted as PlannedState).edges
}

const NO_EDGES: readonly number[] = []

/**
 * A planned state for keeping in the whole-file plan (sound/planStore.ts): the same values, with its long strings
 * (the shown frame's key) interned through `intern`, no edges as one shared empty list, and each shown frame copied
 * once (`shownCopies` remembers the copy, so consecutive commits that show one frame keep sharing it).
 */
export function compactPlanned(
  adopted: AdoptedState,
  intern: (text: string) => string,
  shownCopies: WeakMap<object, object>,
): AdoptedState {
  const state = adopted as PlannedState
  let shown = state.shown
  if (shown) {
    const known = shownCopies.get(shown) as Shown | undefined
    if (known) shown = known
    else {
      const copy = { ...shown, key: intern(shown.key) }
      shownCopies.set(shown, copy)
      shownCopies.set(copy, copy)
      shown = copy
    }
  }
  const compact: PlannedState = { ...state, shown, edges: state.edges.length ? state.edges : NO_EDGES }
  return compact
}

/** Planner frame times are media ms plus this (JumpTracker ignores frames at time 0). */
export const PLANNER_CLOCK_OFFSET = 1

/** What the scheduler is fed besides the frames (setBase, setMappings, setSlots): the planner mirrors it. */
export interface LiveInputs {
  base: DrivenParams | null
  hasFont: boolean
  mappings: readonly Mapping[]
  drive: boolean
  response: ResponseSettings
  slots: LetterSlots
}

export interface LiveOptions {
  /** Note the flash edges for planned commits (the planner's scheduler). */
  recordEdges?: boolean
}

/** The levels letters show besides the shared one, for the flash limit: every level's offset is measured from `base`. */
export interface LevelSpread {
  /** The sliders' own values. */
  base: GeometryParams
  /** The gains (other than 1) of the levels some letter shows or is about to. */
  gains: readonly number[]
}

/** How far a slider moving to `position` moves back from its swing's extreme (≤ 0: not back). */
const backMove = (dir: number, extreme: number, position: number) =>
  dir > 0 ? extreme - position : dir < 0 ? position - extreme : Math.abs(position - extreme)

/**
 * Keeps the driven sliders to the flash limit (SOUND_PLAN §10, flash.ts). Each slider has a direction and the
 * extreme it has reached that way; moving back from that extreme (or, before its first turn, away from where it
 * started) is a turn. A frame is a large change (an edge) when the sliders' moves back add up to FLASH_LIMITS.swing
 * of a slider's travel: one slider swinging that far, or several smaller swings together. An edge takes from the
 * flash budget shared with the seeds' jumps, and every slider moving back turns. When the budget is spent, the
 * sliders moving back keep their last passed values until it frees up; the others pass. Counted on the slider
 * positions as shown (after rounding to the step), so a coarse slider flipping one step back and forth counts
 * too. A held value is one the slider produced a moment ago (§2), and the markers and Freeze use the same values
 * as the screen.
 *
 * With letters on other levels (`spread`), a slider's move back is the largest of its shared move and each such
 * level's move (levelPosition): a level is a monotone image of the shared position, so it turns only when the
 * shared value does, and holding the shared value holds every level. Every letter on screen keeps to the limit.
 */
export class FlashLimiter {
  /** Per target: the value and position last passed on, the extreme of its current swing, and its direction (−1, 0, 1). */
  private targets = new Map<string, LimiterTarget>()
  /** How far each target moves back in this frame (reused). */
  private readonly back = new Map<string, number>()

  /** @param budget the flash budget, shared with the seeds' jumps (LiveScheduler); its own when alone */
  constructor(private readonly budget = new FlashBudget()) {}

  /**
   * The modulated parameters with held values put back, and the held values (null when none).
   * @param time the measured frame's time (ms), as JumpTracker uses it, so one frame's slider turns and jumps are one edge
   * @param spread the other levels letters show (none: the shared values alone)
   */
  limit(modulated: Modulated, time: number, spread?: LevelSpread): { modulated: Modulated; holds: Holds | null } {
    for (const id of this.targets.keys()) if (!modulated.positions.has(id)) this.targets.delete(id)
    const back = this.back
    back.clear()
    const levels = spread && spread.gains.length > 0 ? spread : null
    let total = 0
    for (const [id, position] of modulated.positions) {
      const state = this.targets.get(id)
      if (!state) continue
      const { dir, extreme } = state
      let amount = backMove(dir, extreme, position)
      const spec = levels && targetById(id)
      if (levels && spec) {
        for (const gain of levels.gains) {
          const bounds = modulated.bounds?.get(id)
          const level = backMove(
            dir,
            levelPosition(spec, levels.base, extreme, gain, bounds, modulated.params),
            levelPosition(spec, levels.base, position, gain, bounds, modulated.params),
          )
          if (level > amount) amount = level
        }
      }
      if (amount > 0) {
        back.set(id, amount)
        total += amount
      }
    }
    // A hair under the swing, so a swing of exactly FLASH_LIMITS.swing on the step grid counts despite rounding.
    const edge = total >= FLASH_LIMITS.swing - 1e-9
    const allowed = !edge || this.budget.take(time)
    let params = modulated.params
    let positions: Map<string, number> | null = null
    let holds: Map<string, number> | null = null
    for (const [id, position] of modulated.positions) {
      const spec = targetById(id)
      if (!spec) continue
      const value = spec.get(modulated.params)
      const state = this.targets.get(id)
      if (!state) {
        this.targets.set(id, { value, position, extreme: position, dir: 0 })
        continue
      }
      if (edge && back.has(id)) {
        if (!allowed) {
          if (spec.get(params) !== state.value) params = spec.set(params, state.value)
          positions ??= new Map(modulated.positions)
          positions.set(id, state.position)
          holds ??= new Map()
          holds.set(id, state.value)
          continue
        }
        state.dir = position > state.extreme ? 1 : -1
        state.extreme = position
      } else if ((state.dir > 0 && position > state.extreme) || (state.dir < 0 && position < state.extreme)) {
        state.extreme = position
      }
      state.value = value
      state.position = position
    }
    return { modulated: positions ? { ...modulated, params, positions } : modulated, holds }
  }

  /** Forgets every slider (Sound stopped driving); the budget keeps its edges. */
  reset() {
    this.targets.clear()
  }

  /** A copy of every slider's swing (the planner's, carried by each planned commit). */
  snapshot(): LimiterSnapshot {
    const copy = new Map<string, LimiterTarget>()
    for (const [id, state] of this.targets) copy.set(id, { ...state })
    return copy
  }

  /** Goes on from `snapshot` (the planned commit on screen), so the next turn is counted from what the screen shows. */
  restore(snapshot: LimiterSnapshot) {
    this.targets.clear()
    for (const [id, state] of snapshot) this.targets.set(id, { ...state })
  }
}

/** One slider's swing in FlashLimiter: the value and position last passed on, its extreme and direction. */
interface LimiterTarget {
  value: number
  position: number
  extreme: number
  dir: number
}

/** FlashLimiter's swings, copied (snapshot, restore). */
type LimiterSnapshot = ReadonlyMap<string, Readonly<LimiterTarget>>

/** Applies held values to modulated parameters (Freeze, from the frame on screen). */
function applyHolds(params: DrivenParams, holds: Holds | null): DrivenParams {
  if (!holds) return params
  for (const [id, value] of holds) {
    const spec = targetById(id)
    if (spec && spec.get(params) !== value) params = spec.set(params, value)
  }
  return params
}

/** One frame handed to React: the live parameters, or null for the sliders' own. */
export interface LiveCommit {
  params: DrivenParams | null
  /** The letters that show another level than `params` (null: every letter shows `params`). */
  letters: LetterFrame | null
  /** The typography and colours sound moved from the sliders' (null: none). */
  look: LookChanges | null
  /** Counts commits, so each one renders and its render can be recognised. */
  seq: number
  /** Set by the director for planned commits. */
  timing?: CommitTiming
}

/** What the scheduler needs from the page; tests/sound replaces it with fakes (a fake clock, client and React). */
export interface LiveDeps {
  now(): number
  /** A file plays or the microphone listens. */
  sourceRunning(): boolean
  /** The geometry client has a request in flight. */
  isComputing(): boolean
  /**
   * Asks the geometry worker for a live frame's glyphs before it is committed, in one request: the shared
   * parameter set first (every glyph shown), then the letters' other levels. True while they are computed
   * (idle() follows when the request ends), false when there is nothing to wait for.
   */
  request(jobs: readonly FrameJob[]): boolean
  /** Hands a frame to React (null: the sliders' own parameters). */
  commit(commit: LiveCommit | null): void
  /** Pauses the file or stops listening (Freeze). */
  pauseSound(): void
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

type Listener = () => void

/**
 * Live values by target (slider positions, seeds), published at most markerRate times a second, each
 * target to its own subscribers.
 */
class LiveValueStore {
  private shown = new Map<string, number>()
  private listeners = new Map<string, Set<Listener>>()
  private waiting: ReadonlyMap<string, number> | null = null
  private lastPublish = -Infinity
  private timer: unknown = null

  /** `round` gives the value as shown, so subscribers hear only of changes they can see. */
  constructor(
    private readonly deps: Pick<LiveDeps, 'now' | 'setTimer' | 'clearTimer'>,
    private readonly round: (value: number) => number,
  ) {}

  get(targetId: string): number | null {
    return this.shown.get(targetId) ?? null
  }

  subscribe(targetId: string, listener: Listener): () => void {
    let set = this.listeners.get(targetId)
    if (!set) {
      set = new Set()
      this.listeners.set(targetId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (!set.size) this.listeners.delete(targetId)
    }
  }

  set(values: ReadonlyMap<string, number>) {
    // Nothing shown, waiting or coming (e.g. no seed is driven): no timer every frame.
    if (!values.size && !this.shown.size && !this.waiting?.size) return
    this.waiting = values
    const wait = this.lastPublish + MARKER_MS - this.deps.now()
    if (wait <= 0) this.publish()
    else if (this.timer === null) this.timer = this.deps.setTimer(() => this.publish(), wait)
  }

  /** Hides every value at once. */
  clear() {
    this.waiting = new Map()
    this.publish()
  }

  private publish() {
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    this.timer = null
    const next = this.waiting
    this.waiting = null
    if (!next) return
    this.lastPublish = this.deps.now()
    const changed: string[] = []
    for (const id of this.shown.keys()) if (!next.has(id)) changed.push(id)
    for (const id of changed) this.shown.delete(id)
    for (const [id, value] of next) {
      const rounded = this.round(value)
      if (this.shown.get(id) === rounded) continue
      this.shown.set(id, rounded)
      changed.push(id)
    }
    for (const id of changed) for (const listener of this.listeners.get(id) ?? []) listener()
  }
}

/** The live status, replaced only when it changes; a change of frame rate alone at most statusRate times a second. */
class StatusStore {
  private status: LiveStatus = NOT_DRIVING
  private listeners = new Set<Listener>()
  private lastFpsChange = -Infinity

  get = (): LiveStatus => this.status

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(next: LiveStatus, now: number) {
    const s = this.status
    if (next.driving === s.driving && next.slow === s.slow && next.differs === s.differs) {
      if (next.fps === s.fps || now - this.lastFpsChange < STATUS_MS) return
    }
    if (next.fps !== s.fps) this.lastFpsChange = now
    this.status = next.driving ? next : NOT_DRIVING
    for (const listener of this.listeners) listener()
  }
}

/**
 * The live scheduler (see the file comment). Exported for tests/sound; the page uses the hooks below.
 * Inputs: the slider values and whether a font is loaded (setBase), the mappings and response settings
 * (setMappings), the letters of the text (setSlots), each measured frame (setFrame), source changes
 * (sourceChanged), renders of its commits (rendered), and the geometry client going idle (idle). Outputs:
 * commits (deps.commit), positions, seeds, status, latency.
 */
export class LiveScheduler {
  readonly positions: LiveValueStore
  /** Live seeds of the driven jump targets (whole numbers, published like the markers). */
  readonly seeds: LiveValueStore
  readonly status = new StatusStore()
  /** The flash limit's budget: the sliders' turns and the seeds' jumps together. Kept when Sound stops driving. */
  private readonly budget: FlashBudget
  private readonly flash: FlashLimiter
  private readonly jumpTracker: JumpTracker
  private readonly shapingTracker = new ShapingTracker()
  /** The mappings with Return to plain's beat pulse (plainPulse) when it is on: what shapingTracker shapes. */
  private shapedMappings: readonly Mapping[] = []

  private base: DrivenParams | null = null
  /** The sliders' geometry key (paramsKey), and their whole frame key: with their look (lookKey). */
  private baseKey = ''
  private baseFrameKey = ''
  /** A font is loaded: without one there are no letters to move, so Sound does not drive. */
  private hasFont = true
  private frame: FeatureFrame = SILENT_FRAME
  private mappings: readonly Mapping[] = []
  private drive = false
  private response: ResponseSettings = NEUTRAL_RESPONSE
  /** The letters' levels for the response settings; null while every letter reacts alike. */
  private levels: LetterLevels | null = null
  /** The letters of the text on the canvas. */
  private slots: LetterSlots = NO_SLOTS
  /** The level each letter took in the last update (for hysteresis); null after a reset. */
  private shownAssign: Uint8Array | null = null
  /**
   * The levels of the frame the screen shows or is about to (the last one started), for the flash limit: updates
   * come every animation frame, frames reach the screen at most 30 times a second, so a move between levels is
   * measured from what the screen shows, not from the last update. Null after a reset.
   */
  private screenAssign: Uint8Array | null = null
  /**
   * The levels of the frames shown within the last LIVE_LIMITS.switchSpanMs (`at`, deps.now()), oldest first; the
   * last is `screenAssign`. A move between levels spread over several frames (the pitch is smoothed, frames come up to
   * 30 times a second) is measured from each of them, so it counts as the one change it shows as. Starts afresh from
   * the frame that shows a large move that took from the budget, and on a reset.
   */
  private screenTrail: { at: number; assign: Uint8Array }[] = []
  /** A large move between levels from `screenAssign` has taken from the budget since that frame started. */
  private switchCharged = false
  /** The driven seeds' jumps so far (from jumpTracker). */
  private jumps: Jumps = NO_JUMPS
  /** The mappings' shaped feature values and rises in the newest frame (from shapingTracker). */
  private shaped: ShapedFrame = NO_SHAPING
  /** Which Thorn state each group of letters shows, while Thorn is on in the shared values and letters are drawn. */
  private readonly turns = new ThornTurns()

  private driving = false
  /**
   * The newest modulated parameters (after the flash limit), the frame, shaping, jumps and held values they came from, the
   * key of the whole frame (letters included) and of the shared parameters, the letters showing other parameters,
   * whether the shared values differ from the sliders, and the Thorn turns made.
   */
  private latest: {
    modulated: Modulated
    differs: boolean
    /** The typography and colours sound moves (lookChanges), null when none. */
    look: LookChanges | null
    turn: number
    frame: FeatureFrame
    shaped: ShapedFrame
    jumps: Jumps
    holds: Holds | null
    key: string
    sharedKey: string
    letters: LetterFrame | null
    /** The level each letter takes (before levels equal to the shared one are folded in); null without levels. */
    assign: Uint8Array | null
  } | null = null
  /** What React shows (or is about to): its key, the frame, jumps and held values it came from, and whether it is the sliders' own. */
  private committed: Shown | null = null
  /** React holds a live commit (not null), so stopping must hand it null. */
  private holdsCommit = false
  /**
   * The frame under way since `at`: while `next` is set its glyphs are being computed and React has not
   * seen it; once committed (at `committedAt`) it waits to render and for any request its render makes.
   */
  private awaiting: { seq: number; at: number; next: Next | null; committedAt: number; rendered: boolean } | null = null
  /** When the last frame started, and when React was last handed one: each at most every 1/30 s. */
  private lastStartAt = -Infinity
  private lastCommitAt = -Infinity
  private seq = 0
  private timer: unknown = null
  /** Smoothed milliseconds per shown result (never under 1/30 s). */
  private period = MIN_COMMIT_MS
  private slowSince: number | null = null
  /** Smoothed milliseconds from a measured frame to its commit; null before the first. Kept when Sound stops. */
  private latency: number | null = null
  /** Following the director's planned commits (follow): frames are kept, nothing is committed. */
  private following = false
  /** When the last planned commit was adopted (page time), for the frame rate. */
  private lastAdoptAt: number | null = null
  /** The newest planned edge counted into the budget (page time). */
  private lastImported = -Infinity
  /** The planned commit adopted last, while following: the live path goes on from its flash state. */
  private adopted: PlannedState | null = null

  constructor(
    private readonly deps: LiveDeps,
    options: LiveOptions = {},
  ) {
    this.positions = new LiveValueStore(deps, (position) => Math.round(position * POSITION_GRID) / POSITION_GRID)
    this.seeds = new LiveValueStore(deps, (seed) => seed)
    this.budget = options.recordEdges ? new RecordingBudget() : new FlashBudget()
    this.flash = new FlashLimiter(this.budget)
    this.jumpTracker = new JumpTracker(this.budget)
  }

  /**
   * The sliders' own parameters (with the canvas's typography and colours, for their targets), and whether a font is
   * loaded (no letters: nothing to drive).
   */
  setBase(base: DrivenParams, hasFont = true) {
    if (base === this.base && hasFont === this.hasFont) return
    if (base !== this.base) {
      this.baseKey = paramsKey(base)
      this.baseFrameKey = this.baseKey + lookKey(base)
    }
    this.base = base
    this.hasFont = hasFont
    this.update()
  }

  /**
   * The mappings, Drive letters, and the Response group's settings (Strength, Motion contrast, Pitch reactive, Melody
   * tracking; Glide only changes how the canvas shows the frames, so the scheduler never reads it).
   */
  setMappings(mappings: readonly Mapping[], drive: boolean, response: ResponseSettings = NEUTRAL_RESPONSE) {
    this.mappings = mappings
    // Return to plain's beat pulse is shaped with the rows.
    const pulse = plainPulse(response)
    this.shapedMappings = pulse ? [...mappings, pulse] : mappings
    // Hits on the beat (Trigger, Toggle, Return to plain) reach every letter at once, not by Thorn turns.
    this.turns.setPulsed(pulsedTargets(mappings, pulse ? PLAIN_SWITCHES.map((spec) => spec.id) : []))
    this.drive = drive
    const r = this.response
    if (response.contrast !== r.contrast || response.pitchReactive !== r.pitchReactive) {
      this.levels = letterLevels(response)
      // New levels: the letters start afresh (no hysteresis from the old ones, no switch edge).
      this.shownAssign = null
      this.screenAssign = null
      this.screenTrail = []
    }
    this.response = response
    this.update()
  }

  /**
   * The letters of the text on the canvas (letterSlots). Another number of letters (a text edit) starts the
   * levels afresh; the same text set differently keeps them.
   */
  setSlots(slots: LetterSlots) {
    if (slots === this.slots) return
    if (slots.count !== this.slots.count) {
      this.shownAssign = null
      this.screenAssign = null
      this.screenTrail = []
    }
    this.slots = slots
    if ((this.levels || this.turns.groups) && this.driving) this.update()
  }

  setFrame(frame: FeatureFrame) {
    this.frame = frame
    // Following planned commits: the frame is only kept, for when the live path takes over again.
    if (this.following) return
    // Shaping and jumps are counted only while Sound can drive; stop() forgets them.
    if (this.base && this.canDrive()) {
      this.shaped = this.shapingTracker.advance(frame, this.shapedMappings)
      this.jumps = this.jumpTracker.advance(frame, this.mappings, this.base, this.response.strength, this.shaped)
    }
    this.update()
  }

  /** Smoothed milliseconds from a frame (for a playing file, as heard) to React getting it; null before the first live commit. */
  latencyMs(): number | null {
    return this.latency
  }

  /** The source started or stopped (playing, paused, listening, stopped listening, switched). */
  sourceChanged() {
    this.update()
  }

  /**
   * The file was sought (or looped back to its start): every mapping's smoothing, pulse and toggle starts afresh from
   * the next frame, as after a pause. The seeds keep their jumps.
   */
  seeked() {
    this.shapingTracker.reset()
    this.shaped = NO_SHAPING
  }

  /** React rendered this commit, and its effects (which ask for the geometry) have run. */
  rendered(seq: number) {
    if (this.awaiting?.seq !== seq) return
    this.awaiting.rendered = true
    this.settle()
  }

  /** The geometry client finished its request. */
  idle() {
    this.settle()
  }

  /**
   * The groups Freeze writes into the sliders and seed fields, each as a whole group object: the frame
   * and jumps on screen applied to the current slider values, mappings and response (what is shown,
   * unless a slider moved since). Letters on other levels take these shared values, and so do Thorn turn groups
   * (the newest frame's while the screen keeps its frame, as the markers show them). Null when nothing
   * differs. Without Thorn's derived canvasEm, which never goes into the state.
   */
  freezeChanges(): FrozenGroups | null {
    const { base, committed } = this
    if (!this.driving || !base || !committed || !committed.differs) return null
    const params = applyHolds(
      modulate(base, committed.frame, this.mappings, committed.jumps, this.response, committed.shaped.values).params,
      committed.holds,
    )
    if (params === base) return null
    const changes: FrozenGroups = {}
    let any = false
    for (const group of GROUPS) {
      if (params[group] === base[group] || JSON.stringify(params[group]) === JSON.stringify(base[group])) continue
      Object.assign(changes, { [group]: params[group] })
      any = true
    }
    if (changes.experimental) changes.experimental = withThornCanvasEm(changes.experimental, null)
    return any ? changes : null
  }

  /** Freeze is done: the sound is paused (stopping the drive follows from the source change). */
  pauseSound() {
    this.deps.pauseSound()
  }

  /** Stops everything (the app unmounted). */
  dispose() {
    this.following = false
    this.stop()
  }

  /** What the scheduler is fed besides the frames, for the planner. */
  inputs(): LiveInputs {
    return {
      base: this.base,
      hasFont: this.hasFont,
      mappings: this.mappings,
      drive: this.drive,
      response: this.response,
      slots: this.slots,
    }
  }

  /** Whether the scheduler follows planned commits (follow). */
  isFollowing(): boolean {
    return this.following
  }

  /**
   * Follows planned commits (true): frames are kept but neither shaped nor committed, and adopt sets what the scheduler
   * shows. Back (false): shaping starts afresh (as after a seek), and the live path goes on from the newest frame.
   */
  follow(on: boolean) {
    if (on === this.following) return
    this.following = on
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    this.timer = null
    this.awaiting = null
    this.lastAdoptAt = null
    const adopted = this.adopted
    this.adopted = null
    if (on) return
    // The flash limit goes on from the commit on screen: its sliders' swings and its seeds' jumps, not the live path's
    // own from before (a move back from what is shown counts as a turn; the seeds do not jump back unbudgeted).
    if (adopted) {
      this.flash.restore(adopted.limiter)
      this.jumpTracker.restore(adopted.jumps)
      this.jumps = adopted.jumps
    }
    this.seeked()
    this.latest = null
    this.update()
  }

  /** The flash edges the budget holds at page time `time` or later, oldest first (the director's handover check). */
  recentEdges(time: number): readonly number[] {
    return this.budget.since(time)
  }

  /** No new flash edge on the live path before page time `until` (the director's handover, see FlashBudget.reserve). */
  reserveFlashes(until: number): void {
    this.budget.reserve(until)
  }

  /**
   * Takes on a planned commit the director is about to hand to React: its markers, seeds, status and Freeze state, and
   * its flash edges into the budget (`toWall` maps planner frame times to page time; `edges`, in ascending planner
   * time, replaces the commit's own when the director skipped planned commits since the last one shown, so their edges
   * are counted too). Returns the commit's seq.
   */
  adopt(adopted: AdoptedState, toWall: (plannerTime: number) => number, edges?: readonly number[]): number {
    const state = adopted as PlannedState
    const now = this.deps.now()
    for (const edge of edges ?? state.edges) {
      const at = toWall(edge)
      if (at <= this.lastImported) continue
      this.budget.spend(at)
      this.lastImported = at
    }
    if (this.lastAdoptAt !== null)
      this.period += SMOOTHING * (Math.max(MIN_COMMIT_MS, now - this.lastAdoptAt) - this.period)
    this.lastAdoptAt = now
    this.driving = state.driving
    this.committed = state.shown
    this.holdsCommit = state.holdsCommit
    this.latest = null
    if (this.following) this.adopted = state
    if (state.driving) {
      this.positions.set(state.positions)
      this.seeds.set(state.seeds)
    } else {
      this.positions.clear()
      this.seeds.clear()
    }
    this.publishStatus()
    return ++this.seq
  }

  /** The planner's scheduler, at a commit: what the page adopts with it (and the edges since the last commit). */
  plannedState(): AdoptedState {
    const latest = this.latest
    const state: PlannedState = {
      brand: 'adopted',
      driving: this.driving,
      shown: this.committed,
      holdsCommit: this.holdsCommit,
      positions: latest?.modulated.positions ?? new Map(),
      seeds: latest?.modulated.seeds ?? new Map(),
      edges: this.budget instanceof RecordingBudget ? this.budget.drain() : [],
      limiter: this.flash.snapshot(),
      jumps: this.committed?.jumps ?? NO_JUMPS,
    }
    return state
  }

  /** A font is loaded, the slider values are known, Drive letters is on, Strength is above 0, and a source runs. */
  private canDrive(): boolean {
    return this.base !== null && this.hasFont && this.drive && this.response.strength > 0 && this.deps.sourceRunning()
  }

  private update() {
    // Following planned commits: the inputs are kept (the planner reads them), nothing else changes.
    if (this.following) return
    const base = this.base
    if (!base || !this.canDrive()) return this.stop()
    const unlimited = modulate(base, this.frame, this.mappings, this.jumps, this.response, this.shaped.values)
    // No enabled mapping with a Depth acts on an active target: Sound changes nothing.
    if (unlimited.positions.size === 0 && unlimited.seeds.size === 0) return this.stop()
    if (!this.driving) {
      this.driving = true
      this.period = MIN_COMMIT_MS
      this.slowSince = null
      // The canvas shows the sliders' own parameters until the first live commit.
      this.committed = {
        key: this.baseFrameKey,
        frame: SILENT_FRAME,
        shaped: NO_SHAPING,
        jumps: NO_JUMPS,
        holds: null,
        isBase: true,
        differs: false,
      }
    }
    // Where each letter would go this frame, and the levels letters show or are about to (for the flash limit).
    const { levels, slots } = this
    const wanted =
      levels && slots.activeCount > 0 ? assignLevels(slots, this.response, this.frame, levels, this.validShown()) : null
    const spread = levels && wanted ? { base, gains: this.presentGains(levels, wanted) } : undefined
    // On the frame's time, as the jumps: one frame's turns and jumps are one edge of the flash budget.
    const limited = this.flash.limit(unlimited, this.frame.time, spread)
    const { holds } = limited
    let { modulated } = limited
    // The geometry key (the glyphs' cache key), and the frame's: with the typography and colours.
    const isBase = modulated.params === base
    const key = isBase ? this.baseKey : paramsKey(modulated.params)
    const look = isBase ? this.baseFrameKey.slice(this.baseKey.length) : lookKey(modulated.params)
    // A held value can put every target back on its slider value: then it is the sliders' own (exact restore).
    if (key + look === this.baseFrameKey && !isBase) modulated = { ...modulated, params: base }
    const turns = this.turnStep(base, modulated)
    const letters = wanted || turns ? this.letterFrame(base, levels, modulated, key, wanted, turns) : null
    // letterFrame keeps the levels letters take this frame as shownAssign.
    const assign = levels && wanted ? this.shownAssign : null
    this.latest = {
      modulated,
      differs: key + look !== this.baseFrameKey,
      look: modulated.params === base ? null : lookChanges(base, modulated.params),
      turn: this.turns.turns,
      frame: this.frame,
      shaped: this.shaped,
      jumps: this.jumps,
      holds,
      key: (letters?.key ?? key) + look,
      sharedKey: key,
      letters,
      assign,
    }
    this.positions.set(modulated.positions)
    this.seeds.set(modulated.seeds)
    this.pump()
    this.publishStatus()
  }

  /** The levels letters took in the last update, when they belong to the current text. */
  private validShown(): Uint8Array | null {
    const shown = this.shownAssign
    return shown && shown.length === this.slots.count ? shown : null
  }

  /** The levels of the frame the screen shows or is about to, when they belong to the current text. */
  private validScreen(): Uint8Array | null {
    const screen = this.screenAssign
    return screen && screen.length === this.slots.count ? screen : null
  }

  /** The gains (other than 1) of the levels an active letter shows now (on screen or in the last update) or is about to. */
  private presentGains(levels: LetterLevels, wanted: Uint8Array): number[] {
    const { active } = this.slots
    const shown = this.validShown()
    const screen = this.validScreen()
    let quiet = false
    let strong = false
    for (let j = 0; j < wanted.length && !(quiet && strong); j++) {
      if (!active[j]) continue
      const a = wanted[j]
      const b = shown ? shown[j] : a
      const c = screen ? screen[j] : a
      if (a === QUIET || b === QUIET || c === QUIET) quiet = true
      if (a === STRONG || b === STRONG || c === STRONG) strong = true
    }
    const gains: number[] = []
    if (quiet) gains.push(levels.gains[QUIET])
    if (strong) gains.push(levels.gains[STRONG])
    return gains
  }

  /**
   * Thorn turns (THORN_TURNS, ThornTurns): while Thorn is on in the shared values and letters are drawn, a turn may hand
   * the live turn state to the next group of letters; a large one takes from the flash budget on the frame's time, as
   * the sliders' turns and the jumps. True while the groups are kept.
   */
  private turnStep(base: GeometryParams, shared: Modulated): boolean {
    const slots = this.slots
    if (shared.params.experimental.thorn?.enabled !== true || slots.activeCount === 0) {
      this.turns.clear()
      return false
    }
    const take = () => this.budget.take(this.frame.time)
    this.turns.update(slots, thornState(shared.params), thornState(base), this.deps.now(), take)
    return true
  }

  /**
   * The letters of this frame that show other parameters than its own, the shared values `shared` (key `sharedKey`):
   * those on other levels, and, while Thorn turn groups show other turn states than the live one, those of such groups
   * (each letter its level of its group's state). Null when every letter shows the shared values.
   *
   * With levels (`levels`, `wanted`), letters moving between levels are a change of their own (switchSwing),
   * measured from the levels of the frame the screen shows or is about to: several updates can pass before the next
   * frame starts, and only the move between two frames on screen shows. A move spread over several frames shows as one
   * change, so it is also measured from each frame shown within LIVE_LIMITS.switchSpanMs (screenTrail). When the move
   * is large it takes from the flash budget once per frame; when the budget is spent, every letter keeps the level on
   * screen.
   */
  private letterFrame(
    base: GeometryParams,
    levels: LetterLevels | null,
    shared: Modulated,
    sharedKey: string,
    wanted: Uint8Array | null,
    turns: boolean,
  ): LetterFrame | null {
    const slots = this.slots
    const keyOf = (p: GeometryParams) => (p === base ? this.baseKey : p === shared.params ? sharedKey : paramsKey(p))
    let sets: readonly [LevelSet, LevelSet, LevelSet] | null = null
    let assign = wanted
    // On the sliders' own values every level is the same, so letters can change levels unseen (no edge).
    if (levels && wanted && shared.params !== base) {
      const ref = this.validScreen() ?? this.validShown()
      sets = levelSets(base, shared, levels, keyOf)
      // A hair under the swing, as the sliders' edges; an edge in the same frame as theirs counts once.
      if (ref && !this.switchCharged && this.switchFrom(ref, wanted, sets) >= FLASH_LIMITS.swing - 1e-9) {
        if (this.budget.take(this.frame.time)) this.switchCharged = true
        else assign = ref
      }
    }
    if (levels && wanted) this.shownAssign = assign
    const live = turns ? thornState(shared.params) : null
    const groupsOf = this.turns.groups
    const states = this.turns.states
    // Groups without letters show nothing.
    if (!live || !groupsOf || states.every((state, g) => groupsOf.letters[g] === 0 || sameThornState(state, live))) {
      return sets && assign ? buildLetterFrame(sets, assign, slots, sharedKey) : null
    }
    const middle: LevelSet = { params: shared.params, key: sharedKey, positions: shared.positions }
    const own = sets ?? [middle, middle, middle]
    const levelsOf = assign ?? new Uint8Array(slots.count).fill(SHARED)
    return buildLetterFrame(own, levelsOf, slots, sharedKey, { of: groupsOf.of, sets: turnSets(own, states, keyOf) })
  }

  /**
   * How far letters move between levels going to `wanted`: from `ref` (the screen's levels) or from any frame
   * shown within LIVE_LIMITS.switchSpanMs, whichever is larger (switchSwing).
   */
  private switchFrom(ref: Uint8Array, wanted: Uint8Array, sets: readonly [LevelSet, LevelSet, LevelSet]): number {
    const slots = this.slots
    let swing = switchSwing(ref, wanted, slots, sets)
    const trail = this.trimTrail(this.deps.now())
    for (let i = 0; i < trail.length - 1 && swing < FLASH_LIMITS.swing - 1e-9; i++) {
      if (trail[i].assign.length === slots.count)
        swing = Math.max(swing, switchSwing(trail[i].assign, wanted, slots, sets))
    }
    return swing
  }

  /** Drops the frames that left the screen more than LIVE_LIMITS.switchSpanMs before `now` (the newest stays). */
  private trimTrail(now: number) {
    const trail = this.screenTrail
    while (trail.length > 1 && trail[1].at <= now - LIVE_LIMITS.switchSpanMs) trail.shift()
    return trail
  }

  /**
   * Starts the newest parameters if they are new, nothing is computing, and 1/30 s has passed: asks for
   * their glyphs, and commits them once those have arrived (at once when nothing needs computing).
   */
  private pump() {
    const { latest, committed } = this
    if (!this.driving || !latest || !committed) return
    if (this.awaiting && !this.finish()) return
    if (latest.key === committed.key) {
      // The same frame on screen. With Thorn turns the shared values can move while it does not (a turn waits): Freeze
      // and the status follow them, as the markers do.
      if (latest.frame !== committed.frame) {
        this.committed = {
          ...committed,
          frame: latest.frame,
          shaped: latest.shaped,
          jumps: latest.jumps,
          holds: latest.holds,
          differs: latest.differs,
        }
      }
      return this.showTurns(latest.turn)
    }
    // The sliders' own values with every letter on them (with Thorn turns, letters can still show other states).
    const isBase = latest.modulated.params === this.base && !latest.letters
    const shown: Shown = {
      key: latest.key,
      frame: latest.frame,
      shaped: latest.shaped,
      jumps: latest.jumps,
      holds: latest.holds,
      isBase,
      differs: latest.differs,
    }
    // Back to the sliders' own parameters while React already shows them: nothing to render.
    if (isBase && !this.holdsCommit) {
      this.committed = shown
      this.showLevels(latest.assign)
      this.showTurns(latest.turn)
      return
    }
    if (this.deps.isComputing()) return // idle() pumps again
    const now = this.deps.now()
    const wait = this.lastStartAt + MIN_COMMIT_MS - now
    if (wait > 0) {
      this.wake(wait)
      return
    }
    const params = isBase ? null : latest.modulated.params
    const letters = isBase ? null : latest.letters
    const look = isBase ? null : latest.look
    this.awaiting = {
      seq: ++this.seq,
      at: now,
      next: { shown, params, letters, look, turn: latest.turn },
      committedAt: now,
      rendered: false,
    }
    this.lastStartAt = now
    this.showLevels(latest.assign)
    // The sliders' own results are kept from normal editing; a live frame's glyphs are computed first, so
    // React renders the frame once, with every glyph (idle() commits it). One request: the shared set for
    // every glyph shown (with Thorn turns, those of letters that show it), then the glyphs of the other sets.
    const shared: FrameJob | null = params && { params, key: latest.sharedKey }
    if (shared && letters?.sharedGlyphs) shared.within = letters.sharedGlyphs
    const jobs: FrameJob[] | null = shared ? [shared, ...(letters?.jobs ?? [])] : null
    if (!jobs || !this.deps.request(jobs)) this.finish()
  }

  /**
   * A frame with these levels is on its way to the screen: moves between levels are measured from them now, and
   * from the frames before it within LIVE_LIMITS.switchSpanMs, unless the move to it took from the budget.
   */
  private showLevels(assign: Uint8Array | null) {
    if (!assign || this.switchCharged) this.screenTrail = []
    if (assign) {
      this.screenTrail.push({ at: this.deps.now(), assign })
      this.trimTrail(this.deps.now())
    }
    this.screenAssign = assign
    this.switchCharged = false
  }

  /** The Thorn turns up to `turn` are on screen: the next may come THORN_TURNS.gapMs from now. */
  private showTurns(turn: number) {
    this.turns.shownUpTo(turn, this.deps.now())
  }

  /** Calls pump (through settle) after `ms`, unless a call is already due. */
  private wake(ms: number) {
    this.timer ??= this.deps.setTimer(() => {
      this.timer = null
      this.settle()
    }, ms)
  }

  /** Hands the awaited frame to React, at most every 1/30 s (its glyphs may arrive sooner after the last). */
  private commitNext(awaiting: { next: Next | null; committedAt: number; seq: number }, next: Next) {
    const now = this.deps.now()
    const wait = this.lastCommitAt + MIN_COMMIT_MS - now
    if (wait > 0) return this.wake(wait)
    awaiting.next = null
    awaiting.committedAt = now
    this.lastCommitAt = now
    this.committed = next.shown
    this.holdsCommit = !next.shown.isBase
    this.showTurns(next.turn)
    if (next.params && next.shown.frame !== SILENT_FRAME) {
      const delay = now - next.shown.frame.time
      this.latency = this.latency === null ? delay : this.latency + SMOOTHING * (delay - this.latency)
    }
    this.deps.commit({ params: next.params, letters: next.letters, look: next.look, seq: awaiting.seq })
  }

  /**
   * The awaited frame is complete when it has rendered and nothing is computing; returns true once it is.
   * A frame whose glyphs have just arrived is committed here.
   */
  private finish(): boolean {
    const awaiting = this.awaiting
    if (!awaiting) return true
    if (this.deps.isComputing()) return false
    if (awaiting.next) {
      this.commitNext(awaiting, awaiting.next)
      return false
    }
    const now = this.deps.now()
    if (!awaiting.rendered && now - awaiting.committedAt < STUCK_MS) return false
    this.awaiting = null
    this.period += SMOOTHING * (Math.max(MIN_COMMIT_MS, now - awaiting.at) - this.period)
    return true
  }

  /** A render or the client going idle: completes the awaited commit, or sends one held back by another request. */
  private settle() {
    if (!this.driving || (this.awaiting && !this.finish())) return
    this.pump()
    this.publishStatus()
  }

  private stop() {
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    this.timer = null
    // Exact restore: the seeds go back to their fields' values, and playing again starts from them.
    this.jumpTracker.reset()
    this.jumps = NO_JUMPS
    this.shapingTracker.reset()
    this.shaped = NO_SHAPING
    this.shownAssign = null
    this.showLevels(null)
    this.turns.clear()
    if (!this.driving && !this.holdsCommit && !this.awaiting) {
      if (this.status.get().driving) this.publishStatus()
      return
    }
    this.driving = false
    this.latest = null
    this.committed = null
    this.awaiting = null
    this.flash.reset()
    this.positions.clear()
    this.seeds.clear()
    if (this.holdsCommit) {
      // Exact restore: the letters go back to the sliders' own parameters, a large change that always shows; it
      // counts against the budget, so a quick pause and play cannot let a second burst through.
      this.budget.spend(this.frame.time)
      this.holdsCommit = false
      this.deps.commit(null)
    }
    this.publishStatus()
  }

  private publishStatus() {
    const now = this.deps.now()
    if (!this.driving) {
      this.slowSince = null
      this.status.set(NOT_DRIVING, now)
      return
    }
    // A frame still computing counts with the time it has taken so far, so a heavy frame shows at once.
    const period = Math.max(this.period, this.awaiting ? now - this.awaiting.at : 0)
    const fps = Math.min(LIVE_LIMITS.maxFps, Math.round(1000 / period))
    if (fps < LIVE_LIMITS.slowFps) this.slowSince ??= now
    else this.slowSince = null
    const slow = this.slowSince !== null && now - this.slowSince >= LIVE_LIMITS.slowSeconds * 1000
    const differs = this.committed !== null && this.committed.differs
    this.status.set({ driving: true, fps, slow, differs }, now)
  }
}

// --- The page's scheduler -----------------------------------------------------------------------

const isRunning = (s: SoundState) => s.playing || s.listening

/** Where the current commit goes: the mounted useLiveFrame's state setter. */
let commitTo: ((commit: LiveCommit | null) => void) | null = null
let scheduler: LiveScheduler | null = null

function getScheduler(): LiveScheduler {
  scheduler ??= new LiveScheduler({
    now: () => performance.now(),
    sourceRunning: () => isRunning(getSoundEngine().getState()),
    isComputing: () => geometryClient.isComputing(),
    request: (jobs) => geometryClient.prefetchJobs(jobs),
    commit: (commit) => commitTo?.(commit),
    pauseSound: () => {
      const engine = getSoundEngine()
      const s = engine.getState()
      if (s.source === 'file') engine.pause()
      else if (s.listening) engine.stopMicrophone()
    },
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  })
  return scheduler
}

/** Connects the scheduler to the engine, the mappings, and the geometry client while App is mounted. */
function attach(setCommit: (commit: LiveCommit | null) => void): () => void {
  const live = getScheduler()
  const engine = getSoundEngine()
  commitTo = setCommit
  const syncMappings = () => {
    const { mappings, drive, response } = mappingStore.getState()
    live.setMappings(mappings, drive, response)
  }
  syncMappings()
  const unsubscribe = [
    mappingStore.subscribe(syncMappings),
    // Only whether a source runs: not the position, which changes about 4 times a second while a file plays.
    subscribeStateKeys(engine, ['playing', 'listening'], () => live.sourceChanged()),
    engine.subscribeFrames((frame) => live.setFrame(frame)),
    engine.subscribeSeeks(() => live.seeked()),
    geometryClient.subscribeIdle(() => live.idle()),
  ]
  // A file plays from its precomputed timeline (director.ts); the microphone, and gaps in the plan, stay live.
  const disconnectDirector = RUNTIME_FLAGS.precompute ? connectDirector(live, (commit) => commitTo?.(commit)) : null
  return () => {
    // The director first: it hands back to the live path, which then stops like before.
    disconnectDirector?.()
    for (const off of unsubscribe) off()
    // Stop first: stop() hands React null (exact restore) through commitTo, which must still point here.
    live.dispose()
    if (commitTo === setCommit) commitTo = null
  }
}

/** What the canvas should show: the live parameters, the letters that show other levels of them, and the live look. */
export interface LiveView {
  params: DrivenParams
  /** Null while every letter shows `params` (always while Sound is not driving). */
  letters: LetterFrame | null
  /** The typography and colours sound moved from the sliders': null while it moves none (always while not driving). */
  look: LookChanges | null
  /** When a planned commit (director.ts) is shown, for Glide (useSceneGlide); null on the live path. */
  timing: CommitTiming | null
}

/**
 * The frame the canvas should show: `base` itself while Sound is not driving (exact restore), or live
 * parameters (and letters on other levels) updated as fast as the geometry keeps up (capped at 30 fps).
 * `base` holds the canvas's typography and colours too, for their targets. Without a font Sound does not drive (no
 * commits, no markers): pass whether one is loaded. Call once, in App.
 */
export function useLiveFrame(base: DrivenParams, hasFont = true): LiveView {
  const [commit, setCommit] = useState<LiveCommit | null>(null)
  const live = getScheduler()
  // Layout effect: the scheduler has the new slider values before the next frame can arrive.
  useLayoutEffect(() => live.setBase(base, hasFont), [live, base, hasFont])
  useEffect(() => attach(setCommit), [])
  useEffect(() => {
    if (!commit) return
    // After this render's other effects too (one of them asks for any glyph the frame still lacks, e.g. after a text change).
    const { seq } = commit
    queueMicrotask(() => live.rendered(seq))
  }, [live, commit])
  const params = commit?.params ?? base
  const letters = commit?.params ? commit.letters : null
  const look = commit?.params ? commit.look : null
  const timing = commit?.timing ?? null
  return useMemo(() => ({ params, letters, look, timing }), [params, letters, look, timing])
}

/**
 * Tells the scheduler the letters of the text on the canvas (letterSlots of the shaped text). Call once, in
 * App, after the hooks that show the glyphs (useGlyphGeometry), so a new text's first frame asks for its glyphs.
 */
export function useLiveLetters(slots: LetterSlots): void {
  const live = getScheduler()
  useLayoutEffect(() => live.setSlots(slots), [live, slots])
}

/** The live position (0–1) of this target on its slider while Sound drives it, else null. Re-renders at most ~15×/s. */
export function useLivePosition(targetId: string): number | null {
  const positions = getScheduler().positions
  const subscribe = useCallback((listener: Listener) => positions.subscribe(targetId, listener), [positions, targetId])
  return useSyncExternalStore(subscribe, () => positions.get(targetId))
}

/** The live seed of this jump target while Sound drives it, else null. Re-renders at most ~15×/s (a seed jumps at most 4.8×/s). */
export function useLiveSeed(targetId: string): number | null {
  const seeds = getScheduler().seeds
  const subscribe = useCallback((listener: Listener) => seeds.subscribe(targetId, listener), [seeds, targetId])
  return useSyncExternalStore(subscribe, () => seeds.get(targetId))
}

/** Live status for the Sound tab and the status bar; re-renders only when it changes (fps rounded). */
export function useLiveStatus(): LiveStatus {
  const { status } = getScheduler()
  return useSyncExternalStore(status.subscribe, status.get)
}

/** Whether Sound drives the letters now; re-renders only when that changes (not with the frame rate). */
export function useLiveDriving(): boolean {
  const { status } = getScheduler()
  return useSyncExternalStore(status.subscribe, () => status.get().driving)
}

/**
 * Writes the current live values into the sliders and seed fields (the groups that differ) and pauses
 * Sound (pauses the file, stops listening), so the frozen look stays on screen. When the letters
 * already match the sliders (e.g. between two drum hits), it only pauses. Does nothing while Sound is
 * not driving.
 */
export function freezeLive(dispatch: Dispatch<Action>): void {
  const live = getScheduler()
  if (!live.status.get().driving) return
  const changes = live.freezeChanges()
  if (changes) {
    for (const group of GROUPS) {
      const value = changes[group]
      // `group` and `value` always match; TypeScript cannot pair a union key with its value here.
      if (value) dispatch({ type: 'updateParams', group, patch: value } as Action)
    }
  }
  // In the same event as the dispatches, so React shows the frozen sliders and drops the live
  // parameters in one render (the frame's results are already kept, so nothing is computed again).
  live.pauseSound()
}

/** The least delay from a planned commit's sound to its letters on screen (ms): about one frame, at least the tap's 40. */
const FOLLOWING_LATENCY_MS = Math.max(40, 1000 / 60)

/**
 * The delay (ms) from the sound leaving the audio graph (where the recording takes it) to its letters reaching React;
 * null before the first live frame. `outputMs` is how much later the sound is heard (engine.outputLatencyMs; 0 for the
 * microphone, which is never played): the letters show what is heard, so that much later too. While planned commits
 * show (`following`), they are timed to the sound as heard, about a frame ahead of the screen; on the live path, the
 * scheduler's smoothed delay from a frame as heard to React (`liveMs`).
 */
export function soundToLettersMs(following: boolean, liveMs: number | null, outputMs: number): number | null {
  const heard = Number.isFinite(outputMs) && outputMs > 0 ? outputMs : 0
  if (following) return Math.max(FOLLOWING_LATENCY_MS, heard + 1000 / 60)
  return liveMs === null ? null : liveMs + heard
}

/**
 * The page's delay from the sound to its letters (soundToLettersMs), for a recording's audio. The last live value is
 * kept while Sound is not driving.
 */
export function liveLatencyMs(): number | null {
  const engine = getSoundEngine()
  const outputMs = engine.getState().playing ? engine.outputLatencyMs() : 0
  return soundToLettersMs(scheduler?.isFollowing() ?? false, scheduler?.latencyMs() ?? null, outputMs)
}
