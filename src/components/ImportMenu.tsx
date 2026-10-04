import { useEffect, useId, useRef, useState } from 'react'
import LocalFileInput from './LocalFileInput'

interface ImportMenuProps {
  busy: boolean
  onLocalFile: (file: File) => void
  onOpenGoogleFonts: () => void
}

/** Primary import action at the top of the sidebar: choose a local file or Google Fonts. */
export default function ImportMenu({ busy, onLocalFile, onOpenGoogleFonts }: ImportMenuProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    firstOptionRef.current?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) toggleRef.current?.focus()
  }

  return (
    <div
      className="import"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          close(true)
        }
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        className="button-primary import-toggle"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        Import font
        <span className="chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {busy && <span className="visually-hidden">An import is in progress.</span>}

      {open && (
        <div id={menuId} className="import-options" role="group" aria-label="Font source">
          <button
            ref={firstOptionRef}
            type="button"
            className="import-option"
            onClick={() => {
              close(false)
              fileRef.current?.click()
            }}
          >
            <span className="import-option-title">Local file</span>
            <span className="import-option-hint">.ttf, .otf, .woff, .woff2 · stays in your browser</span>
          </button>
          <button
            type="button"
            className="import-option"
            onClick={() => {
              close(false)
              onOpenGoogleFonts()
            }}
          >
            <span className="import-option-title">Google Fonts</span>
            <span className="import-option-hint">Download a family's font file to edit it</span>
          </button>
        </div>
      )}

      <LocalFileInput ref={fileRef} onFile={onLocalFile} />
    </div>
  )
}
