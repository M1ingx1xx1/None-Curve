// The artboard drawn into a 2D canvas, for video: the same placement as the SVG export (specimenPaths:
// the group's scale and offset, each glyph's position, slant and flip, fill rule nonzero) and the same
// look (paper, ink, the blur over the glyphs alone, and outlines only when the canvas's Fill is off).
// Straight segments only (moveTo, lineTo, closePath). No DOM: the canvas comes in as a Painter.

import type { PolygonGlyph } from '../geometry/types'
import type { ArtboardLayout } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import { OUTLINE_MITER_LIMIT, outlineStrokeWidth } from './svg'

/** Where a polygon's outline is written: a Path2D in the browser. */
export interface PathSink {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
}

/** The parts of CanvasRenderingContext2D the drawing uses; P is its path type (Path2D). */
export interface Painter<P> {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  save(): void
  restore(): void
  fillRect(x: number, y: number, w: number, h: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  fill(path: P, rule: 'nonzero'): void
  stroke(path: P): void
  drawImage(image: unknown, x: number, y: number): void
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineJoin: string
  miterLimit: number
  filter: string
}

/**
 * The video's colours, the blur in artboard pixels (previewBlur; 0 is none), and outlines only (the canvas's
 * Fill off: stroked as the SVG export strokes them, with no fill; left out, filled).
 */
export interface VideoLook {
  ink: string
  paper: string
  blur: number
  outlineOnly?: boolean
}

/**
 * A canvas `width` × `height` pixels. `layer` is a second canvas of the same size the glyphs are drawn
 * into when they are blurred; `filter` says whether the contexts can blur at all (canvasFilterWorks).
 */
export interface DrawTarget<P> {
  ctx: Painter<P>
  width: number
  height: number
  layer: { ctx: Painter<P>; image: unknown } | null
  filter: boolean
}

/**
 * Paints the paper, then every drawn glyph (each occurrence, missing and pending glyphs left out) in the
 * ink, filled or (outlineOnly) stroked, the artboard stretched over the whole canvas. A blur is drawn as the SVG draws it, over the glyphs
 * as one layer, so overlapping letters blur together. Returns the glyphs drawn, and whether the blur
 * asked for was drawn (false when this canvas cannot blur).
 */
export function drawArtboard<P>(
  target: DrawTarget<P>,
  scene: SpecimenScene,
  layout: ArtboardLayout,
  artboard: { width: number; height: number },
  look: VideoLook,
  pathOf: (polygon: PolygonGlyph) => P,
): { glyphs: number; blurred: boolean } {
  const { ctx, width, height, layer } = target
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  // Only where filters work: elsewhere setting it would add a property that canvasFilterWorks reads back.
  if (target.filter) ctx.filter = 'none'
  // Video has no transparency: the paper is always painted.
  ctx.fillStyle = look.paper
  ctx.fillRect(0, 0, width, height)

  const blurred = look.blur > 0 && target.filter && layer !== null
  const glyphs = blurred ? layer.ctx : ctx
  if (blurred) {
    glyphs.setTransform(1, 0, 0, 1, 0, 0)
    glyphs.filter = 'none'
    glyphs.clearRect(0, 0, width, height)
  }

  // The SVG group's `scale(1/unitsPerPx) translate(-x -y)`, stretched from the artboard to the canvas.
  const kx = width / artboard.width
  const ky = height / artboard.height
  const s = 1 / layout.unitsPerPx
  glyphs.setTransform(kx * s, 0, 0, ky * s, -layout.x * kx * s, -layout.y * ky * s)
  if (look.outlineOnly) {
    // Set under the group transform, as the SVG's stroke-width on the glyph group: in font units.
    glyphs.strokeStyle = look.ink
    glyphs.lineWidth = outlineStrokeWidth(layout.unitsPerPx)
    glyphs.lineJoin = 'miter'
    glyphs.miterLimit = OUTLINE_MITER_LIMIT
  } else glyphs.fillStyle = look.ink
  const skew = scene.slant ? Math.tan((-scene.slant * Math.PI) / 180) : 0
  let drawn = 0
  for (const line of scene.lines) {
    for (const glyph of line.glyphs) {
      const { polygon } = glyph
      if (!polygon || polygon.contours.length === 0) continue
      // Each path's `translate(x y) skewX(-slant) scale(1 -1)`.
      glyphs.save()
      glyphs.translate(glyph.x, glyph.y)
      if (skew) glyphs.transform(1, 0, skew, 1, 0, 0)
      glyphs.scale(1, -1)
      if (look.outlineOnly) glyphs.stroke(pathOf(polygon))
      else glyphs.fill(pathOf(polygon), 'nonzero')
      glyphs.restore()
      drawn++
    }
  }

  if (blurred) {
    // As the SVG's filter on an untransformed group: the blur is in artboard pixels, stretched with the canvas.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.filter = `blur(${(look.blur * (kx + ky)) / 2}px)`
    ctx.drawImage(layer.image, 0, 0)
    ctx.filter = 'none'
  }
  return { glyphs: drawn, blurred }
}

/**
 * A polygon's outline as a path, built once per polygon (repeated letters and later frames with the same
 * shape reuse it): every contour as moveTo, lineTo… and closePath, in font units (y up).
 */
export function polygonPaths<P extends PathSink>(create: () => P): (polygon: PolygonGlyph) => P {
  const paths = new WeakMap<PolygonGlyph, P>()
  return (polygon) => {
    let path = paths.get(polygon)
    if (!path) {
      path = create()
      for (const { points } of polygon.contours) {
        if (points.length === 0) continue
        path.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y)
        path.closePath()
      }
      paths.set(polygon, path)
    }
    return path
  }
}

/** The parts of CanvasRenderingContext2D touchCanvas uses; `canvas` is the canvas it draws into. */
export interface Touchable {
  readonly canvas: unknown
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  save(): void
  restore(): void
  beginPath(): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
  globalAlpha: number
  globalCompositeOperation: string
  filter: string
}

/**
 * Marks a canvas as changed without changing what it shows: its top-left pixel copied onto itself. A canvas
 * captured as a stream gives a video frame only when it has changed since the last one, so without this a canvas
 * that holds still gives none (a still take would record a single frame, or none at all). The copy is clipped to
 * that pixel: 'copy' is an unbounded operation, which would otherwise clear the rest of the canvas (black on an
 * opaque one).
 */
export function touchCanvas(ctx: Touchable): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.beginPath()
  ctx.rect(0, 0, 1, 1)
  ctx.clip()
  ctx.filter = 'none'
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'copy'
  ctx.drawImage(ctx.canvas, 0, 0, 1, 1, 0, 0, 1, 1)
  ctx.restore()
}

/**
 * Whether this 2D context can blur: it has a `filter` that keeps a blur set on it. Call before anything
 * else sets `filter` on it. The context's filter is left as it was.
 */
export function canvasFilterWorks(ctx: { filter?: string }): boolean {
  if (typeof ctx.filter !== 'string') return false
  const before = ctx.filter
  ctx.filter = 'blur(1px)'
  const works = ctx.filter === 'blur(1px)'
  ctx.filter = before
  return works
}
