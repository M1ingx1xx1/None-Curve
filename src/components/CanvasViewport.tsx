import { useCallback, useState, type DragEvent } from 'react'
import { formatCodePoint, glyphLabel } from '../font/model'
import type { DocumentState, OutlineView, ViewParams } from '../state/types'
import type { GlyphGeometry } from '../state/useDerivedGeometry'
import ErrorBoundary from './ErrorBoundary'
import FileDropTarget from './FileDropTarget'
import GlyphView, { MAX_ZOOM, MIN_ZOOM } from './GlyphView'

interface CanvasViewportProps {
  document: DocumentState
  view: ViewParams
  /** Snapping grid spacing to draw, or null when snapping is off. */
  gridSize: number | null
  glyphGeometry: GlyphGeometry
  onViewChange: (patch: Partial<ViewParams>) => void
  onResetView: () => void
  onLocalFile: (file: File) => void
  onOpenGoogleFonts: () => void
}

const outlineViews: { value: OutlineView; label: string; description: string }[] = [
  { value: 'source', label: 'Original', description: 'Original font curves' },
  { value: 'flattened', label: 'Flattened', description: 'Flattened polygon (straight edges only)' },
  { value: 'compare', label: 'Compare', description: 'Flattened polygon with the original curves overlaid' },
]

const toggles: { key: 'showFill' | 'showSkeleton' | 'showVertices' | 'showMetrics'; label: string }[] = [
  { key: 'showFill', label: 'Fill' },
  { key: 'showSkeleton', label: 'Skeleton' },
  { key: 'showVertices', label: 'Vertices' },
  { key: 'showMetrics', label: 'Metrics' },
]

export default function CanvasViewport({
  document,
  view,
  gridSize,
  glyphGeometry,
  onViewChange,
  onResetView,
  onLocalFile,
  onOpenGoogleFonts,
}: CanvasViewportProps) {
  const { font, selectedGlyph } = document
  const [dragging, setDragging] = useState(false)

  const ready = glyphGeometry.kind === 'ready' ? glyphGeometry : null
  const glyph = ready?.source ?? null
  const polygon = ready?.geometry?.polygon ?? null
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
    const shown = outlineViews.find((o) => o.value === view.outline)?.description ?? ''
    label = `Glyph ${glyphLabel(selectedGlyph)}${code}, ${shown}`
  }

  const hasContours = (glyph?.contours.length ?? 0) > 0
  const showsPolygon = view.outline !== 'source' || view.showVertices

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
        <div className="segmented" role="group" aria-label="Outline">
          {outlineViews.map(({ value, label, description }) => (
            <button
              key={value}
              type="button"
              disabled={!interactive}
              aria-pressed={view.outline === value}
              title={description}
              onClick={() => onViewChange({ outline: value })}
            >
              {label}
            </button>
          ))}
        </div>
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
            <GlyphView
              glyph={glyph}
              polygon={polygon}
              gridSize={gridSize}
              fontMetrics={font.metrics}
              view={view}
              label={label}
              onViewChange={onViewChange}
            />
            <p className="canvas-badge" aria-hidden="true">
              {outlineViews.find((o) => o.value === view.outline)?.description}
            </p>
            {!hasContours && (
              <p className="canvas-note">This glyph has no outline (for example, a space). Metrics are still shown.</p>
            )}
            {ready?.geometryError && showsPolygon && (
              <p className="canvas-note canvas-note-error" role="alert">
                Flattening failed: {ready.geometryError}
              </p>
            )}
            {hasContours && (view.showSkeleton || view.showVertices || view.outline === 'compare') && (
              <ul className="skeleton-legend" aria-label="Legend">
                {view.outline === 'compare' && (
                  <>
                    <li>
                      <span className="legend-polygon" aria-hidden="true" /> Flattened
                    </li>
                    <li>
                      <span className="legend-source" aria-hidden="true" /> Original
                    </li>
                  </>
                )}
                {view.showSkeleton && (
                  <>
                    <li>
                      <span className="legend-anchor" aria-hidden="true" /> On-curve anchor
                    </li>
                    <li>
                      <span className="legend-control" aria-hidden="true" /> Off-curve control
                    </li>
                    <li>
                      <span className="legend-handle" aria-hidden="true" /> Handle
                    </li>
                  </>
                )}
                {view.showVertices && (
                  <li>
                    <span className="legend-vertex" aria-hidden="true" /> Polygon vertex
                  </li>
                )}
              </ul>
            )}
          </ErrorBoundary>
        ) : (
          <div className="canvas-empty">
            {!font && <FileDropTarget onLocalFile={onLocalFile} onOpenGoogleFonts={onOpenGoogleFonts} />}
            {font && !selectedGlyph && <p className="canvas-message">Select a glyph on the left to preview it.</p>}
            {font && glyphGeometry.kind === 'source-error' && (
              <p className="canvas-message" role="alert">
                This glyph could not be read: {glyphGeometry.message}
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
