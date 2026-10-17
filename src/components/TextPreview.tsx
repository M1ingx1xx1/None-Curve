import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { LoadedFont } from '../font/model'
import { artboardViewFrame, type ArtboardLayout, type ArtboardParams, type PaletteParams } from '../specimen/artboard'
import { MAX_PREVIEW_BLUR, previewBlur, previewColors, type PreviewLook } from '../specimen/previewLook'
import type { SpecimenScene } from '../specimen/scene'
import ErrorBoundary from './ErrorBoundary'
import ExportedArtboard from './ExportedArtboard'
import Icon from './Icon'

interface TextPreviewProps {
  font: LoadedFont | null
  scene: SpecimenScene | null
  layout: ArtboardLayout | null
  palette: PaletteParams
  /** The artboard's size in pixels, as exported. */
  artboard: ArtboardParams
  /** Decimal places of the SVG export: the preview rounds the outlines the same way. */
  precision: number
  /** Blur and inversion live in App so the export dialog can reproduce this view. */
  look: PreviewLook
  /** The canvas's Fill: off, the preview shows outlines only, as the exports draw them. */
  fill: boolean
  onLookChange: (look: PreviewLook) => void
  /** Reports the preview's scale (screen pixels per font unit), so exports can size the blur alike. */
  onScaleChange: (pixelsPerUnit: number) => void
}

/**
 * Bottom right, right part: the SVG export, fitted, with its own blur and colour inversion, for judging
 * the overall shape of the text the way it reads from a distance. The outlines come from the export's
 * own builder (specimenPaths) at the export's precision, so the preview is the exported file: straight-edged
 * outlines on the artboard, filled, or stroked with no fill when the canvas's Fill is off (as the exports), without the canvas's layers, guides, grid or missing-character
 * boxes. Blur and inversion only affect this view unless "Export the preview look" is ticked in the
 * export dialog.
 */
export default function TextPreview({
  font,
  scene,
  layout,
  palette,
  artboard,
  precision,
  look,
  fill,
  onLookChange,
  onScaleChange,
}: TextPreviewProps) {
  const id = useId()
  const { blur, inverted } = look
  const colors = previewColors(palette, look)
  const hasText = font !== null && scene !== null && layout !== null && scene.glyphCount > 0

  // The same fit as the canvas at zoom 1, so the export can turn preview pixels into font units.
  const canvasRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  let scale = 0
  if (hasText && size.width > 0 && size.height > 0) {
    const frame = artboardViewFrame(layout)
    scale = Math.min(size.width / frame.width, size.height / frame.height)
  }
  useEffect(() => onScaleChange(scale), [scale, onScaleChange])

  return (
    <section className="text-preview" aria-labelledby={`${id}-title`}>
      <div className="section-head">
        <h2 id={`${id}-title`}>Preview</h2>
        <div className="text-preview-controls">
          <label htmlFor={`${id}-blur`}>Blur</label>
          <input
            id={`${id}-blur`}
            type="range"
            min={0}
            max={MAX_PREVIEW_BLUR}
            step={0.5}
            value={blur}
            aria-valuetext={blur > 0 ? `${blur} pixels` : 'Off'}
            onChange={(e) => onLookChange({ ...look, blur: Number(e.target.value) })}
          />
          <output htmlFor={`${id}-blur`}>{blur > 0 ? `${blur} px` : 'Off'}</output>
          <button
            type="button"
            className="button-small"
            aria-pressed={inverted}
            title="Swap the text and background colours of the preview"
            onClick={() => onLookChange({ ...look, inverted: !inverted })}
          >
            <Icon name="contrast" />
            Invert
          </button>
        </div>
      </div>
      <div ref={canvasRef} className="text-preview-canvas">
        {hasText ? (
          <ErrorBoundary resetKey={`${font.id}:preview`} label="The preview">
            {scale > 0 && (
              <ExportedArtboard
                scene={scene}
                layout={layout}
                width={artboard.width}
                height={artboard.height}
                precision={precision}
                ink={colors.ink}
                paper={colors.paper}
                transparent={palette.transparent}
                pixelsPerArtboardPixel={scale * layout.unitsPerPx}
                blur={previewBlur(blur, scale, layout.unitsPerPx)}
                outlineOnly={!fill}
                label={`Preview of the export${fill ? '' : ', outlines only'}${inverted ? ', colours inverted' : ''}${blur > 0 ? `, blurred by ${blur} pixels` : ''}`}
              />
            )}
          </ErrorBoundary>
        ) : (
          <p className="text-preview-empty">{font ? 'Type text to preview it here.' : 'Import a font to see a preview.'}</p>
        )}
      </div>
    </section>
  )
}
