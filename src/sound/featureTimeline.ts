// The precomputed feature timeline of the file loaded in the Sound tab (page side). It decodes the file at the audio
// context's rate, hands the samples to the feature worker (features.worker.ts), and keeps the packed frames it posts:
// the planner (planner.ts) reads them by grid index. Files longer than PRECOMPUTE_LIMITS.maxSeconds are not decoded, and
// files whose samples would pass PRECOMPUTE_LIMITS.maxBytes are not kept (too much memory): both stay on the live path. The whole file is measured in order from its
// start (the plan is made from 0 too, planner.ts); new Sensitivity or Release settings start a new generation, and
// every frame is measured again from the start.

import { gridFrameCount } from './offline'
import type { FeatureWorkerRequest, FeatureWorkerResponse } from './featureWorkerCore'
import type { FeatureSource } from './planner'
import { FEATURE_FIELDS, FEATURE_STRIDE, PRECOMPUTE_LIMITS, unpackFrame } from './timelineTypes'
import type { FeatureFrame, FeatureSettings } from './types'

/** What the timeline needs of a worker (a fake one in tests). */
export interface FeatureWorkerLike {
  postMessage(message: FeatureWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent<FeatureWorkerResponse>) => void) | null
}

/** Decodes a file's bytes at the context's rate (BaseAudioContext.decodeAudioData). */
export type AudioDecoder = (bytes: ArrayBuffer) => Promise<AudioBuffer>

const startFeatureWorker = (): FeatureWorkerLike =>
  new Worker(new URL('./features.worker.ts', import.meta.url), { type: 'module' }) as unknown as FeatureWorkerLike

export class FeatureTimeline implements FeatureSource {
  readonly hz = PRECOMPUTE_LIMITS.gridHz
  private worker: FeatureWorkerLike | null = null
  private frames = 0
  private values = new Float64Array(0)
  private have = new Uint8Array(0)
  private generation = 0
  /** Bumped by every load and clear, so a decode overtaken by a newer one is dropped. */
  private token = 0
  private settings: FeatureSettings | null = null
  /** Paused (the microphone is the source): a load still decoding then starts paused too. */
  private paused = false
  /** Frames measured contiguously from the start. */
  private contiguous = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly createWorker: () => FeatureWorkerLike = startFeatureWorker) {}

  /**
   * Decodes `file` and starts measuring it (from `fromMs` first). False when it is too long, cannot be decoded, or a
   * newer load or clear overtook it.
   */
  async load(file: Blob, decode: AudioDecoder, settings: FeatureSettings, fromMs = 0): Promise<boolean> {
    const token = ++this.token
    this.reset()
    let buffer: AudioBuffer
    try {
      buffer = await decode(await file.arrayBuffer())
    } catch {
      return false
    }
    if (token !== this.token || !(buffer.duration <= PRECOMPUTE_LIMITS.maxSeconds) || buffer.length === 0) return false
    // The memory the worker will keep, worked out before anything is copied.
    if (buffer.length * Math.min(buffer.numberOfChannels, 2) * 4 > PRECOMPUTE_LIMITS.maxBytes) return false
    // Copies: the worker takes them over, and the AudioBuffer goes. More than two channels: the first two (the engine
    // mixes such files down by the speaker rules; precompute measures their front pair).
    const left = buffer.getChannelData(0).slice()
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : null
    this.frames = gridFrameCount(left.length, buffer.sampleRate, { hz: this.hz })
    this.values = new Float64Array(this.frames * FEATURE_STRIDE)
    this.have = new Uint8Array(this.frames)
    this.settings = settings
    this.generation++
    const worker = this.ensureWorker()
    const transfer: Transferable[] = right ? [left.buffer, right.buffer] : [left.buffer]
    worker.postMessage(
      { type: 'load', generation: this.generation, sampleRate: buffer.sampleRate, left, right, settings, fromMs },
      transfer,
    )
    if (this.paused) worker.postMessage({ type: 'pause' })
    this.notify()
    return true
  }

  /** Forgets the file (a new one, a failure, or precompute off). */
  clear() {
    this.token++
    this.reset()
    this.worker?.postMessage({ type: 'drop' })
    this.notify()
  }

  /** Stops measuring, keeping the samples and the frames (the microphone is the source). */
  pause() {
    this.paused = true
    this.worker?.postMessage({ type: 'pause' })
  }

  /** Measures on after a pause. */
  resume() {
    this.paused = false
    this.worker?.postMessage({ type: 'resume' })
  }

  /** Stops the worker for good. */
  dispose() {
    this.clear()
    this.worker?.terminate()
    this.worker = null
  }

  /** A file is loaded (being measured or measured). */
  isLoaded(): boolean {
    return this.frames > 0
  }

  /** Sensitivity or Release changed: a new generation, measured again from `fromMs` (the start, by default). */
  setSettings(settings: FeatureSettings, fromMs = 0) {
    const s = this.settings
    if (!this.frames || (s && s.sensitivity === settings.sensitivity && s.releaseMs === settings.releaseMs)) return
    this.settings = settings
    this.generation++
    this.have.fill(0)
    this.contiguous = 0
    this.worker?.postMessage({ type: 'settings', generation: this.generation, settings, fromMs })
    this.notify()
  }

  /** Media ms up to which every frame from the start is measured (0 before any). */
  measuredUntil(): number {
    return (this.contiguous * 1000) / this.hz
  }

  /** Measures around `ms` first when it is not covered (kept for the protocol; the director measures in order). */
  seek(ms: number) {
    if (!this.frames || this.covered(ms)) return
    this.worker?.postMessage({ type: 'seek', generation: this.generation, ms })
  }

  /** The current generation (bumps with every load and settings change). */
  currentGeneration(): number {
    return this.generation
  }

  frameCount(): number {
    return this.frames
  }

  isCovered(index: number): boolean {
    return index >= 0 && index < this.frames && this.have[index] === 1
  }

  /** Whether the frame at media ms `ms` is measured. */
  covered(ms: number): boolean {
    return this.isCovered(Math.floor((ms * this.hz) / 1000))
  }

  frameAt(index: number): FeatureFrame | null {
    return this.isCovered(index) ? unpackFrame(this.values, index, (index * 1000) / this.hz) : null
  }

  /** The frame at media ms `ms`, interpolated between its grid neighbours (events from the earlier one); null if not measured. */
  at(ms: number): FeatureFrame | null {
    const position = (ms * this.hz) / 1000
    const i = Math.floor(position)
    const a = this.frameAt(i)
    if (!a) return null
    const b = this.frameAt(i + 1)
    const f = position - i
    if (!b || f === 0) return { ...a, time: ms }
    const out = { ...a, time: ms }
    for (const field of FEATURE_FIELDS) {
      if (field === 'onset' || field === 'silent') continue
      const x = a[field]
      const y = b[field]
      // -Infinity (digital silence) does not interpolate.
      out[field] = Number.isFinite(x) && Number.isFinite(y) ? x + (y - x) * f : x
    }
    return out
  }

  /** Calls `listener` when frames arrive or the timeline changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private reset() {
    this.frames = 0
    this.values = new Float64Array(0)
    this.have = new Uint8Array(0)
    this.settings = null
    this.contiguous = 0
    this.generation++
  }

  private ensureWorker(): FeatureWorkerLike {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    worker.onmessage = (event) => this.receive(event.data)
    this.worker = worker
    return worker
  }

  private receive(message: FeatureWorkerResponse) {
    if (message.generation !== this.generation) return
    if (message.type === 'error') {
      console.error('Sound: measuring the file ahead failed', message.message)
      return
    }
    if (message.type !== 'columns') return
    const { start, count, values } = message
    if (start < 0 || start + count > this.frames) return
    this.values.set(values, start * FEATURE_STRIDE)
    this.have.fill(1, start, start + count)
    while (this.contiguous < this.frames && this.have[this.contiguous] === 1) this.contiguous++
    this.notify()
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}
