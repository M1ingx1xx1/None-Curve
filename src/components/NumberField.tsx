import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react'

interface NumberFieldProps {
  id?: string
  value: number
  min: number
  max: number
  step: number
  /** Called with a valid, clamped value when the field is committed (Enter or leaving the field). */
  onCommit: (value: number) => void
  disabled?: boolean
  /** Focuses the box when it appears (a knob's value opened for typing). */
  autoFocus?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
}

/** Decimals of a number as written ("0.05" → 2). */
export const decimals = (n: number) => (String(n).split('.')[1] ?? '').length

/** Characters of the widest value the box can hold ("-100", "359", "0.01"), which sizes it (`--chars` in styles.css). */
export function widestChars(min: number, max: number, step: number): number {
  const d = decimals(step)
  return Math.max(min.toFixed(d).length, max.toFixed(d).length)
}

/**
 * A number box that lets the user type freely (no clamping in the middle of typing) and commits on
 * Enter or blur, clamped to [min, max] and rounded to the step. Escape restores the current value.
 */
export default function NumberField({ id, value, min, max, step, onCommit, disabled, autoFocus, ...aria }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])

  const commit = () => {
    setEditing(false)
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || draft.trim() === '') {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    const rounded = Number((Math.round(clamped / step) * step).toFixed(decimals(step)))
    setDraft(String(rounded))
    if (rounded !== value) onCommit(rounded)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') {
      setEditing(false)
      setDraft(String(value))
    }
  }

  return (
    <input
      id={id}
      className="number-field"
      style={{ '--chars': widestChars(min, max, step) } as CSSProperties}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true)
        setDraft(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      {...aria}
    />
  )
}
