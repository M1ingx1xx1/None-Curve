import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import type { LoadedFont } from '../font/model'
import type { GlyphRef, SourceGlyph } from '../geometry/types'
import { hitBlock } from '../render/hitTest'
import { probeReader, ThemeColors } from '../render/theme'
import type { RenderHit, RenderStyle, SourceLookup } from '../render/types'
import { artboardEdgeColor, highlightColor, isDarkColor } from '../specimen/color'
import { artboardViewFrame, textBox, type ArtboardLayout } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { GlideStore } from '../state/useGlide'
import type { ViewParams } from '../state/types'
import { gridLines } from './canvasGuides'
import SpecimenUnderlay from './SpecimenUnderlay'
import { useDevicePixelRatio } from './useDevicePixelRatio'
import { usePanZoom } from './usePanZoom'
import { useGlyphRenderer } from './useGlyphRenderer'
import { CANVAS_KEYS, glyphRefOf, useTextDrag, type MoveText } from './useTextDrag'

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
  /** Free position: called once, on release, with the move in font units (MoveText). */
  onMoveText?: MoveText
}

/** From this zoom on, the grid also shows inside the artboard (SpecimenView's GRID_INSIDE_ZOOM). */
const GRID_INSIDE_ZOOM = 2
/** Point markers are drawn only when an em is at least this many pixels (SpecimenView's MARKER_MIN_PX_PER_EM). */
const MARKER_MIN_PX_PER_EM = 48
/** A resting pointer's hover is tested again at most this often while the view or the letters move (ms). */
const HOVER_AGAIN_MS = 100

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

  const panZoom = usePanZoom(frame, view, onViewChange)
  const { containerRef, ready, u, visW, visH, size, box, handlers } = panZoom
  const { left, top } = box
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

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const detailRef = useRef<HTMLCanvasElement>(null)
  // Device pixels per font unit, for the probe.
  const scale = useRef(1)
  // After a view or frame change the pointer may rest on another glyph: its hit test runs again (hoverAgain, below).
  const hoverAgain = useRef<() => void>(() => {})
  const { kind, generation, rendererRef, frameNow, paint } = useGlyphRenderer(choice, canvasRef, {
    mode: 'full',
    scene,
    glide,
    source,
    detailRef,
    onFallback,
    probe: 'canvas',
    probeScale: () => scale.current,
    onFrame: () => hoverAgain.current(),
  })

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
  }, [
    theme,
    themeVersion,
    ink,
    highlight,
    view.outline,
    view.showFill,
    view.showSkeleton,
    view.showVertices,
    showMarkers,
    u,
    unitsPerEm,
    ascender,
    descender,
  ])

  // View, style and selection, then a draw: in a layout effect, so the canvas changes with the underlay.
  const dpr = useDevicePixelRatio()
  useLayoutEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !ready || !style) return
    scale.current = dpr / u
    // The element's own (fractional) size, as `u` is, so the backing store matches the outlines' pixels.
    renderer.setView({ kind: 'canvas', left, top, u, cssWidth: size.width, cssHeight: size.height, dpr })
    renderer.setStyle(style)
    renderer.setSelected(selectedGlyph?.index ?? null)
    renderer.setFrame(frameNow(), source)
    paint()
    hoverAgain.current()
  }, [
    kind,
    generation,
    ready,
    style,
    left,
    top,
    u,
    size,
    dpr,
    selectedGlyph,
    source,
    scene,
    frameNow,
    paint,
    rendererRef,
  ])

  // ---- Pointer ----

  const freeMove = onMoveText !== undefined
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
    // The block is the layout's (a morph changes outlines, not where the text sits), so no morph is made for it.
    const shown = frameNow().layout ?? scene
    return hitBlock(shown, left + x * u, -top + y * u, offset.current.dx, offset.current.dy) ? { kind: 'block' } : null
  }

  const hovered = useRef<number | null>(null)
  // Where the pointer rests over the canvas with no button down (client px), or null.
  const resting = useRef<{ x: number; y: number } | null>(null)
  const hoverFrame = useRef<number | null>(null)
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

  // Pan and zoom, Escape, and Free drag, as SpecimenView; the underlay's moving group and the renderer move together.
  const { draggingText, movingRef, offset, dragged, pointer, onKeyDown, announcement } = useTextDrag({
    scene,
    layout,
    u,
    panZoom,
    onMoveText,
    onClearSelection,
    startsOnText: (e) => {
      const hit = hitAt(e.clientX, e.clientY)
      return hit?.kind === 'glyph' || hit?.kind === 'block'
    },
    onOffset: (dx, dy) => {
      rendererRef.current?.setTextOffset(dx, dy)
      paint()
    },
    onHover: (e) => {
      resting.current = e.buttons === 0 ? { x: e.clientX, y: e.clientY } : null
      if (e.buttons === 0) showHover(hitAt(e.clientX, e.clientY))
    },
    onLeave: () => {
      resting.current = null
      showHover(null)
    },
    selection: { font, selected: selectedGlyph, onSelect: onSelectGlyph },
  })
  // The hit test again where the pointer rests (a wheel zoom, a pan, a glide), at most every HOVER_AGAIN_MS: Sound
  // glides every frame, and a hit test per frame would cost as much as drawing.
  const hoverLast = useRef(-Infinity)
  hoverAgain.current = () => {
    if (hoverFrame.current !== null || !resting.current) return
    const wait = Math.max(0, hoverLast.current + HOVER_AGAIN_MS - performance.now())
    hoverFrame.current = window.setTimeout(() => {
      hoverFrame.current = null
      hoverLast.current = performance.now()
      const at = resting.current
      if (at) showHover(hitAt(at.x, at.y))
    }, wait)
  }
  useEffect(
    () => () => {
      if (hoverFrame.current !== null) clearTimeout(hoverFrame.current)
    },
    [],
  )
  const showGridInside = draggingText || view.zoom >= GRID_INSIDE_ZOOM

  // A click on a glyph selects it; one on empty space (or a missing box, or the block) clears the highlight; neither
  // after a drag.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (dragged()) return
    const hit = hitAt(e.clientX, e.clientY)
    if (hit?.kind === 'glyph') onSelectGlyph(glyphRefOf(font, hit.index, hit.text))
    else onClearSelection?.()
  }

  return (
    <div
      ref={containerRef}
      className="glyph-view specimen-view"
      tabIndex={0}
      role="application"
      aria-roledescription="canvas"
      aria-label={`${label}. ${CANVAS_KEYS}${freeMove ? ' Drag the text to move it.' : ''}`}
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
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {markersHidden && (
        <p className="canvas-note" aria-live="polite">
          Zoom in to see skeleton points and vertices (shown from {MARKER_MIN_PX_PER_EM} px per em).
        </p>
      )}
    </div>
  )
}
