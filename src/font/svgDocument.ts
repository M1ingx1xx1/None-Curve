// Reads an SVG file's filled shapes as source contours in the root's user space (y down), for svgFont.ts. A small XML
// reader of its own, since the geometry worker has no DOMParser. What fills is read as a browser does: presentation
// attributes, then <style> rules (simple selectors only), then style attributes; fill and fill-rule inherit.
// Colours do not matter: every filled shape is ink. Strokes, text, images, clip paths and masks are not outlines.

import type { SourceContour } from '../geometry/types'
import {
  IDENTITY,
  ellipseContour,
  multiply,
  parsePathData,
  parseTransform,
  pointsContour,
  rectContour,
  transformContours,
  type Matrix,
} from './svgPath'

export type SvgFillRule = 'nonzero' | 'evenodd'

/** One filled element: its contours in the root's user space, and how it fills. */
export interface SvgShape {
  contours: SourceContour[]
  rule: SvgFillRule
}

export interface SvgDocument {
  /** The root's viewBox (or its width and height from 0, 0), the frame the artwork is placed by; null without one. */
  frame: { x: number; y: number; width: number; height: number } | null
  shapes: SvgShape[]
  /** Shapes that were left out because they are only stroked (no fill). */
  strokedOnly: number
  /** Text elements, which are not outlines until converted. */
  texts: number
}

export class SvgError extends Error {}

/** Elements read; a file with more is too large to rebuild. */
export const MAX_SVG_ELEMENTS = 100_000
/** Most curve and line segments in the artwork; more would make one glyph too slow to rebuild and animate. */
export const MAX_SVG_SEGMENTS = 30_000
/** Elements drawn, counting each one a <use> repeats; nested <use> can repeat a small file's elements without end. */
const MAX_SVG_DRAWN = 1_000_000

interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  /** Text and CDATA inside it (only <style> reads it). */
  text: string
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name] ?? whole
  })
}

const malformed = (detail: string) => new SvgError(`The SVG is not well-formed XML (${detail}).`)

/** The document's root element. Throws SvgError when the XML is broken. */
export function parseXml(source: string): XmlElement {
  const top: XmlElement = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlElement[] = [top]
  let count = 0
  let i = 0
  const attr = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y
  const close = /\s*(\/?)>/y
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    const parent = stack[stack.length - 1]
    if (lt < 0) {
      parent.text += source.slice(i)
      break
    }
    if (lt > i) parent.text += decodeEntities(source.slice(i, lt))
    const skipTo = (end: string, what: string) => {
      const at = source.indexOf(end, lt)
      if (at < 0) throw malformed(`an unclosed ${what}`)
      return at + end.length
    }
    if (source.startsWith('<!--', lt)) i = skipTo('-->', 'comment')
    else if (source.startsWith('<![CDATA[', lt)) {
      const end = skipTo(']]>', 'CDATA section')
      parent.text += source.slice(lt + 9, end - 3)
      i = end
    } else if (source.startsWith('<?', lt)) i = skipTo('?>', 'processing instruction')
    else if (source.startsWith('<!', lt)) {
      // A DOCTYPE, with its internal subset in brackets.
      let depth = 0
      let j = lt + 2
      for (; j < source.length; j++) {
        if (source[j] === '[') depth++
        else if (source[j] === ']') depth--
        else if (source[j] === '>' && depth <= 0) break
      }
      if (j >= source.length) throw malformed('an unclosed DOCTYPE')
      i = j + 1
    } else if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt)
      if (end < 0) throw malformed('an unclosed end tag')
      const name = source.slice(lt + 2, end).trim()
      if (stack.length < 2 || parent.name !== name) throw malformed(`</${name}> does not close the open element`)
      stack.pop()
      i = end + 1
    } else {
      const nameMatch = /^[^\s/>]+/.exec(source.slice(lt + 1, lt + 257))
      if (!nameMatch) throw malformed('a tag without a name')
      if (++count > MAX_SVG_ELEMENTS)
        throw new SvgError(
          `The SVG has more than ${MAX_SVG_ELEMENTS.toLocaleString('en-US')} elements, too many to rebuild.`,
        )
      const element: XmlElement = { name: nameMatch[0], attrs: {}, children: [], text: '' }
      let j = lt + 1 + nameMatch[0].length
      for (;;) {
        attr.lastIndex = j
        const a = attr.exec(source)
        if (!a) break
        element.attrs[a[1]] = decodeEntities(a[2] ?? a[3])
        j = attr.lastIndex
      }
      close.lastIndex = j
      const end = close.exec(source)
      if (!end) throw malformed(`a broken <${element.name}> tag`)
      parent.children.push(element)
      if (!end[1]) stack.push(element)
      i = close.lastIndex
    }
  }
  if (stack.length > 1) throw malformed(`<${stack[stack.length - 1].name}> is never closed`)
  const root = top.children[0]
  if (!root || top.children.length > 1) throw malformed('it needs exactly one root element')
  return root
}

/** The properties that decide whether and how a shape fills. */
interface Paint {
  fill: string
  fillRule: SvgFillRule
  fillOpacity: string
  stroke: string
  visibility: string
}

const PAINT_KEYS = ['fill', 'fill-rule', 'fill-opacity', 'stroke', 'visibility', 'display', 'opacity'] as const
type Declarations = Partial<Record<(typeof PAINT_KEYS)[number], string>>

function readDeclarations(text: string, into: Declarations): void {
  for (const part of text.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const key = part.slice(0, colon).trim().toLowerCase() as keyof Declarations
    const value = part
      .slice(colon + 1)
      .replace(/!important/i, '')
      .trim()
    if ((PAINT_KEYS as readonly string[]).includes(key) && value) into[key] = value
  }
}

interface Rule {
  tag: string | null
  id: string | null
  classes: string[]
  specificity: number
  order: number
  declarations: Declarations
}

/** Style rules read; every drawn element is matched against each one. */
const MAX_STYLE_RULES = 1_000

/** The top-level `selectors { declarations }` blocks of a style sheet, read in one pass; comments and @-rules are dropped. */
function cssBlocks(text: string): [selectors: string, body: string][] {
  let css = ''
  for (let i = 0; i < text.length;) {
    const open = text.indexOf('/*', i)
    if (open < 0) {
      css += text.slice(i)
      break
    }
    css += text.slice(i, open)
    const close = text.indexOf('*/', open + 2)
    if (close < 0) break
    i = close + 2
  }
  const blocks: [string, string][] = []
  for (let i = 0; i < css.length;) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let close = open + 1
    for (; close < css.length && depth; close++) depth += css[close] === '{' ? 1 : css[close] === '}' ? -1 : 0
    if (depth) break
    // A ";" before the block ends a statement @-rule such as @import.
    const selectors = css.slice(i, open).split(';').pop()!.replace(/}/g, '').trim()
    if (!selectors.startsWith('@')) blocks.push([selectors, css.slice(open + 1, close - 1)])
    i = close
  }
  return blocks
}

/** Rules of <style> elements whose selectors are simple (tag, #id, .class, combined, or *); the rest are ignored. */
function readStyleSheets(root: XmlElement): Rule[] {
  const rules: Rule[] = []
  const visit = (element: XmlElement) => {
    if (localName(element.name) === 'style') {
      for (const [selectors, body] of cssBlocks(element.text)) {
        const declarations: Declarations = {}
        readDeclarations(body, declarations)
        if (!Object.keys(declarations).length) continue
        for (const raw of selectors.split(',')) {
          const selector = raw.trim()
          const simple = /^(\*|[a-zA-Z][\w-]*)?((?:[#.][\w-]+)*)$/.exec(selector)
          if (!selector || !simple) continue
          const tag = simple[1] && simple[1] !== '*' ? simple[1] : null
          const parts = simple[2].match(/[#.][\w-]+/g) ?? []
          const ids = parts.filter((p) => p[0] === '#').map((p) => p.slice(1))
          if (ids.length > 1) continue
          const classes = parts.filter((p) => p[0] === '.').map((p) => p.slice(1))
          if (rules.length >= MAX_STYLE_RULES)
            throw new SvgError(
              `The SVG has more than ${MAX_STYLE_RULES.toLocaleString('en-US')} style rules, too many to rebuild.`,
            )
          rules.push({
            tag,
            id: ids[0] ?? null,
            classes,
            specificity: (ids.length ? 10_000 : 0) + classes.length * 100 + (tag ? 1 : 0),
            order: rules.length,
            declarations,
          })
        }
      }
    }
    element.children.forEach(visit)
  }
  visit(root)
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order)
}

/** The element's name without an "svg:" prefix; elements of other namespaces (editor data) get null. */
function localName(name: string): string | null {
  const colon = name.indexOf(':')
  if (colon < 0) return name
  return name.slice(0, colon) === 'svg' ? name.slice(colon + 1) : null
}

/** Containers whose contents are not drawn where they stand. */
const NOT_DRAWN = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'pattern',
  'marker',
  'linearGradient',
  'radialGradient',
  'filter',
  'metadata',
  'title',
  'desc',
  'style',
  'script',
  'foreignObject',
  'image',
])
const TEXT = new Set(['text', 'tspan', 'textPath'])

function length(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

function optionalLength(value: string | undefined): number | null {
  if (value === undefined || value.trim() === 'auto') return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

function viewBoxOf(value: string | undefined): { x: number; y: number; width: number; height: number } | null {
  const n = (value?.trim().split(/[\s,]+/) ?? []).map(Number)
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) return null
  return { x: n[0], y: n[1], width: n[2], height: n[3] }
}

/** Maps a viewBox into a viewport of this size (preserveAspectRatio xMidYMid meet, the default). */
function viewBoxMatrix(box: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  const s = Math.min(width / box.width, height / box.height)
  const dx = (width - box.width * s) / 2 - box.x * s
  const dy = (height - box.height * s) / 2 - box.y * s
  return [s, 0, 0, s, dx, dy] as Matrix
}

/** Reads an SVG file's text. Throws SvgError when it is not an SVG or is broken. */
export function readSvg(source: string): SvgDocument {
  const root = parseXml(source)
  if (localName(root.name) !== 'svg') throw new SvgError('The file is not an SVG: its root element is not <svg>.')

  const rules = readStyleSheets(root)
  const ids = new Map<string, XmlElement>()
  const index = (element: XmlElement) => {
    if (element.attrs.id && !ids.has(element.attrs.id)) ids.set(element.attrs.id, element)
    element.children.forEach(index)
  }
  index(root)

  const viewBox = viewBoxOf(root.attrs.viewBox)
  const width = optionalLength(root.attrs.width)
  const height = optionalLength(root.attrs.height)
  const frame =
    viewBox ??
    (width && height && width > 0 && height > 0 && !/%/.test(root.attrs.width + root.attrs.height)
      ? { x: 0, y: 0, width, height }
      : null)

  const doc: SvgDocument = { frame, shapes: [], strokedOnly: 0, texts: 0 }
  const using = new Set<XmlElement>()
  let drawn = 0
  let segments = 0

  const walk = (element: XmlElement, matrix: Matrix, inherited: Paint, isRoot: boolean) => {
    if (++drawn > MAX_SVG_DRAWN)
      throw new SvgError('The SVG’s <use> references repeat its shapes too many times to rebuild.')
    const name = localName(element.name)
    if (name === null || NOT_DRAWN.has(name)) return
    if (TEXT.has(name)) {
      if (name === 'text') doc.texts++
      return
    }

    const own: Declarations = {}
    for (const key of PAINT_KEYS) if (element.attrs[key] !== undefined) own[key] = element.attrs[key]
    const classes = (element.attrs.class ?? '').split(/\s+/).filter(Boolean)
    for (const rule of rules) {
      if (rule.tag && rule.tag !== name) continue
      if (rule.id && rule.id !== element.attrs.id) continue
      if (!rule.classes.every((c) => classes.includes(c))) continue
      Object.assign(own, rule.declarations)
    }
    if (element.attrs.style) readDeclarations(element.attrs.style, own)
    if (own.display?.trim() === 'none') return
    if (own.opacity !== undefined && parseFloat(own.opacity) === 0) return
    const pick = (key: keyof Declarations, fallback: string) => {
      const value = own[key]?.trim()
      return value && value !== 'inherit' ? value : fallback
    }
    const paint: Paint = {
      fill: pick('fill', inherited.fill),
      fillRule: pick('fill-rule', inherited.fillRule) === 'evenodd' ? 'evenodd' : 'nonzero',
      fillOpacity: pick('fill-opacity', inherited.fillOpacity),
      stroke: pick('stroke', inherited.stroke),
      visibility: pick('visibility', inherited.visibility),
    }

    let m = multiply(matrix, parseTransform(element.attrs.transform))
    const a = element.attrs
    let contours: SourceContour[]
    switch (name) {
      case 'svg': {
        if (!isRoot) {
          const box = viewBoxOf(a.viewBox)
          m = multiply(m, [1, 0, 0, 1, length(a.x), length(a.y)])
          const w = optionalLength(a.width)
          const h = optionalLength(a.height)
          if (box) m = multiply(m, viewBoxMatrix(box, w ?? box.width, h ?? box.height))
        }
        for (const child of element.children) walk(child, m, paint, false)
        return
      }
      case 'g':
      case 'a':
      case 'switch':
        for (const child of element.children) walk(child, m, paint, false)
        return
      case 'use': {
        const href = a.href ?? a['xlink:href'] ?? ''
        const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined
        if (!target || using.has(target) || using.size > 32) return
        using.add(target)
        m = multiply(m, [1, 0, 0, 1, length(a.x), length(a.y)])
        if (localName(target.name) === 'symbol') {
          const box = viewBoxOf(target.attrs.viewBox)
          const w = optionalLength(a.width) ?? optionalLength(target.attrs.width)
          const h = optionalLength(a.height) ?? optionalLength(target.attrs.height)
          if (box) m = multiply(m, viewBoxMatrix(box, w ?? box.width, h ?? box.height))
          for (const child of target.children) walk(child, m, paint, false)
        } else walk(target, m, paint, false)
        using.delete(target)
        return
      }
      case 'path':
        contours = parsePathData(a.d ?? '')
        break
      case 'rect':
        contours = rectContour(
          length(a.x),
          length(a.y),
          length(a.width),
          length(a.height),
          optionalLength(a.rx),
          optionalLength(a.ry),
        )
        break
      case 'circle':
        contours = ellipseContour(length(a.cx), length(a.cy), length(a.r), length(a.r))
        break
      case 'ellipse':
        contours = ellipseContour(length(a.cx), length(a.cy), length(a.rx), length(a.ry))
        break
      case 'polygon':
      case 'polyline':
        contours = pointsContour(a.points ?? '')
        break
      case 'line':
        contours = []
        break
      default:
        return
    }
    if (paint.visibility === 'hidden' || paint.visibility === 'collapse') return
    const filled =
      name !== 'line' &&
      paint.fill !== 'none' &&
      paint.fill !== 'transparent' &&
      !(parseFloat(paint.fillOpacity) === 0) &&
      contours.length > 0
    if (filled) {
      segments += contours.reduce((n, c) => n + c.segments.length, 0)
      if (segments > MAX_SVG_SEGMENTS)
        throw new SvgError(
          `This SVG has more than ${MAX_SVG_SEGMENTS.toLocaleString('en-US')} segments, too many to rebuild. ` +
            'Simplify it in your design app first.',
        )
      doc.shapes.push({ contours: transformContours(contours, m), rule: paint.fillRule })
    } else if (paint.stroke !== 'none') doc.strokedOnly++
  }

  walk(
    root,
    IDENTITY,
    { fill: 'black', fillRule: 'nonzero', fillOpacity: '1', stroke: 'none', visibility: 'visible' },
    true,
  )
  return doc
}
