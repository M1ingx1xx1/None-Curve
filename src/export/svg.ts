// SVG serialization of the final polygons. Paths use only M, L, and Z. No React, no DOM.

import type { Point } from '../geometry/types'
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

/**
 * How the specimen is painted. The default is the main view: black outlines, no background. The
 * preview look uses the preview's colours and blur on a solid background.
 */
export interface SvgLook {
  /** Gaussian blur standard deviation in font units; 0 is none. */
  blur: number
  /** Glyph colour and background colour (CSS colours). */
  ink: string
  paper: string
  /** Paint a solid background (a blurred look always has one). */
  background: boolean
}

export const MAIN_LOOK: SvgLook = { blur: 0, ink: '#000', paper: '#fff', background: false }

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
 * Specimen text: one path per glyph, positioned with the same advances and kerning as the canvas.
 * With a blurred look the canvas grows by three standard deviations on every side, so the blur is not
 * cut off.
 */
export function specimenToSvg(scene: SpecimenScene, decimals: number, meta: SvgMeta, look: SvgLook = MAIN_LOOK): SvgDocument {
  if (scene.glyphCount === 0) throw new ExportError('The specimen is empty. Type some text first.')
  const blur = Math.max(0, look.blur)
  const margin = Math.ceil(blur * 3)
  // Rounded outward so rounded coordinates can never fall outside the view box.
  const minX = Math.floor(scene.bounds.minX) - margin
  const minY = Math.floor(scene.bounds.minY) - margin
  const maxX = Math.ceil(scene.bounds.maxX) + margin
  const maxY = Math.ceil(scene.bounds.maxY) + margin
  const width = maxX - minX
  const height = maxY - minY
  const ink = escapeXml(look.ink)
  const paper = escapeXml(look.paper)
  const quantized = new Map<number, Point[][]>()
  const lines = header(width, height, decimals, meta)
  if (scene.missingCharacters.length) {
    lines.push(comment(`Missing from the font, left as blank advances: ${scene.missingCharacters.join(' ')}`))
  }
  if (look.background || blur > 0) lines.push(`  <rect width="${width}" height="${height}" fill="${paper}"/>`)
  if (blur > 0) {
    lines.push(
      `  <filter id="blur" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`,
      `    <feGaussianBlur stdDeviation="${num(blur, 3)}"/>`,
      '  </filter>',
      '  <g filter="url(#blur)">',
    )
  }
  let paths = 0
  let vertices = 0
  for (const line of scene.lines) {
    lines.push('  <g>')
    for (const glyph of line.glyphs) {
      if (!glyph.polygon || glyph.polygon.contours.length === 0) continue
      let contours = quantized.get(glyph.index)
      if (!contours) {
        contours = quantizePolygon(glyph.polygon, decimals, `Glyph “${glyph.text}”`)
        quantized.set(glyph.index, contours)
      }
      const placed = contours.map((c) => c.map((p) => ({ x: glyph.x + p.x - minX, y: glyph.y - p.y - minY })))
      lines.push(`    <path fill="${ink}" fill-rule="nonzero" d="${pathData(placed, decimals)}"/>`)
      paths++
      vertices += placed.reduce((n, c) => n + c.length, 0)
    }
    lines.push('  </g>')
  }
  if (blur > 0) lines.push('  </g>')
  lines.push('</svg>', '')
  return { svg: lines.join('\n'), paths, vertices }
}
