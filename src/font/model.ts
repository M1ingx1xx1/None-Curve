// Font and glyph model shared by local files and Google Fonts.
// Nothing here depends on React or on the parsing library.

import type { GlyphRef, SourceGlyph } from '../geometry/types'

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2'

export type FontSource =
  | { kind: 'local'; fileName: string; byteSize: number }
  | {
      kind: 'google'
      family: string
      weight: number
      italic: boolean
      subset: string
      /** Font version segment from the fonts.gstatic.com URL, e.g. "v20". */
      version: string | null
      fileUrl: string
      byteSize: number
    }

export interface VariationAxis {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

export interface FontMetrics {
  unitsPerEm: number
  ascender: number
  descender: number
  xHeight: number | null
  capHeight: number | null
  /** Extra space between lines recommended by the font (hhea lineGap). */
  lineGap: number
}

/** One positioned glyph from shaping a line of text. Units are font units. */
export interface ShapedGlyph {
  index: number
  /**
   * Characters this glyph stands for, taken from the input text (one character per glyph, since
   * ligatures are off). Not taken from fontkit's glyph objects, which are shared between runs.
   */
  codePoints: number[]
  /** Advance including kerning. */
  xAdvance: number
  xOffset: number
  yOffset: number
  /** True when the font has no glyph for the character (index 0 / .notdef). */
  missing: boolean
}


/** Name table entries copied into an exported font (name IDs 0, 5, 7–14). */
export type FontNameKey =
  | 'copyright'
  | 'version'
  | 'trademark'
  | 'manufacturer'
  | 'designer'
  | 'description'
  | 'vendorURL'
  | 'designerURL'
  | 'license'
  | 'licenseURL'

/**
 * Font-wide data that is not about outlines, read once so an exported font can carry it over:
 * weight, width, style bits, slant, vertical metrics, and the legal and credit names.
 */
export interface FontInfo {
  /** OS/2 values, or null when the font has no OS/2 table. Bit fields are plain numbers. */
  os2: {
    weightClass: number
    widthClass: number
    fsType: number
    fsSelection: number
    familyClass: number
    panose: number[]
    subscript: [number, number, number, number]
    superscript: [number, number, number, number]
    strikeoutSize: number
    strikeoutPosition: number
    typoAscender: number | null
    typoDescender: number | null
    typoLineGap: number | null
    winAscent: number | null
    winDescent: number | null
    xHeight: number | null
    capHeight: number | null
  } | null
  /** hhea line gap. */
  lineGap: number
  /** post table. */
  italicAngle: number
  underlinePosition: number
  underlineThickness: number
  isFixedPitch: boolean
  /** head.macStyle bits (1 bold, 2 italic, …). */
  macStyle: number
  names: Partial<Record<FontNameKey, string>>
}

export interface LoadedFont {
  /** Unique per load, so a re-import of the same file is a new font. */
  id: string
  source: FontSource
  format: FontFormat
  /** The font file, so the geometry worker can open its own copy. */
  bytes: Uint8Array
  familyName: string
  styleName: string
  metrics: FontMetrics
  /** Weight, style, vertical metrics, and names, for font export. */
  info: FontInfo
  glyphCount: number
  /** One entry per visible Unicode code point in the cmap (controls excluded), sorted by code point. */
  characters: GlyphRef[]
  /** Every glyph in the font by glyph index, including unmapped ones. Built on first call. */
  listAllGlyphs(): GlyphRef[]
  axes: VariationAxis[]
  /** Axis values the outlines use when they were applied on load (a variable file at a chosen weight), else null. */
  instance: Record<string, number> | null
  /** True when the font's character map has a glyph for this code point. */
  hasCharacter(codePoint: number): boolean
  /** True when the font has kerning (GPOS kern feature or a legacy kern table). */
  hasKerning: boolean
  /**
   * Shapes one line of text with kerning and mark positioning but without ligatures, so every
   * character keeps its own glyph.
   */
  shapeLine(text: string): ShapedGlyph[]
  /** Reads the outline of a glyph. Throws if the glyph data cannot be decoded. */
  getGlyph(index: number): SourceGlyph
  /** SVG path data (font units, y-up) for small glyph previews. */
  getPreviewPath(index: number): string
}

export function glyphLabel(glyph: GlyphRef): string {
  if (glyph.unicode !== null) return String.fromCodePoint(glyph.unicode)
  return glyph.name || `#${glyph.index}`
}

export function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

/** Prefers a familiar letter with an outline, then any mapped glyph with an outline. */
export function pickDefaultGlyph(font: LoadedFont): GlyphRef | null {
  const preferred = ['A', 'a', 'H', 'n', '0'].map((c) => c.codePointAt(0))
  for (const cp of preferred) {
    const ref = font.characters.find((c) => c.unicode === cp)
    if (ref && font.getPreviewPath(ref.index)) return ref
  }
  const withOutline = font.characters.find((c) => font.getPreviewPath(c.index))
  if (withOutline) return withOutline
  return font.characters[0] ?? font.listAllGlyphs()[0] ?? null
}
