import { getRecorder, useRecording } from '../export/recorder'
import { formatClock } from '../export/videoFormat'
import Icon from './Icon'

/**
 * In the header while a take runs: a red light, "Recording 0:12" and Stop, wherever the take was started
 * (the Sound tab or the Export dialog). It also announces the take's start and how it ended, since it is
 * always on the page, and shows how it ended until dismissed or the next take: the Sound tab, which shows it
 * too, may be closed.
 */
export default function RecordingIndicator() {
  const { phase, elapsedMs, message } = useRecording()
  const label =
    phase === 'starting'
      ? 'Starting to record…'
      : phase === 'stopping'
        ? 'Saving the video…'
        : `Recording ${formatClock(elapsedMs)}`
  // Only the start and the end: the time itself changes every second.
  const announcement =
    phase === 'recording' || phase === 'stopping' ? 'Recording started.' : phase === 'idle' ? (message?.text ?? '') : ''

  return (
    <>
      {phase !== 'idle' && (
        <div className="recording-indicator">
          <span className="recording-label">
            <span className="sound-dot" aria-hidden="true" />
            {label}
          </span>
          {/* aria-disabled, not disabled: keeps keyboard focus while the file is saved. */}
          <button
            type="button"
            className="icon-button"
            aria-label="Stop recording"
            title="Stop recording"
            aria-disabled={phase === 'stopping' || undefined}
            onClick={() => getRecorder().stop('user')}
          >
            <Icon name="stop" />
          </button>
        </div>
      )}
      {phase === 'idle' && message && (
        <div className="recording-message">
          <p className={message.tone === 'info' ? 'panel-notice' : 'font-warning'} data-tone={message.tone}>
            {message.text}
          </p>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => getRecorder().clearMessage()}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {/* Always in the document, so screen readers announce it when it changes. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </>
  )
}
