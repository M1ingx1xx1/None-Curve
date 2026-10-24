import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { LoadedFont } from '../font/model'
import type { GlyphRef, SourceGlyph } from '../geometry/types'
import { createRenderer, effectiveOf, fallbackOf } from '../render/createRenderer'
import { hitBlock } from '../render/hitTest'
import { measureDraw, probeOn, reportFrame } from '../render/probe'
import { probeReader, ThemeColors } from '../render/theme'
import type { GlideFrame, GlyphRenderer, RenderHit, RenderStyle, SourceLookup } from '../render/types'
import { artboardEdgeColor, highlightColor, isDarkColor } from '../specimen/color'
import { artboardViewFrame, textBox, type ArtboardLayout } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { GlideStore } from '../state/useGlide'
import type { ViewParams } from '../state/types'
import { gridLines } from './canvasGuides'
import SpecimenUnderlay from './SpecimenUnderlay'
import { useDevicePixelRatio } from './useDevicePixelRatio'
import { usePanZoom } from './usePanZoom'

interface GlyphSurfaceProps {
  font: LoadedFont
  /** The scene glided into (the target); the frames on its way come from `glide`. */
  scene: SpecimenScene
  glide: GlideStore
  layout: ArtboardLayout
  ink: string
  paper: string
  highlightFrom?: { ink: string; paper: string }
  transparent?: boolean
  view: ViewParams
  gridSize: number | null
  selectedGlyph: GlyphRef | null
  label: string
  /** The renderer to start with; it falls back to Canvas2D, then calls onFallback (draw with SVG instead). */
  choice: 'canvas' | 'webgl'
  onFallback: () => void
  onViewChange: (patch: Partial<ViewParams>) => void
  onSelectGlyph: (glyph: GlyphRef) => void
  onClearSelection?: () => void
  onMoveText?: (dx: number, dy: number) => void
}

/** From this zoom on, the grid also shows inside the artboard (SpecimenView's GRID_INSIDE_ZOOM). */
const GRID_INSIDE_ZOOM = 2
/** Point markers are drawn only when an em is at least this many pixels (SpecimenView's MARKER_MIN_PX_PER_EM). */
const MARKER_MIN_PX_PER_EM = 48

/** A frame with nothing gliding: the scene as it is. */
function stillFrame(scene: SpecimenScene): GlideFrame {
  return { target: scene, layout: scene, morphs: null, scene: () => scene }
}

/** Same metric guides and text block: the underlay need not render again. */
function sameGuides(a: SpecimenScene, b: SpecimenScene): boolean {
  if (a === b) return true
  if (a.lines.length !== b.lines.length) return false
  for (let i = 0; i < a.lines.length; i++) if (a.lines[i].baseline !== b.lines[i].baseline) return false
  const p = textBox(a)
  const q = textBox(b)
  return p.minX === q.minX && p.minY === q.minY && p.width === q.width && p.height === q.height
}

/**
 * The scene the underlay's guides follow: Glide's frame (its lines move with Sound's line height), changing only when
 * the baselines or the text block do, so the underlay does not render with every animation frame.
 */
function useGuideScene(store: GlideStore, scene: SpecimenScene): SpecimenScene {
  const shown = useRef(scene)
  const read = useCallback(() => {
    const snapshot = store.getSnapshot()
    const next = snapshot.target === scene && snapshot.frame.layout ? snapshot.frame.layout : scene
    if (!sameGuides(shown.current, next)) shown.current = next
    return shown.current
  }, [store, scene])
  return useSyncExternalStore(store.subscribe, read)
}

/**
 * The result canvas drawn by a canvas renderer (Canvas2D or WebGL2, render/): the SVG underlay (background, grids,
 * guides) with the glyphs on a canvas above, taken from Glide's store frame by frame without rendering React. It does
 * what SpecimenView does for the SVG renderer: pan and zoom, hover, click to select, Escape, and Free drag, with the
 * targets found by hit testing (render/hitTest.ts) instead of by the browser.
 */
export default function GlyphSurface({
  font,
  scene,
  glide,
  layout,
  ink,
  paper,
  highlightFrom,
  transparent = false,
  view,
  gridSize,
  selectedGlyph,
  label,
  choice,
  onFallback,
  onViewChange,
  onSelectGlyph,
  onClearSelection,
  onMoveText,
}: GlyphSurfaceProps) {
  const { unitsPerEm, ascender, descender } = font.metrics
  const frame = useMemo(() => artboardViewFrame(layout), [layout])
  const ids = useId()
  const highlightInk = highlightFrom?.ink ?? ink
  const highlightPaper = highlightFrom?.paper ?? paper
  const highlight = useMemo(() => highlightColor(highlightInk, highlightPaper), [highlightInk, highlightPaper])
  const edge = useMemo(() => artboardEdgeColor(paper), [paper])
  const darkPaper = isDarkColor(paper)

  const [draggingText, setDraggingText] = useState(false)
  const { containerRef, ready, u, visW, visH, box, handlers, wasDrag } = usePanZoom(frame, view, onViewChange)
  const { left, top } = box
  const showGridInside = draggingText || view.zoom >= GRID_INSIDE_ZOOM
  const pxPerEm = unitsPerEm / u
  const showMarkers = pxPerEm >= MARKER_MIN_PX_PER_EM
  const markersHidden = (view.showSkeleton || view.showVertices) && !showMarkers
  const grid = ready ? gridLines(box, gridSize, u) : null
  const guideScene = useGuideScene(glide, scene)

  // The font's outlines by glyph index, read once each.
  const source = useMemo<SourceLookup>(() => {
    const sources = new Map<number, SourceGlyph | null>()
    return (index) => {
      if (!sources.has(index)) {
        try {
          sources.set(index, font.getGlyph(index))
        } catch {
          sources.set(index, null)
        }
      }
      return sources.get(index) ?? null
    }
  }, [font])

  // ---- The renderer ----

  // The renderer kind drawing now; a new kind gets fresh canvases (one that gave a WebGL context gives no 2D one).
  const [kind, setKind] = useState<'canvas' | 'webgl'>(choice)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const detailRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GlyphRenderer | null>(null)
  const latest = useRef({ scene, still: stillFrame(scene), u, dpr: 1 })
  const still = useMemo(() => stillFrame(scene), [scene])
  latest.current.scene = scene
  latest.current.still = still
  latest.current.u = u
  const frameNow = useCallback((): GlideFrame => {
    const snapshot = glide.getSnapshot()
    return snapshot.target === latest.current.scene ? snapshot.frame : latest.current.still
  }, [glide])

  /** Draws now if anything changed, and reports the frame to the probe. */
  /** Gives the renderer up (fallBack, below): set once fallBack is made. */
  const broke = useRef<() => void>(() => {})
  const paint = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer || renderer.broken) return
    const start = performance.now()
    let drew: boolean
    try {
      drew = renderer.draw()
    } catch (error) {
      // A renderer that throws is given up like a lost one: the next renderer draws from here on.
      console.error('The glyph renderer failed; falling back', error)
      broke.current()
      return
    }
    if (!drew) return
    const end = performance.now()
    const ms = end - start
    measureDraw('canvas', start, end)
    if (probeOn) {
      const shown = frameNow()
      reportFrame('canvas', effectiveOf(renderer), ms, () => shown.scene(), latest.current.dpr / latest.current.u)
    }
  }, [frameNow])

  const fallBack = useCallback(() => {
    rendererRef.current?.dispose()
    rendererRef.current = null
    const next = fallbackOf(kind)
    if (next === 'svg') onFallback()
    else setKind(next)
  }, [kind, onFallback])
  broke.current = fallBack

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = createRenderer(kind, canvas, { mode: 'full', detailCanvas: detailRef.current, onLost: () => fallBack() })
    if (!renderer) {
      fallBack()
      return
    }
    rendererRef.current = renderer
    return () => {
      renderer.dispose()
      if (rendererRef.current === renderer) rendererRef.current = null
    }
    // fallBack changes with kind only, which already re-runs this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // The interface colours, resolved from the stylesheet and again when the theme changes.
  const [theme, setTheme] = useState<ThemeColors | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const colors = new ThemeColors(probeReader(container))
    const stop = colors.subscribe(() => setThemeVersion((v) => v + 1))
    setTheme(colors)
    return () => {
      stop()
      colors.dispose()
    }
  }, [containerRef])

  const style = useMemo<RenderStyle | null>(() => {
    if (!theme) return null
    return {
      colors: { ...theme.get(), ink, highlight },
      outline: view.outline,
      fill: view.showFill,
      showSkeleton: view.showSkeleton,
      showVertices: view.showVertices,
      showMarkers,
      markerRadius: 3.5 * u,
      scalingStroke: null,
      unitsPerEm,
      ascender,
      descender,
    }
    // themeVersion: the theme changed, so theme.get() resolves again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, themeVersion, ink, highlight, view.outline, view.showFill, view.showSkeleton, view.showVertices, showMarkers, u, unitsPerEm, ascender, descender])

  // View, style and selection, then a draw: in a layout effect, so the canvas changes with the underlay.
  const dpr = useDevicePixelRatio()
  useLayoutEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !ready || !style) return
    latest.current.dpr = dpr
    const el = containerRef.current
    renderer.setView({ kind: 'canvas', left, top, u, cssWidth: el?.clientWidth ?? visW / u, cssHeight: el?.clientHeight ?? visH / u, dpr })
    renderer.setStyle(style)
    renderer.setSelected(selectedGlyph?.index ?? null)
    renderer.setFrame(frameNow(), source)
    paint()
  }, [kind, ready, style, left, top, u, visW, visH, dpr, selectedGlyph, source, scene, frameNow, paint, containerRef])

  // Every frame of Glide, straight to the renderer.
  useEffect(
    () =>
      glide.subscribe(() => {
        const renderer = rendererRef.current
        if (!renderer) return
        renderer.setFrame(frameNow(), source)
        paint()
      }),
    [glide, frameNow, source, paint, kind],
  )

  // ---- Pointer ----

  const selectRef = (index: number, text: string): GlyphRef => {
    const cp = text.codePointAt(0)
    return (
      font.characters.find((c) => c.index === index && c.unicode === cp) ??
      font.characters.find((c) => c.index === index) ?? { index, name: '', unicode: null }
    )
  }

  const freeMove = onMoveText !== undefined
  const movingRef = useRef<SVGGElement>(null)
  const textDrag = useRef<{ x: number; y: number; moved: boolean; dx: number; dy: number } | null>(null)
  const textMoved = useRef(false)
  const committed = useRef(false)
  const offset = useRef({ dx: 0, dy: 0 })
  const dragged = () => wasDrag() || textMoved.current
  // The underlay's moving group and the renderer move together (SpecimenView's moving <g>).
  const setOffset = (dx: number, dy: number) => {
    offset.current = { dx, dy }
    if (dx || dy) movingRef.current?.setAttribute('transform', `translate(${dx} ${dy})`)
    else movingRef.current?.removeAttribute('transform')
    rendererRef.current?.setTextOffset(dx, dy)
    paint()
  }
  useLayoutEffect(() => {
    if (!committed.current) return
    committed.current = false
    setOffset(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  /** What is under the pointer: a glyph or missing box (the renderer), else the text block (Free position). */
  const hitAt = (clientX: number, clientY: number): RenderHit | null => {
    const el = containerRef.current
    const renderer = rendererRef.current
    if (!el || !renderer || !ready) return null
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const hit = renderer.hitTest(x, y)
    if (hit) return hit
    if (!freeMove) return null
    const shown = frameNow().scene() ?? scene
    return hitBlock(shown, left + x * u, -top + y * u, offset.current.dx, offset.current.dy) ? { kind: 'block' } : null
  }

  const hovered = useRef<number | null>(null)
  const showHover = (hit: RenderHit | null) => {
    const el = containerRef.current
    const occurrence = hit?.kind === 'glyph' ? hit.occurrence : null
    if (occurrence !== hovered.current) {
      hovered.current = occurrence
      rendererRef.current?.setHover(occurrence)
      paint()
    }
    if (!el) return
    el.style.cursor = hit?.kind === 'glyph' ? (freeMove ? 'move' : 'pointer') : hit?.kind === 'block' ? 'move' : ''
    el.title = hit?.kind === 'glyph' ? hit.text : hit?.kind === 'missing' ? `Missing from the font: ${hit.text}` : ''
  }

  const pointer = {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (freeMove && e.button === 0) {
        const hit = hitAt(e.clientX, e.clientY)
        if (hit?.kind === 'glyph' || hit?.kind === 'block') {
          committed.current = false
          setOffset(0, 0)
          textDrag.current = { x: e.clientX, y: e.clientY, moved: false, dx: 0, dy: 0 }
          return
        }
      }
      handlers.onPointerDown(e)
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const d = textDrag.current
      if (!d) {
        handlers.onPointerMove(e)
        if (e.buttons === 0) showHover(hitAt(e.clientX, e.clientY))
        return
      }
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
      const block = textBox(scene)
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
    onPointerLeave() {
      if (!textDrag.current) showHover(null)
    },
  }

  // A click on a glyph selects it; one on empty space (or a missing box, or the block) clears the highlight; neither
  // after a drag.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (dragged()) return
    const hit = hitAt(e.clientX, e.clientY)
    if (hit?.kind === 'glyph') onSelectGlyph(selectRef(hit.index, hit.text))
    else onClearSelection?.()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && e.target === e.currentTarget && onClearSelection) {
      e.preventDefault()
      onClearSelection()
    } else handlers.onKeyDown(e)
  }

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
          scene={guideScene}
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
        />
      )}
      <canvas key={`${kind}-glyphs`} ref={canvasRef} className="glyph-canvas" aria-hidden="true" />
      {kind === 'webgl' && <canvas key="detail" ref={detailRef} className="glyph-canvas" aria-hidden="true" />}
      {ready && (
        // The canvas edge, lifted off the background by a shadow (as in SpecimenView).
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
