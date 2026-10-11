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
  /** Band edges in Hz; the high band runs to Nyquist. */
  lowBand: [20, 250],
  midBand: [250, 2000],
  highBand: [2000, Infinity],
  /** The kick detector listens to this band only (bass drum, and sudden low bass notes). */
  kickBand: [20, 150],
  /** Band readings are relative to each band's recent loudest value, over this many dB. */
  bandRangeDb: 40,
  /** How fast that recent loudest value forgets: it halves every this many seconds. */
  bandMemorySeconds: 3,
  /** Brightness: spectral centroid (Hz) that reads as 0 and as 1, on a log scale. */
  brightnessLowHz: 100,
  brightnessHighHz: 8000,
  /** Smoothing: rise time constant, and the default and range of the fall (release) time constant, in ms. */
  attackMs: 10,
  defaultReleaseMs: 150,
  minReleaseMs: 20,
  maxReleaseMs: 1000,
  /**
   * Beats: flux must exceed the median of the last `fluxWindowMs` × `fluxFactor` (Kick: × `kickFluxFactor`) plus a
   * floor, at least `minBeatGapMs` apart.
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
   * Sensitivity gain, 10^(Sensitivity / 20), so Sensitivity reaches Beat and Kick too.
   */
  fluxCompression: 1000,
  /**
   * Absolute flux added to the Beat threshold (flux is summed over every bin above minFeatureHz). At Sensitivity 0,
   * steady tones give under 0.1 and a -40 dBFS bass-drum hit about 2.3, so 1 ignores numeric noise and keeps quiet hits.
   */
  fluxFloor: 1,
  /**
   * The same floor for Kick: at Sensitivity 0, a -30 dBFS bass drum in a quiet background gives a kick flux of
   * about 4.3 (-6 dBFS about 17), so 3 still catches it.
   */
  kickFluxFloor: 3,
  /**
   * Kick's median factor (Beat uses fluxFactor). The kick band (20–150 Hz) holds only about 6 bins, so steady
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

/** What the analyser measured in one frame. Continuous values are smoothed and run 0–1. */
export interface FeatureFrame {
  /** When the frame was measured (ms, performance.now()). */
  time: number
  /** Unsmoothed short-time RMS level in dBFS (-Infinity for digital silence), before Sensitivity. */
  levelDb: number
  level: number
  low: number
  mid: number
  high: number
  brightness: number
  /** An onset in this frame: full-band flux above its threshold, or a Kick; at most one per minBeatGapMs. */
  beat: boolean
  /** An onset in the kick band (20–150 Hz) in this frame: a bass drum, or a sudden low bass note. */
  kick: boolean
  /** Below the silence threshold. */
  silent: boolean
}

/** A frame of nothing: used while Sound is off or paused. */
export const SILENT_FRAME: FeatureFrame = {
  time: 0,
  levelDb: -Infinity,
  level: 0,
  low: 0,
  mid: 0,
  high: 0,
  brightness: 0,
  beat: false,
  kick: false,
  silent: true,
}

export interface FeatureSettings {
  /** dB added to the input before measuring (SOUND_LIMITS.minSensitivity–maxSensitivity). */
  sensitivity: number
  /** Fall time constant of the smoothing, in ms (SOUND_LIMITS.minReleaseMs–maxReleaseMs). */
  releaseMs: number
}

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = { sensitivity: 0, releaseMs: SOUND_LIMITS.defaultReleaseMs }

export type SoundSource = 'off' | 'file' | 'microphone'

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
  source: 'off',
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
