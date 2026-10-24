import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { LoadedFont } from '../font/model'
import type { GeometryParams } from '../geometry/types'
import { useRecording } from '../export/recorder'
import { clampRange, RENDER_LIMITS, type RenderRange } from '../export/videoRender'
import { videoFileName } from '../export/videoFormat'
import { mappingStore } from '../sound/mappingStore'
import { PRECOMPUTE_LIMITS } from '../sound/timelineTypes'
import { useSteadySoundState } from '../sound/useSound'
import type { ArtboardParams, PaletteParams, TypographyParams } from '../specimen/artboard'
import type { PreviewLook } from '../specimen/previewLook'
import { HintButton, HintText, useHint } from './Hint'
import Icon from './Icon'
import { RecordOptionsFields, useStillVideo } from './RecordControls'

export interface VideoRenderProps {
  font: LoadedFont
  /** The text as shown (letter case applied). */
  text: string
  typography: TypographyParams
  palette: PaletteParams
  artboard: ArtboardParams
  previewLook: PreviewLook
  previewScale: number
  fill: boolean
  /** The sliders' geometry parameters and their key. */
  params: GeometryParams
  paramsKey: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; done: number }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

/** Seconds with tenths, "12.3 s", as the fields take them. */
const seconds = (ms: number) => Math.round(ms / 100) / 10

/** Minutes, seconds and tenths, "1:05.3". */
function clockTenths(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100))
  const s = Math.floor(tenths / 10)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`
}

/** Glide's time as the canvas uses it (0 while the system asks for reduced motion). */
function glideMs(): number {
  const { response, reducedMotion } = mappingStore.getState()
  return reducedMotion ? 0 : response.glideMs
}

/**
 * The Export dialog's Video format for an audio file (NOCUR-91): a stretch of the file from Start to End, rendered
 * frame by frame from the precomputed plan with its sound, faster than real time (export/videoRender.ts), then
 * downloaded. The format, frame rate, audio and look options are the ones the live Record uses.
 */
export default function VideoRender(props: VideoRenderProps) {
  const { font, artboard, palette } = props
  const sound = useSteadySoundState()
  const { options } = useRecording()
  const glide = useSyncExternalStore(mappingStore.subscribe, glideMs)
  const still = useStillVideo()
  const id = useId()
  const rangeHint = useHint()
  const durationMs = sound.duration * 1000
  const tooLong = sound.duration > PRECOMPUTE_LIMITS.maxSeconds
  // The stretch as typed (seconds), checked against the file when it is rendered.
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(() => seconds(Math.min(durationMs, RENDER_LIMITS.maxMs)))
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const abort = useRef<AbortController | null>(null)
  // A new file: its whole length (up to the longest stretch).
  const file = sound.fileName
  useEffect(() => {
    setStart(0)
    setEnd(seconds(Math.min(durationMs, RENDER_LIMITS.maxMs)))
  }, [file, durationMs])
  // Closing the dialog unmounts this: a render under way stops.
  useEffect(() => () => abort.current?.abort(), [])

  const range: RenderRange | null = clampRange({ startMs: start * 1000, endMs: end * 1000 }, durationMs)
  const ready = file !== null && durationMs > 0 && !tooLong && range !== null
  const working = status.kind === 'working'

  const render = async () => {
    if (!range || working) return
    const controller = new AbortController()
    abort.current = controller
    setStatus({ kind: 'working', done: 0 })
    try {
      const { renderVideo } = await import('../export/videoEncode')
      const result = await renderVideo({
        setup: {
          font,
          text: props.text,
          typography: props.typography,
          palette,
          artboard,
          base: props.params,
          baseKey: props.paramsKey,
        },
        glideMs: glide,
        range,
        fps: options.fps,
        format: options.format,
        audio: options.audio,
        previewLook: options.previewLook ? { look: props.previewLook, scale: props.previewScale } : null,
        fill: props.fill,
        fileName: (format) => videoFileName(font.familyName, font.styleName, options.previewLook, format),
        signal: controller.signal,
        onProgress: (done) => setStatus({ kind: 'working', done }),
      })
      const notes = [
        result.fellBack ? 'This browser cannot write MP4: saved as WebM.' : '',
        result.audioDropped ? 'This browser cannot encode the sound: the video has none.' : '',
      ].filter(Boolean)
      setStatus({
        kind: 'done',
        message: `Saved ${result.fileName}: ${clockTenths(range.startMs)} to ${clockTenths(range.endMs)}.${notes.length ? ` ${notes.join(' ')}` : ''}`,
      })
    } catch (error) {
      if (controller.signal.aborted) setStatus({ kind: 'done', message: 'Cancelled: nothing was saved.' })
      else setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }

  const fieldFor = (label: 'Start' | 'End', value: number, set: (v: number) => void) => (
    <span className="video-range-field">
      <label htmlFor={`${id}-${label}`}>{label}</label>
      <input
        id={`${id}-${label}`}
        type="number"
        min={0}
        max={seconds(durationMs)}
        step={0.1}
        value={value}
        disabled={working || !ready}
        aria-describedby={rangeHint.id}
        onChange={(e) => set(e.target.valueAsNumber)}
      />
      <span aria-hidden="true">s</span>
    </span>
  )

  return (
    <div className="export-section">
      <div className="field">
        <span className="field-title">
          <span className="field-label">Time range</span>
          <HintButton hint={rangeHint} topic="Time range" />
        </span>
        <div className="sound-row video-range">
          {fieldFor('Start', start, setStart)}
          {fieldFor('End', end, setEnd)}
        </div>
        {range && (
          <p className="field-hint">
            {clockTenths(range.startMs)} to {clockTenths(range.endMs)} of {clockTenths(durationMs)} ·{' '}
            {clockTenths(range.endMs - range.startMs)} long
          </p>
        )}
        <HintText hint={rangeHint}>
          The stretch of the audio file to save, in seconds from its start, at most {RENDER_LIMITS.maxMs / 60_000}{' '}
          minutes. It is rendered from the plan Sound makes of the whole file, frame by frame, so the video is smooth
          however heavy the effects, and comes out the same every time.
        </HintText>
      </div>

      <RecordOptionsFields artboard={artboard} transparent={palette.transparent} offline locked={working} />

      {file === null && <p className="font-warning">Choose an audio file in the Sound tab first.</p>}
      {tooLong && (
        <p className="font-warning">
          Files longer than {PRECOMPUTE_LIMITS.maxSeconds / 60} minutes cannot be rendered: use a shorter file.
        </p>
      )}
      {still && <p className="font-warning">Sound is not moving the letters: the video will be still.</p>}
      {working && (
        <p className="field-hint">
          <progress value={status.done} max={1} aria-label="Rendering the video" /> Rendering…{' '}
          {Math.round(status.done * 100)}%
        </p>
      )}
      {status.kind === 'done' && <p className="panel-notice">{status.message}</p>}
      {status.kind === 'error' && <p className="font-warning">{status.message}</p>}
      <div className="export-actions">
        {working ? (
          <button type="button" className="button-primary" onClick={() => abort.current?.abort()}>
            <Icon name="stop" />
            Cancel
          </button>
        ) : (
          <button type="button" className="button-primary" disabled={!ready} onClick={render}>
            <Icon name="download" />
            Render video
          </button>
        )}
      </div>
    </div>
  )
}
