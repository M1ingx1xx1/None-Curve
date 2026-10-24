// What a font export will hold, decided before anything is built: the glyph set, its limits, and the
// file's names. Light enough for the page's export dialog; the build itself is in fontFile.ts, loaded
// only when a font is exported.

import type { LoadedFont } from '../font/model'
import type { GlyphRef, PolygonGlyph } from '../geometry/types'
import { specimenLines } from '../specimen/scene'

export type GlyphSet = 'current' | 'specimen' | 'all'

/** What a font file can store of a glyph (see fitGlyph.ts). */
export const FONT_BOX_LIMITS = {
  /** Every coordinate in the file lies within ±this. */
  maxCoordinate: 32767,
  /** The most a glyph spans along either axis: one unit under the longest step, so whole-unit edges keep every step storable. */
  span: 32766,
} as const

const MAX_EXPORT_GLYPHS = 5000
/** Most outline points in one font file. Dense settings (Anchor spacing 1: thousands of points per
    glyph) would otherwise make files of tens of megabytes and exhaust the page's memory. */
export const MAX_EXPORT_POINTS = 1_000_000

/** What the font file does not carry over; shown before export and in the README. */
export const FONT_EXPORT_LIMITS = [
  'Format: OpenType with CFF (PostScript) outlines, .otf. TrueType (.ttf), WOFF, and WOFF2 output are not available.',
  'Outlines are straight-line polygons rounded to whole font units; points that land on a straight line or on each other are merged, and crossings that rounding creates are repaired.',
  'Pair kerning between the exported glyphs is exported (GPOS kern feature). Contextual and language-specific kerning, ligatures, mark positioning, and all other OpenType layout features are not.',
  'Hinting, color, and vertical-layout tables are not exported.',
  'A file holds at most 1,000,000 outline points; very dense settings (Anchor spacing near 1) reach that with a whole font.',
  'Each glyph must fit in a square 32,766 font units across (16 em at 2048 units per em, 32.8 em at 1000), placed around the glyph; outline parts beyond it, such as long Thorn tips, are cut off at its edge.',
  'Variable fonts are exported as the default instance shown on the canvas; variation axes are dropped.',
  'Only glyphs reached through the character map are exported; glyphs used only by layout features are left out.',
  'Characters above U+FFFF (outside the Basic Multilingual Plane) are left out: the font writer cannot map them reliably, which read-back verification confirmed.',
  'Line spacing is the canvas’s: the source’s hhea ascender, descender, and line gap, also written as the typographic metrics with USE_TYPO_METRICS set. The Windows ascent and descent grow to cover outlines that reach past them, so applications that ignore that setting may space lines further apart.',
  'Family and style names are set here. Weight, width, style bits, slant, panose, and the copyright, trademark, manufacturer, designer, and license entries are copied from the source font, with a note that None-Curve modified it. Check the source font’s license before sharing; many open fonts require a new name for modified versions.',
]

export interface PlannedGlyph {
  index: number
  unicodes: number[]
  label: string
}

export interface FontExportPlan {
  glyphs: PlannedGlyph[]
  /** Characters that were requested but are not in the font. */
  missing: string[]
  /** Characters in the font that the writer cannot map (above U+FFFF). */
  unsupported: string[]
  problems: string[]
}

export function codePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

function groupByGlyph(refs: GlyphRef[]): PlannedGlyph[] {
  const byIndex = new Map<number, PlannedGlyph>()
  for (const ref of refs) {
    let entry = byIndex.get(ref.index)
    if (!entry) {
      const char = ref.unicode !== null ? String.fromCodePoint(ref.unicode) : ''
      entry = { index: ref.index, unicodes: [], label: char.trim() ? `“${char}”` : ref.name || `glyph #${ref.index}` }
      byIndex.set(ref.index, entry)
    }
    if (ref.unicode !== null && !entry.unicodes.includes(ref.unicode)) entry.unicodes.push(ref.unicode)
  }
  return [...byIndex.values()]
}

/** Decides which glyphs go into the file. Cheap; runs on every render of the export dialog. */
export function planFontExport(
  font: LoadedFont,
  set: GlyphSet,
  selected: GlyphRef | null,
  specimenText: string,
): FontExportPlan {
  const problems: string[] = []
  const missing: string[] = []
  let refs: GlyphRef[] = []

  if (set === 'current') {
    if (!selected) problems.push('No glyph is selected.')
    else {
      const mapped = font.characters.filter((c) => c.index === selected.index)
      refs = mapped.length ? mapped : [selected]
      if (!mapped.length)
        problems.push('The selected glyph has no character mapping, so it could not be typed. Choose a mapped glyph.')
    }
  } else if (set === 'specimen') {
    const seen = new Set<number>()
    for (const line of specimenLines(specimenText)) {
      for (const char of line) {
        const cp = char.codePointAt(0)!
        if (seen.has(cp)) continue
        seen.add(cp)
        const ref = font.characters.find((c) => c.unicode === cp)
        if (ref) refs.push(ref)
        else missing.push(char.trim() ? char : codePointLabel(cp))
      }
    }
    if (!refs.length) problems.push('The specimen contains no characters that this font maps.')
  } else {
    refs = font.characters
    if (!refs.length) problems.push('This font maps no characters.')
  }

  const unsupported: string[] = []
  refs = refs.filter((ref) => {
    if (ref.unicode === null || ref.unicode <= 0xffff) return true
    unsupported.push(codePointLabel(ref.unicode))
    return false
  })
  if (!refs.length && !problems.length)
    problems.push('All requested characters are above U+FFFF, which the font writer cannot map.')

  const glyphs = groupByGlyph(refs).filter((g) => g.index !== 0)
  if (glyphs.length > MAX_EXPORT_GLYPHS) {
    problems.push(
      `This set has ${glyphs.length} glyphs; the limit is ${MAX_EXPORT_GLYPHS}. Use the specimen set instead.`,
    )
  }
  return { glyphs, missing, unsupported, problems }
}

export interface FontNaming {
  familyName: string
  styleName: string
}

/** PostScript name: Family-Style, printable ASCII without spaces or []{}()<>/%, at most 63 characters. */
export function postScriptName(naming: FontNaming): string {
  const clean = (s: string) => s.replace(/[^\x21-\x7E]|[[\](){}<>/%]/g, '')
  const family = clean(naming.familyName) || 'NoneCurve'
  const style = clean(naming.styleName)
  return (style ? `${family}-${style}` : family).slice(0, 63)
}

/**
 * Names the source font's license reserves (SIL Open Font License "Reserved Font Name"), which a
 * modified version may not use.
 */
export function reservedFontNames(font: LoadedFont): string[] {
  const text = [font.info.names.copyright, font.info.names.license].filter(Boolean).join('\n')
  const found = new Set<string>()
  for (const match of text.matchAll(/Reserved\s+Font\s+Names?\s*([^\n]*)/gi)) {
    for (const quoted of match[1].matchAll(/["“”']([^"“”']+)["“”']/g)) found.add(quoted[1].trim())
  }
  return [...found].filter(Boolean)
}

export function validateNaming(naming: FontNaming): string | null {
  const ok = (s: string) => /^[\x20-\x7E]{1,63}$/.test(s) && s.trim() === s
  if (!ok(naming.familyName))
    return 'Family name must be 1–63 printable ASCII characters without leading or trailing spaces.'
  if (!ok(naming.styleName))
    return 'Style name must be 1–63 printable ASCII characters without leading or trailing spaces.'
  return null
}

export interface FontExportResult {
  bytes: ArrayBuffer
  /** Glyphs written, including .notdef. */
  glyphCount: number
  characterCount: number
  contourCount: number
  /** True when the file carries kerning. */
  kerning: boolean
  /** Glyphs left out because their outline could not be stored safely, with the reason. */
  excluded: { label: string; reason: string }[]
  /** Glyphs written cut off at the edge of the square a font stores a glyph in (see fitGlyph.ts), by label. */
  trimmed: string[]
}

export type FontExportStage = 'outlines' | 'writing' | 'verifying'

/** A glyph's outline already computed for these settings (the canvas's), or why it failed there. */
export type KnownGlyph = { polygon: PolygonGlyph } | { error: string }
