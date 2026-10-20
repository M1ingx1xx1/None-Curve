// Hand-built scenes and recorders for the renderer tests (tests/render): a SpecimenScene from a few placed glyphs, a
// 2D context and path that record every call, and the source lookup the canvas renderers read the font's outlines by.

import type { LoadedFont } from '../../src/font/model'
import type { PolygonGlyph, SourceGlyph } from '../../src/geometry/types'
import type { Context2D, RenderPath } from '../../src/render/canvas2d'
import type { RenderStyle, SourceLookup } from '../../src/render/types'
import type { PlacedGlyph, SpecimenScene } from '../../src/specimen/scene'

export type GlyphSpec = Partial<PlacedGlyph> & { index: number }

/** A scene of one line per array, glyphs as given (x, y and advance default to a 600-unit grid on baseline 0). */
export function sceneOf(lines: GlyphSpec[][], slant = 0, metrics = { ascender: 900, descender: -250 }): SpecimenScene {
  return {
    lines: lines.map((glyphs, l) => ({
      glyphs: glyphs.map((g, i) => ({
        text: 'a',
        x: i * 600,
        y: l * 1200,
        advance: 600,
        missing: false,
        polygon: null,
        error: null,
        ink: null,
        ...g,
      })),
      width: glyphs.length * 600,
      baseline: l * 1200,
      ink: null,
    })),
    lineHeight: 1200,
    ascender: metrics.ascender,
    descender: metrics.descender,
    capHeight: 700,
    ink: null,
    body: null,
    blockWidth: Math.max(...lines.map((g) => g.length * 600)),
    textTop: -metrics.ascender,
    textBottom: (lines.length - 1) * 1200 - metrics.descender,
    slant,
    missingCharacters: lines.flat().filter((g) => g.missing).map((g) => g.text ?? ''),
    failedGlyphs: 0,
    pendingGlyphs: 0,
    glyphCount: lines.flat().length,
    truncated: false,
    kerning: false,
  }
}

/** A square polygon (counter-clockwise) from (x0, y0) to (x1, y1) in font units, y up. */
export function square(x0: number, y0: number, x1: number, y1: number): PolygonGlyph {
  return {
    ref: { index: 1, name: 'sq', unicode: null },
    metrics: { unitsPerEm: 1000, advanceWidth: 600, leftSideBearing: 0, rightSideBearing: 0, ascender: 900, descender: -250 },
    contours: [
      {
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
        clockwise: false,
      },
    ],
  }
}

/** The source outline of a square (lines only), so a lookup always finds a drawable glyph. */
export function squareSource(index = 1): SourceGlyph {
  return {
    ref: { index, name: 'sq', unicode: null },
    metrics: { unitsPerEm: 1000, advanceWidth: 600, leftSideBearing: 0, rightSideBearing: 0, ascender: 900, descender: -250 },
    contours: [
      {
        start: { x: 100, y: 0 },
        segments: [
          { type: 'line', to: { x: 500, y: 0 } },
          { type: 'quad', control: { x: 600, y: 350 }, to: { x: 500, y: 700 } },
          { type: 'line', to: { x: 100, y: 700 } },
        ],
      },
    ],
  }
}

/** Reads the font's outlines as SpecimenView does (a glyph that throws has none). */
export function fontSource(font: LoadedFont): SourceLookup {
  const cache = new Map<number, SourceGlyph | null>()
  return (index) => {
    if (!cache.has(index)) {
      try {
        cache.set(index, font.getGlyph(index))
      } catch {
        cache.set(index, null)
      }
    }
    return cache.get(index) ?? null
  }
}

/** A path that records its commands. */
export class RecordingPath implements RenderPath {
  commands: [string, ...number[]][] = []
  moveTo(x: number, y: number) {
    this.commands.push(['M', x, y])
  }
  lineTo(x: number, y: number) {
    this.commands.push(['L', x, y])
  }
  closePath() {
    this.commands.push(['Z'])
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.commands.push(['Q', cx, cy, x, y])
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.commands.push(['C', c1x, c1y, c2x, c2y, x, y])
  }
  arc(x: number, y: number, r: number, start: number, end: number) {
    this.commands.push(['A', x, y, r, start, end])
  }
  rect(x: number, y: number, w: number, h: number) {
    this.commands.push(['R', x, y, w, h])
  }
}

export type Call = [string, ...unknown[]]

/** A 2D context that records every call and property set, in order. */
export class RecordingContext implements Context2D<RecordingPath> {
  calls: Call[] = []
  private state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineJoin: 'miter', miterLimit: 10, globalAlpha: 1 }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.calls.push(['setTransform', a, b, c, d, e, f])
  }
  clearRect(x: number, y: number, w: number, h: number) {
    this.calls.push(['clearRect', x, y, w, h])
  }
  fill(path: RecordingPath, rule: 'nonzero') {
    this.calls.push(['fill', path, rule, { ...this.state }])
  }
  stroke(path: RecordingPath) {
    this.calls.push(['stroke', path, { ...this.state }])
  }
  setLineDash(segments: number[]) {
    this.state.dash = segments
    this.calls.push(['setLineDash', segments])
  }
  private set(key: string, value: unknown) {
    this.state[key] = value
    this.calls.push([key, value])
  }
  get fillStyle() {
    return this.state.fillStyle
  }
  set fillStyle(v: unknown) {
    this.set('fillStyle', v)
  }
  get strokeStyle() {
    return this.state.strokeStyle
  }
  set strokeStyle(v: unknown) {
    this.set('strokeStyle', v)
  }
  get lineWidth() {
    return this.state.lineWidth as number
  }
  set lineWidth(v: number) {
    this.set('lineWidth', v)
  }
  get lineJoin() {
    return this.state.lineJoin as string
  }
  set lineJoin(v: string) {
    this.set('lineJoin', v)
  }
  get miterLimit() {
    return this.state.miterLimit as number
  }
  set miterLimit(v: number) {
    this.set('miterLimit', v)
  }
  get globalAlpha() {
    return this.state.globalAlpha as number
  }
  set globalAlpha(v: number) {
    this.set('globalAlpha', v)
  }

  /** The transform last set before call `i`. */
  transformBefore(i: number): number[] {
    for (let k = i - 1; k >= 0; k--) if (this.calls[k][0] === 'setTransform') return this.calls[k].slice(1) as number[]
    return [1, 0, 0, 1, 0, 0]
  }
}

/** The canvas's style with every colour told apart. */
export function testStyle(patch: Partial<RenderStyle> = {}): RenderStyle {
  return {
    colors: { ink: 'ink', highlight: 'highlight', accent: 'accent', control: 'control', vertex: 'vertex', danger: 'danger', canvas: 'canvas' },
    outline: 'flattened',
    fill: true,
    showSkeleton: false,
    showVertices: false,
    showMarkers: false,
    markerRadius: 7,
    scalingStroke: null,
    unitsPerEm: 1000,
    ascender: 900,
    descender: -250,
    ...patch,
  }
}
