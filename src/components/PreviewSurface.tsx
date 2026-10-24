import { useDeferredValue, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ExportError } from '../export/quantize'
import { outlineStrokeWidth, specimenPaths, type SvgPathCache } from '../export/svg'
import type { RenderStyle } from '../render/types'
import type { ArtboardLayout } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { GlideStore } from '../state/useGlide'
import { useDevicePixelRatio } from './useDevicePixelRatio'
import { useGlyphRenderer } from './useGlyphRenderer'

/** Checkerboard squares for a transparent background, in screen pixels (as ExportedArtboard's). */
const CHECKER_PX = 16

interface PreviewSurfaceProps {
  /** The scene glided into; the frames on its way come from `glide`. */
  scene: SpecimenScene
  glide: GlideStore
  layout: ArtboardLayout
  /** Artboard pixels, as the exported file's width and height. */
  width: number
  height: number
  precision: number
  ink: string
  paper: string
  transparent: boolean
  /** Screen pixels per artboard pixel. */
  pixelsPerArtboardPixel: number
  /** Gaussian blur in artboard pixels (as written to the SVG); 0 is off. */
  blur: number
  outlineOnly: boolean
  /** False while Sound moves the letters: the export's check is skipped (ExportedArtboard's `checked`). */
  checked?: boolean
  label: string
  /** The renderer to start with; it falls back to Canvas2D, then calls onFallback (draw with SVG instead). */
  choice: 'canvas' | 'webgl'
  onFallback: () => void
}

/**
 * The preview drawn by a canvas renderer in 'artboard' mode, laid out as ExportedArtboard lays out the SVG: the artboard
 * fitted in its frame, the paper (or a checkerboard) behind the glyphs, nothing outside the artboard, and the blur as a
 * CSS blur on the glyph canvas alone (feGaussianBlur's stdDeviation in screen pixels, clipped to the artboard, so
 * overlapping letters blur together). It follows Glide's store frame by frame, without rendering React. Not live, the
 * export's own builder still runs (deferred) only to report an outline the export would refuse.
 */
export default function PreviewSurface({
  scene,
  glide,
  layout,
  width,
  height,
  precision,
  ink,
  paper,
  transparent,
  pixelsPerArtboardPixel: ppap,
  blur,
  outlineOnly,
  checked = true,
  label,
  choice,
  onFallback,
}: PreviewSurfaceProps) {
  const ids = useId()
  const checkerId = `${ids}-checker`

  // The export's check, as ExportedArtboard runs it (deferred, so a heavy text never holds up the canvas).
  const [cache] = useState<SvgPathCache>(() => new WeakMap())
  const shown = useDeferredValue(
    useMemo(() => ({ scene, layout, precision, checked }), [scene, layout, precision, checked]),
  )
  const error = useMemo(() => {
    if (!shown.checked) return null
    try {
      specimenPaths(shown.scene, shown.layout, shown.precision, cache, true)
      return null
    } catch (e) {
      if (e instanceof ExportError) return e.message
      throw e
    }
  }, [shown, cache])

  const hasCanvas = error === null
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { kind, generation, rendererRef, frameNow, paint } = useGlyphRenderer(choice, canvasRef, {
    mode: 'artboard',
    scene,
    glide,
    source: null,
    onFallback,
    probe: 'preview',
    // A new canvas after an error.
    remount: hasCanvas,
  })

  const cssWidth = width * ppap
  const cssHeight = height * ppap
  const style = useMemo<RenderStyle>(
    () => ({
      colors: { ink, highlight: ink, accent: ink, control: ink, vertex: ink, danger: ink, canvas: paper },
      outline: 'flattened',
      fill: !outlineOnly,
      showSkeleton: false,
      showVertices: false,
      showMarkers: false,
      markerRadius: 0,
      scalingStroke: outlineOnly ? outlineStrokeWidth(layout.unitsPerPx) : null,
      unitsPerEm: 1000,
      ascender: 0,
      descender: 0,
    }),
    [ink, paper, outlineOnly, layout.unitsPerPx],
  )

  const dpr = useDevicePixelRatio()
  useLayoutEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || cssWidth <= 0 || cssHeight <= 0) return
    renderer.setView({ kind: 'artboard', layout, artboard: { width, height }, cssWidth, cssHeight, dpr })
    renderer.setStyle(style)
    renderer.setFrame(frameNow(), null)
    paint()
  }, [
    kind,
    generation,
    hasCanvas,
    layout,
    width,
    height,
    cssWidth,
    cssHeight,
    dpr,
    style,
    scene,
    frameNow,
    paint,
    rendererRef,
  ])

  if (error !== null) return <p className="text-preview-empty font-warning">Export would fail: {error}</p>

  const checker = CHECKER_PX
  return (
    <div className="glyph-view specimen-view-static" role="img" aria-label={label}>
      <div
        className="preview-artboard"
        style={
          {
            left: `calc(50% - ${cssWidth / 2}px)`,
            top: `calc(50% - ${cssHeight / 2}px)`,
            width: cssWidth,
            height: cssHeight,
            background: transparent ? undefined : paper,
            '--artboard-ink': ink,
          } as CSSProperties
        }
      >
        {transparent && (
          <svg className="preview-checker" aria-hidden="true">
            <defs>
              <pattern id={checkerId} patternUnits="userSpaceOnUse" width={checker} height={checker}>
                <rect width={checker} height={checker} fill={paper} />
                <rect className="checker-tint" width={checker / 2} height={checker / 2} />
                <rect
                  className="checker-tint"
                  x={checker / 2}
                  y={checker / 2}
                  width={checker / 2}
                  height={checker / 2}
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${checkerId})`} />
          </svg>
        )}
        <canvas
          key={kind}
          ref={canvasRef}
          className="glyph-canvas"
          aria-hidden="true"
          style={blur > 0 ? { filter: `blur(${blur * ppap}px)` } : undefined}
        />
      </div>
    </div>
  )
}
