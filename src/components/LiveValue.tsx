// Live markers for the controls Sound drives that are not sliders: a checkbox (a switch target), a colour (its hue
// and lightness targets) and a variable font axis (no control of its own). The counterparts of LiveMarker and LiveSeed
// (see docs/SOUND_PLAN.md §5): each shows the value Sound has moved its target to, or nothing while Sound does not
// drive it, and is decoration only (aria-hidden): the control keeps announcing its own value.

import { useLivePosition } from '../sound/live'
import { targetById } from '../sound/mapping'

/** The live value of a target from its live slider position, or null while Sound does not drive it. */
function useLiveValue(targetId: string): number | null {
  const position = useLivePosition(targetId)
  const spec = targetById(targetId)
  return position === null || !spec || !Number.isFinite(position) ? null : spec.fromSlider(position)
}

/**
 * A small square beside a checkbox Sound flips: filled while the switch is on live, hollow while it is off. Place it
 * after the checkbox's label.
 */
export function LiveSwitch({ target }: { target: string }) {
  const value = useLiveValue(target)
  if (value === null) return null
  const on = value >= 0.5
  return <span className="live-switch" data-on={on || undefined} aria-hidden="true" title={on ? 'Live: on' : 'Live: off'} />
}

/**
 * The colour Sound has moved a palette colour to, as a square swatch, while Sound drives its hue or lightness targets
 * (`hue`, `lightness`): `color` is the colour the canvas shows (the committed live look's, else the field's own), never
 * rebuilt from the markers, so near the gamut's edge the swatch matches the canvas. Place it in the field's colour row.
 */
export function LiveColor({ color, hue, lightness }: { color: string; hue: string; lightness: string }) {
  const liveHue = useLiveValue(hue)
  const liveLightness = useLiveValue(lightness)
  if (liveHue === null && liveLightness === null) return null
  const hex = color
  return <span className="live-color" aria-hidden="true" title={`Live colour ${hex}`} style={{ background: hex }} />
}

/** The value Sound has moved a variable font axis to, in the live marker's colour. */
export function LiveAxis({ tag }: { tag: string }) {
  const value = useLiveValue(`axis.${tag}`)
  if (value === null) return null
  return (
    <span className="live-value" aria-hidden="true" title="Live value">
      {value}
    </span>
  )
}
