import { useCallback, useEffect, useState } from 'react'
import { formatCodePoint, glyphLabel, type LoadedFont } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import type { ViewParams } from '../state/types'
import type { GlyphGeometry } from '../state/useDerivedGeometry'
import ErrorBoundary from './ErrorBoundary'
import GlyphView from './GlyphView'

interface GlyphPreviewProps {
  font: LoadedFont | null
  selected: GlyphRef | null
  glyphGeometry: GlyphGeometry
  /** Layer settings come from the main canvas; zoom and pan are local to the preview. */
  view: ViewParams
  gridSize: number | null
}

type LocalView = Pick<ViewParams, 'zoom' | 'panX' | 'panY'>
const FIT: LocalView = { zoom: 1, panX: 0, panY: 0 }

/** Bottom right: a small preview of the glyph selected in the glyph list or the canvas. */
export default function GlyphPreview({ font, selected, glyphGeometry, view, gridSize }: GlyphPreviewProps) {
  const [local, setLocal] = useState<LocalView>(FIT)
  const onViewChange = useCallback((patch: Partial<ViewParams>) => setLocal((v) => ({ ...v, ...patch })), [])

  // A new selection starts fitted.
  const key = font && selected ? `${font.id}:${selected.index}` : ''
  useEffect(() => setLocal(FIT), [key])

  const ready = glyphGeometry.kind === 'ready' ? glyphGeometry : null
  const name = selected
    ? `${glyphLabel(selected)}${selected.unicode !== null ? ` ${formatCodePoint(selected.unicode)}` : ''}`
    : ''

  return (
    <section className="glyph-preview" aria-label="Selected glyph">
      <div className="section-head">
        <h2>{selected ? `Glyph ${name}` : 'Glyph'}</h2>
        <button type="button" className="button-small" disabled={!ready} onClick={() => setLocal(FIT)}>
          Fit
        </button>
      </div>
      <div className="glyph-preview-canvas">
        {font && ready && selected ? (
          <ErrorBoundary resetKey={key} label="The glyph preview">
            <GlyphView
              glyph={ready.source}
              polygon={ready.geometry?.polygon ?? null}
              gridSize={gridSize}
              fontMetrics={font.metrics}
              view={{ ...view, ...local, showMetrics: view.showMetrics }}
              label={`Glyph ${name}`}
              onViewChange={onViewChange}
            />
            {ready.source.contours.length === 0 && <p className="canvas-note">No outline (for example, a space).</p>}
            {ready.geometryError && (
              <p className="canvas-note canvas-note-error" role="alert">
                Geometry failed: {ready.geometryError}
              </p>
            )}
          </ErrorBoundary>
        ) : (
          <p className="glyph-preview-empty">
            {!font
              ? 'Import a font to preview glyphs.'
              : glyphGeometry.kind === 'source-error'
                ? `This glyph could not be read: ${glyphGeometry.message}`
                : 'Select a glyph in the glyph list or click one in the canvas.'}
          </p>
        )}
      </div>
      {ready?.geometry && (
        <p className="field-hint">
          {ready.geometry.vertexCount} vertices · advance {ready.source.metrics.advanceWidth}
        </p>
      )}
    </section>
  )
}
