import { useCallback, useState, type DragEvent } from 'react'
import { formatCodePoint, glyphLabel } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import type { SpecimenScene } from '../specimen/scene'
import type { DocumentState, OutlineView, ViewParams } from '../state/types'
import type { GlyphGeometry } from '../state/useDerivedGeometry'
import ErrorBoundary from './ErrorBoundary'
import FileDropTarget from './FileDropTarget'
import GlyphView from './GlyphView'
import SpecimenView from './SpecimenView'
import { clampZoom } from './usePanZoom'

export type CanvasMode = 'text' | 'glyph'

interface CanvasViewportProps {
  document: DocumentState
  view: ViewParams
  mode: CanvasMode
  scene: SpecimenScene | null
  /** Snapping grid spacing to draw, or null when snapping is off. */
  gridSize: number | null
  glyphGeometry: GlyphGeometry
  geometryPanelOpen: boolean
  onToggleGeometryPanel: () => void
  onModeChange: (mode: CanvasMode) => void
  onSelectGlyph: (glyph: GlyphRef) => void
  onViewChange: (patch: Partial<ViewParams>) => void
  onResetView: () => void
  onLocalFile: (file: File) => void
  onOpenGoogleFonts: () => void
}

const outlineViews: { value: OutlineView; label: string; description: string }[] = [
  { value: 'source', label: 'Original', description: 'Original font curves' },
  { value: 'flattened', label: 'Flattened', description: 'Final polygon after the whole pipeline (straight edges only)' },
  { value: 'compare', label: 'Compare', description: 'Final polygon with the original curves overlaid' },
]

const toggles: { key: 'showFill' | 'showSkeleton' | 'showVertices' | 'showMetrics'; label: string }[] = [
  { key: 'showFill', label: 'Fill' },
  { key: 'showSkeleton', label: 'Skeleton' },
  { key: 'showVertices', label: 'Vertices' },
  { key: 'showMetrics', label: 'Metrics' },
]

function Legend({ view }: { view: ViewParams }) {
  if (!(view.showSkeleton || view.showVertices || view.outline === 'compare')) return null
  return (
    <ul className="skeleton-legend" aria-label="Legend">
      {view.outline === 'compare' && (
        <>
          <li>
            <span className="legend-polygon" aria-hidden="true" /> Final polygon
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
  )
}

/** Area C: the one result canvas. Shows the text specimen, or a single glyph for inspection. */
export default function CanvasViewport(props: CanvasViewportProps) {
  const {
    document,
    view,
    mode,
    scene,
    gridSize,
    glyphGeometry,
    geometryPanelOpen,
    onToggleGeometryPanel,
    onModeChange,
    onSelectGlyph,
    onViewChange,
    onResetView,
    onLocalFile,
    onOpenGoogleFonts,
  } = props
  const { font, selectedGlyph } = document
  const [dragging, setDragging] = useState(false)

  const ready = glyphGeometry.kind === 'ready' ? glyphGeometry : null
  const glyph = ready?.source ?? null
  const polygon = ready?.geometry?.polygon ?? null
  const textReady = mode === 'text' && font !== null && scene !== null && scene.glyphCount > 0
  const glyphReady = mode === 'glyph' && font !== null && glyph !== null
  const interactive = textReady || glyphReady
  const zoomBy = (factor: number) => onViewChange({ zoom: clampZoom(view.zoom * factor) })

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

  const outlineDescription = outlineViews.find((o) => o.value === view.outline)?.description ?? ''
  const glyphName = selectedGlyph
    ? `${glyphLabel(selectedGlyph)}${selectedGlyph.unicode !== null ? ` ${formatCodePoint(selectedGlyph.unicode)}` : ''}`
    : ''
  const hasContours = (glyph?.contours.length ?? 0) > 0
  const showsPolygon = view.outline !== 'source' || view.showVertices

  return (
    <section
      className="viewport"
      aria-label="Result canvas"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="viewport-toolbar" role="toolbar" aria-label="Canvas">
        <button
          type="button"
          className="panel-toggle"
          aria-expanded={geometryPanelOpen}
          aria-controls="geometry-panel"
          onClick={onToggleGeometryPanel}
        >
          {geometryPanelOpen ? 'Hide parameters' : 'Parameters'}
        </button>
        <div className="segmented" role="group" aria-label="Canvas content">
          <button type="button" disabled={!font} aria-pressed={mode === 'text'} onClick={() => onModeChange('text')}>
            Text
          </button>
          <button
            type="button"
            disabled={!font || !selectedGlyph}
            aria-pressed={mode === 'glyph'}
            title="Inspect the glyph selected in the glyph list"
            onClick={() => onModeChange('glyph')}
          >
            {selectedGlyph ? `Glyph ${glyphLabel(selectedGlyph)}` : 'Glyph'}
          </button>
        </div>
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
        {!font && (
          <div className="canvas-empty">
            <FileDropTarget onLocalFile={onLocalFile} onOpenGoogleFonts={onOpenGoogleFonts} />
          </div>
        )}

        {textReady && (
          <ErrorBoundary resetKey={`${font.id}:text`} label="The canvas">
            <SpecimenView
              font={font}
              scene={scene}
              view={view}
              gridSize={gridSize}
              selectedGlyph={selectedGlyph}
              label={`Text specimen, ${outlineDescription}`}
              onViewChange={onViewChange}
              onSelectGlyph={onSelectGlyph}
            />
            <p className="canvas-badge" aria-hidden="true">
              Text · {scene.glyphCount} glyphs · {outlineDescription}
            </p>
            <Legend view={view} />
          </ErrorBoundary>
        )}
        {mode === 'text' && font && !textReady && (
          <div className="canvas-empty">
            <p className="canvas-message">
              Type text in the input below to preview it here
              {selectedGlyph ? ', or inspect the selected glyph with the Glyph button.' : '.'}
            </p>
          </div>
        )}

        {glyphReady && (
          <ErrorBoundary resetKey={`${font.id}:${selectedGlyph?.index}`} label="The canvas">
            <GlyphView
              glyph={glyph}
              polygon={polygon}
              gridSize={gridSize}
              fontMetrics={font.metrics}
              view={view}
              label={`Glyph ${glyphName}, ${outlineDescription}`}
              onViewChange={onViewChange}
            />
            <p className="canvas-badge" aria-hidden="true">
              Glyph {glyphName} · {outlineDescription}
            </p>
            {!hasContours && (
              <p className="canvas-note">This glyph has no outline (for example, a space). Metrics are still shown.</p>
            )}
            {ready?.geometryError && showsPolygon && (
              <p className="canvas-note canvas-note-error" role="alert">
                Geometry failed: {ready.geometryError}
              </p>
            )}
            {hasContours && <Legend view={view} />}
          </ErrorBoundary>
        )}
        {mode === 'glyph' && font && !glyphReady && (
          <div className="canvas-empty">
            {glyphGeometry.kind === 'source-error' ? (
              <p className="canvas-message" role="alert">
                This glyph could not be read: {glyphGeometry.message}
              </p>
            ) : (
              <p className="canvas-message">Select a glyph in the glyph list to inspect it.</p>
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
