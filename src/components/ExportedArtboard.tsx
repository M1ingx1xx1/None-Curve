import { useDeferredValue, useId, useMemo, useState, type CSSProperties } from 'react'
import { ExportError } from '../export/quantize'
import { OUTLINE_MITER_LIMIT, outlineStrokeWidth, specimenPaths, type SpecimenPaths, type SvgPathCache } from '../export/svg'
import { artboardViewFrame, type ArtboardLayout } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'

/** Checkerboard squares for a transparent background, in screen pixels (as on the canvas). */
const CHECKER_PX = 16

interface ExportedArtboardProps {
  scene: SpecimenScene
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
  /** Outlines only (the canvas's Fill off): stroked as the SVG export strokes them, with no fill. */
  outlineOnly: boolean
  /** False while Sound moves the letters: the outlines are only rounded, without the export's check (specimenPaths). */
  checked?: boolean
  label: string
}

/**
 * The exported SVG drawn in place: the same artboard frame, background, blur filter, group transform
 * and glyph paths as specimenToSvg writes, filled or (outlineOnly) stroked. Only a transparent background differs: the file leaves it
 * out, the preview shows it as a checkerboard.
 */
export default function ExportedArtboard({
  scene,
  layout,
  width,
  height,
  precision,
  ink,
  paper,
  transparent,
  pixelsPerArtboardPixel,
  blur,
  outlineOnly,
  checked = true,
  label,
}: ExportedArtboardProps) {
  const ids = useId()
  const blurId = `${ids}-blur`
  const checkerId = `${ids}-checker`
  const shapeId = `${ids}-shape`
  // Rounded outlines by polygon: only the glyphs whose shape changed are rounded again. Deferred, so
  // rounding a heavy text never holds up the canvas (while Sound moves the letters, frames may be skipped here).
  const [cache] = useState<SvgPathCache>(() => new WeakMap())
  const shown = useDeferredValue(useMemo(() => ({ scene, layout, precision, checked }), [scene, layout, precision, checked]))
  const outlines = useMemo<SpecimenPaths | { error: string }>(() => {
    try {
      return specimenPaths(shown.scene, shown.layout, shown.precision, cache, shown.checked)
    } catch (error) {
      if (error instanceof ExportError) return { error: error.message }
      throw error
    }
  }, [shown, cache])
  if ('error' in outlines) return <p className="text-preview-empty font-warning">Export would fail: {outlines.error}</p>

  // Zoom 1 of the canvas: the artboard with its margin (artboardViewFrame), in artboard pixels.
  const frame = artboardViewFrame(layout)
  const frameWidth = frame.width / layout.unitsPerPx
  const frameHeight = frame.height / layout.unitsPerPx
  const checker = CHECKER_PX / pixelsPerArtboardPixel
  return (
    <div className="glyph-view specimen-view-static" role="img" aria-label={label}>
      <svg
        viewBox={`${(width - frameWidth) / 2} ${(height - frameHeight) / 2} ${frameWidth} ${frameHeight}`}
        aria-hidden="true"
        style={{ '--artboard-ink': ink } as CSSProperties}
      >
        {/* The exported file's own frame: nothing outside the artboard shows. */}
        <svg x={0} y={0} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            {transparent && (
              <pattern id={checkerId} patternUnits="userSpaceOnUse" width={checker} height={checker}>
                <rect width={checker} height={checker} fill={paper} />
                <rect className="checker-tint" width={checker / 2} height={checker / 2} />
                <rect className="checker-tint" x={checker / 2} y={checker / 2} width={checker / 2} height={checker / 2} />
              </pattern>
            )}
            {blur > 0 && (
              <filter id={blurId} filterUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
                <feGaussianBlur stdDeviation={blur} />
              </filter>
            )}
          </defs>
          <rect width={width} height={height} fill={transparent ? `url(#${checkerId})` : paper} />
          <g filter={blur > 0 ? `url(#${blurId})` : undefined}>
            <g
              transform={outlines.transform}
              {...(outlineOnly
                ? {
                    fill: 'none',
                    stroke: ink,
                    strokeWidth: outlineStrokeWidth(layout.unitsPerPx),
                    strokeLinejoin: 'miter' as const,
                    strokeMiterlimit: OUTLINE_MITER_LIMIT,
                  }
                : { fill: ink, fillRule: 'nonzero' as const })}
            >
              {/* Each distinct outline once, drawn at every occurrence with <use>: the browser reads it once, and a
                  live frame rewrites only the outlines that changed. The SVG export writes every path in full. */}
              <defs>
                {outlines.shapes.map((d, n) => (
                  <path key={n} id={`${shapeId}-${n}`} d={d} />
                ))}
              </defs>
              {outlines.paths.map((path, i) => (
                <use key={i} transform={path.transform} href={`#${shapeId}-${path.shape}`} />
              ))}
            </g>
          </g>
        </svg>
      </svg>
    </div>
  )
}
