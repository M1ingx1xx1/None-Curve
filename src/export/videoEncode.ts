// The page's side of the offline video (videoRender.ts, NOCUR-91): a planner of its own on the file's measured
// features (the director's, sound/director.ts getRenderSource), the scenes built with the geometry workers, each frame
// drawn into a canvas of the video's size and encoded with WebCodecs into MP4 or WebM (Mediabunny), with the file's
// sound for the same stretch, then downloaded. Loaded only when a video is rendered.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny'
import { getRenderSource } from '../sound/director'
import { PlaybackPlanner } from '../sound/planner'
import { geometryClient } from '../state/geometryClient'
import { previewBlur, previewColors, type PreviewLook } from '../specimen/previewLook'
import { downloadFile } from './download'
import { canvasFilterWorks, drawArtboard, polygonPaths, type DrawTarget, type VideoLook } from './drawArtboard'
import { videoBitrate, videoSize, type VideoFormat, type VideoFps } from './videoFormat'
import { RENDER_LIMITS, renderFrames, sceneBuilder, type RenderRange, type SceneSetup } from './videoRender'

export interface VideoRenderOptions {
  setup: SceneSetup
  /** Glide's time (ms) as the canvas uses it. */
  glideMs: number
  range: RenderRange
  fps: VideoFps
  format: VideoFormat
  audio: boolean
  /** The preview's look (with its scale) for "Use the preview look", or null for the canvas's own. */
  previewLook: { look: PreviewLook; scale: number } | null
  /** The canvas's Fill: off, outlines only. */
  fill: boolean
  fileName: (format: VideoFormat) => string
  signal: AbortSignal
  onProgress: (done: number) => void
}

export interface VideoRenderResult {
  fileName: string
  format: VideoFormat
  /** MP4 was asked for and the browser could only write WebM. */
  fellBack: boolean
  /** Audio was asked for and the browser could not encode it: the video has none. */
  audioDropped: boolean
}

const VIDEO_CODECS: Record<VideoFormat, VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1', 'vp9'],
  webm: ['vp9', 'vp8', 'av1'],
}
const AUDIO_CODECS: Record<VideoFormat, AudioCodec[]> = { mp4: ['aac', 'opus'], webm: ['opus', 'vorbis'] }
const MIMES: Record<VideoFormat, string> = { mp4: 'video/mp4', webm: 'video/webm' }
/** The audio goes into the file in pieces this long (s), a little ahead of the frames, so the tracks interleave. */
const AUDIO_PIECE_S = 1
/** Audio is decoded at this rate (Hz). */
const AUDIO_RATE = 48_000

/** A video codec the browser can encode at this size, in `format` or else the other format; null for none. */
async function chooseFormat(format: VideoFormat, width: number, height: number) {
  for (const candidate of format === 'mp4' ? (['mp4', 'webm'] as const) : (['webm', 'mp4'] as const)) {
    const codec = await getFirstEncodableVideoCodec(VIDEO_CODECS[candidate], { width, height })
    if (codec) return { format: candidate, codec }
  }
  return null
}

/** The file's sound from `range`, decoded, or null when it cannot be. */
async function audioSlice(file: Blob, range: RenderRange): Promise<AudioBuffer | null> {
  const decoded = await new OfflineAudioContext(1, 1, AUDIO_RATE).decodeAudioData(await file.arrayBuffer())
  const from = Math.floor((range.startMs / 1000) * decoded.sampleRate)
  const to = Math.min(decoded.length, Math.round((range.endMs / 1000) * decoded.sampleRate))
  if (to <= from) return null
  const slice = new AudioBuffer({
    numberOfChannels: decoded.numberOfChannels,
    length: to - from,
    sampleRate: decoded.sampleRate,
  })
  for (let c = 0; c < decoded.numberOfChannels; c++)
    slice.copyToChannel(decoded.getChannelData(c).subarray(from, to), c)
  return slice
}

/** `buffer` from sample `from` to `to` as an AudioBuffer of its own. */
function piece(buffer: AudioBuffer, from: number, to: number): AudioBuffer {
  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: to - from,
    sampleRate: buffer.sampleRate,
  })
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(from, to), c)
  return out
}

/** Renders the stretch of the audio file into a video and downloads it (see the top of the file). */
export async function renderVideo(options: VideoRenderOptions): Promise<VideoRenderResult> {
  const { setup, range, fps, signal } = options
  const source = getRenderSource()
  if (!source || !source.inputs.base) throw new Error('The audio file is not ready to render: play it once or wait.')
  const size = videoSize(setup.artboard.width, setup.artboard.height, setup.artboard.scale)
  const chosen = await chooseFormat(options.format, size.width, size.height)
  if (!chosen) throw new Error('This browser cannot encode video.')
  const sound = options.audio ? await audioSlice(source.file, range) : null
  const audioCodec = sound
    ? await getFirstEncodableAudioCodec(AUDIO_CODECS[chosen.format], {
        numberOfChannels: sound.numberOfChannels,
        sampleRate: sound.sampleRate,
      })
    : null
  signal.throwIfAborted()

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('This browser cannot draw the video.')
  const target: DrawTarget<Path2D> = { ctx, width: size.width, height: size.height, layer: null, filter: false }
  target.filter = canvasFilterWorks(ctx)
  const pathOf = polygonPaths(() => new Path2D())

  const output = new Output({
    format: chosen.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const video = new CanvasSource(canvas, {
    codec: chosen.codec,
    bitrate: videoBitrate(size.width, size.height, fps),
  })
  output.addVideoTrack(video, { frameRate: fps })
  const audio = sound && audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null
  if (audio) output.addAudioTrack(audio)

  const planner = new PlaybackPlanner(source.timeline)
  planner.setInputs(source.inputs)
  let audioAt = 0
  const addAudioUntil = async (seconds: number) => {
    if (!audio || !sound) return
    const end = Math.min(sound.length, Math.round(seconds * sound.sampleRate))
    while (audioAt < end) {
      const next = Math.min(end, audioAt + AUDIO_PIECE_S * sound.sampleRate)
      await audio.add(piece(sound, audioAt, next))
      audioAt = next
    }
  }
  try {
    await output.start()
    await renderFrames({
      plan: {
        planUntil: (ms) => {
          planner.focus(ms)
          if (planner.ensure(ms, RENDER_LIMITS.planSliceMs)) return 'ready'
          return source.timeline.covered(Math.min(ms, Math.max(0, planner.plannedUntil()) + 1000 / source.timeline.hz))
            ? 'more'
            : 'waiting'
        },
        range: (fromMs, toMs) => planner.range(fromMs, toMs),
      },
      build: sceneBuilder(setup, (font, params, key, indices, abort) =>
        geometryClient.ensure(font, params, key, indices, abort),
      ),
      sink: {
        draw: (scene, layout, palette) => {
          const colors = options.previewLook ? previewColors(palette, options.previewLook.look) : palette
          const blur = options.previewLook
            ? previewBlur(options.previewLook.look.blur, options.previewLook.scale, layout.unitsPerPx)
            : 0
          const look: VideoLook = { ink: colors.ink, paper: colors.paper, blur, outlineOnly: !options.fill }
          target.layer = blur > 0 && target.filter ? (target.layer ?? glyphLayer(size.width, size.height)) : null
          drawArtboard(target, scene, layout, setup.artboard, look, pathOf)
        },
        add: async (timestampS, durationS) => {
          await addAudioUntil(timestampS + durationS + AUDIO_PIECE_S)
          await video.add(timestampS, durationS)
        },
      },
      range,
      fps,
      glideMs: options.glideMs,
      signal,
      onProgress: options.onProgress,
    })
    await addAudioUntil(Infinity)
    video.close()
    audio?.close()
    await output.finalize()
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {})
    throw error
  } finally {
    planner.dispose()
  }
  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new Error('The video could not be written.')
  const fileName = options.fileName(chosen.format)
  downloadFile(buffer, fileName, MIMES[chosen.format])
  return {
    fileName,
    format: chosen.format,
    fellBack: chosen.format !== options.format,
    audioDropped: options.audio && !audio,
  }
}

/** A transparent canvas for the glyphs, to blur them as one; null when the browser cannot give one. */
function glyphLayer(width: number, height: number): DrawTarget<Path2D>['layer'] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  return ctx ? { ctx, image: canvas } : null
}
