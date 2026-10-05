import { useEffect, useState, type KeyboardEvent } from 'react'

interface NumberFieldProps {
  id?: string
  value: number
  min: number
  max: number
  step: number
  /** Called with a valid, clamped value when the field is committed (Enter or leaving the field). */
  onCommit: (value: number) => void
  disabled?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
}

/**
 * A number box that lets the user type freely (no clamping in the middle of typing) and commits on
 * Enter or blur, clamped to [min, max] and rounded to the step. Escape restores the current value.
 */
export default function NumberField({ id, value, min, max, step, onCommit, disabled, ...aria }: NumberFieldProps) {
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
    const decimals = (String(step).split('.')[1] ?? '').length
    const clamped = Math.min(max, Math.max(min, parsed))
    const rounded = Number((Math.round(clamped / step) * step).toFixed(decimals))
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
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
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
