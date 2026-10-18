// Video recording's choices and limits: the container and codec strings to try, the frame size and
// bitrate, the audio delay, the file name and the clock. Pure: the browser's checks come in as functions.

import { safeFileName } from './download'

export type VideoFormat = 'mp4' | 'webm'

/** How long a take runs: until Stop, a number of seconds, or the whole audio file from its start. */
export type RecordLength = 'until-stopped' | 5 | 10 | 15 | 30 | 60 | 'whole-file'

export const RECORD_LENGTHS: readonly RecordLength[] = ['until-stopped', 5, 10, 15, 30, 60, 'whole-file']

/** The video's frame rate: film, PAL and NTSC-style web video, and their doubles. */
export type VideoFps = 24 | 25 | 30 | 50 | 60

export const VIDEO_FPS: readonly VideoFps[] = [24, 25, 30, 50, 60]

export const DEFAULT_VIDEO_FPS: VideoFps = 30

export const VIDEO_LIMITS = {
  /** Longest side of the video, and its area (4K UHD): past these, H.264 encoders refuse or fail the frame. */
  maxSide: 3840,
  maxPixels: 3840 * 2160,
  /** A take stops after 10 minutes: the recording is held in memory until it is saved. */
  maxMs: 600_000,
  /**
   * Video bitrate: bits per second for each pixel of the frame at referenceFps (0.15 bits per pixel per frame),
   * scaled with the frame rate and kept within min and max (12 Mbps is about 0.9 GB in 10 minutes, at any rate).
   */
  bitsPerPixel: 4.5,
  referenceFps: 30,
  minBitrate: 2_000_000,
  maxBitrate: 12_000_000,
  audioBitrate: 128_000,
  /** The recorder hands over its data this often (ms), so an error keeps what came before it. */
  timesliceMs: 1000,
  /**
   * After Stop, the take goes on this long (ms) so its last frame is in the file: a frame asked for just before
   * the recorder stops is lost.
   */
  finalFrameMs: 100,
  /**
   * When the sound ends a take (its length, the file's end, the file paused), it goes on for the audio's delay and
   * this long (ms): the end of the sound is still in the delay, and the letters answer it about as late.
   */
  drainMs: 100,
  /** The elapsed time shown updates this often (ms). */
  tickMs: 250,
  /** A take whose sound or first frame has not arrived after this long (ms) is given up. */
  startTimeoutMs: 30_000,
  /** The audio's delay behind the sound (ms), so it lines up with the letters: before the first live frame, and its range. */
  defaultDelayMs: 90,
  minDelayMs: 40,
  maxDelayMs: 400,
  /** Added to the live latency (ms): half the analysis window (about 21 ms at any sample rate) and one display frame (16 ms). */
  lagMs: 37,
} as const

/** A MIME type to record with, the format it writes, and whether it stands in for MP4 (unsupported). */
export interface VideoMime {
  mimeType: string
  format: VideoFormat
  fellBack: boolean
}

/** H.264 High then Baseline, then any H.264, then the browser's own MP4; VP9, then VP8, then the browser's own WebM. */
const CANDIDATES: Record<VideoFormat, { video: string[]; audio: string[] }> = {
  mp4: {
    video: ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'],
    audio: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'],
  },
  webm: {
    video: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
    audio: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
  },
}

/** The MIME types to try for a format, best first, with or without an audio track. */
export function videoMimeCandidates(format: VideoFormat, audio: boolean): string[] {
  return [...CANDIDATES[format][audio ? 'audio' : 'video']]
}

/**
 * The format's candidates the browser supports, best first. MP4 with none supported gives WebM's, marked
 * `fellBack`; nothing supported gives [].
 */
export function pickVideoMimes(format: VideoFormat, audio: boolean, isTypeSupported: (mime: string) => boolean): VideoMime[] {
  const supported = (f: VideoFormat, fellBack: boolean) =>
    videoMimeCandidates(f, audio)
      .filter((mimeType) => isSupported(isTypeSupported, mimeType))
      .map((mimeType): VideoMime => ({ mimeType, format: f, fellBack }))
  const own = supported(format, false)
  return own.length > 0 || format === 'webm' ? own : supported('webm', true)
}

/** Which formats this browser can record at all (with or without audio). */
export function videoSupport(isTypeSupported: (mime: string) => boolean): { mp4: boolean; webm: boolean } {
  const any = (format: VideoFormat) =>
    [...videoMimeCandidates(format, true), ...videoMimeCandidates(format, false)].some((mime) => isSupported(isTypeSupported, mime))
  return { mp4: any('mp4'), webm: any('webm') }
}

/** A browser check that throws counts as unsupported. */
function isSupported(isTypeSupported: (mime: string) => boolean, mime: string): boolean {
  try {
    return isTypeSupported(mime) === true
  } catch {
    return false
  }
}

/**
 * The video's size in pixels: the canvas at its export scale (as PNG), scaled down to fit the longest
 * side and the area limits, each side an even number (H.264 needs them even). `capped` when scaled down.
 */
export function videoSize(width: number, height: number, scale: number): { width: number; height: number; capped: boolean } {
  const w0 = positive(width) * positive(scale)
  const h0 = positive(height) * positive(scale)
  const f = Math.min(1, VIDEO_LIMITS.maxSide / Math.max(w0, h0), Math.sqrt(VIDEO_LIMITS.maxPixels / (w0 * h0)))
  const even = (side: number) => Math.max(2, Math.floor((side * f) / 2) * 2)
  return { width: even(w0), height: even(h0), capped: f < 1 }
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

/** Video bits per second for a frame size and rate (30 fps when not given), within VIDEO_LIMITS' min and max. */
export function videoBitrate(width: number, height: number, fps: number = VIDEO_LIMITS.referenceFps): number {
  const bits = Math.round(positive(width) * positive(height) * VIDEO_LIMITS.bitsPerPixel * (positive(fps) / VIDEO_LIMITS.referenceFps))
  return Math.min(VIDEO_LIMITS.maxBitrate, Math.max(VIDEO_LIMITS.minBitrate, bits))
}

/**
 * The audio's delay for a take (ms): the live latency plus the analysis lag, or the default before any live frame.
 * With a frame rate, also half a frame: frames are taken on a fixed clock, so a drawing waits half a frame on
 * average before it is in the video.
 */
export function recordDelayMs(latencyMs: number | null, fps?: number): number {
  const frame = fps !== undefined && Number.isFinite(fps) && fps > 0 ? 500 / fps : 0
  const base = latencyMs === null || !Number.isFinite(latencyMs) ? VIDEO_LIMITS.defaultDelayMs - VIDEO_LIMITS.lagMs : latencyMs
  return Math.min(VIDEO_LIMITS.maxDelayMs, Math.max(VIDEO_LIMITS.minDelayMs, Math.round(base + VIDEO_LIMITS.lagMs + frame)))
}

/** A frame rate from the list, or the default for anything else (an older or unknown value). */
export function videoFps(value: unknown): VideoFps {
  return VIDEO_FPS.find((fps) => fps === value) ?? DEFAULT_VIDEO_FPS
}

/** "Family-Style-video.mp4", or "-video-preview" with the preview's look. */
export function videoFileName(family: string, style: string, previewLook: boolean, format: VideoFormat): string {
  return safeFileName([family, style, previewLook ? 'video-preview' : 'video'], format)
}

/** Minutes and seconds, "0:12" or "1:05" (whole seconds, rounded down). */
export function formatClock(ms: number): string {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
