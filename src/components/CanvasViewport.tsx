import { useCallback, useMemo, useState, type DragEvent } from 'react'
import { formatCodePoint, glyphLabel } from '../font/model'
import type { SourceGlyph } from '../geometry/types'
import type { DocumentState, ViewParams } from '../state/types'
import ErrorBoundary from './ErrorBoundary'
import FileDropTarget from './FileDropTarget'
import GlyphView, { MAX_ZOOM, MIN_ZOOM } from './GlyphView'

interface CanvasViewportProps {
  document: DocumentState
  view: ViewParams
  onViewChange: (patch: Partial<ViewParams>) => void
  onResetView: () => void
  onLocalFile: (file: File) => void
  onOpenGoogleFonts: () => void
}

type GlyphResult = { glyph: SourceGlyph; error: null } | { glyph: null; error: string } | null

const toggles: { key: 'showFill' | 'showSkeleton' | 'showMetrics'; label: string }[] = [
  { key: 'showFill', label: 'Fill' },
  { key: 'showSkeleton', label: 'Skeleton' },
  { key: 'showMetrics', label: 'Metrics' },
]

export default function CanvasViewport({
  document,
  view,
  onViewChange,
  onResetView,
  onLocalFile,
  onOpenGoogleFonts,
}: CanvasViewportProps) {
  const { font, selectedGlyph } = document
  const [dragging, setDragging] = useState(false)

  const result: GlyphResult = useMemo(() => {
    if (!font || !selectedGlyph) return null
    try {
      return { glyph: font.getGlyph(selectedGlyph.index), error: null }
    } catch (error) {
      return { glyph: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [font, selectedGlyph])

  const glyph = result?.glyph ?? null
  const interactive = glyph !== null
  const zoomBy = (factor: number) => onViewChange({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor)) })

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }, [])
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onLocalFile(file)
  }

  let label = ''
  if (selectedGlyph) {
    const code = selectedGlyph.unicode !== null ? ` ${formatCodePoint(selectedGlyph.unicode)}` : ''
    label = `Glyph ${glyphLabel(selectedGlyph)}${code}`
  }

  return (
    <section
      className="viewport"
      aria-label="Glyph canvas"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="viewport-toolbar" role="toolbar" aria-label="View">
        <div className="segmented" role="group" aria-label="Layers">
          {toggles.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              disabled={!interactive}
              aria-pressed={view[key]}
              onClick={() => onViewChange({ [key]: !view[key] })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" disabled={!interactive} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
            −
          </button>
          <output className="zoom-value" aria-label="Zoom level">
            {Math.round(view.zoom * 100)}%
          </output>
          <button type="button" disabled={!interactive} aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
            +
          </button>
          <button type="button" disabled={!interactive} onClick={onResetView}>
            Fit
          </button>
        </div>
      </div>

      <div className="canvas">
        {glyph && font ? (
          <ErrorBoundary resetKey={`${font.id}:${selectedGlyph?.index}`} label="The canvas">
            <GlyphView glyph={glyph} fontMetrics={font.metrics} view={view} label={label} onViewChange={onViewChange} />
            {glyph.contours.length === 0 && (
              <p className="canvas-note">This glyph has no outline (for example, a space). Metrics are still shown.</p>
            )}
            {view.showSkeleton && glyph.contours.length > 0 && (
              <ul className="skeleton-legend" aria-label="Skeleton legend">
                <li>
                  <span className="legend-anchor" aria-hidden="true" /> On-curve anchor
                </li>
                <li>
                  <span className="legend-control" aria-hidden="true" /> Off-curve control
                </li>
                <li>
                  <span className="legend-handle" aria-hidden="true" /> Handle
                </li>
              </ul>
            )}
          </ErrorBoundary>
        ) : (
          <div className="canvas-empty">
            {!font && <FileDropTarget onLocalFile={onLocalFile} onOpenGoogleFonts={onOpenGoogleFonts} />}
            {font && !selectedGlyph && <p className="canvas-message">Select a glyph on the left to preview it.</p>}
            {font && result?.error && (
              <p className="canvas-message" role="alert">
                This glyph could not be read: {result.error}
              </p>
            )}
          </div>
        )}
        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            Drop to import
          </div>
        )}
      </div>
    </section>
  )
}
