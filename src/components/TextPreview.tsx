import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { LoadedFont } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import { artboardViewFrame, type ArtboardLayout, type PaletteParams } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { ViewParams } from '../state/types'
import ErrorBoundary from './ErrorBoundary'
import SpecimenView from './SpecimenView'

interface TextPreviewProps {
  font: LoadedFont | null
  scene: SpecimenScene | null
  layout: ArtboardLayout | null
  palette: PaletteParams
  /** Outline and layer settings of the result canvas; zoom and pan are ignored (always fitted). */
  view: ViewParams
  gridSize: number | null
  selectedGlyph: GlyphRef | null
  /** Blur and inversion live in App so the export dialog can reproduce this view. */
  look: PreviewLook
  onLookChange: (look: PreviewLook) => void
  /** Reports the preview's scale (screen pixels per font unit), so exports can size the blur alike. */
  onScaleChange: (pixelsPerUnit: number) => void
}

export interface PreviewLook {
  /** Blur radius in screen pixels of this preview; 0 is off. */
  blur: number
  /** Swap the palette's text and background colours. */
  inverted: boolean
}

export const DEFAULT_PREVIEW_LOOK: PreviewLook = { blur: 0, inverted: false }

/** The preview's colours: the palette, swapped when inverted. */
export function previewColors(palette: PaletteParams, look: PreviewLook): PaletteParams {
  return look.inverted ? { ink: palette.paper, paper: palette.ink } : palette
}

const MAX_BLUR = 12
const FITTED = { zoom: 1, panX: 0, panY: 0 }
const ignoreViewChange = () => {}
const ignoreSelect = () => {}

/**
 * Bottom right, right part: the artboard as it will be exported, fitted, with its own blur and colour
 * inversion, for judging the overall shape of the text the way it reads from a distance. Blur and
 * inversion only affect this view unless "Export the preview look" is ticked in the export dialog.
 */
export default function TextPreview({
  font,
  scene,
  layout,
  palette,
  view,
  gridSize,
  selectedGlyph,
  look,
  onLookChange,
  onScaleChange,
}: TextPreviewProps) {
  const id = useId()
  const { blur, inverted } = look
  const colors = previewColors(palette, look)
  const hasText = font !== null && scene !== null && layout !== null && scene.glyphCount > 0

  // The same fit as SpecimenView at zoom 1, so the export can turn preview pixels into font units.
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
            max={MAX_BLUR}
            step={0.5}
            value={blur}
            aria-valuetext={blur > 0 ? `${blur} pixels` : 'Off'}
            aria-describedby={`${id}-hint`}
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
            Invert
          </button>
        </div>
      </div>
      <div ref={canvasRef} className="text-preview-canvas">
        {hasText ? (
          <ErrorBoundary resetKey={`${font.id}:preview`} label="The preview">
            <SpecimenView
              font={font}
              scene={scene}
              layout={layout}
              ink={colors.ink}
              paper={colors.paper}
              clip
              view={{ ...view, ...FITTED }}
              gridSize={gridSize}
              selectedGlyph={selectedGlyph}
              label={`Miniature of the canvas${inverted ? ', colours inverted' : ''}${blur > 0 ? `, blurred by ${blur} pixels` : ''}`}
              onViewChange={ignoreViewChange}
              onSelectGlyph={ignoreSelect}
              interactive={false}
              blur={blur}
            />
          </ErrorBoundary>
        ) : (
          <p className="text-preview-empty">{font ? 'Type text to preview it here.' : 'Import a font to see a preview.'}</p>
        )}
      </div>
      <p id={`${id}-hint`} className="field-hint">
        The canvas as it will be exported, cut to its edges. Blur softens it like seeing it from far away; Invert swaps
        the text and background colours. Both only affect this view; tick “Export the preview look” in Export to save
        them.
      </p>
    </section>
  )
}
