import { formatCodePoint } from '../font/model'
import type { AppState } from '../state/types'

interface StatusBarProps {
  state: AppState
}

const statusText: Record<AppState['document']['status']['kind'], string> = {
  empty: 'Waiting for font',
  loading: 'Loading font…',
  ready: 'Font ready',
  error: 'Import failed',
}

export default function StatusBar({ state }: StatusBarProps) {
  const { font, selectedGlyph, status } = state.document
  let glyphInfo = '—'
  let advance: number | null = null
  if (font && selectedGlyph) {
    const code = selectedGlyph.unicode !== null ? formatCodePoint(selectedGlyph.unicode) : 'unmapped'
    glyphInfo = `${selectedGlyph.name || '(no name)'} · ${code} · #${selectedGlyph.index}`
    try {
      advance = font.getGlyph(selectedGlyph.index).metrics.advanceWidth
    } catch {
      advance = null
    }
  }

  return (
    <footer className="statusbar">
      <span role="status" aria-live="polite">
        {statusText[status.kind]}
      </span>
      <span>Glyph: {glyphInfo}</span>
      <span>Advance: {advance ?? '—'}</span>
      <span>UPM: {font?.metrics.unitsPerEm ?? '—'}</span>
      <span className="statusbar-phase">Preview · flattening not implemented</span>
    </footer>
  )
}
