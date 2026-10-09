// Lays out specimen text with the final polygons. Shared by the specimen preview and SVG export so
// both use identical positions, advances, kerning, and outlines. No React, no DOM.

import type { LoadedFont } from '../font/model'
import { glyphGeometry } from '../geometry/cache'
import type { GeometryParams, Point, PolygonGlyph } from '../geometry/types'

export const SPECIMEN_MAX_CHARS = 1000

export interface PlacedGlyph {
  index: number
  /** The text this glyph stands for (one character, or several for combined clusters). */
  text: string
  /** Pen position of the glyph origin in scene units (font units, y down, first baseline at 0). */
  x: number
  y: number
  advance: number
  missing: boolean
  /** Final polygon in font units (y up), or null for missing, empty, or failed glyphs. */
  polygon: PolygonGlyph | null
  error: string | null
}

export interface SpecimenScene {
  lines: { glyphs: PlacedGlyph[]; width: number; baseline: number }[]
  lineHeight: number
  ascender: number
  descender: number
  /** Height of a capital letter (the font's cap height, or 0.7 em when the font does not say). */
  capHeight: number
  /** Scene bounds (y down) covering every line's ascender/descender and every outline (slant included). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /** Bounds (y down) of the drawn outlines alone, slant included: where the ink is. Null when nothing
      is drawn (only spaces or missing characters). */
  ink: { minX: number; minY: number; maxX: number; maxY: number } | null
  /** Width of the longest line; lines are aligned inside this width. */
  blockWidth: number
  /** First line's ascender and last line's descender (y down). */
  textTop: number
  textBottom: number
  /** Slant in degrees, applied to every glyph around its own baseline (positive leans right). */
  slant: number
  missingCharacters: string[]
  failedGlyphs: number
  glyphCount: number
  truncated: boolean
  kerning: boolean
}

/** Spacing and slant applied while setting the text. Defaults reproduce plain setting. */
export interface SceneLayout {
  /** Thousandths of an em added between glyphs. */
  tracking: number
  /** Multiple of the font's line spacing. */
  lineHeight: number
  align: 'left' | 'center' | 'right'
  /** Degrees; positive leans right. */
  slant: number
}

export const PLAIN_LAYOUT: SceneLayout = { tracking: 0, lineHeight: 1, align: 'left', slant: 0 }

/** Splits text into lines; \r\n and \r count as line breaks. */
export function specimenLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

export function buildSpecimenScene(
  font: LoadedFont,
  text: string,
  params: GeometryParams,
  key: string,
  layout: SceneLayout = PLAIN_LAYOUT,
): SpecimenScene {
  const { ascender, descender, lineGap, unitsPerEm } = font.metrics
  const capHeight = font.metrics.capHeight ?? unitsPerEm * 0.7
  const lineHeight = (ascender - descender + lineGap) * (Number.isFinite(layout.lineHeight) && layout.lineHeight > 0 ? layout.lineHeight : 1)
  const tracking = ((Number.isFinite(layout.tracking) ? layout.tracking : 0) * unitsPerEm) / 1000
  const slant = Number.isFinite(layout.slant) ? Math.max(-89, Math.min(89, layout.slant)) : 0
  const shear = Math.tan((slant * Math.PI) / 180)
  const chars = [...text]
  const truncated = chars.length > SPECIMEN_MAX_CHARS
  const source = truncated ? chars.slice(0, SPECIMEN_MAX_CHARS).join('') : text

  const missing = new Set<string>()
  let failedGlyphs = 0
  let glyphCount = 0
  let minX = 0
  let maxX = 0
  let minY = -ascender
  let maxY = -descender
  const ink = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

  const lines = specimenLines(source).map((line, lineIndex) => {
    const baseline = lineIndex * lineHeight
    const glyphs: PlacedGlyph[] = []
    let pen = 0
    const shapedLine = line ? font.shapeLine(line) : []
    shapedLine.forEach((shaped, i) => {
      const glyphText = String.fromCodePoint(...shaped.codePoints)
      let polygon: PolygonGlyph | null = null
      let error: string | null = null
      if (shaped.missing) {
        if (glyphText.trim()) missing.add(glyphText)
      } else {
        for (const cp of shaped.codePoints) {
          const char = String.fromCodePoint(cp)
          if (char.trim() && !font.hasCharacter(cp)) missing.add(char)
        }
        try {
          polygon = glyphGeometry(font, shaped.index, params, key).polygon
        } catch (e) {
          error = e instanceof Error ? e.message : String(e)
          failedGlyphs++
        }
      }
      const x = pen + shaped.xOffset
      const y = baseline - shaped.yOffset
      glyphs.push({ index: shaped.index, text: glyphText, x, y, advance: shaped.xAdvance, missing: shaped.missing, polygon, error })
      // Tracking goes between glyphs, so a line does not grow past its last glyph.
      pen += shaped.xAdvance + (i < shapedLine.length - 1 ? tracking : 0)
      glyphCount++
    })
    return { glyphs, width: pen, baseline }
  })

  // Align every line inside the width of the longest one, then measure the outlines in place
  // (slanted around each glyph's baseline: x' = x + tan(slant) · height above the baseline).
  const blockWidth = Math.max(0, ...lines.map((l) => l.width))
  for (const line of lines) {
    const shift = layout.align === 'center' ? (blockWidth - line.width) / 2 : layout.align === 'right' ? blockWidth - line.width : 0
    for (const g of line.glyphs) {
      g.x += shift
      for (const p of polygonPoints(g.polygon)) {
        const px = g.x + p.x + shear * p.y
        const py = g.y - p.y
        minX = Math.min(minX, px)
        maxX = Math.max(maxX, px)
        minY = Math.min(minY, py)
        maxY = Math.max(maxY, py)
        ink.minX = Math.min(ink.minX, px)
        ink.maxX = Math.max(ink.maxX, px)
        ink.minY = Math.min(ink.minY, py)
        ink.maxY = Math.max(ink.maxY, py)
      }
    }
    maxX = Math.max(maxX, shift + line.width)
    maxY = Math.max(maxY, line.baseline - descender)
  }
  const textTop = -ascender
  const textBottom = (lines.length - 1) * lineHeight - descender

  return {
    lines,
    lineHeight,
    ascender,
    descender,
    capHeight,
    bounds: { minX, minY, maxX, maxY },
    ink: ink.minX <= ink.maxX ? ink : null,
    blockWidth,
    textTop,
    textBottom,
    slant,
    missingCharacters: [...missing],
    failedGlyphs,
    glyphCount,
    truncated,
    kerning: font.hasKerning,
  }
}

function polygonPoints(polygon: PolygonGlyph | null): Point[] {
  return polygon ? polygon.contours.flatMap((c) => c.points) : []
}
