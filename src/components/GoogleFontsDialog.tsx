import { useEffect, useMemo, useRef, useState } from 'react'
import { errorKindLabel, isAbortError, toFontLoadError, type FontLoadError } from '../font/errors'
import {
  curatedFamilies,
  defaultSubset,
  defaultWeight,
  fetchGoogleFamily,
  type GoogleFamilyInfo,
  type GoogleFontRequest,
} from '../font/google'

interface GoogleFontsDialogProps {
  open: boolean
  onClose: () => void
  onLoad: (request: GoogleFontRequest) => void
}

type FamilyState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; info: GoogleFamilyInfo }
  | { kind: 'error'; error: FontLoadError }

export default function GoogleFontsDialog({ open, onClose, onLoad }: GoogleFontsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [familyState, setFamilyState] = useState<FamilyState>({ kind: 'idle' })
  const [italic, setItalic] = useState(false)
  const [weight, setWeight] = useState(400)
  const [subset, setSubset] = useState('latin')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // showModal() focuses the first focusable element (the close button); start in the search field.
      searchRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Look up the family's styles whenever the selection changes; abort the previous lookup.
  useEffect(() => {
    if (!family) {
      setFamilyState({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    setFamilyState({ kind: 'loading' })
    fetchGoogleFamily(family, controller.signal).then(
      (info) => {
        const hasNormal = info.weights.normal.length > 0
        setItalic(!hasNormal)
        setWeight(defaultWeight(hasNormal ? info.weights.normal : info.weights.italic))
        setSubset(defaultSubset(info))
        setFamilyState({ kind: 'ready', info })
      },
      (error) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setFamilyState({ kind: 'error', error: toFontLoadError(error, 'network') })
      },
    )
    return () => controller.abort()
  }, [family, attempt])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? curatedFamilies.filter((f) => f.family.toLowerCase().includes(q)) : curatedFamilies
  }, [query])
  const typed = query.trim()
  const typedIsCurated = curatedFamilies.some((f) => f.family.toLowerCase() === typed.toLowerCase())

  const info = familyState.kind === 'ready' ? familyState.info : null
  const styleWeights = info ? (italic ? info.weights.italic : info.weights.normal) : []
  const canLoad = info !== null && styleWeights.includes(weight)

  const changeItalic = (next: boolean) => {
    setItalic(next)
    if (info) {
      const weights = next ? info.weights.italic : info.weights.normal
      if (!weights.includes(weight)) setWeight(defaultWeight(weights))
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="gf-dialog"
      aria-labelledby="gf-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <form
        method="dialog"
        className="gf-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canLoad || !family) return
          onLoad({ family, weight, italic, subset })
          onClose()
        }}
      >
        <header className="gf-head">
          <h2 id="gf-title">Google Fonts</h2>
          <button type="button" className="button-small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="gf-intro">
          Downloads the font file so its real outlines can be edited — a CSS preview alone has no outline data. Browse
          the curated list or type any family name exactly as it appears on fonts.google.com. The full catalog needs an
          API key, so it is not searchable here.
        </p>

        <div className="gf-columns">
          <div className="gf-families">
            <label htmlFor="gf-search">Family</label>
            <input
              id="gf-search"
              type="search"
              placeholder="Search or type a family name"
              value={query}
              autoComplete="off"
              ref={searchRef}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="gf-list" aria-label="Families">
              {matches.map((f) => (
                <li key={f.family}>
                  <button
                    type="button"
                    className="gf-family"
                    aria-pressed={family === f.family}
                    onClick={() => setFamily(f.family)}
                  >
                    {f.family}
                    <span className="gf-category">{f.category}</span>
                  </button>
                </li>
              ))}
              {typed && !typedIsCurated && (
                <li>
                  <button
                    type="button"
                    className="gf-family"
                    aria-pressed={family === typed}
                    onClick={() => setFamily(typed)}
                  >
                    Use “{typed}”<span className="gf-category">Custom</span>
                  </button>
                </li>
              )}
            </ul>
          </div>

          <div className="gf-styles" aria-live="polite">
            {familyState.kind === 'idle' && <p className="gf-placeholder">Choose a family to see its styles.</p>}

            {familyState.kind === 'loading' && (
              <p className="gf-placeholder">
                <span className="spinner" aria-hidden="true" />
                Looking up {family}…
              </p>
            )}

            {familyState.kind === 'error' && (
              <div className="font-error" role="alert">
                <p className="font-error-kind">{errorKindLabel[familyState.error.kind]}</p>
                <p>{familyState.error.message}</p>
                <button type="button" className="button-small" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </button>
              </div>
            )}

            {info && (
              <>
                <p className="gf-selected">{info.family}</p>
                {info.variable && (
                  <p className="font-warning">
                    Variable font: all weights share one file. The outlines show the font's default instance, so
                    weight selection is disabled. Its axes are listed after loading.
                  </p>
                )}
                <div className="field">
                  <label htmlFor="gf-weight">Weight</label>
                  <select
                    id="gf-weight"
                    value={weight}
                    disabled={info.variable}
                    onChange={(e) => setWeight(Number(e.target.value))}
                  >
                    {styleWeights.map((w) => (
                      <option key={w} value={w}>
                        {info.variable ? 'Default instance' : w}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field field-toggle">
                  <input
                    id="gf-italic"
                    type="checkbox"
                    checked={italic}
                    disabled={info.weights.italic.length === 0 || info.weights.normal.length === 0}
                    onChange={(e) => changeItalic(e.target.checked)}
                  />
                  <label htmlFor="gf-italic">
                    Italic{info.weights.italic.length === 0 ? ' (not available)' : ''}
                  </label>
                </div>
                <div className="field">
                  <label htmlFor="gf-subset">Character subset</label>
                  <select id="gf-subset" value={subset} onChange={(e) => setSubset(e.target.value)}>
                    {info.subsets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">Google serves each subset as a separate file; one subset is loaded.</p>
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="gf-foot">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!canLoad}>
            Load font
          </button>
        </footer>
      </form>
    </dialog>
  )
}
