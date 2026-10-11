// Live sound-driven parameters: the scheduler that turns each measured frame into live geometry
// parameters (at most one geometry request in flight), the live slider positions shown as markers,
// the live frame rate, the flash limit, and Freeze (see docs/SOUND_PLAN.md §5, §8, §9, §10).
//
// Every animation frame the engine measures, the mappings are applied to the slider values
// (modulate), and the flash limit holds back a driven slider that would turn back too often
// (FlashLimiter). A new parameter set goes to React (and so to the geometry worker) only when it differs
// from the last one, the previous one's results have all arrived, and at least 1/30 s has passed: the
// frame rate follows what the geometry can keep up with. While Sound is not driving, the sliders'
// own parameters are used unchanged.

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type Dispatch } from 'react'
import { paramsKey } from '../geometry/cache'
import type { GeometryParams } from '../geometry/types'
import type { Action } from '../state/editorState'
import { geometryClient } from '../state/geometryClient'
import { getSoundEngine } from './engine'
import { modulate, targetById, type Mapping, type Modulated } from './mapping'
import { mappingStore } from './mappingStore'
import { SILENT_FRAME, type FeatureFrame, type SoundState } from './types'

export interface LiveStatus {
  /** Sound is moving the letters now: a source runs, Drive letters is on, and a mapping acts. */
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
  /** At most this many flashes (pairs of opposing swings) a second from each feature (WCAG 2.3.1, SOUND_PLAN §10). */
  maxFlashes: 3,
  /** A swing counts when it moves a driven slider by at least this share of its travel. */
  flashSwing: 0.1,
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

/** The parameter groups sound can drive (GeometryParams), in the order Freeze writes them. */
const GROUPS = ['flatten', 'random', 'squaring', 'anchors', 'grid', 'distortion', 'experimental'] as const

/**
 * Turns that count towards the flash limit are remembered this long (ms): a little over a second, so
 * that frames reaching the screen up to a quarter second after they were measured (waiting for the
 * geometry, at most one frame in flight) still turn at most 2 × maxFlashes times in any second on screen.
 */
const FLASH_WINDOW_MS = 1250

/** Live values held back by the flash limit, by target id. */
type Holds = ReadonlyMap<string, number>

/**
 * Keeps sound from flashing (SOUND_PLAN §10). On each driven slider, the live value may turn back by a
 * swing of at least flashSwing of the slider's travel at most 2 × maxFlashes times within
 * FLASH_WINDOW_MS. A further turn keeps the slider's last passed value until the window has passed.
 * Counted on the slider positions as shown (after rounding to the step), so a coarse slider flipping
 * one step back and forth counts too. A held value is one the slider produced a moment ago (§2), and
 * the markers and Freeze use the same values as the screen.
 */
export class FlashLimiter {
  /** Per target: the value and position last passed on, the extreme of the current swing, its direction (−1, 0, 1), and recent turn times. */
  private targets = new Map<string, { value: number; position: number; extreme: number; dir: number; turns: number[] }>()

  /** The modulated parameters with held values put back, and the held values (null when none). */
  limit(modulated: Modulated, now: number): { modulated: Modulated; holds: Holds | null } {
    for (const id of this.targets.keys()) if (!modulated.positions.has(id)) this.targets.delete(id)
    let params = modulated.params
    let positions: Map<string, number> | null = null
    let holds: Map<string, number> | null = null
    for (const [id, position] of modulated.positions) {
      const spec = targetById(id)
      if (!spec) continue
      const value = spec.get(modulated.params)
      const state = this.targets.get(id)
      if (!state) {
        this.targets.set(id, { value, position, extreme: position, dir: 0, turns: [] })
        continue
      }
      const { dir, extreme } = state
      // A hair under the swing, so a swing of exactly flashSwing on the step grid counts despite rounding.
      const swing = LIVE_LIMITS.flashSwing - 1e-9
      const turn = dir >= 0 && position <= extreme - swing ? -1 : dir <= 0 && position >= extreme + swing ? 1 : 0
      if (turn === 0) {
        if ((dir > 0 && position > extreme) || (dir < 0 && position < extreme)) state.extreme = position
        state.value = value
        state.position = position
        continue
      }
      state.turns = state.turns.filter((t) => now - t < FLASH_WINDOW_MS)
      if (state.turns.length >= 2 * LIVE_LIMITS.maxFlashes) {
        if (spec.get(params) !== state.value) params = spec.set(params, state.value)
        positions ??= new Map(modulated.positions)
        positions.set(id, state.position)
        holds ??= new Map()
        holds.set(id, state.value)
        continue
      }
      state.turns.push(now)
      state.dir = turn
      state.extreme = position
      state.value = value
      state.position = position
    }
    return { modulated: positions ? { params, positions } : modulated, holds }
  }

  /** Forgets every slider (Sound stopped driving). */
  reset() {
    this.targets.clear()
  }
}

/** Applies held values to modulated parameters (Freeze, from the frame on screen). */
function applyHolds(params: GeometryParams, holds: Holds | null): GeometryParams {
  if (!holds) return params
  for (const [id, value] of holds) {
    const spec = targetById(id)
    if (spec && spec.get(params) !== value) params = spec.set(params, value)
  }
  return params
}

/** One parameter set handed to React: the live parameters, or null for the sliders' own. */
export interface LiveCommit {
  params: GeometryParams | null
  /** Counts commits, so each one renders and its render can be recognised. */
  seq: number
}

/** What the scheduler needs from the page; replaced by fakes in tests. */
export interface LiveDeps {
  now(): number
  /** A file plays or the microphone listens. */
  sourceRunning(): boolean
  /** The geometry client has a request in flight. */
  isComputing(): boolean
  /** Hands a parameter set to React (null: the sliders' own). */
  commit(commit: LiveCommit | null): void
  /** Pauses the file or stops listening (Freeze). */
  pauseSound(): void
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

type Listener = () => void

/** Live slider positions by target, published at most markerRate times a second, each target to its own subscribers. */
class PositionStore {
  private shown = new Map<string, number>()
  private listeners = new Map<string, Set<Listener>>()
  private waiting: ReadonlyMap<string, number> | null = null
  private lastPublish = -Infinity
  private timer: unknown = null

  constructor(private readonly deps: Pick<LiveDeps, 'now' | 'setTimer' | 'clearTimer'>) {}

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

  set(positions: ReadonlyMap<string, number>) {
    this.waiting = positions
    const wait = this.lastPublish + MARKER_MS - this.deps.now()
    if (wait <= 0) this.publish()
    else if (this.timer === null) this.timer = this.deps.setTimer(() => this.publish(), wait)
  }

  /** Hides every marker at once. */
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
    for (const [id, position] of next) {
      const rounded = Math.round(position * POSITION_GRID) / POSITION_GRID
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
 * The live scheduler (see the file comment). Exported for tests; the page uses the hooks below.
 * Inputs: the slider values (setBase), the mappings (setMappings), each measured frame (setFrame),
 * source changes (sourceChanged), renders of its commits (rendered), and the geometry client going
 * idle (idle). Outputs: commits (deps.commit), positions, status.
 */
export class LiveScheduler {
  readonly positions: PositionStore
  readonly status = new StatusStore()
  private readonly flash = new FlashLimiter()

  private base: GeometryParams | null = null
  private baseKey = ''
  private frame: FeatureFrame = SILENT_FRAME
  private mappings: readonly Mapping[] = []
  private drive = false

  private driving = false
  /** The newest modulated parameters (after the flash limit), the frame and held values they came from, and their key. */
  private latest: { modulated: Modulated; frame: FeatureFrame; holds: Holds | null; key: string } | null = null
  /** What React shows (or is about to): its key, the frame and held values it came from, and whether it is the sliders' own. */
  private committed: { key: string; frame: FeatureFrame; holds: Holds | null; isBase: boolean } | null = null
  /** React holds a live commit (not null), so stopping must hand it null. */
  private holdsCommit = false
  /** The commit whose results have not all arrived yet. */
  private awaiting: { seq: number; at: number; rendered: boolean } | null = null
  private lastCommitAt = -Infinity
  private seq = 0
  private timer: unknown = null
  /** Smoothed milliseconds per shown result (never under 1/30 s). */
  private period = MIN_COMMIT_MS
  private slowSince: number | null = null

  constructor(private readonly deps: LiveDeps) {
    this.positions = new PositionStore(deps)
  }

  setBase(base: GeometryParams) {
    if (base === this.base) return
    this.base = base
    this.baseKey = paramsKey(base)
    this.update()
  }

  setMappings(mappings: readonly Mapping[], drive: boolean) {
    this.mappings = mappings
    this.drive = drive
    this.update()
  }

  setFrame(frame: FeatureFrame) {
    this.frame = frame
    this.update()
  }

  /** The source started or stopped (playing, paused, listening, off). */
  sourceChanged() {
    this.update()
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
   * The groups Freeze writes into the sliders, each as a whole group object: the frame on screen
   * applied to the current slider values and mappings (what is shown, unless a slider moved since).
   * Null when nothing differs.
   */
  freezeChanges(): Partial<GeometryParams> | null {
    const { base, committed } = this
    if (!this.driving || !base || !committed || committed.isBase) return null
    const params = applyHolds(modulate(base, committed.frame, this.mappings).params, committed.holds)
    if (params === base) return null
    const changes: Partial<GeometryParams> = {}
    let any = false
    for (const group of GROUPS) {
      if (params[group] === base[group] || JSON.stringify(params[group]) === JSON.stringify(base[group])) continue
      Object.assign(changes, { [group]: params[group] })
      any = true
    }
    return any ? changes : null
  }

  /** Freeze is done: the sound is paused (stopping the drive follows from the source change). */
  pauseSound() {
    this.deps.pauseSound()
  }

  /** Stops everything (the app unmounted). */
  dispose() {
    this.stop()
  }

  private update() {
    const base = this.base
    if (!base || !this.drive || !this.deps.sourceRunning()) return this.stop()
    const unlimited = modulate(base, this.frame, this.mappings)
    // No enabled mapping with a Depth acts on an active target: Sound changes nothing.
    if (unlimited.positions.size === 0) return this.stop()
    if (!this.driving) {
      this.driving = true
      this.period = MIN_COMMIT_MS
      this.slowSince = null
      // The canvas shows the sliders' own parameters until the first live commit.
      this.committed = { key: this.baseKey, frame: SILENT_FRAME, holds: null, isBase: true }
    }
    const limited = this.flash.limit(unlimited, this.deps.now())
    const { holds } = limited
    let { modulated } = limited
    const key = modulated.params === base ? this.baseKey : paramsKey(modulated.params)
    // A held value can put every target back on its slider value: then it is the sliders' own (exact restore).
    if (key === this.baseKey && modulated.params !== base) modulated = { params: base, positions: modulated.positions }
    this.latest = { modulated, frame: this.frame, holds, key }
    this.positions.set(modulated.positions)
    this.pump()
    this.publishStatus()
  }

  /** Commits the newest parameters if they are new, nothing is computing, and 1/30 s has passed. */
  private pump() {
    const { latest, committed } = this
    if (!this.driving || !latest || !committed) return
    if (this.awaiting && !this.finish()) return
    if (latest.key === committed.key) return
    const isBase = latest.modulated.params === this.base
    // Back to the sliders' own parameters while React already shows them: nothing to render.
    if (isBase && !this.holdsCommit) {
      this.committed = { key: latest.key, frame: latest.frame, holds: latest.holds, isBase }
      return
    }
    if (this.deps.isComputing()) return // idle() pumps again
    const now = this.deps.now()
    const wait = this.lastCommitAt + MIN_COMMIT_MS - now
    if (wait > 0) {
      this.timer ??= this.deps.setTimer(() => {
        this.timer = null
        this.pump()
      }, wait)
      return
    }
    const seq = ++this.seq
    this.committed = { key: latest.key, frame: latest.frame, holds: latest.holds, isBase }
    this.awaiting = { seq, at: now, rendered: false }
    this.lastCommitAt = now
    this.holdsCommit = !isBase
    this.deps.commit({ params: isBase ? null : latest.modulated.params, seq })
  }

  /** The awaited commit is complete when it has rendered and nothing is computing; returns true once it is. */
  private finish(): boolean {
    const awaiting = this.awaiting
    if (!awaiting) return true
    if (this.deps.isComputing()) return false
    const now = this.deps.now()
    if (!awaiting.rendered && now - awaiting.at < STUCK_MS) return false
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
    if (this.holdsCommit) {
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
    const differs = this.committed !== null && this.committed.key !== this.baseKey
    this.status.set({ driving: true, fps, slow, differs }, now)
  }
}

// --- The page's scheduler -----------------------------------------------------------------------

const isRunning = (s: SoundState) => s.playing || s.listening

/** Where the current commit goes: the mounted useLiveParams' state setter. */
let commitTo: ((commit: LiveCommit | null) => void) | null = null
let scheduler: LiveScheduler | null = null

function getScheduler(): LiveScheduler {
  scheduler ??= new LiveScheduler({
    now: () => performance.now(),
    sourceRunning: () => isRunning(getSoundEngine().getState()),
    isComputing: () => geometryClient.isComputing(),
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
    const { mappings, drive } = mappingStore.getState()
    live.setMappings(mappings, drive)
  }
  syncMappings()
  const unsubscribe = [
    mappingStore.subscribe(syncMappings),
    engine.subscribeState(() => live.sourceChanged()),
    engine.subscribeFrames((frame) => live.setFrame(frame)),
    geometryClient.subscribeIdle(() => live.idle()),
  ]
  return () => {
    for (const off of unsubscribe) off()
    // Stop first: stop() hands React null (exact restore) through commitTo, which must still point here.
    live.dispose()
    if (commitTo === setCommit) commitTo = null
  }
}

/**
 * The parameters the canvas should use: `base` itself while Sound is not driving (exact restore), or
 * live parameters updated as fast as the geometry keeps up (capped at 30 fps). Call once, in App.
 */
export function useLiveParams(base: GeometryParams): GeometryParams {
  const [commit, setCommit] = useState<LiveCommit | null>(null)
  const live = getScheduler()
  // Layout effect: the scheduler has the new slider values before the next frame can arrive.
  useLayoutEffect(() => live.setBase(base), [live, base])
  useEffect(() => attach(setCommit), [])
  useEffect(() => {
    if (!commit) return
    // After this render's other effects too (the geometry request is made in one of them).
    const { seq } = commit
    queueMicrotask(() => live.rendered(seq))
  }, [live, commit])
  return commit?.params ?? base
}

/** The live position (0–1) of this target on its slider while Sound drives it, else null. Re-renders at most ~15×/s. */
export function useLivePosition(targetId: string): number | null {
  const positions = getScheduler().positions
  const subscribe = useCallback((listener: Listener) => positions.subscribe(targetId, listener), [positions, targetId])
  return useSyncExternalStore(subscribe, () => positions.get(targetId))
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
 * Writes the current live values into the sliders (the groups that differ) and pauses Sound (pauses the
 * file, stops listening), so the frozen look stays on screen. When the letters already match the
 * sliders (e.g. between two drum hits), it only pauses. Does nothing while Sound is not driving.
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
