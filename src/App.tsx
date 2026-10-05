import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react'
import CanvasViewport from './components/CanvasViewport'
import ExportDialog from './components/ExportDialog'
import GeometryPanel from './components/GeometryPanel'
import GlyphPanel from './components/GlyphPanel'
import GoogleFontsDialog from './components/GoogleFontsDialog'
import Header from './components/Header'
import InputPanel from './components/InputPanel'
import StatusBar from './components/StatusBar'
import TextPanel from './components/TextPanel'
import TextPreview from './components/TextPreview'
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
  // Clicking a glyph in the canvas selects it (the statistics follow it); the canvas view is kept.
  const selectGlyph = useCallback((glyph: GlyphRef) => dispatch({ type: 'selectGlyph', glyph, keepView: true }), [])

  // The glyph list inserts characters at the text cursor (or replaces the selected text), then puts
  // the cursor after the insertion. The textarea keeps its selection while it is not focused; before
  // it has ever been focused there is no real cursor, so characters are appended.
  const textRef = useRef<HTMLTextAreaElement>(null)
  const caretRef = useRef<number | null>(null)
  const cursorPlaced = useRef(false)
  const onTextFocus = useCallback(() => {
    cursorPlaced.current = true
  }, [])
  const insertGlyph = useCallback((glyph: GlyphRef, insert: string) => {
    const el = cursorPlaced.current ? textRef.current : null
    setText((current) => {
      const start = el ? Math.min(el.selectionStart, current.length) : current.length
      const end = el ? Math.min(Math.max(el.selectionEnd, start), current.length) : current.length
      caretRef.current = start + insert.length
      return current.slice(0, start) + insert + current.slice(end)
    })
    dispatch({ type: 'selectGlyph', glyph, keepView: true })
  }, [])
  useLayoutEffect(() => {
    const el = textRef.current
    if (el && caretRef.current !== null) {
      el.setSelectionRange(caretRef.current, caretRef.current)
      caretRef.current = null
      cursorPlaced.current = true
    }
  }, [text])

  const gridSize = state.params.grid.snap && state.params.grid.size > 0 ? state.params.grid.size : null

  return (
    <div className="app">
      <Header document={state.document} onOpenExport={openExport} />
      <Workspace
        geometryOpen={geometryOpen}
        tools={<ToolHead document={state.document} importer={importer} onOpenGoogleFonts={openGoogleFonts} />}
        geometry={<GeometryPanel state={state} dispatch={dispatch} derived={derived} />}
        canvas={
          <CanvasViewport
            document={state.document}
            view={state.params.view}
            scene={scene}
            gridSize={gridSize}
            geometryPanelOpen={geometryOpen}
            onToggleGeometryPanel={() => setGeometryOpen((open) => !open)}
            onSelectGlyph={selectGlyph}
            onViewChange={onViewChange}
            onResetView={() => dispatch({ type: 'resetView' })}
            onLocalFile={importer.importLocal}
            onOpenGoogleFonts={openGoogleFonts}
          />
        }
        glyphs={<GlyphPanel font={state.document.font} onInsert={insertGlyph} />}
        input={
          <InputPanel
            text={
              <TextPanel
                font={state.document.font}
                text={text}
                scene={scene}
                pending={scenePending}
                onTextChange={setText}
                inputRef={textRef}
                onInputFocus={onTextFocus}
              />
            }
            preview={
              <TextPreview
                font={state.document.font}
                scene={scene}
                view={state.params.view}
                gridSize={gridSize}
                selectedGlyph={state.document.selectedGlyph}
              />
            }
          />
        }
      />
      <StatusBar state={state} glyphGeometry={derived.result} scene={scene} />
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
