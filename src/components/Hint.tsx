import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react'

/** True when "Show all explanations" is on (a checkbox in the geometry panel; it applies everywhere). */
export const HintsContext = createContext(false)

const SHOW_ALL_KEY = 'none-curve:show-explanations'

/** The "Show all explanations" setting, remembered per browser. */
export function useShowAllHints(): [boolean, (showAll: boolean) => void] {
  const [showAll, setShowAll] = useState(() => {
    try {
      return localStorage.getItem(SHOW_ALL_KEY) === 'true'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_ALL_KEY, String(showAll))
    } catch {
      // Not remembered; the setting still works for this visit.
    }
  }, [showAll])
  return [showAll, setShowAll]
}

export interface HintState {
  id: string
  open: boolean
  toggle: () => void
}

/**
 * One collapsible explanation: an ⓘ button next to a control's label and the text below the control.
 * Explanations start closed; "Show all explanations" opens (or closes) every one, after which each can
 * still be toggled on its own.
 */
export function useHint(): HintState {
  const showAll = useContext(HintsContext)
  const [open, setOpen] = useState(showAll)
  useEffect(() => setOpen(showAll), [showAll])
  const id = useId()
  return { id, open, toggle: () => setOpen((o) => !o) }
}

/** The ⓘ button. `topic` names the control for screen readers ("About Tolerance"). */
export function HintButton({ hint, topic }: { hint: HintState; topic: string }) {
  return (
    <button
      type="button"
      className="hint-button"
      aria-expanded={hint.open}
      aria-controls={hint.id}
      aria-label={`About ${topic}`}
      title={hint.open ? 'Hide explanation' : 'Show explanation'}
      onClick={hint.toggle}
    >
      {'ⓘ'}
    </button>
  )
}

/**
 * The explanation itself. It stays in the document while closed (only hidden), so controls that
 * reference it with aria-describedby keep their description for screen readers.
 */
export function HintText({ hint, children }: { hint: HintState; children: ReactNode }) {
  return (
    <p id={hint.id} className="field-hint hint-text" hidden={!hint.open}>
      {children}
    </p>
  )
}
