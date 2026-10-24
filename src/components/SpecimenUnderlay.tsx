import { useMemo, type CSSProperties, type ReactNode, type Ref } from 'react'
import type { FontMetrics } from '../font/model'
import { textBox, type ArtboardLayout } from '../specimen/artboard'
import { GRID_CONTRAST, gridLineColor, isDarkColor, SNAP_GRID_CONTRAST } from '../specimen/color'
import type { SpecimenScene } from '../specimen/scene'
import type { ViewParams } from '../state/types'
import { metricGuides } from './canvasGuides'

/** Metric labels are drawn only when an em is at least this many pixels. */
const LABEL_MIN_PX_PER_EM = 28

interface SpecimenUnderlayProps {
  /** Base for the patterns' ids (useId). */
  ids: string
  /** The scene the metric guides follow (its lines) and Free position drags by (its text block). */
  scene: SpecimenScene
  layout: ArtboardLayout
  metrics: FontMetrics
  ink: string
  highlight: string
  paper: string
  transparent: boolean
  view: ViewParams
  /** The visible box in font units (y up), font units per screen pixel, and the view's size in font units. */
  box: { left: number; right: number; top: number; bottom: number }
  u: number
  visW: number
  visH: number
  /** Snapping grid lines to draw (gridLines), or null. */
  grid: { xs: number[]; ys: number[] } | null
  /** While the text is dragged or zoomed in: the grid shows inside the artboard too. */
  showGridInside: boolean
  freeMove: boolean
  /** The group moved as one while the text is dragged (Free position). */
  movingRef: Ref<SVGGElement>
  /** Shared outlines for the glyphs drawn in SVG, written in a <defs> of their own; left out by the canvas renderers. */
  defs?: ReactNode
  /** The SVG renderer's glyphs, drawn inside the moving group above the guides. */
  children?: ReactNode
}

/**
 * The SVG under the canvas's glyphs: the background (or checkerboard), the pasteboard and its screen grid, the grid
 * inside the artboard, the snapping grid, and the moving group with the text block's drag handle and the metric guides.
 * The SVG renderer (SpecimenView) puts its glyphs inside the moving group; the canvas renderers draw them on a canvas
 * above (GlyphSurface).
 */
export default function SpecimenUnderlay({
  ids,
  scene,
  layout,
  metrics,
  ink,
  highlight,
  paper,
  transparent,
  view,
  box,
  u,
  visW,
  visH,
  grid,
  showGridInside,
  freeMove,
  movingRef,
  defs,
  children,
}: SpecimenUnderlayProps) {
  const { unitsPerEm, ascender, descender } = metrics
  const gridId = `${ids}-grid`
  const checkerId = `${ids}-checker`
  const darkPaper = isDarkColor(paper)
  // Grid lines from the background's brightness, so they show equally in every palette.
  const gridColor = useMemo(() => gridLineColor(paper, GRID_CONTRAST), [paper])
  const snapGridColor = useMemo(() => gridLineColor(paper, SNAP_GRID_CONTRAST), [paper])
  const block = textBox(scene)
  const { left, right, top, bottom } = box
  // The view minus the artboard, as one even-odd path (scene coordinates, y down).
  const pasteboard =
    `M ${left} ${-top} h ${visW} v ${visH} h ${-visW} Z ` +
    `M ${layout.x} ${layout.y} h ${layout.width} v ${layout.height} h ${-layout.width} Z`
  const pxPerEm = unitsPerEm / u
  const guides = metricGuides(metrics)
  // Visible band in scene coordinates (y down).
  const sceneTop = -top
  const sceneBottom = -bottom
  const firstVisibleLine = scene.lines.findIndex((line) => line.baseline - descender >= sceneTop)
  // Metric guides span the artboard (or the visible part of it), not the whole view.
  const guideLeft = Math.max(left, layout.x)
  const guideRight = Math.min(right, layout.x + layout.width)

  return (
    <svg
      viewBox={`${left} ${-top} ${visW} ${visH}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={
        {
          '--artboard-ink': ink,
          '--artboard-highlight': highlight,
          '--artboard-grid': gridColor,
          '--artboard-snap-grid': snapGridColor,
        } as CSSProperties
      }
    >
      <defs>
        {/* A 24 px screen grid, fixed to the view like graph paper. */}
        <pattern id={gridId} patternUnits="userSpaceOnUse" x={left} y={-top} width={24 * u} height={24 * u}>
          <path className="view-grid-line" d={`M ${24 * u} 0 H 0 V ${24 * u}`} strokeWidth={u} />
        </pattern>
        {transparent && (
          <pattern
            id={checkerId}
            patternUnits="userSpaceOnUse"
            x={layout.x}
            y={layout.y}
            width={16 * u}
            height={16 * u}
          >
            <rect width={16 * u} height={16 * u} fill={paper} />
            <rect className="checker-tint" width={8 * u} height={8 * u} />
            <rect className="checker-tint" x={8 * u} y={8 * u} width={8 * u} height={8 * u} />
          </pattern>
        )}
      </defs>
      {defs !== undefined && <defs>{defs}</defs>}
      {/* The background covers the whole view. */}
      <rect x={left} y={-top} width={visW} height={visH} fill={transparent ? `url(#${checkerId})` : paper} />
      {/* Outside the artboard (the pasteboard): a little darker (lighter on a dark background)
          and covered by the grid, so the artboard stands out as the page that is exported. */}
      <path className="pasteboard" data-paper={darkPaper ? 'dark' : 'light'} d={pasteboard} fillRule="evenodd" />
      <path d={pasteboard} fillRule="evenodd" fill={`url(#${gridId})`} />
      {/* Inside, the artboard looks like the export; the grid only fades in while it helps
          placing things: while dragging the text, or zoomed in to 200 % or more. */}
      <rect
        className="artboard-grid"
        data-visible={showGridInside || undefined}
        x={layout.x}
        y={layout.y}
        width={layout.width}
        height={layout.height}
        fill={`url(#${gridId})`}
      />
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
      {/* The text and its guides, moved as one while the text is dragged (Free position). */}
      <g ref={movingRef}>
        {freeMove && (
          // Free position: the whole text block (gaps between words included) is the drag handle.
          <rect className="text-block-hit" x={block.minX} y={block.minY} width={block.width} height={block.height} />
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
                    <line
                      x1={guideLeft}
                      x2={guideRight}
                      y1={line.baseline - y}
                      y2={line.baseline - y}
                      vectorEffect="non-scaling-stroke"
                    />
                    {labelled && pxPerEm >= LABEL_MIN_PX_PER_EM && (
                      <text x={guideLeft + 8 * u} y={line.baseline - y - 4 * u} fontSize={10 * u}>
                        {name}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            )
          })}

        {children}
      </g>
    </svg>
  )
}
