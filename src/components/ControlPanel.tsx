import type { Dispatch } from 'react'
import type { Action } from '../state/editorState'
import type { DerivedGeometryState } from '../state/useDerivedGeometry'
import type { FontImporter } from '../state/useFontImport'
import type { AppState } from '../state/types'
import AnchorControls from './AnchorControls'
import DistortionControls from './DistortionControls'
import ErrorBoundary from './ErrorBoundary'
import ExportSection from './ExportSection'
import FlattenControls from './FlattenControls'
import FontStatus from './FontStatus'
import GlyphPicker from './GlyphPicker'
import GridControls from './GridControls'
import ImportMenu from './ImportMenu'

interface ControlPanelProps {
  state: AppState
  dispatch: Dispatch<Action>
  importer: FontImporter
  derived: DerivedGeometryState
  onOpenExport: () => void
  onOpenGoogleFonts: () => void
}

/** Left toolbar: import first, then font status, glyph navigation, and future tools. */
export default function ControlPanel({ state, dispatch, importer, derived, onOpenExport, onOpenGoogleFonts }: ControlPanelProps) {
  const { document } = state
  const { font } = document
  const geometry = derived.result.kind === 'ready' ? derived.result.geometry : null

  return (
    <aside className="panel" aria-label="Toolbar">
      <ImportMenu
        busy={document.status.kind === 'loading'}
        onLocalFile={importer.importLocal}
        onOpenGoogleFonts={onOpenGoogleFonts}
      />
      <FontStatus status={document.status} font={font} onRetry={importer.retry} onCancel={importer.cancel} />
      <FlattenControls
        params={state.params.flatten}
        stats={geometry?.flatten ?? null}
        unitsPerEm={font?.metrics.unitsPerEm ?? null}
        pending={derived.pending}
        disabled={!font}
        dispatch={dispatch}
      />
      <AnchorControls
        params={state.params.anchors}
        stats={geometry?.anchors ?? null}
        unitsPerEm={font?.metrics.unitsPerEm ?? null}
        pending={derived.pending}
        disabled={!font}
        dispatch={dispatch}
      />
      <GridControls
        params={state.params.grid}
        stats={geometry?.constraints ?? null}
        unitsPerEm={font?.metrics.unitsPerEm ?? null}
        pending={derived.pending}
        disabled={!font}
        dispatch={dispatch}
      />
      <DistortionControls
        params={state.params.distortion}
        stats={geometry?.distortion ?? null}
        finalVertices={geometry?.vertexCount ?? null}
        pending={derived.pending}
        disabled={!font}
        dispatch={dispatch}
      />
      {font && (
        <ErrorBoundary resetKey={font.id} label="The glyph list">
          <GlyphPicker
            key={font.id}
            font={font}
            selected={document.selectedGlyph}
            onSelect={(glyph) => dispatch({ type: 'selectGlyph', glyph })}
          />
        </ErrorBoundary>
      )}
      <ExportSection disabled={!font} lastExport={document.export.lastExport} onOpenExport={onOpenExport} />
    </aside>
  )
}
