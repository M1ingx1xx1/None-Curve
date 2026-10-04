import { useMemo } from 'react'
import type { FontMetrics } from '../font/model'
import { sourceGlyphBounds } from '../geometry/sourcePath'
import type { PolygonGlyph, SourceGlyph } from '../geometry/types'
import type { ViewParams } from '../state/types'
import { gridLines, metricGuides } from './canvasGuides'
import GlyphLayers from './GlyphLayers'
import { usePanZoom } from './usePanZoom'

interface GlyphViewProps {
  glyph: SourceGlyph
  /** Final polygon after the whole pipeline, or null when it could not be derived. */
  polygon: PolygonGlyph | null
  /** Snapping grid spacing in font units, drawn for reference only; null hides it. */
  gridSize: number | null
  fontMetrics: FontMetrics
  view: ViewParams
  label: string
  onViewChange: (patch: Partial<ViewParams>) => void
}

/** Single-glyph inspector: one glyph in font units (y up) with metric guides and all layers. */
export default function GlyphView({ glyph, polygon, gridSize, fontMetrics, view, label, onViewChange }: GlyphViewProps) {
  const { advanceWidth } = glyph.metrics
  const { ascender, descender } = fontMetrics

  // Frame at zoom 1: advance box and vertical metrics, grown to include any overshooting outline.
  const frame = useMemo(() => {
    const b = sourceGlyphBounds(glyph)
    const minX = Math.min(0, b?.minX ?? 0)
    const maxX = Math.max(advanceWidth, b?.maxX ?? 0, minX + 1)
    const minY = Math.min(descender, b?.minY ?? 0)
    const maxY = Math.max(ascender, b?.maxY ?? 0)
    const pad = 0.08 * Math.max(maxX - minX, maxY - minY)
    return {
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    }
  }, [glyph, advanceWidth, ascender, descender])

  const { containerRef, ready, u, visW, visH, box, handlers } = usePanZoom(frame, view, onViewChange)
  const { left, right, top, bottom } = box

  const guides = metricGuides(fontMetrics)
  const r = 3.5 * u

  // Snapping grid in font units, anchored at the origin. Display only; never part of the polygon.
  const grid = ready ? gridLines(box, gridSize, u) : null

  return (
    <div
      ref={containerRef}
      className="glyph-view"
      tabIndex={0}
      role="img"
      aria-label={`${label}. Drag or use arrow keys to pan, scroll or +/− to zoom, 0 to fit.`}
      {...handlers}
    >
      {ready && (
        <svg viewBox={`${left} ${-top} ${visW} ${visH}`} preserveAspectRatio="none" aria-hidden="true">
          {grid && (
            <g className="snap-grid">
              {grid.xs.map((x) => (
                <line key={`x${x}`} x1={x} x2={x} y1={-top} y2={-bottom} vectorEffect="non-scaling-stroke" />
              ))}
              {grid.ys.map((y) => (
                <line key={`y${y}`} x1={left} x2={right} y1={-y} y2={-y} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {view.showMetrics && (
            <g className="metric-lines">
              {guides.map(([name, y]) => (
                <g key={name} className={y === 0 ? 'metric-baseline' : undefined}>
                  <line x1={left} x2={right} y1={-y} y2={-y} vectorEffect="non-scaling-stroke" />
                  <text x={left + 8 * u} y={-y - 4 * u} fontSize={10 * u}>
                    {name}
                  </text>
                </g>
              ))}
              {[0, advanceWidth].map((x, i) => (
                <line key={i} className="metric-advance" x1={x} x2={x} y1={-top} y2={-bottom} vectorEffect="non-scaling-stroke" />
              ))}
              <text x={advanceWidth + 4 * u} y={-top + 14 * u} fontSize={10 * u}>
                advance {advanceWidth}
              </text>
            </g>
          )}

          <g transform="scale(1 -1)">
            <GlyphLayers source={glyph} polygon={polygon} view={view} markerRadius={r} showMarkers />
          </g>
        </svg>
      )}
      {ready && gridSize && (
        <p className="canvas-grid-note" aria-hidden="true">
          Snap grid {gridSize} u{grid ? '' : ' · too dense to draw at this zoom'}
        </p>
      )}
    </div>
  )
}
