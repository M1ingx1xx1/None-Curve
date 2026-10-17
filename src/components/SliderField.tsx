import type { ReactNode } from 'react'
import { HintButton, HintText, useHint } from './Hint'
import LiveMarker from './LiveMarker'
import NumberField from './NumberField'

interface SliderFieldProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Unit shown after the number box, such as "%" or "°". */
  unit?: string
  /** Spoken value, for example "4 percent of the width". */
  valueText?: string
  /** Explanation behind an ⓘ button; leave it out when the label says enough. */
  hint?: ReactNode
  disabled?: boolean
  /** The Sound target this slider is (e.g. "typography.size"): its live marker shows while Sound drives it. */
  target?: string
  onChange: (value: number) => void
}

/** A labelled slider with a number box beside it for exact values, and an optional folded explanation. */
export default function SliderField({ id, label, value, min, max, step, unit, valueText, hint, disabled, target, onChange }: SliderFieldProps) {
  const help = useHint()
  const range = (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-valuetext={valueText}
      aria-describedby={hint ? help.id : undefined}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
  return (
    <div className="field slider-field">
      <span className="field-title">
        <label htmlFor={id}>{label}</label>
        {hint && <HintButton hint={help} topic={label} />}
      </span>
      <div className="slider-row">
        {target ? (
          <span className="live-slider">
            {range}
            <LiveMarker target={target} />
          </span>
        ) : (
          range
        )}
        <NumberField
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={`${label}${unit ? ` (${unit})` : ''}`}
          onCommit={onChange}
        />
        {unit && <span className="unit slider-unit">{unit}</span>}
      </div>
      {hint && <HintText hint={help}>{hint}</HintText>}
    </div>
  )
}
