import { useEffect, useId, useRef, useState, type Dispatch, type KeyboardEvent } from 'react'
import type { SpecimenScene } from '../specimen/scene'
import type { Action } from '../state/editorState'
import type { DerivedGeometryState } from '../state/useDerivedGeometry'
import type { AppState } from '../state/types'
import AnchorControls from './AnchorControls'
import ColorControls from './ColorControls'
import DistortionControls from './DistortionControls'
import FlattenControls from './FlattenControls'
import GridControls from './GridControls'
import { HintButton, HintsContext, HintText, useHint } from './Hint'
import RandomAnchorControls from './RandomAnchorControls'
import SquaringControls from './SquaringControls'
import TypographyControls from './TypographyControls'

interface ToolPanelProps {
  state: AppState
  dispatch: Dispatch<Action>
  derived: DerivedGeometryState
  /** The laid-out text, for Fit text. */
  scene: SpecimenScene | null
}

type Tab = 'geometry' | 'typography' | 'color'

const tabs: { id: Tab; label: string }[] = [
  { id: 'geometry', label: 'Geometry' },
  { id: 'typography', label: 'Typography' },
  { id: 'color', label: 'Color' },
]

const SHOW_ALL_KEY = 'none-curve:show-explanations'
const TAB_KEY = 'none-curve:tool-tab'

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null
    return value && allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered; the panel still works for this visit.
  }
}

/**
 * Top left, below import: the tools, in three tabs. Geometry changes the glyph outlines (in pipeline
 * order); Typography sets the text on the canvas; Color paints it. Every tab stays mounted, so local
 * state such as the random-seed history survives switching tabs. Explanations are folded behind ⓘ
 * buttons; warnings, statistics, and notes about disabled controls always stay visible.
 */
export default function ToolPanel({ state, dispatch, derived, scene }: ToolPanelProps) {
  const { font } = state.document
  const geometry = derived.result.kind === 'ready' ? derived.result.geometry : null
  const unitsPerEm = font?.metrics.unitsPerEm ?? null
  const common = { pending: derived.pending, disabled: !font, dispatch }
  const [showAll, setShowAll] = useState(() => readStored(SHOW_ALL_KEY, ['true', 'false'], 'false') === 'true')
  const [tab, setTab] = useState<Tab>(() => readStored(TAB_KEY, ['geometry', 'typography', 'color'], 'geometry'))
  const ids = useId()
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ geometry: null, typography: null, color: null })

  useEffect(() => store(SHOW_ALL_KEY, String(showAll)), [showAll])
  useEffect(() => store(TAB_KEY, tab), [tab])

  // Arrow keys move between tabs and select them (automatic activation); Home and End jump to the ends.
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === tab)
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    const target = tabs[(next + tabs.length) % tabs.length].id
    setTab(target)
    tabRefs.current[target]?.focus()
  }

  return (
    <aside id="geometry-panel" className="panel geometry-panel" aria-label="Tools">
      <HintsContext.Provider value={showAll}>
        <div className="tool-tabs" role="tablist" aria-label="Tool groups" onKeyDown={onTabKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el
              }}
              type="button"
              role="tab"
              id={`${ids}-${t.id}-tab`}
              aria-selected={tab === t.id}
              aria-controls={`${ids}-${t.id}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="field-toggle show-explanations">
          <input id="show-explanations" type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          <label htmlFor="show-explanations">Show all explanations</label>
        </div>

        <div role="tabpanel" id={`${ids}-geometry-panel`} aria-labelledby={`${ids}-geometry-tab`} className="tool-tab-panel" hidden={tab !== 'geometry'}>
          <PipelineIntro />
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
        </div>

        <div role="tabpanel" id={`${ids}-typography-panel`} aria-labelledby={`${ids}-typography-tab`} className="tool-tab-panel" hidden={tab !== 'typography'}>
          <TypographyControls
            params={state.params.typography}
            artboard={state.params.artboard}
            font={font}
            scene={scene}
            disabled={!font}
            dispatch={dispatch}
          />
        </div>

        <div role="tabpanel" id={`${ids}-color-panel`} aria-labelledby={`${ids}-color-tab`} className="tool-tab-panel" hidden={tab !== 'color'}>
          <ColorControls params={state.params.palette} disabled={false} dispatch={dispatch} />
        </div>
      </HintsContext.Provider>
    </aside>
  )
}

function PipelineIntro() {
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
    </div>
  )
}
