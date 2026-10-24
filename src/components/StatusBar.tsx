import { useSyncExternalStore } from 'react'
import { formatCodePoint } from '../font/model'
import { describePipeline } from '../geometry/describe'
import type { GeometryParams } from '../geometry/types'
import { getSoundEngine } from '../sound/engine'
import { useLiveStatus } from '../sound/live'
import { useMappingState } from '../sound/mappingStore'
import type { SpecimenScene } from '../specimen/scene'
import { usePanZoomMoved } from '../state/canvasView'
import { isAtStart, type ResetExtras } from '../state/reset'
import type { AppState } from '../state/types'
import type { GlyphGeometry } from '../state/useDerivedGeometry'
import Icon from './Icon'
import ThemeToggle from './ThemeToggle'

interface StatusBarProps {
  state: AppState
  glyphGeometry: GlyphGeometry
  /** The geometry parameters the canvas shows (live while Sound drives the letters), which the View line describes. */
  shownParams: GeometryParams
  scene: SpecimenScene | null
  /** The text, preview look and export precision, which Reset all looks at (they live in App). */
  text: string
  extras: ResetExtras
  /** Reset all (App's resetAll): back to how the editor first opens. */
  onReset: () => void
  /** The browser refused to save the session (storage full or blocked): settings will not be kept for the next visit. */
  saveFailed?: boolean
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
  const kind = s.error?.kind
  return s.source === 'microphone' && (kind === 'no-device' || kind === 'mic-ended') ? 'lost' : 'off'
}
// Sensitivity and Release, for whether Reset has anything to do: the same object until they change.
const soundSettings = () => getSoundEngine().getState().settings

export default function StatusBar({ state, glyphGeometry, shownParams, scene, text, extras, onReset, saveFailed = false }: StatusBarProps) {
  const { font, selectedGlyph, status } = state.document
  const { view } = state.params
  const mic = useSyncExternalStore(subscribeSound, micStatus)
  const live = useLiveStatus()
  const { mappings, response, drive, reducedMotion } = useMappingState()
  const sound = useSyncExternalStore(subscribeSound, soundSettings)
  const viewMoved = usePanZoomMoved()
  const { view: _view, ...settings } = state.params
  const atStart = isAtStart(
    { params: settings, text, mappings, sound: { ...sound, ...response } },
    { document: state.document, view, viewMoved, extras, drive, defaultDrive: !reducedMotion },
  )
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
    const geometry = glyphGeometry.geometry
    // Marked when the Experimental effects' vertex budget simplified the glyph.
    const vertices = geometry ? `${geometry.vertexCount} vertices${geometry.experimental.budget.applied ? ' (simplified)' : ''}` : 'flattening failed'
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
      {/* Visible from every tab, so the microphone is never on unnoticed.
          Always in the document and polite, so it is also announced from every tab when the microphone stops. */}
      <span role="status" className={mic === 'off' ? 'visually-hidden' : 'statusbar-mic'} data-lost={mic === 'lost' || undefined}>
        {mic === 'on' ? 'Microphone on' : mic === 'lost' ? 'No microphone' : ''}
      </span>
      {/* Shown from the first save the browser refuses, and announced once. */}
      <span role="status" className={saveFailed ? undefined : 'visually-hidden'} title={saveFailed ? 'The browser’s storage is full or blocked, so the settings will not be kept for the next visit.' : undefined}>
        {saveFailed ? 'Settings not saved' : ''}
      </span>
      {/* Back to how the editor first opens: the font closes, the text and every setting return to the start,
          and the undo history is cleared (state/reset.ts).
          aria-disabled, not disabled: the button keeps keyboard focus when its own click disables it. */}
      <button
        type="button"
        className="statusbar-reset"
        aria-label="Reset all"
        title={atStart ? 'Everything is as the editor first opens' : 'Reset all: closes the font and puts the text and every setting back to the start. Cannot be undone.'}
        aria-disabled={atStart || undefined}
        onClick={() => {
          if (!atStart) onReset()
        }}
      >
        <Icon name="reset" />
      </button>
      <ThemeToggle />
    </footer>
  )
}
