// The glyph layer drawn into a 2D canvas, matching the SVG canvas (SpecimenView with GlyphLayers and styles.css):
// the same placement (each glyph's translate, slant and flip), nonzero fills, 1.5 CSS px outlines that do not scale
// (built in screen space, strokes.ts) with miter joins (limit 4), the highlight on the hovered occurrence and on every
// occurrence of the selected glyph, Compare's 35 % fill and dashed original, the skeleton and vertex markers, and the
// dashed missing-character boxes. Polygons are drawn with straight segments only; the font's own outlines (Original,
// Compare, Skeleton) keep their curves, as in SVG. Skeleton controls and vertices are discs, like SVG's <circle>
// markers: interface marks, not glyph output.
//
// Three modes: 'full' draws everything on the main canvas; 'detail' draws only what the WebGL renderer leaves to it
// (original outlines, Compare's original, skeleton, vertices, missing boxes) on a canvas stacked above it; 'artboard'
// draws the preview, the artboard stretched over the canvas as drawArtboard does (paper and blur are CSS under and on it).

import { polygonPaths } from '../export/drawArtboard'
import { sourceGlyphSkeleton } from '../geometry/sourcePath'
import type { PolygonGlyph, SourceGlyph } from '../geometry/types'
import type { SpecimenScene } from '../specimen/scene'
import { hitScene } from './hitTest'
import { apply, glyphMatrix, IDENTITY, traceSource, tracePolygon, type CurveSink, type Matrix } from './strokes'
import type { GlideFrame, GlyphRenderer, RenderHit, RenderStyle, RenderView, SourceLookup } from './types'
import { artboardMatrix, canvasCull, canvasMatrix, hitOptions, scenePoint, sizeBackingStore, type CanvasBacking } from './view'

export type { CanvasBacking } from './view'

export type Canvas2DMode = 'full' | 'detail' | 'artboard'

/** The path type the renderer builds (Path2D in the browser). */
export interface RenderPath extends CurveSink {
  arc(x: number, y: number, r: number, start: number, end: number): void
  rect(x: number, y: number, w: number, h: number): void
}

/** The parts of CanvasRenderingContext2D the renderer uses; P is its path type. */
export interface Context2D<P> {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  fill(path: P, rule: 'nonzero'): void
  stroke(path: P): void
  setLineDash(segments: number[]): void
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineJoin: string
  miterLimit: number
  globalAlpha: number
}

/** Outline strokes, in CSS px (styles.css: .outline-stroke, .compare-source, .strip-missing, .skeleton-*). */
const OUTLINE_PX = 1.5
const SKELETON_PX = 1.25
const HANDLE_PX = 1
const ANCHOR_STROKE_PX = 1
const MITER_LIMIT = 4
/** Vertex dots are this share of the marker radius (GlyphLayers' VERTEX_SCALE). */
const VERTEX_SCALE = 0.4

/** True when the 'detail' layer has anything to draw for this style and scene. */
export function needsDetail(style: RenderStyle, scene: SpecimenScene | null): boolean {
  if (style.outline !== 'flattened' || style.showSkeleton || (style.showVertices && style.showMarkers)) return true
  return scene !== null && scene.missingCharacters.length > 0
}

export class Canvas2DRenderer<P extends RenderPath = Path2D> implements GlyphRenderer {
  readonly kind = 'canvas' as const
  readonly broken = false
  private view: RenderView | null = null
  private style: RenderStyle | null = null
  private frame: GlideFrame | null = null
  private source: SourceLookup | null = null
  private offsetX = 0
  private offsetY = 0
  private hover: number | null = null
  private selected: number | null = null
  private dirty = true
  /** Whether the last draw left anything on the canvas (the probe's 'webgl+detail'). */
  drewSomething = false
  private readonly polygonPath: (polygon: PolygonGlyph) => P
  private readonly sourcePaths = new WeakMap<SourceGlyph, P>()

  constructor(
    private readonly canvas: CanvasBacking,
    private readonly ctx: Context2D<P>,
    readonly mode: Canvas2DMode,
    private readonly createPath: () => P,
  ) {
    this.polygonPath = polygonPaths(createPath)
  }

  /** A renderer on a real canvas, or null when it gives no 2D context. */
  static create(canvas: HTMLCanvasElement, mode: Canvas2DMode): Canvas2DRenderer<Path2D> | null {
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext('2d', { alpha: true, desynchronized: false })
    } catch {
      ctx = null
    }
    if (!ctx) return null
    return new Canvas2DRenderer<Path2D>(canvas, ctx as unknown as Context2D<Path2D>, mode, () => new Path2D())
  }

  setView(view: RenderView) {
    sizeBackingStore(this.canvas, view)
    this.view = view
    this.dirty = true
  }

  setStyle(style: RenderStyle) {
    this.style = style
    this.dirty = true
  }

  setFrame(frame: GlideFrame, source: SourceLookup | null) {
    const same = frame === this.frame && source === this.source
    this.frame = frame
    this.source = source
    if (same) return
    // The detail layer holds still while nothing it draws is there (a glide in the flattened view without markers).
    if (this.mode === 'detail' && this.style && !this.drewSomething && !needsDetail(this.style, frame.layout)) return
    this.dirty = true
  }

  setTextOffset(dx: number, dy: number) {
    if (dx === this.offsetX && dy === this.offsetY) return
    this.offsetX = dx
    this.offsetY = dy
    this.dirty = true
  }

  setHover(occurrence: number | null) {
    if (occurrence === this.hover) return
    this.hover = occurrence
    if (this.mode !== 'artboard') this.dirty = true
  }

  setSelected(index: number | null) {
    if (index === this.selected) return
    this.selected = index
    if (this.mode !== 'artboard') this.dirty = true
  }

  hitTest(x: number, y: number): RenderHit | null {
    const { view, style, frame } = this
    if (!view || view.kind !== 'canvas' || !style || !frame) return null
    const scene = frame.scene()
    if (!scene) return null
    // The scene is the one drawn (draw() evaluates it every frame), so this costs no morph of its own.
    const [sx, sy] = scenePoint(view, x, y)
    return hitScene(scene, sx, sy, hitOptions(view, style, this.offsetX, this.offsetY, this.source))
  }

  draw(): boolean {
    if (!this.dirty) return false
    const { view, style, frame } = this
    if (!view || !style || !frame) return false
    this.dirty = false
    const { ctx } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.drewSomething = false
    if (this.mode === 'detail' && !needsDetail(style, frame.layout)) return true
    const scene = frame.scene()
    if (!scene) return true
    if (view.kind === 'artboard') this.drawArtboard(scene, view, style)
    else this.drawCanvas(scene, view, style)
    return true
  }

  dispose() {
    this.frame = null
    this.source = null
  }

  /** The preview: drawArtboard's placement, the canvas stretched over the artboard; filled, or a scaling outline. */
  private drawArtboard(scene: SpecimenScene, view: Extract<RenderView, { kind: 'artboard' }>, style: RenderStyle) {
    const { ctx } = this
    const base = artboardMatrix(this.canvas.width, this.canvas.height, view.artboard, view.layout)
    const stroke = !style.fill
    if (stroke) {
      ctx.strokeStyle = style.colors.ink
      ctx.lineWidth = style.scalingStroke ?? 0
      ctx.lineJoin = 'miter'
      ctx.miterLimit = MITER_LIMIT
    } else ctx.fillStyle = style.colors.ink
    for (const line of scene.lines) {
      for (const glyph of line.glyphs) {
        const { polygon } = glyph
        if (!polygon || polygon.contours.length === 0) continue
        const m = glyphMatrix(base, glyph.x, glyph.y, scene.slant)
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
        if (stroke) ctx.stroke(this.polygonPath(polygon))
        else ctx.fill(this.polygonPath(polygon), 'nonzero')
        this.drewSomething = true
      }
    }
  }

  /** The main canvas: SpecimenView's glyph layers, culled as it culls them. */
  private drawCanvas(scene: SpecimenScene, view: Extract<RenderView, { kind: 'canvas' }>, style: RenderStyle) {
    const { u, dpr } = view
    const k = dpr / u
    const base = canvasMatrix(view, this.offsetX, this.offsetY)
    const cull = canvasCull(view, style)
    const { ascender } = style
    let occurrence = 0
    for (const line of scene.lines) {
      const band = cull.band(line.baseline)
      if (!band && !cull.ink(line.ink)) {
        occurrence += line.glyphs.length
        continue
      }
      for (const g of line.glyphs) {
        const occ = occurrence++
        if (!cull.glyph(g, band)) continue
        if (g.missing) {
          this.drawMissing(base, g.x + g.advance * 0.1, g.y - ascender * 0.7, g.advance * 0.8, ascender * 0.7, dpr, style)
          continue
        }
        const source = this.source ? this.source(g.index) : null
        if (this.source && (!source || source.contours.length === 0)) continue
        const m = glyphMatrix(base, g.x, g.y, scene.slant)
        const lit = occ === this.hover || g.index === this.selected
        this.drawGlyph(m, g.polygon, source, lit ? style.colors.highlight : style.colors.ink, dpr, k, style)
      }
    }
  }

  private drawGlyph(m: Matrix, polygon: PolygonGlyph | null, source: SourceGlyph | null, color: string, dpr: number, k: number, style: RenderStyle) {
    const detail = this.mode === 'detail'
    const hasPolygon = polygon !== null && polygon.contours.length > 0
    if (style.outline === 'source' && source) {
      if (style.fill) this.fillSource(m, source, color)
      else this.strokeSource(m, source, color, OUTLINE_PX * dpr, null)
    } else if (style.outline === 'flattened' && hasPolygon && !detail) {
      if (style.fill) this.fillPolygon(m, polygon, color, 1)
      else this.strokePolygon(m, polygon, color, dpr)
    } else if (style.outline === 'compare') {
      if (!detail && hasPolygon) {
        if (style.fill) this.fillPolygon(m, polygon, color, 0.35)
        this.strokePolygon(m, polygon, color, dpr)
      }
      if (source) this.strokeSource(m, source, style.colors.accent, OUTLINE_PX * dpr, [5 * dpr, 3 * dpr])
    }
    if (style.showSkeleton && source) {
      this.strokeSource(m, source, style.colors.accent, SKELETON_PX * dpr, null)
      if (style.showMarkers) this.drawSkeletonMarkers(m, source, style, dpr, k)
    }
    if (style.showVertices && style.showMarkers && hasPolygon) this.drawVertices(m, polygon, style)
  }

  private fillPolygon(m: Matrix, polygon: PolygonGlyph, color: string, alpha: number) {
    const { ctx } = this
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
    ctx.fillStyle = color
    if (alpha !== 1) ctx.globalAlpha = alpha
    ctx.fill(this.polygonPath(polygon), 'nonzero')
    if (alpha !== 1) ctx.globalAlpha = 1
    this.drewSomething = true
  }

  /** The outline 1.5 CSS px wide at any zoom: the path built in device pixels, stroked under no transform. */
  private strokePolygon(m: Matrix, polygon: PolygonGlyph, color: string, dpr: number) {
    const { ctx } = this
    const path = this.createPath()
    tracePolygon(path, polygon.contours, m)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.strokeStyle = color
    ctx.lineWidth = OUTLINE_PX * dpr
    ctx.lineJoin = 'miter'
    ctx.miterLimit = MITER_LIMIT
    ctx.stroke(path)
    this.drewSomething = true
  }

  private fillSource(m: Matrix, source: SourceGlyph, color: string) {
    let path = this.sourcePaths.get(source)
    if (!path) {
      path = this.createPath()
      traceSource(path, source, IDENTITY)
      this.sourcePaths.set(source, path)
    }
    const { ctx } = this
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
    ctx.fillStyle = color
    ctx.fill(path, 'nonzero')
    this.drewSomething = true
  }

  private strokeSource(m: Matrix, source: SourceGlyph, color: string, width: number, dash: number[] | null) {
    const { ctx } = this
    const path = this.createPath()
    traceSource(path, source, m)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'miter'
    ctx.miterLimit = MITER_LIMIT
    if (dash) ctx.setLineDash(dash)
    ctx.stroke(path)
    if (dash) ctx.setLineDash([])
    this.drewSomething = true
  }

  /** Handles (1 px), controls (discs) and anchors (squares in the glyph's own units, slanted with it). */
  private drawSkeletonMarkers(m: Matrix, source: SourceGlyph, style: RenderStyle, dpr: number, k: number) {
    const { ctx } = this
    const skeleton = sourceGlyphSkeleton(source)
    const r = style.markerRadius
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.lineJoin = 'miter'
    ctx.miterLimit = MITER_LIMIT
    if (skeleton.handles.length > 0) {
      const handles = this.createPath()
      for (const [a, b] of skeleton.handles) {
        handles.moveTo(...apply(m, a.x, a.y))
        handles.lineTo(...apply(m, b.x, b.y))
      }
      ctx.strokeStyle = style.colors.control
      ctx.lineWidth = HANDLE_PX * dpr
      ctx.stroke(handles)
    }
    if (skeleton.controls.length > 0) {
      const controls = this.createPath()
      const rpx = r * k
      for (const p of skeleton.controls) {
        const [x, y] = apply(m, p.x, p.y)
        controls.moveTo(x + rpx, y)
        controls.arc(x, y, rpx, 0, 2 * Math.PI)
        controls.closePath()
      }
      ctx.fillStyle = style.colors.canvas
      ctx.fill(controls, 'nonzero')
      ctx.strokeStyle = style.colors.control
      ctx.lineWidth = SKELETON_PX * dpr
      ctx.stroke(controls)
    }
    if (skeleton.anchors.length > 0) {
      const anchors = this.createPath()
      for (const p of skeleton.anchors) {
        anchors.moveTo(...apply(m, p.x - r, p.y - r))
        anchors.lineTo(...apply(m, p.x + r, p.y - r))
        anchors.lineTo(...apply(m, p.x + r, p.y + r))
        anchors.lineTo(...apply(m, p.x - r, p.y + r))
        anchors.closePath()
      }
      ctx.fillStyle = style.colors.accent
      ctx.fill(anchors, 'nonzero')
      ctx.strokeStyle = style.colors.canvas
      ctx.lineWidth = ANCHOR_STROKE_PX * dpr
      ctx.stroke(anchors)
    }
    this.drewSomething = true
  }

  /** Vertex dots, in the glyph's own units (as SVG's <circle> under the glyph's transform). */
  private drawVertices(m: Matrix, polygon: PolygonGlyph, style: RenderStyle) {
    const { ctx } = this
    const r = style.markerRadius * VERTEX_SCALE
    const dots = this.createPath()
    for (const { points } of polygon.contours) {
      for (const p of points) {
        dots.moveTo(p.x + r, p.y)
        dots.arc(p.x, p.y, r, 0, 2 * Math.PI)
        dots.closePath()
      }
    }
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
    ctx.fillStyle = style.colors.vertex
    ctx.fill(dots, 'nonzero')
    this.drewSomething = true
  }

  /** A missing character's dashed box (scene units, not slanted), 1.5 px. */
  private drawMissing(base: Matrix, x: number, y: number, w: number, h: number, dpr: number, style: RenderStyle) {
    const { ctx } = this
    const [x0, y0] = apply(base, x, y)
    const [x1, y1] = apply(base, x + w, y + h)
    const box = this.createPath()
    box.rect(x0, y0, x1 - x0, y1 - y0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.strokeStyle = style.colors.danger
    ctx.lineWidth = OUTLINE_PX * dpr
    ctx.lineJoin = 'miter'
    ctx.miterLimit = MITER_LIMIT
    ctx.setLineDash([4 * dpr, 3 * dpr])
    ctx.stroke(box)
    ctx.setLineDash([])
    this.drewSomething = true
  }
}
