// The live marker on a slider that Sound drives: a thin line over the track at the live value, while
// the slider's own thumb stays on the value the user set (see docs/SOUND_PLAN.md §5).

import type { CSSProperties } from 'react'
import { useLivePosition } from '../sound/live'

/**
 * Shows where Sound has moved this target on its slider, or nothing while Sound does not drive it.
 * Place it right after the range input, inside `<span className="live-slider">`, which positions it.
 * Decoration only (aria-hidden): the slider keeps announcing its own value.
 */
export default function LiveMarker({ target }: { target: string }) {
  const position = useLivePosition(target)
  if (position === null || !Number.isFinite(position)) return null
  // A custom property, so the stylesheet can line the marker up with where the native thumb would sit.
  const style = { '--live-position': Math.min(1, Math.max(0, position)) } as CSSProperties
  return <span className="live-marker" aria-hidden="true" style={style} />
}
