// SVG serialization of the final polygons. Paths use only M, L, and Z. No React, no DOM.

import type { GlyphMetrics, Point, PolygonGlyph } from '../geometry/types'
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
 * One glyph. The canvas is the advance box from descender to ascender, grown to include any outline
 * that overshoots it; the origin is the glyph origin flipped to SVG's y-down axis.
 */
export function glyphToSvg(polygon: PolygonGlyph, metrics: GlyphMetrics, decimals: number, meta: SvgMeta): SvgDocument {
  const contours = quantizePolygon(polygon, decimals, meta.subject)
  const points = contours.flat()
  let minX = Math.min(0, metrics.advanceWidth)
  let maxX = Math.max(0, metrics.advanceWidth)
  let top = metrics.ascender
  let bottom = metrics.descender
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    top = Math.max(top, p.y)
    bottom = Math.min(bottom, p.y)
  }
  const flipped = contours.map((c) => c.map((p) => ({ x: p.x - minX, y: top - p.y })))

  const lines = header(maxX - minX, top - bottom, decimals, meta)
  lines.push(comment(`Advance width ${metrics.advanceWidth}; baseline at y = ${num(top, decimals)}.`))
  if (contours.length) lines.push(`  <path fill="#000" fill-rule="nonzero" d="${pathData(flipped, decimals)}"/>`)
  else lines.push(comment('This glyph has no outline.'))
  lines.push('</svg>', '')
  return { svg: lines.join('\n'), paths: contours.length ? 1 : 0, vertices: points.length }
}

/** Specimen text: one path per glyph, positioned with the same advances and kerning as the preview. */
export function specimenToSvg(scene: SpecimenScene, decimals: number, meta: SvgMeta): SvgDocument {
  if (scene.glyphCount === 0) throw new ExportError('The specimen is empty. Type some text first.')
  // Rounded outward so rounded coordinates can never fall outside the view box.
  const minX = Math.floor(scene.bounds.minX)
  const minY = Math.floor(scene.bounds.minY)
  const maxX = Math.ceil(scene.bounds.maxX)
  const maxY = Math.ceil(scene.bounds.maxY)
  const quantized = new Map<number, Point[][]>()
  const lines = header(maxX - minX, maxY - minY, decimals, meta)
  if (scene.missingCharacters.length) {
    lines.push(comment(`Missing from the font, left as blank advances: ${scene.missingCharacters.join(' ')}`))
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
      lines.push(`    <path fill="#000" fill-rule="nonzero" d="${pathData(placed, decimals)}"/>`)
      paths++
      vertices += placed.reduce((n, c) => n + c.length, 0)
    }
    lines.push('  </g>')
  }
  lines.push('</svg>', '')
  return { svg: lines.join('\n'), paths, vertices }
}
