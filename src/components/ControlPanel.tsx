import type { Dispatch } from 'react'
import type { Action } from '../state/editorState'
import type { FontImporter } from '../state/useFontImport'
import type { AppState } from '../state/types'
import ErrorBoundary from './ErrorBoundary'
import FontStatus from './FontStatus'
import GlyphPicker from './GlyphPicker'
import ImportMenu from './ImportMenu'
import UpcomingTools from './UpcomingTools'

interface ControlPanelProps {
  state: AppState
  dispatch: Dispatch<Action>
  importer: FontImporter
  onOpenGoogleFonts: () => void
}

/** Left toolbar: import first, then font status, glyph navigation, and future tools. */
export default function ControlPanel({ state, dispatch, importer, onOpenGoogleFonts }: ControlPanelProps) {
  const { document } = state
  const { font } = document

  return (
    <aside className="panel" aria-label="Toolbar">
      <ImportMenu
        busy={document.status.kind === 'loading'}
        onLocalFile={importer.importLocal}
        onOpenGoogleFonts={onOpenGoogleFonts}
      />
      <FontStatus status={document.status} font={font} onRetry={importer.retry} onCancel={importer.cancel} />
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
      <UpcomingTools state={state} dispatch={dispatch} />
    </aside>
  )
}
