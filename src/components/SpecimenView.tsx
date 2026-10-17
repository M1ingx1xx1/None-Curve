import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { LoadedFont } from '../font/model'
import type { GlyphRef, PolygonGlyph, SourceGlyph } from '../geometry/types'
import { artboardViewFrame, textBox, type ArtboardLayout } from '../specimen/artboard'
import {
  artboardEdgeColor,
  GRID_CONTRAST,
  gridLineColor,
  highlightColor,
  isDarkColor,
  SNAP_GRID_CONTRAST,
} from '../specimen/color'
import type { SpecimenScene } from '../specimen/scene'
import type { ViewParams } from '../state/types'
import { gridLines, metricGuides } from './canvasGuides'
import GlyphLayers from './GlyphLayers'
import { usePanZoom } from './usePanZoom'

interface SpecimenViewProps {
  font: LoadedFont
  scene: SpecimenScene
  /** Where the artboard sits in scene units; zoom 1 shows the whole artboard. */
  layout: ArtboardLayout
  /** Glyph and background colours; a transparent background is drawn as a checkerboard. */
  ink: string
  paper: string
  transparent?: boolean
  /** Hide everything outside the artboard (the preview shows exactly what is exported). */
  clip?: boolean
  view: ViewParams
  gridSize: number | null
  selectedGlyph: GlyphRef | null
  label: string
  onViewChange: (patch: Partial<ViewParams>) => void
  onSelectGlyph: (glyph: GlyphRef) => void
  /** A click on empty space (not on a glyph) or Escape: hides the selection highlight. */
  onClearSelection?: () => void
  /** Free position: dragging the text moves it. Called once, on release, with the move in font units. */
  onMoveText?: (dx: number, dy: number) => void
  /** False for a read-only miniature: no pan, zoom, keyboard focus, or glyph selection. */
  interactive?: boolean
  /** Gaussian blur of the glyphs, in screen pixels; 0 is off. The artboard itself stays sharp. */
  blur?: number
}

interface SpecimenGlyphProps {
  index: number
  text: string
  /** Pen position in scene units (y down). */
  x: number
  y: number
  advance: number
  /** Slant as an SVG transform suffix, or ''. */
  skew: string
  ascender: number
  descender: number
  source: SourceGlyph
  polygon: PolygonGlyph | null
  view: ViewParams
  markerRadius: number
  showMarkers: boolean
  selected: boolean
  /** Click handler (interactive canvas only). */
  onSelect?: (index: number, text: string) => void
}

/**
 * One glyph of the text. Memoised: when results for other glyphs arrive, or the view pans, the
 * glyphs whose shape and place did not change are not drawn again.
 */
const SpecimenGlyph = memo(function SpecimenGlyph(props: SpecimenGlyphProps) {
  const { index, text, x, y, advance, skew, ascender, descender, source, polygon, view, markerRadius, showMarkers, selected, onSelect } = props
  return (
    <g
      className={selected ? 'specimen-glyph specimen-glyph-selected' : 'specimen-glyph'}
      transform={`translate(${x} ${y})${skew} scale(1 -1)`}
      onClick={onSelect ? () => onSelect(index, text) : undefined}
    >
      <title>{text}</title>
      {onSelect && <rect className="glyph-box" x={0} y={descender} width={advance} height={ascender - descender} />}
      <GlyphLayers source={source} polygon={polygon} view={view} markerRadius={markerRadius} showMarkers={showMarkers} />
    </g>
  )
})

/** From this zoom on, the grid also shows inside the artboard (for placing details precisely). */
const GRID_INSIDE_ZOOM = 2
/** Point markers (skeleton, vertices) are drawn only when an em is at least this many pixels. */
const MARKER_MIN_PX_PER_EM = 48
/** Metric labels are drawn only when an em is at least this many pixels. */
const LABEL_MIN_PX_PER_EM = 28

/**
 * The text specimen in the result canvas: every glyph of the input text, set with advances and
 * kerning, drawn with the same layers as the single-glyph inspector. Only glyphs inside the visible
 * area are drawn, and point markers appear once the text is large enough to read them.
 */
export default function SpecimenView({
  font,
  scene,
  layout,
  ink,
  paper,
  transparent = false,
  clip = false,
  view,
  gridSize,
  selectedGlyph,
  label,
  onViewChange,
  onSelectGlyph,
  onClearSelection,
  onMoveText,
  interactive = true,
  blur = 0,
}: SpecimenViewProps) {
  const { unitsPerEm, ascender, descender } = font.metrics
  // Each glyph's invisible click target: its advance by the line (ascender to descender), so small
  // text and the inside of letters like "o" are easy to hit.

  // Scene coordinates are y down (first baseline at 0); the canvas works in y up. Zoom 1 fits the artboard.
  const frame = useMemo(() => artboardViewFrame(layout), [layout])
  const ids = useId()
  const blurId = `${ids}-blur`
  const clipId = `${ids}-clip`
  const gridId = `${ids}-grid`
  const checkerId = `${ids}-checker`
  // Selected and hovered glyphs: a colour computed from the text and background to stand out.
  const highlight = useMemo(() => highlightColor(ink, paper), [ink, paper])
  // The canvas outline: the interface mint rather than the text colour, so it reads as a guide. Its
  // shadow (elevation, styled in .artboard-frame) is dark on a light background and light on a dark one.
  const edge = useMemo(() => artboardEdgeColor(paper), [paper])
  const darkPaper = isDarkColor(paper)
  // Grid lines from the background's brightness, so they show equally in every palette.
  const gridColor = useMemo(() => gridLineColor(paper, GRID_CONTRAST), [paper])
  const snapGridColor = useMemo(() => gridLineColor(paper, SNAP_GRID_CONTRAST), [paper])
  const block = textBox(scene)
  // Slant around each glyph's baseline: skewX in y-down space leans right for a positive angle.
  const skew = scene.slant ? ` skewX(${-scene.slant})` : ''

  // True while the text is being dragged (Free position); the grid then shows inside the artboard.
  const [draggingText, setDraggingText] = useState(false)
  const { containerRef, ready, u, visW, visH, box, handlers, wasDrag } = usePanZoom(frame, view, onViewChange, interactive)
  const { left, right, top, bottom } = box
  // The view minus the artboard, as one even-odd path (scene coordinates, y down).
  const pasteboard =
    `M ${left} ${-top} h ${visW} v ${visH} h ${-visW} Z ` +
    `M ${layout.x} ${layout.y} h ${layout.width} v ${layout.height} h ${-layout.width} Z`
  const showGridInside = draggingText || view.zoom >= GRID_INSIDE_ZOOM
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

  // One stable click handler for every glyph (so unchanged glyphs skip re-rendering); it reads the
  // latest state through a ref.
  const select = useRef<(index: number, text: string) => void>(() => {})
  select.current = (index, text) => {
    if (!dragged()) onSelectGlyph(selectRef(index, text))
  }
  const onGlyphSelect = useCallback((index: number, text: string) => select.current(index, text), [])

  // Free position: a drag that starts on the text moves the text; anywhere else it pans as usual.
  // While dragging, only the text group's transform changes (nothing re-renders, so it follows the
  // pointer smoothly however long the text); the new position is committed once, on release, and the
  // transform is cleared when that position arrives back as a new layout.
  const freeMove = interactive && onMoveText !== undefined
  const movingRef = useRef<SVGGElement>(null)
  const textDrag = useRef<{ x: number; y: number; moved: boolean; dx: number; dy: number } | null>(null)
  const textMoved = useRef(false)
  const committed = useRef(false)
  const dragged = () => wasDrag() || textMoved.current
  const setOffset = (dx: number, dy: number) => {
    if (dx || dy) movingRef.current?.setAttribute('transform', `translate(${dx} ${dy})`)
    else movingRef.current?.removeAttribute('transform')
  }
  useLayoutEffect(() => {
    if (!committed.current) return
    committed.current = false
    setOffset(0, 0)
  }, [layout])
  const pointer = {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (freeMove && e.button === 0 && (e.target as Element).closest('.specimen-glyph, .text-block-hit')) {
        committed.current = false
        setOffset(0, 0)
        textDrag.current = { x: e.clientX, y: e.clientY, moved: false, dx: 0, dy: 0 }
        return
      }
      handlers.onPointerDown(e)
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const d = textDrag.current
      if (!d) return handlers.onPointerMove(e)
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return
        d.moved = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // Capture is a convenience; the drag still works while the pointer stays on the canvas.
        }
        setDraggingText(true)
      }
      // Screen pixels to font units (both axes point down in the scene), stopped at the artboard edges.
      // Along an axis where the text is larger than the artboard it does not move (see moveFreeText).
      const along = (delta: number, low: number, high: number) => (low <= high ? Math.min(high, Math.max(low, delta)) : 0)
      d.dx = along((e.clientX - d.x) * u, layout.x - block.minX, layout.x + layout.width - block.minX - block.width)
      d.dy = along((e.clientY - d.y) * u, layout.y - block.minY, layout.y + layout.height - block.minY - block.height)
      setOffset(d.dx, d.dy)
    },
    onPointerUp() {
      const d = textDrag.current
      textMoved.current = d?.moved ?? false
      textDrag.current = null
      if (d?.moved) {
        committed.current = true
        onMoveText?.(d.dx, d.dy)
        setDraggingText(false)
      }
      handlers.onPointerUp()
    },
    onPointerCancel() {
      if (textDrag.current?.moved) setDraggingText(false)
      textDrag.current = null
      textMoved.current = false
      setOffset(0, 0)
      handlers.onPointerCancel()
    },
  }

  // A click that lands on empty space (not on a glyph, and not the end of a drag) clears the highlight.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (dragged() || (e.target as Element).closest('.specimen-glyph')) return
    onClearSelection?.()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && e.target === e.currentTarget && onClearSelection) {
      e.preventDefault()
      onClearSelection()
    } else handlers.onKeyDown(e)
  }

  // Visible band in scene coordinates (y down).
  const sceneTop = -top
  const sceneBottom = -bottom
  const margin = unitsPerEm
  const firstVisibleLine = scene.lines.findIndex((line) => line.baseline - descender >= sceneTop)
  // Metric guides span the artboard (or the visible part of it), not the whole view.
  const guideLeft = Math.max(left, layout.x)
  const guideRight = Math.min(right, layout.x + layout.width)

  return (
    <div
      ref={containerRef}
      className={interactive ? 'glyph-view specimen-view' : 'glyph-view specimen-view specimen-view-static'}
      tabIndex={interactive ? 0 : undefined}
      role="img"
      aria-label={
        interactive
          ? `${label}. Drag or use arrow keys to pan, scroll or +/− to zoom, 0 to fit. Click a glyph to select it; click empty space or press Escape to clear the highlight.${freeMove ? ' Drag the text to move it.' : ''}`
          : label
      }
      data-free-move={freeMove || undefined}
      {...(interactive ? { ...handlers, ...pointer, onKeyDown, onClick } : {})}
    >
      {ready && (
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
            {blur > 0 && (
              <filter id={blurId} filterUnits="userSpaceOnUse" x={layout.x} y={layout.y} width={layout.width} height={layout.height}>
                <feGaussianBlur stdDeviation={blur * u} />
              </filter>
            )}
            {clip && (
              <clipPath id={clipId}>
                <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} />
              </clipPath>
            )}
            {interactive && (
              // A 24 px screen grid, fixed to the view like graph paper.
              <pattern id={gridId} patternUnits="userSpaceOnUse" x={left} y={-top} width={24 * u} height={24 * u}>
                <path className="view-grid-line" d={`M ${24 * u} 0 H 0 V ${24 * u}`} strokeWidth={u} />
              </pattern>
            )}
            {transparent && (
              <pattern id={checkerId} patternUnits="userSpaceOnUse" x={layout.x} y={layout.y} width={16 * u} height={16 * u}>
                <rect width={16 * u} height={16 * u} fill={paper} />
                <rect className="checker-tint" width={8 * u} height={8 * u} />
                <rect className="checker-tint" x={8 * u} y={8 * u} width={8 * u} height={8 * u} />
              </pattern>
            )}
          </defs>
          {/* The background: the whole view on the canvas, only the exported area in the preview. */}
          {clip ? (
            <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} fill={transparent ? `url(#${checkerId})` : paper} />
          ) : (
            <rect x={left} y={-top} width={visW} height={visH} fill={transparent ? `url(#${checkerId})` : paper} />
          )}
          {interactive && (
            <>
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
            </>
          )}
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
              <rect
                className="text-block-hit"
                x={block.minX}
                y={block.minY}
                width={block.width}
                height={block.height}
              />
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
                        <line x1={guideLeft} x2={guideRight} y1={line.baseline - y} y2={line.baseline - y} vectorEffect="non-scaling-stroke" />
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

            <g filter={blur > 0 ? `url(#${blurId})` : undefined} clipPath={clip ? `url(#${clipId})` : undefined}>
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
                        <SpecimenGlyph
                          key={i}
                          index={g.index}
                          text={g.text}
                          x={g.x}
                          y={g.y}
                          advance={g.advance}
                          skew={skew}
                          ascender={ascender}
                          descender={descender}
                          source={source}
                          polygon={g.polygon}
                          view={view}
                          markerRadius={3.5 * u}
                          showMarkers={showMarkers}
                          selected={selectedGlyph?.index === g.index}
                          onSelect={interactive ? onGlyphSelect : undefined}
                        />
                      )
                    })}
                  </g>
                )
              })}
            </g>
          </g>
        </svg>
      )}
      {ready && interactive && (
        // The canvas edge, lifted off the background by a shadow: an HTML box over the SVG (screen
        // pixels, so the outline and shadow keep their size at any zoom). Its own area stays clear.
        <div
          className="artboard-frame"
          data-paper={darkPaper ? 'dark' : 'light'}
          aria-hidden="true"
          style={
            {
              left: (layout.x - left) / u,
              top: (layout.y + top) / u,
              width: layout.width / u,
              height: layout.height / u,
              '--artboard-edge': edge,
            } as CSSProperties
          }
        />
      )}
      {interactive && ready && gridSize && (
        <p className="canvas-grid-note" aria-hidden="true">
          Snap grid {gridSize} u{grid ? '' : ' · too dense to draw at this zoom'}
        </p>
      )}
      {interactive && markersHidden && (
        <p className="canvas-note" aria-live="polite">
          Zoom in to see skeleton points and vertices (shown from {MARKER_MIN_PX_PER_EM} px per em).
        </p>
      )}
    </div>
  )
}
