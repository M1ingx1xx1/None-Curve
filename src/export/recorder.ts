// Real-time video recording: the canvas as it moves with the sound, captured on a fixed frame clock at the take's
// frame rate (captureStream(0) and requestFrame), with the sound as heard, delayed to line up with the letters, into
// a MediaRecorder; saved once, as one file, when the take ends. The canvas draws whenever it changes; each tick of
// the clock takes it as it is, so a frame repeats the last drawing when nothing changed. A requested frame is
// captured at the canvas's next change, so every tick touches the canvas (touchCanvas, one pixel copied onto
// itself) in the same task as its request: the frame is then taken at the next rendering update, close to the tick.
// The rate is about the chosen one, best effort: frames land on rendering updates, so a rate at or above the
// display's (60 fps on a 60 Hz screen) can lose some, and MediaRecorder writes a variable-rate file. A take waits
// for its sound and its first drawn frame, and ends at its length, at the 10-minute cap, or when the sound stops,
// the tab is hidden, the canvas changes size or the font goes; what was recorded is saved even after an error.
// Stop asks for the canvas as it is at once, and Stop and the sound's end let the recorder (and the clock) run a
// moment longer, so the last frame, and the end of the sound still in the audio's delay, are in the file.
//
// The controller gets its clock, timers, browser checks, recorder and engine injected, so tests run it with
// fakes and nothing touches the DOM; the page's single controller and its hooks are at the bottom.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { getSoundEngine, subscribeStateKeys } from '../sound/engine'
import { liveLatencyMs } from '../sound/live'
import type { SoundSource, SoundState } from '../sound/types'
import { downloadFile } from './download'
import {
  DEFAULT_VIDEO_FPS,
  RECORD_LENGTHS,
  VIDEO_FPS,
  VIDEO_LIMITS,
  formatClock,
  pickVideoMimes,
  recordDelayMs,
  videoBitrate,
  videoFileName,
  videoSize,
  videoSupport,
  type RecordLength,
  type VideoFormat,
  type VideoFps,
  type VideoMime,
} from './videoFormat'

/**
 * The sound's state a take and the Record button's blocker read (sourceChanged): a change of only the position, about
 * 4 times a second while a file plays, does not check the blocker (MediaRecorder.isTypeSupported, once per format).
 */
const SOURCE_KEYS: readonly (keyof SoundState)[] = ['busy', 'source', 'fileName', 'playing', 'listening']

export type RecordPhase = 'idle' | 'starting' | 'recording' | 'stopping'
export type StopReason = 'user' | 'length' | 'cap' | 'source' | 'hidden' | 'size' | 'font' | 'error'

/** The Record group's choices; per visit (not saved, not undone). */
export interface RecordOptions {
  format: VideoFormat
  length: RecordLength
  /** Frames per second in the file. */
  fps: VideoFps
  /** Put the sound in the file (with the microphone, its sound). */
  audio: boolean
  /** Draw with the preview's look (its blur and inversion) instead of the palette. */
  previewLook: boolean
}

export const DEFAULT_RECORD_OPTIONS: RecordOptions = {
  format: 'mp4',
  length: 'until-stopped',
  fps: DEFAULT_VIDEO_FPS,
  audio: true,
  previewLook: false,
}

/** What the page tells the recorder: the font (null without one) and the canvas. */
export interface RecordingContext {
  family: string
  style: string
  /** The canvas and its export scale (as PNG): the video is width × scale by height × scale, capped. */
  artboard: { width: number; height: number; scale: number }
  /** The palette has no background: the video paints it anyway, and says so. */
  transparent: boolean
  onSaved(fileName: string): void
}

/** A take's fixed settings, for the recording canvas and the Record group. */
export interface TakeSpec {
  /** The video's size in pixels (even), `capped` when scaled down to the limits. */
  width: number
  height: number
  capped: boolean
  /** Frames per second. */
  fps: VideoFps
  /** The MIME types to try, best first. */
  mimes: VideoMime[]
  previewLook: boolean
  /** The take's length (ms), at most 10 minutes; null until stopped. */
  limitMs: number | null
}

export interface RecordingState {
  phase: RecordPhase
  options: RecordOptions
  /** Set from Record to the saved file: the recording canvas is mounted while it is. */
  take: TakeSpec | null
  /** Time recorded (ms), in whole seconds as it changes; 0 while idle. */
  elapsedMs: number
  /** The last take's outcome, or why Record could not start. */
  message: { tone: 'info' | 'warning' | 'error'; text: string } | null
  /** What this browser can do: capture a canvas with MediaRecorder at all, and in which formats. */
  support: { capture: boolean; mp4: boolean; webm: boolean }
}

/** The parts of SoundEngine a take uses. */
export interface RecorderEngine {
  getState(): SoundState
  subscribeState(listener: () => void): () => void
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  setLoop(loop: boolean): void
  startMicrophone(): Promise<void>
  stopMicrophone(): void
  startRecordingAudio(delayMs: number): MediaStreamTrack | null
  stopRecordingAudio(): void
}

/** The parts of MediaRecorder a take uses. */
export interface MediaRecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused'
  start(timeslice?: number): void
  stop(): void
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((event: unknown) => void) | null
}

export interface RecorderDeps {
  now(): number
  setTimer(run: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  /** MediaRecorder and canvas capture exist. */
  canRecord(): boolean
  /** MediaRecorder.isTypeSupported, read at every call. */
  isTypeSupported(mime: string): boolean
  /** A recorder for these tracks; throws when it cannot record with these options. */
  createRecorder(tracks: MediaStreamTrack[], options: MediaRecorderOptions): MediaRecorderLike
  engine: RecorderEngine
  /** The smoothed delay from a sound frame to its letters on screen (ms); null before the first live frame. */
  latencyMs(): number | null
  hidden(): boolean
  onVisibilityChange(run: () => void): () => void
  /** Hands the finished file to the user (downloadFile). */
  save(blob: Blob, fileName: string, mime: string): void
}

/** A canvas that can be captured (HTMLCanvasElement). */
export interface CaptureCanvas {
  captureStream(fps?: number): MediaStream
}

/** A clock frame due this close (ms) to the recorder's stop is not asked for: it would be lost. */
const FRAME_GUARD_MS = 10
/** A recorder that never reports its end is given up on after this long (ms), keeping what it gave. */
const STOP_TIMEOUT_MS = 5000

const CANNOT_RECORD = 'This browser cannot record video.'

/** Why a take ended, said before its outcome; none for Stop and a reached length. */
const REASON_TEXT: Partial<Record<StopReason, string>> = {
  source: 'The sound stopped, so the recording ended.',
  hidden: 'Recording stopped because the tab was hidden.',
  size: 'Recording stopped because the canvas size changed.',
  font: 'Recording stopped because the font was closed.',
  cap: 'Stopped at the 10-minute limit.',
}

type FrameTrack = MediaStreamTrack & { requestFrame?: () => void }

/** One take, from Record to its file. */
interface Take {
  spec: TakeSpec
  options: RecordOptions
  context: RecordingContext
  source: SoundSource
  /** Whole file: the take runs from the file's start to its end. */
  wholeFile: boolean
  /** Record started the source (so it pauses it, or stops listening, at the end). */
  startedSource: boolean
  /** Loop before a Whole-file take turned it off; null when it was left alone. */
  loop: boolean | null
  /** The source has run during this take. */
  ran: boolean
  canvas: CaptureCanvas | null
  /** Marks the canvas as changed (touchCanvas), so a frame asked for is captured though nothing new was drawn. */
  touch: (() => void) | null
  blurWorks: boolean
  drawn: boolean
  /** The clock's interval (ms), and the index of its last frame (frame n is due n intervals after startedAt). */
  frameMs: number
  frameIndex: number
  stream: MediaStream | null
  video: FrameTrack | null
  audio: MediaStreamTrack | null
  /** The audio's delay behind the sound (ms), to line it up with the letters. */
  delayMs: number
  /** The audio was asked for and the engine's tap could not give it. */
  audioMissing: boolean
  recorder: MediaRecorderLike | null
  mime: VideoMime | null
  chunks: Blob[]
  startedAt: number
  elapsedMs: number
  reason: StopReason | null
  /** Stopping, but the recorder still runs for the take's last moments (the clock still asks for frames). */
  ending: boolean
  /** When the recorder is stopped after its last moments (deps.now()); null while recording. */
  endAt: number | null
  error: string | null
}

/** Records the canvas while the sound runs; one take at a time. */
export class RecordingController {
  private readonly deps: RecorderDeps
  private readonly listeners = new Set<() => void>()
  private state: RecordingState
  private context: RecordingContext | null = null
  private take: Take | null = null
  private readonly timers = new Map<string, unknown>()
  /** The blocker last shown, so a change re-renders the Record button. */
  private blocked: string | null

  constructor(deps: RecorderDeps) {
    this.deps = deps
    this.state = { phase: 'idle', options: DEFAULT_RECORD_OPTIONS, take: null, elapsedMs: 0, message: null, support: this.readSupport() }
    this.blocked = this.blocker()
    subscribeStateKeys(deps.engine, SOURCE_KEYS, () => this.sourceChanged())
    deps.onVisibilityChange(() => {
      if (this.take && this.deps.hidden()) this.stop('hidden')
    })
  }

  /** The current state (a new object whenever it changes, for useSyncExternalStore). */
  getState = (): RecordingState => {
    const support = this.readSupport()
    const shown = this.state.support
    if (support.capture !== shown.capture || support.mp4 !== shown.mp4 || support.webm !== shown.webm) {
      this.state = { ...this.state, support }
    }
    return this.state
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Changes the choices for the next take; ignored during a take, which keeps the ones it started with. */
  setOptions(patch: Partial<RecordOptions>): void {
    if (this.state.phase !== 'idle') return
    const current = this.state.options
    const next: RecordOptions = {
      format: patch.format === 'mp4' || patch.format === 'webm' ? patch.format : current.format,
      length: patch.length !== undefined && RECORD_LENGTHS.includes(patch.length) ? patch.length : current.length,
      fps: patch.fps !== undefined && VIDEO_FPS.includes(patch.fps) ? patch.fps : current.fps,
      audio: typeof patch.audio === 'boolean' ? patch.audio : current.audio,
      previewLook: typeof patch.previewLook === 'boolean' ? patch.previewLook : current.previewLook,
    }
    if (
      next.format === current.format &&
      next.length === current.length &&
      next.fps === current.fps &&
      next.audio === current.audio &&
      next.previewLook === current.previewLook
    ) {
      return
    }
    this.setState({ options: next })
  }

  /** The font and canvas now. During a take, a new size or scale ends it ('size'), and no font ends it ('font'). */
  setContext(context: RecordingContext | null): void {
    this.context = context
    const take = this.take
    // While stopping, only the take's last moments are left to end (at once).
    if (take && (this.state.phase !== 'stopping' || take.ending)) {
      const before = take.context.artboard
      if (!context) this.stop('font')
      else if (context.artboard.width !== before.width || context.artboard.height !== before.height || context.artboard.scale !== before.scale) {
        this.stop('size')
      }
    }
    this.checkBlocker()
  }

  /** Why Record cannot start now (shown as its hint), or null. */
  blocker(): string | null {
    if (!this.deps.canRecord()) return CANNOT_RECORD
    const { mp4, webm } = videoSupport(this.deps.isTypeSupported)
    if (!mp4 && !webm) return CANNOT_RECORD
    if (!this.context) return 'Load a font to record.'
    const sound = this.deps.engine.getState()
    if (sound.busy) return 'Opening the sound…'
    if (sound.source === 'file' && sound.fileName === null) return 'Choose an audio file first.'
    return null
  }

  /** Hides how the last take went (its message), once it has been read. The next take clears it too. */
  clearMessage(): void {
    if (this.state.message) this.setState({ message: null })
  }

  /**
   * Starts a take. Synchronous, so the sound starts inside the click: a paused file plays (Whole file from
   * its start, with Loop off for the take) and the microphone starts listening. Recording begins once the
   * sound runs and the recording canvas has drawn its first frame.
   */
  start(): void {
    if (this.state.phase !== 'idle') return
    const blocked = this.blocker()
    const context = this.context
    if (blocked || !context) {
      this.setState({ message: { tone: 'warning', text: blocked ?? 'Load a font to record.' } })
      return
    }
    const { deps } = this
    const { engine } = deps
    const options = this.state.options
    const sound = engine.getState()
    const mimes = pickVideoMimes(options.format, options.audio, deps.isTypeSupported)
    if (mimes.length === 0) {
      this.setState({ message: { tone: 'error', text: CANNOT_RECORD } })
      return
    }
    const size = videoSize(context.artboard.width, context.artboard.height, context.artboard.scale)
    const wholeFile = options.length === 'whole-file' && sound.source === 'file' && sound.duration > 0
    const lengthMs = typeof options.length === 'number' ? options.length * 1000 : wholeFile ? sound.duration * 1000 : null
    const spec: TakeSpec = {
      ...size,
      fps: options.fps,
      mimes,
      previewLook: options.previewLook,
      limitMs: lengthMs === null ? null : Math.min(lengthMs, VIDEO_LIMITS.maxMs),
    }
    const take: Take = {
      spec,
      options,
      context,
      source: sound.source,
      wholeFile,
      startedSource: false,
      loop: null,
      ran: false,
      canvas: null,
      touch: null,
      blurWorks: true,
      drawn: false,
      frameMs: 1000 / options.fps,
      frameIndex: 0,
      stream: null,
      video: null,
      audio: null,
      delayMs: 0,
      audioMissing: false,
      recorder: null,
      mime: null,
      chunks: [],
      startedAt: 0,
      elapsedMs: 0,
      reason: null,
      ending: false,
      endAt: null,
      error: null,
    }
    this.take = take
    this.setState({ phase: 'starting', take: spec, elapsedMs: 0, message: null })
    this.arm('start', VIDEO_LIMITS.startTimeoutMs, () => {
      const running = this.isRunning(take)
      this.abort(take, {
        tone: 'error',
        text: running ? 'The video did not start, so nothing was recorded.' : 'The sound did not start, so nothing was recorded.',
      })
    })

    const settled = () => this.sourceSettled(take)
    if (sound.source === 'file') {
      if (wholeFile) {
        take.loop = sound.loop
        engine.setLoop(false)
        engine.seek(0)
      }
      if (!sound.playing) {
        take.startedSource = true
        engine.play().then(settled, settled)
      }
    } else if (!sound.listening) {
      take.startedSource = true
      engine.startMicrophone().then(settled, settled)
    }
    if (this.take === take && this.isRunning(take)) {
      take.ran = true
      this.tryBegin(take)
    }
  }

  /**
   * Ends the take: a recording is saved (what exists), a take still starting is dropped. The recorder runs a moment
   * longer (tailMs) for the last frame, and for the end of the sound when the sound ended the take; the tab hidden,
   * an error, or the canvas or font changing end it at once.
   */
  stop(reason: StopReason = 'user'): void {
    const take = this.take
    if (!take) return
    if (this.state.phase === 'starting') this.abort(take, startFailure(take, reason))
    if (this.state.phase === 'stopping') {
      // Still recording its last moments: a reason that cannot wait ends them now.
      if (take.ending && this.tailMs(take, reason) === 0) this.stopRecorder(take)
      return
    }
    if (this.state.phase !== 'recording') return
    take.reason = reason
    this.disarm('length', 'cap')
    take.elapsedMs = Math.max(0, this.deps.now() - take.startedAt)
    this.setState({ phase: 'stopping', elapsedMs: take.elapsedMs })
    const tail = this.tailMs(take, reason)
    this.arm('stop', tail + STOP_TIMEOUT_MS, () => this.finish(take))
    if (tail === 0) return this.stopRecorder(take)
    // The canvas as it is now, at once; then the clock goes on for the frames still to come, then the end.
    this.requestFrame(take)
    take.ending = true
    take.endAt = this.deps.now() + tail
    this.arm('drain', tail, () => this.stopRecorder(take))
  }

  /**
   * The recording canvas is mounted; `blurWorks` is false only when the take asks for blur and the canvas cannot
   * draw it. `touch` marks the canvas as changed without changing what it shows (touchCanvas): a requested frame is
   * captured only at the canvas's next change, so every request touches it, in the same task, to be taken right away.
   */
  canvasReady(canvas: CaptureCanvas, blurWorks: boolean, touch: () => void): void {
    const take = this.take
    if (!take || this.state.phase !== 'starting') return
    take.canvas = canvas
    take.touch = touch
    take.blurWorks = blurWorks
    this.tryBegin(take)
  }

  /** The recording canvas has drawn: a starting take may begin (once recording, the clock's next frame takes it). */
  frameDrawn(): void {
    const take = this.take
    if (!take || this.state.phase !== 'starting') return
    take.drawn = true
    this.tryBegin(take)
  }

  // --- Take --------------------------------------------------------------------------------------

  private isRunning(take: Take): boolean {
    const sound = this.deps.engine.getState()
    return sound.source === take.source && (sound.playing || sound.listening)
  }

  /** The engine's state changed: the Record button's blocker, and a take's sound starting or stopping. */
  private sourceChanged(): void {
    this.checkBlocker()
    const take = this.take
    if (!take) return
    const running = this.isRunning(take)
    if (this.state.phase === 'starting') {
      if (running) {
        take.ran = true
        this.tryBegin(take)
      } else if (take.ran || this.deps.engine.getState().source !== take.source) this.stop('source')
    } else if (this.state.phase === 'recording' && !running) {
      const sound = this.deps.engine.getState()
      // A Whole-file take reaching the file's end has reached its length.
      const ended = take.wholeFile && sound.source === 'file' && sound.duration > 0 && sound.position >= sound.duration
      this.stop(ended ? 'length' : 'source')
    }
  }

  /** Play or Start listening has answered: a take whose sound did not start is dropped. */
  private sourceSettled(take: Take): void {
    if (this.take !== take || this.state.phase !== 'starting') return
    if (this.isRunning(take)) {
      take.ran = true
      this.tryBegin(take)
    } else this.stop('source')
  }

  private tryBegin(take: Take): void {
    if (this.take !== take || this.state.phase !== 'starting') return
    if (take.canvas && take.drawn && this.isRunning(take)) this.begin(take, take.canvas)
  }

  /** The sound runs and the canvas has drawn: capture, find a recorder that starts, and record. */
  private begin(take: Take, canvas: CaptureCanvas): void {
    const { deps } = this
    this.disarm('start')
    try {
      let stream = canvas.captureStream(0)
      let video: FrameTrack | undefined = stream.getVideoTracks()[0]
      if (video && typeof video.requestFrame !== 'function') {
        // Frames on request are not available: the browser captures on its own clock at about the take's rate, and
        // only when the canvas changed, so no frame clock runs (its touches would drift against the capture's).
        stopTracks(stream)
        stream = canvas.captureStream(take.options.fps)
        video = stream.getVideoTracks()[0]
      }
      take.stream = stream
      if (!video) throw new Error('The canvas gave no video track')
      take.video = video
    } catch (error) {
      take.error = describe(error)
      this.stop('error')
      return
    }
    const video = take.video

    take.delayMs = recordDelayMs(deps.latencyMs(), take.options.fps)
    if (take.options.audio) {
      take.audio = deps.engine.startRecordingAudio(take.delayMs)
      take.audioMissing = take.audio === null
    }
    const mimes = take.audioMissing ? pickVideoMimes(take.options.format, false, deps.isTypeSupported) : take.spec.mimes
    const tracks = take.audio ? [video, take.audio] : [video]
    const settings: MediaRecorderOptions = { videoBitsPerSecond: videoBitrate(take.spec.width, take.spec.height, take.options.fps) }
    if (take.audio) settings.audioBitsPerSecond = VIDEO_LIMITS.audioBitrate

    let failure: unknown = null
    for (const mime of mimes) {
      let recorder: MediaRecorderLike | null = null
      try {
        recorder = deps.createRecorder(tracks, { ...settings, mimeType: mime.mimeType })
        this.listen(take, recorder)
        recorder.start(VIDEO_LIMITS.timesliceMs)
        take.recorder = recorder
        take.mime = mime
        break
      } catch (error) {
        // This type would not construct or start: try the next.
        failure = error
        if (recorder) quiet(recorder)
        take.chunks = []
      }
    }
    if (!take.recorder) {
      take.error = describe(failure ?? new Error('No recorder could start'))
      this.stop('error')
      return
    }

    take.startedAt = deps.now()
    // The canvas was drawn before it was captured: touched, so it is the first frame (frame 0); the clock takes the rest.
    take.frameIndex = 0
    this.requestFrame(take)
    if (typeof video.requestFrame === 'function') this.armFrame(take)
    if (take.spec.limitMs !== null && take.spec.limitMs < VIDEO_LIMITS.maxMs && !take.wholeFile) {
      this.arm('length', take.spec.limitMs, () => this.stop('length'))
    }
    this.arm('cap', VIDEO_LIMITS.maxMs, () => this.stop('cap'))
    this.arm('tick', VIDEO_LIMITS.tickMs, () => this.tick(take))
    this.setState({ phase: 'recording', elapsedMs: 0 })
  }

  private listen(take: Take, recorder: MediaRecorderLike): void {
    recorder.ondataavailable = (event) => {
      if (this.take === take && event.data.size > 0) take.chunks.push(event.data)
    }
    recorder.onstop = () => {
      if (this.take === take && take.recorder === recorder) this.finish(take)
    }
    recorder.onerror = (event) => {
      if (this.take !== take || take.recorder !== recorder) return
      const error = typeof event === 'object' && event !== null && 'error' in event ? event.error : event
      take.error ??= describe(error)
      this.stop('error')
    }
  }

  /** Every tickMs while recording: the elapsed time shown, as whole seconds change. */
  private tick(take: Take): void {
    if (this.take !== take || this.state.phase !== 'recording') return
    const elapsedMs = Math.floor((this.deps.now() - take.startedAt) / 1000) * 1000
    if (elapsedMs !== this.state.elapsedMs) this.setState({ elapsedMs })
    this.arm('tick', VIDEO_LIMITS.tickMs, () => this.tick(take))
  }

  /** Arms the clock for the frame after take.frameIndex, due frameMs after it on the take's own timeline. */
  private armFrame(take: Take): void {
    const due = take.startedAt + (take.frameIndex + 1) * take.frameMs
    this.arm('frame', Math.max(0, due - this.deps.now()), () => this.clockFrame(take))
  }

  /**
   * The clock's frame: the canvas as it is, touched (so it repeats when nothing was drawn since the last frame).
   * A clock that fell behind (a busy tab) skips the frames it missed rather than asking for them all at once; one
   * due right at the recorder's stop is not asked for, as it would be lost.
   */
  private clockFrame(take: Take): void {
    if (this.take !== take || (this.state.phase !== 'recording' && !take.ending)) return
    const now = this.deps.now()
    if (take.endAt !== null && now > take.endAt - FRAME_GUARD_MS) return
    take.frameIndex = Math.max(take.frameIndex + 1, Math.floor((now - take.startedAt) / take.frameMs))
    this.requestFrame(take)
    this.armFrame(take)
  }

  /** Asks for the canvas as the next frame, touching it first in the same task so it is taken at once. */
  private requestFrame(take: Take): void {
    try {
      take.touch?.()
      take.video?.requestFrame?.()
    } catch {
      // A track already ended: the recorder's own events report it.
    }
  }

  /**
   * How long the recorder goes on after the take is stopped for `reason` (ms): long enough for the last frame; when
   * the sound ended the take and its source still feeds the tap, also for the sound still in the audio's delay.
   * Nothing when the tab is hidden (nothing is drawn), after an error, or when the canvas or font changed.
   */
  private tailMs(take: Take, reason: StopReason): number {
    if (reason === 'hidden' || reason === 'error' || reason === 'size' || reason === 'font') return 0
    // A microphone that stopped has left the tap; a file paused or ended has not.
    const tapped = reason === 'length' || (reason === 'source' && take.source === 'file' && this.deps.engine.getState().source === 'file')
    return tapped ? Math.max(VIDEO_LIMITS.finalFrameMs, take.delayMs + VIDEO_LIMITS.drainMs) : VIDEO_LIMITS.finalFrameMs
  }

  /** Stops the recorder after the take's last moments: its stop event saves the file (finish). */
  private stopRecorder(take: Take): void {
    if (this.take !== take) return
    take.ending = false
    this.disarm('drain', 'tick', 'frame')
    const recorder = take.recorder
    if (!recorder || recorder.state === 'inactive') return // Already stopped (after an error): its stop event follows.
    try {
      recorder.stop()
    } catch (error) {
      take.error ??= describe(error)
      this.finish(take)
    }
  }

  /** The recorder has stopped: saves what it gave (once), releases everything, and says how it went. */
  private finish(take: Take): void {
    if (this.take !== take) return
    this.take = null
    take.ending = false
    this.disarm('start', 'length', 'cap', 'tick', 'frame', 'drain', 'stop')
    const mime = take.mime ?? take.spec.mimes[0]
    const type = mime.mimeType.split(';')[0]
    const fileName = videoFileName(take.context.family, take.context.style, take.options.previewLook, mime.format)
    const blob = new Blob(take.chunks, { type })
    take.chunks = []
    let saved = false
    if (blob.size > 0) {
      try {
        this.deps.save(blob, fileName, type)
        saved = true
      } catch (error) {
        take.error ??= describe(error)
      }
    }
    this.release(take)

    const lines: string[] = []
    let tone: 'info' | 'warning' | 'error' = 'info'
    if (take.error !== null) {
      tone = 'error'
      lines.push(failureText(take.error, saved, fileName))
    } else {
      const reason = REASON_TEXT[take.reason ?? 'user']
      if (reason) lines.push(reason)
      if (take.reason === 'hidden' || take.reason === 'size' || take.reason === 'font') tone = 'warning'
      if (saved) lines.push(`Saved ${fileName}: ${formatClock(take.elapsedMs)}, ${take.spec.width} × ${take.spec.height} px.`)
      else {
        lines.push('Nothing was recorded.')
        tone = 'warning'
      }
    }
    if (saved) {
      if (mime.fellBack) lines.push("MP4 isn't supported in this browser: saved as WebM.")
      if (take.audioMissing) lines.push('The sound could not be recorded: the video is silent.')
      if (take.spec.previewLook && !take.blurWorks) lines.push("Blur isn't available for video in this browser: recorded without it.")
      if (take.context.transparent) lines.push('Videos have no transparency: the background colour is painted.')
    }
    this.setState({ phase: 'idle', take: null, elapsedMs: 0, message: { tone, text: lines.join(' ') } })
    if (saved) (this.context ?? take.context).onSaved(fileName)
  }

  /** Drops a take that never recorded: nothing is saved. */
  private abort(take: Take, message: RecordingState['message']): void {
    if (this.take !== take) return
    this.take = null
    this.disarm('start', 'length', 'cap', 'tick', 'frame', 'drain', 'stop')
    this.release(take)
    this.setState({ phase: 'idle', take: null, elapsedMs: 0, message })
  }

  /**
   * Stops the tap and the tracks, gives Loop back unless the user changed it meanwhile, and pauses the file
   * or stops listening only when Record started it.
   */
  private release(take: Take): void {
    const { engine } = this.deps
    if (take.recorder) quiet(take.recorder)
    if (take.audio) engine.stopRecordingAudio()
    if (take.stream) stopTracks(take.stream)
    take.audio?.stop()
    if (take.loop !== null && engine.getState().loop === false) engine.setLoop(take.loop)
    if (take.startedSource) {
      const sound = engine.getState()
      if (sound.source === take.source) {
        if (sound.source === 'file' && sound.playing) engine.pause()
        else if (sound.source === 'microphone' && (sound.listening || sound.busy)) engine.stopMicrophone()
      }
    }
  }

  // --- State and timers --------------------------------------------------------------------------

  private setState(patch: Partial<RecordingState>): void {
    this.state = { ...this.state, ...patch }
    this.blocked = this.blocker()
    for (const listener of this.listeners) listener()
  }

  /** A blocker that changed re-renders the Record button (it reads blocker()). */
  private checkBlocker(): void {
    if (this.blocker() !== this.blocked) this.setState({})
  }

  private readSupport(): RecordingState['support'] {
    const capture = this.deps.canRecord()
    return { capture, ...(capture ? videoSupport(this.deps.isTypeSupported) : { mp4: false, webm: false }) }
  }

  private arm(name: string, ms: number, run: () => void): void {
    this.disarm(name)
    const handle = this.deps.setTimer(() => {
      if (this.timers.get(name) !== handle) return
      this.timers.delete(name)
      run()
    }, ms)
    this.timers.set(name, handle)
  }

  private disarm(...names: string[]): void {
    for (const name of names) {
      if (!this.timers.has(name)) continue
      this.deps.clearTimer(this.timers.get(name))
      this.timers.delete(name)
    }
  }
}

/** Why a take that never recorded was dropped; nothing for Stop. */
function startFailure(take: Take, reason: StopReason): RecordingState['message'] {
  switch (reason) {
    case 'user':
      return null
    case 'source':
      return {
        tone: 'error',
        text: take.ran ? 'The sound stopped before recording began, so nothing was recorded.' : 'The sound did not start, so nothing was recorded.',
      }
    case 'error':
      return { tone: 'error', text: failureText(take.error ?? 'unknown error', false, '') }
    default:
      return { tone: 'warning', text: `${REASON_TEXT[reason] ?? 'Recording stopped.'} Nothing was recorded.` }
  }
}

/** "Recording failed: …", then whether anything was kept. */
function failureText(error: string, saved: boolean, fileName: string): string {
  const failed = `Recording failed: ${error.replace(/[.\s]+$/, '')}.`
  return saved ? `${failed} Saved what was recorded: ${fileName}.` : `${failed} Nothing was recorded.`
}

/** A recorder whose events no longer count, stopped if it still runs. */
function quiet(recorder: MediaRecorderLike): void {
  recorder.ondataavailable = null
  recorder.onstop = null
  recorder.onerror = null
  if (recorder.state === 'inactive') return
  try {
    recorder.stop()
  } catch {
    // Stopping is all that is left to do.
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/** "Name: message" for the message line. */
function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const name = 'name' in error ? String(error.name) : ''
    const message = String(error.message)
    return name && name !== 'Error' ? `${name}: ${message}` : message || name || 'unknown error'
  }
  return error === undefined || error === null ? 'unknown error' : String(error)
}

// --- The page's recorder ---------------------------------------------------------------------------

/** A MediaRecorder behind the MediaRecorderLike handlers. */
function mediaRecorder(tracks: MediaStreamTrack[], options: MediaRecorderOptions): MediaRecorderLike {
  const media = new MediaRecorder(new MediaStream(tracks), options)
  const like: MediaRecorderLike = {
    get state() {
      return media.state
    },
    start: (timeslice) => media.start(timeslice),
    stop: () => media.stop(),
    ondataavailable: null,
    onstop: null,
    onerror: null,
  }
  media.ondataavailable = (event) => like.ondataavailable?.(event)
  media.onstop = () => like.onstop?.()
  media.onerror = (event) => like.onerror?.(event)
  return like
}

function browserDeps(): RecorderDeps {
  return {
    now: () => performance.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    canRecord: () =>
      typeof MediaRecorder === 'function' &&
      typeof MediaStream === 'function' &&
      typeof HTMLCanvasElement === 'function' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function',
    isTypeSupported: (mime) => typeof MediaRecorder === 'function' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime),
    createRecorder: mediaRecorder,
    engine: getSoundEngine(),
    latencyMs: () => liveLatencyMs(),
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisibilityChange: (run) => {
      if (typeof document === 'undefined') return () => {}
      document.addEventListener('visibilitychange', run)
      return () => document.removeEventListener('visibilitychange', run)
    },
    save: (blob, fileName, mime) => downloadFile(blob, fileName, mime),
  }
}

let recorder: RecordingController | null = null

/** The page's single recorder, created on first use. Closing the page during a take asks first. */
export function getRecorder(): RecordingController {
  if (!recorder) {
    const controller = new RecordingController(browserDeps())
    recorder = controller
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (event) => {
        if (controller.getState().phase !== 'idle') event.preventDefault()
      })
    }
  }
  return recorder
}

/** The recorder's state; re-renders when it changes (the elapsed time at most once a second). */
export function useRecording(): RecordingState {
  const controller = getRecorder()
  return useSyncExternalStore(controller.subscribe, controller.getState)
}

/**
 * Tells the recorder the font and the canvas (null without a font). Call once, in App. A new canvas size or
 * scale during a take ends it, as does losing the font or unmounting; other changes (the text, the
 * sliders) are recorded as they happen.
 */
export function useRecordingContext(context: RecordingContext | null): void {
  const controller = getRecorder()
  const onSaved = useRef<((fileName: string) => void) | null>(null)
  useLayoutEffect(() => {
    onSaved.current = context?.onSaved ?? null
  })
  const family = context ? context.family : null
  const style = context?.style ?? ''
  const width = context?.artboard.width ?? 0
  const height = context?.artboard.height ?? 0
  const scale = context?.artboard.scale ?? 0
  const transparent = context?.transparent ?? false
  useLayoutEffect(() => {
    controller.setContext(
      family === null
        ? null
        : { family, style, artboard: { width, height, scale }, transparent, onSaved: (fileName) => onSaved.current?.(fileName) },
    )
  }, [controller, family, style, width, height, scale, transparent])
  useEffect(() => () => controller.setContext(null), [controller])
}
