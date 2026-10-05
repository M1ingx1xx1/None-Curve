import type { LoadedFont } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import ErrorBoundary from './ErrorBoundary'
import GlyphPicker from './GlyphPicker'

interface GlyphPanelProps {
  font: LoadedFont | null
  /** Inserts the glyph's character into the text at the cursor. */
  onInsert: (glyph: GlyphRef, text: string) => void
}

/** Bottom left: the font's characters, as an inserter for the text input. */
export default function GlyphPanel({ font, onInsert }: GlyphPanelProps) {
  return (
    <section className="panel glyph-panel" aria-label="Glyphs">
      {font ? (
        <ErrorBoundary resetKey={font.id} label="The glyph list">
          <GlyphPicker key={font.id} font={font} onInsert={onInsert} />
        </ErrorBoundary>
      ) : (
        <>
          <h2 className="section-title">Glyphs</h2>
          <p className="glyph-empty">Import a font (top left) to insert its characters from here.</p>
        </>
      )}
    </section>
  )
}
