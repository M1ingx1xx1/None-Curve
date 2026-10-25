// Geometry adapter: turns a parsed font into the shared LoadedFont / SourceGlyph model.
// fontkit is loaded on demand so it stays out of the initial bundle.

import type { Font, Glyph } from 'fontkit'
import type { GlyphRef, Point, SourceContour, SourceGlyph } from '../geometry/types'
import { FontLoadError } from './errors'
import { readKerning } from './kerning'
import type {
  CollectionFace,
  FontFormat,
  FontInfo,
  FontMetrics,
  FontNameKey,
  FontSource,
  LoadedFont,
  SourceKerning,
  VariationAxis,
} from './model'
import { sniffFontFormat } from './sniff'
import { composeSubsets, unbundleSubsets } from './subsets'
import { looksLikeSvg, parseSvgFont } from './svgFont'
import { woff2ToTrueType } from './woff2'

let loadId = 0

export async function parseFont(bytes: Uint8Array, source: FontSource, signal: AbortSignal): Promise<LoadedFont> {
  // An SVG file is an artwork of one glyph (svgFont.ts); the geometry worker reads it the same way.
  if (looksLikeSvg(bytes)) return parseSvgFont(bytes, source)
  // A Google font in every subset (subsets.ts): each file parsed as usual, then made one font.
  const subsets = unbundleSubsets(bytes)
  if (subsets) {
    const parts: LoadedFont[] = []
    for (const file of subsets) parts.push(await parseFont(file, source, signal))
    return composeSubsets(parts, bytes, `font-${++loadId}`)
  }
  let format = sniffFontFormat(bytes)
  const fontkit = await import('fontkit')
  signal.throwIfAborted()

  let font: Font
  let collection: Collection | null = null
  try {
    // fontkit's types ask for a Node Buffer; in the browser build a Uint8Array is what it reads.
    const parsed = fontkit.create(bytes as unknown as Buffer)
    if ('fonts' in parsed) {
      const fonts = parsed.fonts // a new font object per face on every read
      collection = openCollection(fonts, source.kind === 'local' ? source.face : undefined)
      font = fonts[collection.face]
      if (hasTable(font, 'CFF ')) format = 'otc'
      // Record the face, so the geometry worker (which gets this source) opens the same one.
      if (source.kind === 'local') source = { ...source, face: collection.face }
    } else {
      font = parsed
    }
    // Touch the required tables now so a damaged file fails here, not later in the canvas.
    void font.numGlyphs
    void font.unitsPerEm
    void font.characterSet
  } catch (error) {
    if (error instanceof FontLoadError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new FontLoadError(
      'parse',
      `The ${format.toUpperCase()} data could not be read (${detail}). The file may be damaged.`,
    )
  }

  if (!font.numGlyphs) throw new FontLoadError('no-glyphs', 'The font contains no glyphs.')

  // A Google font loaded at a weight is normally a static file Google made for that weight; when it is
  // still the variable file, the weight is applied here (the geometry worker does the same).
  const weight = source.kind === 'google' ? source.weight : null
  const axis = font.variationAxes?.wght
  if (weight !== null && axis && weight !== axis.default) {
    const value = Math.min(axis.max, Math.max(axis.min, weight))
    const instance = instanceAt(fontkit, font, bytes, { wght: value })
    if (instance) return buildLoadedFont(fontkit, instance, format, source, bytes, { wght: value }, null)
  }
  return buildLoadedFont(fontkit, font, format, source, bytes, null, collection)
}

interface Collection {
  faces: CollectionFace[]
  face: number
}

/**
 * Lists a collection's faces and picks one: `requested` if it is a face of the file, else the upright
 * face closest to Regular (weight 400, normal width), else the first. Faces whose PostScript name
 * starts with a dot are hidden system faces (macOS) and are left out unless there is nothing else.
 */
function openCollection(fonts: Font[], requested: number | undefined): Collection {
  if (!fonts.length) throw new FontLoadError('no-glyphs', 'The font collection contains no fonts.')
  const all = fonts.map((font, index) => describeFace(font, index))
  const shown = all.filter((f) => !f.hidden)
  const faces = shown.length ? shown : all
  if (requested !== undefined && Number.isInteger(requested) && requested >= 0 && requested < fonts.length) {
    return { faces, face: requested }
  }
  // Upright first, then weight, then width; the earlier face wins a tie.
  const score = (f: (typeof all)[number]) =>
    (f.italic ? 1e6 : 0) + Math.abs(f.weight - 400) * 10 + Math.abs(f.width - 5)
  const best = faces.reduce((a, b) => (score(b) < score(a) ? b : a))
  return { faces, face: best.index }
}

function describeFace(
  font: Font,
  index: number,
): CollectionFace & { hidden: boolean; italic: boolean; weight: number; width: number } {
  const read = <T>(get: () => T, fallback: T): T => {
    try {
      return get() ?? fallback
    } catch {
      return fallback
    }
  }
  const family = read(() => typographicName(font, 'preferredFamily') || font.familyName, '') || `Face ${index + 1}`
  const style = read(() => typographicName(font, 'preferredSubfamily') || font.subfamilyName, '') || 'Regular'
  const os2 = read(() => (font as unknown as Record<string, Record<string, unknown> | undefined>)['OS/2'], undefined)
  const fsSelection = os2?.fsSelection as { italic?: boolean; oblique?: boolean } | undefined
  return {
    index,
    family,
    style,
    hidden: read(() => font.postscriptName, '').startsWith('.'),
    italic: Boolean(
      fsSelection?.italic || fsSelection?.oblique || read(() => font.italicAngle, 0) || /italic|oblique/i.test(style),
    ),
    weight: typeof os2?.usWeightClass === 'number' ? os2.usWeightClass : 400,
    width: typeof os2?.usWidthClass === 'number' ? os2.usWidthClass : 5,
  }
}

/**
 * The font with these axis values applied, or null if fontkit cannot apply them. fontkit can only vary
 * TrueType files, so a WOFF2 file is first rebuilt as TrueType (`base`: rebuilt once by the caller).
 */
function instanceAt(
  fontkit: typeof import('fontkit'),
  font: Font,
  bytes: Uint8Array,
  settings: Record<string, number>,
  base = variableBase(fontkit, font, bytes),
): Font | null {
  try {
    if (!base) return null
    const instance = base.getVariation(settings)
    void instance.getGlyph(0).path // fails here, not later, if the variation data cannot be read
    return instance
  } catch {
    return null
  }
}

/** The font fontkit can vary: the font itself, or a WOFF2 file rebuilt as TrueType; null if that fails. */
function variableBase(fontkit: typeof import('fontkit'), font: Font, bytes: Uint8Array): Font | null {
  try {
    if (font.type !== 'WOFF2') return font
    const trueType = woff2ToTrueType(fontkit.create(bytes as unknown as Buffer))
    return trueType ? (fontkit.create(trueType as unknown as Buffer) as Font) : null
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
  fontkit: typeof import('fontkit'),
  colourFont: Font,
  format: FontFormat,
  source: FontSource,
  bytes: Uint8Array,
  instance: Record<string, number> | null,
  collection: Collection | null,
): LoadedFont {
  const font = withOutlineGlyphs(colourFont)
  const metrics: FontMetrics = {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascent,
    descender: font.descent,
    xHeight: font.xHeight || null,
    capHeight: font.capHeight || null,
    lineGap: font.lineGap || 0,
  }

  // One pass over the character map: every mapped code point (controls too) for hasCharacter, the rest as characters.
  const characters: GlyphRef[] = []
  const mappedCodePoints = new Set<number>()
  for (const unicode of [...font.characterSet].sort((a, b) => a - b)) {
    const glyph = safeGlyph(() => font.glyphForCodePoint(unicode))
    if (!glyph || glyph.id === 0) continue
    mappedCodePoints.add(unicode)
    if (!isControlCharacter(unicode)) characters.push({ index: glyph.id, name: glyphName(glyph), unicode })
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

  let kerning: SourceKerning | null | undefined

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
      ? `${WEIGHT_NAMES[Math.round(weight / 100) * 100] ?? `W${weight}`}${italic ? ' Italic' : ''}`.replace(
          'Regular Italic',
          'Italic',
        )
      : ownName
  const info = readFontInfo(font)
  if (instance) {
    if (info.os2) info.os2.weightClass = Math.round(instance.wght)
    info.macStyle = instance.wght >= 700 ? info.macStyle | 1 : info.macStyle & ~1
  }

  const loaded: LoadedFont = {
    id: `font-${++loadId}`,
    source,
    format,
    bytes,
    faces: collection?.faces.map(({ index, family, style }) => ({ index, family, style })) ?? null,
    face: collection?.face ?? null,
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
    kerning() {
      if (kerning === undefined) kerning = readKerning(font)
      return kerning
    },
    ...glyphAccess(font, metrics, refFor),
  }
  // Sound driving an axis: the same font at other axis values, for its outlines and shaping alone.
  if (axes.length) loaded.at = instances(fontkit, font, bytes, axes, instance, loaded, metrics, refFor)
  return loaded
}

/** How many instances at other axis values a font keeps (the most recently used). */
const MAX_INSTANCES = 24

/**
 * `LoadedFont.at` for a variable font: the font at these axis values, merged over its own instance and clamped to each
 * axis; unknown tags are ignored. The font itself when they are its own values (or fontkit cannot vary it). The
 * instance shares everything with the font (id, metrics, characters, kerning) but its outlines and shaping.
 */
function instances(
  fontkit: typeof import('fontkit'),
  font: Font,
  bytes: Uint8Array,
  axes: VariationAxis[],
  own: Record<string, number> | null,
  loaded: LoadedFont,
  metrics: FontMetrics,
  refFor: (index: number) => GlyphRef,
): NonNullable<LoadedFont['at']> {
  const made = new Map<string, LoadedFont>()
  let base: Font | null | undefined
  return (coords) => {
    const settings: Record<string, number> = {}
    let differs = false
    for (const axis of axes) {
      const ownValue = own?.[axis.tag] ?? axis.default
      const asked = coords[axis.tag]
      const value =
        typeof asked === 'number' && Number.isFinite(asked) ? Math.min(axis.max, Math.max(axis.min, asked)) : ownValue
      if (value !== ownValue) differs = true
      settings[axis.tag] = value
    }
    if (!differs) return loaded
    const key = JSON.stringify(settings)
    let instance = made.get(key)
    if (instance) {
      made.delete(key)
    } else {
      if (base === undefined) base = variableBase(fontkit, font, bytes)
      const varied = instanceAt(fontkit, font, bytes, settings, base)
      instance = varied
        ? { ...loaded, instance: settings, ...glyphAccess(withOutlineGlyphs(varied), metrics, refFor) }
        : loaded
    }
    made.set(key, instance)
    while (made.size > MAX_INSTANCES) made.delete(made.keys().next().value!)
    return instance
  }
}

/** Shaping, outlines and previews read from `font`, each kept once read. */
function glyphAccess(
  font: Font,
  metrics: FontMetrics,
  refFor: (index: number) => GlyphRef,
): Pick<LoadedFont, 'shapeLine' | 'getGlyph' | 'getPreviewPath'> {
  const outlineCache = new Map<number, SourceGlyph>()
  const previewCache = new Map<number, string>()
  return {
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
function withOutlineGlyphs(font: Font): Font {
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
    font.getGlyph = ((id: number, characters?: number[]) =>
      base(id, characters) ?? internals._glyphs[id] ?? null) as Font['getGlyph']
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
const FS_SELECTION_BITS = [
  'italic',
  'underscore',
  'negative',
  'outlined',
  'strikeout',
  'bold',
  'regular',
  'useTypoMetrics',
  'wws',
  'oblique',
]
const MAC_STYLE_BITS = ['bold', 'italic', 'underline', 'outline', 'shadow', 'condensed', 'extended']
const NAME_KEYS: FontNameKey[] = [
  'copyright',
  'version',
  'trademark',
  'manufacturer',
  'designer',
  'description',
  'vendorURL',
  'designerURL',
  'license',
  'licenseURL',
]

function bits(flags: unknown, names: readonly (string | null)[]): number {
  if (typeof flags === 'number') return flags
  if (!flags || typeof flags !== 'object') return 0
  return names.reduce(
    (value, name, bit) => (name && (flags as Record<string, unknown>)[name] ? value | (1 << bit) : value),
    0,
  )
}

/** Reads the tables an exported font copies. Any table that cannot be read just falls back to defaults. */
function readFontInfo(font: Font): FontInfo {
  // OS/2, hhea, post, head, and name are part of fontkit's runtime API but not all are typed.
  const tables = font as unknown as Record<string, Record<string, unknown> | undefined>
  const read = <T>(get: () => T, fallback: T): T => {
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
      subscript: [
        num(t.ySubscriptXSize),
        num(t.ySubscriptYSize),
        num(t.ySubscriptXOffset),
        num(t.ySubscriptYOffset),
      ] as [number, number, number, number],
      superscript: [
        num(t.ySuperscriptXSize),
        num(t.ySuperscriptYSize),
        num(t.ySuperscriptXOffset),
        num(t.ySuperscriptYOffset),
      ] as [number, number, number, number],
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
