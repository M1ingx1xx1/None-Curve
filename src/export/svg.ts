// SVG serialization of the final polygons. Paths use only M, L, and Z. No React, no DOM.

import type { Point } from '../geometry/types'
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

/**
 * The artboard: width × height pixels with the text placed exactly as on the canvas. Each glyph is one
 * path in its own font units (y up, quantized and validated), positioned by a transform with its
 * place, slant, and the font-unit-to-pixel scale, so coordinates keep full precision in font units.
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
  const scale = Number((1 / layout.unitsPerPx).toPrecision(8))
  const skew = scene.slant ? ` skewX(${num(-scene.slant, 4)})` : ''
  const quantized = new Map<number, Point[][]>()

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
  lines.push(`  <g fill="${ink}" fill-rule="nonzero" transform="scale(${scale}) translate(${num(-layout.x, decimals)} ${num(-layout.y, decimals)})">`)
  let paths = 0
  let vertices = 0
  for (const line of scene.lines) {
    for (const glyph of line.glyphs) {
      if (!glyph.polygon || glyph.polygon.contours.length === 0) continue
      let contours = quantized.get(glyph.index)
      if (!contours) {
        contours = quantizePolygon(glyph.polygon, decimals, `Glyph “${glyph.text}”`, 'Use a higher precision.')
        quantized.set(glyph.index, contours)
      }
      const place = `translate(${num(glyph.x, decimals)} ${num(glyph.y, decimals)})${skew} scale(1 -1)`
      lines.push(`    <path transform="${place}" d="${pathData(contours, decimals)}"/>`)
      paths++
      vertices += contours.reduce((n, c) => n + c.length, 0)
    }
  }
  lines.push('  </g>', '  </g>', '</svg>', '')
  return { svg: lines.join('\n'), paths, vertices }
}
