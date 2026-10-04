import { useDeferredValue, useId, useMemo } from 'react'
import type { LoadedFont } from '../font/model'
import { polygonGlyphToPath } from '../geometry/sourcePath'
import type { GeometryParams, GlyphRef } from '../geometry/types'
import { buildSpecimenScene, SPECIMEN_MAX_CHARS } from '../specimen/scene'

export interface SpecimenSettings {
  text: string
  /** Rendered size in CSS pixels per em. */
  size: number
  /** Scale the whole specimen to the available width instead of using `size`. */
  fit: boolean
}

interface GlyphStripProps {
  font: LoadedFont | null
  params: GeometryParams
  paramsKey: string
  pending: boolean
  settings: SpecimenSettings
  selectedGlyph: GlyphRef | null
  onSettingsChange: (patch: Partial<SpecimenSettings>) => void
  onSelectGlyph: (glyph: GlyphRef) => void
}

/** Specimen text set with the final polygons, the same ones the canvas and SVG export use. */
export default function GlyphStrip({
  font,
  params,
  paramsKey,
  pending,
  settings,
  selectedGlyph,
  onSettingsChange,
  onSelectGlyph,
}: GlyphStripProps) {
  const textId = useId()
  const sizeId = useId()
  const deferredText = useDeferredValue(settings.text)

  const scene = useMemo(
    () => (font ? buildSpecimenScene(font, deferredText, params, paramsKey) : null),
    [font, deferredText, params, paramsKey],
  )

  const paths = useMemo(() => {
    const byIndex = new Map<number, string>()
    if (!scene) return byIndex
    for (const line of scene.lines)
      for (const g of line.glyphs) if (g.polygon && !byIndex.has(g.index)) byIndex.set(g.index, polygonGlyphToPath(g.polygon))
    return byIndex
  }, [scene])

  if (!font) {
    return (
      <section className="strip" aria-label="Specimen">
        <h2 className="strip-title">Specimen</h2>
        <p className="strip-message">Load a font to set specimen text with the polygon outlines.</p>
      </section>
    )
  }

  const unitsPerEm = font.metrics.unitsPerEm
  const pad = unitsPerEm * 0.1
  const bounds = scene?.bounds
  const vb = bounds
    ? { x: bounds.minX - pad, y: bounds.minY - pad, w: bounds.maxX - bounds.minX + pad * 2, h: bounds.maxY - bounds.minY + pad * 2 }
    : null
  const scale = settings.size / unitsPerEm
  const selectRef = (index: number, text: string): GlyphRef => {
    const cp = text.codePointAt(0)
    const mapped = font.characters.find((c) => c.index === index && c.unicode === cp) ?? font.characters.find((c) => c.index === index)
    return mapped ?? { index, name: '', unicode: null }
  }

  const notes: string[] = []
  if (scene) {
    notes.push(`${scene.glyphCount} glyphs`)
    notes.push(scene.kerning ? 'kerning applied from the font' : 'this font has no kerning data')
    if (scene.missingCharacters.length) notes.push(`missing: ${scene.missingCharacters.join(' ')}`)
    if (scene.failedGlyphs) notes.push(`${scene.failedGlyphs} glyphs failed to process`)
    if (scene.truncated) notes.push(`only the first ${SPECIMEN_MAX_CHARS} characters are shown`)
  }

  return (
    <section className="strip" aria-label="Specimen">
      <div className="strip-head">
        <h2 className="strip-title">Specimen</h2>
        <div className="strip-controls">
          <label className="field-toggle strip-fit">
            <input type="checkbox" checked={settings.fit} onChange={(e) => onSettingsChange({ fit: e.target.checked })} />
            Fit width
          </label>
          <label htmlFor={sizeId} className="visually-hidden">
            Specimen size
          </label>
          <input
            id={sizeId}
            type="range"
            min={16}
            max={200}
            step={2}
            value={settings.size}
            disabled={settings.fit}
            aria-valuetext={`${settings.size} pixels per em`}
            onChange={(e) => onSettingsChange({ size: Number(e.target.value) })}
          />
          <output className="strip-size">{settings.fit ? 'Fit' : `${settings.size}px`}</output>
        </div>
      </div>

      <label htmlFor={textId} className="visually-hidden">
        Specimen text
      </label>
      <textarea
        id={textId}
        className="strip-input"
        rows={2}
        value={settings.text}
        spellCheck={false}
        placeholder="Type specimen text. Enter starts a new line."
        onChange={(e) => onSettingsChange({ text: e.target.value })}
      />

      <div className="strip-view" data-fit={settings.fit} aria-busy={pending || deferredText !== settings.text}>
        {scene && vb && scene.glyphCount > 0 ? (
          <svg
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            width={settings.fit ? '100%' : vb.w * scale}
            height={settings.fit ? undefined : vb.h * scale}
            role="img"
            aria-label={`Specimen: ${deferredText}`}
          >
            {scene.lines.map((line, l) => (
              <g key={l}>
                {line.glyphs.map((g, i) => {
                  if (g.missing) {
                    return (
                      <rect
                        key={i}
                        className="strip-missing"
                        x={g.x + g.advance * 0.1}
                        y={g.y - scene.ascender * 0.7}
                        width={g.advance * 0.8}
                        height={scene.ascender * 0.7}
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>Missing: {g.text}</title>
                      </rect>
                    )
                  }
                  const d = paths.get(g.index)
                  if (!d) return null
                  const selected = selectedGlyph?.index === g.index
                  return (
                    <path
                      key={i}
                      className={selected ? 'strip-glyph strip-glyph-selected' : 'strip-glyph'}
                      d={d}
                      transform={`translate(${g.x} ${g.y}) scale(1 -1)`}
                      onClick={() => onSelectGlyph(selectRef(g.index, g.text))}
                    >
                      <title>{g.text}</title>
                    </path>
                  )
                })}
              </g>
            ))}
          </svg>
        ) : (
          <p className="strip-message">Type text above to preview it.</p>
        )}
      </div>
      <p className="strip-message" aria-live="polite">
        {notes.join(' · ')}. Click a glyph to edit it.
      </p>
    </section>
  )
}
