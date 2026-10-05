import { useId, useState } from 'react'
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
}

const MAX_BLUR = 12
const FITTED = { zoom: 1, panX: 0, panY: 0 }
const ignoreViewChange = () => {}
const ignoreSelect = () => {}

/**
 * Bottom right, right half: a fitted miniature of the result canvas with its own blur filter, for
 * judging the overall shape of the text the way it reads from a distance. The blur only affects this
 * view; it is not part of the geometry or the export.
 */
export default function TextPreview({ font, scene, view, gridSize, selectedGlyph }: TextPreviewProps) {
  const id = useId()
  const [blur, setBlur] = useState(0)
  // Swaps the glyph and background colours of this view only.
  const [inverted, setInverted] = useState(false)
  const hasText = font !== null && scene !== null && scene.glyphCount > 0

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
            onChange={(e) => setBlur(Number(e.target.value))}
          />
          <output htmlFor={`${id}-blur`}>{blur > 0 ? `${blur} px` : 'Off'}</output>
          <button
            type="button"
            className="button-small"
            aria-pressed={inverted}
            title="Swap the glyph and background colours of the preview"
            onClick={() => setInverted((v) => !v)}
          >
            Invert
          </button>
        </div>
      </div>
      <div className="text-preview-canvas" data-inverted={inverted}>
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
        glyph and background colours. Both only affect this view, not export.
      </p>
    </section>
  )
}
