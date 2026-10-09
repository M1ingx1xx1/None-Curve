// Font file export: writes the final polygons as an OpenType (CFF) font with opentype.js, then
// reopens the bytes with fontkit — a separate parser — and checks them before anything is offered
// for download. No React, no DOM.

import type { LoadedFont } from '../font/model'
import { glyphGeometry } from '../geometry/cache'
import { signedArea } from '../geometry/flatten'
import type { GeometryParams, GlyphRef, Point } from '../geometry/types'
import { specimenLines } from '../specimen/scene'
import { ExportError, quantizePolygon } from './quantize'
import { patchFont } from './sfnt'

export type GlyphSet = 'current' | 'specimen' | 'all'

export const MAX_EXPORT_GLYPHS = 5000
/** Most outline points in one font file. Dense settings (Anchor spacing 1: thousands of points per
    glyph) would otherwise make files of tens of megabytes and exhaust the page's memory. */
export const MAX_EXPORT_POINTS = 1_000_000

/** What the font file does not carry over; shown before export and in the README. */
export const FONT_EXPORT_LIMITS = [
  'Format: OpenType with CFF (PostScript) outlines, .otf. TrueType (.ttf), WOFF, and WOFF2 output are not available.',
  'Outlines are straight-line polygons rounded to whole font units; points that land on a straight line or on each other are merged, and crossings that rounding creates are repaired.',
  'Kerning, ligatures, mark positioning, and all other OpenType layout features (GPOS / GSUB) are not exported.',
  'Hinting, color, and vertical-layout tables are not exported.',
  'A file holds at most 1,000,000 outline points; very dense settings (Anchor spacing near 1) reach that with a whole font.',
  'Variable fonts are exported as the default instance shown on the canvas; variation axes are dropped.',
  'Only glyphs reached through the character map are exported; glyphs used only by layout features are left out.',
  'Characters above U+FFFF (outside the Basic Multilingual Plane) are left out: the font writer cannot map them reliably, which read-back verification confirmed.',
  'Family and style names are set here. Weight, width, style bits, slant, line spacing, panose, and the copyright, trademark, manufacturer, designer, and license entries are copied from the source font, with a note that None-Curve modified it. Check the source font’s license before sharing; many open fonts require a new name for modified versions.',
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

function codePointLabel(cp: number): string {
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
export function planFontExport(font: LoadedFont, set: GlyphSet, selected: GlyphRef | null, specimenText: string): FontExportPlan {
  const problems: string[] = []
  const missing: string[] = []
  let refs: GlyphRef[] = []

  if (set === 'current') {
    if (!selected) problems.push('No glyph is selected.')
    else {
      const mapped = font.characters.filter((c) => c.index === selected.index)
      refs = mapped.length ? mapped : [selected]
      if (!mapped.length) problems.push('The selected glyph has no character mapping, so it could not be typed. Choose a mapped glyph.')
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
  if (!refs.length && !problems.length) problems.push('All requested characters are above U+FFFF, which the font writer cannot map.')

  const glyphs = groupByGlyph(refs).filter((g) => g.index !== 0)
  if (glyphs.length > MAX_EXPORT_GLYPHS) {
    problems.push(`This set has ${glyphs.length} glyphs; the limit is ${MAX_EXPORT_GLYPHS}. Use the specimen set instead.`)
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
  if (!ok(naming.familyName)) return 'Family name must be 1–63 printable ASCII characters without leading or trailing spaces.'
  if (!ok(naming.styleName)) return 'Style name must be 1–63 printable ASCII characters without leading or trailing spaces.'
  return null
}

export interface FontExportResult {
  bytes: ArrayBuffer
  /** Glyphs written, including .notdef. */
  glyphCount: number
  characterCount: number
  contourCount: number
  /** Glyphs left out because their outline could not be stored safely, with the reason. */
  excluded: { label: string; reason: string }[]
}

const INT16_MIN = -32768
const INT16_MAX = 32767

/**
 * Builds and verifies the font. Runs the same cached pipeline as the canvas for every glyph, yielding
 * between batches so the page stays responsive; `signal` cancels.
 */
export async function buildFontFile(
  font: LoadedFont,
  plan: FontExportPlan,
  params: GeometryParams,
  key: string,
  naming: FontNaming,
  signal: AbortSignal,
  onProgress: (done: number, total: number, stage: 'outlines' | 'writing' | 'verifying') => void,
): Promise<FontExportResult> {
  if (plan.problems.length) throw new ExportError(plan.problems.join(' '))
  const namingError = validateNaming(naming)
  if (namingError) throw new ExportError(namingError)

  const loaded = await import('opentype.js')
  // The browser build has named exports; the CommonJS build (Node, tests) puts them on `default`.
  const opentype = ('Path' in loaded ? loaded : (loaded as unknown as { default: typeof loaded }).default) as typeof loaded
  signal.throwIfAborted()

  const expected: { unicodes: number[]; advance: number; contours: Point[][] }[] = []
  const glyphs = [notdefGlyph(opentype, font)]
  const usedNames = new Set(['.notdef'])
  const excluded: { label: string; reason: string }[] = []
  let points = 0

  for (let i = 0; i < plan.glyphs.length; i++) {
    if (i % 25 === 0) {
      onProgress(i, plan.glyphs.length, 'outlines')
      await nextTask()
      signal.throwIfAborted()
    }
    const entry = plan.glyphs[i]
    let contours: Point[][]
    let advance: number
    try {
      const geometry = glyphGeometry(font, entry.index, params, key)
      contours = cffDirection(quantizePolygon(geometry.polygon, 0, `Glyph ${entry.label}`))
      for (const p of contours.flat()) {
        if (p.x < INT16_MIN || p.x > INT16_MAX || p.y < INT16_MIN || p.y > INT16_MAX) {
          throw new ExportError('coordinates fall outside the range a font can store (±32767)')
        }
      }
      advance = Math.round(geometry.polygon.metrics.advanceWidth)
      if (!Number.isFinite(advance) || advance < 0 || advance > 65535) {
        throw new ExportError(`invalid advance width (${geometry.polygon.metrics.advanceWidth})`)
      }
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(`Glyph ${entry.label}: `, '')
      excluded.push({ label: entry.label, reason })
      continue
    }

    points += contours.reduce((n, c) => n + c.length, 0)
    if (points > MAX_EXPORT_POINTS) {
      throw new ExportError(
        `The font would have more than ${MAX_EXPORT_POINTS.toLocaleString('en-US')} outline points (reached at ${entry.label}, glyph ${i + 1} of ${plan.glyphs.length}). Use a larger Anchor spacing, or export only the characters in the text.`,
      )
    }

    const path = new opentype.Path()
    for (const contour of contours) {
      path.moveTo(contour[0].x, contour[0].y)
      for (const p of contour.slice(1)) path.lineTo(p.x, p.y)
      path.close()
    }
    glyphs.push(new opentype.Glyph({ name: glyphName(font, entry, usedNames), unicodes: entry.unicodes, advanceWidth: advance, path }))
    expected.push({ unicodes: entry.unicodes, advance, contours })
  }

  if (expected.length === 0) {
    throw new ExportError(`None of the glyphs could be stored. ${excluded[0] ? `${excluded[0].label}: ${excluded[0].reason}` : ''}`)
  }

  onProgress(plan.glyphs.length, plan.glyphs.length, 'writing')
  await nextTask()
  signal.throwIfAborted()
  const { unitsPerEm, ascender, descender } = font.metrics
  const { info } = font
  const bounds = outlineBounds(glyphs.map((g) => g.path.commands))
  const style = fontStyle(font)
  const psName = postScriptName(naming)
  let bytes: ArrayBuffer
  try {
    const written = new opentype.Font({
      familyName: naming.familyName,
      styleName: naming.styleName,
      postScriptName: psName,
      unitsPerEm,
      ascender: Math.round(ascender),
      descender: Math.round(descender),
      version: 'Version 1.000',
      description: `Outlines rebuilt as straight-line polygons with None-Curve from ${font.familyName} ${font.styleName}.`,
      copyright: info.names.copyright,
      trademark: info.names.trademark,
      manufacturer: info.names.manufacturer,
      manufacturerURL: info.names.vendorURL,
      designer: info.names.designer,
      designerURL: info.names.designerURL,
      license: info.names.license,
      licenseURL: info.names.licenseURL,
      weightClass: style.weightClass,
      widthClass: style.widthClass,
      fsSelection: style.fsSelection,
      italicAngle: info.italicAngle,
      panose: info.os2?.panose,
      tables: { os2: os2Table(font, bounds), post: postTable(font) },
      glyphs,
    })
    // Leave out name entries the source does not have (the writer would store a single space), and
    // give the font a proper unique ID instead of "<manufacturer>: <full name>".
    for (const names of Object.values(written.names) as Record<string, { en: string }>[]) {
      for (const key of Object.keys(names)) if (names[key]?.en === ' ') delete names[key]
      names.uniqueID = { en: `1.000;None-Curve;${psName}` }
    }
    bytes = patchFont(written.toArrayBuffer(), {
      lineGap: Math.round(info.lineGap),
      macStyle: style.macStyle,
      fontBBox: [bounds.xMin, bounds.yMin, bounds.xMax, bounds.yMax],
    })
  } catch (error) {
    throw new ExportError(`The font writer failed: ${error instanceof Error ? error.message : error}`)
  }

  onProgress(plan.glyphs.length, plan.glyphs.length, 'verifying')
  await nextTask()
  signal.throwIfAborted()
  await verifyFont(bytes, naming, expected, { weightClass: style.weightClass, lineGap: Math.round(info.lineGap), postScriptName: psName })

  return {
    bytes,
    glyphCount: glyphs.length,
    characterCount: expected.reduce((n, g) => n + g.unicodes.length, 0),
    contourCount: expected.reduce((n, g) => n + g.contours.length, 0),
    excluded,
  }
}

/**
 * CFF outlines run counter-clockwise around the ink (TrueType outlines clockwise). If a glyph's
 * largest contour runs clockwise, every contour of the glyph is reversed; holes stay holes.
 */
function cffDirection(contours: Point[][]): Point[][] {
  if (!contours.length) return contours
  const outer = contours.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a))
  if (signedArea(outer) >= 0) return contours
  // Keep each contour's first point, so the outline starts where it did.
  return contours.map((c) => [c[0], ...c.slice(1).reverse()])
}

interface Bounds {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

/** The union of every glyph's points (the font's bounding box). */
function outlineBounds(paths: { args?: number[]; x?: number; y?: number }[][]): Bounds {
  const b = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
  for (const commands of paths) {
    for (const c of commands) {
      if (typeof c.x !== 'number' || typeof c.y !== 'number') continue
      b.xMin = Math.min(b.xMin, c.x)
      b.xMax = Math.max(b.xMax, c.x)
      b.yMin = Math.min(b.yMin, c.y)
      b.yMax = Math.max(b.yMax, c.y)
    }
  }
  return Number.isFinite(b.xMin) ? b : { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
}

const FS_ITALIC = 1
const FS_BOLD = 1 << 5
const FS_REGULAR = 1 << 6
const MAC_BOLD = 1
const MAC_ITALIC = 2

/** Weight, width, and style bits from the source font, consistent with each other. */
function fontStyle(font: LoadedFont) {
  const { os2, italicAngle, macStyle } = font.info
  const weightClass = os2?.weightClass || 400
  const widthClass = os2?.widthClass || 5
  const italic = Boolean((os2?.fsSelection ?? 0) & FS_ITALIC || macStyle & MAC_ITALIC || italicAngle < 0)
  const bold = Boolean((os2?.fsSelection ?? 0) & FS_BOLD || macStyle & MAC_BOLD)
  // Keep the source's other selection bits (oblique, WWS, typo metrics, …) and set the style ones.
  let fsSelection = (os2?.fsSelection ?? 0) & ~(FS_ITALIC | FS_BOLD | FS_REGULAR)
  if (italic) fsSelection |= FS_ITALIC
  if (bold) fsSelection |= FS_BOLD
  if (!italic && !bold) fsSelection |= FS_REGULAR
  return {
    weightClass,
    widthClass,
    fsSelection,
    macStyle: (macStyle & ~(MAC_BOLD | MAC_ITALIC)) | (bold ? MAC_BOLD : 0) | (italic ? MAC_ITALIC : 0),
  }
}

/**
 * OS/2 values copied from the source. The Windows ascent and descent also cover the new outlines,
 * which may reach further than the source's (Windows clips anything outside them).
 */
function os2Table(font: LoadedFont, bounds: Bounds): Record<string, number> {
  const { ascender, descender } = font.metrics
  const os2 = font.info.os2
  const table: Record<string, number> = {
    usWinAscent: Math.max(os2?.winAscent ?? Math.round(ascender), Math.ceil(bounds.yMax), 0),
    usWinDescent: Math.max(os2?.winDescent ?? Math.round(-descender), Math.ceil(-bounds.yMin), 0),
  }
  if (!os2) return table
  return {
    ...table,
    fsType: os2.fsType,
    sFamilyClass: os2.familyClass,
    ySubscriptXSize: os2.subscript[0],
    ySubscriptYSize: os2.subscript[1],
    ySubscriptXOffset: os2.subscript[2],
    ySubscriptYOffset: os2.subscript[3],
    ySuperscriptXSize: os2.superscript[0],
    ySuperscriptYSize: os2.superscript[1],
    ySuperscriptXOffset: os2.superscript[2],
    ySuperscriptYOffset: os2.superscript[3],
    yStrikeoutSize: os2.strikeoutSize,
    yStrikeoutPosition: os2.strikeoutPosition,
    sTypoAscender: os2.typoAscender ?? Math.round(ascender),
    sTypoDescender: os2.typoDescender ?? Math.round(descender),
    sTypoLineGap: os2.typoLineGap ?? Math.round(font.info.lineGap),
    ...(os2.xHeight !== null ? { sxHeight: os2.xHeight } : {}),
    ...(os2.capHeight !== null ? { sCapHeight: os2.capHeight } : {}),
  }
}

/** post values copied from the source: slant, underline, and fixed pitch. */
function postTable(font: LoadedFont) {
  const { italicAngle, underlinePosition, underlineThickness, isFixedPitch } = font.info
  return {
    italicAngle: Math.round(italicAngle * 65536),
    underlinePosition: Math.round(underlinePosition),
    underlineThickness: Math.round(underlineThickness),
    isFixedPitch: isFixedPitch ? 1 : 0,
  }
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A hollow box, the conventional look for a missing-glyph placeholder. */
function notdefGlyph(opentype: typeof import('opentype.js'), font: LoadedFont) {
  const { unitsPerEm, ascender } = font.metrics
  const width = Math.round(unitsPerEm * 0.5)
  const top = Math.round(Math.max(ascender * 0.7, unitsPerEm * 0.5))
  const inset = Math.max(1, Math.round(unitsPerEm * 0.05))
  const path = new opentype.Path()
  const box = (x0: number, y0: number, x1: number, y1: number, clockwise: boolean) => {
    const pts = clockwise
      ? [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]
      : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    path.moveTo(pts[0][0], pts[0][1])
    for (const [x, y] of pts.slice(1)) path.lineTo(x, y)
    path.close()
  }
  box(inset, 0, width - inset, top, false)
  box(inset * 2, inset, width - inset * 2, top - inset, true)
  return new opentype.Glyph({ name: '.notdef', advanceWidth: width, path })
}

function glyphName(font: LoadedFont, entry: PlannedGlyph, used: Set<string>): string {
  const source = font.characters.find((c) => c.index === entry.index)?.name ?? ''
  const candidates = [source]
  const cp = entry.unicodes[0]
  if (cp !== undefined) candidates.push(cp <= 0xffff ? `uni${cp.toString(16).toUpperCase().padStart(4, '0')}` : `u${cp.toString(16).toUpperCase()}`)
  candidates.push(`glyph${entry.index}`)
  for (const name of candidates) {
    if (/^[A-Za-z_.][A-Za-z0-9_.]{0,30}$/.test(name) && name !== '.notdef' && !used.has(name)) {
      used.add(name)
      return name
    }
  }
  let n = 1
  while (used.has(`glyph${entry.index}.${n}`)) n++
  const name = `glyph${entry.index}.${n}`
  used.add(name)
  return name
}

/**
 * Reopens the written bytes with fontkit and compares them with what was meant to be written:
 * OpenType/CFF signature, family name, glyph count, every character mapping, every advance width,
 * and every contour point by point, including direction. Throws if anything differs.
 */
async function verifyFont(
  bytes: ArrayBuffer,
  naming: FontNaming,
  expected: { unicodes: number[]; advance: number; contours: Point[][] }[],
  meta: { weightClass: number; lineGap: number; postScriptName: string },
) {
  const signature = String.fromCharCode(...new Uint8Array(bytes, 0, 4))
  if (signature !== 'OTTO') throw new ExportError(`Verification failed: unexpected file signature “${signature}”.`)

  const fontkit = await import('fontkit')
  let parsed
  try {
    parsed = fontkit.create(new Uint8Array(bytes) as unknown as Buffer)
  } catch (error) {
    throw new ExportError(`Verification failed: the written font could not be reopened (${error instanceof Error ? error.message : error}).`)
  }
  if ('fonts' in parsed) throw new ExportError('Verification failed: the written file is a font collection.')

  const problems: string[] = []
  if (parsed.familyName !== naming.familyName) problems.push(`family name reads back as “${parsed.familyName}”`)
  if (parsed.postscriptName !== meta.postScriptName) problems.push(`PostScript name reads back as “${parsed.postscriptName}”`)
  // OS/2 and hhea are part of fontkit's runtime API but not typed.
  const tables = parsed as unknown as Record<string, { usWeightClass?: number; lineGap?: number } | undefined>
  if (tables['OS/2']?.usWeightClass !== meta.weightClass) problems.push(`weight class reads back as ${tables['OS/2']?.usWeightClass}`)
  if (tables.hhea?.lineGap !== meta.lineGap) problems.push(`line gap reads back as ${tables.hhea?.lineGap}`)
  if (parsed.numGlyphs !== expected.length + 1) problems.push(`glyph count is ${parsed.numGlyphs}, expected ${expected.length + 1}`)

  expected.forEach((glyph, i) => {
    const id = i + 1
    for (const cp of glyph.unicodes) {
      const mapped = parsed.glyphForCodePoint(cp)
      if (mapped.id !== id) problems.push(`${codePointLabel(cp)} maps to glyph ${mapped.id}, expected ${id}`)
    }
    const written = parsed.getGlyph(id)
    if (written.advanceWidth !== glyph.advance) problems.push(`glyph ${id} advance is ${written.advanceWidth}, expected ${glyph.advance}`)
    const contours = readContours(written.path.commands)
    if (!contours) {
      problems.push(`glyph ${id} contains curve commands or an unclosed contour`)
      return
    }
    if (contours.length !== glyph.contours.length) {
      problems.push(`glyph ${id} has ${contours.length} contours, expected ${glyph.contours.length}`)
      return
    }
    contours.forEach((points, c) => {
      const want = glyph.contours[c]
      const same = points.length === want.length && points.every((p, k) => p.x === want[k].x && p.y === want[k].y)
      if (!same) problems.push(`glyph ${id} contour ${c + 1} points differ`)
      else if (Math.sign(signedArea(points)) !== Math.sign(signedArea(want))) problems.push(`glyph ${id} contour ${c + 1} changed direction`)
    })
  })

  if (problems.length) {
    const shown = problems.slice(0, 5).join('; ')
    throw new ExportError(`Verification failed: ${shown}${problems.length > 5 ? `; and ${problems.length - 5} more` : ''}.`)
  }
}

/** Contours from path commands, or null if there is anything besides moveTo / lineTo / closePath. */
function readContours(commands: { command: string; args: number[] }[]): Point[][] | null {
  const contours: Point[][] = []
  let current: Point[] | null = null
  for (const { command, args } of commands) {
    if (command === 'moveTo') {
      current = [{ x: args[0], y: args[1] }]
      contours.push(current)
    } else if (command === 'lineTo' && current) {
      current.push({ x: args[0], y: args[1] })
    } else if (command === 'closePath' && current) {
      const first = current[0]
      const last = current[current.length - 1]
      if (current.length > 1 && first.x === last.x && first.y === last.y) current.pop()
      current = null
    } else {
      return null
    }
  }
  return current === null ? contours : null
}
