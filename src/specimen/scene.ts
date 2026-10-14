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
  /** Where the polygon is drawn in scene units (y down), slant and thorns included; null without one. */
  ink: Extent | null
}

export interface SpecimenScene {
  /** Each line's `ink` covers its glyphs' ink (null when nothing on it is drawn). */
  lines: { glyphs: PlacedGlyph[]; width: number; baseline: number; ink: Extent | null }[]
  lineHeight: number
  ascender: number
  descender: number
  /** Height of a capital letter (the font's cap height, or 0.7 em when the font does not say). */
  capHeight: number
  /** Bounds (y down) of the drawn outlines alone, slant included: where the ink is. Null when nothing
      is drawn (only spaces or missing characters). */
  ink: Extent | null
  /** Bounds (y down) of the letters the text is placed by: the ink, except that a glyph with a layout
      box (Thorn) counts its outline before the thorns grew (slanted exactly by its layout hull). Equal
      to `ink` when no glyph has one. */
  body: Extent | null
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
    polygon from earlier settings, shown until the current one arrives. `occurrence` counts every glyph
    of the text in reading order (lines, then glyphs; spaces and missing glyphs included), from 0 to
    glyphCount − 1, so one occurrence of a glyph can have a polygon of its own. */
export type PolygonLookup = (index: number, occurrence: number) => { polygon: PolygonGlyph; stale?: boolean } | { error: string } | null

/** Shaped glyphs with positions, before polygons are attached (see placePolygons). */
export interface ShapedSpecimen {
  lines: { glyphs: Omit<PlacedGlyph, 'polygon' | 'error' | 'ink'>[]; width: number; baseline: number }[]
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
  const ink = emptyExtent()
  const body = emptyExtent()
  let occurrence = 0

  const lines = shaped.lines.map((line) => {
    const lineInk = emptyExtent()
    const glyphs = line.glyphs.map((g): PlacedGlyph => {
      const at = occurrence++
      if (g.missing) return { ...g, polygon: null, error: null, ink: null }
      const found = lookup(g.index, at)
      if (!found) {
        pendingGlyphs++
        return { ...g, polygon: null, error: null, ink: null }
      }
      if ('error' in found) {
        failedGlyphs++
        return { ...g, polygon: null, error: found.error, ink: null }
      }
      if (found.stale) pendingGlyphs++
      const extent = slantedExtent(found.polygon, shear)
      if (!extent) return { ...g, polygon: found.polygon, error: null, ink: null }
      const placed = offset(extent, g.x, g.y)
      include(lineInk, placed)
      const layoutBox = validBox(found.polygon.layoutBox)
      include(body, layoutBox ? offset(slantedBody(found.polygon, layoutBox, shear), g.x, g.y) : placed)
      return { ...g, polygon: found.polygon, error: null, ink: placed }
    })
    const drawn = lineInk.minX <= lineInk.maxX ? lineInk : null
    if (drawn) include(ink, drawn)
    return { glyphs, width: line.width, baseline: line.baseline, ink: drawn }
  })

  return {
    lines,
    lineHeight,
    ascender,
    descender,
    capHeight: shaped.capHeight,
    ink: ink.minX <= ink.maxX ? ink : null,
    body: body.minX <= body.maxX ? body : null,
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

export interface Extent {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const emptyExtent = (): Extent => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })

function include(into: Extent, e: Extent) {
  into.minX = Math.min(into.minX, e.minX)
  into.maxX = Math.max(into.maxX, e.maxX)
  into.minY = Math.min(into.minY, e.minY)
  into.maxY = Math.max(into.maxY, e.maxY)
}

const offset = (e: Extent, x: number, y: number): Extent => ({ minX: x + e.minX, minY: y + e.minY, maxX: x + e.maxX, maxY: y + e.maxY })

/** A layout box that can be measured (finite, not inverted), or null. */
function validBox(box: Extent | undefined): Extent | null {
  if (!box) return null
  const { minX, minY, maxX, maxY } = box
  return [minX, minY, maxX, maxY].every(Number.isFinite) && minX <= maxX && minY <= maxY ? box : null
}

/**
 * A box in font units (y up) slanted like the outlines, relative to the glyph origin in scene
 * coordinates (y down): its four corners, so it covers every outline that fits in the box.
 */
function slantedBox(box: Extent, shear: number): Extent {
  const low = shear * box.minY
  const high = shear * box.maxY
  return { minX: box.minX + Math.min(low, high), minY: -box.maxY, maxX: box.maxX + Math.max(low, high), maxY: -box.minY }
}

const bodies = new WeakMap<PolygonGlyph, { shear: number; extent: Extent }>()

/**
 * The letter before its thorns grew, slanted like the outlines, relative to the glyph origin in scene
 * coordinates (y down): the slanted layout hull, which reaches exactly as far as the slanted letter,
 * within the layout box's height. Its slanted corners stand in when unslanted (where they are exact)
 * or without a hull that can be measured. Cached per polygon.
 */
function slantedBody(polygon: PolygonGlyph, box: Extent, shear: number): Extent {
  const corners = slantedBox(box, shear)
  const hull = polygon.layoutHull
  if (shear === 0 || !hull?.length) return corners
  const cached = bodies.get(polygon)
  if (cached && cached.shear === shear) return cached.extent
  let minX = Infinity
  let maxX = -Infinity
  for (const p of hull) {
    const x = p.x + shear * p.y
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  const extent = Number.isFinite(minX) && Number.isFinite(maxX) && minX <= maxX ? { ...corners, minX, maxX } : corners
  bodies.set(polygon, { shear, extent })
  return extent
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
