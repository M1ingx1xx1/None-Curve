import { useCallback, useEffect, useReducer, useState } from 'react'
import CanvasViewport, { type CanvasMode } from './components/CanvasViewport'
import ExportDialog from './components/ExportDialog'
import GeometryPanel from './components/GeometryPanel'
import GlyphPanel from './components/GlyphPanel'
import GoogleFontsDialog from './components/GoogleFontsDialog'
import Header from './components/Header'
import StatusBar from './components/StatusBar'
import TextPanel from './components/TextPanel'
import ToolHead from './components/ToolHead'
import Workspace from './components/Workspace'
import type { GlyphRef } from './geometry/types'
import { editorReducer, initialState } from './state/editorState'
import type { ViewParams } from './state/types'
import { useDerivedGeometry } from './state/useDerivedGeometry'
import { useFontImport } from './state/useFontImport'
import { useSpecimenScene } from './state/useSpecimenScene'

const DEFAULT_TEXT = 'Hamburgefonstiv\nOO oo 00 — The quick brown fox.'

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, initialState)
  const importer = useFontImport(dispatch)
  const derived = useDerivedGeometry(state)
  const [text, setText] = useState(DEFAULT_TEXT)
  const { scene, pending: scenePending } = useSpecimenScene(state.document.font, text, derived.params, derived.paramsKey)

  const [mode, setMode] = useState<CanvasMode>('text')
  // Only used on narrow screens; on desktop the geometry parameters are always shown top left.
  const [geometryOpen, setGeometryOpen] = useState(false)
  const [googleOpen, setGoogleOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const openGoogleFonts = useCallback(() => setGoogleOpen(true), [])
  const openExport = useCallback(() => setExportOpen(true), [])

  const onViewChange = useCallback(
    (patch: Partial<ViewParams>) => dispatch({ type: 'updateParams', group: 'view', patch }),
    [],
  )
  const changeMode = useCallback((next: CanvasMode) => {
    setMode(next)
    dispatch({ type: 'resetView' })
  }, [])
  // Selecting in the glyph list (A) opens that glyph in the inspector; the text (B) is kept.
  const inspectGlyph = useCallback((glyph: GlyphRef) => {
    dispatch({ type: 'selectGlyph', glyph })
    setMode('glyph')
  }, [])
  // Clicking a glyph in the text specimen selects it but stays in the text view.
  const selectFromCanvas = useCallback((glyph: GlyphRef) => dispatch({ type: 'selectGlyph', glyph, keepView: true }), [])

  // A newly loaded font opens on the text specimen.
  const fontId = state.document.font?.id
  useEffect(() => {
    if (fontId) setMode('text')
  }, [fontId])

  const gridSize = state.params.grid.snap && state.params.grid.size > 0 ? state.params.grid.size : null

  return (
    <div className="app">
      <Header document={state.document} onOpenExport={openExport} />
      <Workspace
        geometryOpen={geometryOpen}
        tools={<ToolHead document={state.document} importer={importer} onOpenGoogleFonts={openGoogleFonts} />}
        geometry={<GeometryPanel state={state} dispatch={dispatch} derived={derived} onOpenExport={openExport} />}
        canvas={
          <CanvasViewport
            document={state.document}
            view={state.params.view}
            mode={mode}
            scene={scene}
            gridSize={gridSize}
            glyphGeometry={derived.result}
            geometryPanelOpen={geometryOpen}
            onToggleGeometryPanel={() => setGeometryOpen((open) => !open)}
            onModeChange={changeMode}
            onSelectGlyph={selectFromCanvas}
            onViewChange={onViewChange}
            onResetView={() => dispatch({ type: 'resetView' })}
            onLocalFile={importer.importLocal}
            onOpenGoogleFonts={openGoogleFonts}
          />
        }
        text={<TextPanel font={state.document.font} text={text} scene={scene} pending={scenePending} onTextChange={setText} />}
        glyphs={<GlyphPanel font={state.document.font} selected={state.document.selectedGlyph} onInspectGlyph={inspectGlyph} />}
      />
      <StatusBar state={state} glyphGeometry={derived.result} mode={mode} scene={scene} />
      <GoogleFontsDialog open={googleOpen} onClose={() => setGoogleOpen(false)} onLoad={importer.importGoogle} />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        font={state.document.font}
        selectedGlyph={state.document.selectedGlyph}
        specimenText={text}
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
