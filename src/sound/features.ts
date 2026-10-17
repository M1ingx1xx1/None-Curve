// Audio features for the Sound tab, measured from one analyser frame at a time. Pure: no DOM, no Web
// Audio; the engine passes in what the AnalyserNodes measured, so this runs in tests on synthetic signals.
//
// Per frame: Level (RMS of the samples, DC offset removed) and Swell (Level, slowly); Low / Mid / High and
// six narrow bands (band energy against each band's own recent loudest value); Brightness (spectral centroid
// of 20 Hz – 20 kHz on a log scale); Noisiness (spectral flatness); Pitch (YIN, holding the last note while
// unvoiced); Change (spectral flux's rise above its recent median, against the largest such rise lately); Pace
// (beats a second); Balance and Width (from the left and right channels), all smoothed, most with a fast attack
// and a slower release. And two onset events, Kick (spectral flux in the bass band only) and Beat (flux over the
// whole spectrum, or any Kick), each with a pulse that jumps to 1 and falls back. Each fires above an adaptive
// threshold: the median of the last second × a factor plus a floor, and at least a fraction of the last onset's
// own flux as it decays, so a hit's noisy tail does not count as new hits. Onsets are judged at most about 60
// times a second, so the thresholds mean the same on any display.

import { type FeatureFrame, type FeatureSettings, type StereoSamples, SOUND_LIMITS } from './types'

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
/** dB → ln of the power: ln 10^(dB / 10). */
const DB_TO_LN_POWER = Math.LN10 / 10
/** Noisiness counts a bin below this (dB), or one without energy, as this: one empty bin cannot pull the geometric mean to 0. */
const FLATNESS_FLOOR_DB = -200
/**
 * Noisiness ends at the highest bin within this many dB of the frame's loudest bin: what lies further down is a
 * lossy encoder's empty top band (its residue sits 70 dB and more below the music) or the window's leakage.
 */
const FLATNESS_RANGE_DB = 60
/** Noisiness never ends below this (Hz), so a lone low tone, with nothing within that range above it, still reads as a tone. */
const FLATNESS_MIN_HZ = 1000
/** Per ms, the ln by which Change's running maximum falls: it halves every bandMemorySeconds, like the bands'. */
const CHANGE_MAX_DECAY_PER_MS = Math.LN2 / (1000 * SOUND_LIMITS.bandMemorySeconds)
/**
 * Change judges the flux's rise above its median against at least this share of the frame's compressed spectrum (the
 * sum of the compressed magnitudes the flux compares; the flux never exceeds it). A steady sound's rises stay a small
 * share of it however long it lasts, so once the running maximum has forgotten the sound's start it reads under about
 * 0.15. Their largest rises as a share, on the emulated analyser: a 110 Hz sawtooth 0.005, white and pink noise
 * 0.03–0.05, a chord of sines 0.06 (its partials' window lobes overlap and beat). An onset after quiet is nearly all
 * of it and reads 1; one over loud noise is a small share (clicks over pink noise as loud: 0.05) and reads about 0.2,
 * the noise about 0.1. A 55 Hz sawtooth's buzz beats against the frame rate (rises up to 0.1): it reads about 0.28.
 */
const CHANGE_MIN_SHARE = 0.25
/** Pace keeps this many onset times: all a paceWindowMs can hold, minBeatGapMs apart. */
const PACE_CAPACITY = Math.ceil(SOUND_LIMITS.paceWindowMs / SOUND_LIMITS.minBeatGapMs) + 1
/** Pitch: log2 of pitchHighHz / pitchLowHz, the octaves from 0 to 1. */
const PITCH_OCTAVES = Math.log2(SOUND_LIMITS.pitchHighHz / SOUND_LIMITS.pitchLowHz)
/**
 * A YIN difference below this fraction of the window's energy is the FFT's rounding (about 1e-15 of it) and counts as 0.
 * Without it, a window that starts in digital silence gives ratios of rounding noise, which can read as a note.
 */
const YIN_ROUNDING = 1e-10

/** The nine bands, Low, Mid, High and then the narrow ones, in the order of their smoothing slots. */
const BANDS = [
  SOUND_LIMITS.lowBand,
  SOUND_LIMITS.midBand,
  SOUND_LIMITS.highBand,
  SOUND_LIMITS.subBand,
  SOUND_LIMITS.bassBand,
  SOUND_LIMITS.lowMidBand,
  SOUND_LIMITS.highMidBand,
  SOUND_LIMITS.presenceBand,
  SOUND_LIMITS.airBand,
] as const

// Slots of the values smoothed with attackMs and the release time (`smooth` and `targets`); band b is FIRST_BAND + b.
const LEVEL = 0
const FIRST_BAND = 1
const BRIGHTNESS = FIRST_BAND + BANDS.length
const NOISINESS = BRIGHTNESS + 1
const CHANGE = NOISINESS + 1
const PACE = CHANGE + 1
const WIDTH = PACE + 1
const SLOTS = WIDTH + 1

/** Bins [start, end) whose centre frequency lies in [lo, hi). */
interface BinRange {
  start: number
  end: number
}

/**
 * Turns analyser frames into FeatureFrames, keeping the history that smoothing, band memory, onsets and
 * pitch need. One per audio graph; reset() it whenever the source changes.
 */
export class FeatureExtractor {
  private readonly binCount: number
  /** Centre frequency of each bin (Hz). */
  private readonly binHz: Float32Array
  /**
   * First bin at or above SOUND_LIMITS.minFeatureHz (bin 0, DC, is skipped in Brightness, Noisiness and flux). The
   * window still leaks a DC offset into bins 1–2, so the engine high-passes the analyser input at minFeatureHz.
   */
  private readonly firstBin: number
  /** First bin at or above SOUND_LIMITS.maxFeatureHz: Brightness and Noisiness use bins [firstBin, centroidEnd). */
  private readonly centroidEnd: number
  /** Noisiness's bins end at the frame's real bandwidth, but not before this bin (FLATNESS_MIN_HZ). */
  private readonly flatMinEnd: number
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
  /** Smoothed values by slot (LEVEL … WIDTH), and their targets in this frame. Valid once `primed`. */
  private readonly smooth = new Float64Array(SLOTS)
  private readonly targets = new Float64Array(SLOTS)
  private primed = false
  /** Running maximum of each band, in dB (after Sensitivity). */
  private readonly bandMax = new Float64Array(BANDS.length).fill(-Infinity)
  /** Smoothed with their own time constants: Swell, Pitch, Balance. */
  private swell = 0
  private pitch = 0
  private balance = 0
  /** Pitch the smoothing heads for: the last voiced note's, or 0 after silence. */
  private pitchTarget = 0
  private beatPulse = 0
  private kickPulse = 0
  /**
   * Change: the last judged frame's full-band flux minus the Beat detector's median (negative below it), the sum
   * of that frame's compressed magnitudes, and the running maximum of the excess.
   */
  private lastExcess = 0
  private lastSpectrum = 0
  private excessMax = 0
  /** Pace: times of the Beat onsets in the last paceWindowMs, oldest first (a ring buffer). */
  private readonly beatTimes = new Float64Array(PACE_CAPACITY)
  private beatHead = 0
  private beatCount = 0

  // Pitch (YIN). The samples are decimated by `decimation` (the mean of each run), to pitchRate of at most
  // pitchMaxRate; lags from minLag to maxLag decimated samples cover pitchHighHz down to pitchLowHz.
  private readonly decimation: number
  private readonly pitchRate: number
  private readonly decimated: Float64Array
  /** Running sum of the squared decimated samples: prefix[i] = x[0]² + … + x[i - 1]². */
  private readonly prefix: Float64Array
  /** Cumulative-mean-normalised difference by lag. */
  private readonly yin: Float64Array
  private readonly minLag: number
  private readonly maxLag: number
  /** The correlation of every lag at once, by FFT (a size at least the decimated length, so no lag wraps round). */
  private readonly fft: Fft
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly spectrumRe: Float64Array
  private readonly spectrumIm: Float64Array

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
    this.flatMinEnd = Math.min(this.centroidEnd, Math.max(this.firstBin + 1, range([0, FLATNESS_MIN_HZ]).end))
    this.bands = BANDS.map(range)
    this.kickBins = range(SOUND_LIMITS.kickBand)
    this.mag = new Float32Array(this.binCount)
    this.compressed = new Float32Array(this.binCount)
    this.prevCompressed = new Float32Array(this.binCount)

    this.decimation = Math.max(1, Math.ceil(sampleRate / SOUND_LIMITS.pitchMaxRate))
    this.pitchRate = sampleRate / this.decimation
    const decimatedLength = Math.max(0, Math.floor(fftSize / this.decimation))
    this.decimated = new Float64Array(decimatedLength)
    this.prefix = new Float64Array(decimatedLength + 1)
    this.minLag = Math.max(2, Math.floor(this.pitchRate / SOUND_LIMITS.pitchHighHz))
    this.maxLag = Math.ceil(this.pitchRate / SOUND_LIMITS.pitchLowHz)
    this.yin = new Float64Array(this.maxLag + 2)
    this.fft = new Fft(2 ** Math.ceil(Math.log2(Math.max(2, decimatedLength))))
    this.re = new Float64Array(this.fft.size)
    this.im = new Float64Array(this.fft.size)
    this.spectrumRe = new Float64Array(this.fft.size)
    this.spectrumIm = new Float64Array(this.fft.size)
  }

  /**
   * Measures one frame. Allocates nothing but the returned frame.
   * @param spectrumDb AnalyserNode.getFloatFrequencyData output: fftSize / 2 bins in dBFS (may hold -Infinity)
   * @param samples AnalyserNode.getFloatTimeDomainData output: fftSize samples in -1..1, the channels mixed down
   * @param time when the frame was taken, in ms (monotonic)
   * @param settings Sensitivity and release
   * @param stereo the left and right channels' samples, for Balance and Width (both read 0 without them)
   */
  process(
    spectrumDb: Float32Array,
    samples: Float32Array,
    time: number,
    settings: FeatureSettings,
    stereo?: StereoSamples | null,
  ): FeatureFrame {
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
    t[LEVEL] = silent ? 0 : clamp01((gained - SOUND_LIMITS.floorDb) / (SOUND_LIMITS.ceilingDb - SOUND_LIMITS.floorDb))

    // One pass over the spectrum: linear and compressed magnitudes, centroid and flatness sums, full-band flux and
    // the compressed magnitudes' sum over the same bins.
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
    const flatEnd = Math.min(bins, this.centroidEnd)
    let sumM = 0
    let sumFM = 0
    let peakDb = -Infinity
    let flux = 0
    let compressedSum = 0
    for (let k = 0; k < bins; k++) {
      const db = spectrumDb[k]
      // -Infinity (and anything non-finite) is no energy.
      const finite = Number.isFinite(db)
      const m = finite ? Math.exp(db * DB_TO_LN) : 0
      mag[k] = m
      const c = Math.log1p(compression * m)
      cur[k] = c
      if (k >= this.firstBin) {
        if (k < flatEnd) {
          sumM += m
          sumFM += this.binHz[k] * m
          if (db > peakDb) peakDb = db
        }
        compressedSum += c
        if (judge && this.hasPrev && c > prev[k]) flux += c - prev[k]
      }
    }
    for (let k = bins; k < this.binCount; k++) mag[k] = cur[k] = 0

    // Bands: energy in dB against each band's running maximum, which decays and never falls below the
    // silence threshold.
    for (let b = 0; b < BANDS.length; b++) {
      const { start, end } = this.bands[b]
      let energy = 0
      for (let k = start; k < end; k++) energy += mag[k] * mag[k]
      const bandDb = (energy > 0 ? 10 * Math.log10(energy) : -Infinity) + sensitivity
      const max = Math.max(bandDb, this.bandMax[b] - (dt / 1000) * BAND_DECAY_DB_PER_S, BAND_SILENCE_DB)
      this.bandMax[b] = max
      // 1 at the running maximum; 0 at bandRangeDb below it or at the silence threshold, whichever is higher.
      const lower = Math.max(max - SOUND_LIMITS.bandRangeDb, BAND_SILENCE_DB)
      t[FIRST_BAND + b] = silent || !(max > lower) ? 0 : clamp01((bandDb - lower) / (max - lower))
    }

    // Brightness: spectral centroid of minFeatureHz–maxFeatureHz, log-scaled between brightnessLowHz and brightnessHighHz.
    if (silent || !(sumM > 0)) {
      t[BRIGHTNESS] = 0
    } else {
      const centroid = sumFM / sumM
      t[BRIGHTNESS] = clamp01(
        Math.log(centroid / SOUND_LIMITS.brightnessLowHz) /
          Math.log(SOUND_LIMITS.brightnessHighHz / SOUND_LIMITS.brightnessLowHz),
      )
    }

    // Noisiness: spectral flatness of the same bins up to the frame's real bandwidth (the last bin within
    // FLATNESS_RANGE_DB of the loudest, but not below flatMinEnd), the geometric over the arithmetic mean of the
    // power, in dB. Lossy files are low-passed by their encoders (often at 16 kHz), and the empty top would
    // otherwise pull the geometric mean down: white noise read 0.02 instead of 1.
    let end = flatEnd
    const lowest = peakDb - FLATNESS_RANGE_DB
    while (end > this.flatMinEnd && !(spectrumDb[end - 1] > lowest)) end--
    let sumP = 0
    let sumLnP = 0
    for (let k = this.firstBin; k < end; k++) {
      const db = spectrumDb[k]
      sumP += mag[k] * mag[k]
      // ln P is dB × ln 10 / 10: no logarithm per bin.
      sumLnP += (Number.isFinite(db) && db > FLATNESS_FLOOR_DB ? db : FLATNESS_FLOOR_DB) * DB_TO_LN_POWER
    }
    const flatBins = end - this.firstBin
    if (silent || !(sumP > 0) || flatBins <= 0) {
      t[NOISINESS] = 0
    } else {
      const flatnessDb = (10 / Math.LN10) * (sumLnP / flatBins - Math.log(sumP / flatBins))
      t[NOISINESS] = clamp01(
        (flatnessDb - SOUND_LIMITS.noisinessLowDb) / (SOUND_LIMITS.noisinessHighDb - SOUND_LIMITS.noisinessLowDb),
      )
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
      // Change's inputs: 0 without a previous spectrum; frames between judged ones keep the last judged ones.
      // The median is of the fluxWindowMs before this frame, as Beat judged it.
      this.lastExcess = this.hasPrev ? flux - this.beat.median : 0
      this.lastSpectrum = compressedSum
      this.prevCompressed = cur
      this.compressed = prev
      this.prevFluxTime = time
      this.hasPrev = true
    }

    // Change: how far the flux rises above its median of the last fluxWindowMs, against the largest such rise
    // lately (a running maximum that decays like the bands'), but never against less than fluxFloor or
    // CHANGE_MIN_SHARE of the compressed spectrum. The median takes out the flux a steady sound always has (noise
    // changes every bin in every frame); the share keeps a steady sound's own frame-to-frame jitter low once the
    // maximum has decayed to it (against the maximum alone, a steady sawtooth, chord or noise crept up to 0.6–1).
    this.excessMax = Math.max(this.lastExcess, this.excessMax * Math.exp(-dt * CHANGE_MAX_DECAY_PER_MS))
    const changeScale = Math.max(this.excessMax, SOUND_LIMITS.fluxFloor, CHANGE_MIN_SHARE * this.lastSpectrum)
    t[CHANGE] = silent ? 0 : clamp01(this.lastExcess / changeScale)

    // Pace: Beat onsets in the last paceWindowMs, as onsets a second, against paceMaxPerSecond. No beats fire in
    // silence, so it falls to 0 as they leave the window; gating it frame by frame would drop it between sparse hits.
    const times = this.beatTimes
    while (this.beatCount > 0 && !(times[this.beatHead] > time - SOUND_LIMITS.paceWindowMs)) {
      this.beatHead = (this.beatHead + 1) % PACE_CAPACITY
      this.beatCount--
    }
    if (beat) {
      times[(this.beatHead + this.beatCount) % PACE_CAPACITY] = time
      if (this.beatCount < PACE_CAPACITY) this.beatCount++
      else this.beatHead = (this.beatHead + 1) % PACE_CAPACITY
    }
    t[PACE] = clamp01(this.beatCount / (SOUND_LIMITS.paceWindowMs / 1000) / SOUND_LIMITS.paceMaxPerSecond)

    // Balance and Width, from the left and right channels with their DC offsets removed.
    let balanceTarget = 0
    t[WIDTH] = 0
    const stereoLength = stereo ? Math.min(stereo.left.length, stereo.right.length) : 0
    if (!silent && stereo && stereoLength > 0) {
      const { left, right } = stereo
      let sumL = 0
      let sumR = 0
      for (let i = 0; i < stereoLength; i++) {
        sumL += left[i]
        sumR += right[i]
      }
      const meanL = sumL / stereoLength
      const meanR = sumR / stereoLength
      let ll = 0
      let rr = 0
      let lr = 0
      for (let i = 0; i < stereoLength; i++) {
        const l = left[i] - meanL
        const r = right[i] - meanR
        ll += l * l
        rr += r * r
        lr += l * r
      }
      const rmsL = Math.sqrt(ll / stereoLength)
      const rmsR = Math.sqrt(rr / stereoLength)
      if (rmsL + rmsR > 0) balanceTarget = (rmsR - rmsL) / (rmsR + rmsL)
      // Mid (L + R) / 2 and side (L - R) / 2, as 4 × length × their mean squares.
      const mid = ll + rr + 2 * lr
      const side = Math.max(0, ll + rr - 2 * lr)
      t[WIDTH] = mid > 0 ? clamp01(Math.sqrt(side / mid)) : side > 0 ? 1 : 0
    }

    // Pitch: a voiced frame sets the target; an unvoiced one holds it; silence sends it to 0.
    if (silent) {
      this.pitchTarget = 0
    } else {
      const hz = this.detectPitch(samples)
      if (hz > 0) this.pitchTarget = clamp01(Math.log2(hz / SOUND_LIMITS.pitchLowHz) / PITCH_OCTAVES)
    }

    // Smoothing: one pole, fast attack, release from the settings (Swell, Pitch and Balance have their own).
    // The first frame jumps to its targets.
    const s = this.smooth
    if (!this.primed) {
      s.set(t)
      this.swell = t[LEVEL]
      this.pitch = this.pitchTarget
      this.balance = balanceTarget
      this.primed = true
    } else {
      const attack = 1 - Math.exp(-dt / SOUND_LIMITS.attackMs)
      const release = 1 - Math.exp(-dt / releaseMs)
      for (let i = 0; i < SLOTS; i++) s[i] += (t[i] > s[i] ? attack : release) * (t[i] - s[i])
      const swellMs = t[LEVEL] > this.swell ? SOUND_LIMITS.swellAttackMs : SOUND_LIMITS.swellReleaseMs
      this.swell += (1 - Math.exp(-dt / swellMs)) * (t[LEVEL] - this.swell)
      // Pitch moves both ways with pitchSmoothingMs, and falls to 0 on silence with the release time.
      const pitchMs = silent ? releaseMs : SOUND_LIMITS.pitchSmoothingMs
      this.pitch += (1 - Math.exp(-dt / pitchMs)) * (this.pitchTarget - this.pitch)
      this.balance += release * (balanceTarget - this.balance)
    }

    // Pulses: 1 on an onset, then falling with the release time.
    const fall = Math.exp(-dt / releaseMs)
    this.beatPulse = beat ? 1 : this.beatPulse * fall
    this.kickPulse = kick ? 1 : this.kickPulse * fall

    return {
      time,
      levelDb,
      level: s[LEVEL],
      swell: this.swell,
      low: s[FIRST_BAND],
      mid: s[FIRST_BAND + 1],
      high: s[FIRST_BAND + 2],
      sub: s[FIRST_BAND + 3],
      bass: s[FIRST_BAND + 4],
      lowMid: s[FIRST_BAND + 5],
      highMid: s[FIRST_BAND + 6],
      presence: s[FIRST_BAND + 7],
      air: s[FIRST_BAND + 8],
      brightness: s[BRIGHTNESS],
      noisiness: s[NOISINESS],
      pitch: this.pitch,
      beatPulse: this.beatPulse,
      kickPulse: this.kickPulse,
      change: s[CHANGE],
      pace: s[PACE],
      balance: this.balance,
      width: s[WIDTH],
      beat,
      kick,
      silent,
    }
  }

  /** Forgets all history (smoothing, band memory, onset and pitch history): call when the source changes. */
  reset(): void {
    this.prevTime = null
    this.primed = false
    this.smooth.fill(0)
    this.bandMax.fill(-Infinity)
    this.swell = 0
    this.pitch = 0
    this.balance = 0
    this.pitchTarget = 0
    this.beatPulse = 0
    this.kickPulse = 0
    this.lastExcess = 0
    this.lastSpectrum = 0
    this.excessMax = 0
    this.beatHead = 0
    this.beatCount = 0
    this.hasPrev = false
    this.beat.clear()
    this.kick.clear()
  }

  /**
   * The fundamental (Hz) of the samples by YIN, or 0 when no lag is periodic enough (unvoiced): the first lag
   * from minLag to maxLag whose cumulative-mean-normalised difference falls below pitchThreshold, walked on to
   * its local minimum and refined by a parabola through its neighbours.
   */
  private detectPitch(samples: Float32Array): number {
    const d = this.decimation
    const x = this.decimated
    const length = Math.min(x.length, Math.floor(samples.length / d))
    // The lags reach limit (maxLag, and one more for the parabola); every difference sums `w` products, at least 40%
    // of the block. At 16 and 32 kHz the block holds only 512 decimated samples, so w (220) is shorter than maxLag
    // (291) there; capping the lags at half the block instead cut Pitch off at 62.5 Hz.
    const limit = Math.min(this.maxLag + 1, Math.floor(length * 0.6))
    if (limit <= this.minLag + 1) return 0
    const prefix = this.prefix
    for (let i = 0, j = 0; i < length; i++) {
      let sum = 0
      for (let k = 0; k < d; k++) sum += samples[j++]
      const v = sum / d
      x[i] = v
      prefix[i + 1] = prefix[i] + v * v
    }
    const w = length - limit
    const correlation = this.correlate(length, w)
    const head = prefix[w]
    const rounding = prefix[length] * YIN_ROUNDING
    const yin = this.yin
    let cumulative = 0
    let best = -1
    for (let lag = 1; lag <= limit; lag++) {
      // The difference function, Σ (x[j] - x[j + lag])² over j < w, as the two energies minus twice the correlation.
      const energy = head + prefix[w + lag] - prefix[lag]
      let diff = energy - 2 * correlation[lag]
      if (!(diff > rounding)) diff = 0
      cumulative += diff
      const value = cumulative > 0 ? (diff * lag) / cumulative : 1
      yin[lag] = value
      if (best < 0) {
        if (lag >= this.minLag && lag <= this.maxLag && value < SOUND_LIMITS.pitchThreshold) best = lag
      } else if (value < yin[best]) {
        best = lag
      } else {
        break
      }
    }
    if (best < 0) return 0
    let period = best
    // yin[best + 1] is known unless the walk ran into the last lag.
    if (best < limit) {
      const a = yin[best - 1]
      const b = yin[best]
      const c = yin[best + 1]
      const curve = a - 2 * b + c
      if (curve > 0) period += Math.max(-0.5, Math.min(0.5, (a - c) / (2 * curve)))
    }
    return this.pitchRate / period
  }

  /**
   * Σ x[j] x[j + lag] over j < w for every lag up to length - w, of the decimated samples x[0..length), indexed by
   * lag (a reused array).
   */
  private correlate(length: number, w: number): Float64Array {
    const { fft, re, im, spectrumRe: cr, spectrumIm: ci } = this
    const x = this.decimated
    const size = fft.size
    // Both real signals in one complex transform: the first w samples as the real part, all of them as the imaginary.
    for (let j = 0; j < size; j++) {
      re[j] = j < w ? x[j] : 0
      im[j] = j < length ? x[j] : 0
    }
    fft.transform(re, im)
    // Separate them (A from the real part, X from the imaginary) and take conj(A) × X, the correlation's spectrum;
    // conjugated, ready for the inverse transform.
    for (let k = 0; k < size; k++) {
      const m = (size - k) & (size - 1)
      const ar = (re[k] + re[m]) / 2
      const ai = (im[k] - im[m]) / 2
      const xr = (im[k] + im[m]) / 2
      const xi = (re[m] - re[k]) / 2
      cr[k] = ar * xr + ai * xi
      ci[k] = -(ar * xi - ai * xr)
    }
    // The inverse transform as the forward one of the conjugate; the correlation is real, so only its real part is kept.
    fft.transform(cr, ci)
    for (let k = 0; k < size; k++) cr[k] /= size
    return cr
  }
}

/** An in-place radix-2 complex FFT of one power-of-two size, with its tables made once. */
class Fft {
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly reversed: Uint32Array

  constructor(readonly size: number) {
    const half = size >> 1
    this.cos = new Float64Array(half)
    this.sin = new Float64Array(half)
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size)
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size)
    }
    this.reversed = new Uint32Array(size)
    const bits = Math.round(Math.log2(size))
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.reversed[i] = r
    }
  }

  /** X[k] = Σ x[j] e^(-2πi jk / size), in place. */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size
    const reversed = this.reversed
    for (let i = 0; i < n; i++) {
      const j = reversed[i]
      if (j > i) {
        const r = re[i]
        re[i] = re[j]
        re[j] = r
        const m = im[i]
        im[i] = im[j]
        im[j] = m
      }
    }
    const cos = this.cos
    const sin = this.sin
    for (let span = 1; span < n; span <<= 1) {
      const step = n / (2 * span)
      for (let start = 0; start < n; start += 2 * span) {
        for (let k = 0; k < span; k++) {
          const wr = cos[k * step]
          const wi = sin[k * step]
          const a = start + k
          const b = a + span
          const br = re[b] * wr - im[b] * wi
          const bi = re[b] * wi + im[b] * wr
          re[b] = re[a] - br
          im[b] = im[a] - bi
          re[a] += br
          im[a] += bi
        }
      }
    }
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
  /** Median flux of the fluxWindowMs before the frame last judged (0 with no history): Change uses Beat's. */
  median = 0
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
    this.median = history.median()
    // The last onset's flux, decaying: keeps a hit's own decaying tail from counting as new onsets.
    // (Before any onset, peak is 0 and peakTime -Infinity, so this is 0.)
    const held = this.peak * Math.exp(-(time - this.peakTime) / SOUND_LIMITS.onsetHoldMs)
    const fire =
      !silent &&
      history.span(time) >= SOUND_LIMITS.onsetWarmupMs &&
      time - this.lastOnset >= SOUND_LIMITS.minBeatGapMs &&
      (also || flux > Math.max(this.median * this.factor + this.floor, SOUND_LIMITS.onsetHoldRatio * held))
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
    this.median = 0
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
