// Video recording's pure choices (src/export/videoFormat.ts): the MIME types tried in Chrome-, Firefox- and
// Safari-like browsers (MP4 falling back to WebM), the capped even frame size, the bitrate (with the frame rate),
// the audio delay, the frame rates, the file name (and safeFileName under it), and the clock.

import { describe, expect, it } from 'vitest'
import { safeFileName } from '../../src/export/download'
import {
  DEFAULT_VIDEO_FPS,
  VIDEO_FPS,
  VIDEO_LIMITS,
  formatClock,
  pickVideoMimes,
  recordDelayMs,
  videoBitrate,
  videoFileName,
  videoMimeCandidates,
  videoSize,
  videoFps,
  videoSupport,
} from '../../src/export/videoFormat'

const MP4_AUDIO = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
const MP4_VIDEO = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
const WEBM_AUDIO = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
const WEBM_VIDEO = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/** Recent Chrome: H.264 and AAC in MP4, VP9, VP8 and Opus in WebM. */
const chrome = (mime: string) => [...MP4_AUDIO, ...MP4_VIDEO, ...WEBM_AUDIO, ...WEBM_VIDEO].includes(mime)
/** Firefox: WebM only. */
const firefox = (mime: string) => [...WEBM_AUDIO, ...WEBM_VIDEO].includes(mime)
/** Safari: MP4 only, Baseline H.264, no High-profile string. */
const safari = (mime: string) =>
  ['video/mp4', 'video/mp4;codecs=avc1', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'].includes(mime)
const nothing = () => false

describe('video MIME types', () => {
  it('lists the candidates best first, with the audio codec only when there is audio', () => {
    expect(videoMimeCandidates('mp4', true)).toEqual(MP4_AUDIO)
    expect(videoMimeCandidates('mp4', false)).toEqual(MP4_VIDEO)
    expect(videoMimeCandidates('webm', true)).toEqual(WEBM_AUDIO)
    expect(videoMimeCandidates('webm', false)).toEqual(WEBM_VIDEO)
    for (const mime of videoMimeCandidates('mp4', false)) expect(mime).not.toContain('mp4a')
    // A copy: changing it changes nothing.
    videoMimeCandidates('mp4', true).pop()
    expect(videoMimeCandidates('mp4', true)).toHaveLength(4)
  })

  it.each([
    ['Chrome', chrome, 'mp4', true, MP4_AUDIO, 'mp4', false],
    ['Chrome', chrome, 'mp4', false, MP4_VIDEO, 'mp4', false],
    ['Chrome', chrome, 'webm', true, WEBM_AUDIO, 'webm', false],
    ['Firefox', firefox, 'mp4', true, WEBM_AUDIO, 'webm', true],
    ['Firefox', firefox, 'mp4', false, WEBM_VIDEO, 'webm', true],
    ['Firefox', firefox, 'webm', true, WEBM_AUDIO, 'webm', false],
    ['Safari', safari, 'mp4', true, MP4_AUDIO.slice(1), 'mp4', false],
    ['Safari', safari, 'mp4', false, MP4_VIDEO.slice(1), 'mp4', false],
    ['Safari', safari, 'webm', true, [], 'webm', false],
  ] as const)('%s, %s with audio %s', (_, isTypeSupported, format, audio, mimes, written, fellBack) => {
    const picked = pickVideoMimes(format, audio, isTypeSupported)
    expect(picked.map((m) => m.mimeType)).toEqual(mimes)
    for (const mime of picked) expect(mime).toMatchObject({ format: written, fellBack })
  })

  it('gives nothing when nothing is supported, or the check throws', () => {
    expect(pickVideoMimes('mp4', true, nothing)).toEqual([])
    expect(pickVideoMimes('webm', false, nothing)).toEqual([])
    const throws = () => {
      throw new Error('no MediaRecorder')
    }
    expect(pickVideoMimes('mp4', true, throws)).toEqual([])
    expect(videoSupport(throws)).toEqual({ mp4: false, webm: false })
  })

  it('says which formats a browser records', () => {
    expect(videoSupport(chrome)).toEqual({ mp4: true, webm: true })
    expect(videoSupport(firefox)).toEqual({ mp4: false, webm: true })
    expect(videoSupport(safari)).toEqual({ mp4: true, webm: false })
    expect(videoSupport(nothing)).toEqual({ mp4: false, webm: false })
  })
})

describe('video size', () => {
  const fits = (size: { width: number; height: number }) => {
    expect(size.width % 2).toBe(0)
    expect(size.height % 2).toBe(0)
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(VIDEO_LIMITS.maxSide)
    expect(size.width * size.height).toBeLessThanOrEqual(VIDEO_LIMITS.maxPixels)
  }

  it('keeps a canvas within the limits as it is, made even', () => {
    expect(videoSize(1200, 800, 1)).toEqual({ width: 1200, height: 800, capped: false })
    expect(videoSize(1200, 800, 2)).toEqual({ width: 2400, height: 1600, capped: false })
    expect(videoSize(1201, 801, 1)).toEqual({ width: 1200, height: 800, capped: false })
    expect(videoSize(3840, 2160, 1)).toEqual({ width: 3840, height: 2160, capped: false })
  })

  it('scales a large canvas down to the area limit', () => {
    const size = videoSize(4800, 3200, 1)
    expect(size).toEqual({ width: 3526, height: 2350, capped: true })
    fits(size)
    // The long-side cap alone would give 3840 × 2560, past the area limit.
    expect(3840 * 2560).toBeGreaterThan(VIDEO_LIMITS.maxPixels)
    expect(videoSize(1200, 800, 4)).toEqual(size)
  })

  it('scales a long canvas down to the long-side limit', () => {
    expect(videoSize(4000, 1000, 1)).toEqual({ width: 3840, height: 960, capped: true })
    expect(videoSize(1000, 4000, 4)).toMatchObject({ height: 3840, capped: true })
    fits(videoSize(1000, 4000, 4))
    fits(videoSize(4000, 4000, 4))
  })

  it('gives at least 2 × 2 pixels, and reads nonsense as 1', () => {
    expect(videoSize(1, 1, 1)).toEqual({ width: 2, height: 2, capped: false })
    expect(videoSize(Number.NaN, 0, -1)).toEqual({ width: 2, height: 2, capped: false })
  })
})

describe('video bitrate, delay, name and clock', () => {
  it('scales the bitrate with the pixels, within its limits', () => {
    expect(videoBitrate(1200, 800)).toBe(4_320_000)
    expect(videoBitrate(100, 100)).toBe(VIDEO_LIMITS.minBitrate)
    expect(videoBitrate(3840, 2160)).toBe(VIDEO_LIMITS.maxBitrate)
  })

  it('scales the bitrate with the frame rate (30 fps by default), within its limits', () => {
    expect(videoBitrate(1200, 800, 30)).toBe(4_320_000)
    expect(videoBitrate(1200, 800, 24)).toBe(3_456_000)
    expect(videoBitrate(1200, 800, 60)).toBe(8_640_000)
    expect(videoBitrate(1920, 1080, 60)).toBe(VIDEO_LIMITS.maxBitrate)
    expect(videoBitrate(400, 400, 24)).toBe(VIDEO_LIMITS.minBitrate)
    // Ten minutes at the most never pass the memory the cap allows for, at any rate.
    expect((videoBitrate(3840, 2160, 60) * VIDEO_LIMITS.maxMs) / 8000).toBeLessThanOrEqual(900_000_000)
  })

  it('offers 24 to 60 fps, 30 by default, and reads anything else as the default', () => {
    expect(VIDEO_FPS).toEqual([24, 25, 30, 50, 60])
    expect(DEFAULT_VIDEO_FPS).toBe(30)
    expect(videoFps(60)).toBe(60)
    expect(videoFps(undefined)).toBe(30)
    expect(videoFps(29.97)).toBe(30)
    expect(videoFps('60')).toBe(30)
  })

  it('delays the audio by the live latency plus the analysis lag', () => {
    expect(recordDelayMs(null)).toBe(90)
    expect(recordDelayMs(Number.NaN)).toBe(90)
    expect(recordDelayMs(50)).toBe(87)
    expect(recordDelayMs(12.4)).toBe(49)
    expect(recordDelayMs(0)).toBe(40)
    expect(recordDelayMs(-100)).toBe(40)
    expect(recordDelayMs(1000)).toBe(400)
  })

  it('adds half a frame of the frame clock to the delay', () => {
    expect(recordDelayMs(null, 30)).toBe(107)
    expect(recordDelayMs(50, 24)).toBe(108)
    expect(recordDelayMs(50, 60)).toBe(95)
    expect(recordDelayMs(1000, 24)).toBe(400)
    expect(recordDelayMs(-100, 60)).toBe(40)
    expect(recordDelayMs(50, 0)).toBe(87)
  })

  it('names the file after the font and the look', () => {
    expect(videoFileName('Roboto', 'Regular', false, 'mp4')).toBe('Roboto-Regular-video.mp4')
    expect(videoFileName('Roboto', 'Bold Italic', true, 'webm')).toBe('Roboto-Bold-Italic-video-preview.webm')
    expect(videoFileName('Crème Brûlée', 'Regular', false, 'mp4')).toBe('Cre-me-Bru-le-e-Regular-video.mp4')
    expect(videoFileName('', '', false, 'mp4')).toBe('video.mp4')
    expect(videoFileName('../../etc', 'passwd', false, 'webm')).toBe('etc-passwd-video.webm')
  })

  it('keeps file names safe and short (safeFileName)', () => {
    expect(safeFileName([], 'png')).toBe('none-curve.png')
    expect(safeFileName(['..', '--'], 'svg')).toBe('none-curve.svg')
    expect(safeFileName(['a/b\\c:d*e?f"g<h>i|j'], 'otf')).toBe('a-b-c-d-e-f-g-h-i-j.otf')
    const long = safeFileName(['x'.repeat(200)], 'mp4')
    expect(long).toBe(`${'x'.repeat(80)}.mp4`)
    for (const name of [long, safeFileName(['A B', 'c.d', 'e_f'], 'webm')]) expect(name).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('shows minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(12_345)).toBe('0:12')
    expect(formatClock(59_999)).toBe('0:59')
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(600_000)).toBe('10:00')
    expect(formatClock(-5)).toBe('0:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
  })
})
