import type { DocumentState } from '../state/types'

interface GlyphStripProps {
  document: DocumentState
}

const placeholderSample = 'Aa Bb Rr Ss 01'

/** Glyph strip / specimen. Phase A shows the empty state only. */
export default function GlyphStrip({ document }: GlyphStripProps) {
  const glyphCount = document.font?.glyphCount ?? 0

  return (
    <section className="strip" aria-label="Glyph strip and specimen">
      <h2 className="strip-title">Specimen</h2>
      <div className="strip-body">
        <span className="strip-sample" aria-hidden="true">
          {placeholderSample}
        </span>
        <p className="strip-message">
          {glyphCount > 0 ? `${glyphCount} glyphs. Specimen preview is not implemented yet.` : 'Load a font to browse glyphs and specimen text here.'}
        </p>
      </div>
    </section>
  )
}
