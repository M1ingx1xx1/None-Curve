import { memo, useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatCodePoint, glyphLabel, type LoadedFont } from '../font/model'
import { filterGlyphs, parseGlyphQuery } from '../font/search'
import type { GlyphRef } from '../geometry/types'

interface GlyphPickerProps {
  font: LoadedFont
  /** Called with the glyph's character when a cell is clicked. */
  onInsert: (glyph: GlyphRef, text: string) => void
}

const MAX_RESULTS = 400

/** Control characters (U+0000, carriage return, …) that some fonts map but that are not text to insert. */
const CONTROL = /\p{Cc}/u

/** Scrolls only the grid (not the toolbar or page) so the cell is visible. */
function revealInGrid(grid: HTMLElement, cell: HTMLElement) {
  const top = cell.offsetTop
  const bottom = top + cell.offsetHeight
  if (top < grid.scrollTop || bottom > grid.scrollTop + grid.clientHeight) {
    grid.scrollTop = top - (grid.clientHeight - cell.offsetHeight) / 2
  }
}

function describe(glyph: GlyphRef): string {
  const char = String.fromCodePoint(glyph.unicode!)
  // Spaces and other invisible characters are named by their code point and glyph name only.
  const visible = /^[\s\p{Cf}]$/u.test(char) ? '' : `${glyphLabel(glyph)} `
  const parts = [`Insert ${visible}${formatCodePoint(glyph.unicode!)}`]
  if (glyph.name) parts.push(glyph.name)
  return parts.join(', ')
}

const GlyphCell = memo(function GlyphCell({
  font,
  glyph,
  position,
  focusable,
  onInsert,
  onFocusCell,
}: {
  font: LoadedFont
  glyph: GlyphRef
  position: number
  focusable: boolean
  onInsert: (glyph: GlyphRef, text: string) => void
  onFocusCell: (position: number) => void
}) {
  const { unitsPerEm, ascender, descender } = font.metrics
  const path = font.getPreviewPath(glyph.index)
  const height = ascender - descender
  return (
    <button
      type="button"
      className="glyph-cell"
      aria-label={describe(glyph)}
      title={describe(glyph)}
      tabIndex={focusable ? 0 : -1}
      data-index={glyph.index}
      onFocus={() => onFocusCell(position)}
      onClick={() => onInsert(glyph, String.fromCodePoint(glyph.unicode!))}
    >
      <svg viewBox={`${-unitsPerEm * 0.1} ${-ascender} ${unitsPerEm * 1.2} ${height}`} aria-hidden="true">
        {path ? <path d={path} transform="scale(1 -1)" /> : null}
      </svg>
      <span className="glyph-cell-label">{formatCodePoint(glyph.unicode!)}</span>
    </button>
  )
})

/**
 * Bottom left: every character the font maps, as an inserter. Clicking a cell inserts its character
 * into the text at the cursor; glyphs without a character (ligatures, alternates) cannot be typed
 * and are not listed.
 */
export default function GlyphPicker({ font, onInsert }: GlyphPickerProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const deferredQuery = useDeferredValue(query)
  const gridRef = useRef<HTMLDivElement>(null)

  const source = useMemo(
    () => font.characters.filter((g) => g.unicode !== null && !CONTROL.test(String.fromCodePoint(g.unicode))),
    [font],
  )
  const parsed = useMemo(() => parseGlyphQuery(deferredQuery), [deferredQuery])
  const results = useMemo(() => filterGlyphs(source, parsed), [source, parsed])
  const shown = results.slice(0, MAX_RESULTS)
  const focusIndex = Math.min(active, Math.max(0, shown.length - 1))

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cells = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('.glyph-cell') ?? [])
    const current = cells.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return
    const columns = Math.max(1, cells.filter((c) => c.offsetTop === cells[0].offsetTop).length)
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns, Home: -current, End: cells.length }[e.key]
    if (step === undefined) return
    e.preventDefault()
    const next = cells[Math.min(cells.length - 1, Math.max(0, current + step))]
    next.focus({ preventScroll: true })
    if (gridRef.current) revealInGrid(gridRef.current, next)
  }

  let emptyMessage: string | null = null
  if (source.length === 0) {
    emptyMessage = 'This font maps no characters.'
  } else if (results.length === 0) {
    emptyMessage =
      parsed?.codePoint !== null && parsed?.codePoint !== undefined
        ? `No glyph for “${String.fromCodePoint(parsed.codePoint)}” (${formatCodePoint(parsed.codePoint)}) in this font.`
        : `No characters match “${deferredQuery.trim()}”.`
  }

  return (
    // The Glyphs tab names this list; the label stays for screen readers.
    <section className="glyph-picker" aria-label="Glyphs">
      <p className="field-hint">Click a character to insert it into the text at the cursor.</p>

      <label className="visually-hidden" htmlFor="glyph-search">
        Search characters
      </label>
      <input
        id="glyph-search"
        type="search"
        className="glyph-search"
        placeholder="Character, U+0041, #12, or name"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        aria-describedby="glyph-search-count"
      />
      <p id="glyph-search-count" className="field-hint">
        {results.length > MAX_RESULTS
          ? `Showing ${MAX_RESULTS} of ${results.length}. Refine the search to see more.`
          : `${results.length} ${results.length === 1 ? 'character' : 'characters'}`}
      </p>

      {emptyMessage ? (
        <p className="glyph-empty">{emptyMessage}</p>
      ) : (
        <div className="glyph-grid" ref={gridRef} role="group" aria-label="Characters to insert" onKeyDown={onGridKeyDown}>
          {shown.map((glyph, i) => (
            <GlyphCell
              key={`${glyph.index}-${glyph.unicode}`}
              font={font}
              glyph={glyph}
              position={i}
              focusable={i === focusIndex}
              onInsert={onInsert}
              onFocusCell={setActive}
            />
          ))}
        </div>
      )}
    </section>
  )
}
