import type { ReactNode } from 'react'
import {
  SLIDER_RANGES,
  TYPOGRAPHY_RANGES,
  type SliderCurve,
  type SliderId,
  type SliderRange,
  type TypographySliderId,
} from '../state/sliderScales'
import { HintButton, HintText, useHint, type HintState } from './Hint'
import LiveMarker from './LiveMarker'
import NumberField from './NumberField'
import SliderNumber, { boxLabel, scaledBox } from './SliderNumber'

export type SliderFieldProps = {
  id: string
  label: string
  value: number
  /** What the number box shows per unit of the value: 100 for a share shown in percent. Defaults to 1. */
  scale?: number
  /** Unit shown after the number box, such as "%" or "°". */
  unit?: string
  /** Spoken value, for example "4 percent of the width". */
  valueText?: string
  /** Explanation behind an ⓘ button, under the slider; leave it out when the label says enough. */
  hint?: ReactNode
  /** The explanation's open state, for one that outlives its slider (a slider that comes and goes with a mode). */
  hintState?: HintState
  disabled?: boolean
  /**
   * Where the number box sits: in the field's head, where a readout would be (Geometry and Experimental), or in a
   * row after the slider, with its unit in a column of its own (Typography).
   */
  layout?: 'head' | 'row'
  /** More controls under the slider, above the explanation (Squaring's presets). */
  children?: ReactNode
  onChange: (value: number) => void
} &
  /** A linear slider, by its Sound target id: its range (SLIDER_RANGES, TYPOGRAPHY_RANGES) and its live marker. */
  (
    | { target: SliderId | TypographySliderId; curve?: undefined }
    /** A curved slider (Tolerance, Reach): its Sound target, for the live marker, and its curve. */
    | { target: string; curve: SliderCurve }
  )

const linearRange = (target: SliderId | TypographySliderId): SliderRange =>
  Object.hasOwn(TYPOGRAPHY_RANGES, target)
    ? TYPOGRAPHY_RANGES[target as TypographySliderId]
    : SLIDER_RANGES[target as SliderId]

/**
 * Every slider in the panels: a label (with an ⓘ button when there is an explanation), the range input with its
 * live marker while Sound drives it, and a number box for exact values, committed on Enter or blur (NumberField).
 * The range comes from src/state/sliderScales.ts, by the slider's Sound target; a curved slider maps its value to
 * a position on the range input and back, while its number box takes the value itself.
 */
export default function SliderField(props: SliderFieldProps) {
  const {
    id,
    target,
    curve,
    label,
    value,
    scale,
    unit,
    valueText,
    hint,
    disabled,
    layout = 'head',
    children,
    onChange,
  } = props
  const ownHint = useHint()
  const help = props.hintState ?? ownHint
  const slider = curve ? curve.slider : linearRange(target as SliderId | TypographySliderId)
  const box = curve ? curve.value : slider
  const title = (
    <span className="field-title">
      <label htmlFor={id}>{label}</label>
      {hint && <HintButton hint={help} topic={label} />}
    </span>
  )
  const range = (
    <span className="live-slider">
      <input
        id={id}
        type="range"
        {...slider}
        value={curve ? curve.toSlider(value) : value}
        disabled={disabled}
        aria-valuetext={valueText}
        aria-describedby={hint ? help.id : undefined}
        onChange={(e) => onChange(curve ? curve.fromSlider(Number(e.target.value)) : Number(e.target.value))}
      />
      <LiveMarker target={target} />
    </span>
  )
  const explanation = hint && <HintText hint={help}>{hint}</HintText>

  if (layout === 'row') {
    return (
      <div className="field slider-field">
        {title}
        <div className="slider-row">
          {range}
          <NumberField
            {...scaledBox(value, box, scale, onChange)}
            disabled={disabled}
            aria-label={boxLabel(label, unit)}
          />
          {unit && <span className="unit slider-unit">{unit}</span>}
        </div>
        {children}
        {explanation}
      </div>
    )
  }
  return (
    <div className="field">
      <div className="field-head">
        {title}
        <SliderNumber
          {...box}
          value={value}
          scale={scale}
          unit={unit}
          label={label}
          disabled={disabled}
          onCommit={onChange}
        />
      </div>
      {range}
      {children}
      {explanation}
    </div>
  )
}
