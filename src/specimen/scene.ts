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
  /** Scene bounds (y down) covering every line's ascender/descender and every outline. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  missingCharacters: string[]
  failedGlyphs: number
  glyphCount: number
  truncated: boolean
  kerning: boolean
}

/** Splits text into lines; \r\n and \r count as line breaks. */
export function specimenLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

export function buildSpecimenScene(font: LoadedFont, text: string, params: GeometryParams, key: string): SpecimenScene {
  const { ascender, descender, lineGap } = font.metrics
  const lineHeight = ascender - descender + lineGap
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

  const lines = specimenLines(source).map((line, lineIndex) => {
    const baseline = lineIndex * lineHeight
    const glyphs: PlacedGlyph[] = []
    let pen = 0
    for (const shaped of line ? font.shapeLine(line) : []) {
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
      for (const p of polygonPoints(polygon)) {
        minX = Math.min(minX, x + p.x)
        maxX = Math.max(maxX, x + p.x)
        minY = Math.min(minY, y - p.y)
        maxY = Math.max(maxY, y - p.y)
      }
      glyphs.push({ index: shaped.index, text: glyphText, x, y, advance: shaped.xAdvance, missing: shaped.missing, polygon, error })
      pen += shaped.xAdvance
      glyphCount++
    }
    maxX = Math.max(maxX, pen)
    maxY = Math.max(maxY, baseline - descender)
    return { glyphs, width: pen, baseline }
  })

  return {
    lines,
    lineHeight,
    ascender,
    descender,
    bounds: { minX, minY, maxX, maxY },
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
