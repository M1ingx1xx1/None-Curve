import { memo, Suspense, useEffect, useRef, useState } from 'react'
import type { FontNaming, GlyphSet } from '../export/fontPlan'
import type { BuiltFont, ExportDialogProps, Format, Kept } from './ExportBody'
import ErrorBoundary from './ErrorBoundary'
import Icon from './Icon'
import { lazyWithRetry } from './lazyWithRetry'

// The body and the export code load on the first opening, not with the page.
const ExportBody = lazyWithRetry(() => import('./ExportBody'))

/**
 * The dialog's shell stays mounted (showModal keeps its focus handling); its body, which plans the font export, follows
 * the geometry results and describes the pipeline, is mounted only while it is open, so a closed dialog does no work.
 */
function ExportDialog(props: ExportDialogProps) {
  const { open, onClose, font, openOn } = props
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const [chosen, setFormat] = useState<Format>('svg')
  // Off by default: exports show the main view; ticked, they carry the preview's blur and inversion.
  const [usePreviewLook, setUsePreviewLook] = useState(false)
  const [glyphSet, setGlyphSet] = useState<GlyphSet>('specimen')
  const [naming, setNaming] = useState<FontNaming>({ familyName: '', styleName: '' })
  const [built, setBuilt] = useState<BuiltFont | null>(null)
  // Empty: each export's generated name.
  const [fileName, setFileName] = useState('')
  const kept: Kept = {
    chosen,
    setFormat,
    usePreviewLook,
    setUsePreviewLook,
    glyphSet,
    setGlyphSet,
    naming,
    setNaming,
    built,
    setBuilt,
    fileName,
    setFileName,
  }

  // After the body's own effects: the first radio is in the document when it is focused.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (openOn) setFormat(openOn)
      dialog.showModal()
      firstRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open, openOn])

  // New font: suggest a derived name (many licenses require renaming modified fonts).
  useEffect(() => {
    // A leading dot (Apple's hidden system fonts) would hide the exported font from font menus too.
    if (font)
      setNaming({
        familyName:
          `${font.familyName} Poly`
            .replace(/[^\x20-\x7E]/g, '')
            .replace(/^\.+/, '')
            .slice(0, 63)
            .trim() || 'None Curve Poly',
        styleName:
          (font.styleName || 'Regular')
            .replace(/[^\x20-\x7E]/g, '')
            .slice(0, 63)
            .trim() || 'Regular',
      })
  }, [font])

  // Closing unmounts the body, which aborts a running build.
  return (
    <dialog
      ref={dialogRef}
      className="gf-dialog export-dialog"
      aria-labelledby="export-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="gf-body">
        <header className="gf-head">
          <h2 id="export-title">Export</h2>
          <button type="button" className="button-small" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        {open && (
          <ErrorBoundary resetKey={font?.id ?? ''} label="The export options">
            <Suspense fallback={<p className="field-hint">Loading export options…</p>}>
              <ExportBody {...props} kept={kept} firstRef={firstRef} />
            </Suspense>
          </ErrorBoundary>
        )}

        <footer className="gf-foot">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </dialog>
  )
}

export default memo(ExportDialog)
