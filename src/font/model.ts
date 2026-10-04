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
}


export interface LoadedFont {
  /** Unique per load, so a re-import of the same file is a new font. */
  id: string
  source: FontSource
  format: FontFormat
  familyName: string
  styleName: string
  metrics: FontMetrics
  glyphCount: number
  /** One entry per visible Unicode code point in the cmap (controls excluded), sorted by code point. */
  characters: GlyphRef[]
  /** Every glyph in the font by glyph index, including unmapped ones. Built on first call. */
  listAllGlyphs(): GlyphRef[]
  axes: VariationAxis[]
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
