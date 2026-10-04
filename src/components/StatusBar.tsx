import { formatCodePoint } from '../font/model'
import { describePipeline } from '../geometry/describe'
import type { SpecimenScene } from '../specimen/scene'
import type { AppState } from '../state/types'
import type { GlyphGeometry } from '../state/useDerivedGeometry'

interface StatusBarProps {
  state: AppState
  glyphGeometry: GlyphGeometry
  scene: SpecimenScene | null
}

const statusText: Record<AppState['document']['status']['kind'], string> = {
  empty: 'Waiting for font',
  loading: 'Loading font…',
  ready: 'Font ready',
  error: 'Import failed',
}

export default function StatusBar({ state, glyphGeometry, scene }: StatusBarProps) {
  const { font, selectedGlyph, status } = state.document
  const { view } = state.params
  let glyphInfo = '—'
  let advance: number | null = null
  let viewing = '—'

  if (font && selectedGlyph) {
    const code = selectedGlyph.unicode !== null ? formatCodePoint(selectedGlyph.unicode) : 'unmapped'
    glyphInfo = `${selectedGlyph.name || '(no name)'} · ${code} · #${selectedGlyph.index}`
  }
  if (glyphGeometry.kind === 'ready') {
    advance = glyphGeometry.source.metrics.advanceWidth
    const steps = describePipeline(state.params)
    const method = steps.join(' → ')
    const vertices = glyphGeometry.geometry ? `${glyphGeometry.geometry.vertexCount} vertices` : 'flattening failed'
    const target = `text (${scene?.glyphCount ?? 0} glyphs)`
    if (view.outline === 'source') viewing = `Original curves · ${target}`
    else if (view.outline === 'flattened') viewing = `Final polygon (${method}) · ${target} · selected glyph ${vertices}`
    else viewing = `Compare: final polygon (${method}) over original · ${target} · selected glyph ${vertices}`
  }

  return (
    <footer className="statusbar">
      <span role="status" aria-live="polite">
        {statusText[status.kind]}
      </span>
      <span>Glyph: {glyphInfo}</span>
      <span>Advance: {advance ?? '—'}</span>
      <span>UPM: {font?.metrics.unitsPerEm ?? '—'}</span>
      <span className="statusbar-view">View: {viewing}</span>
    </footer>
  )
}
