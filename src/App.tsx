import { useCallback, useReducer, useState } from 'react'
import CanvasViewport from './components/CanvasViewport'
import ControlPanel from './components/ControlPanel'
import ExportDialog from './components/ExportDialog'
import GlyphStrip, { type SpecimenSettings } from './components/GlyphStrip'
import GoogleFontsDialog from './components/GoogleFontsDialog'
import Header from './components/Header'
import StatusBar from './components/StatusBar'
import Workspace from './components/Workspace'
import { editorReducer, initialState } from './state/editorState'
import type { ViewParams } from './state/types'
import { useDerivedGeometry } from './state/useDerivedGeometry'
import { useFontImport } from './state/useFontImport'

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, initialState)
  const importer = useFontImport(dispatch)
  const [googleOpen, setGoogleOpen] = useState(false)
  const openGoogleFonts = useCallback(() => setGoogleOpen(true), [])
  const derived = useDerivedGeometry(state)
  const [exportOpen, setExportOpen] = useState(false)
  const openExport = useCallback(() => setExportOpen(true), [])
  const [specimen, setSpecimen] = useState<SpecimenSettings>({
    text: 'Hamburgefonstiv\nThe quick brown fox jumps over the lazy dog.',
    size: 64,
    fit: true,
  })
  const updateSpecimen = useCallback((patch: Partial<SpecimenSettings>) => setSpecimen((s) => ({ ...s, ...patch })), [])

  const onViewChange = useCallback(
    (patch: Partial<ViewParams>) => dispatch({ type: 'updateParams', group: 'view', patch }),
    [],
  )

  return (
    <div className="app">
      <Header document={state.document} onOpenExport={openExport} />
      <Workspace
        controls={
          <ControlPanel
            state={state}
            dispatch={dispatch}
            importer={importer}
            derived={derived}
            onOpenExport={openExport}
            onOpenGoogleFonts={openGoogleFonts}
          />
        }
        viewport={
          <CanvasViewport
            document={state.document}
            view={state.params.view}
            gridSize={state.params.grid.snap && state.params.grid.size > 0 ? state.params.grid.size : null}
            glyphGeometry={derived.result}
            onViewChange={onViewChange}
            onResetView={() => dispatch({ type: 'resetView' })}
            onLocalFile={importer.importLocal}
            onOpenGoogleFonts={openGoogleFonts}
          />
        }
        strip={
          <GlyphStrip
            font={state.document.font}
            params={derived.params}
            paramsKey={derived.paramsKey}
            pending={derived.pending}
            settings={specimen}
            selectedGlyph={state.document.selectedGlyph}
            onSettingsChange={updateSpecimen}
            onSelectGlyph={(glyph) => dispatch({ type: 'selectGlyph', glyph })}
          />
        }
      />
      <StatusBar state={state} glyphGeometry={derived.result} />
      <GoogleFontsDialog open={googleOpen} onClose={() => setGoogleOpen(false)} onLoad={importer.importGoogle} />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        font={state.document.font}
        selectedGlyph={state.document.selectedGlyph}
        specimenText={specimen.text}
        params={derived.params}
        paramsKey={derived.paramsKey}
        pending={derived.pending}
        precision={state.document.export.precision}
        onPrecisionChange={(precision) => dispatch({ type: 'updateExport', patch: { precision } })}
        onExported={(fileName) =>
          dispatch({ type: 'updateExport', patch: { lastExport: { fileName, at: new Date().toISOString() } } })
        }
      />
    </div>
  )
}
