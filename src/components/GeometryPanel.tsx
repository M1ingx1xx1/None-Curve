import type { Dispatch } from 'react'
import type { Action } from '../state/editorState'
import type { DerivedGeometryState } from '../state/useDerivedGeometry'
import type { AppState } from '../state/types'
import AnchorControls from './AnchorControls'
import DistortionControls from './DistortionControls'
import FlattenControls from './FlattenControls'
import GridControls from './GridControls'
import RandomAnchorControls from './RandomAnchorControls'
import SquaringControls from './SquaringControls'

interface GeometryPanelProps {
  state: AppState
  dispatch: Dispatch<Action>
  derived: DerivedGeometryState
}

/**
 * Top left, below import: geometry parameters, beside the result canvas so their effect is visible
 * while adjusting them. Groups follow the pipeline order.
 */
export default function GeometryPanel({ state, dispatch, derived }: GeometryPanelProps) {
  const { font } = state.document
  const geometry = derived.result.kind === 'ready' ? derived.result.geometry : null
  const unitsPerEm = font?.metrics.unitsPerEm ?? null
  const common = { pending: derived.pending, disabled: !font, dispatch }

  return (
    <aside id="geometry-panel" className="panel geometry-panel" aria-label="Geometry">
      <p className="panel-notice">
        Pipeline: Flatten → Squaring → Spacing → Reduction → Grid → Angle lock → Distortion. Applies to the whole text
        and to the inspected glyph. Statistics below are for the selected glyph. Experimental Random anchors (at the
        bottom) replace Flatten’s sampling when on.
      </p>
      <FlattenControls params={state.params.flatten} stats={geometry?.flatten ?? null} unitsPerEm={unitsPerEm} {...common} />
      <SquaringControls params={state.params.squaring} stats={geometry?.squaring ?? null} {...common} />
      <AnchorControls params={state.params.anchors} stats={geometry?.anchors ?? null} unitsPerEm={unitsPerEm} {...common} />
      <GridControls params={state.params.grid} stats={geometry?.constraints ?? null} unitsPerEm={unitsPerEm} {...common} />
      <DistortionControls
        params={state.params.distortion}
        stats={geometry?.distortion ?? null}
        finalVertices={geometry?.vertexCount ?? null}
        {...common}
      />
      <RandomAnchorControls params={state.params.random} stats={geometry?.random ?? null} {...common} />
    </aside>
  )
}
