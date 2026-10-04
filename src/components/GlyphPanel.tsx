import type { LoadedFont } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import ErrorBoundary from './ErrorBoundary'
import GlyphPicker from './GlyphPicker'

interface GlyphPanelProps {
  font: LoadedFont | null
  selected: GlyphRef | null
  /** Selecting a glyph opens it in the canvas inspector; the text input is left untouched. */
  onInspectGlyph: (glyph: GlyphRef) => void
}

/** Bottom right: glyph preview and selection for the loaded font. */
export default function GlyphPanel({ font, selected, onInspectGlyph }: GlyphPanelProps) {
  return (
    <section className="panel glyph-panel" aria-label="Glyphs">
      {font ? (
        <ErrorBoundary resetKey={font.id} label="The glyph list">
          <GlyphPicker key={font.id} font={font} selected={selected} onSelect={onInspectGlyph} />
        </ErrorBoundary>
      ) : (
        <>
          <h2 className="section-title">Glyphs</h2>
          <p className="glyph-empty">Import a font (top left) to preview its glyphs here.</p>
        </>
      )}
    </section>
  )
}
