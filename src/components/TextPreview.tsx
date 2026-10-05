import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { LoadedFont } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import type { SpecimenScene } from '../specimen/scene'
import type { ViewParams } from '../state/types'
import ErrorBoundary from './ErrorBoundary'
import SpecimenView from './SpecimenView'

interface TextPreviewProps {
  font: LoadedFont | null
  scene: SpecimenScene | null
  /** Outline and layer settings of the result canvas; zoom and pan are ignored (always fitted). */
  view: ViewParams
  gridSize: number | null
  selectedGlyph: GlyphRef | null
  /** Blur and inversion live in App so the export dialog can reproduce this view. */
  look: PreviewLook
  onLookChange: (look: PreviewLook) => void
  /** Reports how the preview is drawn, so exports can reproduce it. */
  onRenderChange: (render: PreviewRender) => void
}

/** What an export needs to look like the preview. */
export interface PreviewRender {
  /** Screen pixels per font unit at the preview's current size; 0 when nothing is shown. */
  scale: number
  /** The colours actually on screen (theme and Invert applied). */
  ink: string
  paper: string
}

export interface PreviewLook {
  /** Blur radius in screen pixels of this preview; 0 is off. */
  blur: number
  inverted: boolean
}

export const DEFAULT_PREVIEW_LOOK: PreviewLook = { blur: 0, inverted: false }

const MAX_BLUR = 12
const FITTED = { zoom: 1, panX: 0, panY: 0 }
const ignoreViewChange = () => {}
const ignoreSelect = () => {}

/**
 * Bottom right, right half: a fitted miniature of the result canvas with its own blur filter, for
 * judging the overall shape of the text the way it reads from a distance. The blur only affects this
 * view; it is not part of the geometry or the export.
 */
export default function TextPreview({ font, scene, view, gridSize, selectedGlyph, look, onLookChange, onRenderChange }: TextPreviewProps) {
  const id = useId()
  const { blur, inverted } = look
  const hasText = font !== null && scene !== null && scene.glyphCount > 0

  // The same fit as SpecimenView at zoom 1: scene bounds plus a quarter em on every side.
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
    const pad = font.metrics.unitsPerEm * 0.25
    const { minX, maxX, minY, maxY } = scene.bounds
    scale = Math.min(size.width / (maxX - minX + pad * 2), size.height / (maxY - minY + pad * 2))
  }
  // Colours come from the rendered element, so they follow the theme and the Invert swap exactly.
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const style = getComputedStyle(el)
    onRenderChange({ scale, ink: style.getPropertyValue('--text').trim() || '#000', paper: style.backgroundColor || '#fff' })
  }, [scale, inverted, dark, onRenderChange])

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
            title="Swap the glyph and background colours of the preview"
            onClick={() => onLookChange({ ...look, inverted: !inverted })}
          >
            Invert
          </button>
        </div>
      </div>
      <div ref={canvasRef} className="text-preview-canvas" data-inverted={inverted}>
        {hasText ? (
          <ErrorBoundary resetKey={`${font.id}:preview`} label="The preview">
            <SpecimenView
              font={font}
              scene={scene}
              view={{ ...view, ...FITTED }}
              gridSize={gridSize}
              selectedGlyph={selectedGlyph}
              label={`Miniature of the result canvas${inverted ? ', colours inverted' : ''}${blur > 0 ? `, blurred by ${blur} pixels` : ''}`}
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
        The whole text, fitted, with the canvas layers. Blur softens it like seeing it from far away; Invert swaps the
        glyph and background colours. Both only affect this view; tick “Export the preview look” in Export to save them.
      </p>
    </section>
  )
}
