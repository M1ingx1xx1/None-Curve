import { useEffect, useId, useRef, useState, type Dispatch, type KeyboardEvent } from 'react'
import type { LoadedFont } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import type { ArtboardParams, PaletteParams, TypographyParams } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { Action } from '../state/editorState'
import ColorControls from './ColorControls'
import GlyphPanel from './GlyphPanel'
import TypographyControls from './TypographyControls'

interface TextToolsProps {
  typography: TypographyParams
  palette: PaletteParams
  artboard: ArtboardParams
  font: LoadedFont | null
  /** The laid-out text, for Fit text and the free position. */
  scene: SpecimenScene | null
  dispatch: Dispatch<Action>
  /** Glyphs tab: inserts a character into the text at the cursor. */
  onInsertGlyph: (glyph: GlyphRef, text: string) => void
}

type Tab = 'typography' | 'glyphs' | 'color'

const tabs: { id: Tab; label: string }[] = [
  { id: 'typography', label: 'Typography' },
  { id: 'glyphs', label: 'Glyphs' },
  { id: 'color', label: 'Color' },
]

const TAB_KEY = 'none-curve:text-tools-tab'

function readTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_KEY)
    return tabs.some((t) => t.id === stored) ? (stored as Tab) : 'typography'
  } catch {
    return 'typography'
  }
}

/**
 * Bottom left: everything about the text other than its shape, in three tabs — how it is set on the
 * canvas (Typography), characters to insert (Glyphs), and its colours (Color). Every tab stays
 * mounted, so switching keeps local state such as the glyph search or a hex value being typed.
 */
export default function TextTools({ typography, palette, artboard, font, scene, dispatch, onInsertGlyph }: TextToolsProps) {
  const [tab, setTab] = useState<Tab>(readTab)
  const ids = useId()
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ typography: null, glyphs: null, color: null })

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
  })

  return (
    <section className="text-tools" aria-label="Typography, glyphs, and color">
      <div className="tool-tabs" role="tablist" aria-label="Text tools" onKeyDown={onTabKeyDown}>
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

      <div className="text-tools-panel text-tools-scroll" {...panel('typography')}>
        <TypographyControls params={typography} artboard={artboard} font={font} scene={scene} disabled={!font} dispatch={dispatch} />
      </div>
      <div className="text-tools-panel" {...panel('glyphs')}>
        <GlyphPanel font={font} onInsert={onInsertGlyph} />
      </div>
      <div className="text-tools-panel text-tools-scroll" {...panel('color')}>
        <ColorControls params={palette} disabled={false} dispatch={dispatch} />
      </div>
    </section>
  )
}
