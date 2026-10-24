// The analyser offline: what the engine's graph measures while a file plays (engine.ts: the 20 Hz high-pass, the
// AnalyserNode's Blackman window, FFT and dB spectrum, the channels mixed down, one frame per display refresh), done
// on decoded samples ahead of the playhead, for the precomputed file timeline (featureTimeline.ts). Frames sit on a
// fixed media-time grid, so the same file always gives the same features. tests/helpers/audio.ts emulates the
// browser's analyser with the same window and FFT, and the offline frames equal its frames bit for bit.

import type { FeatureExtractor } from './features'
import { SOUND_LIMITS, type FeatureFrame, type FeatureSettings } from './types'

/** Normalised biquad coefficients (a0 = 1). */
export interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** The engine's measuring high-pass: Web Audio reads a high-pass Q in dB, and −3 dB is Butterworth (Q 0.707). */
export const HIGHPASS_Q_DB = 20 * Math.log10(Math.SQRT1_2)

/**
 * A Web Audio BiquadFilterNode's 'highpass' coefficients (the spec's formulas, Q in dB) at sample rate `sr`: the
 * engine's 20 Hz filter by default.
 */
export function highpassCoefficients(
  sr: number,
  hz: number = SOUND_LIMITS.minFeatureHz,
  qDb: number = HIGHPASS_Q_DB,
): BiquadCoefficients {
  const w0 = (2 * Math.PI * hz) / sr
  const alpha = Math.sin(w0) / (2 * Math.pow(10, qDb / 20))
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

/** A biquad in Direct Form I, its state in doubles, as one channel of a BiquadFilterNode. */
class Biquad {
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  constructor(private readonly c: BiquadCoefficients) {}

  /** Filters `channel` in place (from where the last call stopped: the state carries over). */
  run(channel: Float32Array | Float64Array): void {
    const { b0, b1, b2, a1, a2 } = this.c
    let { x1, x2, y1, y2 } = this
    for (let i = 0; i < channel.length; i++) {
      const x = channel[i]
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y
      channel[i] = y
    }
    this.x1 = x1
    this.x2 = x2
    this.y1 = y1
    this.y2 = y2
  }
}

/** The engine's 20 Hz measuring high-pass over a whole channel, in place. */
export function highpassInPlace(channel: Float32Array | Float64Array, sr: number): void {
  new Biquad(highpassCoefficients(sr)).run(channel)
}

const windows = new Map<number, Float64Array>()

/** The AnalyserNode's Blackman window (a = 0.16: 0.42, 0.5, 0.08) of `n` samples, made once per size. */
export function blackmanWindow(n: number): Float64Array {
  let w = windows.get(n)
  if (!w) {
    w = new Float64Array(n)
    for (let i = 0; i < n; i++)
      w[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n)
    windows.set(n, w)
  }
  return w
}

/** In-place radix-2 complex FFT (the length a power of two). */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let i = 0; i < n; i += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < size / 2; k++) {
        const a = i + k
        const b = a + size / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** The frame grid: frames per media second, and the render quantum a window ends on (1: any sample). */
export interface AnalyserGrid {
  hz: number
  quantum?: number
}

/** Media ms of grid frame `k`. */
function gridTime(k: number, hz: number): number {
  return (k * 1000) / hz
}

/** The sample after the last one grid frame `k`'s window holds (its window is the fftSize samples before it). */
function frameEnd(k: number, sr: number, grid: AnalyserGrid): number {
  const quantum = grid.quantum ?? 1
  return Math.floor(Math.round((gridTime(k, grid.hz) / 1000) * sr) / quantum) * quantum
}

/** How many grid frames a signal of `length` samples has: frame k exists while its window ends within the signal. */
export function gridFrameCount(length: number, sr: number, grid: AnalyserGrid): number {
  let k = Math.floor((length / sr) * grid.hz) + 2
  while (k > 0 && frameEnd(k - 1, sr, grid) > length) k--
  return k
}

/** The samples to measure: mono (`right` null, no Pan) or a left and a right channel (mixed down as (L + R) / 2). */
export interface MeasuredChannels {
  left: ArrayLike<number>
  right: ArrayLike<number> | null
}

/**
 * Measures grid frames `from` to `to` (exclusive) of the signal with `extractor`, as the engine's analysers would:
 * each frame's window is the fftSize samples before frameEnd (zeros before the start), mixed down to Float32, windowed,
 * transformed, |X_k| / N in dB (Float32), and passed to the extractor with the frame's media time. Apply the high-pass
 * first (highpassInPlace) to measure what the engine measures. The extractor carries on from its last frame.
 */
export function measureFrames(
  channels: MeasuredChannels,
  sr: number,
  settings: FeatureSettings,
  grid: AnalyserGrid,
  from: number,
  to: number,
  extractor: FeatureExtractor,
): FeatureFrame[] {
  const n = extractor.fftSize
  const win = blackmanWindow(n)
  const { left, right } = channels
  const samples = new Float32Array(n)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  const spectrum = new Float32Array(n / 2)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const stereo = right ? { left: l, right: r } : undefined
  const frames: FeatureFrame[] = []
  const last = Math.min(to, gridFrameCount(left.length, sr, grid))
  for (let k = Math.max(0, from); k < last; k++) {
    const end = frameEnd(k, sr, grid)
    for (let i = 0; i < n; i++) {
      const at = end - n + i
      const a = at >= 0 ? left[at] : 0
      const b = right ? (at >= 0 ? right[at] : 0) : a
      l[i] = a
      r[i] = b
      samples[i] = right ? (a + b) / 2 : a
    }
    for (let i = 0; i < n; i++) {
      re[i] = samples[i] * win[i]
      im[i] = 0
    }
    fftInPlace(re, im)
    for (let k2 = 0; k2 < n / 2; k2++) {
      const magnitude = Math.hypot(re[k2], im[k2]) / n
      spectrum[k2] = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity
    }
    frames.push(extractor.process(spectrum, samples, gridTime(k, grid.hz), settings, stereo))
  }
  return frames
}
