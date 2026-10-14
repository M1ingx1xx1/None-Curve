// Shared types and limits for the Sound tab (see docs/SOUND_PLAN.md). Pure data: no DOM, no Web Audio.

export const SOUND_LIMITS = {
  /**
   * Analyser FFT size at 44.1 and 48 kHz: 2048 samples (about 43 ms, bins about 23 Hz wide). The engine
   * doubles it at 88.2 and 96 kHz (and so on), so the window and the bins stay the same at any sample rate.
   */
  fftSize: 2048,
  /** Level: dBFS that reads as 0 and as 1 (before Sensitivity). */
  floorDb: -60,
  ceilingDb: 0,
  /** Below this level (dBFS, after Sensitivity) the sound counts as silence: continuous features read 0, no beats fire. */
  silenceDb: -60,
  /** Sensitivity: dB added to the input before measuring. */
  minSensitivity: -24,
  maxSensitivity: 24,
  /** Band edges in Hz of Bass, Mids and Treble; Treble runs to Nyquist. */
  bassBand: [20, 250],
  midsBand: [250, 2000],
  trebleBand: [2000, Infinity],
  /** The kick detector, half of Beat, listens to this band only (bass drum, and sudden low bass notes). */
  kickBand: [20, 150],
  /** Band readings are relative to each band's recent loudest value, over this many dB. */
  bandRangeDb: 40,
  /** How fast that recent loudest value forgets: it halves every this many seconds. */
  bandMemorySeconds: 3,
  /** Brightness: spectral centroid (Hz) that reads as 0 and as 1, on a log scale. */
  brightnessLowHz: 100,
  brightnessHighHz: 8000,
  /**
   * Pitch: fundamental (Hz) that reads as 0 and as 1, on a log scale (A1 to A6, 5 octaves). YIN runs on the
   * samples decimated to at most pitchMaxRate (Hz); a lag counts as periodic below pitchThreshold (its
   * cumulative-mean-normalised difference). Pitch follows with pitchSmoothingMs both ways (ms).
   */
  pitchLowHz: 55,
  pitchHighHz: 1760,
  pitchMaxRate: 24000,
  pitchThreshold: 0.15,
  pitchSmoothingMs: 30,
  /** Smoothing: rise time constant, and the default and range of the fall (release) time constant, in ms. */
  attackMs: 10,
  defaultReleaseMs: 150,
  minReleaseMs: 20,
  maxReleaseMs: 1000,
  /** Swell: Level with these fixed rise and fall time constants (ms), whatever Smoothing says. */
  swellAttackMs: 300,
  swellReleaseMs: 2000,
  /** Activity's pace: Beat onsets counted over the last paceWindowMs, as onsets a second; paceMaxPerSecond reads as 1. */
  paceWindowMs: 2000,
  paceMaxPerSecond: 8,
  /**
   * Beats: flux must exceed the median of the last `fluxWindowMs` × `fluxFactor` (the kick detector: × `kickFluxFactor`)
   * plus a floor, at least `minBeatGapMs` apart.
   */
  fluxWindowMs: 1000,
  fluxFactor: 1.5,
  minBeatGapMs: 100,
  /** A file this large is not opened (bytes). */
  maxFileBytes: 512 * 1024 * 1024,
  /** "No sound detected" shows after this long without sound while playing or listening (ms). */
  silentNoticeMs: 3000,
  /**
   * Brightness and spectral flux ignore bins below this (Hz), and the engine high-passes the analyser input here,
   * which removes DC offset and rumble.
   */
  minFeatureHz: 20,
  /** Brightness ignores bins above this (Hz): at 88.2 kHz and higher sample rates, ultrasonic hiss would otherwise read as brightness. */
  maxFeatureHz: 20000,
  /**
   * Flux compares ln(1 + fluxCompression × g × magnitude), so quiet and loud onsets count more evenly; g is the
   * Sensitivity gain, 10^(Sensitivity / 20), so Sensitivity reaches Beat (both detectors) too.
   */
  fluxCompression: 1000,
  /**
   * Absolute flux added to the full-band Beat threshold (flux is summed over every bin above minFeatureHz). At
   * Sensitivity 0, steady pure tones give under 0.06 and a -40 dBFS bass-drum hit about 2.3, so 1 ignores numeric noise
   * and keeps quiet hits. Known limit: a steady low buzzy note (a sawtooth at 55–110 Hz) beats against the frame rate
   * and can fire Beat several times a second.
   * Activity's change never judges the flux's rise above its median against less than this either.
   */
  fluxFloor: 1,
  /**
   * The same floor for the kick detector: at Sensitivity 0, a -30 dBFS bass drum in a quiet background gives a kick
   * flux of about 4.3 (-6 dBFS about 17), so 3 still catches it.
   */
  kickFluxFloor: 3,
  /**
   * The kick detector's median factor (full-band flux uses fluxFactor). The kick band (20–150 Hz) holds only about 6 bins, so steady
   * broadband noise gives a jumpy flux whose size no longer depends on level once loud: median about 1.5,
   * 1% of frames above 6, peaks about 9. With fluxFactor (1.5) that fired 1–1.8 times a second on steady pink
   * noise from -20 to -6 dBFS. 3 brings that under 0.2/s and keeps quiet kicks, where the median is about 0.
   * A kick under loud broadband noise (in-band noise within about 10 dB of the drum) is mostly missed.
   * The floors and factors were tuned on synthetic signals at 48 kHz, fftSize 2048 and 60 frames a second; the
   * engine's FFT size scaling and judging onsets at most about 60 times a second (features.ts) keep them valid
   * at other sample rates and display rates.
   */
  kickFluxFactor: 3,
  /**
   * After an onset, the threshold is at least this fraction of that onset's flux, decaying with time
   * constant onsetHoldMs. Without it, the noisy tail of a snare, clap or reverb keeps fluctuating far
   * above the median-based threshold of sparse material, and Beat fires again every minBeatGapMs.
   */
  onsetHoldRatio: 0.5,
  onsetHoldMs: 120,
  /** No onsets until the flux history spans this long (ms): right after a start there is nothing to compare with. */
  onsetWarmupMs: 250,
  /** Most flux entries kept per detector (enough for fluxWindowMs at 500 frames per second). */
  fluxHistoryCapacity: 512,
  /** A gap between frames longer than this (ms; the tab was hidden) restarts onset detection. */
  maxFrameGapMs: 500,
} as const

/**
 * What the analyser measured in one frame. Continuous values are smoothed and run 0–1 (Pan -1–1); each is a
 * feature a mapping can follow, under the same name (mapping.ts).
 */
export interface FeatureFrame {
  /** When the frame was measured (ms, performance.now()). */
  time: number
  /** Unsmoothed short-time RMS level in dBFS (-Infinity for digital silence), before Sensitivity. */
  levelDb: number
  level: number
  /** Level with slow smoothing (SOUND_LIMITS.swellAttackMs, swellReleaseMs). */
  swell: number
  /** Energy in each band (SOUND_LIMITS.bassBand, midsBand, trebleBand) against the band's own recent loudest value. */
  bass: number
  mids: number
  treble: number
  /** Spectral centroid, brightnessLowHz → 0 to brightnessHighHz → 1 on a log scale. */
  brightness: number
  /** The fundamental by YIN, 55 Hz → 0 to 1760 Hz → 1 on a log scale; holds the last note while unvoiced. */
  pitch: number
  /**
   * A pulse: 1 on a frame where either detector finds an onset (full-band flux or the kick band), then falling with
   * the release time. The larger of the two detectors' pulses.
   */
  beat: number
  /**
   * How busy the sound is: the larger of two readings, smoothed together. Change: the full-band spectral flux's rise
   * above its median of the last SOUND_LIMITS.fluxWindowMs, against the largest such rise lately (at least a quarter
   * of the frame's spectrum); high on attacks, low on steady sound (noise included) however long it lasts. Pace: the
   * onsets a second over the last paceWindowMs, against paceMaxPerSecond. So a hit reads high at once, and quick
   * beats keep it up between hits.
   */
  activity: number
  /** Left -1 to right 1: the left and right RMS compared; 0 for mono, or without the channels. */
  pan: number
  /**
   * An onset in this frame, from either detector: full-band flux above its threshold, or flux in the kick band
   * (20–150 Hz: a bass drum, or a sudden low bass note). Two closer than minBeatGapMs count as one.
   */
  onset: boolean
  /** Below the silence threshold. */
  silent: boolean
}

/** A frame of nothing: used while nothing plays or listens. */
export const SILENT_FRAME: FeatureFrame = {
  time: 0,
  levelDb: -Infinity,
  level: 0,
  swell: 0,
  bass: 0,
  mids: 0,
  treble: 0,
  brightness: 0,
  pitch: 0,
  beat: 0,
  activity: 0,
  pan: 0,
  onset: false,
  silent: true,
}

/** The left and right channels' time-domain samples (the same length; -1..1), for Pan. */
export interface StereoSamples {
  left: Float32Array
  right: Float32Array
}

export interface FeatureSettings {
  /** dB added to the input before measuring (SOUND_LIMITS.minSensitivity–maxSensitivity). */
  sensitivity: number
  /** Fall time constant of the smoothing, in ms (SOUND_LIMITS.minReleaseMs–maxReleaseMs). */
  releaseMs: number
}

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = { sensitivity: 0, releaseMs: SOUND_LIMITS.defaultReleaseMs }

/** Where the sound comes from. Stopping is Pause (file) or Stop listening (microphone); there is no "off" source. */
export type SoundSource = 'file' | 'microphone'

/** Why a source could not be used; each has its own message in the Sound tab. */
export type SoundErrorKind =
  /** Web Audio (or getUserMedia, for the microphone) is not available in this browser or context. */
  | 'unsupported'
  /** The file is not audio the browser can decode. */
  | 'decode'
  /** The file is empty (0 bytes) or reports zero duration. */
  | 'empty'
  /** The file is larger than SOUND_LIMITS.maxFileBytes. */
  | 'too-large'
  /** The microphone permission was refused. */
  | 'permission'
  /** No microphone is connected. */
  | 'no-device'
  /** The microphone exists but could not be opened (in use by another app, hardware error). */
  | 'device-busy'
  /** Microphone access needs a secure context (https or localhost). */
  | 'insecure'

export interface SoundError {
  kind: SoundErrorKind
  /** Technical detail from the browser, for the tooltip; may be empty. */
  detail: string
}

/** Everything the Sound tab shows about the engine, apart from the per-frame features. */
export interface SoundState {
  source: SoundSource
  /** File: the chosen file's name (null before one is chosen). */
  fileName: string | null
  /** File: length in seconds (0 before metadata is known). */
  duration: number
  /** File: playback position in seconds. */
  position: number
  playing: boolean
  loop: boolean
  /** Microphone: listening now. */
  listening: boolean
  /** Opening a file or the microphone is in progress. */
  busy: boolean
  /** No sound above the silence threshold for SOUND_LIMITS.silentNoticeMs while playing or listening. */
  noSound: boolean
  error: SoundError | null
  settings: FeatureSettings
}

export const INITIAL_SOUND_STATE: SoundState = {
  source: 'file',
  fileName: null,
  duration: 0,
  position: 0,
  playing: false,
  loop: true,
  listening: false,
  busy: false,
  noSound: false,
  error: null,
  settings: DEFAULT_FEATURE_SETTINGS,
}
