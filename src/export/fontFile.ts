// Font file export: writes the final polygons as an OpenType (CFF) font with opentype.js, then
// reopens the bytes with fontkit — a separate parser — and checks them before anything is offered
// for download. No React, no DOM.

import type { LoadedFont } from '../font/model'
import { glyphGeometry } from '../geometry/cache'
import { signedArea } from '../geometry/flatten'
import type { GeometryParams, GlyphRef, Point } from '../geometry/types'
import { specimenLines } from '../specimen/scene'
import { ExportError, quantizePolygon } from './quantize'

export type GlyphSet = 'current' | 'specimen' | 'all'

export const MAX_EXPORT_GLYPHS = 5000

/** What the font file does not carry over; shown before export and in the README. */
export const FONT_EXPORT_LIMITS = [
  'Format: OpenType with CFF (PostScript) outlines, .otf. TrueType (.ttf), WOFF, and WOFF2 output are not available.',
  'Outlines are straight-line polygons rounded to whole font units.',
  'Kerning, ligatures, mark positioning, and all other OpenType layout features (GPOS / GSUB) are not exported.',
  'Hinting, color, and vertical-layout tables are not exported.',
  'Variable fonts are exported as the default instance shown on the canvas; variation axes are dropped.',
  'Only glyphs reached through the character map are exported; glyphs used only by layout features are left out.',
  'Characters above U+FFFF (outside the Basic Multilingual Plane) are left out: the font writer cannot map them reliably, which read-back verification confirmed.',
  'Naming is limited to family and style. Check the source font’s license before sharing; many open fonts require a new name for modified versions.',
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

  const opentype = await import('opentype.js')
  signal.throwIfAborted()

  const expected: { unicodes: number[]; advance: number; contours: Point[][] }[] = []
  const glyphs = [notdefGlyph(opentype, font)]
  const usedNames = new Set(['.notdef'])
  const excluded: { label: string; reason: string }[] = []

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
      contours = quantizePolygon(geometry.polygon, 0, `Glyph ${entry.label}`)
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
  let bytes: ArrayBuffer
  try {
    bytes = new opentype.Font({
      familyName: naming.familyName,
      styleName: naming.styleName,
      unitsPerEm,
      ascender: Math.round(ascender),
      descender: Math.round(descender),
      version: 'Version 1.000',
      description: 'Polygon outlines generated with None-Curve.',
      glyphs,
    }).toArrayBuffer()
  } catch (error) {
    throw new ExportError(`The font writer failed: ${error instanceof Error ? error.message : error}`)
  }

  onProgress(plan.glyphs.length, plan.glyphs.length, 'verifying')
  await nextTask()
  signal.throwIfAborted()
  await verifyFont(bytes, naming, expected)

  return {
    bytes,
    glyphCount: glyphs.length,
    characterCount: expected.reduce((n, g) => n + g.unicodes.length, 0),
    contourCount: expected.reduce((n, g) => n + g.contours.length, 0),
    excluded,
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
async function verifyFont(bytes: ArrayBuffer, naming: FontNaming, expected: { unicodes: number[]; advance: number; contours: Point[][] }[]) {
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
