import type { SliderRange } from '../state/sliderScales'
import NumberField, { decimals } from './NumberField'

interface SliderNumberProps {
  /** The setting's own value, range and step (a share 0–1, font units, degrees…). */
  value: number
  min: number
  max: number
  step: number
  /** What the box shows per unit of the value: 100 for a share shown in percent. Defaults to 1. */
  scale?: number
  /** Unit shown after the box, as the readout had it ("%", "°", "% em", "u"…). */
  unit?: string
  /** The slider's label; the box is named "<label> (<unit>)". */
  label: string
  disabled?: boolean
  /** Called with the typed value in the setting's own units, clamped and on its step. */
  onCommit: (value: number) => void
}

/** Strips floating-point noise from a scaled number (0.07 × 100 → 7). */
const clean = (n: number) => Number(n.toPrecision(12))

/**
 * A number box for a value shown `scale` times larger (a share in percent): the box's value, range and step in the
 * shown unit, and `commit`, which turns a typed number back into the value, on the value's own step.
 */
export function scaledBox(
  value: number,
  { min, max, step }: SliderRange,
  scale = 1,
  onCommit: (value: number) => void,
) {
  const shownStep = clean(step * scale)
  return {
    value: Number((value * scale).toFixed(decimals(shownStep))),
    min: clean(min * scale),
    max: clean(max * scale),
    step: shownStep,
    onCommit: (v: number) => onCommit(Number((v / scale).toFixed(decimals(step)))),
  }
}

/** The number box's name: "<label> (<unit>)", or the label alone. */
export const boxLabel = (label: string, unit?: string) => (unit ? `${label} (${unit})` : label)

/**
 * The number box in a slider's head, where its readout was: the value in the readout's unit, typed exactly and
 * committed on Enter or blur (see NumberField). The slider beside it keeps its own range, curve and live marker.
 */
export default function SliderNumber({
  value,
  min,
  max,
  step,
  scale,
  unit,
  label,
  disabled,
  onCommit,
}: SliderNumberProps) {
  return (
    <span className="slider-number">
      <NumberField
        {...scaledBox(value, { min, max, step }, scale, onCommit)}
        disabled={disabled}
        aria-label={boxLabel(label, unit)}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  )
}
