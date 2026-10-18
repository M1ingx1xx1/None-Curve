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
  /**
   * Ids of shared paths (SharedGlyphPaths) holding this glyph's outline and its font outline: the layers then draw
   * them with <use> instead of path data of their own. `polygon` is then needed only for the vertex markers.
   */
  polygonHref?: string | null
  sourceHref?: string
}

/** Vertex dots are this share of the marker radius: about 3 px across, small enough to tell crowded corners apart. */
const VERTEX_SCALE = 0.4

/**
 * The outline layers of one glyph in its own font units (y up). The caller positions it and flips y.
 * Shared by the single-glyph inspector and the text specimen so both show the same layers.
 */
function GlyphLayers({ source, polygon, view, markerRadius: r, showMarkers, polygonHref, sourceHref }: GlyphLayersProps) {
  const path = useMemo(() => (sourceHref ? '' : sourceGlyphToPath(source)), [source, sourceHref])
  const polygonPath = useMemo(() => (polygon && polygonHref === undefined ? polygonGlyphToPath(polygon) : ''), [polygon, polygonHref])
  const hasPolygon = polygonHref === undefined ? polygon !== null : polygonHref !== null
  // An outline layer: the shared path when there is one, else this glyph's own path data.
  const sourceLayer = (className: string, stroke: boolean) =>
    sourceHref ? (
      <use className={className} href={`#${sourceHref}`} />
    ) : (
      <path className={className} d={path} vectorEffect={stroke ? 'non-scaling-stroke' : undefined} />
    )
  const polygonLayer = (className: string, stroke: boolean) =>
    polygonHref ? (
      <use className={className} href={`#${polygonHref}`} />
    ) : (
      <path className={className} d={polygonPath} vectorEffect={stroke ? 'non-scaling-stroke' : undefined} />
    )
  const skeleton = useMemo(() => (view.showSkeleton && showMarkers ? sourceGlyphSkeleton(source) : null), [source, view.showSkeleton, showMarkers])
  const vertices = useMemo(
    () => (view.showVertices && showMarkers ? (polygon?.contours.flatMap((c) => c.points) ?? []) : []),
    [polygon, view.showVertices, showMarkers],
  )
  const { outline } = view

  return (
    <>
      {outline === 'source' && (view.showFill ? sourceLayer('glyph-fill', false) : sourceLayer('outline-stroke', true))}
      {outline === 'flattened' && hasPolygon && (view.showFill ? polygonLayer('glyph-fill', false) : polygonLayer('outline-stroke', true))}
      {outline === 'compare' && (
        <g className="compare">
          {view.showFill && hasPolygon && polygonLayer('glyph-fill compare-fill', false)}
          {hasPolygon && polygonLayer('outline-stroke', true)}
          {sourceLayer('compare-source', true)}
        </g>
      )}
      {view.showSkeleton && (
        <g className="skeleton">
          {sourceLayer('skeleton-outline', true)}
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
            <circle key={i} className="polygon-vertex" cx={p.x} cy={p.y} r={r * VERTEX_SCALE} />
          ))}
        </g>
      )}
    </>
  )
}

export default memo(GlyphLayers)
