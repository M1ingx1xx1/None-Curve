import type { DocumentState } from '../state/types'

interface GlyphStripProps {
  document: DocumentState
}

const placeholderSample = 'Aa Bb Rr Ss 01'

/** Specimen strip. Text setting arrives in a later phase. */
export default function GlyphStrip({ document }: GlyphStripProps) {
  return (
    <section className="strip" aria-label="Specimen">
      <h2 className="strip-title">
        Specimen <span className="pending">Not implemented</span>
      </h2>
      <div className="strip-body">
        <span className="strip-sample" aria-hidden="true">
          {placeholderSample}
        </span>
        <p className="strip-message">
          {document.font
            ? 'Specimen text preview is not implemented yet. Use the glyph list to inspect glyphs.'
            : 'Load a font to inspect its glyphs.'}
        </p>
      </div>
    </section>
  )
}
