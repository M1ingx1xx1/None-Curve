import type { ReactNode } from 'react'
import { HintButton, HintText, useHint } from './Hint'
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
  /** Explanation behind the ⓘ button. */
  hint: ReactNode
  disabled?: boolean
  onChange: (value: number) => void
}

/** A labelled slider with a number box beside it for exact values, and a folded explanation. */
export default function SliderField({ id, label, value, min, max, step, unit, valueText, hint, disabled, onChange }: SliderFieldProps) {
  const help = useHint()
  return (
    <div className="field slider-field">
      <span className="field-title">
        <label htmlFor={id}>{label}</label>
        <HintButton hint={help} topic={label} />
      </span>
      <div className="slider-row">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={valueText}
          aria-describedby={help.id}
          onChange={(e) => onChange(Number(e.target.value))}
        />
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
      <HintText hint={help}>{hint}</HintText>
    </div>
  )
}
