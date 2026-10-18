// The video recorder (src/export/recorder.ts) with fakes for the clock and timers, the engine, the canvas, the
// browser's MediaRecorder and the tab's visibility: a take waits for its sound and its first frame, ends for every
// reason with what was recorded saved once (nothing for 0 bytes), keeps what came before an error, plays a Whole
// file from its start with Loop off and gives Loop back, falls from MP4 to WebM and from a refused MIME type to the
// next, delays its audio by the live latency (and half a frame), and leaves a source it did not start running. Frames
// come from a fixed clock at the take's frame rate, whatever the canvas draws: a frame asked for every tick, the last
// drawing repeated when nothing changed, missed frames skipped, and no frame once the recorder stops. The fake canvas
// gives a frame only when it changed since the last one (as Chrome's captureStream does), so every frame the recorder
// asks for touches the canvas first (a real track would otherwise wait for the next drawing); where frames cannot be
// requested, no clock runs. A take asks for the canvas as it is at Stop and records a moment past it (and past the
// sound's end, for the sound still in the audio's delay), so its last frame is in the file. Nothing touches the DOM.

import { describe, expect, it } from 'vitest'
import {
  RecordingController,
  type MediaRecorderLike,
  type RecorderDeps,
  type RecorderEngine,
  type RecordingContext,
  type RecordOptions,
} from '../../src/export/recorder'
import { VIDEO_LIMITS, recordDelayMs } from '../../src/export/videoFormat'
import { INITIAL_SOUND_STATE, type SoundState } from '../../src/sound/types'

const MP4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
const MP4_SILENT = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8']
const CHROME = new Set([...MP4, ...MP4_SILENT, ...WEBM])
const FIREFOX = new Set(WEBM)

interface FakeTrack {
  kind: string
  stopped: boolean
  /** Frames captured, and when; and frames asked for from a canvas that had not changed (none captured). */
  frames: number
  frameTimes: number[]
  lost: number
  stop(): void
  requestFrame?: () => void
}

/** A track; a video track's requestFrame captures a frame when `capture` says the canvas changed (and when). */
function fakeTrack(kind: 'audio' | 'video', frames = true, capture: () => number | null = () => 0): FakeTrack {
  const track: FakeTrack = {
    kind,
    stopped: false,
    frames: 0,
    frameTimes: [],
    lost: 0,
    stop() {
      track.stopped = true
    },
  }
  if (frames) {
    track.requestFrame = () => {
      const at = capture()
      if (at === null) track.lost++
      else {
        track.frames++
        track.frameTimes.push(at)
      }
    }
  }
  return track
}
const asTrack = (track: FakeTrack) => track as unknown as MediaStreamTrack

/** A MediaRecorder: hands over `tail` bytes and reports its end 1 ms after stop() (or an error), unless `silent`. */
class FakeRecorder implements MediaRecorderLike {
  state: MediaRecorderLike['state'] = 'inactive'
  ondataavailable: MediaRecorderLike['ondataavailable'] = null
  onstop: MediaRecorderLike['onstop'] = null
  onerror: MediaRecorderLike['onerror'] = null
  timeslice: number | undefined
  stops = 0
  /** When stop() was first called (a frame captured at that same moment is not in the file). */
  stoppedAt: number | null = null
  tail = 500
  silent = false
  constructor(
    readonly tracks: MediaStreamTrack[],
    readonly options: MediaRecorderOptions,
    private readonly later: (ms: number, run: () => void) => unknown,
    private readonly refuseStart: boolean,
    private readonly clock: () => number,
  ) {}
  start(timeslice?: number) {
    if (this.refuseStart) throw new DOMException('This type cannot start.', 'NotSupportedError')
    this.state = 'recording'
    this.timeslice = timeslice
  }
  stop() {
    this.stops++
    this.stoppedAt ??= this.clock()
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.end()
  }
  /** `bytes` of recorded data arrive. */
  data(bytes: number) {
    if (bytes > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) })
  }
  /** The browser's encoder fails: error, then the last data, then stop. */
  fail(error: unknown) {
    this.state = 'inactive'
    this.onerror?.({ error })
    this.end()
  }
  private end() {
    if (this.silent) return
    this.later(1, () => {
      this.data(this.tail)
      this.onstop?.()
    })
  }
}

const CONTEXT: Omit<RecordingContext, 'onSaved'> = { family: 'Roboto', style: 'Regular', artboard: { width: 1200, height: 800, scale: 1 }, transparent: false }

interface RigOptions {
  sound?: Partial<SoundState>
  supported?: ReadonlySet<string>
  canRecord?: boolean
  /** The canvas track has requestFrame (captureStream(0) works). */
  requestFrame?: boolean
  latency?: number | null
  /** The engine's tap gives an audio track. */
  audioTrack?: boolean
  /** MIME types whose recorder will not construct, or will not start. */
  refuse?: string[]
  refuseStart?: string[]
  record?: Partial<RecordOptions>
  context?: Partial<Omit<RecordingContext, 'onSaved'>>
}

function rig(options: RigOptions = {}) {
  let now = 0
  let nextId = 1
  const timers: { at: number; id: number; run: () => void }[] = []
  const later = (ms: number, run: () => void) => {
    const id = nextId++
    timers.push({ at: now + Math.max(0, ms), id, run })
    return id
  }
  /** Time passes without any timer running (a busy tab): the overdue ones run late, at the next advance. */
  const jump = (ms: number) => {
    now += ms
  }
  /** Runs the timers due in the next `ms`, in order. */
  const advance = (ms: number) => {
    const to = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = timers[0]
      if (!next || next.at > to) break
      timers.shift()
      now = Math.max(now, next.at)
      next.run()
    }
    now = to
  }

  // The engine: Play and Start listening answer after a promise, as the real ones do.
  const calls: string[] = []
  let sound: SoundState = { ...INITIAL_SOUND_STATE, fileName: 'song.wav', duration: 30, loop: true, ...options.sound }
  const soundListeners = new Set<() => void>()
  const setSound = (patch: Partial<SoundState>) => {
    sound = { ...sound, ...patch }
    for (const listener of [...soundListeners]) listener()
  }
  const answers = { play: 'plays' as 'plays' | 'refused' | 'hangs', microphone: 'listens' as 'listens' | 'denied' }
  const taps: number[] = []
  let tapStops = 0
  const audio = fakeTrack('audio', false)
  const engine: RecorderEngine = {
    getState: () => sound,
    subscribeState: (listener) => {
      soundListeners.add(listener)
      return () => {
        soundListeners.delete(listener)
      }
    },
    play: () => {
      calls.push('play')
      setSound({ source: 'file', listening: false })
      if (answers.play === 'hangs') return new Promise<void>(() => {})
      return Promise.resolve().then(() => {
        if (answers.play === 'plays') setSound({ playing: true })
      })
    },
    pause: () => {
      calls.push('pause')
      setSound({ playing: false })
    },
    seek: (seconds) => {
      calls.push(`seek ${seconds}`)
      setSound({ position: seconds })
    },
    setLoop: (loop) => {
      calls.push(`loop ${loop}`)
      setSound({ loop })
    },
    startMicrophone: () => {
      calls.push('startMicrophone')
      setSound({ source: 'microphone', busy: true })
      return Promise.resolve().then(() =>
        setSound(answers.microphone === 'listens' ? { busy: false, listening: true } : { busy: false, error: { kind: 'permission', detail: 'denied' } }),
      )
    },
    stopMicrophone: () => {
      calls.push('stopMicrophone')
      setSound({ listening: false, busy: false })
    },
    startRecordingAudio: (delayMs) => {
      taps.push(delayMs)
      return options.audioTrack === false ? null : asTrack(audio)
    },
    stopRecordingAudio: () => {
      tapStops++
    },
  }

  // The canvas: each capture gives a new video track, which captures a frame only from a canvas that changed (drawn
  // or touched) since its last frame, or since the capture began.
  const videos: FakeTrack[] = []
  const captures: (number | undefined)[] = []
  let changed = false
  let touches = 0
  const capture = () => {
    if (!changed) return null
    changed = false
    return now
  }
  const canvas = {
    captureStream: (fps?: number) => {
      captures.push(fps)
      changed = false
      const video = fakeTrack('video', options.requestFrame !== false, capture)
      videos.push(video)
      return { getVideoTracks: () => [asTrack(video)], getTracks: () => [asTrack(video)] } as unknown as MediaStream
    },
  }
  const touch = () => {
    touches++
    changed = true
  }

  const recorders: FakeRecorder[] = []
  const tried: string[] = []
  const saves: { blob: Blob; fileName: string; mime: string }[] = []
  const saved: string[] = []
  let hidden = false
  let visibilityChanged: (() => void) | null = null
  const supported = options.supported ?? CHROME
  const deps: RecorderDeps = {
    now: () => now,
    setTimer: (run, ms) => later(ms, run),
    clearTimer: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
    canRecord: () => options.canRecord !== false,
    isTypeSupported: (mime) => supported.has(mime),
    createRecorder: (tracks, recorderOptions) => {
      const mime = recorderOptions.mimeType ?? ''
      tried.push(mime)
      if (options.refuse?.includes(mime)) throw new DOMException(`${mime} is not supported.`, 'NotSupportedError')
      const recorder = new FakeRecorder(tracks, recorderOptions, later, options.refuseStart?.includes(mime) ?? false, () => now)
      recorders.push(recorder)
      return recorder
    },
    engine,
    latencyMs: () => (options.latency === undefined ? null : options.latency),
    hidden: () => hidden,
    onVisibilityChange: (run) => {
      visibilityChanged = run
      return () => {
        visibilityChanged = null
      }
    },
    save: (blob, fileName, mime) => {
      saves.push({ blob, fileName, mime })
    },
  }
  const controller = new RecordingController(deps)
  const setContext = (patch: Partial<Omit<RecordingContext, 'onSaved'>> = {}) =>
    controller.setContext({ ...CONTEXT, ...options.context, ...patch, onSaved: (name) => saved.push(name) })
  setContext()
  if (options.record) controller.setOptions(options.record)

  return {
    controller,
    canvas,
    touch,
    calls,
    taps,
    captures,
    videos,
    recorders,
    tried,
    saves,
    saved,
    answers,
    advance,
    jump,
    setSound,
    setContext,
    get sound() {
      return sound
    },
    get state() {
      return controller.getState()
    },
    get recorder() {
      return recorders[recorders.length - 1]
    },
    get video() {
      return videos[videos.length - 1]
    },
    get audio() {
      return audio
    },
    get tapStops() {
      return tapStops
    },
    get touches() {
      return touches
    },
    get now() {
      return now
    },
    /** Timers still armed. */
    get timers() {
      return timers.length
    },
    hide() {
      hidden = true
      visibilityChanged?.()
    },
    /** The recording canvas draws a frame (the scene changed). */
    draw() {
      changed = true
      controller.frameDrawn()
    },
    /** Record, then the sound answers and the canvas mounts and draws. */
    async record() {
      controller.start()
      await settle()
      controller.canvasReady(canvas, true, touch)
      changed = true
      controller.frameDrawn()
    },
    /** The take's last moments (at most the longest audio delay and the drain), then the recorder's last data and its stop event. */
    finish() {
      advance(VIDEO_LIMITS.maxDelayMs + VIDEO_LIMITS.drainMs + 1)
    },
  }
}

/** Lets the engine's promises answer. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

const playing = { playing: true }
/** The audio's delay at 30 fps before any live frame: the default delay and half a frame. */
const DELAY = recordDelayMs(null, 30)

describe('recorder', () => {
  it('waits for the sound and the first drawn frame before recording', async () => {
    const r = rig()
    r.controller.start()
    expect(r.state.phase).toBe('starting')
    expect(r.state.take).toMatchObject({ width: 1200, height: 800, capped: false, previewLook: false, limitMs: null })
    expect(r.calls).toEqual(['play'])
    // The canvas is ready and has drawn, but the sound has not answered yet.
    r.controller.canvasReady(r.canvas, true, r.touch)
    r.draw()
    expect(r.recorders).toHaveLength(0)
    await settle()
    expect(r.state.phase).toBe('recording')
    expect(r.captures).toEqual([0])
    expect(r.recorder.timeslice).toBe(1000)
    expect(r.recorder.options).toMatchObject({ mimeType: MP4[0], videoBitsPerSecond: 4_320_000, audioBitsPerSecond: 128_000 })
    expect(r.recorder.tracks).toEqual([asTrack(r.video), asTrack(r.audio)])
    // The canvas as it was is the first frame (touched, so it is taken at once); the clock takes the next one a frame
    // later, touched too, so it is taken at the tick rather than at the next drawing.
    expect(r.video.frames).toBe(1)
    expect(r.touches).toBe(1)
    r.draw()
    r.draw()
    expect(r.video.frames).toBe(1)
    r.advance(1000 / 30)
    expect(r.video.frames).toBe(2)
    expect(r.touches).toBe(2)
    expect(r.video.lost).toBe(0)
  })

  it('records a still canvas whose capture begins after it was drawn', async () => {
    // Paused file: Record plays it, and the capture begins once it plays, after the canvas drew.
    const r = rig()
    r.controller.start()
    r.controller.canvasReady(r.canvas, true, r.touch)
    r.draw()
    await settle()
    expect(r.state.phase).toBe('recording')
    expect(r.video.frames).toBe(1)
    r.advance(10_000)
    // Nothing drawn for 10 s, yet a frame on every tick of the clock, so the file lasts as long as the take.
    expect(r.video.frames).toBe(301)
    expect(r.video.lost).toBe(0)
    r.controller.stop()
    r.finish()
    expect(r.video.frameTimes.at(-1)).toBeLessThan(r.recorder.stoppedAt!)
    expect(r.state.message?.text).toBe('Saved Roboto-Regular-video.mp4: 0:10, 1200 × 800 px.')
  })

  it('also starts when the sound runs first and the canvas draws later', async () => {
    const r = rig({ sound: playing })
    r.controller.start()
    expect(r.calls).toEqual([])
    r.controller.canvasReady(r.canvas, true, r.touch)
    expect(r.recorders).toHaveLength(0)
    r.draw()
    expect(r.state.phase).toBe('recording')

    // A canvas that draws before it reports itself ready has its first frame already.
    const drawnFirst = rig({ sound: playing })
    drawnFirst.controller.start()
    drawnFirst.draw()
    expect(drawnFirst.recorders).toHaveLength(0)
    drawnFirst.controller.canvasReady(drawnFirst.canvas, true, drawnFirst.touch)
    expect(drawnFirst.state.phase).toBe('recording')
    expect(drawnFirst.video.frames).toBe(1)
  })

  // How long each take goes on after it is stopped: a moment for its last frame; for the file paused, also the sound
  // still in the audio's delay (90 ms before any live frame); nothing when it cannot go on.
  const LAST = VIDEO_LIMITS.finalFrameMs
  const DRAIN = DELAY + VIDEO_LIMITS.drainMs
  it.each([
    ['user', (r: ReturnType<typeof rig>) => r.controller.stop(), '', 'info', LAST],
    ['source', (r: ReturnType<typeof rig>) => r.setSound({ playing: false }), 'The sound stopped, so the recording ended. ', 'info', DRAIN],
    ['source switch', (r: ReturnType<typeof rig>) => r.setSound({ source: 'microphone', playing: false }), 'The sound stopped, so the recording ended. ', 'info', LAST],
    ['hidden', (r: ReturnType<typeof rig>) => r.hide(), 'Recording stopped because the tab was hidden. ', 'warning', 0],
    ['size', (r: ReturnType<typeof rig>) => r.setContext({ artboard: { width: 1200, height: 800, scale: 2 } }), 'Recording stopped because the canvas size changed. ', 'warning', 0],
    ['font', (r: ReturnType<typeof rig>) => r.controller.setContext(null), 'Recording stopped because the font was closed. ', 'warning', 0],
  ] as const)('stops and saves: %s', async (_, end, prefix, tone, tail) => {
    const r = rig()
    await r.record()
    r.advance(2300)
    expect(r.state.elapsedMs).toBe(2000)
    const frames = r.video.frames
    end(r)
    expect(r.state.phase).toBe('stopping')
    if (tail > 0) {
      // The canvas as it is at the stop is asked for at once, not left to the clock's next tick.
      expect(r.video.frames).toBe(frames + 1)
      // The recorder and the clock run on for the tail: frames drawn meanwhile still count.
      expect(r.recorder.stops).toBe(0)
      r.advance(tail / 2)
      r.draw()
      r.advance(tail / 2 - 1)
      expect(r.recorder.stops).toBe(0)
      expect(r.video.frames).toBeGreaterThanOrEqual(frames + Math.floor(tail / (1000 / 30)))
      r.advance(1)
      // Every frame asked for is in the file: none at the moment the recorder stops, and none after.
      expect(r.video.frameTimes.at(-1)).toBeLessThan(r.recorder.stoppedAt!)
      r.draw()
    } else {
      expect(r.video.frames).toBe(frames)
    }
    expect(r.recorder.stops).toBe(1)
    expect(r.state.elapsedMs).toBe(2300)
    const last = r.video.frames
    r.finish()
    expect(r.video.frames).toBe(last)
    expect(r.state).toMatchObject({ phase: 'idle', take: null, elapsedMs: 0 })
    expect(r.saves).toHaveLength(1)
    expect(r.saves[0].fileName).toBe('Roboto-Regular-video.mp4')
    expect(r.saves[0].mime).toBe('video/mp4')
    expect(r.saves[0].blob.type).toBe('video/mp4')
    expect(r.saves[0].blob.size).toBe(500)
    expect(r.saved).toEqual(['Roboto-Regular-video.mp4'])
    expect(r.state.message).toEqual({ tone, text: `${prefix}Saved Roboto-Regular-video.mp4: 0:02, 1200 × 800 px.` })
    // Everything is released.
    expect(r.video.stopped).toBe(true)
    expect(r.audio.stopped).toBe(true)
    expect(r.tapStops).toBe(1)
    // Later events change nothing.
    r.controller.stop()
    r.advance(10_000)
    expect(r.saves).toHaveLength(1)
  })

  it('stops at its length', async () => {
    const r = rig({ record: { length: 5 } })
    await r.record()
    expect(r.state.take?.limitMs).toBe(5000)
    r.advance(4999)
    expect(r.state.phase).toBe('recording')
    r.advance(1)
    expect(r.state.phase).toBe('stopping')
    r.finish()
    expect(r.state.message?.text).toBe('Saved Roboto-Regular-video.mp4: 0:05, 1200 × 800 px.')
  })

  it('stops at the 10-minute cap', async () => {
    const r = rig()
    await r.record()
    r.advance(599_999)
    expect(r.state.phase).toBe('recording')
    r.advance(1)
    r.finish()
    expect(r.state.message?.text).toBe('Stopped at the 10-minute limit. Saved Roboto-Regular-video.mp4: 10:00, 1200 × 800 px.')
    expect(r.saves).toHaveLength(1)
  })

  it('caps a whole file longer than 10 minutes', async () => {
    const r = rig({ sound: { duration: 900 }, record: { length: 'whole-file' } })
    await r.record()
    expect(r.state.take?.limitMs).toBe(600_000)
    r.advance(600_000)
    r.finish()
    expect(r.state.message?.text).toMatch(/^Stopped at the 10-minute limit\. /)
  })

  it('saves what was recorded before an error', async () => {
    const r = rig()
    await r.record()
    r.recorder.data(3000)
    r.advance(1500)
    r.recorder.fail(new Error('Encoder crashed.'))
    expect(r.state.phase).toBe('stopping')
    r.finish()
    expect(r.saves).toHaveLength(1)
    expect(r.saves[0].blob.size).toBe(3500)
    expect(r.state.message).toEqual({
      tone: 'error',
      text: 'Recording failed: Encoder crashed. Saved what was recorded: Roboto-Regular-video.mp4.',
    })
  })

  it('saves nothing for 0 bytes', async () => {
    const r = rig()
    await r.record()
    r.recorder.tail = 0
    r.controller.stop()
    r.finish()
    expect(r.saves).toEqual([])
    expect(r.saved).toEqual([])
    expect(r.state.message).toEqual({ tone: 'warning', text: 'Nothing was recorded.' })

    const failed = rig()
    await failed.record()
    failed.recorder.tail = 0
    failed.recorder.fail(new DOMException('Out of memory', 'UnknownError'))
    failed.finish()
    expect(failed.saves).toEqual([])
    expect(failed.state.message).toEqual({ tone: 'error', text: 'Recording failed: UnknownError: Out of memory. Nothing was recorded.' })
  })

  it('ends a take at once when the tab is hidden during its last moments', async () => {
    const r = rig({ record: { length: 'whole-file' } })
    await r.record()
    r.advance(29_000)
    r.setSound({ playing: false, position: 30 })
    expect(r.recorder.stops).toBe(0)
    r.hide()
    expect(r.recorder.stops).toBe(1)
    r.finish()
    expect(r.state.message?.text).toBe('Saved Roboto-Regular-video.mp4: 0:29, 1200 × 800 px.')
  })

  it('saves what it has when the recorder never reports its end', async () => {
    const r = rig()
    await r.record()
    r.recorder.silent = true
    r.recorder.data(800)
    r.controller.stop()
    r.advance(VIDEO_LIMITS.finalFrameMs + 4999)
    expect(r.state.phase).toBe('stopping')
    r.advance(1)
    expect(r.state.phase).toBe('idle')
    expect(r.saves.map((s) => s.blob.size)).toEqual([800])
  })

  it('plays a whole file from its start with Loop off, ends with it, and gives Loop back', async () => {
    const r = rig({ sound: { position: 12, loop: true }, record: { length: 'whole-file' } })
    await r.record()
    expect(r.calls).toEqual(['loop false', 'seek 0', 'play'])
    expect(r.state.take?.limitMs).toBe(30_000)
    // No timer: the file's end is the length.
    r.advance(29_000)
    expect(r.state.phase).toBe('recording')
    r.setSound({ playing: false, position: 30 })
    // The file's last sound is still in the tap's delay, and the letters answer it about as late: the take goes on
    // for the delay and the drain, then ends.
    expect(r.state.phase).toBe('stopping')
    r.advance(DELAY + VIDEO_LIMITS.drainMs - 1)
    expect(r.recorder.stops).toBe(0)
    expect(r.tapStops).toBe(0)
    r.advance(1)
    expect(r.recorder.stops).toBe(1)
    r.finish()
    expect(r.state.message?.text).toBe('Saved Roboto-Regular-video.mp4: 0:29, 1200 × 800 px.')
    expect(r.calls).toEqual(['loop false', 'seek 0', 'play', 'loop true'])
    expect(r.sound.loop).toBe(true)
  })

  it('leaves Loop alone when the user changed it during the take', async () => {
    const r = rig({ sound: { loop: true }, record: { length: 'whole-file' } })
    await r.record()
    r.setSound({ loop: true })
    r.controller.stop()
    r.finish()
    expect(r.calls).toEqual(['loop false', 'seek 0', 'play', 'pause'])
  })

  it('treats Whole file as Until stopped without a file', async () => {
    const r = rig({ sound: { source: 'microphone', listening: true }, record: { length: 'whole-file' } })
    await r.record()
    expect(r.state.take?.limitMs).toBeNull()
    expect(r.calls).toEqual([])
  })

  it('gives up when the sound or the canvas never starts', async () => {
    const r = rig()
    r.answers.play = 'hangs'
    r.controller.start()
    r.controller.canvasReady(r.canvas, true, r.touch)
    r.draw()
    r.advance(29_999)
    expect(r.state.phase).toBe('starting')
    r.advance(1)
    expect(r.state).toMatchObject({ phase: 'idle', take: null, message: { tone: 'error', text: 'The sound did not start, so nothing was recorded.' } })
    expect(r.recorders).toEqual([])

    const still = rig({ sound: playing })
    still.controller.start()
    still.advance(30_000)
    expect(still.state.message?.text).toBe('The video did not start, so nothing was recorded.')
    expect(still.calls).toEqual([])
  })

  it('drops the take at once when Play is refused or the microphone is denied', async () => {
    const r = rig()
    r.answers.play = 'refused'
    r.controller.start()
    await settle()
    expect(r.state).toMatchObject({ phase: 'idle', message: { text: 'The sound did not start, so nothing was recorded.' } })

    const mic = rig({ sound: { source: 'microphone' } })
    mic.answers.microphone = 'denied'
    mic.controller.start()
    expect(mic.calls).toEqual(['startMicrophone'])
    await settle()
    expect(mic.state.phase).toBe('idle')
    expect(mic.state.message?.text).toBe('The sound did not start, so nothing was recorded.')
  })

  it('drops a starting take quietly on Stop, and pauses the file it started', async () => {
    const r = rig()
    r.controller.start()
    await settle()
    r.controller.stop()
    expect(r.state).toMatchObject({ phase: 'idle', take: null, message: null })
    expect(r.calls).toEqual(['play', 'pause'])
    expect(r.saves).toEqual([])
  })

  it('falls back from MP4 to WebM and says so', async () => {
    const r = rig({ supported: FIREFOX })
    expect(r.state.support).toEqual({ capture: true, mp4: false, webm: true })
    await r.record()
    expect(r.state.take?.mimes[0]).toEqual({ mimeType: 'video/webm;codecs=vp9,opus', format: 'webm', fellBack: true })
    r.controller.stop()
    r.finish()
    expect(r.saves[0]).toMatchObject({ fileName: 'Roboto-Regular-video.webm', mime: 'video/webm' })
    expect(r.state.message?.text).toBe(
      "Saved Roboto-Regular-video.webm: 0:00, 1200 × 800 px. MP4 isn't supported in this browser: saved as WebM.",
    )
  })

  it('keeps how the take ended until it is dismissed or the next take starts', async () => {
    // The header shows the message while idle (the Sound tab, which shows it too, may be closed).
    const r = rig()
    let changes = 0
    r.controller.subscribe(() => changes++)
    await r.record()
    r.setContext({ artboard: { width: 1200, height: 800, scale: 2 } })
    r.finish()
    expect(r.state).toMatchObject({ phase: 'idle', message: { tone: 'warning' } })
    const before = changes
    r.controller.clearMessage()
    expect(r.state.message).toBeNull()
    expect(changes).toBe(before + 1)
    r.controller.clearMessage()
    expect(changes).toBe(before + 1)

    await r.record()
    r.controller.stop()
    r.finish()
    expect(r.state).toMatchObject({ phase: 'idle', message: { tone: 'info' } })
    r.controller.start()
    expect(r.state).toMatchObject({ phase: 'starting', message: null })
  })

  it('tries the next MIME type when one will not construct or start', async () => {
    const r = rig({ refuse: [MP4[0]], refuseStart: [MP4[1]] })
    await r.record()
    expect(r.tried).toEqual(MP4.slice(0, 3))
    expect(r.recorders).toHaveLength(2)
    // The refused one's events no longer count.
    expect(r.recorders[0].onstop).toBeNull()
    expect(r.recorder.state).toBe('recording')
    r.controller.stop()
    r.finish()
    expect(r.saves[0].mime).toBe('video/mp4')
  })

  it('fails without saving when no MIME type works', async () => {
    const r = rig({ refuse: MP4 })
    await r.record()
    expect(r.state.phase).toBe('idle')
    expect(r.state.message).toEqual({ tone: 'error', text: 'Recording failed: NotSupportedError: video/mp4 is not supported. Nothing was recorded.' })
    expect(r.video.stopped).toBe(true)
    expect(r.tapStops).toBe(1)
    expect(r.calls).toEqual(['play', 'pause'])
  })

  it('records no audio when asked not to', async () => {
    const r = rig({ record: { audio: false } })
    await r.record()
    expect(r.taps).toEqual([])
    expect(r.recorder.tracks).toEqual([asTrack(r.video)])
    expect(r.recorder.options.mimeType).toBe(MP4_SILENT[0])
    expect(r.recorder.options.audioBitsPerSecond).toBeUndefined()
    r.controller.stop()
    r.finish()
    expect(r.tapStops).toBe(0)
  })

  it('records silent video, and says so, when the sound cannot be tapped', async () => {
    const r = rig({ audioTrack: false })
    await r.record()
    expect(r.taps).toHaveLength(1)
    expect(r.recorder.tracks).toEqual([asTrack(r.video)])
    expect(r.recorder.options.mimeType).toBe(MP4_SILENT[0])
    r.controller.stop()
    r.finish()
    expect(r.state.message?.text).toContain('The sound could not be recorded: the video is silent.')
  })

  it('delays the audio by the live latency, and records that much past a timed length', async () => {
    const measured = rig({ latency: 50, record: { length: 5 } })
    await measured.record()
    // 50 ms, the analysis lag (37 ms), and half a frame at 30 fps.
    expect(measured.taps).toEqual([104])
    measured.advance(5000)
    expect(measured.state.phase).toBe('stopping')
    measured.advance(104 + VIDEO_LIMITS.drainMs - 1)
    expect(measured.recorder.stops).toBe(0)
    measured.advance(1)
    expect(measured.recorder.stops).toBe(1)
    const unknown = rig()
    await unknown.record()
    expect(unknown.taps).toEqual([DELAY])
    const fast = rig({ latency: 50, record: { fps: 60 } })
    await fast.record()
    expect(fast.taps).toEqual([95])

    // A microphone that stopped has left the tap: only the last frame.
    const mic = rig({ sound: { source: 'microphone', listening: true }, latency: 300 })
    await mic.record()
    mic.setSound({ listening: false })
    mic.advance(VIDEO_LIMITS.finalFrameMs - 1)
    expect(mic.recorder.stops).toBe(0)
    mic.advance(1)
    expect(mic.recorder.stops).toBe(1)
  })

  it('pauses or stops listening only for a source Record started', async () => {
    const started = rig()
    await started.record()
    started.controller.stop()
    started.finish()
    expect(started.calls).toEqual(['play', 'pause'])

    const running = rig({ sound: playing })
    await running.record()
    running.controller.stop()
    running.finish()
    expect(running.calls).toEqual([])
    expect(running.sound.playing).toBe(true)

    const listening = rig({ sound: { source: 'microphone' } })
    await listening.record()
    expect(listening.state.phase).toBe('recording')
    listening.controller.stop()
    listening.finish()
    expect(listening.calls).toEqual(['startMicrophone', 'stopMicrophone'])

    const alreadyListening = rig({ sound: { source: 'microphone', listening: true } })
    await alreadyListening.record()
    alreadyListening.controller.stop()
    alreadyListening.finish()
    expect(alreadyListening.calls).toEqual([])
  })

  it('captures at about the take’s frame rate where frames cannot be requested, with no frame clock', async () => {
    const fallback = rig({ requestFrame: false })
    await fallback.record()
    expect(fallback.captures).toEqual([0, 30])
    expect(fallback.videos[0].stopped).toBe(true)
    expect(fallback.state.phase).toBe('recording')
    // No requestFrame: the browser's capture runs on its own clock, so no second clock touches the canvas against it
    // (the two would drift, repeating or dropping frames); only the first frame is touched.
    fallback.advance(1001)
    expect(fallback.touches).toBe(1)

    const fast = rig({ requestFrame: false, record: { fps: 60 } })
    await fast.record()
    expect(fast.captures).toEqual([0, 60])
  })

  it.each([24, 25, 30, 50, 60] as const)('asks for %i frames a second on its clock, however the canvas draws', async (fps) => {
    const r = rig({ record: { fps } })
    await r.record()
    expect(r.state.take?.fps).toBe(fps)
    // Bursts of drawings 7 ms apart, then a still second, then drawings 50 ms apart: 10 s in all.
    for (let t = 0; t < 3000; t += 7) {
      r.advance(7)
      r.draw()
    }
    r.advance(1000 - (3003 - 3000))
    for (let t = 4000; t < 10_000; t += 50) {
      r.advance(50)
      r.draw()
    }
    // Frame 0 and one a tick for 10 s: no more, no fewer.
    expect(r.now).toBe(10_000)
    expect(r.video.frames).toBe(1 + Math.round(fps * 10))
    expect(r.video.lost).toBe(0)
    const gaps = r.video.frameTimes.slice(1).map((at, i) => at - r.video.frameTimes[i])
    for (const gap of gaps) expect(gap).toBeCloseTo(1000 / fps, 6)
  })

  it('repeats the last drawing when nothing changed, and takes a new one as it is', async () => {
    const r = rig()
    await r.record()
    const frame = 1000 / 30
    // Still: every frame repeats the canvas, touched first.
    r.advance(frame * 3)
    expect(r.video.frames).toBe(4)
    expect(r.touches).toBe(4)
    // Three drawings within one frame: one frame, the canvas as last drawn (every tick touches it, so it is taken at
    // the tick and not at the next drawing).
    r.draw()
    r.draw()
    r.draw()
    r.advance(frame)
    expect(r.video.frames).toBe(5)
    expect(r.touches).toBe(5)
    // Still again: repeats.
    r.advance(frame)
    expect(r.video.frames).toBe(6)
    expect(r.touches).toBe(6)
  })

  it('skips the frames a late clock missed, then keeps to its timeline', async () => {
    const r = rig()
    await r.record()
    const frame = 1000 / 30
    r.advance(frame * 10)
    expect(r.video.frames).toBe(11)
    // A busy tab holds the clock for 510 ms: one frame when it runs again (at 843.3 ms), not fifteen at once.
    r.jump(510)
    r.advance(0)
    expect(r.video.frames).toBe(12)
    // Then on the take's own grid again: frame 26 is due at 866.7 ms.
    r.advance(frame * 26 - r.now - 0.01)
    expect(r.video.frames).toBe(12)
    r.advance(0.02)
    expect(r.video.frames).toBe(13)
    expect(r.video.frameTimes.at(-1)).toBeCloseTo(frame * 26, 6)
  })

  it('stops its frame clock with the take, for every way it ends', async () => {
    const stopped = rig()
    await stopped.record()
    stopped.advance(1000)
    stopped.controller.stop()
    stopped.finish()
    expect(stopped.state.phase).toBe('idle')
    const frames = stopped.video.frames
    expect(stopped.video.frameTimes.at(-1)).toBeLessThan(stopped.recorder.stoppedAt!)
    stopped.advance(5000)
    expect(stopped.video.frames).toBe(frames)
    expect(stopped.timers).toBe(0)

    const hidden = rig()
    await hidden.record()
    hidden.advance(500)
    hidden.hide()
    const atHide = hidden.video.frames
    hidden.advance(1000)
    expect(hidden.video.frames).toBe(atHide)

    const failed = rig()
    await failed.record()
    failed.recorder.fail(new Error('Encoder crashed.'))
    const atFail = failed.video.frames
    failed.advance(1000)
    expect(failed.video.frames).toBe(atFail)
    expect(failed.timers).toBe(0)
  })

  it('scales the bitrate with the frame rate', async () => {
    const slow = rig({ record: { fps: 24 } })
    await slow.record()
    expect(slow.recorder.options.videoBitsPerSecond).toBe(3_456_000)
    const fast = rig({ record: { fps: 60 } })
    await fast.record()
    expect(fast.recorder.options.videoBitsPerSecond).toBe(8_640_000)
  })

  it('notes the missing blur and the painted background', async () => {
    const r = rig({ record: { previewLook: true }, context: { transparent: true } })
    r.controller.start()
    await settle()
    r.controller.canvasReady(r.canvas, false, r.touch)
    r.draw()
    r.controller.stop()
    r.finish()
    expect(r.saves[0].fileName).toBe('Roboto-Regular-video-preview.mp4')
    expect(r.state.message?.text).toBe(
      'Saved Roboto-Regular-video-preview.mp4: 0:00, 1200 × 800 px. ' +
        "Blur isn't available for video in this browser: recorded without it. " +
        'Videos have no transparency: the background colour is painted.',
    )
  })

  it('locks the size and options for the take', async () => {
    const r = rig({ context: { artboard: { width: 1200, height: 800, scale: 4 } } })
    await r.record()
    expect(r.state.take).toMatchObject({ width: 3526, height: 2350, capped: true })
    expect(r.recorder.options.videoBitsPerSecond).toBe(12_000_000)
    r.controller.setOptions({ format: 'webm', length: 5, fps: 60 })
    expect(r.state.options).toMatchObject({ format: 'mp4', length: 'until-stopped', fps: 30 })
    // Text and font name changes are recorded as they happen.
    r.setContext({ artboard: { width: 1200, height: 800, scale: 4 }, family: 'Inter' })
    expect(r.state.phase).toBe('recording')
    r.controller.stop()
    r.finish()
    expect(r.saves[0].fileName).toBe('Roboto-Regular-video.mp4')
    r.controller.setOptions({ format: 'webm', length: 5, fps: 24, audio: false, previewLook: true })
    expect(r.state.options).toEqual({ format: 'webm', length: 5, fps: 24, audio: false, previewLook: true })
    r.controller.setOptions({ format: 'gif' as never, length: 7 as never, fps: 29.97 as never })
    expect(r.state.options).toMatchObject({ format: 'webm', length: 5, fps: 24 })
  })

  it('says why Record cannot start', () => {
    expect(rig({ canRecord: false }).controller.blocker()).toBe('This browser cannot record video.')
    expect(rig({ supported: new Set<string>() }).controller.blocker()).toBe('This browser cannot record video.')
    expect(rig({ sound: { fileName: null } }).controller.blocker()).toBe('Choose an audio file first.')
    expect(rig({ sound: { busy: true, fileName: null } }).controller.blocker()).toBe('Opening the sound…')
    expect(rig({ sound: { source: 'microphone', fileName: null } }).controller.blocker()).toBeNull()
    expect(rig().controller.blocker()).toBeNull()

    const r = rig({ sound: { fileName: null } })
    r.controller.start()
    expect(r.state).toMatchObject({ phase: 'idle', take: null, message: { text: 'Choose an audio file first.' } })
    expect(r.calls).toEqual([])
    r.controller.setContext(null)
    expect(r.controller.blocker()).toBe('Load a font to record.')
  })

  it('tells its listeners when the blocker changes', () => {
    const r = rig({ sound: { fileName: null } })
    let renders = 0
    r.controller.subscribe(() => renders++)
    const before = r.state
    r.setSound({ position: 0.5 })
    expect(renders).toBe(0)
    r.setSound({ fileName: 'song.wav' })
    expect(renders).toBe(1)
    expect(r.state).not.toBe(before)
    expect(r.controller.blocker()).toBeNull()
  })

  it('reads the browser’s support at every look', () => {
    const supported = new Set(WEBM)
    const r = rig({ supported })
    const first = r.state
    expect(r.state).toBe(first)
    expect(first.support).toEqual({ capture: true, mp4: false, webm: true })
    for (const mime of MP4) supported.add(mime)
    expect(r.state.support).toEqual({ capture: true, mp4: true, webm: true })
    expect(r.state).not.toBe(first)
    expect(rig({ canRecord: false }).state.support).toEqual({ capture: false, mp4: false, webm: false })
  })

  it('touches no DOM', async () => {
    expect(typeof document).toBe('undefined')
    const r = rig()
    await r.record()
    r.advance(1000)
    r.controller.stop()
    r.finish()
    expect(r.saves).toHaveLength(1)
  })
})
