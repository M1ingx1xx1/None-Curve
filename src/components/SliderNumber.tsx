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
 * The number box in a slider's head, where its readout was: the value in the readout's unit, typed exactly and
 * committed on Enter or blur (see NumberField). The slider beside it keeps its own range, curve and live marker.
 */
export default function SliderNumber({ value, min, max, step, scale = 1, unit, label, disabled, onCommit }: SliderNumberProps) {
  const shownStep = clean(step * scale)
  const shown = (v: number) => Number((v * scale).toFixed(decimals(shownStep)))
  return (
    <span className="slider-number">
      <NumberField
        value={shown(value)}
        min={clean(min * scale)}
        max={clean(max * scale)}
        step={shownStep}
        disabled={disabled}
        aria-label={unit ? `${label} (${unit})` : label}
        onCommit={(v) => onCommit(Number((v / scale).toFixed(decimals(step))))}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  )
}
