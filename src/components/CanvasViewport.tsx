import { memo, useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import type { GlyphRef } from '../geometry/types'
import { textOverflows, type ArtboardLayout, type ArtboardParams, type PaletteParams } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import CanvasSizeControls from './CanvasSizeControls'
import { useGeometryProblem } from '../state/geometryClient'
import { panZoomStore, usePanZoomState } from '../state/canvasView'
import type { DocumentState, OutlineView, PanZoom, ViewParams, ViewToggles } from '../state/types'
import type { GlideStore } from '../state/useGlide'
import { RENDERER_CHOICE } from '../render/createRenderer'
import ErrorBoundary from './ErrorBoundary'
import FileDropTarget from './FileDropTarget'
import Glided from './Glided'
import GlyphSurface from './GlyphSurface'
import SpecimenView from './SpecimenView'
import { clampZoom } from './usePanZoom'
import type { MoveText } from './useTextDrag'
import Icon from './Icon'

interface CanvasViewportProps {
  document: DocumentState
  /** The outline and layer buttons; zoom and pan live in the canvas's own store (state/canvasView.ts). */
  view: ViewToggles
  scene: SpecimenScene | null
  /** The artboard the text is set on, its colours, and its size settings. */
  layout: ArtboardLayout | null
  /**
   * The scene `layout` places the text by (useGeometry): the sliders' own letters while Sound drives them, so
   * the edge warning does not follow the live frames. Defaults to `scene`.
   */
  placement?: SpecimenScene | null
  /** The colours as shown (Sound's while it drives them). */
  palette: PaletteParams
  /** The sliders' own colours, which the selection highlight is computed from (so it holds still while Sound moves them). */
  ownPalette?: PaletteParams
  artboard: ArtboardParams
  onArtboardChange: (patch: Partial<ArtboardParams>) => void
  /** Snapping grid spacing to draw, or null when snapping is off. */
  gridSize: number | null
  /** False after a click on empty canvas: the selected glyph is no longer highlighted. */
  highlightSelection: boolean
  onSelectGlyph: (glyph: GlyphRef) => void
  onClearHighlight: () => void
  /** Set while the text has a Free position: dragging the text on the canvas moves it. */
  onMoveText?: MoveText
  onViewChange: (patch: Partial<ViewToggles>) => void
  onLocalFile: (file: File) => void
  onOpenGoogleFonts: () => void
  /** About the session restored from the last visit (a font to import again), or null. */
  note?: string | null
  /**
   * Glide's store, for a canvas renderer (?render=canvas or webgl): `scene` is then the scene glided into, and the
   * glyphs are drawn from the store frame by frame. Without it (the SVG renderer), `scene` is the frame as shown.
   */
  glide?: GlideStore
}

const SIZE_OPEN_KEY = 'none-curve:canvas-size-open'

export const outlineViews: { value: OutlineView; label: string; description: string }[] = [
  { value: 'source', label: 'Original', description: 'Original font curves' },
  { value: 'flattened', label: 'Flattened', description: 'Final polygon after the whole pipeline (straight edges only)' },
  { value: 'compare', label: 'Compare', description: 'Final polygon with the original curves overlaid' },
]

const toggles: { key: 'showFill' | 'showSkeleton' | 'showVertices' | 'showMetrics'; label: string; title?: string }[] = [
  { key: 'showFill', label: 'Fill', title: 'Off: outlines only, here, in the preview, and in SVG, PNG and video exports' },
  { key: 'showSkeleton', label: 'Skeleton' },
  { key: 'showVertices', label: 'Vertices' },
  { key: 'showMetrics', label: 'Metrics' },
]

export function Legend({ view }: { view: ViewToggles }) {
  if (!(view.showSkeleton || view.showVertices || view.outline === 'compare')) return null
  return (
    <ul className="skeleton-legend" aria-label="Legend">
      {view.outline === 'compare' && (
        <>
          <li>
            <span className="legend-polygon" aria-hidden="true" /> Final polygon
          </li>
          <li>
            <span className="legend-source" aria-hidden="true" /> Original
          </li>
        </>
      )}
      {view.showSkeleton && (
        <>
          <li>
            <span className="legend-anchor" aria-hidden="true" /> On-curve anchor
          </li>
          <li>
            <span className="legend-control" aria-hidden="true" /> Off-curve control
          </li>
          <li>
            <span className="legend-handle" aria-hidden="true" /> Handle
          </li>
        </>
      )}
      {view.showVertices && (
        <li>
          <span className="legend-vertex" aria-hidden="true" /> Polygon vertex
        </li>
      )}
    </ul>
  )
}

/**
 * Top right: the result canvas. It shows only the text from the input, set with the current font
 * and every geometry parameter. The outline and layer controls are for this canvas only, except Fill:
 * off, the preview and the SVG, PNG and video exports draw outlines only too. The preview shows the export.
 */
function CanvasViewport(props: CanvasViewportProps) {
  const {
    document,
    view,
    scene,
    layout,
    placement,
    palette,
    ownPalette = palette,
    artboard,
    onArtboardChange,
    gridSize,
    highlightSelection,
    onSelectGlyph,
    onClearHighlight,
    onMoveText,
    onViewChange,
    onLocalFile,
    onOpenGoogleFonts,
    note,
    glide,
  } = props
  const { font, selectedGlyph } = document
  // Zoom and pan re-render this canvas only, not the app around it.
  const panZoom = usePanZoomState()
  const canvasView = useMemo<ViewParams>(() => ({ ...view, ...panZoom }), [view, panZoom])
  // The renderers change the whole view: zoom and pan go to the canvas's store, the buttons to App.
  const onCanvasViewChange = useCallback(
    (patch: Partial<ViewParams>) => {
      const { zoom, panX, panY, ...toggles } = patch
      const move: Partial<PanZoom> = {}
      if (zoom !== undefined) move.zoom = zoom
      if (panX !== undefined) move.panX = panX
      if (panY !== undefined) move.panY = panY
      panZoomStore.update(move)
      if (Object.keys(toggles).length > 0) onViewChange(toggles)
    },
    [onViewChange],
  )
  // The geometry worker cannot compute glyphs (it could not start, or keeps failing): the glyphs show as failed.
  const problem = useGeometryProblem()
  const [dragging, setDragging] = useState(false)
  // A canvas renderer that could not start (no 2D context either): the SVG renderer draws the glyphs instead.
  const [svgFallback, setSvgFallback] = useState(false)
  const onRendererFallback = useCallback(() => setSvgFallback(true), [])
  const canvasRenderer = glide !== undefined && RENDERER_CHOICE !== 'svg' && !svgFallback
  // The canvas size drawer below the canvas; remembered per browser.
  const [sizeOpen, setSizeOpen] = useState(() => {
    try {
      return localStorage.getItem(SIZE_OPEN_KEY) === 'true'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(SIZE_OPEN_KEY, String(sizeOpen))
    } catch {
      // Not remembered; the drawer still works for this visit.
    }
  }, [sizeOpen])

  const interactive = font !== null && scene !== null && layout !== null && scene.glyphCount > 0
  // Text outside the artboard is shown on the canvas but cut off in the preview and in exports.
  // Measured on the letters' outlines, so text set flush against an edge is fine; thorns past the edge
  // are intended and do not count. While Sound drives the letters, measured on the sliders' own letters, which
  // place the block and are what the exports show.
  const overflows = interactive && textOverflows(placement ?? scene, layout)
  const zoomBy = (factor: number) => panZoomStore.update({ zoom: clampZoom(panZoomStore.getState().zoom * factor) })
  const outlineDescription = outlineViews.find((o) => o.value === view.outline)?.description ?? ''

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }, [])
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onLocalFile(file)
  }

  // The SVG renderer's canvas for the scene as shown.
  const specimen = (shown: SpecimenScene) =>
    interactive && (
      <SpecimenView
        font={font}
        scene={shown}
        layout={layout}
        ink={palette.ink}
        paper={palette.paper}
        highlightFrom={ownPalette}
        transparent={palette.transparent}
        view={canvasView}
        gridSize={gridSize}
        selectedGlyph={highlightSelection ? selectedGlyph : null}
        label={`Text, ${outlineDescription}`}
        onViewChange={onCanvasViewChange}
        onSelectGlyph={onSelectGlyph}
        onClearSelection={onClearHighlight}
        onMoveText={onMoveText}
      />
    )

  return (
    <section
      className="viewport"
      aria-label="Result canvas"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="viewport-toolbar" role="toolbar" aria-label="Canvas">
        <div className="segmented" role="group" aria-label="Outline">
          {outlineViews.map(({ value, label, description }) => (
            <button
              key={value}
              type="button"
              disabled={!font}
              aria-pressed={view.outline === value}
              title={description}
              onClick={() => onViewChange({ outline: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Layers">
          {toggles.map(({ key, label, title }) => (
            <button
              key={key}
              type="button"
              disabled={!font}
              aria-pressed={view[key]}
              title={title}
              onClick={() => onViewChange({ [key]: !view[key] })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" disabled={!interactive} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
            −
          </button>
          <output className="zoom-value" aria-label="Zoom level">
            {Math.round(panZoom.zoom * 100)}%
          </output>
          <button type="button" disabled={!interactive} aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
            +
          </button>
          <button type="button" disabled={!interactive} onClick={panZoomStore.reset}>
            <Icon name="fitView" />
            Fit
          </button>
        </div>
      </div>

      <div className="canvas">
        {!font && (
          <div className="canvas-empty">
            <FileDropTarget onLocalFile={onLocalFile} onOpenGoogleFonts={onOpenGoogleFonts} />
          </div>
        )}

        {interactive && (
          <ErrorBoundary resetKey={`${font.id}:text`} label="The canvas">
            {glide === undefined ? (
              specimen(scene)
            ) : canvasRenderer ? (
              <GlyphSurface
                font={font}
                scene={scene}
                glide={glide}
                layout={layout}
                ink={palette.ink}
                paper={palette.paper}
                highlightFrom={ownPalette}
                transparent={palette.transparent}
                view={canvasView}
                gridSize={gridSize}
                selectedGlyph={highlightSelection ? selectedGlyph : null}
                label={`Text, ${outlineDescription}`}
                choice={RENDERER_CHOICE === 'canvas' ? 'canvas' : 'webgl'}
                onFallback={onRendererFallback}
                onViewChange={onCanvasViewChange}
                onSelectGlyph={onSelectGlyph}
                onClearSelection={onClearHighlight}
                onMoveText={onMoveText}
              />
            ) : (
              <Glided store={glide} scene={scene}>
                {(shown) => specimen(shown ?? scene)}
              </Glided>
            )}
            <p className="canvas-badge" aria-hidden="true">
              {scene.glyphCount} glyphs · {outlineDescription}
              {/* Glyphs still being computed in the background keep their previous shape meanwhile. */}
              {scene.pendingGlyphs > 0 && <span className="canvas-updating"> · Updating {scene.pendingGlyphs}…</span>}
            </p>
            <Legend view={view} />
            {overflows && (
              <p className="canvas-overflow" role="status">
                The text runs past the canvas edge and will be cut off in the preview and in exports. Try Typography → Fit
                text.
              </p>
            )}
          </ErrorBoundary>
        )}
        {font && !interactive && (
          <div className="canvas-empty">
            <p className="canvas-message">Type text in the input (bottom right) to preview it here.</p>
          </div>
        )}

        {note && (
          <p className="canvas-note" role="status">
            {note}
          </p>
        )}
        {font && problem && (
          <p className="canvas-note canvas-note-error" role="alert">
            {problem}
          </p>
        )}

        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            Drop to import
          </div>
        )}
      </div>

      <div className="canvas-size" data-open={sizeOpen}>
        <button
          type="button"
          className="canvas-size-toggle"
          aria-expanded={sizeOpen}
          aria-controls="canvas-size-controls"
          onClick={() => setSizeOpen((open) => !open)}
        >
          <span>Canvas size</span>
          <span className="canvas-size-summary">
            {artboard.width} × {artboard.height} px · {artboard.scale}×
          </span>
          <span aria-hidden="true">{sizeOpen ? '▾' : '▴'}</span>
        </button>
        <div id="canvas-size-controls" hidden={!sizeOpen}>
          <CanvasSizeControls params={artboard} onChange={onArtboardChange} />
        </div>
      </div>
    </section>
  )
}

export default memo(CanvasViewport)
