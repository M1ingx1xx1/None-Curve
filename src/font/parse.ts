// Geometry adapter: turns a parsed font into the shared LoadedFont / SourceGlyph model.
// fontkit is loaded on demand so it stays out of the initial bundle.

import type { Font, Glyph } from 'fontkit'
import type { GlyphRef, Point, SourceContour, SourceGlyph } from '../geometry/types'
import { FontLoadError } from './errors'
import type { FontFormat, FontInfo, FontMetrics, FontNameKey, FontSource, LoadedFont, VariationAxis } from './model'
import { sniffFontFormat } from './sniff'
import { woff2ToTrueType } from './woff2'

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

  // A Google font loaded at a weight is normally a static file Google made for that weight; when it is
  // still the variable file, the weight is applied here (the geometry worker does the same).
  const weight = source.kind === 'google' ? source.weight : null
  const axis = font.variationAxes?.wght
  if (weight !== null && axis && weight !== axis.default) {
    const value = Math.min(axis.max, Math.max(axis.min, weight))
    const instance = instanceAt(fontkit, font, bytes, { wght: value })
    if (instance) return buildLoadedFont(instance, format, source, bytes, { wght: value })
  }
  return buildLoadedFont(font, format, source, bytes, null)
}

/**
 * The font with these axis values applied, or null if fontkit cannot apply them. fontkit can only vary
 * TrueType files, so a WOFF2 file is first rebuilt as TrueType.
 */
function instanceAt(fontkit: typeof import('fontkit'), font: Font, bytes: Uint8Array, settings: Record<string, number>): Font | null {
  try {
    let base = font
    if (font.type === 'WOFF2') {
      const trueType = woff2ToTrueType(fontkit.create(bytes as unknown as Buffer))
      if (!trueType) return null
      base = fontkit.create(trueType as unknown as Buffer) as Font
    }
    const instance = base.getVariation(settings)
    void instance.getGlyph(0).path // fails here, not later, if the variation data cannot be read
    return instance
  } catch {
    return null
  }
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
}

function buildLoadedFont(
  colourFont: Font,
  format: FontFormat,
  source: FontSource,
  bytes: Uint8Array,
  instance: Record<string, number> | null,
): LoadedFont {
  const font = useOutlineGlyphs(colourFont)
  const metrics: FontMetrics = {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascent,
    descender: font.descent,
    xHeight: font.xHeight || null,
    capHeight: font.capHeight || null,
    lineGap: font.lineGap || 0,
  }

  const characters: GlyphRef[] = []
  for (const unicode of [...font.characterSet].sort((a, b) => a - b)) {
    if (isControlCharacter(unicode)) continue
    const glyph = safeGlyph(() => font.glyphForCodePoint(unicode))
    if (glyph && glyph.id !== 0) characters.push({ index: glyph.id, name: glyphName(glyph), unicode })
  }

  const mappedCodePoints = new Set<number>()
  for (const cp of font.characterSet) {
    const glyph = safeGlyph(() => font.glyphForCodePoint(cp))
    if (glyph && glyph.id !== 0) mappedCodePoints.add(cp)
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

  // An instance made here still carries the variable file's default style name and weight class.
  const italic = source.kind === 'google' && source.italic
  // Named from the weight when this app applied it, or when a Google file at another weight than
  // 400 still calls itself Regular (Playwrite at 300).
  const weight = instance?.wght ?? (source.kind === 'google' && source.weight !== 400 ? source.weight : null)
  const ownName = typographicName(font, 'preferredSubfamily') || font.subfamilyName || 'Regular'
  const styleName =
    weight !== null && (instance || ownName === 'Regular' || ownName === 'Italic')
      ? `${WEIGHT_NAMES[Math.round(weight / 100) * 100] ?? `W${weight}`}${italic ? ' Italic' : ''}`.replace('Regular Italic', 'Italic')
      : ownName
  const info = readFontInfo(font)
  if (instance) {
    if (info.os2) info.os2.weightClass = Math.round(instance.wght)
    info.macStyle = instance.wght >= 700 ? info.macStyle | 1 : info.macStyle & ~1
  }

  return {
    id: `font-${++loadId}`,
    source,
    format,
    bytes,
    familyName: typographicName(font, 'preferredFamily') || font.familyName || 'Untitled',
    styleName,
    metrics,
    info,
    instance,
    glyphCount: font.numGlyphs,
    characters,
    listAllGlyphs,
    axes,
    hasCharacter: (cp) => mappedCodePoints.has(cp),
    hasKerning: safeFeatures(font).includes('kern') || hasTable(font, 'kern'),
    shapeLine(text) {
      const chars = [...text]
      let run: ReturnType<Font['layout']>
      try {
        run = font.layout(text, NO_LIGATURES)
      } catch {
        // Some fonts have layout tables fontkit cannot read (Iosevka Charon): set the text one glyph
        // per character with the plain advance widths, without kerning.
        return chars.map((char) => {
          const cp = char.codePointAt(0)!
          const glyph = safeGlyph(() => font.glyphForCodePoint(cp))
          const id = glyph?.id ?? 0
          const xAdvance = safeGlyph(() => font.getGlyph(id))?.advanceWidth ?? 0
          return { index: id, codePoints: [cp], xAdvance, xOffset: 0, yOffset: 0, missing: id === 0 }
        })
      }
      // With ligatures off, glyphs map to characters one to one unless shaping composed or
      // decomposed something; only then fall back to fontkit's (shared) code points.
      const oneToOne = run.glyphs.length === chars.length
      return run.glyphs.map((glyph, i) => {
        const position = run.positions[i]
        const codePoints = oneToOne ? [chars[i].codePointAt(0)!] : [...glyph.codePoints]
        return {
          index: glyph.id,
          codePoints,
          xAdvance: position.xAdvance,
          xOffset: position.xOffset,
          yOffset: position.yOffset,
          missing: glyph.id === 0,
        }
      })
    },
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

/** Keeps one glyph per character so the specimen and font export stay character-for-character. */
/**
 * Makes the font hand out plain outline glyphs. For colour fonts fontkit's getGlyph returns colour
 * glyphs built from layers or bitmaps, which it cannot read for COLR version 1 (Nabla, Honk, the
 * "Ink" families) and which have no outline to edit; the outline glyph underneath is what this app uses.
 */
function useOutlineGlyphs(font: Font): Font {
  const internals = font as unknown as {
    directory: { tables: Record<string, unknown> }
    _glyphs: Record<number, Glyph | undefined>
    _getBaseGlyph?: (id: number, characters?: number[]) => Glyph | null | undefined
  }
  const tables = internals.directory?.tables ?? {}
  if ((tables.COLR || tables.sbix) && internals._getBaseGlyph) {
    const base = internals._getBaseGlyph.bind(font)
    // Colour glyphs made so far would be handed out from the cache.
    internals._glyphs = {}
    // fontkit's WOFF2 version returns nothing for a glyph it has already made, so read the cache too.
    font.getGlyph = ((id: number, characters?: number[]) => base(id, characters) ?? internals._glyphs[id] ?? null) as Font['getGlyph']
  }
  return font
}

/**
 * The typographic family or style name (name IDs 16 and 17) when the font has one. A static weight
 * such as Google's "Roboto" at 900 is named "Roboto Black" / "Regular" for old apps and "Roboto" /
 * "Black" here.
 */
function typographicName(font: Font, key: 'preferredFamily' | 'preferredSubfamily'): string | null {
  try {
    return (font as unknown as { getName(key: string): string | null }).getName(key)
  } catch {
    return null
  }
}

const NO_LIGATURES = { liga: false, clig: false, dlig: false, hlig: false, calt: false, rlig: false }

/** fontkit decodes bit fields as objects of named flags; these are the names in bit order. */
const FS_TYPE_BITS = [null, 'noEmbedding', 'viewOnly', 'editable', null, null, null, null, 'noSubsetting', 'bitmapOnly']
const FS_SELECTION_BITS = ['italic', 'underscore', 'negative', 'outlined', 'strikeout', 'bold', 'regular', 'useTypoMetrics', 'wws', 'oblique']
const MAC_STYLE_BITS = ['bold', 'italic', 'underline', 'outline', 'shadow', 'condensed', 'extended']
const NAME_KEYS: FontNameKey[] = ['copyright', 'version', 'trademark', 'manufacturer', 'designer', 'description', 'vendorURL', 'designerURL', 'license', 'licenseURL']

function bits(flags: unknown, names: readonly (string | null)[]): number {
  if (typeof flags === 'number') return flags
  if (!flags || typeof flags !== 'object') return 0
  return names.reduce((value, name, bit) => (name && (flags as Record<string, unknown>)[name] ? value | (1 << bit) : value), 0)
}

/** Reads the tables an exported font copies. Any table that cannot be read just falls back to defaults. */
function readFontInfo(font: Font): FontInfo {
  // OS/2, hhea, post, head, and name are part of fontkit's runtime API but not all are typed.
  const tables = font as unknown as Record<string, Record<string, unknown> | undefined>
  const read = <T,>(get: () => T, fallback: T): T => {
    try {
      return get() ?? fallback
    } catch {
      return fallback
    }
  }
  const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const optional = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const os2 = read(() => {
    const t = tables['OS/2']
    if (!t) return null
    return {
      weightClass: num(t.usWeightClass, 400),
      widthClass: num(t.usWidthClass, 5),
      fsType: bits(t.fsType, FS_TYPE_BITS),
      fsSelection: bits(t.fsSelection, FS_SELECTION_BITS),
      familyClass: num(t.sFamilyClass),
      panose: Array.isArray(t.panose) ? t.panose.slice(0, 10).map((v) => num(v)) : [],
      subscript: [num(t.ySubscriptXSize), num(t.ySubscriptYSize), num(t.ySubscriptXOffset), num(t.ySubscriptYOffset)] as [number, number, number, number],
      superscript: [num(t.ySuperscriptXSize), num(t.ySuperscriptYSize), num(t.ySuperscriptXOffset), num(t.ySuperscriptYOffset)] as [number, number, number, number],
      strikeoutSize: num(t.yStrikeoutSize),
      strikeoutPosition: num(t.yStrikeoutPosition),
      typoAscender: optional(t.typoAscender),
      typoDescender: optional(t.typoDescender),
      typoLineGap: optional(t.typoLineGap),
      winAscent: optional(t.winAscent),
      winDescent: optional(t.winDescent),
      xHeight: optional(t.xHeight),
      capHeight: optional(t.capHeight),
    }
  }, null)

  const names: FontInfo['names'] = {}
  for (const key of NAME_KEYS) {
    const value = read(() => font.getName(key, 'en'), null)
    if (typeof value === 'string' && value.trim()) names[key] = value.trim()
  }

  return {
    os2,
    lineGap: read(() => num(tables.hhea?.lineGap), 0),
    italicAngle: read(() => num(tables.post?.italicAngle), 0),
    underlinePosition: read(() => num(tables.post?.underlinePosition), 0),
    underlineThickness: read(() => num(tables.post?.underlineThickness), 0),
    isFixedPitch: read(() => num(tables.post?.isFixedPitch) !== 0, false),
    macStyle: read(() => bits(tables.head?.macStyle, MAC_STYLE_BITS), 0),
    names,
  }
}

function hasTable(font: Font, tag: string): boolean {
  // `directory` is part of fontkit's runtime API but missing from @types/fontkit.
  const directory = (font as Font & { directory?: { tables?: Record<string, unknown> } }).directory
  return Boolean(directory?.tables?.[tag])
}

function safeFeatures(font: Font): string[] {
  try {
    return font.availableFeatures ?? []
  } catch {
    return []
  }
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

  // Frozen so derived geometry can never modify the cached source outline.
  return deepFreeze({
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
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
