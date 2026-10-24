// SVG serialization of the final polygons. Paths use only M, L, and Z. No React, no DOM.

import type { Point, PolygonGlyph } from '../geometry/types'
import type { ArtboardLayout } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import { ExportError, quantizePolygon, roundTo } from './quantize'

export interface SvgDocument {
  svg: string
  /** Number of <path> elements (glyph outlines) written. */
  paths: number
  vertices: number
}

export interface SvgMeta {
  fontName: string
  /** Glyph label or specimen text, used in <title>. */
  subject: string
  /** Active pipeline steps, used in <desc>. */
  pipeline: string[]
}

/** How the artboard is painted. */
export interface SvgLook {
  /** Glyph colour and background colour (CSS colours). */
  ink: string
  paper: string
  /** Paint the background; off gives a transparent background. */
  background: boolean
  /** Gaussian blur standard deviation in artboard pixels; 0 is none. */
  blur: number
  /**
   * Outlines only (the canvas's Fill off): every outline stroked in the ink, OUTLINE_STROKE_PX artboard pixels
   * wide, with no fill. Off or left out, the letters are filled as always.
   */
  outlineOnly?: boolean
}

/**
 * Stroke width of outline-only exports, in artboard pixels, so it scales with the PNG multiplier and the
 * video size. The canvas draws Fill-off outlines 1.5 screen pixels wide at any zoom; at zoom 100% the
 * default 1200 × 800 artboard (with its view margin, 1272 px wide) fits a desktop canvas about 950 screen
 * pixels wide, where 1.5 screen pixels is 2 artboard pixels.
 */
export const OUTLINE_STROKE_PX = 2

/**
 * Miter joins keep the corners sharp, as straight segments meet on the canvas; past this ratio (the SVG
 * and CSS default, so the canvas's own limit; about 29°) a spike is bevelled instead of drawn as a long point.
 */
export const OUTLINE_MITER_LIMIT = 4

/**
 * The outline stroke's width in font units, for the glyph group (whose transform scales font units to
 * artboard pixels), rounded to 6 significant digits.
 */
export function outlineStrokeWidth(unitsPerPx: number): number {
  return Number((OUTLINE_STROKE_PX * unitsPerPx).toPrecision(6))
}

/** Removes characters that are not allowed in XML 1.0, then escapes markup characters. */
export function escapeXml(text: string): string {
  return text
    // The control characters XML 1.0 does not allow.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Comments must not contain "--". */
function comment(text: string): string {
  return `<!-- ${escapeXml(text).replace(/--/g, '- -')} -->`
}

function num(value: number, decimals: number): string {
  return String(roundTo(value, decimals))
}

/** Path data for contours already in output coordinates. */
function pathData(contours: Point[][], decimals: number): string {
  return contours.map((c) => `M${c.map((p) => `${num(p.x, decimals)} ${num(p.y, decimals)}`).join('L')}Z`).join('')
}

function header(width: number, height: number, decimals: number, meta: SvgMeta): string[] {
  const w = num(width, decimals)
  const h = num(height, decimals)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `  <title>${escapeXml(`${meta.fontName} — ${meta.subject}`)}</title>`,
    `  <desc>${escapeXml(`None-Curve polygon export. Units: font units. Pipeline: ${meta.pipeline.join(' → ')}.`)}</desc>`,
  ]
}

/** One glyph outline as the export writes it: where it goes on the artboard and its path data (M, L and Z only). */
export interface SvgGlyphPath {
  transform: string
  d: string
  /** Its place in SpecimenPaths.shapes: occurrences with the same path data share one, so the preview draws each once. */
  shape: number
}

/** The artboard's glyph outlines, exactly as specimenToSvg writes them; the preview draws the same. */
export interface SpecimenPaths {
  /** The glyph group's transform, from font units (scene coordinates) to artboard pixels. */
  transform: string
  paths: SvgGlyphPath[]
  /** The distinct path data among `paths`, in order of first use. */
  shapes: string[]
  vertices: number
}

/**
 * Path data by polygon, so a caller that builds often (the preview, at every change) rounds only the
 * glyphs whose shape changed. Entries for polygons no longer in use are dropped with them.
 */
export type SvgPathCache = WeakMap<PolygonGlyph, { decimals: number; checked: boolean; d: string; vertices: number }>

/**
 * Every glyph of the scene as one path in its own font units (y up, quantized and validated), placed
 * by a transform with its position and slant; the group transform scales font units to artboard pixels,
 * so coordinates keep full precision in font units. Glyphs without outlines (spaces, missing characters,
 * glyphs not computed yet) are left out. Throws ExportError when a glyph cannot be rounded.
 *
 * With `checked` false (the preview while Sound moves the letters, whose shapes no export uses) the points are only
 * rounded: no repair and no check, and so no ExportError. The export always checks.
 */
export function specimenPaths(scene: SpecimenScene, layout: ArtboardLayout, decimals: number, cache?: SvgPathCache, checked = true): SpecimenPaths {
  const scale = Number((1 / layout.unitsPerPx).toPrecision(8))
  const skew = scene.slant ? ` skewX(${num(-scene.slant, 4)})` : ''
  // By polygon, not glyph id: a letter that reacts to Sound by its own amount has a shape of its own.
  const shapes = new Map<PolygonGlyph, { d: string; vertices: number }>()
  const paths: SvgGlyphPath[] = []
  const shapeOf = new Map<string, number>()
  let vertices = 0
  for (const line of scene.lines) {
    for (const glyph of line.glyphs) {
      const { polygon } = glyph
      if (!polygon || polygon.contours.length === 0) continue
      let shape = shapes.get(polygon)
      if (!shape) {
        const cached = cache?.get(polygon)
        // An unchecked path serves only another unchecked build; a checked one serves both.
        if (cached && cached.decimals === decimals && (cached.checked || !checked)) shape = cached
        else {
          const contours = checked
            ? quantizePolygon(polygon, decimals, `Glyph “${glyph.text}”`, 'Use a higher precision.')
            : polygon.contours.map((c) => c.points)
          const entry = { decimals, checked, d: pathData(contours, decimals), vertices: contours.reduce((n, c) => n + c.length, 0) }
          cache?.set(polygon, entry)
          shape = entry
        }
        shapes.set(polygon, shape)
      }
      let n = shapeOf.get(shape.d)
      if (n === undefined) shapeOf.set(shape.d, (n = shapeOf.size))
      paths.push({ transform: `translate(${num(glyph.x, decimals)} ${num(glyph.y, decimals)})${skew} scale(1 -1)`, d: shape.d, shape: n })
      vertices += shape.vertices
    }
  }
  const transform = `scale(${scale}) translate(${num(-layout.x, decimals)} ${num(-layout.y, decimals)})`
  return { transform, paths, shapes: [...shapeOf.keys()], vertices }
}

/**
 * The artboard: width × height pixels with the text placed exactly as on the canvas, its outlines from
 * specimenPaths, filled, or stroked with no fill when look.outlineOnly.
 */
export function specimenToSvg(
  scene: SpecimenScene,
  layout: ArtboardLayout,
  size: { width: number; height: number },
  decimals: number,
  meta: SvgMeta,
  look: SvgLook,
): SvgDocument {
  if (scene.glyphCount === 0) throw new ExportError('The specimen is empty. Type some text first.')
  const { width, height } = size
  const ink = escapeXml(look.ink)
  const paper = escapeXml(look.paper)
  const blur = Math.max(0, look.blur)
  const outlines = specimenPaths(scene, layout, decimals)

  const lines = header(width, height, decimals, meta)
  lines.push(comment(`Canvas ${width} × ${height} px; ${num(layout.unitsPerPx, 6)} font units per pixel.`))
  if (scene.missingCharacters.length) {
    lines.push(comment(`Missing from the font, left as blank advances: ${scene.missingCharacters.join(' ')}`))
  }
  if (look.outlineOnly) lines.push(comment(`Outlines only (Fill off): ${OUTLINE_STROKE_PX} px strokes in the text colour, no fill.`))
  if (look.background) lines.push(`  <rect width="${width}" height="${height}" fill="${paper}"/>`)
  if (blur > 0) {
    lines.push(
      `  <filter id="blur" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`,
      `    <feGaussianBlur stdDeviation="${num(blur, 3)}"/>`,
      '  </filter>',
    )
  }
  // The filter sits on an untransformed group, so its blur is measured in canvas pixels.
  lines.push(blur > 0 ? '  <g filter="url(#blur)">' : '  <g>')
  if (look.outlineOnly) {
    lines.push(
      `  <g fill="none" stroke="${ink}" stroke-width="${outlineStrokeWidth(layout.unitsPerPx)}" stroke-linejoin="miter" stroke-miterlimit="${OUTLINE_MITER_LIMIT}" transform="${outlines.transform}">`,
    )
  } else lines.push(`  <g fill="${ink}" fill-rule="nonzero" transform="${outlines.transform}">`)
  for (const path of outlines.paths) lines.push(`    <path transform="${path.transform}" d="${path.d}"/>`)
  lines.push('  </g>', '  </g>', '</svg>', '')
  return { svg: lines.join('\n'), paths: outlines.paths.length, vertices: outlines.vertices }
}
