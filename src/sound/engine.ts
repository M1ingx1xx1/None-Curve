// The Sound tab's audio engine: one Web Audio graph per page, with a file or the microphone as its
// source, measured every animation frame. Audio stays in the browser: files are read through object
// URLs, nothing is fetched or uploaded.
//
// The graph:
//
//   <audio> → MediaElementAudioSourceNode ─┬→ destination (the speakers)
//                                           └→ high-pass (20 Hz, measuring only) ─┬→ AnalyserNode (no output)
//   microphone → MediaStreamAudioSourceNode ──→ high-pass                          └→ up-mix to 2 channels
//                                                    → ChannelSplitter ─┬→ AnalyserNode, left (no output)
//                                                                       └→ AnalyserNode, right (no output)
//
// The analysers are taps with nothing connected after them, so only the file reaches the speakers: the
// microphone is measured, never played back, and cannot feed back however the sources are switched.
// The high-pass removes DC offset (which some microphones have) from what is measured, not from playback.
// While a video records, the running source also feeds a delay into a MediaStream destination (the video's
// audio track, startRecordingAudio); that branch reaches no speaker either.
// The first analyser hears the channels mixed down (spectrum and samples); the left and right ones give
// Pan. A mono source is up-mixed to identical left and right, so it reads centred. The three
// are read one after another, so each frame checks that their samples belong together (readSamples).
//
// The context is created lazily, inside the first call that comes from a user gesture (choosing a file
// or a source, Play, Start listening), because browsers keep a context made earlier suspended; Play and
// Start listening resume it in their gesture whatever made it.
// After a short idle spell (nothing playing or listening) it is suspended again, to save CPU and battery.
// Every public method catches its own failures and reports them in `state.error`; none throws or
// rejects, so the UI can call them from event handlers without awaiting.

import { FeatureExtractor } from './features'
import type { FeatureFrame, FeatureSettings, SoundError, SoundErrorKind, SoundSource, SoundState, StereoSamples } from './types'
import { INITIAL_SOUND_STATE, SILENT_FRAME, SOUND_LIMITS } from './types'

/** Position updates while playing are at least this far apart (ms): about 4 per second. */
const POSITION_INTERVAL_MS = 200
/** A file whose length is still unknown after this long (ms) counts as unreadable. */
const METADATA_TIMEOUT_MS = 30_000
/** How long (ms) to look for the length of a file that reports an infinite one. */
const LENGTH_PROBE_MS = 5_000
/** How long (ms) nothing has to play or listen before the audio context is suspended, saving CPU and battery. */
const IDLE_SUSPEND_MS = 2_000
/** Reads of a frame's samples before Pan holds its last value instead (readSamples). */
const SAMPLE_READS = 3
/** Mixed-down samples read together with the left and right ones equal their mean within this (float rounding). */
const STEREO_MATCH = 1e-6
/** The recording tap's delay range (s): from the live latency, set once per take. */
const RECORD_DELAY_MIN_S = 0.04
const RECORD_DELAY_MAX_S = 0.4

/**
 * The analyser's FFT size for a sample rate: SOUND_LIMITS.fftSize at 44.1/48 kHz, scaled by powers of two so the
 * window stays about 43 ms and the bins about 23 Hz wide (4096 at 88.2/96 kHz, 8192 at 176.4/192 kHz). The
 * features' thresholds were tuned at 48 kHz and hold at other rates only so.
 */
export function analyserFftSize(sampleRate: number): number {
  const scale = Math.round(Math.log2(sampleRate / 48000))
  return Math.min(32768, Math.max(512, SOUND_LIMITS.fftSize * 2 ** (Number.isFinite(scale) ? scale : 0)))
}

/** A failure with the kind shown in the Sound tab; thrown inside the engine, caught before leaving it. */
class SoundFailure extends Error {
  constructor(
    readonly kind: SoundErrorKind,
    readonly detail = '',
  ) {
    super(detail || kind)
  }
}

export class SoundEngine {
  private state: SoundState = INITIAL_SOUND_STATE
  private readonly stateListeners = new Set<() => void>()
  private readonly frameListeners = new Set<(frame: FeatureFrame) => void>()
  private readonly seekListeners = new Set<() => void>()
  /** Frame listeners that threw already: logged once each, not 60 times a second. */
  private readonly failedListeners = new WeakSet<object>()

  // The graph (null until the first gesture, and again after dispose).
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  /** The analyser's input: removes DC offset and rumble from what is measured (sources connect here). */
  private highpass: BiquadFilterNode | null = null
  /** The stereo measuring branch: the high-passed sound as exactly two channels, split, one analyser each. */
  private upmix: GainNode | null = null
  private splitter: ChannelSplitterNode | null = null
  private leftAnalyser: AnalyserNode | null = null
  private rightAnalyser: AnalyserNode | null = null
  private extractor: FeatureExtractor | null = null
  /** Reused every frame, so the loop allocates nothing. */
  private spectrum = new Float32Array(0)
  private samples = new Float32Array(0)
  /** The left and right analysers' samples, for Pan. */
  private stereo = { left: new Float32Array(0), right: new Float32Array(0) }
  /** The last left and right samples that matched the mixed-down ones, held over a frame whose reads never did. */
  private heldStereo = { left: new Float32Array(0), right: new Float32Array(0) }
  /** The last frame's reads never matched (a source of more than two channels, or a torn read): read once, use as is. */
  private stereoMismatched = false

  // File source. One element for the page's lifetime, and so one MediaElementAudioSourceNode: an
  // element can be connected to a context only once.
  private audio: HTMLAudioElement | null = null
  private audioEvents: AbortController | null = null
  private mediaSource: MediaElementAudioSourceNode | null = null
  private objectUrl: string | null = null
  private loading = false
  /** Bumped by every loadFile (and dispose), so a load overtaken by a newer one leaves no trace. */
  private loadToken = 0
  private cancelLoad: (() => void) | null = null
  private lastPositionAt = -Infinity

  // Microphone source.
  private stream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private trackEvents: AbortController | null = null
  private micPending = false
  /** Bumped by every start and stop, so a permission prompt answered after Stop listening or a switch to File is dropped. */
  private micToken = 0

  // Recording: the running source, delayed, into a stream for the video's audio track (startRecordingAudio).
  private tap: { source: AudioNode; delay: DelayNode; dest: MediaStreamAudioDestinationNode } | null = null

  // Frame loop.
  private rafId: number | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private lastFrame: FeatureFrame = SILENT_FRAME
  private silentSince: number | null = null
  private processFailed = false

  /** The current state (a new object whenever anything changes, so it works with useSyncExternalStore). */
  getState(): SoundState {
    return this.state
  }
  /** Calls `listener` whenever the state changes; returns the unsubscribe function. */
  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }
  /** Calls `listener` with every measured frame (about once per animation frame) while a source runs; returns the unsubscribe function. */
  subscribeFrames(listener: (frame: FeatureFrame) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }
  /** Calls `listener` whenever the file has been sought (a seek, or a loop back to its start); returns the unsubscribe function. */
  subscribeSeeks(listener: () => void): () => void {
    this.seekListeners.add(listener)
    return () => {
      this.seekListeners.delete(listener)
    }
  }
  /**
   * Switches the source: choosing 'microphone' pauses the file, choosing 'file' releases the microphone (the
   * frame loop stops either way, and the listeners get SILENT_FRAME). Never opens the microphone: choosing
   * 'microphone' only shows its controls, and only startMicrophone (Start listening) opens it.
   */
  async setSource(source: SoundSource): Promise<void> {
    const changed = source !== this.state.source
    if (source === 'microphone') {
      if (!changed) return
      this.pauseFile()
      this.extractor?.reset()
      // Choosing Microphone only shows its controls; the microphone opens only from Start listening (SOUND_PLAN §3, §10).
      this.setState({ source, playing: false, listening: false, busy: this.loading, error: null })
      return
    }
    this.cancelMicrophone()
    // Creating the context here, in the gesture, lets Play start at once; failing here says early
    // that this browser cannot analyse sound.
    let error: SoundError | null = null
    try {
      this.ensureGraph()
    } catch (failure) {
      error = toSoundError(failure)
    }
    this.setState({ source, listening: false, busy: this.loading, error })
    if (changed) this.extractor?.reset()
  }
  /** Opens a local file (never uploaded) and makes 'file' the source; does not start playback. */
  async loadFile(file: File): Promise<void> {
    if (file.size > SOUND_LIMITS.maxFileBytes) {
      // Rejected before anything reads it.
      this.setState({ error: soundError('too-large', `${Math.round(file.size / (1024 * 1024))} MB`) })
      return
    }
    if (file.size === 0) {
      // Browsers report a 0-byte file as an unsupported format (MediaError 4), never as zero length.
      this.setState({ error: soundError('empty', '0 bytes') })
      return
    }
    let audio: HTMLAudioElement
    try {
      audio = this.ensureFileElement()
    } catch (failure) {
      this.setState({ source: 'file', error: toSoundError(failure) })
      return
    }
    this.cancelLoad?.()
    this.cancelMicrophone()
    this.pauseFile()
    this.stopRecordingAudio()
    const token = ++this.loadToken
    this.loading = true
    const url = URL.createObjectURL(file)
    const previousUrl = this.objectUrl
    this.objectUrl = url
    this.extractor?.reset()
    this.setState({ source: 'file', fileName: null, duration: 0, position: 0, playing: false, listening: false, busy: true, error: null })
    audio.src = url
    // Revoked only after the element has let go of it (Safari reads from the URL while it plays).
    if (previousUrl) URL.revokeObjectURL(previousUrl)

    let duration: number | null
    let failure: SoundFailure | null = null
    try {
      duration = await this.waitForMetadata(audio)
      if (duration !== null && !(duration > 0)) failure = new SoundFailure('empty', `Duration ${duration}`)
      else if (duration === Infinity) failure = new SoundFailure('decode', 'The file does not report its length.')
    } catch (error) {
      duration = 0
      failure = error instanceof SoundFailure ? error : new SoundFailure('decode', describe(error))
    }
    // Overtaken by a newer file, or disposed: that call owns the state now.
    if (duration === null || token !== this.loadToken) return
    this.loading = false

    if (failure) {
      this.clearFile()
      this.setState({
        fileName: null,
        duration: 0,
        position: 0,
        playing: false,
        busy: this.micPending,
        // A failure the user can no longer see (they switched to the microphone meanwhile) is not shown.
        error: this.state.source === 'file' ? soundError(failure.kind, failure.detail) : this.state.error,
      })
      return
    }
    if (this.state.source === 'file') this.extractor?.reset()
    this.lastPositionAt = -Infinity
    this.setState({ fileName: file.name, duration, position: 0, playing: false, busy: this.micPending })
  }
  async play(): Promise<void> {
    const audio = this.audio
    if (!audio || !this.objectUrl || this.loading || this.state.fileName === null) return
    // Both inside the gesture, before anything is awaited.
    this.resumeContext()
    if (this.state.source !== 'file') {
      this.cancelMicrophone()
      this.extractor?.reset()
    }
    this.setState({ source: 'file', listening: false, busy: this.loading, error: null })
    try {
      await audio.play()
    } catch (error) {
      if (audio !== this.audio) return
      const name = errorName(error)
      // AbortError: paused (or a new file chosen) before playback began. NotAllowedError: the browser
      // wants a click first; the button simply stays on Play.
      const shown = name === 'AbortError' || name === 'NotAllowedError' ? null : soundError('decode', describe(error))
      this.setState({ playing: !audio.paused, error: shown })
      return
    }
    if (audio === this.audio && !audio.paused && this.state.source === 'file') this.setState({ playing: true })
  }
  pause(): void {
    this.pauseFile()
    this.setState({ playing: false, error: null })
  }
  seek(seconds: number): void {
    const audio = this.audio
    if (!audio || this.loading || !(this.state.duration > 0)) return
    const time = clamp(Number.isFinite(seconds) ? seconds : 0, 0, this.state.duration)
    audio.currentTime = time
    this.setState({ position: time })
  }
  setLoop(loop: boolean): void {
    if (this.audio) this.audio.loop = loop
    this.setState({ loop })
  }
  /** Starts listening to the microphone (asks the browser for permission). Call from a user gesture. */
  async startMicrophone(): Promise<void> {
    if (this.state.listening || this.micPending) {
      this.setState({ source: 'microphone' })
      return
    }
    this.pauseFile()
    const fail = (kind: SoundErrorKind, detail: string) =>
      this.setState({ source: 'microphone', playing: false, listening: false, busy: this.loading, error: soundError(kind, detail) })
    if (typeof window === 'undefined' || !window.isSecureContext) {
      fail('insecure', 'This page is not a secure context.')
      return
    }
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      fail('unsupported', 'navigator.mediaDevices.getUserMedia is not available.')
      return
    }
    let graph: { ctx: AudioContext; input: AudioNode }
    try {
      graph = this.ensureGraph()
    } catch (failure) {
      const error = toSoundError(failure)
      fail(error.kind, error.detail)
      return
    }
    this.resumeContext()
    const token = ++this.micToken
    this.micPending = true
    this.setState({ source: 'microphone', playing: false, busy: true, error: null })

    let stream: MediaStream
    try {
      // Raw input: the browser's voice-call processing would flatten the very dynamics we measure.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (error) {
      if (token !== this.micToken) return
      this.micPending = false
      fail(microphoneErrorKind(error), describe(error))
      return
    }
    if (token !== this.micToken || graph.ctx !== this.ctx) {
      // Stopped, switched away, or disposed while the browser was asking.
      stopTracks(stream)
      return
    }
    this.micPending = false

    let micSource: MediaStreamAudioSourceNode
    try {
      micSource = graph.ctx.createMediaStreamSource(stream)
      micSource.connect(graph.input) // Never to the destination.
    } catch (error) {
      // The device is open (getUserMedia succeeded): this is the audio graph refusing the stream, e.g. a sample rate
      // the context cannot take, or a closed context; not another app holding the microphone.
      stopTracks(stream)
      fail('mic-connect', describe(error))
      return
    }
    const trackEvents = new AbortController()
    for (const track of stream.getAudioTracks()) {
      // Unplugged (or the permission revoked) while listening.
      track.addEventListener('ended', () => this.onTrackEnded(stream), { signal: trackEvents.signal })
    }
    this.stream = stream
    this.micSource = micSource
    this.trackEvents = trackEvents
    this.extractor?.reset()
    this.setState({ source: 'microphone', listening: true, busy: this.loading, error: null })
  }
  /** Stops listening and releases the microphone. */
  stopMicrophone(): void {
    this.cancelMicrophone()
    this.setState({ listening: false, busy: this.loading, error: null })
  }
  /**
   * The sound as measured (the file as heard, or the microphone, never sent to the speakers), delayed by
   * delayMs (clamped to 40–400 ms) so it lines up with the letters, for a recording; null without a running
   * source. The listener hears no change. One at a time: a new call replaces the last. The track goes silent
   * when the tap stops (stopRecordingAudio, a source switch, a new file, dispose); whoever holds it stops it.
   */
  startRecordingAudio(delayMs: number): MediaStreamTrack | null {
    this.stopRecordingAudio()
    const ctx = this.ctx
    const source = this.state.playing ? this.mediaSource : this.state.listening ? this.micSource : null
    if (!ctx || ctx.state === 'closed' || !source) return null
    let delay: DelayNode | null = null
    try {
      delay = ctx.createDelay(1)
      const seconds = (Number.isFinite(delayMs) ? delayMs : 0) / 1000
      delay.delayTime.value = clamp(seconds, RECORD_DELAY_MIN_S, RECORD_DELAY_MAX_S)
      const dest = ctx.createMediaStreamDestination()
      const track = dest.stream.getAudioTracks()[0]
      if (!track) return null
      source.connect(delay)
      delay.connect(dest)
      this.tap = { source, delay, dest }
      return track
    } catch (error) {
      console.error('Sound: the recording tap failed', error)
      if (delay) {
        try {
          source.disconnect(delay)
        } catch {
          // Never connected.
        }
        delay.disconnect()
      }
      return null
    }
  }
  /** Disconnects the recording tap; the recording's audio track goes silent. */
  stopRecordingAudio(): void {
    const tap = this.tap
    if (!tap) return
    this.tap = null
    try {
      tap.source.disconnect(tap.delay)
    } catch {
      // Already disconnected (the source's own disconnect() drops every connection).
    }
    tap.delay.disconnect()
  }
  setSettings(patch: Partial<FeatureSettings>): void {
    const current = this.state.settings
    const sensitivity = clampSetting(patch.sensitivity, SOUND_LIMITS.minSensitivity, SOUND_LIMITS.maxSensitivity, current.sensitivity)
    const releaseMs = clampSetting(patch.releaseMs, SOUND_LIMITS.minReleaseMs, SOUND_LIMITS.maxReleaseMs, current.releaseMs)
    if (sensitivity === current.sensitivity && releaseMs === current.releaseMs) return
    this.setState({ settings: { sensitivity, releaseMs } })
  }
  /**
   * Stops everything and releases the microphone, the audio context, and the file's object URL.
   * The engine stays usable: the next gesture builds a new graph (a page restored from the
   * back-forward cache starts again on File, with no file). Loop and the analysis settings are kept.
   */
  dispose(): void {
    this.loadToken++
    this.cancelLoad?.()
    this.loading = false
    this.cancelMicrophone()
    this.stopRecordingAudio()
    this.clearFile()
    this.audioEvents?.abort()
    this.audioEvents = null
    this.audio = null
    this.mediaSource?.disconnect()
    this.mediaSource = null
    this.highpass?.disconnect()
    this.highpass = null
    this.analyser?.disconnect()
    this.analyser = null
    this.upmix?.disconnect()
    this.upmix = null
    this.splitter?.disconnect()
    this.splitter = null
    this.leftAnalyser?.disconnect()
    this.leftAnalyser = null
    this.rightAnalyser?.disconnect()
    this.rightAnalyser = null
    this.extractor = null
    this.cancelIdleSuspend()
    const ctx = this.ctx
    this.ctx = null
    if (ctx) ctx.close().catch(() => {})
    this.setState({ ...INITIAL_SOUND_STATE, loop: this.state.loop, settings: this.state.settings })
    this.stopLoop()
  }

  // --- State ---------------------------------------------------------------------------------

  /** Applies a patch as a new state object and tells the listeners; does nothing when nothing changes. */
  private setState(patch: Partial<SoundState>): void {
    const next: SoundState = { ...this.state, ...patch }
    // "No sound" only means something while playing or listening.
    if (!next.playing && !next.listening) next.noSound = false
    if (sameState(next, this.state)) return
    this.state = next
    this.syncLoop()
    for (const listener of this.stateListeners) listener()
  }

  // --- Graph -----------------------------------------------------------------------------------

  /**
   * The context and analysers, created on first use; sources connect to `input`. Throws SoundFailure('unsupported')
   * without Web Audio.
   */
  private ensureGraph(): { ctx: AudioContext; input: AudioNode } {
    if (this.ctx && this.analyser && this.highpass) return { ctx: this.ctx, input: this.highpass }
    const AudioContextClass = typeof window === 'undefined' ? undefined : window.AudioContext
    if (typeof AudioContextClass !== 'function') throw new SoundFailure('unsupported', 'Web Audio is not available.')
    let ctx: AudioContext
    try {
      ctx = new AudioContextClass()
    } catch (error) {
      throw new SoundFailure('unsupported', describe(error))
    }
    let analyser: AnalyserNode
    let highpass: BiquadFilterNode
    let upmix: GainNode
    let splitter: ChannelSplitterNode
    let left: AnalyserNode
    let right: AnalyserNode
    try {
      const fftSize = analyserFftSize(ctx.sampleRate)
      analyser = ctx.createAnalyser()
      analyser.fftSize = fftSize
      // Raw frames: FeatureExtractor does its own smoothing, with separate attack and release.
      analyser.smoothingTimeConstant = 0
      analyser.minDecibels = -100
      analyser.maxDecibels = 0
      highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      // 20 Hz; the filter's zero at DC removes any offset completely.
      highpass.frequency.value = SOUND_LIMITS.minFeatureHz
      // Web Audio reads a high-pass Q in dB: −3 dB is a Butterworth response (Q 0.707), with no peak.
      highpass.Q.value = 20 * Math.log10(Math.SQRT1_2)
      highpass.connect(analyser)
      // Exactly two channels by the speaker rules: mono becomes identical left and right, more than two mix down.
      upmix = ctx.createGain()
      upmix.channelCount = 2
      upmix.channelCountMode = 'explicit'
      upmix.channelInterpretation = 'speakers'
      splitter = ctx.createChannelSplitter(2)
      left = ctx.createAnalyser()
      right = ctx.createAnalyser()
      for (const channel of [left, right]) {
        channel.fftSize = fftSize
        channel.smoothingTimeConstant = 0
      }
      highpass.connect(upmix)
      upmix.connect(splitter)
      splitter.connect(left, 0)
      splitter.connect(right, 1)
    } catch (error) {
      ctx.close().catch(() => {})
      throw new SoundFailure('unsupported', describe(error))
    }
    this.ctx = ctx
    this.analyser = analyser
    this.highpass = highpass
    this.upmix = upmix
    this.splitter = splitter
    this.leftAnalyser = left
    this.rightAnalyser = right
    this.extractor = new FeatureExtractor(ctx.sampleRate, analyser.fftSize)
    this.spectrum = new Float32Array(analyser.frequencyBinCount)
    this.samples = new Float32Array(analyser.fftSize)
    this.stereo = { left: new Float32Array(left.fftSize), right: new Float32Array(right.fftSize) }
    this.heldStereo = { left: new Float32Array(left.fftSize), right: new Float32Array(right.fftSize) }
    this.stereoMismatched = false
    return { ctx, input: highpass }
  }

  /** Lets the context run; called inside the gesture whenever playback or listening starts. */
  private resumeContext(): void {
    this.cancelIdleSuspend()
    // Not only when 'suspended': a suspend() still in flight reads 'running' until it lands, and a resume() queued after it undoes it.
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {})
  }

  /** Suspends the context after IDLE_SUSPEND_MS with nothing playing, listening, or waiting for the microphone. */
  private scheduleIdleSuspend(): void {
    if (this.idleTimer !== null || !this.ctx) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      const ctx = this.ctx
      if (!ctx || ctx.state !== 'running' || this.state.playing || this.state.listening || this.micPending) return
      ctx.suspend().catch(() => {})
    }, IDLE_SUSPEND_MS)
  }

  private cancelIdleSuspend(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  // --- File ------------------------------------------------------------------------------------

  /** The page's audio element (created in code, never in the DOM), wired into the graph once. */
  private ensureFileElement(): HTMLAudioElement {
    const { ctx, input } = this.ensureGraph()
    if (this.audio) return this.audio
    if (typeof document === 'undefined') throw new SoundFailure('unsupported', 'No document to play audio in.')
    const audio = document.createElement('audio')
    audio.preload = 'auto'
    audio.loop = this.state.loop
    let mediaSource: MediaElementAudioSourceNode
    try {
      mediaSource = ctx.createMediaElementSource(audio)
    } catch (error) {
      throw new SoundFailure('unsupported', describe(error))
    }
    mediaSource.connect(ctx.destination)
    mediaSource.connect(input)

    const events = new AbortController()
    const on = (type: string, handler: () => void) =>
      audio.addEventListener(
        type,
        () => {
          // Events from a load in progress belong to waitForMetadata.
          if (audio === this.audio && !this.loading) handler()
        },
        { signal: events.signal },
      )
    on('play', () => {
      // Started by something other than Play (media keys): only while File is the source.
      if (this.state.source !== 'file') {
        audio.pause()
        return
      }
      this.resumeContext()
      this.setState({ playing: true })
    })
    on('pause', () => this.setState({ playing: false, position: audio.currentTime }))
    on('ended', () => this.setState({ playing: false, position: this.state.duration }))
    on('seeked', () => {
      this.updatePosition(true)
      for (const listener of this.seekListeners) listener()
    })
    on('timeupdate', () => this.updatePosition(false))
    on('durationchange', () => {
      // Some formats (VBR MP3) refine their length while they play.
      const duration = audio.duration
      if (this.state.fileName !== null && Number.isFinite(duration) && duration > 0) this.setState({ duration })
    })
    on('error', () => {
      if (this.objectUrl) this.setState({ playing: false, error: mediaFailure(audio.error) })
    })

    this.audio = audio
    this.audioEvents = events
    this.mediaSource = mediaSource
    return audio
  }

  /**
   * Resolves with the file's length once the element knows it, or null when overtaken by a newer
   * load; rejects with SoundFailure('decode') when the browser cannot read the file.
   */
  private waitForMetadata(audio: HTMLAudioElement): Promise<number | null> {
    return new Promise<number | null>((resolve, reject) => {
      const events = new AbortController()
      let timer: ReturnType<typeof setTimeout>
      const finish = (settle: () => void) => {
        events.abort()
        clearTimeout(timer)
        if (this.cancelLoad === cancel) this.cancelLoad = null
        settle()
      }
      const cancel = () => finish(() => resolve(null))
      this.cancelLoad = cancel
      timer = setTimeout(() => finish(() => reject(new SoundFailure('decode', 'The file took too long to open.'))), METADATA_TIMEOUT_MS)
      const options = { signal: events.signal }
      audio.addEventListener('error', () => finish(() => reject(mediaFailure(audio.error))), options)
      audio.addEventListener(
        'loadedmetadata',
        () => {
          if (audio.duration !== Infinity) {
            finish(() => resolve(audio.duration))
            return
          }
          // Some recordings (MediaRecorder WebM) learn their length only at the end: seeking far past
          // it makes the browser find it.
          clearTimeout(timer)
          timer = setTimeout(() => finish(() => resolve(Infinity)), LENGTH_PROBE_MS)
          audio.addEventListener(
            'durationchange',
            () => {
              if (!Number.isFinite(audio.duration)) return
              audio.currentTime = 0
              finish(() => resolve(audio.duration))
            },
            options,
          )
          audio.currentTime = 1e101
        },
        options,
      )
    })
  }

  /** Copies the element's position into the state: always after a seek, at most ~4 times a second while playing. */
  private updatePosition(force: boolean): void {
    const audio = this.audio
    if (!audio) return
    const now = performance.now()
    if (!force && !audio.paused && now - this.lastPositionAt < POSITION_INTERVAL_MS) return
    this.lastPositionAt = now
    this.setState({ position: audio.currentTime })
  }

  private pauseFile(): void {
    if (this.audio && !this.audio.paused) this.audio.pause()
  }

  /** Unloads the file from the element and revokes its object URL. The element stays for the next file. */
  private clearFile(): void {
    const audio = this.audio
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }

  // --- Microphone ------------------------------------------------------------------------------

  /** Releases the microphone (and drops a pending permission request) without touching the state. */
  private cancelMicrophone(): void {
    if (this.tap && this.tap.source === this.micSource) this.stopRecordingAudio()
    this.micToken++
    this.micPending = false
    this.trackEvents?.abort()
    this.trackEvents = null
    this.micSource?.disconnect()
    this.micSource = null
    if (this.stream) stopTracks(this.stream)
    this.stream = null
  }

  private onTrackEnded(stream: MediaStream): void {
    if (stream !== this.stream) return
    this.cancelMicrophone()
    this.setState({ listening: false, busy: this.loading, error: soundError('mic-ended', 'The audio track ended.') })
  }

  // --- Frame loop ------------------------------------------------------------------------------

  /** Runs the loop exactly while a file plays or the microphone listens; suspends the context once idle. */
  private syncLoop(): void {
    const running = this.state.playing || this.state.listening
    if (running) {
      this.cancelIdleSuspend()
      if (this.rafId === null && this.analyser && typeof requestAnimationFrame === 'function') this.rafId = requestAnimationFrame(this.tick)
    } else {
      this.stopLoop()
      this.scheduleIdleSuspend()
    }
  }

  /** Stops the loop and tells the frame listeners, once, that the sound has stopped. */
  private stopLoop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.silentSince = null
    this.emit(SILENT_FRAME)
  }

  private tick = (): void => {
    this.rafId = null
    const { analyser, leftAnalyser, rightAnalyser, extractor } = this
    if (!(this.state.playing || this.state.listening) || !analyser || !leftAnalyser || !rightAnalyser || !extractor) return
    // Scheduled first, so nothing below can stop the loop.
    this.rafId = requestAnimationFrame(this.tick)
    analyser.getFloatFrequencyData(this.spectrum)
    const stereo = this.readSamples(analyser, leftAnalyser, rightAnalyser)
    const now = performance.now()
    let frame: FeatureFrame
    try {
      frame = extractor.process(this.spectrum, this.samples, now, this.state.settings, stereo)
    } catch (error) {
      if (!this.processFailed) console.error('Sound: measuring a frame failed', error)
      this.processFailed = true
      return
    }
    this.trackSilence(frame.silent, now)
    this.emit(frame)
  }

  /**
   * Reads the mixed-down samples into `samples` and returns the left and right ones. The three analysers are read
   * one after another, and the audio thread can render between two reads (in Chrome up to one frame in 300),
   * leaving one block a few render quanta behind: a mono source can then lean to one side for that frame. For one
   * or two channels the mixed-down samples are the mean of left and right, so reads that do not match are read
   * again, up to SAMPLE_READS times; when none match, the last left and right that did are returned, so Pan
   * holds for that frame. A source of more than two channels never matches (the analyser mixes it down by
   * other weights), so after one held frame its reads are used as they are, once each, until one matches.
   */
  private readSamples(analyser: AnalyserNode, left: AnalyserNode, right: AnalyserNode): StereoSamples {
    const { samples, stereo, heldStereo } = this
    const reads = this.stereoMismatched ? 1 : SAMPLE_READS
    for (let read = 0; read < reads; read++) {
      analyser.getFloatTimeDomainData(samples)
      left.getFloatTimeDomainData(stereo.left)
      right.getFloatTimeDomainData(stereo.right)
      if (isMixOf(samples, stereo.left, stereo.right)) {
        this.stereoMismatched = false
        heldStereo.left.set(stereo.left)
        heldStereo.right.set(stereo.right)
        return stereo
      }
    }
    const hold = !this.stereoMismatched
    this.stereoMismatched = true
    return hold ? heldStereo : stereo
  }

  /** Raises `noSound` after silentNoticeMs of silence and drops it on the first sound; state changes only on change. */
  private trackSilence(silent: boolean, now: number): void {
    if (!silent) {
      this.silentSince = null
      if (this.state.noSound) this.setState({ noSound: false })
      return
    }
    this.silentSince ??= now
    if (!this.state.noSound && now - this.silentSince >= SOUND_LIMITS.silentNoticeMs) this.setState({ noSound: true })
  }

  /** Sends a frame to every listener; SILENT_FRAME only once in a row. One failing listener does not stop the others. */
  private emit(frame: FeatureFrame): void {
    if (frame === SILENT_FRAME && this.lastFrame === SILENT_FRAME) return
    this.lastFrame = frame
    for (const listener of this.frameListeners) {
      try {
        listener(frame)
      } catch (error) {
        if (this.failedListeners.has(listener)) continue
        this.failedListeners.add(listener)
        console.error('Sound: a frame listener failed', error)
      }
    }
  }
}

/** Whether every mixed-down sample is the mean of the left and right ones, as when all three were read at one moment. */
function isMixOf(mixed: Float32Array, left: Float32Array, right: Float32Array): boolean {
  const n = Math.min(mixed.length, left.length, right.length)
  for (let i = 0; i < n; i++) {
    const m = mixed[i]
    if (!(Math.abs(m - (left[i] + right[i]) / 2) <= STEREO_MATCH * (1 + Math.abs(m)))) return false
  }
  return true
}

function soundError(kind: SoundErrorKind, detail = ''): SoundError {
  return { kind, detail }
}

function toSoundError(error: unknown): SoundError {
  return error instanceof SoundFailure ? soundError(error.kind, error.detail) : soundError('unsupported', describe(error))
}

/** getUserMedia's DOMException names → what the Sound tab says. */
function microphoneErrorKind(error: unknown): SoundErrorKind {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-device'
    case 'NotReadableError':
    case 'AbortError':
      // The device is there but did not open.
      return 'device-busy'
    default:
      // Anything unexpected (a TypeError, a name this browser invented): not a busy device.
      return 'unsupported'
  }
}

function mediaFailure(error: MediaError | null): SoundFailure {
  if (!error) return new SoundFailure('decode')
  // Codes 3 (decode) and 4 (format not supported) are the usual ones; 1 and 2 cannot really happen
  // for a local file and mean the same to the user.
  return new SoundFailure('decode', `MediaError ${error.code}${error.message ? `: ${error.message}` : ''}`)
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
}

/** "Name: message" for the tooltip. */
function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const name = errorName(error)
    const message = String(error.message)
    return name && name !== 'Error' ? `${name}: ${message}` : message
  }
  return String(error)
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A setting clamped to its range; a missing or non-numeric value keeps the current one. */
function clampSetting(value: number | undefined, min: number, max: number, current: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : current
}

function sameState(a: SoundState, b: SoundState): boolean {
  return (Object.keys(a) as (keyof SoundState)[]).every((key) => a[key] === b[key])
}

let engine: SoundEngine | null = null
let onPageHide: (() => void) | null = null

/** The page's single engine, created on first use. Leaving the page disposes it (releasing the microphone). */
export function getSoundEngine(): SoundEngine {
  if (!engine) {
    engine = new SoundEngine()
    if (typeof window !== 'undefined' && !onPageHide) {
      onPageHide = () => engine?.dispose()
      window.addEventListener('pagehide', onPageHide)
    }
  }
  return engine
}

// In development, a hot reload must not leave the old engine holding the microphone.
// Vite runs hot.dispose only for the accepted module (here the React components that import this
// file), not for this module. So each new instance tears down the previous one through hot.data,
// which Vite keeps for each module path across updates. hot.dispose still covers pruning.
if (import.meta.hot) {
  const teardown = () => {
    engine?.dispose()
    engine = null
    if (onPageHide && typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
    onPageHide = null
  }
  ;(import.meta.hot.data.disposeSound as (() => void) | undefined)?.()
  import.meta.hot.data.disposeSound = teardown
  import.meta.hot.dispose(teardown)
}
