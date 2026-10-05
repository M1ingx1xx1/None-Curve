import { useEffect, useState, type Dispatch } from 'react'
import type { Action } from '../state/editorState'
import type { DerivedGeometryState } from '../state/useDerivedGeometry'
import type { AppState } from '../state/types'
import AnchorControls from './AnchorControls'
import DistortionControls from './DistortionControls'
import FlattenControls from './FlattenControls'
import GridControls from './GridControls'
import { HintButton, HintsContext, HintText, useHint } from './Hint'
import RandomAnchorControls from './RandomAnchorControls'
import SquaringControls from './SquaringControls'

interface GeometryPanelProps {
  state: AppState
  dispatch: Dispatch<Action>
  derived: DerivedGeometryState
}

const SHOW_ALL_KEY = 'none-curve:show-explanations'

function readShowAll(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Top left, below import: geometry parameters, beside the result canvas so their effect is visible
 * while adjusting them. Groups follow the pipeline order. Explanations are folded behind ⓘ buttons;
 * warnings, statistics, and notes about disabled controls always stay visible.
 */
export default function GeometryPanel({ state, dispatch, derived }: GeometryPanelProps) {
  const { font } = state.document
  const geometry = derived.result.kind === 'ready' ? derived.result.geometry : null
  const unitsPerEm = font?.metrics.unitsPerEm ?? null
  const common = { pending: derived.pending, disabled: !font, dispatch }
  const [showAll, setShowAll] = useState(readShowAll)

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_ALL_KEY, String(showAll))
    } catch {
      // Not remembered; the switch still works for this visit.
    }
  }, [showAll])

  return (
    <aside id="geometry-panel" className="panel geometry-panel" aria-label="Geometry">
      <HintsContext.Provider value={showAll}>
        <PanelIntro showAll={showAll} onShowAllChange={setShowAll} />
        <FlattenControls
          params={state.params.flatten}
          stats={geometry?.flatten ?? null}
          unitsPerEm={unitsPerEm}
          replacedByRandom={state.params.random.enabled}
          {...common}
        />
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
      </HintsContext.Provider>
    </aside>
  )
}

function PanelIntro({ showAll, onShowAllChange }: { showAll: boolean; onShowAllChange: (value: boolean) => void }) {
  const hint = useHint()
  return (
    <div className="panel-notice panel-intro">
      <p className="field-title">
        <span>Pipeline: Flatten → Squaring → Spacing → Reduction → Grid → Angle lock → Distortion.</span>
        <HintButton hint={hint} topic="the pipeline" />
      </p>
      <HintText hint={hint}>
        Applies to the whole text. Statistics below are for the selected glyph (click one in the canvas, or insert one
        from Glyphs). Experimental Random anchors (at the bottom) replace Flatten’s sampling when on.
      </HintText>
      <div className="field-toggle">
        <input id="show-explanations" type="checkbox" checked={showAll} onChange={(e) => onShowAllChange(e.target.checked)} />
        <label htmlFor="show-explanations">Show all explanations</label>
      </div>
    </div>
  )
}
