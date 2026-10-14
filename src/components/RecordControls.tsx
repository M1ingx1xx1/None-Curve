import { useId } from 'react'
import { getRecorder, useRecording, type RecordOptions } from '../export/recorder'
import { RECORD_LENGTHS, VIDEO_LIMITS, formatClock, videoSize, type RecordLength, type VideoFormat } from '../export/videoFormat'
import { LIVE_LIMITS, useLiveDriving, useLiveStatus } from '../sound/live'
import { useMappingState } from '../sound/mappingStore'
import type { SoundState } from '../sound/types'
import { useSoundState } from '../sound/useSound'
import type { ArtboardParams } from '../specimen/artboard'
import { HintButton, HintText, useHint } from './Hint'
import Icon from './Icon'

/** What the Record controls need from the page: the canvas (its size and export scale) and whether it has a background. */
interface RecordSetup {
  artboard: ArtboardParams
  /** The palette has no background (Color): the video paints it anyway. */
  transparent: boolean
}

const FORMAT_LABELS: Record<VideoFormat, string> = { mp4: 'MP4', webm: 'WebM' }

function lengthLabel(length: RecordLength): string {
  return length === 'until-stopped' ? 'Until stopped' : length === 'whole-file' ? 'Whole file' : `${length} s`
}

/** Whole file needs an audio file with a length; with the microphone or no file a take runs until stopped. */
const hasWholeFile = (sound: SoundState) => sound.source === 'file' && sound.duration > 0

/** The next take's length (ms) as the options set it now, at most the 10-minute cap; null until stopped. */
function plannedLimitMs(options: RecordOptions, sound: SoundState): number | null {
  const ms = typeof options.length === 'number' ? options.length * 1000 : options.length === 'whole-file' && hasWholeFile(sound) ? sound.duration * 1000 : null
  return ms === null ? null : Math.min(ms, VIDEO_LIMITS.maxMs)
}

/**
 * Sound will not move the letters in the video: Drive letters is off, Strength is 0%, or no mapping has a
 * Depth. While Sound drives the letters it never is. (Whether a mapping's target acts is known only once the
 * sound runs, so that case is left out rather than shown for a frame on every Play.)
 */
export function useStillVideo(): boolean {
  const { mappings, response, drive } = useMappingState()
  const driving = useLiveDriving()
  if (driving) return false
  return !drive || response.strength === 0 || !mappings.some((mapping) => mapping.enabled && mapping.depth !== 0)
}

/**
 * A take's choices: Format, Length, Include audio and Use the preview look, then the video's size. Shared by
 * the Record group (Sound tab) and the Export dialog's Video format: both set the same options, which last
 * for the visit (not saved, not undone) and are locked during a take.
 */
export function RecordOptionsFields({ artboard, transparent }: RecordSetup) {
  const { phase, options, take, support } = useRecording()
  const sound = useSoundState()
  const id = useId()
  const formatHint = useHint()
  const lengthHint = useHint()
  const audioHint = useHint()
  const lookHint = useHint()
  const recorder = getRecorder()
  const locked = phase !== 'idle'
  const wholeFile = hasWholeFile(sound)
  // During a take, what it records; otherwise what Record would record now.
  const size = take ?? videoSize(artboard.width, artboard.height, artboard.scale)
  const format = take?.mimes[0]?.format ?? (options.format === 'mp4' && !support.mp4 && support.webm ? 'webm' : options.format)

  return (
    <>
      <div className="field">
        <span className="field-title">
          <label htmlFor={`${id}-format`}>Format</label>
          <HintButton hint={formatHint} topic="Format" />
        </span>
        <select
          id={`${id}-format`}
          value={options.format}
          disabled={locked}
          aria-describedby={formatHint.id}
          onChange={(e) => recorder.setOptions({ format: e.target.value as VideoFormat })}
        >
          {(['mp4', 'webm'] as const).map((value) => (
            <option key={value} value={value} disabled={!support[value]}>
              {FORMAT_LABELS[value]}
              {support[value] ? '' : ' (not supported in this browser)'}
            </option>
          ))}
        </select>
        <HintText hint={formatHint}>
          MP4 plays almost everywhere. A browser that cannot write MP4 saves WebM instead, and says so.
        </HintText>
      </div>

      <div className="field">
        <span className="field-title">
          <label htmlFor={`${id}-length`}>Length</label>
          <HintButton hint={lengthHint} topic="Length" />
        </span>
        <select
          id={`${id}-length`}
          value={String(options.length)}
          disabled={locked}
          aria-describedby={lengthHint.id}
          onChange={(e) => {
            const length = RECORD_LENGTHS.find((l) => String(l) === e.target.value)
            if (length !== undefined) recorder.setOptions({ length })
          }}
        >
          {RECORD_LENGTHS.map((length) => (
            <option key={length} value={String(length)} disabled={length === 'whole-file' && !wholeFile}>
              {lengthLabel(length)}
            </option>
          ))}
        </select>
        {options.length === 'whole-file' && !wholeFile && (
          <p className="field-hint">Whole file needs an audio file: this take runs until stopped.</p>
        )}
        <HintText hint={lengthHint}>
          How long a take runs, at most {VIDEO_LIMITS.maxMs / 60_000} minutes. With a file it starts at the current Position;
          Whole file plays the file from its start to its end, with Loop off for the take. A take also ends when the sound
          stops, the tab is hidden or the canvas size changes.
        </HintText>
      </div>

      <div className="field">
        <div className="field field-toggle">
          <input
            id={`${id}-audio`}
            type="checkbox"
            checked={options.audio}
            disabled={locked}
            aria-describedby={audioHint.id}
            onChange={(e) => recorder.setOptions({ audio: e.target.checked })}
          />
          <span className="field-title">
            <label htmlFor={`${id}-audio`}>Include audio</label>
            <HintButton hint={audioHint} topic="Include audio" />
          </span>
        </div>
        <HintText hint={audioHint}>
          Puts the sound into the video, lined up with the letters. With the microphone, its sound goes into the file
          (it is still never played back).
        </HintText>
      </div>

      <div className="field">
        <div className="field field-toggle">
          <input
            id={`${id}-look`}
            type="checkbox"
            checked={options.previewLook}
            disabled={locked}
            aria-describedby={lookHint.id}
            onChange={(e) => recorder.setOptions({ previewLook: e.target.checked })}
          />
          <span className="field-title">
            <label htmlFor={`${id}-look`}>Use the preview look</label>
            <HintButton hint={lookHint} topic="the preview look" />
          </span>
        </div>
        <HintText hint={lookHint}>
          Off: the canvas in its Color settings. On: the bottom-right preview’s look, with its blur and swapped colours.
        </HintText>
      </div>

      <p className="field-hint">
        {size.width} × {size.height} px · up to {LIVE_LIMITS.maxFps} fps · {FORMAT_LABELS[format]}
        {size.capped ? ' (scaled down to the 4K limit)' : ''}
      </p>
      {transparent && <p className="field-hint">Videos have no transparency: the background colour is painted.</p>}
    </>
  )
}

/**
 * The Sound tab's Record group: Record and Stop with the time recorded, the take's options, the live frame
 * rate, and how the last take went. Start and stop are announced by the header's recording indicator, which
 * is always on the page (a take can start from the Export dialog with this tab closed).
 */
export function RecordGroup({ artboard, transparent }: RecordSetup) {
  const { phase, elapsedMs, options, take, message } = useRecording()
  const sound = useSoundState()
  const status = useLiveStatus()
  const still = useStillVideo()
  const recordHint = useHint()
  const blockerId = useId()
  const recorder = getRecorder()
  const idle = phase === 'idle'
  // Read at every render: the recorder re-renders this when it changes (a font, a file, the sound opening).
  const blocked = idle ? recorder.blocker() : null
  const limitMs = take ? take.limitMs : plannedLimitMs(options, sound)

  return (
    <fieldset className="group sound">
      <legend>Record</legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <div className="field">
          <div className="sound-row">
            {/* aria-disabled, not disabled: the button keeps keyboard focus while the sound opens, and turns into Stop. */}
            <button
              type="button"
              className="button-small"
              aria-disabled={blocked !== null || phase === 'stopping' || undefined}
              aria-describedby={[blocked !== null && blockerId, recordHint.id].filter(Boolean).join(' ')}
              title={blocked ?? undefined}
              onClick={() => {
                if (idle) {
                  if (blocked === null) recorder.start()
                } else recorder.stop('user')
              }}
            >
              <Icon name={idle ? 'record' : 'stop'} />
              {idle ? 'Record' : 'Stop'}
            </button>
            <HintButton hint={recordHint} topic="Record" />
            {/* Not a live region: it changes every second while recording. The header announces start and stop. */}
            <output className="record-time" aria-live="off">
              {formatClock(elapsedMs)}
              {limitMs !== null && ` / ${formatClock(limitMs)}`}
            </output>
            {/* Not a live region either: the status bar announces "Live", and the number changes every second. */}
            {status.driving && <span className="sound-live">Live · {status.fps} fps</span>}
          </div>
          {blocked !== null && (
            <p id={blockerId} className="field-hint">
              {blocked}
            </p>
          )}
          <HintText hint={recordHint}>
            Records the canvas as it moves with the sound, in real time, and saves the video when the take ends. Record
            starts the file or the microphone if it is not running, and pauses it again at the end. Freeze is off while
            recording.
          </HintText>
        </div>

        <RecordOptionsFields artboard={artboard} transparent={transparent} />

        {status.slow && <p className="font-warning">Too slow for a smooth video: try fewer effects or a shorter text.</p>}
        {still && <p className="field-hint">Sound is not moving the letters: the video will be still.</p>}
        {message && (
          <p className={message.tone === 'info' ? 'panel-notice record-message' : 'font-warning record-message'} data-tone={message.tone}>
            {message.text}
          </p>
        )}
      </div>
    </fieldset>
  )
}
