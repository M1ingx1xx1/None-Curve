import type { DerivedGeometry } from '../geometry/types'
import type { DocumentState, ViewMode, ViewParams } from '../state/types'
import FileDropTarget from './FileDropTarget'

interface CanvasViewportProps {
  document: DocumentState
  view: ViewParams
  geometry: DerivedGeometry | null
}

const viewModes: { mode: ViewMode; label: string }[] = [
  { mode: 'outline', label: 'Outline' },
  { mode: 'skeleton', label: 'Skeleton' },
  { mode: 'fill', label: 'Fill' },
]

function EmptyState({ document, geometry }: Omit<CanvasViewportProps, 'view'>) {
  if (document.status.kind !== 'ready') return <FileDropTarget />
  if (!document.selectedGlyph) {
    return <p className="canvas-message">Select a glyph on the left to start previewing.</p>
  }
  if (!geometry) {
    return <p className="canvas-message">The geometry engine is not connected yet, so glyphs cannot be rendered.</p>
  }
  return null
}

export default function CanvasViewport({ document, view, geometry }: CanvasViewportProps) {
  const interactive = geometry !== null

  return (
    <section className="viewport" aria-label="Glyph canvas">
      <div className="viewport-toolbar" role="toolbar" aria-label="View">
        <div className="segmented" role="group" aria-label="View mode">
          {viewModes.map(({ mode, label }) => (
            <button key={mode} type="button" disabled={!interactive} aria-pressed={view.mode === mode}>
              {label}
            </button>
          ))}
        </div>
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" disabled={!interactive} aria-label="Zoom out">
            −
          </button>
          <output className="zoom-value" aria-label="Zoom level">
            {Math.round(view.zoom * 100)}%
          </output>
          <button type="button" disabled={!interactive} aria-label="Zoom in">
            +
          </button>
          <button type="button" disabled={!interactive}>
            Fit
          </button>
        </div>
      </div>

      <div className="canvas">
        {view.showMetrics && (
          <div className="metric-guides" aria-hidden="true">
            <span style={{ top: '22%' }}>ascender</span>
            <span style={{ top: '42%' }}>x-height</span>
            <span style={{ top: '72%' }}>baseline</span>
          </div>
        )}
        <div className="canvas-empty">
          <EmptyState document={document} geometry={geometry} />
        </div>
      </div>
    </section>
  )
}
