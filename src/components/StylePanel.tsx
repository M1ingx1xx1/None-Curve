import { useEffect, useId, useRef, useState, type Dispatch, type KeyboardEvent } from 'react'
import type { LoadedFont } from '../font/model'
import type { ArtboardParams, PaletteParams, TypographyParams } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { Action } from '../state/editorState'
import ColorControls from './ColorControls'
import TypographyControls from './TypographyControls'

interface StylePanelProps {
  typography: TypographyParams
  palette: PaletteParams
  artboard: ArtboardParams
  font: LoadedFont | null
  /** The laid-out text, for Fit text. */
  scene: SpecimenScene | null
  dispatch: Dispatch<Action>
}

type Tab = 'typography' | 'color'

const tabs: { id: Tab; label: string }[] = [
  { id: 'typography', label: 'Typography' },
  { id: 'color', label: 'Color' },
]

const TAB_KEY = 'none-curve:style-tab'

/**
 * Bottom row, between the text input and the preview: how the text is set (Typography) and painted
 * (Color) on the canvas. Both tabs stay mounted, so switching keeps their local state (such as a hex
 * value being typed).
 */
export default function StylePanel({ typography, palette, artboard, font, scene, dispatch }: StylePanelProps) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const stored = localStorage.getItem(TAB_KEY)
      return stored === 'color' ? 'color' : 'typography'
    } catch {
      return 'typography'
    }
  })
  const ids = useId()
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ typography: null, color: null })

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

  return (
    <section className="style-panel" aria-label="Typography and color">
      <div className="tool-tabs" role="tablist" aria-label="Text style" onKeyDown={onTabKeyDown}>
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

      <div className="style-panel-body">
        <div role="tabpanel" id={`${ids}-typography-panel`} aria-labelledby={`${ids}-typography-tab`} hidden={tab !== 'typography'}>
          <TypographyControls
            params={typography}
            artboard={artboard}
            font={font}
            scene={scene}
            disabled={!font}
            dispatch={dispatch}
          />
        </div>
        <div role="tabpanel" id={`${ids}-color-panel`} aria-labelledby={`${ids}-color-tab`} hidden={tab !== 'color'}>
          <ColorControls params={palette} disabled={false} dispatch={dispatch} />
        </div>
      </div>
    </section>
  )
}
