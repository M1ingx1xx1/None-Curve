import { useSyncExternalStore } from 'react'
import { formatCodePoint } from '../font/model'
import { describePipeline } from '../geometry/describe'
import type { GeometryParams } from '../geometry/types'
import { getSoundEngine } from '../sound/engine'
import { useLiveStatus } from '../sound/live'
import type { SpecimenScene } from '../specimen/scene'
import type { AppState } from '../state/types'
import type { GlyphGeometry } from '../state/useDerivedGeometry'
import ThemeToggle from './ThemeToggle'

interface StatusBarProps {
  state: AppState
  glyphGeometry: GlyphGeometry
  /** The geometry parameters the canvas shows (live while Sound drives the letters), which the View line describes. */
  shownParams: GeometryParams
  scene: SpecimenScene | null
}

const statusText: Record<AppState['document']['status']['kind'], string> = {
  empty: 'Waiting for font',
  loading: 'Loading font…',
  ready: 'Font ready',
  error: 'Import failed',
}

// Microphone state for the bar: listening, lost (unplugged, access withdrawn, or none found), or nothing to say.
// Subscribed to this alone, so the bar does not re-render with the file position.
type MicStatus = 'on' | 'lost' | 'off'
const subscribeSound = (listener: () => void) => getSoundEngine().subscribeState(listener)
const micStatus = (): MicStatus => {
  const s = getSoundEngine().getState()
  if (s.listening) return 'on'
  return s.source === 'microphone' && s.error?.kind === 'no-device' ? 'lost' : 'off'
}

export default function StatusBar({ state, glyphGeometry, shownParams, scene }: StatusBarProps) {
  const { font, selectedGlyph, status } = state.document
  const { view } = state.params
  const mic = useSyncExternalStore(subscribeSound, micStatus)
  const live = useLiveStatus()
  let glyphInfo = '—'
  let advance: number | null = null
  let viewing = '—'

  if (font && selectedGlyph) {
    const code = selectedGlyph.unicode !== null ? formatCodePoint(selectedGlyph.unicode) : 'unmapped'
    glyphInfo = `${selectedGlyph.name || '(no name)'} · ${code} · #${selectedGlyph.index}`
  }
  if (glyphGeometry.kind === 'ready') {
    advance = glyphGeometry.source.metrics.advanceWidth
    // The settings the canvas shows, so the method matches the vertex count beside it (also while Sound drives).
    const steps = describePipeline(shownParams)
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
      {/* Truncated to one line on wide screens; the full text is in the tooltip. */}
      <span className="statusbar-view" title={`View: ${viewing}`}>
        View: {viewing}
      </span>
      {/* While Sound drives the letters. Only "Live" is announced (when it starts), not every change of the frame rate. */}
      <span className={live.driving ? undefined : 'visually-hidden'}>
        <span role="status">{live.driving ? 'Live' : ''}</span>
        {live.driving && ` · ${live.fps} fps`}
      </span>
      {/* Visible from every tab (on narrow screens it floats in view), so the microphone is never on unnoticed.
          Always in the document and polite, so it is also announced from every tab when the microphone stops. */}
      <span role="status" className={mic === 'off' ? 'visually-hidden' : 'statusbar-mic'} data-lost={mic === 'lost' || undefined}>
        {mic === 'on' ? 'Microphone on' : mic === 'lost' ? 'No microphone' : ''}
      </span>
      <ThemeToggle />
    </footer>
  )
}
