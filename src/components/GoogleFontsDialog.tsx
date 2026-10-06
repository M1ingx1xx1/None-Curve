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
import { looksLikeUrl, parseFontInput, type ParsedFontRequest } from '../font/googleUrl'
import Icon from './Icon'

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
  /** What a pasted URL or typed name asked for; null when a curated family was clicked. */
  const [requested, setRequested] = useState<ParsedFontRequest | null>(null)
  /** Explains when the requested style could not be loaded as asked. */
  const [styleNote, setStyleNote] = useState<string | null>(null)

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
        const wantItalic = requested?.italic ?? false
        const useItalic = (wantItalic && info.weights.italic.length > 0) || !hasNormal
        const weights = useItalic ? info.weights.italic : info.weights.normal
        const fallbackWeight = defaultWeight(weights)
        // A variable family serves one file for every weight, so a requested weight cannot be applied.
        const useWeight =
          !info.variable && requested?.weight && weights.includes(requested.weight) ? requested.weight : fallbackWeight
        let note: string | null = null
        if (requested && (requested.weight !== null || requested.italic !== null)) {
          const asked = `${requested.weight ?? ''}${requested.italic ? ' italic' : ''}`.trim() || 'regular'
          const actual = info.variable ? `the default instance${useItalic ? ' (italic)' : ''}` : `${useWeight}${useItalic ? ' italic' : ''}`
          const matched = !info.variable && (requested.weight === null || requested.weight === useWeight) && (requested.italic === null || requested.italic === useItalic)
          if (!matched) note = `The URL asks for ${asked}${info.variable ? ', but this is a variable font' : ', which this family does not have'}; ${actual} will be loaded.`
        }
        setItalic(useItalic)
        setWeight(useWeight)
        setStyleNote(note)
        setSubset(defaultSubset(info))
        setFamilyState({ kind: 'ready', info })
      },
      (error) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setFamilyState({ kind: 'error', error: toFontLoadError(error, 'network') })
      },
    )
    return () => controller.abort()
  }, [family, attempt, requested])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? curatedFamilies.filter((f) => f.family.toLowerCase().includes(q)) : curatedFamilies
  }, [query])
  const typed = query.trim()
  const typedIsUrl = looksLikeUrl(typed)
  const parsed = useMemo(() => (typed ? parseFontInput(typed) : null), [typed])
  const typedIsCurated = !typedIsUrl && curatedFamilies.some((f) => f.family.toLowerCase() === typed.toLowerCase())

  const chooseCurated = (name: string) => {
    setRequested(null)
    setStyleNote(null)
    setFamily(name)
  }
  const chooseParsed = (request: ParsedFontRequest) => {
    setRequested(request)
    setFamily(request.family)
  }

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
            <Icon name="close" />
          </button>
        </header>

        <p className="gf-intro">
          Downloads the font file so its real outlines can be edited — a CSS preview alone has no outline data. Browse
          the curated list, type any family name exactly as it appears on fonts.google.com, or paste a Google Fonts URL
          (fonts.google.com/specimen/… or fonts.googleapis.com/css2?family=…). The full catalog needs an API key, so it is
          not searchable here.
        </p>

        <div className="gf-columns">
          <div className="gf-families">
            <label htmlFor="gf-search">Family</label>
            <input
              id="gf-search"
              type="search"
              placeholder="Search, family name, or Google Fonts URL"
              value={query}
              autoComplete="off"
              spellCheck={false}
              ref={searchRef}
              aria-describedby="gf-search-hint"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter on a pasted URL or typed name selects it instead of submitting the form.
                if (e.key === 'Enter' && typed && !typedIsCurated && parsed?.ok) {
                  e.preventDefault()
                  chooseParsed(parsed.request)
                }
              }}
            />
            <p id="gf-search-hint" className="field-hint">
              Accepts https://fonts.google.com/specimen/Name and https://fonts.googleapis.com/css2?family=… links. Other
              sites are not contacted.
            </p>
            {typedIsUrl && parsed && !parsed.ok && (
              <p className="font-warning" role="alert">
                {parsed.error}
              </p>
            )}
            <ul className="gf-list" aria-label="Families">
              {typedIsUrl && parsed?.ok && (
                <li>
                  <button
                    type="button"
                    className="gf-family"
                    aria-pressed={family === parsed.request.family && requested !== null}
                    onClick={() => chooseParsed(parsed.request)}
                  >
                    Use “{parsed.request.family}” from URL<span className="gf-category">URL</span>
                  </button>
                </li>
              )}
              {!typedIsUrl && matches.map((f) => (
                <li key={f.family}>
                  <button
                    type="button"
                    className="gf-family"
                    aria-pressed={family === f.family}
                    onClick={() => chooseCurated(f.family)}
                  >
                    {f.family}
                    <span className="gf-category">{f.category}</span>
                  </button>
                </li>
              ))}
              {typed && !typedIsUrl && !typedIsCurated && parsed?.ok && (
                <li>
                  <button
                    type="button"
                    className="gf-family"
                    aria-pressed={family === parsed.request.family}
                    onClick={() => chooseParsed(parsed.request)}
                  >
                    Use “{parsed.request.family}”<span className="gf-category">Custom</span>
                  </button>
                </li>
              )}
              {typed && !typedIsUrl && parsed && !parsed.ok && (
                <li className="gf-invalid">{parsed.error}</li>
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
                  <Icon name="retry" />
                  Retry
                </button>
              </div>
            )}

            {info && (
              <>
                <p className="gf-selected">{info.family}</p>
                {requested && requested.source !== 'name' && (
                  <p className="field-hint">
                    From {requested.source === 'specimen' ? 'a specimen page' : 'a CSS API'} URL. The font file is still
                    downloaded and parsed before it can be edited.
                  </p>
                )}
                {requested && requested.unsupportedAxes.length > 0 && (
                  <p className="font-warning">
                    The URL sets axes this app cannot apply ({requested.unsupportedAxes.join(', ')}). They are ignored and
                    the font’s default instance is loaded.
                  </p>
                )}
                {requested?.notes.map((note) => (
                  <p key={note} className="field-hint">
                    {note}
                  </p>
                ))}
                {styleNote && <p className="font-warning">{styleNote}</p>}
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
            <Icon name="download" />
            Load font
          </button>
        </footer>
      </form>
    </dialog>
  )
}
