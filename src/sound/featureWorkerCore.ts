// The feature worker's logic (features.worker.ts is its shell): it keeps a file's decoded samples, high-passed as the
// engine measures them, and measures them on the 60 Hz grid ahead of the playhead (offline.ts), posting packed
// feature columns a second of audio at a time. Testable without a worker: `post` is passed in and `step` does one
// chunk.
//
// The grid is covered by segments that never overlap, each measured from its start by its own extractor: the linear
// pass from frame 0, and a priority segment for a seek beyond what is covered, which starts PRECOMPUTE_LIMITS.warmupMs
// before the seek with a fresh extractor and cuts the segment it lands in short there. The newest priority segment
// runs first, then the others in the order they were made. A new generation (new settings) drops every segment.

import { analyserFftSize, FeatureExtractor } from './features'
import { gridFrameCount, highpassInPlace, measureFrames, type AnalyserGrid } from './offline'
import { FEATURE_STRIDE, packFrame, PRECOMPUTE_LIMITS } from './timelineTypes'
import type { FeatureSettings } from './types'

export type FeatureWorkerRequest =
  /** A new file: its samples at the context's rate (mono: `right` null), transferred. Measuring starts at once. */
  | { type: 'load'; generation: number; sampleRate: number; left: Float32Array; right: Float32Array | null; settings: FeatureSettings; fromMs: number }
  /** The playhead jumped to `ms`: measure there first, unless it is covered or about to be. */
  | { type: 'seek'; generation: number; ms: number }
  /** Sensitivity or Release changed: everything is measured again, from `fromMs` first. */
  | { type: 'settings'; generation: number; settings: FeatureSettings; fromMs: number }
  /** Forget the file. */
  | { type: 'drop' }

export type FeatureWorkerResponse =
  /** Grid frames start..start+count−1, FEATURE_STRIDE values each (timelineTypes packFrame). */
  | { type: 'columns'; generation: number; start: number; count: number; values: Float64Array }
  /** Every frame of this generation is measured. */
  | { type: 'done'; generation: number }
  | { type: 'error'; generation: number; message: string }

/** Frames per posted chunk: a second of audio. */
export const CHUNK_FRAMES = PRECOMPUTE_LIMITS.gridHz

interface Segment {
  start: number
  /** Exclusive; cut short when a newer segment starts inside. */
  end: number
  /** The next frame to measure. */
  next: number
  extractor: FeatureExtractor
}

export class FeatureWorkerCore {
  private generation = -1
  private sampleRate = 0
  private channels: { left: Float32Array; right: Float32Array | null } | null = null
  private settings: FeatureSettings | null = null
  private frames = 0
  /** Every segment, by start. */
  private segments: Segment[] = []
  /** Unfinished segments, the one to measure first at the front. */
  private order: Segment[] = []
  private readonly grid: AnalyserGrid = { hz: PRECOMPUTE_LIMITS.gridHz }

  constructor(private readonly post: (message: FeatureWorkerResponse, transfer?: Transferable[]) => void) {}

  handle(message: FeatureWorkerRequest): void {
    if (message.type === 'drop') {
      this.channels = null
      this.segments = []
      this.order = []
      return
    }
    if (message.type === 'load') {
      this.sampleRate = message.sampleRate
      // The engine measures the sound after its 20 Hz high-pass, each channel on its own (a BiquadFilterNode).
      highpassInPlace(message.left, message.sampleRate)
      if (message.right) highpassInPlace(message.right, message.sampleRate)
      this.channels = { left: message.left, right: message.right }
      this.frames = gridFrameCount(message.left.length, message.sampleRate, this.grid)
      this.restart(message.generation, message.settings, message.fromMs)
      return
    }
    if (!this.channels) return
    if (message.type === 'settings') this.restart(message.generation, message.settings, message.fromMs)
    else if (message.generation === this.generation) this.seek(message.ms)
  }

  /** Measures one chunk of the first unfinished segment and posts it. False when nothing is left to do. */
  step(): boolean {
    const segment = this.order[0]
    const channels = this.channels
    if (!segment || !channels || !this.settings) return false
    const from = segment.next
    const to = Math.min(segment.end, from + CHUNK_FRAMES)
    try {
      const right = channels.right ?? channels.left
      const measured = measureFrames({ left: channels.left, right }, this.sampleRate, this.settings, this.grid, from, to, segment.extractor)
      const values = new Float64Array(measured.length * FEATURE_STRIDE)
      measured.forEach((frame, row) => packFrame(frame, values, row))
      segment.next = to
      this.post({ type: 'columns', generation: this.generation, start: from, count: measured.length, values }, [values.buffer])
    } catch (error) {
      this.order = []
      this.post({ type: 'error', generation: this.generation, message: error instanceof Error ? error.message : String(error) })
      return false
    }
    if (segment.next >= segment.end) this.order.shift()
    if (this.order.length === 0) this.post({ type: 'done', generation: this.generation })
    return this.order.length > 0
  }

  /** Grid frame of media ms `ms`, within the file. */
  private index(ms: number): number {
    return Math.min(Math.max(0, this.frames - 1), Math.max(0, Math.floor((ms * this.grid.hz) / 1000)))
  }

  private restart(generation: number, settings: FeatureSettings, fromMs: number) {
    this.generation = generation
    this.settings = settings
    const linear = this.segment(0, this.frames)
    this.segments = [linear]
    this.order = this.frames > 0 ? [linear] : []
    if (fromMs > 0) this.seek(fromMs)
  }

  private segment(start: number, end: number): Segment {
    return { start, end, next: start, extractor: new FeatureExtractor(this.sampleRate, analyserFftSize(this.sampleRate)) }
  }

  /**
   * Measures around `ms` first: nothing when it is covered; the segment it is in moves to the front when that segment
   * reaches it within the warm-up; otherwise a priority segment starts a warm-up before it.
   */
  private seek(ms: number) {
    if (this.frames === 0) return
    const at = this.index(ms)
    const segment = this.segments.find((s) => s.start <= at && at < s.end)
    if (!segment || segment.next > at) return
    const warmup = Math.round((PRECOMPUTE_LIMITS.warmupMs * this.grid.hz) / 1000)
    const start = Math.max(segment.start, at - warmup)
    let first = segment
    if (start > segment.next) {
      first = this.segment(start, segment.end)
      segment.end = start
      this.segments.splice(this.segments.indexOf(segment) + 1, 0, first)
      if (segment.next >= segment.end) this.order = this.order.filter((s) => s !== segment)
    }
    this.order = [first, ...this.order.filter((s) => s !== first)]
  }
}
