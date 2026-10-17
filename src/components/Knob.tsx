import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { undoHistory } from '../state/history'
import { HintButton, type HintState } from './Hint'
import NumberField, { decimals } from './NumberField'

/** The knob's sweep: from −135° (min) to +135° (max), 0° pointing up. */
export const KNOB_SWEEP = 135
/** Ticks in the ring around the body, evenly spread over the sweep (odd, so one sits at the top for bipolar knobs). */
export const KNOB_TICKS = 21
/** Sides of the body: a polygon, so nothing on the knob reads as a curve. */
const BODY_SIDES = 12
/** A drag of this many pixels sweeps the whole range; Shift makes it ten times finer. */
const DRAG_PIXELS = 160
const FINE = 10
/** PageUp and PageDown move a tenth of the range (at least one step), as on a range input. */
const PAGE_SHARE = 0.1

/** `value` clamped to [min, max] and rounded to the step (counted from min), without floating-point noise. */
export function snapKnob(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value))
  const snapped = min + Math.round((clamped - min) / step) * step
  return Number(Math.min(max, snapped).toFixed(decimals(step)))
}

/** The pointer's angle in degrees for `value`: −135 at min, +135 at max. */
export function knobAngle(value: number, min: number, max: number): number {
  const share = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0
  return -KNOB_SWEEP + share * 2 * KNOB_SWEEP
}

const tickAngles = Array.from({ length: KNOB_TICKS }, (_, i) => -KNOB_SWEEP + (i * 2 * KNOB_SWEEP) / (KNOB_TICKS - 1))

/**
 * Which ticks are lit for `value`, by index: from the first tick up to the value, or for a bipolar knob from
 * the centre tick (the value 0) towards it. A tick is lit once the value reaches it, so the min (or 0)
 * lights only the tick it sits on.
 */
export function litTicks(value: number, min: number, max: number, bipolar = false): boolean[] {
  const angle = knobAngle(value, min, max)
  const origin = bipolar ? knobAngle(0, min, max) : -KNOB_SWEEP
  const low = Math.min(angle, origin)
  const high = Math.max(angle, origin)
  // Half a degree of slack absorbs rounding at the ends.
  return tickAngles.map((a) => a >= low - 0.5 && a <= high + 0.5)
}

/** A point at `radius` and `angle` (degrees, 0 up, clockwise), in the knob's −50…50 view box. */
const polar = (radius: number, angle: number) => {
  const a = (angle * Math.PI) / 180
  return { x: radius * Math.sin(a), y: -radius * Math.cos(a) }
}

const fixed = (n: number) => n.toFixed(2)

const BODY = Array.from({ length: BODY_SIDES }, (_, i) => {
  const { x, y } = polar(30, (i + 0.5) * (360 / BODY_SIDES))
  return `${fixed(x)},${fixed(y)}`
}).join(' ')

const TICKS = tickAngles.map((angle) => {
  const a = polar(37, angle)
  const b = polar(46, angle)
  return { x1: fixed(a.x), y1: fixed(a.y), x2: fixed(b.x), y2: fixed(b.y) }
})

export interface KnobProps {
  /** The visible label under the knob; also its accessible name unless `name` is given. */
  label: string
  /** The accessible name when it says more than the label ("Depth, mapping 2"); it should contain the label. */
  name?: string
  /** Hides the label (a small knob in a row that names it elsewhere); `name` or `label` still names it. */
  hideLabel?: boolean
  value: number
  min: number
  max: number
  step: number
  /** What a double-click puts back. */
  defaultValue: number
  /** The readout under the knob ("+6 dB", "150 ms", "−40%"). */
  format: (value: number) => string
  /** The value for screen readers ("6 decibels"). */
  valueText: string
  /** Unit after the box while the value is typed ("dB", "%"). */
  unit?: string
  /** Lights the ring from the centre (0): in the primary colour above it, the warning colour below. */
  bipolar?: boolean
  size?: 'regular' | 'small'
  /** The ⓘ button beside the label; its explanation describes the knob. */
  hint?: HintState
  /** More ids that describe the knob (notes under it). */
  describedBy?: string
  /** A tooltip on the knob (the small knob's name, as it has no visible label). */
  title?: string
  /** Called with a value on the step, inside [min, max], whenever it changes. */
  onChange: (value: number) => void
}

/**
 * A rotary knob (a slider): a 12-sided body, a ring of straight ticks lit up to the value, and a straight
 * pointer. Drag up or down to turn it (Shift for fine), use the arrow keys, PageUp and PageDown, Home and End,
 * or press Enter (or click the value) to type an exact number; a double-click puts back the default. A drag
 * or a held key is one undo step, as with the sliders: the history closes a step on pointer and key up.
 */
export default function Knob({
  label,
  name,
  hideLabel = false,
  value,
  min,
  max,
  step,
  defaultValue,
  format,
  valueText,
  unit,
  bipolar = false,
  size = 'regular',
  hint,
  describedBy,
  title,
  onChange,
}: KnobProps) {
  const id = useId()
  const dial = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; y: number; raw: number } | null>(null)
  const [editing, setEditing] = useState(false)
  // After typing, focus goes back to the knob once the new value has rendered, so the box's blur commits nothing twice.
  const refocus = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(refocus.current), [])

  const set = (next: number) => {
    const snapped = snapKnob(next, min, max, step)
    if (snapped !== value) onChange(snapped)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pointer: e.pointerId, y: e.clientY, raw: value }
    // No text selection while turning.
    e.preventDefault()
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    // Counted from the last move, so pressing or releasing Shift mid-drag does not make the value jump.
    const perPixel = (max - min) / DRAG_PIXELS / (e.shiftKey ? FINE : 1)
    d.raw = Math.min(max, Math.max(min, d.raw + (d.y - e.clientY) * perPixel))
    d.y = e.clientY
    set(d.raw)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === e.pointerId) drag.current = null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(step, (max - min) * PAGE_SHARE)
    const moves: Partial<Record<string, number>> = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + page,
      PageDown: value - page,
      Home: min,
      End: max,
    }
    const next = moves[e.key]
    if (next !== undefined) {
      e.preventDefault()
      set(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      setEditing(true)
    }
  }

  /** Enter or Escape in the box: back to the knob; the box's blur then commits (or not) and closes it. */
  const backToDial = () => {
    clearTimeout(refocus.current)
    refocus.current = setTimeout(() => dial.current?.focus())
  }

  const angle = knobAngle(value, min, max)
  const lit = litTicks(value, min, max, bipolar)
  const tip = polar(25, angle)
  const tail = polar(9, angle)
  const labelled = !name && !hideLabel
  const accessibleName = name ?? label

  return (
    <div className={`knob knob-${size}`} data-negative={(bipolar && value < 0) || undefined}>
      <div
        ref={dial}
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={labelled ? undefined : accessibleName}
        aria-labelledby={labelled ? `${id}-label` : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-describedby={[hint?.id, describedBy].filter(Boolean).join(' ') || undefined}
        aria-keyshortcuts="Enter"
        title={title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        // The double-click comes after the last pointer up, so the reset closes its own step: a drag or arrow
        // key that follows is a step of its own.
        onDoubleClick={() => {
          set(defaultValue)
          undoHistory.endGesture()
        }}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
          {TICKS.map((t, i) => (
            <line key={i} className={lit[i] ? 'knob-tick knob-tick-lit' : 'knob-tick'} {...t} />
          ))}
          <polygon className="knob-body" points={BODY} />
          <line className="knob-pointer" x1={fixed(tail.x)} y1={fixed(tail.y)} x2={fixed(tip.x)} y2={fixed(tip.y)} />
        </svg>
      </div>
      {editing ? (
        // The value being typed: committed on Enter or on leaving the box (NumberField).
        <span
          className="knob-value slider-number"
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') backToDial()
          }}
        >
          <NumberField
            value={value}
            min={min}
            max={max}
            step={step}
            autoFocus
            aria-label={unit ? `${accessibleName} (${unit})` : accessibleName}
            onCommit={set}
          />
          {unit && <span className="unit">{unit}</span>}
        </span>
      ) : (
        // Not a button: on the keyboard, Enter on the knob opens the same box, and the knob reads out the value.
        <span className="knob-value" aria-hidden="true" title="Type a value" onClick={() => setEditing(true)}>
          {format(value)}
        </span>
      )}
      {!hideLabel && (
        <span className="knob-label field-title">
          <span id={`${id}-label`}>{label}</span>
          {hint && <HintButton hint={hint} topic={accessibleName} />}
        </span>
      )}
    </div>
  )
}
