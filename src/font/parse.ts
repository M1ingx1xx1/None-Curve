// Geometry adapter: turns a parsed font into the shared LoadedFont / SourceGlyph model.
// fontkit is loaded on demand so it stays out of the initial bundle.

import type { Font, Glyph } from 'fontkit'
import type { GlyphRef, Point, SourceContour, SourceGlyph } from '../geometry/types'
import { FontLoadError } from './errors'
import type { FontFormat, FontMetrics, FontSource, LoadedFont, VariationAxis } from './model'
import { sniffFontFormat } from './sniff'

let loadId = 0

export async function parseFont(bytes: Uint8Array, source: FontSource, signal: AbortSignal): Promise<LoadedFont> {
  const format = sniffFontFormat(bytes)
  const fontkit = await import('fontkit')
  signal.throwIfAborted()

  let font: Font
  try {
    // fontkit's types ask for a Node Buffer; in the browser build a Uint8Array is what it reads.
    const parsed = fontkit.create(bytes as unknown as Buffer)
    if ('fonts' in parsed) {
      throw new FontLoadError('unsupported-format', 'Font collections are not supported yet.')
    }
    font = parsed
    // Touch the required tables now so a damaged file fails here, not later in the canvas.
    void font.numGlyphs
    void font.unitsPerEm
    void font.characterSet
  } catch (error) {
    if (error instanceof FontLoadError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new FontLoadError('parse', `The ${format.toUpperCase()} data could not be read (${detail}). The file may be damaged.`)
  }

  if (!font.numGlyphs) throw new FontLoadError('no-glyphs', 'The font contains no glyphs.')

  return buildLoadedFont(font, format, source)
}

function buildLoadedFont(font: Font, format: FontFormat, source: FontSource): LoadedFont {
  const metrics: FontMetrics = {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascent,
    descender: font.descent,
    xHeight: font.xHeight || null,
    capHeight: font.capHeight || null,
  }

  const characters: GlyphRef[] = []
  for (const unicode of [...font.characterSet].sort((a, b) => a - b)) {
    if (isControlCharacter(unicode)) continue
    const glyph = safeGlyph(() => font.glyphForCodePoint(unicode))
    if (glyph && glyph.id !== 0) characters.push({ index: glyph.id, name: glyphName(glyph), unicode })
  }

  const firstCodePoint = new Map<number, number>()
  for (const ref of characters) if (!firstCodePoint.has(ref.index)) firstCodePoint.set(ref.index, ref.unicode!)

  let allGlyphs: GlyphRef[] | null = null
  const listAllGlyphs = () => {
    if (!allGlyphs) {
      allGlyphs = Array.from({ length: font.numGlyphs }, (_, index) => {
        const glyph = safeGlyph(() => font.getGlyph(index))
        return { index, name: glyph ? glyphName(glyph) : '', unicode: firstCodePoint.get(index) ?? null }
      })
    }
    return allGlyphs
  }

  const axes: VariationAxis[] = Object.entries(font.variationAxes ?? {}).flatMap(([tag, axis]) =>
    axis ? [{ tag, name: axis.name, min: axis.min, default: axis.default, max: axis.max }] : [],
  )

  const outlineCache = new Map<number, SourceGlyph>()
  const previewCache = new Map<number, string>()

  const refFor = (index: number): GlyphRef => ({
    index,
    name: glyphName(font.getGlyph(index)),
    unicode: firstCodePoint.get(index) ?? null,
  })

  return {
    id: `font-${++loadId}`,
    source,
    format,
    familyName: font.familyName || 'Untitled',
    styleName: font.subfamilyName || 'Regular',
    metrics,
    glyphCount: font.numGlyphs,
    characters,
    listAllGlyphs,
    axes,
    getGlyph(index) {
      let outline = outlineCache.get(index)
      if (!outline) {
        outline = toSourceGlyph(font.getGlyph(index), refFor(index), metrics)
        outlineCache.set(index, outline)
      }
      return outline
    },
    getPreviewPath(index) {
      let path = previewCache.get(index)
      if (path === undefined) {
        path = safeGlyph(() => font.getGlyph(index))?.path.toSVG() ?? ''
        previewCache.set(index, path)
      }
      return path
    },
  }
}

/** C0, DEL, and C1 controls have no visible form; they stay reachable under "All glyphs". */
function isControlCharacter(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp < 0xa0)
}

function safeGlyph(read: () => Glyph): Glyph | null {
  try {
    return read()
  } catch {
    return null
  }
}

function glyphName(glyph: Glyph): string {
  try {
    return glyph.name ?? ''
  } catch {
    return ''
  }
}

function toSourceGlyph(glyph: Glyph, ref: GlyphRef, fontMetrics: FontMetrics): SourceGlyph {
  const contours: SourceContour[] = []
  let current: SourceContour | null = null
  const point = (args: number[], i: number): Point => ({ x: args[i], y: args[i + 1] })

  for (const { command, args } of glyph.path.commands) {
    if (command === 'moveTo') {
      current = { start: point(args, 0), segments: [] }
      contours.push(current)
    } else if (command === 'closePath') {
      current = null
    } else if (current) {
      if (command === 'lineTo') current.segments.push({ type: 'line', to: point(args, 0) })
      else if (command === 'quadraticCurveTo')
        current.segments.push({ type: 'quad', control: point(args, 0), to: point(args, 2) })
      else if (command === 'bezierCurveTo')
        current.segments.push({ type: 'cubic', control1: point(args, 0), control2: point(args, 2), to: point(args, 4) })
    }
  }

  const bbox = glyph.bbox
  const hasBounds = contours.length > 0 && Number.isFinite(bbox.minX) && Number.isFinite(bbox.maxX)

  return {
    ref,
    contours,
    metrics: {
      unitsPerEm: fontMetrics.unitsPerEm,
      ascender: fontMetrics.ascender,
      descender: fontMetrics.descender,
      advanceWidth: glyph.advanceWidth,
      leftSideBearing: hasBounds ? bbox.minX : 0,
      rightSideBearing: hasBounds ? glyph.advanceWidth - bbox.maxX : 0,
    },
  }
}
