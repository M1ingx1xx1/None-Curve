import { memo, useMemo } from 'react'
import { polygonGlyphToPath, sourceGlyphSkeleton, sourceGlyphToPath } from '../geometry/sourcePath'
import type { PolygonGlyph, SourceGlyph } from '../geometry/types'
import type { ViewParams } from '../state/types'

interface GlyphLayersProps {
  source: SourceGlyph
  polygon: PolygonGlyph | null
  view: ViewParams
  /** Marker radius in font units (so markers keep a constant screen size). */
  markerRadius: number
  /** False when markers would be too small or too many to read; outlines are still drawn. */
  showMarkers: boolean
  selected?: boolean
}

/**
 * The outline layers of one glyph in its own font units (y up). The caller positions it and flips y.
 * Shared by the single-glyph inspector and the text specimen so both show the same layers.
 */
function GlyphLayers({ source, polygon, view, markerRadius: r, showMarkers, selected = false }: GlyphLayersProps) {
  const path = useMemo(() => sourceGlyphToPath(source), [source])
  const polygonPath = useMemo(() => (polygon ? polygonGlyphToPath(polygon) : ''), [polygon])
  const skeleton = useMemo(() => (view.showSkeleton && showMarkers ? sourceGlyphSkeleton(source) : null), [source, view.showSkeleton, showMarkers])
  const vertices = useMemo(
    () => (view.showVertices && showMarkers ? (polygon?.contours.flatMap((c) => c.points) ?? []) : []),
    [polygon, view.showVertices, showMarkers],
  )
  const { outline } = view
  const fillClass = selected ? 'glyph-fill glyph-fill-selected' : 'glyph-fill'

  return (
    <>
      {outline === 'source' &&
        (view.showFill ? (
          <path className={fillClass} d={path} />
        ) : (
          <path className="outline-stroke" d={path} vectorEffect="non-scaling-stroke" />
        ))}
      {outline === 'flattened' &&
        polygon &&
        (view.showFill ? (
          <path className={fillClass} d={polygonPath} />
        ) : (
          <path className="outline-stroke" d={polygonPath} vectorEffect="non-scaling-stroke" />
        ))}
      {outline === 'compare' && (
        <g className="compare">
          {view.showFill && polygon && <path className={`${fillClass} compare-fill`} d={polygonPath} />}
          {polygon && <path className="outline-stroke" d={polygonPath} vectorEffect="non-scaling-stroke" />}
          <path className="compare-source" d={path} vectorEffect="non-scaling-stroke" />
        </g>
      )}
      {view.showSkeleton && (
        <g className="skeleton">
          <path className="skeleton-outline" d={path} vectorEffect="non-scaling-stroke" />
          {skeleton?.handles.map(([a, b], i) => (
            <line key={i} className="skeleton-handle" x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
          ))}
          {skeleton?.controls.map((p, i) => (
            <circle key={i} className="skeleton-control" cx={p.x} cy={p.y} r={r} vectorEffect="non-scaling-stroke" />
          ))}
          {skeleton?.anchors.map((p, i) => (
            <rect key={i} className="skeleton-anchor" x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      )}
      {vertices.length > 0 && (
        <g className="vertices">
          {vertices.map((p, i) => (
            <circle key={i} className="polygon-vertex" cx={p.x} cy={p.y} r={r * 0.7} />
          ))}
        </g>
      )}
    </>
  )
}

export default memo(GlyphLayers)
