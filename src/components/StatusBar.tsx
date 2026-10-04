import type { DerivedGeometry } from '../geometry/types'
import type { AppState } from '../state/types'

interface StatusBarProps {
  state: AppState
  geometry: DerivedGeometry | null
}

export default function StatusBar({ state, geometry }: StatusBarProps) {
  const { document, params } = state
  const flatten =
    params.flatten.mode === 'adaptive'
      ? `adaptive · tolerance ${params.flatten.tolerance}`
      : `fixed · ${params.flatten.segmentsPerCurve} per curve`

  return (
    <footer className="statusbar">
      <span role="status" aria-live="polite">
        {document.status.kind === 'ready' ? 'Font ready' : 'Waiting for font'}
      </span>
      <span>Glyph: {document.selectedGlyph?.name ?? '—'}</span>
      <span>Flatten: {flatten}</span>
      <span>Vertices: {geometry?.vertexCount ?? '—'}</span>
      <span className="statusbar-phase">Phase A · Architecture preview</span>
    </footer>
  )
}
