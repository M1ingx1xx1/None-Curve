// Lays out specimen text with the final polygons, in two stages: shaping (positions, advances,
// kerning, alignment) and placing polygons (which arrive from the geometry worker). Shared by the
// canvas, the preview, and SVG export so all use identical positions and outlines. No React, no DOM.

import type { LoadedFont } from '../font/model'
import type { Point, PolygonGlyph } from '../geometry/types'

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
  /** Glyphs still being computed for the current settings (drawn with their previous shape or not yet). */
  pendingGlyphs: number
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

/** A glyph's final polygon, its failure, or null while it has not been computed yet. `stale` marks a
    polygon from earlier settings, shown until the current one arrives. */
export type PolygonLookup = (index: number) => { polygon: PolygonGlyph; stale?: boolean } | { error: string } | null

/** Shaped glyphs with positions, before polygons are attached (see placePolygons). */
export interface ShapedSpecimen {
  lines: { glyphs: Omit<PlacedGlyph, 'polygon' | 'error'>[]; width: number; baseline: number }[]
  /** Glyphs to compute, each once, in reading order. */
  indices: number[]
  lineHeight: number
  ascender: number
  descender: number
  capHeight: number
  blockWidth: number
  slant: number
  missingCharacters: string[]
  glyphCount: number
  truncated: boolean
  kerning: boolean
}

/**
 * Shapes the text and places every glyph: advances, kerning, tracking, line height, and alignment.
 * No outlines yet, so this only reruns when the text or the typography changes.
 */
export function shapeSpecimen(font: LoadedFont, text: string, layout: SceneLayout = PLAIN_LAYOUT): ShapedSpecimen {
  const { ascender, descender, lineGap, unitsPerEm } = font.metrics
  const capHeight = font.metrics.capHeight ?? unitsPerEm * 0.7
  const lineHeight = (ascender - descender + lineGap) * (Number.isFinite(layout.lineHeight) && layout.lineHeight > 0 ? layout.lineHeight : 1)
  const tracking = ((Number.isFinite(layout.tracking) ? layout.tracking : 0) * unitsPerEm) / 1000
  const slant = Number.isFinite(layout.slant) ? Math.max(-89, Math.min(89, layout.slant)) : 0
  const chars = [...text]
  const truncated = chars.length > SPECIMEN_MAX_CHARS
  const source = truncated ? chars.slice(0, SPECIMEN_MAX_CHARS).join('') : text

  const missing = new Set<string>()
  const indices = new Set<number>()
  let glyphCount = 0
  const lines = specimenLines(source).map((line, lineIndex) => {
    const baseline = lineIndex * lineHeight
    const glyphs: ShapedSpecimen['lines'][number]['glyphs'] = []
    let pen = 0
    const shapedLine = line ? font.shapeLine(line) : []
    shapedLine.forEach((shaped, i) => {
      const glyphText = String.fromCodePoint(...shaped.codePoints)
      if (shaped.missing) {
        if (glyphText.trim()) missing.add(glyphText)
      } else {
        for (const cp of shaped.codePoints) {
          const char = String.fromCodePoint(cp)
          if (char.trim() && !font.hasCharacter(cp)) missing.add(char)
        }
        indices.add(shaped.index)
      }
      glyphs.push({ index: shaped.index, text: glyphText, x: pen + shaped.xOffset, y: baseline - shaped.yOffset, advance: shaped.xAdvance, missing: shaped.missing })
      // Tracking goes between glyphs, so a line does not grow past its last glyph.
      pen += shaped.xAdvance + (i < shapedLine.length - 1 ? tracking : 0)
      glyphCount++
    })
    return { glyphs, width: pen, baseline }
  })

  // Align every line inside the width of the longest one.
  const blockWidth = Math.max(0, ...lines.map((l) => l.width))
  for (const line of lines) {
    const shift = layout.align === 'center' ? (blockWidth - line.width) / 2 : layout.align === 'right' ? blockWidth - line.width : 0
    for (const g of line.glyphs) g.x += shift
  }

  return {
    lines,
    indices: [...indices],
    lineHeight,
    ascender,
    descender,
    capHeight,
    blockWidth,
    slant,
    missingCharacters: [...missing],
    glyphCount,
    truncated,
    kerning: font.hasKerning,
  }
}

/**
 * Attaches each glyph's polygon (from `lookup`) and measures the outlines in place, slanted around
 * each glyph's baseline (x′ = x + tan(slant) · height above the baseline). Cheap; reruns whenever new
 * polygons arrive.
 */
export function placePolygons(shaped: ShapedSpecimen, lookup: PolygonLookup): SpecimenScene {
  const { ascender, descender, lineHeight, blockWidth, slant } = shaped
  const shear = Math.tan((slant * Math.PI) / 180)
  let failedGlyphs = 0
  let pendingGlyphs = 0
  let minX = 0
  let maxX = 0
  let minY = -ascender
  let maxY = -descender
  const ink = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

  const lines = shaped.lines.map((line) => {
    const glyphs = line.glyphs.map((g): PlacedGlyph => {
      if (g.missing) return { ...g, polygon: null, error: null }
      const found = lookup(g.index)
      if (!found) {
        pendingGlyphs++
        return { ...g, polygon: null, error: null }
      }
      if ('error' in found) {
        failedGlyphs++
        return { ...g, polygon: null, error: found.error }
      }
      if (found.stale) pendingGlyphs++
      const extent = slantedExtent(found.polygon, shear)
      if (extent) {
        ink.minX = Math.min(ink.minX, g.x + extent.minX)
        ink.maxX = Math.max(ink.maxX, g.x + extent.maxX)
        ink.minY = Math.min(ink.minY, g.y + extent.minY)
        ink.maxY = Math.max(ink.maxY, g.y + extent.maxY)
      }
      return { ...g, polygon: found.polygon, error: null }
    })
    // The longest line spans the whole block width; aligned lines stay inside it.
    maxX = Math.max(maxX, blockWidth)
    maxY = Math.max(maxY, line.baseline - descender)
    return { glyphs, width: line.width, baseline: line.baseline }
  })

  if (ink.minX <= ink.maxX) {
    minX = Math.min(minX, ink.minX)
    maxX = Math.max(maxX, ink.maxX)
    minY = Math.min(minY, ink.minY)
    maxY = Math.max(maxY, ink.maxY)
  }

  return {
    lines,
    lineHeight,
    ascender,
    descender,
    capHeight: shaped.capHeight,
    bounds: { minX, minY, maxX, maxY },
    ink: ink.minX <= ink.maxX ? ink : null,
    blockWidth,
    textTop: -ascender,
    textBottom: (shaped.lines.length - 1) * lineHeight - descender,
    slant,
    missingCharacters: shaped.missingCharacters,
    failedGlyphs,
    pendingGlyphs,
    glyphCount: shaped.glyphCount,
    truncated: shaped.truncated,
    kerning: shaped.kerning,
  }
}

const extents = new WeakMap<PolygonGlyph, { shear: number; extent: Extent | null }>()

interface Extent {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * A polygon's extent relative to its glyph origin in scene coordinates (y down), slanted by `shear`.
 * Cached per polygon, so a text that repeats a glyph a thousand times measures it once.
 */
function slantedExtent(polygon: PolygonGlyph, shear: number): Extent | null {
  const cached = extents.get(polygon)
  if (cached && cached.shear === shear) return cached.extent
  let extent: Extent | null = null
  for (const c of polygon.contours) {
    for (const p of c.points as Point[]) {
      const x = p.x + shear * p.y
      const y = -p.y
      if (!extent) extent = { minX: x, minY: y, maxX: x, maxY: y }
      else {
        extent.minX = Math.min(extent.minX, x)
        extent.maxX = Math.max(extent.maxX, x)
        extent.minY = Math.min(extent.minY, y)
        extent.maxY = Math.max(extent.maxY, y)
      }
    }
  }
  extents.set(polygon, { shear, extent })
  return extent
}
