// Audio features for the Sound tab, measured from one analyser frame at a time. Pure: no DOM, no Web
// Audio; the engine passes in what the AnalyserNode measured, so this runs in tests on synthetic signals.
//
// Per frame: Level (RMS of the samples, DC offset removed), Low / Mid / High (band energy against each
// band's own recent loudest value), Brightness (spectral centroid of 20 Hz – 20 kHz on a log scale), all
// smoothed with a fast attack and a slower release; and two onset events, Kick (spectral flux in the bass
// band only) and Beat (flux over the whole spectrum, or any Kick). Each fires above an adaptive threshold:
// the median of the last second × a factor plus a floor, and at least a fraction of the last onset's own
// flux as it decays, so a hit's noisy tail does not count as new hits. Onsets are judged at most about 60
// times a second, so the thresholds mean the same on any display.

import { type FeatureFrame, type FeatureSettings, SOUND_LIMITS } from './types'

/** dB per second by which a band's running maximum falls: its energy halves every bandMemorySeconds. */
const BAND_DECAY_DB_PER_S = (10 * Math.log10(2)) / SOUND_LIMITS.bandMemorySeconds
/**
 * Band dB at the silence threshold. A Blackman-windowed one-sided spectrum holds about 0.152 of a signal's power
 * (sum(w^2)/N is about 0.305, halved), so band dB sits about 8.2 dB below RMS dBFS. A band at or below this reads 0,
 * even while another band keeps the frame above the silence gate, and its running maximum never falls below it.
 */
const BAND_SILENCE_DB = SOUND_LIMITS.silenceDb + 10 * Math.log10(0.152)
/** Onsets are judged at most about 60 times a second: a frame closer than this (ms) to the last judged one only updates the meters. */
const FLUX_MIN_STEP_MS = 12
/** dB → linear magnitude: 10^(dB / 20) = exp(dB × ln 10 / 20). */
const DB_TO_LN = Math.LN10 / 20

/** Bins [start, end) whose centre frequency lies in [lo, hi). */
interface BinRange {
  start: number
  end: number
}

/**
 * Turns analyser frames into FeatureFrames, keeping the history that smoothing, band memory and onsets
 * need. One per audio graph; reset() it whenever the source changes.
 */
export class FeatureExtractor {
  private readonly binCount: number
  /** Centre frequency of each bin (Hz). */
  private readonly binHz: Float32Array
  /**
   * First bin at or above SOUND_LIMITS.minFeatureHz (bin 0, DC, is skipped in Brightness and flux). The window
   * still leaks a DC offset into bins 1–2, so the engine high-passes the analyser input at minFeatureHz.
   */
  private readonly firstBin: number
  /** First bin at or above SOUND_LIMITS.maxFeatureHz: Brightness sums bins [firstBin, centroidEnd). */
  private readonly centroidEnd: number
  private readonly bands: readonly BinRange[]
  private readonly kickBins: BinRange

  /** Linear magnitudes of the current frame (reused). */
  private readonly mag: Float32Array
  /** Compressed magnitudes of the current and the previous frame; swapped every frame, never reallocated. */
  private compressed: Float32Array
  private prevCompressed: Float32Array
  private hasPrev = false
  /** When prevCompressed was taken (ms). */
  private prevFluxTime = 0

  private prevTime: number | null = null
  /** Smoothed outputs: level, low, mid, high, brightness. Valid once `primed`. */
  private readonly smooth = new Float64Array(5)
  private readonly targets = new Float64Array(5)
  private primed = false
  /** Running maximum of each band, in dB (after Sensitivity). */
  private readonly bandMax = new Float64Array(3).fill(-Infinity)

  private readonly beat = new OnsetDetector(SOUND_LIMITS.fluxFactor, SOUND_LIMITS.fluxFloor)
  private readonly kick = new OnsetDetector(SOUND_LIMITS.kickFluxFactor, SOUND_LIMITS.kickFluxFloor)

  /**
   * @param sampleRate the audio context's sample rate (Hz)
   * @param fftSize the analyser's FFT size; spectra passed to `process` have fftSize / 2 bins
   */
  constructor(
    readonly sampleRate: number,
    readonly fftSize: number,
  ) {
    this.binCount = Math.max(1, Math.floor(fftSize / 2))
    const step = sampleRate / fftSize
    this.binHz = new Float32Array(this.binCount)
    for (let k = 0; k < this.binCount; k++) this.binHz[k] = k * step
    const range = ([lo, hi]: readonly [number, number]): BinRange => ({
      start: Math.min(this.binCount, Math.max(0, Math.ceil(lo / step))),
      // Bins with k × step < hi; an infinite edge runs to the last bin (Nyquist).
      end: Number.isFinite(hi) ? Math.min(this.binCount, Math.max(0, Math.ceil(hi / step))) : this.binCount,
    })
    this.firstBin = range([SOUND_LIMITS.minFeatureHz, Infinity]).start
    this.centroidEnd = Math.max(this.firstBin, range([0, SOUND_LIMITS.maxFeatureHz]).end)
    this.bands = [range(SOUND_LIMITS.lowBand), range(SOUND_LIMITS.midBand), range(SOUND_LIMITS.highBand)]
    this.kickBins = range(SOUND_LIMITS.kickBand)
    this.mag = new Float32Array(this.binCount)
    this.compressed = new Float32Array(this.binCount)
    this.prevCompressed = new Float32Array(this.binCount)
  }

  /**
   * Measures one frame.
   * @param spectrumDb AnalyserNode.getFloatFrequencyData output: fftSize / 2 bins in dBFS (may hold -Infinity)
   * @param samples AnalyserNode.getFloatTimeDomainData output: fftSize samples in -1..1
   * @param time when the frame was taken, in ms (monotonic)
   * @param settings Sensitivity and release
   */
  process(spectrumDb: Float32Array, samples: Float32Array, time: number, settings: FeatureSettings): FeatureFrame {
    const sensitivity = clampFinite(settings.sensitivity, SOUND_LIMITS.minSensitivity, SOUND_LIMITS.maxSensitivity, 0)
    const releaseMs = clampFinite(
      settings.releaseMs,
      SOUND_LIMITS.minReleaseMs,
      SOUND_LIMITS.maxReleaseMs,
      SOUND_LIMITS.defaultReleaseMs,
    )

    let dt = this.prevTime === null ? 0 : time - this.prevTime
    if (this.prevTime !== null && !(dt > 0)) dt = 1
    if (dt > SOUND_LIMITS.maxFrameGapMs) {
      // The tab was hidden (no animation frames): the old spectrum and flux history describe sound
      // from long ago, so onsets start afresh. Smoothing and band memory just see a long step.
      this.beat.clear()
      this.kick.clear()
      this.hasPrev = false
    }
    this.prevTime = time

    // Level: RMS of the samples with their mean (DC offset) removed, then the silence gate.
    const n = samples.length
    let sum = 0
    for (let i = 0; i < n; i++) sum += samples[i]
    const mean = n > 0 ? sum / n : 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const x = samples[i] - mean
      sumSq += x * x
    }
    const rms = n > 0 ? Math.sqrt(sumSq / n) : 0
    const levelDb = rms > 0 && Number.isFinite(rms) ? 20 * Math.log10(rms) : -Infinity
    const gained = levelDb + sensitivity
    const silent = !(gained >= SOUND_LIMITS.silenceDb)
    const t = this.targets
    t[0] = silent ? 0 : clamp01((gained - SOUND_LIMITS.floorDb) / (SOUND_LIMITS.ceilingDb - SOUND_LIMITS.floorDb))

    // One pass over the spectrum: linear and compressed magnitudes, centroid sums, full-band flux.
    const bins = Math.min(this.binCount, spectrumDb.length)
    const mag = this.mag
    const cur = this.compressed
    const prev = this.prevCompressed
    // On a fast display (120 Hz and up) flux is judged about every other frame, against a spectrum about one
    // 60 Hz frame old, so flux and the absolute floors mean the same at any display rate.
    const sinceJudged = time - this.prevFluxTime
    const judge = !this.hasPrev || !(sinceJudged >= 0 && sinceJudged < FLUX_MIN_STEP_MS)
    // Sensitivity is input gain, so it scales the magnitudes the flux compares: ln(1 + fluxCompression × g × m),
    // g = 10^(sensitivity / 20). (The spec's formula leaves it out; without it Sensitivity cannot help quiet onsets.)
    const compression = SOUND_LIMITS.fluxCompression * Math.pow(10, sensitivity / 20)
    let sumM = 0
    let sumFM = 0
    let flux = 0
    for (let k = 0; k < bins; k++) {
      const db = spectrumDb[k]
      // -Infinity (and anything non-finite) is no energy.
      const m = Number.isFinite(db) ? Math.exp(db * DB_TO_LN) : 0
      mag[k] = m
      const c = Math.log1p(compression * m)
      cur[k] = c
      if (k >= this.firstBin) {
        if (k < this.centroidEnd) {
          sumM += m
          sumFM += this.binHz[k] * m
        }
        if (judge && this.hasPrev && c > prev[k]) flux += c - prev[k]
      }
    }
    for (let k = bins; k < this.binCount; k++) mag[k] = cur[k] = 0

    // Bands: energy in dB against each band's running maximum, which decays and never falls below the
    // silence threshold.
    for (let b = 0; b < 3; b++) {
      const { start, end } = this.bands[b]
      let energy = 0
      for (let k = start; k < end; k++) energy += mag[k] * mag[k]
      const bandDb = (energy > 0 ? 10 * Math.log10(energy) : -Infinity) + sensitivity
      const max = Math.max(bandDb, this.bandMax[b] - (dt / 1000) * BAND_DECAY_DB_PER_S, BAND_SILENCE_DB)
      this.bandMax[b] = max
      // 1 at the running maximum; 0 at bandRangeDb below it or at the silence threshold, whichever is higher.
      const lower = Math.max(max - SOUND_LIMITS.bandRangeDb, BAND_SILENCE_DB)
      t[1 + b] = silent || !(max > lower) ? 0 : clamp01((bandDb - lower) / (max - lower))
    }

    // Brightness: spectral centroid of minFeatureHz–maxFeatureHz, log-scaled between brightnessLowHz and brightnessHighHz.
    if (silent || !(sumM > 0)) {
      t[4] = 0
    } else {
      const centroid = sumFM / sumM
      t[4] = clamp01(
        Math.log(centroid / SOUND_LIMITS.brightnessLowHz) /
          Math.log(SOUND_LIMITS.brightnessHighHz / SOUND_LIMITS.brightnessLowHz),
      )
    }

    // Smoothing: one pole, fast attack, release from the settings. The first frame jumps to its target.
    const s = this.smooth
    if (!this.primed) {
      s.set(t)
      this.primed = true
    } else {
      const attack = 1 - Math.exp(-dt / SOUND_LIMITS.attackMs)
      const release = 1 - Math.exp(-dt / releaseMs)
      for (let i = 0; i < 5; i++) s[i] += (t[i] > s[i] ? attack : release) * (t[i] - s[i])
    }

    // Onsets. Without a previous spectrum (first frame, after a gap) there is no flux to judge; between
    // judged frames (fast displays) the previous spectrum is kept, so the next flux spans about 1/60 s.
    let beat = false
    let kick = false
    if (judge && this.hasPrev) {
      let kickFlux = 0
      const { start, end } = this.kickBins
      for (let k = Math.max(start, this.firstBin); k < end; k++) {
        if (cur[k] > prev[k]) kickFlux += cur[k] - prev[k]
      }
      // Kick first: a bass-drum onset is an onset, so it also counts as a Beat. Full-band flux alone can miss
      // it under broadband sound (about 6 bass bins against about 1000 others). Beat's own minimum gap still
      // applies, so one hit never gives two beats.
      kick = this.kick.detect(kickFlux, time, silent)
      beat = this.beat.detect(flux, time, silent, kick)
    }
    if (judge) {
      this.prevCompressed = cur
      this.compressed = prev
      this.prevFluxTime = time
      this.hasPrev = true
    }

    return {
      time,
      levelDb,
      level: s[0],
      low: s[1],
      mid: s[2],
      high: s[3],
      brightness: s[4],
      beat,
      kick,
      silent,
    }
  }

  /** Forgets all history (smoothing, band memory, onset history): call when the source changes. */
  reset(): void {
    this.prevTime = null
    this.primed = false
    this.smooth.fill(0)
    this.bandMax.fill(-Infinity)
    this.hasPrev = false
    this.beat.clear()
    this.kick.clear()
  }
}

/**
 * One onset detector: fires when the flux exceeds both the median flux of the last fluxWindowMs × its factor
 * plus an absolute floor, and onsetHoldRatio × the last onset's flux decaying with onsetHoldMs (the hold, so a
 * hit's own decaying tail does not fire again); at least minBeatGapMs after its last onset, once it has heard
 * onsetWarmupMs.
 */
class OnsetDetector {
  private readonly history = new FluxHistory(SOUND_LIMITS.fluxHistoryCapacity)
  private lastOnset = -Infinity
  /** Largest flux of the last onset (its firing frame and the minBeatGapMs after it) and when it occurred. */
  private peak = 0
  private peakTime = -Infinity

  /**
   * @param factor multiplies the median (Kick needs more than Beat: few bins, jumpier flux)
   * @param floor absolute flux added to the threshold, so steady sound and numeric noise do not fire
   */
  constructor(
    private readonly factor: number,
    private readonly floor: number,
  ) {}

  /**
   * Judges this frame's flux against the past (not including itself), then records it.
   * @param also another detector found an onset in this frame: fire too (still subject to silence, warm-up and the gap)
   */
  detect(flux: number, time: number, silent: boolean, also = false): boolean {
    const history = this.history
    history.prune(time - SOUND_LIMITS.fluxWindowMs)
    // The last onset's flux, decaying: keeps a hit's own decaying tail from counting as new onsets.
    // (Before any onset, peak is 0 and peakTime -Infinity, so this is 0.)
    const held = this.peak * Math.exp(-(time - this.peakTime) / SOUND_LIMITS.onsetHoldMs)
    const fire =
      !silent &&
      history.span(time) >= SOUND_LIMITS.onsetWarmupMs &&
      time - this.lastOnset >= SOUND_LIMITS.minBeatGapMs &&
      (also || flux > Math.max(history.median() * this.factor + this.floor, SOUND_LIMITS.onsetHoldRatio * held))
    history.push(time, flux)
    if (fire) this.lastOnset = time
    // An onset's flux spreads over a few frames; remember its largest.
    if (time - this.lastOnset < SOUND_LIMITS.minBeatGapMs && flux > held) {
      this.peak = flux
      this.peakTime = time
    }
    return fire
  }

  clear(): void {
    this.history.clear()
    this.lastOnset = -Infinity
    this.peak = 0
    this.peakTime = -Infinity
  }
}

/** Recent (time, flux) pairs in a ring buffer, so measuring a frame allocates nothing. */
class FluxHistory {
  private readonly times: Float64Array
  private readonly values: Float64Array
  /** Scratch copy for the median (reordered in place). */
  private readonly scratch: Float64Array
  private head = 0
  private count = 0

  constructor(private readonly capacity: number) {
    this.times = new Float64Array(capacity)
    this.values = new Float64Array(capacity)
    this.scratch = new Float64Array(capacity)
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }

  /** Adds an entry; when full, the oldest is dropped (the window then covers less time). */
  push(time: number, value: number): void {
    const i = (this.head + this.count) % this.capacity
    this.times[i] = time
    this.values[i] = value
    if (this.count < this.capacity) this.count++
    else this.head = (this.head + 1) % this.capacity
  }

  /** Drops entries older than `since`. */
  prune(since: number): void {
    while (this.count > 0 && this.times[this.head] < since) {
      this.head = (this.head + 1) % this.capacity
      this.count--
    }
  }

  /** Time from the oldest entry to `time` (0 when empty). */
  span(time: number): number {
    return this.count > 0 ? time - this.times[this.head] : 0
  }

  /** Median of the stored values (0 when empty). */
  median(): number {
    const n = this.count
    if (n === 0) return 0
    const a = this.scratch
    for (let j = 0; j < n; j++) a[j] = this.values[(this.head + j) % this.capacity]
    const mid = n >> 1
    const upper = select(a, n, mid)
    if (n % 2 === 1) return upper
    // After selection everything left of `mid` is ≤ a[mid]; the lower middle is the largest of those.
    let lower = a[0]
    for (let j = 1; j < mid; j++) if (a[j] > lower) lower = a[j]
    return (lower + upper) / 2
  }
}

/** The k-th smallest of a[0..n) (0-based), by quickselect; reorders a so that a[0..k) ≤ a[k] ≤ a(k..n). */
function select(a: Float64Array, n: number, k: number): number {
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1]
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i] < pivot) i++
      while (a[j] > pivot) j--
      if (i <= j) {
        const swap = a[i]
        a[i] = a[j]
        a[j] = swap
        i++
        j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return a[k]
}

function clamp01(x: number): number {
  return x > 0 ? (x < 1 ? x : 1) : 0
}

/** `x` clamped to [min, max], or `fallback` when it is not a finite number. */
function clampFinite(x: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback
}
