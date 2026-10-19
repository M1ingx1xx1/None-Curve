// An AnalyserNode emulation and synthetic signals for the Sound tests. The analyser: Blackman window (0.42, 0.5,
// 0.08), radix-2 FFT, |X_k| / N in dB, smoothingTimeConstant 0, the FFT size the engine picks for the sample rate,
// one frame per display refresh; a browser-like rig also moves each frame's window end onto 128-sample render quanta
// and jitters its time. Stereo input is mixed down ((L + R) / 2) as an AnalyserNode mixes it, and the channels are
// passed as `stereo`, as the engine's channel analysers give them.

import { analyserFftSize } from '../../src/sound/engine'
import { FeatureExtractor } from '../../src/sound/features'
import { blackmanWindow as blackman, fftInPlace } from '../../src/sound/offline'
import { DEFAULT_FEATURE_SETTINGS, type FeatureFrame, type FeatureSettings } from '../../src/sound/types'

export const SR = 48000

// ---------- the analyser ----------

// The window and the FFT are the offline analyser's (src/sound/offline.ts), so the two measure alike bit for bit.

/** A frame with whether the kick detector fired in it (Beat merges both detectors; read from the extractor). */
export type ProbedFrame = FeatureFrame & { kick: boolean }

function probe(extractor: FeatureExtractor, frame: FeatureFrame): ProbedFrame {
  const kick = (extractor as unknown as { kick: { lastOnset: number } }).kick.lastOnset === frame.time
  return { ...frame, kick }
}

export interface Rig {
  sr?: number
  fps?: number
  /** Each frame's time moves up to this much either way (ms), as requestAnimationFrame does. */
  jitterMs?: number
  /** The window ends on a multiple of this many samples (a render quantum is 128). */
  quantum?: number
  settings?: FeatureSettings
  /** Pass the left and right samples to the extractor (stereo input only; default true). */
  stereo?: boolean
  /** Changes frame `frame`'s (1, 2, …) mixed-down samples before they are measured, e.g. a one-frame glitch. */
  edit?: (frame: number, samples: Float32Array) => void
  /** Measure with this extractor (to go on from an earlier call) instead of a fresh one; it must match sr. */
  extractor?: FeatureExtractor
  /** Added to every frame's time stamp, not to where its window sits in the signal (an extractor going on). */
  clockMs?: number
}

/** Feeds a mono signal, or a left and a right one, through the emulated analyser and a fresh FeatureExtractor. */
export function analyse(left: Float64Array, right: Float64Array | null = null, rig: Rig = {}): ProbedFrame[] {
  const sr = rig.sr ?? SR
  const fps = rig.fps ?? 60
  const n = analyserFftSize(sr)
  const win = blackman(n)
  const extractor = rig.extractor ?? new FeatureExtractor(sr, n)
  const settings = rig.settings ?? DEFAULT_FEATURE_SETTINGS
  const samples = new Float32Array(n)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  const spectrum = new Float32Array(n / 2)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const stereo = right && rig.stereo !== false ? { left: l, right: r } : undefined
  const frames: ProbedFrame[] = []
  let jitter = 7
  const nextJitter = () => ((jitter = (jitter * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2
  for (let f = 1; ; f++) {
    const time = (f * 1000) / fps + (rig.jitterMs ? nextJitter() * rig.jitterMs : 0)
    const quantum = rig.quantum ?? 1
    const end = Math.floor(Math.round((time / 1000) * sr) / quantum) * quantum
    if (end > left.length) break
    for (let i = 0; i < n; i++) {
      const at = end - n + i
      const a = at >= 0 ? left[at] : 0
      const b = right ? (at >= 0 ? right[at] : 0) : a
      l[i] = a
      r[i] = b
      samples[i] = right ? (a + b) / 2 : a
    }
    rig.edit?.(f, samples)
    for (let i = 0; i < n; i++) {
      re[i] = samples[i] * win[i]
      im[i] = 0
    }
    fftInPlace(re, im)
    for (let k = 0; k < n / 2; k++) {
      const magnitude = Math.hypot(re[k], im[k]) / n
      spectrum[k] = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity
    }
    const clock = time + (rig.clockMs ?? 0)
    frames.push(probe(extractor, extractor.process(spectrum, samples, clock, settings, stereo)))
  }
  return frames
}

// ---------- signals ----------

let seed = 12345
/** Uniform in [0, 1) (mulberry32), from a seed `reseed` sets, so every signal can be repeated. */
export function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export function reseed(value: number): void {
  seed = value
}
export function gauss(): number {
  const u = Math.max(1e-12, rand())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}
export const fromDb = (db: number) => Math.pow(10, db / 20)
export const samplesIn = (seconds: number, sr = SR) => Math.round(seconds * sr)

/** Sine with peak `peakDb` dBFS, sounding from `on` to `off` seconds. */
export function sine(freq: number, peakDb: number, seconds: number, on = 0, off = seconds, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  const a = fromDb(peakDb)
  for (let i = samplesIn(on, sr); i < Math.min(out.length, samplesIn(off, sr)); i++) out[i] = a * Math.sin((2 * Math.PI * freq * i) / sr)
  return out
}

/**
 * Harmonics 1 to `count` of `freq` (below Nyquist) at 1/k of the fundamental's peak `peakDb`, each with phase `phase`
 * × k: a band-limited sawtooth with every harmonic, a buzzy bass with a few. Summed by rotating each harmonic's phasor,
 * so hundreds of harmonics stay quick.
 */
export function harmonics(freq: number, peakDb: number, seconds: number, count = Infinity, phase = 0, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  const a = fromDb(peakDb)
  const top = Math.min(count, Math.floor((sr / 2 - 1) / freq))
  for (let k = 1; k <= top; k++) {
    const w = (2 * Math.PI * freq * k) / sr
    const [c, s] = [Math.cos(w), Math.sin(w)]
    let x = Math.cos(phase * k)
    let y = Math.sin(phase * k)
    const g = a / k
    for (let i = 0; i < out.length; i++) {
      out[i] += g * y
      const nx = x * c - y * s
      y = x * s + y * c
      x = nx
    }
  }
  return out
}

/**
 * A sine whose frequency follows `hz(t)` (t in seconds), phase-continuous, with peak `peakDb` dBFS: the base of
 * notes, glide and vibrato.
 */
export function tone(hz: (t: number) => number, peakDb: number, seconds: number, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  const a = fromDb(peakDb)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    out[i] = a * Math.sin(phase)
    phase += (2 * Math.PI * hz(i / sr)) / sr
  }
  return out
}

/** One note after another, each `stepMs` long, without gaps (a single-note melody). */
export function notes(freqs: readonly number[], stepMs: number, peakDb: number, sr = SR): Float64Array {
  const seconds = (freqs.length * stepMs) / 1000
  return tone((t) => freqs[Math.min(freqs.length - 1, Math.floor((t * 1000) / stepMs))], peakDb, seconds, sr)
}

/** A glide from `from` to `to` Hz over `seconds`, evenly in semitones. */
export function glide(from: number, to: number, seconds: number, peakDb: number, sr = SR): Float64Array {
  return tone((t) => from * (to / from) ** (t / seconds), peakDb, seconds, sr)
}

/** A steady note with vibrato: `cents` either way, `rateHz` times a second. */
export function vibrato(freq: number, cents: number, rateHz: number, seconds: number, peakDb: number, sr = SR): Float64Array {
  return tone((t) => freq * 2 ** ((cents / 1200) * Math.sin(2 * Math.PI * rateHz * t)), peakDb, seconds, sr)
}

/** Band-limited square wave (odd harmonics), peak of the fundamental `peakDb`. */
export function square(freq: number, peakDb: number, seconds: number, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  for (let k = 1; k * freq < sr / 2; k += 2) {
    const h = harmonics(freq * k, peakDb - 20 * Math.log10(k), seconds, 1, 0, sr)
    for (let i = 0; i < out.length; i++) out[i] += h[i]
  }
  return out
}

/** Gaussian white noise with RMS `rmsDb` dBFS. */
export function noise(rmsDb: number, seconds: number, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  const a = fromDb(rmsDb)
  for (let i = 0; i < out.length; i++) out[i] = a * gauss()
  return out
}

/** Approximate pink noise (Paul Kellet's filter on white noise), scaled to RMS `rmsDb` dBFS. */
export function pink(rmsDb: number, seconds: number, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  let [b0, b1, b2, b3, b4, b5, b6] = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < out.length; i++) {
    const w = gauss()
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
  }
  let sum = 0
  for (const v of out) sum += v * v
  const k = fromDb(rmsDb) / Math.sqrt(sum / Math.max(1, out.length))
  for (let i = 0; i < out.length; i++) out[i] *= k
  return out
}

/** Hit times (s) of a regular pattern from `first`, within `seconds`. */
export function hitTimes(perSecond: number, seconds: number, first = 0.3): number[] {
  const out: number[] = []
  for (let i = 0; first + i / perSecond < seconds; i++) out.push(first + i / perSecond)
  return out
}

/** Bass drum hits at these times (s): 60 Hz sine bursts decaying with a 30 ms time constant. */
export function drumHits(times: readonly number[], seconds: number, peakDb = -6, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  const a = fromDb(peakDb)
  for (const t0 of times) {
    const s0 = samplesIn(t0, sr)
    for (let i = 0; i < samplesIn(0.4, sr) && s0 + i < out.length; i++) {
      const t = i / sr
      out[s0 + i] += a * Math.exp(-t / 0.03) * Math.sin(2 * Math.PI * 60 * t)
    }
  }
  return out
}

/** RBJ biquad high-pass, in place. */
function highPass(x: Float64Array, freq: number, q: number, sr: number): void {
  const w = (2 * Math.PI * freq) / sr
  const alpha = Math.sin(w) / (2 * q)
  const cos = Math.cos(w)
  const a0 = 1 + alpha
  const [b0, b1, b2, a1, a2] = [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0]
  let [x1, x2, y1, y2] = [0, 0, 0, 0]
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    ;[x2, x1, y2, y1] = [x1, x[i], y1, y]
    x[i] = y
  }
}

/** Hi-hat: white-noise bursts (20 ms decay), then a 4th-order Butterworth high-pass at 5 kHz. */
export function hiHat(perSecond: number, seconds: number, rmsDb = -12, first = 0.3, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  const a = fromDb(rmsDb)
  for (const t0 of hitTimes(perSecond, seconds, first)) {
    const s0 = samplesIn(t0, sr)
    for (let i = 0; i < samplesIn(0.12, sr) && s0 + i < out.length; i++) out[s0 + i] += a * Math.exp(-i / sr / 0.02) * gauss()
  }
  highPass(out, 5000, 0.5411961, sr)
  highPass(out, 5000, 1.306563, sr)
  return out
}

/** Noise bursts (a snare): white noise decaying with `decay` s, then a 4th-order high-pass at `hpHz`. */
export function bursts(perSecond: number, seconds: number, rmsDb: number, decay: number, hpHz: number, first = 0.3, sr = SR): Float64Array {
  const out = new Float64Array(samplesIn(seconds, sr))
  const a = fromDb(rmsDb)
  for (const t0 of hitTimes(perSecond, seconds, first)) {
    const s0 = samplesIn(t0, sr)
    for (let i = 0; i < samplesIn(Math.min(0.45, 8 * decay), sr) && s0 + i < out.length; i++) out[s0 + i] += a * Math.exp(-i / sr / decay) * gauss()
  }
  highPass(out, hpHz, Math.SQRT1_2, sr)
  highPass(out, hpHz, Math.SQRT1_2, sr)
  return out
}

export function mix(...parts: Float64Array[]): Float64Array {
  const out = new Float64Array(Math.max(...parts.map((p) => p.length)))
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i]
  return out
}

// ---------- reading the frames ----------

export const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
export const from = (frames: ProbedFrame[], ms: number) => frames.filter((f) => f.time >= ms)
export const between = (frames: ProbedFrame[], a: number, b: number) => frames.filter((f) => f.time >= a && f.time < b)

/**
 * Hits as the letters see them, from `fromMs`: frames where the Beat pulse restarts (an onset, or the kick detector),
 * one per hit (restarts within 100 ms of the last are the same hit).
 */
export function hits(frames: ProbedFrame[], fromMs = 0): number[] {
  const out: number[] = []
  for (const f of frames) if ((f.onset || f.kick) && f.time >= fromMs && !(out.length && f.time - out[out.length - 1] < 100)) out.push(f.time)
  return out
}

/** Frames where `key` rises by more than `min` over the frame before: a pulse's start (Melody). */
export function rises(frames: readonly FeatureFrame[], key: 'melody' | 'beat' = 'melody', min = 0.05): FeatureFrame[] {
  return frames.filter((f, i) => i > 0 && f[key] - frames[i - 1][key] > min)
}

/** How many of the expected hit times (s) a hit caught (from 5 ms before to 80 ms after), and the other hits a second. */
export function score(found: readonly number[], expected: readonly number[], fromMs: number, toMs: number) {
  const used = new Set<number>()
  let caught = 0
  for (const t of expected.map((s) => s * 1000).filter((t) => t >= fromMs)) {
    const k = found.findIndex((h, i) => !used.has(i) && h >= t - 5 && h <= t + 80)
    if (k >= 0) {
      caught++
      used.add(k)
    }
  }
  const wanted = expected.filter((s) => s * 1000 >= fromMs).length
  return { recall: wanted ? caught / wanted : 1, falsePerSecond: (found.length - used.size) / ((toMs - fromMs) / 1000) }
}
