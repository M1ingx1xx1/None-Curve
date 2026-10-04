import { useCallback, useState, type DragEvent } from 'react'
import type { GlyphRef } from '../geometry/types'
import type { SpecimenScene } from '../specimen/scene'
import type { DocumentState, OutlineView, ViewParams } from '../state/types'
import ErrorBoundary from './ErrorBoundary'
import FileDropTarget from './FileDropTarget'
import SpecimenView from './SpecimenView'
import { clampZoom } from './usePanZoom'

interface CanvasViewportProps {
  document: DocumentState
  view: ViewParams
  scene: SpecimenScene | null
  /** Snapping grid spacing to draw, or null when snapping is off. */
  gridSize: number | null
  geometryPanelOpen: boolean
  onToggleGeometryPanel: () => void
  onSelectGlyph: (glyph: GlyphRef) => void
  onViewChange: (patch: Partial<ViewParams>) => void
  onResetView: () => void
  onLocalFile: (file: File) => void
  onOpenGoogleFonts: () => void
}

export const outlineViews: { value: OutlineView; label: string; description: string }[] = [
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

export function Legend({ view }: { view: ViewParams }) {
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

/**
 * Top right: the result canvas. It shows only the text from the input, set with the current font
 * and every geometry parameter. The view and layer controls here also drive the glyph preview.
 */
export default function CanvasViewport(props: CanvasViewportProps) {
  const {
    document,
    view,
    scene,
    gridSize,
    geometryPanelOpen,
    onToggleGeometryPanel,
    onSelectGlyph,
    onViewChange,
    onResetView,
    onLocalFile,
    onOpenGoogleFonts,
  } = props
  const { font, selectedGlyph } = document
  const [dragging, setDragging] = useState(false)

  const interactive = font !== null && scene !== null && scene.glyphCount > 0
  const zoomBy = (factor: number) => onViewChange({ zoom: clampZoom(view.zoom * factor) })
  const outlineDescription = outlineViews.find((o) => o.value === view.outline)?.description ?? ''

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
        <div className="segmented" role="group" aria-label="Outline">
          {outlineViews.map(({ value, label, description }) => (
            <button
              key={value}
              type="button"
              disabled={!font}
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
              disabled={!font}
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

        {interactive && (
          <ErrorBoundary resetKey={`${font.id}:text`} label="The canvas">
            <SpecimenView
              font={font}
              scene={scene}
              view={view}
              gridSize={gridSize}
              selectedGlyph={selectedGlyph}
              label={`Text, ${outlineDescription}`}
              onViewChange={onViewChange}
              onSelectGlyph={onSelectGlyph}
            />
            <p className="canvas-badge" aria-hidden="true">
              {scene.glyphCount} glyphs · {outlineDescription}
            </p>
            <Legend view={view} />
          </ErrorBoundary>
        )}
        {font && !interactive && (
          <div className="canvas-empty">
            <p className="canvas-message">Type text in the input (bottom right) to preview it here.</p>
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
