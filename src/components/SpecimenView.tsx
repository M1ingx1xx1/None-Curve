import { useMemo } from 'react'
import type { LoadedFont } from '../font/model'
import type { GlyphRef, SourceGlyph } from '../geometry/types'
import type { SpecimenScene } from '../specimen/scene'
import type { ViewParams } from '../state/types'
import { gridLines, metricGuides } from './canvasGuides'
import GlyphLayers from './GlyphLayers'
import { usePanZoom } from './usePanZoom'

interface SpecimenViewProps {
  font: LoadedFont
  scene: SpecimenScene
  view: ViewParams
  gridSize: number | null
  selectedGlyph: GlyphRef | null
  label: string
  onViewChange: (patch: Partial<ViewParams>) => void
  onSelectGlyph: (glyph: GlyphRef) => void
}

/** Point markers (skeleton, vertices) are drawn only when an em is at least this many pixels. */
const MARKER_MIN_PX_PER_EM = 48
/** Metric labels are drawn only when an em is at least this many pixels. */
const LABEL_MIN_PX_PER_EM = 28

/**
 * The text specimen in the result canvas: every glyph of the input text, set with advances and
 * kerning, drawn with the same layers as the single-glyph inspector. Only glyphs inside the visible
 * area are drawn, and point markers appear once the text is large enough to read them.
 */
export default function SpecimenView({ font, scene, view, gridSize, selectedGlyph, label, onViewChange, onSelectGlyph }: SpecimenViewProps) {
  const { unitsPerEm, ascender, descender } = font.metrics

  // Scene coordinates are y down (first baseline at 0); the canvas works in y up.
  const frame = useMemo(() => {
    const { minX, maxX, minY, maxY } = scene.bounds
    const pad = unitsPerEm * 0.25
    return { cx: (minX + maxX) / 2, cy: -(minY + maxY) / 2, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }
  }, [scene, unitsPerEm])

  const { containerRef, ready, u, visW, visH, box, handlers, wasDrag } = usePanZoom(frame, view, onViewChange)
  const { left, right, top, bottom } = box
  const pxPerEm = unitsPerEm / u
  const showMarkers = pxPerEm >= MARKER_MIN_PX_PER_EM
  const markersHidden = (view.showSkeleton || view.showVertices) && !showMarkers
  const guides = metricGuides(font.metrics)
  const grid = ready ? gridLines(box, gridSize, u) : null

  const sources = useMemo(() => new Map<number, SourceGlyph | null>(), [font])
  const sourceFor = (index: number) => {
    if (!sources.has(index)) {
      try {
        sources.set(index, font.getGlyph(index))
      } catch {
        sources.set(index, null)
      }
    }
    return sources.get(index) ?? null
  }

  const selectRef = (index: number, text: string): GlyphRef => {
    const cp = text.codePointAt(0)
    return (
      font.characters.find((c) => c.index === index && c.unicode === cp) ??
      font.characters.find((c) => c.index === index) ?? { index, name: '', unicode: null }
    )
  }

  // Visible band in scene coordinates (y down).
  const sceneTop = -top
  const sceneBottom = -bottom
  const margin = unitsPerEm
  const firstVisibleLine = scene.lines.findIndex((line) => line.baseline - descender >= sceneTop)

  return (
    <div
      ref={containerRef}
      className="glyph-view specimen-view"
      tabIndex={0}
      role="img"
      aria-label={`${label}. Drag or use arrow keys to pan, scroll or +/− to zoom, 0 to fit. Click a glyph to select it.`}
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
          {view.showMetrics &&
            scene.lines.map((line, l) => {
              if (line.baseline - ascender > sceneBottom || line.baseline - descender < sceneTop) return null
              // Label only the first visible line so labels of neighbouring lines do not pile up.
              const labelled = l === firstVisibleLine
              return (
                <g key={l} className="metric-lines">
                  {guides.map(([name, y]) => (
                    <g key={name} className={y === 0 ? 'metric-baseline' : undefined}>
                      <line x1={left} x2={right} y1={line.baseline - y} y2={line.baseline - y} vectorEffect="non-scaling-stroke" />
                      {labelled && pxPerEm >= LABEL_MIN_PX_PER_EM && (
                        <text x={left + 8 * u} y={line.baseline - y - 4 * u} fontSize={10 * u}>
                          {name}
                        </text>
                      )}
                    </g>
                  ))}
                </g>
              )
            })}

          {scene.lines.map((line, l) => {
            if (line.baseline - ascender - margin > sceneBottom || line.baseline - descender + margin < sceneTop) return null
            return (
              <g key={l}>
                {line.glyphs.map((g, i) => {
                  if (g.x + g.advance + margin < left || g.x - margin > right) return null
                  if (g.missing) {
                    return (
                      <rect
                        key={i}
                        className="strip-missing"
                        x={g.x + g.advance * 0.1}
                        y={g.y - ascender * 0.7}
                        width={g.advance * 0.8}
                        height={ascender * 0.7}
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>Missing from the font: {g.text}</title>
                      </rect>
                    )
                  }
                  const source = sourceFor(g.index)
                  if (!source || source.contours.length === 0) return null
                  return (
                    <g
                      key={i}
                      className="specimen-glyph"
                      transform={`translate(${g.x} ${g.y}) scale(1 -1)`}
                      onClick={() => {
                        if (!wasDrag()) onSelectGlyph(selectRef(g.index, g.text))
                      }}
                    >
                      <title>{g.text}</title>
                      <GlyphLayers
                        source={source}
                        polygon={g.polygon}
                        view={view}
                        markerRadius={3.5 * u}
                        showMarkers={showMarkers}
                        selected={selectedGlyph?.index === g.index}
                      />
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      )}
      {ready && gridSize && (
        <p className="canvas-grid-note" aria-hidden="true">
          Snap grid {gridSize} u{grid ? '' : ' · too dense to draw at this zoom'}
        </p>
      )}
      {markersHidden && (
        <p className="canvas-note" aria-live="polite">
          Zoom in to see skeleton points and vertices (shown from {MARKER_MIN_PX_PER_EM} px per em).
        </p>
      )}
    </div>
  )
}
