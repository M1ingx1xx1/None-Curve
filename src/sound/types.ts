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
  /** Sensitivity: dB added to the input before measuring, in steps of sensitivityStep. */
  minSensitivity: -24,
  maxSensitivity: 24,
  sensitivityStep: 1,
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
  /**
   * Pitch confidence: how periodic the last voiced frame was (1 − its YIN value / pitchThreshold), times its Level
   * against confidenceFullLevel (a quiet note counts less), smoothed like the other readings.
   */
  confidenceFullLevel: 0.45,
  /**
   * Melody: a pulse when the note moves at least melodyStepSt semitones from the note it settled on, full at
   * melodyFullSt and scaled by the confidence. The settled note follows the frames within melodyFullSt of it slowly
   * (time constant melodyCentreMs), so vibrato averages out; a move must hold (every frame within melodyStepSt of
   * where it went) for melodyHoldMs, longer than the analysis window, and come at least melodySettleMs after the last
   * note, so an octave error or a drum hit read as a pitch never pulses whatever the frame rate, nor does vibrato of
   * up to about ±80 cents at 5 to 7 Hz. A new note settles on the mean of the frames that held it. After
   * melodyMemoryMs unvoiced (or silence) the next note starts afresh, and settles on its pitch during its first
   * melodySettleMs (a slide into it does not pulse).
   */
  melodyStepSt: 0.5,
  melodyFullSt: 2,
  melodyCentreMs: 400,
  melodySettleMs: 100,
  melodyHoldMs: 70,
  melodyMemoryMs: 1000,
  /**
   * Melody range, where Pitch reactive places the pitch across the text: from the lowest to the highest note Melody
   * settled on lately (a note that started afresh counts once it has settled, melodySettleMs). A new lowest or highest
   * note widens it with time constant melodyRangeAttackMs, and both ends close in on the note heard (between notes,
   * the last one) with melodyRangeReleaseMs, so it follows the melody of the last several seconds; the first note
   * after melodyRangeReleaseMs without one starts it afresh. It spans at least
   * melodyRangeMinSt semitones around the notes, within Pitch's 0–1, so a steady voice does not sweep the text with
   * every wobble. Notes within a semitone of either end of Pitch's scale do not count (a chord or a drum without a
   * pitch in range reads there).
   */
  melodyRangeAttackMs: 150,
  melodyRangeReleaseMs: 8000,
  melodyRangeMinSt: 12,
  /** Release: rise time constant, and the default, range and slider step of the fall (release) time constant, in ms. */
  attackMs: 10,
  defaultReleaseMs: 150,
  minReleaseMs: 20,
  maxReleaseMs: 1000,
  releaseStepMs: 10,
  /** Swell: Level with these fixed rise and fall time constants (ms), whatever Release says. */
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
   * and keeps quiet hits. A steady low buzzy note still passes it (see onsetRiseDb).
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
  /**
   * Beat's energy gate. A steady low note rich in harmonics (a sawtooth, square or buzzy bass below about 140 Hz)
   * fools the flux: the window's main lobe (about ±70 Hz) spans neighbouring harmonics, so each bin's magnitude
   * swings at the note's frequency, which the frame rate aliases to a few to 19 swings a second, while the flux
   * median stays near 0. Without the gate such a note fired Beat 5–11 times a second, and kicks over it were half
   * missed among the false beats. So either detector fires only when some octave band of onsetRiseBandsHz (the last
   * runs to Nyquist; for the kick detector, the bands starting below kickBand's top) has risen at least onsetRiseDb
   * above its loudest in the onsetRiseWindowMs before. Band energy is in dB after Sensitivity, never below the
   * silence threshold. Measured on the emulated analyser: steady sawtooth basses rise at most 2.0 dB (99% of frames
   * under 1.4 dB); hits at least 2.3 dB (hats at -30 dBFS under a -12 dBFS sawtooth), most 5 dB and more. Under
   * 1.5 dB the buzz comes back; at 3 dB quiet hats over a bass are lost. Known limit: a hit masked by a louder sound
   * in its own octave (a kick 12 dB under a bass note) is missed.
   */
  onsetRiseDb: 2,
  onsetRiseWindowMs: 100,
  onsetRiseBandsHz: [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240],
  /**
   * In the gate's window, a band's energy stops counting once the band has fallen this many dB below it since: the
   * sound died away between two hits, so a second hit as loud as the first is new. Without it, equal hits closer than
   * onsetRiseWindowMs mostly vetoed each other (hats at 12 a second: 6.9 beats a second fell to 1.2). Measured on the
   * emulated analyser: a steady buzz dips at most 9.4 dB (a 41.2 Hz sawtooth; 8 lets its beats back in), while hits
   * at 10 a second fall 14 dB (plucks) to 27 dB (hats, kicks) between hits.
   */
  onsetRiseResetDb: 12,
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
   * A pulse on each new note: when the pitch moves at least SOUND_LIMITS.melodyStepSt semitones and holds there for
   * melodyHoldMs, it jumps to the move's size (full at melodyFullSt) times the confidence, then falls with the release
   * time. A steady note, vibrato up to about ±80 cents, noise, an octave error or a drum hit under a held note, and the
   * first note after silence (a short slide into it included) give none.
   */
  melody: number
  /**
   * How sure Pitch is, 0–1: the last voiced frame's periodicity times its Level (SOUND_LIMITS.confidenceFullLevel),
   * smoothed; 0 while unvoiced or silent. Not a mappable feature; Pitch reactive weighs letters with it.
   */
  pitchConfidence: number
  /**
   * The recent melody's range on Pitch's scale (SOUND_LIMITS.melodyRangeAttackMs, melodyRangeReleaseMs,
   * melodyRangeMinSt): the notes settled on over the last several seconds, at least an octave wide; 0 and 1 (all of
   * Pitch) until a note is heard. Not mappable features; Pitch reactive places the pitch in this range across the text.
   */
  pitchLow: number
  pitchHigh: number
  /**
   * A pulse: 1 on a frame where either detector finds an onset (full-band flux or the kick band), then falling with
   * the release time. The larger of the two detectors' pulses. A steady sound, a buzzy bass included, gives none
   * (SOUND_LIMITS.onsetRiseDb).
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
   * (20–150 Hz: a bass drum, or a sudden low bass note), while some octave band's energy rises (onsetRiseDb). Two
   * closer than minBeatGapMs count as one.
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
  melody: 0,
  pitchConfidence: 0,
  pitchLow: 0,
  pitchHigh: 1,
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
  /** Release: fall time constant of the smoothing, in ms (SOUND_LIMITS.minReleaseMs–maxReleaseMs). */
  releaseMs: number
}

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = { sensitivity: 0, releaseMs: SOUND_LIMITS.defaultReleaseMs }

/**
 * How the letters answer the sound, over every mapping (the Response group). Neutral (NEUTRAL_RESPONSE) is Sound as
 * it was before these existed, exactly.
 */
export interface ResponseSettings {
  /** Multiplies every slider mapping's sum and every seed's Rate (0 holds the letters still, 1 is neutral). */
  strength: number
  /** Motion contrast, 0–1: each letter reacts by its own amount (letters.ts); 0 is neutral. */
  contrast: number
  /**
   * Pitch reactive, 0–2: the low notes of the recent melody move the letters on the left more, its high notes those on
   * the right (FeatureFrame.pitchLow, pitchHigh); 0 is neutral.
   */
  pitchReactive: number
  /** Melody tracking, 0–2: adds the Melody pulse to every slider mapping's feature; 0 is neutral. */
  melody: number
}

export const RESPONSE_LIMITS = {
  strength: { min: 0, max: 4, step: 0.05 },
  contrast: { min: 0, max: 1, step: 0.01 },
  pitchReactive: { min: 0, max: 2, step: 0.05 },
  melody: { min: 0, max: 2, step: 0.05 },
  /** Melody tracking 1 adds this × Melody to a slider mapping's feature (capped at 1). */
  melodyBoost: 0.5,
} as const

export const NEUTRAL_RESPONSE: ResponseSettings = { strength: 1, contrast: 0, pitchReactive: 0, melody: 0 }

/** Everything the Response group sets: the engine's Sensitivity and Release, and the four response values. Saved and undone. */
export type SoundSettings = FeatureSettings & ResponseSettings

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { ...DEFAULT_FEATURE_SETTINGS, ...NEUTRAL_RESPONSE }

/** `value` rounded to a multiple of `step`, as the nearest double to the decimal (0.15, not 0.15000000000000002). */
export function snapToStep(value: number, step: number): number {
  if (step >= 1) return Math.round(value / step) * step
  const inverse = Math.round(1 / step)
  return Math.round(value * inverse) / inverse
}

const RESPONSE_KEYS = ['strength', 'contrast', 'pitchReactive', 'melody'] as const

/**
 * `current` with `patch` applied: each patched value clamped to RESPONSE_LIMITS and snapped to its step; one that is
 * not a finite number keeps the current value.
 */
export function clampResponse(patch: Partial<ResponseSettings>, current: ResponseSettings = NEUTRAL_RESPONSE): ResponseSettings {
  const next = { ...current }
  for (const key of RESPONSE_KEYS) {
    const value = patch[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max, step } = RESPONSE_LIMITS[key]
    next[key] = snapToStep(Math.min(max, Math.max(min, value)), step)
  }
  return next
}

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
  /** The microphone opened, but the browser could not connect it to the analyser (an audio-graph error). */
  | 'mic-connect'
  /** The microphone stopped while listening (unplugged, or access withdrawn). */
  | 'mic-ended'
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
