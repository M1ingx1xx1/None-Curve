// An imported SVG as a font of one glyph, the artwork, so it goes through the same pipeline, effects and Sound as a
// letter. The artwork's frame (the viewBox, else its width and height, else its own bounds) is scaled to 1000 units
// high, its bottom on the baseline, with y turned up. The canvas shows the artwork alone (App sets the text to it).
// Everything is filled by the nonzero rule downstream, so each shape's contours are turned to fill the same that way:
// an even-odd shape by how deep each contour is nested, a nonzero one so that its ink winds positively.

import { insideRing, ringBox } from '../geometry/crossings'
import { signedArea } from '../geometry/primitives'
import type { GlyphRef, Point, SourceContour, SourceGlyph, SourceSegment } from '../geometry/types'
import { FontLoadError } from './errors'
import { ARTWORK_CODE_POINT, type FontInfo, type FontMetrics, type FontSource, type LoadedFont } from './model'
import { readSvg, SvgError, type SvgShape } from './svgDocument'

/** Largest SVG file read. */
export const MAX_SVG_BYTES = 10 * 1024 * 1024
/** The artwork's frame height, in font units. */
export const ARTWORK_HEIGHT = 1000

/** Whether these bytes are text that starts with a tag (after a byte order mark and white space), as SVG does. */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++
  return bytes[i] === 0x3c // '<'
}

let svgId = 0

const fail = (message: string) => new FontLoadError('svg', message)

/** The SVG file as a LoadedFont of one glyph. Throws FontLoadError ('svg') with what went wrong. */
export function parseSvgFont(bytes: Uint8Array, source: FontSource): LoadedFont {
  if (bytes.byteLength > MAX_SVG_BYTES) throw fail('The SVG is larger than 10 MB, too large to rebuild.')
  const text = new TextDecoder('utf-8').decode(bytes)
  let doc
  try {
    doc = readSvg(text)
  } catch (error) {
    if (error instanceof SvgError) throw fail(error.message)
    throw error
  }

  if (!doc.shapes.length) {
    if (doc.strokedOnly)
      throw fail(
        'This SVG only has strokes (lines with no fill), and only filled shapes can be rebuilt. Convert the ' +
          'strokes to outlines first (Illustrator: Object → Path → Outline Stroke; Inkscape: Path → Stroke to ' +
          'Path; Figma: Outline stroke) and import it again.',
      )
    if (doc.texts)
      throw fail('This SVG only has text. Convert the text to outlines in your design app and import it again.')
    throw fail('This SVG has no filled shapes (paths, rectangles, circles, ellipses or polygons) to rebuild.')
  }

  const bounds = boundsOf(doc.shapes.flatMap((s) => s.contours))
  const frame = doc.frame ?? (bounds.height > 0 ? bounds : null)
  if (!frame || !(bounds.width > 0 || bounds.height > 0)) throw fail('The shapes in this SVG have no area.')
  const scale = ARTWORK_HEIGHT / frame.height
  if (!Number.isFinite(scale) || scale <= 0) throw fail('The SVG’s size could not be read.')
  const place = (p: Point): Point => ({ x: (p.x - frame.x) * scale, y: (frame.y + frame.height - p.y) * scale })

  const contours = doc.shapes.flatMap((shape) =>
    orient(
      shape.contours.map((c) => mapContour(c, place)),
      shape.rule,
    ),
  )
  const placed = boundsOf(contours)
  const advanceWidth = Math.max(1, Math.round(frame.width * scale))
  const name = source.kind === 'local' ? source.fileName.replace(/\.svg$/i, '') || 'Artwork' : 'Artwork'

  const metrics: FontMetrics = {
    unitsPerEm: ARTWORK_HEIGHT,
    ascender: ARTWORK_HEIGHT,
    descender: 0,
    xHeight: null,
    capHeight: null,
    lineGap: 0,
  }
  const artworkRef: GlyphRef = { index: 1, name: 'artwork', unicode: ARTWORK_CODE_POINT }
  const glyphMetrics = (advance: number, left: number, right: number) => ({
    unitsPerEm: ARTWORK_HEIGHT,
    ascender: ARTWORK_HEIGHT,
    descender: 0,
    advanceWidth: advance,
    leftSideBearing: left,
    rightSideBearing: right,
  })
  const glyphs: SourceGlyph[] = [
    deepFreeze({ ref: { index: 0, name: '.notdef', unicode: null }, contours: [], metrics: glyphMetrics(0, 0, 0) }),
    deepFreeze({
      ref: artworkRef,
      contours,
      metrics: glyphMetrics(advanceWidth, placed.x, advanceWidth - (placed.x + placed.width)),
    }),
  ]
  const preview = previewPath(contours)
  const info: FontInfo = {
    os2: null,
    lineGap: 0,
    italicAngle: 0,
    underlinePosition: -100,
    underlineThickness: 50,
    isFixedPitch: false,
    macStyle: 0,
    names: {},
  }

  return {
    id: `svg-${++svgId}`,
    source,
    format: 'svg',
    bytes,
    faces: null,
    face: null,
    familyName: name,
    styleName: 'SVG',
    metrics,
    info,
    glyphCount: 2,
    characters: [artworkRef],
    listAllGlyphs: () => glyphs.map((g) => g.ref),
    axes: [],
    instance: null,
    hasCharacter: (cp) => cp === ARTWORK_CODE_POINT,
    hasKerning: false,
    kerning: () => null,
    shapeLine: (line) =>
      [...line].map((char) => {
        const cp = char.codePointAt(0)!
        const index = cp === ARTWORK_CODE_POINT ? 1 : 0
        return { index, codePoints: [cp], xAdvance: index ? advanceWidth : 0, xOffset: 0, yOffset: 0, missing: !index }
      }),
    getGlyph(index) {
      const glyph = glyphs[index]
      if (!glyph) throw new Error(`The SVG artwork has no glyph ${index}.`)
      return glyph
    },
    getPreviewPath: (index) => (index === 1 ? preview : ''),
  }
}

function mapContour({ start, segments }: SourceContour, f: (p: Point) => Point): SourceContour {
  return {
    start: f(start),
    segments: segments.map((s): SourceSegment => {
      if (s.type === 'line') return { type: 'line', to: f(s.to) }
      if (s.type === 'quad') return { type: 'quad', control: f(s.control), to: f(s.to) }
      return { type: 'cubic', control1: f(s.control1), control2: f(s.control2), to: f(s.to) }
    }),
  }
}

/** The contour's outline as a polygon, curves sampled finely enough to tell area and nesting. */
function sample({ start, segments }: SourceContour): Point[] {
  const points: Point[] = [start]
  let from = start
  for (const s of segments) {
    if (s.type === 'line') points.push(s.to)
    else
      for (let i = 1; i <= 8; i++) {
        const t = i / 8
        const u = 1 - t
        if (s.type === 'quad')
          points.push({
            x: u * u * from.x + 2 * u * t * s.control.x + t * t * s.to.x,
            y: u * u * from.y + 2 * u * t * s.control.y + t * t * s.to.y,
          })
        else
          points.push({
            x: u * u * u * from.x + 3 * u * u * t * s.control1.x + 3 * u * t * t * s.control2.x + t * t * t * s.to.x,
            y: u * u * u * from.y + 3 * u * u * t * s.control1.y + 3 * u * t * t * s.control2.y + t * t * t * s.to.y,
          })
      }
    from = s.to
  }
  return points
}

/** The same outline drawn the other way round (closed explicitly, so the reversed contour ends where it starts). */
export function reverseContour({ start, segments }: SourceContour): SourceContour {
  const last = segments[segments.length - 1]?.to ?? start
  const all: SourceSegment[] =
    last.x === start.x && last.y === start.y ? segments : [...segments, { type: 'line', to: start }]
  const reversed: SourceSegment[] = []
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i]
    const to = i > 0 ? all[i - 1].to : start
    if (s.type === 'line') reversed.push({ type: 'line', to })
    else if (s.type === 'quad') reversed.push({ type: 'quad', control: s.control, to })
    else reversed.push({ type: 'cubic', control1: s.control2, control2: s.control1, to })
  }
  return { start, segments: reversed }
}

/**
 * Turns one shape's contours (y up) so that the nonzero rule fills what the shape's own rule does: even-odd contours
 * wind positively at an even nesting depth and negatively at an odd one (exact while contours do not cross); a nonzero
 * shape is turned as a whole when its ink winds negatively, so shapes that overlap add up instead of cancelling.
 */
export function orient(contours: SourceContour[], rule: SvgShape['rule']): SourceContour[] {
  const polygons = contours.map(sample)
  const areas = polygons.map(signedArea)
  if (rule === 'nonzero') {
    const total = areas.reduce((a, b) => a + b, 0)
    return total < 0 ? contours.map(reverseContour) : contours
  }
  const boxes = polygons.map(ringBox)
  return contours.map((contour, i) => {
    let depth = 0
    const p = polygons[i][0]
    for (let j = 0; j < contours.length; j++) {
      if (j === i) continue
      const box = boxes[j]
      if (p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY && insideRing(p, polygons[j]))
        depth++
    }
    const wanted = depth % 2 === 0 ? 1 : -1
    return Math.sign(areas[i]) === -wanted ? reverseContour(contour) : contour
  })
}

function boundsOf(contours: SourceContour[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const contour of contours)
    for (const p of sample(contour)) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function previewPath(contours: SourceContour[]): string {
  const n = (v: number) => Math.round(v * 10) / 10
  return contours
    .map(({ start, segments }) => {
      let d = `M${n(start.x)} ${n(start.y)}`
      for (const s of segments) {
        if (s.type === 'line') d += `L${n(s.to.x)} ${n(s.to.y)}`
        else if (s.type === 'quad') d += `Q${n(s.control.x)} ${n(s.control.y)} ${n(s.to.x)} ${n(s.to.y)}`
        else
          d += `C${n(s.control1.x)} ${n(s.control1.y)} ${n(s.control2.x)} ${n(s.control2.y)} ${n(s.to.x)} ${n(s.to.y)}`
      }
      return `${d}Z`
    })
    .join('')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
