import { useReducer } from 'react'
import CanvasViewport from './components/CanvasViewport'
import ControlPanel from './components/ControlPanel'
import GlyphStrip from './components/GlyphStrip'
import Header from './components/Header'
import StatusBar from './components/StatusBar'
import Workspace from './components/Workspace'
import type { DerivedGeometry } from './geometry/types'
import { editorReducer, initialState } from './state/editorState'

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, initialState)

  // Phase B plugs the geometry pipeline (src/geometry) in here to derive the canonical polygon.
  const geometry: DerivedGeometry | null = null

  return (
    <div className="app">
      <Header document={state.document} />
      <Workspace
        controls={<ControlPanel state={state} dispatch={dispatch} />}
        viewport={<CanvasViewport document={state.document} view={state.params.view} geometry={geometry} />}
        strip={<GlyphStrip document={state.document} />}
      />
      <StatusBar state={state} geometry={geometry} />
    </div>
  )
}
