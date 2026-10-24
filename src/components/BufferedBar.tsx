// The buffered bar under the Sound tab's Position slider (NOCUR-85), like a video's buffered ranges: how far
// precomputed playback has worked out the file's moves (the parameter plan, contiguous from the start; the lighter
// layer) and where the shapes are ready (geometry around the playhead; the stronger layer). It reads bufferStore,
// which the director publishes at most four times a second, so the Sound tab does not re-render for it.

import { memo, useSyncExternalStore } from 'react'
import { bufferStore, type BufferSnapshot, type BufferStore } from '../sound/bufferStore'

/** The bar's layers as shares of the file (0–1): the plan up to `planned`, ready geometry as [start, end] pairs. */
export interface BufferShares {
  planned: number
  ready: [number, number][]
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** The snapshot as shares of the file's length; null when there is no precomputed file (no bar). */
export function bufferShares(s: BufferSnapshot): BufferShares | null {
  if (!(s.durationMs > 0)) return null
  const ready: [number, number][] = []
  for (let i = 0; i + 1 < s.ready.length; i += 2) {
    const start = clamp01(s.ready[i] / s.durationMs)
    const end = clamp01(s.ready[i + 1] / s.durationMs)
    if (end > start) ready.push([start, end])
  }
  return { planned: clamp01(s.plannedMs / s.durationMs), ready }
}

/**
 * What screen readers hear about the bar (the Position slider's description): how far the moves are worked out,
 * and the stretch of ready shapes around `positionMs`. `format` turns seconds into the slider's own time format.
 */
export function bufferDescription(s: BufferSnapshot, positionMs: number, format: (seconds: number) => string): string {
  if (!(s.durationMs > 0)) return ''
  const moves =
    s.plannedMs >= s.durationMs
      ? 'moves worked out for the whole file'
      : `moves worked out to ${format(s.plannedMs / 1000)}`
  let shapes = 'shapes not ready here yet'
  for (let i = 0; i + 1 < s.ready.length; i += 2) {
    if (s.ready[i] <= positionMs && positionMs <= s.ready[i + 1]) {
      shapes = `shapes ready from ${format(s.ready[i] / 1000)} to ${format(s.ready[i + 1] / 1000)}`
      break
    }
  }
  return `Prepared for smooth playback: ${moves}; ${shapes}.`
}

interface BufferedBarProps {
  /** The id of the description, for the slider's aria-describedby. */
  id: string
  /** The slider's position (seconds). */
  position: number
  format: (seconds: number) => string
  /** For tests; the app's own store by default. */
  store?: BufferStore
}

/**
 * Place it right after the Position input, inside `<span className="sound-position-slider">`, which lines it up with
 * the thumb's travel. Draws straight rectangles only; no bar while there is no precomputed file (the microphone,
 * precompute off, or a file too long).
 */
function BufferedBar({ id, position, format, store = bufferStore }: BufferedBarProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get)
  const shares = bufferShares(snapshot)
  // The description is always there (empty without a bar), so the slider's aria-describedby never points at nothing.
  return (
    <>
      {shares && (
        <svg
          className="sound-buffer"
          aria-hidden="true"
          viewBox="0 0 1000 1"
          preserveAspectRatio="none"
          focusable="false"
        >
          <rect className="sound-buffer-planned" x={0} y={0} width={shares.planned * 1000} height={1} />
          {shares.ready.map(([start, end]) => (
            <rect
              key={start}
              className="sound-buffer-ready"
              x={start * 1000}
              y={0}
              width={(end - start) * 1000}
              height={1}
            />
          ))}
        </svg>
      )}
      <span id={id} className="visually-hidden">
        {bufferDescription(snapshot, position * 1000, format)}
      </span>
    </>
  )
}

export default memo(BufferedBar)
