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
}

/** Removes characters that are not allowed in XML 1.0, then escapes markup characters. */
export function escapeXml(text: string): string {
  return text
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
}

/** The artboard's glyph outlines, exactly as specimenToSvg writes them; the preview draws the same. */
export interface SpecimenPaths {
  /** The glyph group's transform, from font units (scene coordinates) to artboard pixels. */
  transform: string
  paths: SvgGlyphPath[]
  vertices: number
}

/**
 * Path data by polygon, so a caller that builds often (the preview, at every change) rounds only the
 * glyphs whose shape changed. Entries for polygons no longer in use are dropped with them.
 */
export type SvgPathCache = WeakMap<PolygonGlyph, { decimals: number; d: string; vertices: number }>

/**
 * Every glyph of the scene as one path in its own font units (y up, quantized and validated), placed
 * by a transform with its position and slant; the group transform scales font units to artboard pixels,
 * so coordinates keep full precision in font units. Glyphs without outlines (spaces, missing characters,
 * glyphs not computed yet) are left out. Throws ExportError when a glyph cannot be rounded.
 */
export function specimenPaths(scene: SpecimenScene, layout: ArtboardLayout, decimals: number, cache?: SvgPathCache): SpecimenPaths {
  const scale = Number((1 / layout.unitsPerPx).toPrecision(8))
  const skew = scene.slant ? ` skewX(${num(-scene.slant, 4)})` : ''
  // By polygon, not glyph id: a letter that reacts to Sound by its own amount has a shape of its own.
  const shapes = new Map<PolygonGlyph, { d: string; vertices: number }>()
  const paths: SvgGlyphPath[] = []
  let vertices = 0
  for (const line of scene.lines) {
    for (const glyph of line.glyphs) {
      const { polygon } = glyph
      if (!polygon || polygon.contours.length === 0) continue
      let shape = shapes.get(polygon)
      if (!shape) {
        const cached = cache?.get(polygon)
        if (cached && cached.decimals === decimals) shape = cached
        else {
          const contours = quantizePolygon(polygon, decimals, `Glyph “${glyph.text}”`, 'Use a higher precision.')
          const entry = { decimals, d: pathData(contours, decimals), vertices: contours.reduce((n, c) => n + c.length, 0) }
          cache?.set(polygon, entry)
          shape = entry
        }
        shapes.set(polygon, shape)
      }
      paths.push({ transform: `translate(${num(glyph.x, decimals)} ${num(glyph.y, decimals)})${skew} scale(1 -1)`, d: shape.d })
      vertices += shape.vertices
    }
  }
  const transform = `scale(${scale}) translate(${num(-layout.x, decimals)} ${num(-layout.y, decimals)})`
  return { transform, paths, vertices }
}

/**
 * The artboard: width × height pixels with the text placed exactly as on the canvas, its outlines from
 * specimenPaths.
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
  lines.push(`  <g fill="${ink}" fill-rule="nonzero" transform="${outlines.transform}">`)
  for (const path of outlines.paths) lines.push(`    <path transform="${path.transform}" d="${path.d}"/>`)
  lines.push('  </g>', '  </g>', '</svg>', '')
  return { svg: lines.join('\n'), paths: outlines.paths.length, vertices: outlines.vertices }
}
