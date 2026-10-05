import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react'

/** True when "Show all explanations" is on in the tools panel. */
export const HintsContext = createContext(false)

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
