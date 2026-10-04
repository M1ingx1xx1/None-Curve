import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatCodePoint, glyphLabel, type LoadedFont } from '../font/model'
import { filterGlyphs, parseGlyphQuery } from '../font/search'
import type { GlyphRef } from '../geometry/types'

interface GlyphPickerProps {
  font: LoadedFont
  selected: GlyphRef | null
  onSelect: (glyph: GlyphRef) => void
}

type ListMode = 'characters' | 'all'

const MAX_RESULTS = 400

function describe(glyph: GlyphRef): string {
  const parts = [glyph.unicode !== null ? `${glyphLabel(glyph)} ${formatCodePoint(glyph.unicode)}` : null]
  if (glyph.name) parts.push(glyph.name)
  parts.push(`glyph ${glyph.index}`)
  return parts.filter(Boolean).join(', ')
}

const GlyphCell = memo(function GlyphCell({
  font,
  glyph,
  selected,
  focusable,
  onSelect,
}: {
  font: LoadedFont
  glyph: GlyphRef
  selected: boolean
  focusable: boolean
  onSelect: (glyph: GlyphRef) => void
}) {
  const { unitsPerEm, ascender, descender } = font.metrics
  const path = font.getPreviewPath(glyph.index)
  const height = ascender - descender
  return (
    <button
      type="button"
      className="glyph-cell"
      aria-pressed={selected}
      aria-label={describe(glyph)}
      title={describe(glyph)}
      tabIndex={focusable ? 0 : -1}
      data-index={glyph.index}
      onClick={() => onSelect(glyph)}
    >
      <svg viewBox={`${-unitsPerEm * 0.1} ${-ascender} ${unitsPerEm * 1.2} ${height}`} aria-hidden="true">
        {path ? <path d={path} transform="scale(1 -1)" /> : null}
      </svg>
      <span className="glyph-cell-label">{glyph.unicode !== null ? formatCodePoint(glyph.unicode) : `#${glyph.index}`}</span>
    </button>
  )
})

export default function GlyphPicker({ font, selected, onSelect }: GlyphPickerProps) {
  const [mode, setMode] = useState<ListMode>(font.characters.length > 0 ? 'characters' : 'all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const gridRef = useRef<HTMLDivElement>(null)

  const source = useMemo(() => (mode === 'characters' ? font.characters : font.listAllGlyphs()), [font, mode])
  const parsed = useMemo(() => parseGlyphQuery(deferredQuery), [deferredQuery])
  const results = useMemo(() => filterGlyphs(source, parsed), [source, parsed])
  const shown = results.slice(0, MAX_RESULTS)

  const isSelected = (g: GlyphRef) =>
    selected !== null && g.index === selected.index && (mode === 'all' || g.unicode === selected.unicode)
  const focusIndex = Math.max(0, shown.findIndex(isSelected))

  useEffect(() => {
    gridRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, mode, results])

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cells = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('.glyph-cell') ?? [])
    const current = cells.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return
    const columns = Math.max(1, cells.filter((c) => c.offsetTop === cells[0].offsetTop).length)
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns, Home: -current, End: cells.length }[e.key]
    if (step === undefined) return
    e.preventDefault()
    const next = cells[Math.min(cells.length - 1, Math.max(0, current + step))]
    next.focus()
    next.scrollIntoView({ block: 'nearest' })
  }

  let emptyMessage: string | null = null
  if (source.length === 0) {
    emptyMessage = mode === 'characters' ? 'This font maps no characters.' : 'This font has no glyphs.'
  } else if (results.length === 0) {
    emptyMessage =
      parsed?.codePoint !== null && parsed?.codePoint !== undefined
        ? `No glyph for “${String.fromCodePoint(parsed.codePoint)}” (${formatCodePoint(parsed.codePoint)}) in this font.`
        : `No glyphs match “${deferredQuery.trim()}”.`
  }

  return (
    <section className="glyph-picker" aria-labelledby="glyph-picker-title">
      <div className="section-head">
        <h2 id="glyph-picker-title">Glyphs</h2>
        <div className="segmented segmented-small" role="radiogroup" aria-label="Glyph list">
          {(
            [
              ['characters', 'Characters'],
              ['all', 'All glyphs'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="segment-option">
              <input
                type="radio"
                name="glyph-list-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <label className="visually-hidden" htmlFor="glyph-search">
        Search glyphs
      </label>
      <input
        id="glyph-search"
        type="search"
        className="glyph-search"
        placeholder="Character, U+0041, #12, or name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-describedby="glyph-search-count"
      />
      <p id="glyph-search-count" className="field-hint">
        {results.length > MAX_RESULTS
          ? `Showing ${MAX_RESULTS} of ${results.length}. Refine the search to see more.`
          : `${results.length} ${results.length === 1 ? 'glyph' : 'glyphs'}`}
      </p>

      {emptyMessage ? (
        <p className="glyph-empty">{emptyMessage}</p>
      ) : (
        <div className="glyph-grid" ref={gridRef} onKeyDown={onGridKeyDown}>
          {shown.map((glyph, i) => (
            <GlyphCell
              key={`${glyph.index}-${glyph.unicode ?? 'x'}`}
              font={font}
              glyph={glyph}
              selected={isSelected(glyph)}
              focusable={i === focusIndex}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  )
}
