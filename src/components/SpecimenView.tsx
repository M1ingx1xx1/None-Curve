import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { LoadedFont } from '../font/model'
import { contoursToPath } from '../geometry/sourcePath'
import type { GlyphRef, PolygonGlyph, SourceGlyph } from '../geometry/types'
import { artboardViewFrame, textBox, type ArtboardLayout } from '../specimen/artboard'
import { measureDraw, probeOn, reportFrame } from '../render/probe'
import { artboardEdgeColor, highlightColor, isDarkColor } from '../specimen/color'
import type { Extent, SpecimenScene } from '../specimen/scene'
import type { ViewParams } from '../state/types'
import { gridLines } from './canvasGuides'
import GlyphLayers from './GlyphLayers'
import { sharedOutlines } from './sharedOutlines'
import SpecimenUnderlay from './SpecimenUnderlay'
import { usePanZoom } from './usePanZoom'

interface SpecimenViewProps {
  font: LoadedFont
  scene: SpecimenScene
  /** Where the artboard sits in scene units; zoom 1 shows the whole artboard. */
  layout: ArtboardLayout
  /** Glyph and background colours; a transparent background is drawn as a checkerboard. */
  ink: string
  paper: string
  /** The colours the selection highlight is computed from (the sliders' own while Sound moves `ink` and `paper`). */
  highlightFrom?: { ink: string; paper: string }
  transparent?: boolean
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
  /**
   * The glyph's outline. With the shared ids below (the canvas), only the vertex markers read it: the view passes null
   * while they are off, so a new outline alone does not re-render the glyph.
   */
  polygon: PolygonGlyph | null
  /** Ids of the shared paths (sharedOutlines, in the view's <defs>) with its outline, font outline and click outline; without them the glyph draws its own. */
  polygonHref?: string | null
  sourceHref?: string
  clickHref?: string | null
  view: ViewParams
  markerRadius: number
  showMarkers: boolean
  selected: boolean
  onSelect: (index: number, text: string) => void
}

/**
 * One glyph of the text. Memoised: when results for other glyphs arrive, or the view pans, the
 * glyphs whose shape and place did not change are not drawn again.
 */
export const SpecimenGlyph = memo(function SpecimenGlyph(props: SpecimenGlyphProps) {
  const { index, text, x, y, advance, skew, ascender, descender, source, polygon, polygonHref, sourceHref, clickHref, view, markerRadius, showMarkers, selected, onSelect } =
    props
  // The click target: the advance by the line (so small text and the inside of letters like "o" are
  // easy to hit) and the drawn outlines. With Thorn, the drawn outlines ignore the pointer (see
  // .specimen-glyph-thorned in styles.css), so thorns reaching across the canvas never catch clicks or
  // drags; an invisible copy of the font's own outline, flattened (PolygonGlyph.clickOutline, straight
  // segments only), takes the letter's clicks instead.
  const ownClick = clickHref === undefined ? polygon?.clickOutline : undefined
  const thorned = clickHref === undefined ? ownClick !== undefined : clickHref !== null
  return (
    <g
      className={`specimen-glyph${selected ? ' specimen-glyph-selected' : ''}${thorned ? ' specimen-glyph-thorned' : ''}`}
      transform={`translate(${x} ${y})${skew} scale(1 -1)`}
      onClick={() => onSelect(index, text)}
    >
      <title>{text}</title>
      <rect className="glyph-box" x={0} y={descender} width={advance} height={ascender - descender} />
      {clickHref && <use className="glyph-box" href={`#${clickHref}`} />}
      {ownClick && <path className="glyph-box" d={contoursToPath(ownClick)} />}
      <GlyphLayers
        source={source}
        polygon={polygon}
        polygonHref={polygonHref}
        sourceHref={sourceHref}
        view={view}
        markerRadius={markerRadius}
        showMarkers={showMarkers}
      />
    </g>
  )
})

/** One outline in the view's <defs>, drawn by every copy of its glyph with <use>; memoised, so it is written again only when its shape changes. */
const SharedPath = memo(function SharedPath({ id, d }: { id: string; d: string }) {
  return <path id={id} d={d} vectorEffect="non-scaling-stroke" />
})

/** From this zoom on, the grid also shows inside the artboard (for placing details precisely). */
const GRID_INSIDE_ZOOM = 2
/** Point markers (skeleton, vertices) are drawn only when an em is at least this many pixels. */
const MARKER_MIN_PX_PER_EM = 48

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
  highlightFrom,
  transparent = false,
  view,
  gridSize,
  selectedGlyph,
  label,
  onViewChange,
  onSelectGlyph,
  onClearSelection,
  onMoveText,
}: SpecimenViewProps) {
  const { unitsPerEm, ascender, descender } = font.metrics

  // Scene coordinates are y down (first baseline at 0); the canvas works in y up. Zoom 1 fits the artboard.
  const frame = useMemo(() => artboardViewFrame(layout), [layout])
  const ids = useId()
  // Selected and hovered glyphs: a colour computed from the text and background to stand out.
  // Searched for (slow, and kept per pair): from the sliders' colours, not every live frame's.
  const highlightInk = highlightFrom?.ink ?? ink
  const highlightPaper = highlightFrom?.paper ?? paper
  const highlight = useMemo(() => highlightColor(highlightInk, highlightPaper), [highlightInk, highlightPaper])
  // The canvas outline: the interface mint rather than the text colour, so it reads as a guide. Its
  // shadow (elevation, styled in .artboard-frame) is dark on a light background and light on a dark one.
  const edge = useMemo(() => artboardEdgeColor(paper), [paper])
  const darkPaper = isDarkColor(paper)
  const block = textBox(scene)
  // Slant around each glyph's baseline: skewX in y-down space leans right for a positive angle.
  const skew = scene.slant ? ` skewX(${-scene.slant})` : ''

  // True while the text is being dragged (Free position); the grid then shows inside the artboard.
  const [draggingText, setDraggingText] = useState(false)
  const { containerRef, ready, u, visW, visH, box, handlers, wasDrag } = usePanZoom(frame, view, onViewChange)
  const { left, right, top, bottom } = box
  const showGridInside = draggingText || view.zoom >= GRID_INSIDE_ZOOM
  const pxPerEm = unitsPerEm / u
  const showMarkers = pxPerEm >= MARKER_MIN_PX_PER_EM
  const markersHidden = (view.showSkeleton || view.showVertices) && !showMarkers
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
  const freeMove = onMoveText !== undefined
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
  // A line or glyph is drawn when its metric box (advance by line, plus an em for overhangs and the
  // original outlines) or its ink is in view, so thorns reaching in from far away do not pop in and out.
  const inView = (b: Extent | null) => b !== null && b.maxX >= left && b.minX <= right && b.maxY >= sceneTop && b.minY <= sceneBottom

  const shared = sharedOutlines(`${ids}-o`)
  // The font's outlines are drawn only in these views; the flattened view needs none of them.
  const needSource = view.outline !== 'flattened' || view.showSkeleton
  const showVertexMarkers = view.showVertices && showMarkers

  const glyphs = scene.lines.map((line, l) => {
    const band = line.baseline - ascender - margin <= sceneBottom && line.baseline - descender + margin >= sceneTop
    if (!band && !inView(line.ink)) return null
    return (
      <g key={l}>
        {line.glyphs.map((g, i) => {
          const near = band && g.x + g.advance + margin >= left && g.x - margin <= right
          if (!near && !inView(g.ink)) return null
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
          const polygon = g.polygon
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
              polygon={showVertexMarkers ? polygon : null}
              polygonHref={polygon ? shared.polygon(g.index, polygon) : null}
              sourceHref={needSource ? shared.source(g.index, source) : undefined}
              clickHref={polygon ? shared.click(g.index, polygon) : null}
              view={view}
              markerRadius={3.5 * u}
              showMarkers={showMarkers}
              selected={selectedGlyph?.index === g.index}
              onSelect={onGlyphSelect}
            />
          )
        })}
      </g>
    )
  })
  const sharedPaths = shared.defs.map(({ id, d }) => <SharedPath key={id} id={id} d={d} />)

  // The measurement probe (?probe=1) and the nc-draw measure: every committed render of the glyphs is a frame drawn.
  const renderStart = performance.now()
  useLayoutEffect(() => {
    if (!ready) return
    const end = performance.now()
    measureDraw('canvas', renderStart, end)
    if (probeOn) reportFrame('canvas', 'svg', end - renderStart, () => scene, (window.devicePixelRatio || 1) / u)
  })

  return (
    <div
      ref={containerRef}
      className="glyph-view specimen-view"
      tabIndex={0}
      role="img"
      aria-label={`${label}. Drag or use arrow keys to pan, scroll or +/− to zoom, 0 to fit. Click a glyph to select it; click empty space or press Escape to clear the highlight.${freeMove ? ' Drag the text to move it.' : ''}`}
      data-free-move={freeMove || undefined}
      {...handlers}
      {...pointer}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {ready && (
        <SpecimenUnderlay
          ids={ids}
          scene={scene}
          layout={layout}
          metrics={font.metrics}
          ink={ink}
          highlight={highlight}
          paper={paper}
          transparent={transparent}
          view={view}
          box={box}
          u={u}
          visW={visW}
          visH={visH}
          grid={grid}
          showGridInside={showGridInside}
          freeMove={freeMove}
          movingRef={movingRef}
          defs={sharedPaths}
        >
          <g>{glyphs}</g>
        </SpecimenUnderlay>
      )}
      {ready && (
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
