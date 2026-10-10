import { useEffect, useId, useRef, useState, type Dispatch, type KeyboardEvent } from 'react'
import { formatCodePoint } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import type { Action } from '../state/editorState'
import type { DerivedGeometryState } from '../state/useDerivedGeometry'
import type { AppState } from '../state/types'
import AnchorControls from './AnchorControls'
import DistortionControls from './DistortionControls'
import ExperimentalControls from './ExperimentalControls'
import FlattenControls from './FlattenControls'
import GridControls from './GridControls'
import { HintButton, HintText, useHint } from './Hint'
import RandomAnchorControls from './RandomAnchorControls'
import SquaringControls from './SquaringControls'

interface GeometryPanelProps {
  state: AppState
  dispatch: Dispatch<Action>
  derived: DerivedGeometryState
  /** "Show all explanations": opens every ⓘ explanation, here and in the Typography and Color tabs. */
  showAllHints: boolean
  onShowAllHintsChange: (showAll: boolean) => void
}

type Tab = 'geometry' | 'experimental'

const tabs: { id: Tab; label: string }[] = [
  { id: 'geometry', label: 'Geometry' },
  { id: 'experimental', label: 'Experimental' },
]

const TAB_KEY = 'none-curve:geometry-tab'

function readTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_KEY)
    return tabs.some((t) => t.id === stored) ? (stored as Tab) : 'geometry'
  } catch {
    return 'geometry'
  }
}

/**
 * Top left, below import: the parameters that change the glyph outlines, in two tabs — the Geometry
 * pipeline in its order, and the Experimental effects that run after it. Typography and colours are
 * set in the panel beside the text input. Explanations are folded behind ⓘ buttons; warnings,
 * statistics, and notes about disabled controls always stay visible. Both tabs stay mounted.
 */
export default function GeometryPanel({ state, dispatch, derived, showAllHints, onShowAllHintsChange }: GeometryPanelProps) {
  const { font } = state.document
  const geometry = derived.result.kind === 'ready' ? derived.result.geometry : null
  const unitsPerEm = font?.metrics.unitsPerEm ?? null
  const common = { pending: derived.pending, disabled: !font, dispatch }
  const ids = useId()
  const [tab, setTab] = useState<Tab>(readTab)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ geometry: null, experimental: null })

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      // Not remembered; the tabs still work for this visit.
    }
  }, [tab])

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

  const panel = (id: Tab) => ({
    role: 'tabpanel',
    id: `${ids}-${id}-panel`,
    'aria-labelledby': `${ids}-${id}-tab`,
    hidden: tab !== id,
    className: 'geometry-tab-panel',
  })

  return (
    <aside id="geometry-panel" className="panel geometry-panel" aria-label="Shape parameters">
      <div className="tool-tabs geometry-tabs" role="tablist" aria-label="Shape parameters" onKeyDown={onTabKeyDown}>
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
        <input id="show-explanations" type="checkbox" checked={showAllHints} onChange={(e) => onShowAllHintsChange(e.target.checked)} />
        <label htmlFor="show-explanations">Show all explanations</label>
      </div>

      <div {...panel('geometry')}>
        <PipelineIntro glyph={font ? state.document.selectedGlyph : undefined} />
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

      <div {...panel('experimental')}>
        <ExperimentalControls
          params={state.params.experimental}
          stats={geometry?.experimental ?? null}
          statistics={font && <StatisticsTarget glyph={state.document.selectedGlyph} />}
          {...common}
        />
      </div>
    </aside>
  )
}

/**
 * The pipeline order, and which glyph the statistics below describe. The statistics stay on the last
 * selected glyph when its highlight in the canvas is cleared, so this line says which one it is.
 * `glyph` is undefined before a font is loaded (nothing to describe yet).
 */
function PipelineIntro({ glyph }: { glyph: GlyphRef | null | undefined }) {
  const hint = useHint()
  return (
    <div className="panel-notice panel-intro">
      <p className="field-title">
        <span>Pipeline: Flatten → Squaring → Spacing → Reduction → Grid → Angle lock → Distortion.</span>
        <HintButton hint={hint} topic="the pipeline" />
      </p>
      {glyph !== undefined && <StatisticsTarget glyph={glyph} />}
      <HintText hint={hint}>
        Applies to the whole text. Statistics below are for the selected glyph (click one in the canvas, or insert one
        from Glyphs). Random anchors (at the bottom) replace Flatten’s sampling when on. The Experimental tab runs
        after all of these.
      </HintText>
    </div>
  )
}

/** "Statistics: l U+006C": the character (when it is visible) and its code point, or the glyph name. */
function StatisticsTarget({ glyph }: { glyph: GlyphRef | null }) {
  if (!glyph) return <p className="statistics-target">Statistics: click a letter in the canvas</p>
  const char = glyph.unicode !== null ? String.fromCodePoint(glyph.unicode) : ''
  const code = glyph.unicode !== null ? formatCodePoint(glyph.unicode) : glyph.name || `#${glyph.index}`
  return (
    <p className="statistics-target">
      Statistics:{' '}
      {char.trim() && <strong className="statistics-glyph">{char}</strong>}{' '}
      <span className="statistics-code">{code}</span>
    </p>
  )
}
