import { useCallback, useReducer, useState } from 'react'
import CanvasViewport from './components/CanvasViewport'
import ControlPanel from './components/ControlPanel'
import GlyphStrip from './components/GlyphStrip'
import GoogleFontsDialog from './components/GoogleFontsDialog'
import Header from './components/Header'
import StatusBar from './components/StatusBar'
import Workspace from './components/Workspace'
import { editorReducer, initialState } from './state/editorState'
import type { ViewParams } from './state/types'
import { useFontImport } from './state/useFontImport'

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, initialState)
  const importer = useFontImport(dispatch)
  const [googleOpen, setGoogleOpen] = useState(false)
  const openGoogleFonts = useCallback(() => setGoogleOpen(true), [])

  const onViewChange = useCallback(
    (patch: Partial<ViewParams>) => dispatch({ type: 'updateParams', group: 'view', patch }),
    [],
  )

  // The canvas shows source outlines for now. Phase B derives the canonical polygon in src/geometry.

  return (
    <div className="app">
      <Header document={state.document} />
      <Workspace
        controls={
          <ControlPanel state={state} dispatch={dispatch} importer={importer} onOpenGoogleFonts={openGoogleFonts} />
        }
        viewport={
          <CanvasViewport
            document={state.document}
            view={state.params.view}
            onViewChange={onViewChange}
            onResetView={() => dispatch({ type: 'resetView' })}
            onLocalFile={importer.importLocal}
            onOpenGoogleFonts={openGoogleFonts}
          />
        }
        strip={<GlyphStrip document={state.document} />}
      />
      <StatusBar state={state} />
      <GoogleFontsDialog open={googleOpen} onClose={() => setGoogleOpen(false)} onLoad={importer.importGoogle} />
    </div>
  )
}
