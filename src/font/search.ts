import type { GlyphRef } from '../geometry/types'

export interface GlyphQuery {
  /** Matches by code point. */
  codePoint: number | null
  /** Matches by glyph index. */
  index: number | null
  /** Case-insensitive substring of the glyph name. */
  text: string
}

/**
 * Accepts a literal character ("A"), a code point ("U+0041", "0x41"), a glyph index ("#36"),
 * or part of a glyph name ("dieresis").
 */
export function parseGlyphQuery(raw: string): GlyphQuery | null {
  const query = raw.trim()
  if (!query) return null
  const hex = /^(?:u\+|0x)([0-9a-f]{1,6})$/i.exec(query)
  if (hex) return { codePoint: parseInt(hex[1], 16), index: null, text: '' }
  const index = /^#(\d+)$/.exec(query)
  if (index) return { codePoint: null, index: Number(index[1]), text: '' }
  const chars = [...query]
  return { codePoint: chars.length === 1 ? query.codePointAt(0)! : null, index: null, text: query.toLowerCase() }
}

/** Exact code point / index matches come first, then name matches. */
export function filterGlyphs(glyphs: GlyphRef[], query: GlyphQuery | null): GlyphRef[] {
  if (!query) return glyphs
  const exact: GlyphRef[] = []
  const byName: GlyphRef[] = []
  for (const g of glyphs) {
    if ((query.codePoint !== null && g.unicode === query.codePoint) || (query.index !== null && g.index === query.index))
      exact.push(g)
    else if (query.text !== '' && g.name.toLowerCase().includes(query.text)) byName.push(g)
  }
  return [...exact, ...byName]
}
