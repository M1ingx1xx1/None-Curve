// The glyph layer drawn with WebGL2, matching the SVG canvas: polygon fills by nonzero winding (stencil, then a cover
// quad that zeroes the stencil again so windings never leak into the next glyph), outlines 1.5 CSS px wide that do not
// scale (miter joins, bevel past the miter limit, each pixel drawn once per glyph so a translucent ink never doubles),
// the highlight on the hovered occurrence and on every occurrence of the selected glyph, and Compare's 35 % fill.
// A glyph mid-glide with a plan as data (MorphPlan.data) is evaluated on the GPU (transform feedback, webglShaders.ts),
// once per distinct (plan, progress); a glyph mid-glide without one is drawn from the CPU's in-between polygon
// (frame.scene()), uploaded with the frame's other such polygons in one batch.
//
// What it does not draw goes to a Canvas2D renderer in 'detail' mode on a canvas stacked above (made only when needed):
// the font's own outlines (Original, Compare's original), the skeleton, the vertices and missing-character boxes.

import type { PolygonGlyph } from '../geometry/types'
import type { MorphPlan } from '../specimen/morph'
import type { PlacedGlyph, SpecimenScene } from '../specimen/scene'
import { Canvas2DRenderer, needsDetail } from './canvas2d'
import {
  ATTRIB,
  copyToTexture,
  deletePlan,
  deleteShape,
  fanIndices,
  GPU_LIMITS,
  GpuLru,
  planSlot,
  positionsTexture,
  segmentIndices,
  shapeContours,
  texRows,
  uploadPlan,
  uploadShape,
  type Box,
  type GpuPlan,
  type GpuShape,
  type GpuSlot,
} from './gpuPlans'
import { planUniforms, type PlanUniforms } from './gpuReference'
import { hitFrame } from './hitTest'
import { glyphMatrix, type Matrix } from './strokes'
import { parseColor, type Rgba } from './theme'
import type { GlideFrame, GlyphRenderer, RenderHit, RenderStyle, RenderView, SourceLookup } from './types'
import { artboardMatrix, canvasCull, canvasMatrix, hitOptions, NO_CULL, scenePoint, sizeBackingStore } from './view'
import { COLOR_FS, COVER_VS, DISCARD_FS, EVAL_VS, FILL_VS, PATH_VS, STROKE_VS } from './webglShaders'

const OUTLINE_PX = 1.5
const MITER_LIMIT = 4
const COMPARE_ALPHA = 0.35

interface Program {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[], feedback: string[] | null): Program {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)
    if (!s) throw new Error('WebGL shader')
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`WebGL shader: ${gl.getShaderInfoLog(s)}`)
    return s
  }
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL program')
  const v = shader(gl.VERTEX_SHADER, vs)
  const f = shader(gl.FRAGMENT_SHADER, fs)
  gl.attachShader(program, v)
  gl.attachShader(program, f)
  if (feedback) gl.transformFeedbackVaryings(program, feedback, gl.SEPARATE_ATTRIBS)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`WebGL link: ${gl.getProgramInfoLog(program)}`)
  gl.deleteShader(v)
  gl.deleteShader(f)
  const locations: Program['uniforms'] = {}
  for (const name of uniforms) locations[name] = gl.getUniformLocation(program, name)
  return { program, uniforms: locations }
}

/** A colour the theme or palette gave, as numbers; anything parseColor cannot read goes through a 2D canvas. */
function rgbaOf(color: string, cache: Map<string, Rgba>): Rgba {
  let rgba = cache.get(color)
  if (rgba) return rgba
  rgba = parseColor(color) ?? undefined
  if (!rgba && typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#000'
      ctx.fillStyle = color
      rgba = parseColor(String(ctx.fillStyle)) ?? undefined
    }
  }
  rgba ??= [0, 0, 0, 1]
  cache.set(color, rgba)
  return rgba
}

/** One glyph to draw this frame: where its positions come from, its transform and colour. */
interface Item {
  matrix: Matrix
  color: Rgba
  /** A static polygon, a plan at p, or a CPU in-between polygon (in the frame's batch). */
  shape: GpuShape | null
  plan: GpuPlan | null
  slot: GpuSlot | null
  batch: { fanOffset: number; fanCount: number; segOffset: number; segCount: number } | null
  bounds: Box
}

/** The frame's CPU in-between polygons, uploaded together: positions (and their texture), fans and segments. */
class Batch {
  positions: WebGLBuffer
  fan: WebGLBuffer
  segments: WebGLBuffer
  texture: WebGLTexture | null = null
  rows = 0
  fill: WebGLVertexArrayObject
  stroke: WebGLVertexArrayObject

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.positions = gl.createBuffer()!
    this.fan = gl.createBuffer()!
    this.segments = gl.createBuffer()!
    this.fill = gl.createVertexArray()!
    gl.bindVertexArray(this.fill)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positions)
    gl.enableVertexAttribArray(ATTRIB.position)
    gl.vertexAttribPointer(ATTRIB.position, 2, gl.FLOAT, false, 8, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fan)
    this.stroke = gl.createVertexArray()!
    gl.bindVertexArray(this.stroke)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segments)
    gl.enableVertexAttribArray(ATTRIB.segment)
    gl.vertexAttribIPointer(ATTRIB.segment, 4, gl.UNSIGNED_INT, 16, 0)
    gl.vertexAttribDivisor(ATTRIB.segment, 1)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  /** Uploads the polygons; returns each one's offsets. */
  upload(polygons: PolygonGlyph[]): Item['batch'][] {
    const { gl } = this
    let points = 0
    for (const p of polygons) for (const c of p.contours) points += c.points.length
    const rows = texRows(points)
    const positions = new Float32Array(2 * rows * GPU_LIMITS.texWidth)
    const fans: Uint32Array[] = []
    const segs: Uint32Array[] = []
    const offsets: Item['batch'][] = []
    let base = 0
    let fanTotal = 0
    let segTotal = 0
    for (const polygon of polygons) {
      const contours = shapeContours(polygon.contours)
      let i = 2 * base
      for (const { points: pts } of polygon.contours) {
        for (const p of pts) {
          positions[i++] = p.x
          positions[i++] = p.y
        }
      }
      const fan = fanIndices(contours, base)
      const seg = segmentIndices(contours, base)
      offsets.push({ fanOffset: fanTotal, fanCount: fan.length, segOffset: segTotal, segCount: seg.length / 4 })
      fans.push(fan)
      segs.push(seg)
      fanTotal += fan.length
      segTotal += seg.length / 4
      base += contours.reduce((n, c) => n + c.n, 0)
    }
    const fanAll = new Uint32Array(Math.max(3, fanTotal))
    let k = 0
    for (const f of fans) {
      fanAll.set(f, k)
      k += f.length
    }
    const segAll = new Uint32Array(Math.max(4, segTotal * 4))
    k = 0
    for (const s of segs) {
      segAll.set(s, k)
      k += s.length
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positions)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segments)
    gl.bufferData(gl.ARRAY_BUFFER, segAll, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    gl.bindVertexArray(this.fill)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, fanAll, gl.DYNAMIC_DRAW)
    gl.bindVertexArray(null)
    if (rows > this.rows || !this.texture) {
      if (this.texture) gl.deleteTexture(this.texture)
      this.texture = positionsTexture(gl, rows * GPU_LIMITS.texWidth)
      this.rows = rows
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GPU_LIMITS.texWidth, rows, gl.RG, gl.FLOAT, positions)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return offsets
  }

  dispose() {
    const { gl } = this
    gl.deleteBuffer(this.positions)
    gl.deleteBuffer(this.fan)
    gl.deleteBuffer(this.segments)
    gl.deleteVertexArray(this.fill)
    gl.deleteVertexArray(this.stroke)
    if (this.texture) gl.deleteTexture(this.texture)
  }
}

export interface WebGLOptions {
  /** The canvas stacked above for the detail layer (Canvas2D), or null to draw none. */
  detailCanvas: HTMLCanvasElement | null
  /** Called once when the context is lost: the surface should make another renderer. */
  onLost?: () => void
}

export class WebGL2Renderer implements GlyphRenderer {
  readonly kind = 'webgl' as const
  broken = false
  private view: RenderView | null = null
  private style: RenderStyle | null = null
  private frame: GlideFrame | null = null
  private source: SourceLookup | null = null
  private offsetX = 0
  private offsetY = 0
  private hover: number | null = null
  private selected: number | null = null
  private dirty = true
  private detail: Canvas2DRenderer<Path2D> | null = null
  private readonly colors = new Map<string, Rgba>()
  private readonly shapes: GpuLru<PolygonGlyph, GpuShape>
  private readonly plans: GpuLru<MorphPlan, GpuPlan>
  private readonly batch: Batch
  private readonly feedback: WebGLTransformFeedback
  private readonly blank: WebGLTexture
  private readonly evalProgram: Program
  private readonly pathProgram: Program
  private readonly fillProgram: Program
  private readonly coverProgram: Program
  private readonly strokeProgram: Program
  private readonly emptyArray: WebGLVertexArrayObject
  private readonly onLost: () => void

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly options: WebGLOptions,
  ) {
    this.evalProgram = compile(gl, EVAL_VS, DISCARD_FS, ['u_p', 'u_start', 'u_end', 'u_ringA', 'u_ringB', 'u_paths'], ['v_pos'])
    this.pathProgram = compile(gl, PATH_VS, DISCARD_FS, ['u_p', 'u_centre', 'u_ring'], ['v_pos'])
    this.fillProgram = compile(gl, FILL_VS, COLOR_FS, ['u_glyph', 'u_viewport', 'u_color'], null)
    this.coverProgram = compile(gl, COVER_VS, COLOR_FS, ['u_rect', 'u_viewport', 'u_color'], null)
    this.strokeProgram = compile(gl, STROKE_VS, COLOR_FS, ['u_pos', 'u_glyph', 'u_half', 'u_limit', 'u_viewport', 'u_color'], null)
    this.shapes = new GpuLru((shape) => deleteShape(gl, shape))
    this.plans = new GpuLru((plan) => deletePlan(gl, plan))
    this.batch = new Batch(gl)
    this.feedback = gl.createTransformFeedback()!
    this.blank = positionsTexture(gl, 1)
    this.emptyArray = gl.createVertexArray()!
    this.onLost = () => {
      if (this.broken) return
      this.broken = true
      options.onLost?.()
    }
    canvas.addEventListener('webglcontextlost', this.onLost)
  }

  /** A renderer on `canvas`, or null when WebGL2 (with a stencil) is not available or a shader does not compile. */
  static create(canvas: HTMLCanvasElement, options: WebGLOptions): WebGL2Renderer | null {
    let gl: WebGL2RenderingContext | null = null
    try {
      gl = canvas.getContext('webgl2', { antialias: true, stencil: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false })
    } catch {
      gl = null
    }
    if (!gl || gl.isContextLost()) return null
    try {
      return new WebGL2Renderer(canvas, gl, options)
    } catch {
      return null
    }
  }

  /** What draws now, for the probe: 'webgl', or 'webgl+detail' while the detail layer shows anything. */
  get effective(): string {
    return this.detail?.drewSomething ? 'webgl+detail' : 'webgl'
  }

  setView(view: RenderView) {
    sizeBackingStore(this.canvas, view)
    this.view = view
    this.dirty = true
    this.detail?.setView(view)
  }

  setStyle(style: RenderStyle) {
    this.style = style
    this.dirty = true
    this.detail?.setStyle(style)
  }

  setFrame(frame: GlideFrame, source: SourceLookup | null) {
    if (frame === this.frame && source === this.source) return
    this.frame = frame
    this.source = source
    this.dirty = true
    this.detail?.setFrame(frame, source)
  }

  setTextOffset(dx: number, dy: number) {
    if (dx === this.offsetX && dy === this.offsetY) return
    this.offsetX = dx
    this.offsetY = dy
    this.dirty = true
    this.detail?.setTextOffset(dx, dy)
  }

  setHover(occurrence: number | null) {
    if (occurrence === this.hover) return
    this.hover = occurrence
    this.dirty = true
    this.detail?.setHover(occurrence)
  }

  setSelected(index: number | null) {
    if (index === this.selected) return
    this.selected = index
    this.dirty = true
    this.detail?.setSelected(index)
  }

  hitTest(x: number, y: number): RenderHit | null {
    const { view, style, frame } = this
    if (!view || view.kind !== 'canvas' || !style || !frame) return null
    // Gliding glyphs are evaluated on the GPU, so the CPU makes only the outlines near the point (frame.scene() would
    // make every one).
    const [sx, sy] = scenePoint(view, x, y)
    return hitFrame(frame, sx, sy, hitOptions(view, style, this.offsetX, this.offsetY, this.source))
  }

  draw(): boolean {
    if (this.broken || this.gl.isContextLost()) return false
    let drew = false
    if (this.dirty && this.view && this.style && this.frame) {
      this.dirty = false
      this.drawGlyphs(this.view, this.style, this.frame)
      drew = true
    }
    const detail = this.detailRenderer()
    if (detail?.draw()) drew = true
    return drew
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    if (!this.gl.isContextLost()) {
      this.shapes.clear()
      this.plans.clear()
      this.batch.dispose()
      this.gl.deleteTransformFeedback(this.feedback)
      this.gl.deleteTexture(this.blank)
      this.gl.deleteVertexArray(this.emptyArray)
      for (const p of [this.evalProgram, this.pathProgram, this.fillProgram, this.coverProgram, this.strokeProgram]) this.gl.deleteProgram(p.program)
    }
    this.detail?.dispose()
    this.detail = null
    this.frame = null
  }

  /** The detail layer, made the first time the style or scene needs it (and only in the canvas view). */
  private detailRenderer(): Canvas2DRenderer<Path2D> | null {
    if (this.detail) return this.detail
    const { view, style, frame } = this
    if (!this.options.detailCanvas || !view || view.kind !== 'canvas' || !style || !frame) return null
    if (!needsDetail(style, frame.layout)) return null
    const detail = Canvas2DRenderer.create(this.options.detailCanvas, 'detail')
    if (!detail) return null
    detail.setView(view)
    detail.setStyle(style)
    detail.setFrame(frame, this.source)
    detail.setTextOffset(this.offsetX, this.offsetY)
    detail.setHover(this.hover)
    detail.setSelected(this.selected)
    this.detail = detail
    return detail
  }

  private drawGlyphs(view: RenderView, style: RenderStyle, frame: GlideFrame) {
    const { gl } = this
    const width = this.canvas.width
    const height = this.canvas.height
    gl.viewport(0, 0, width, height)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clearStencil(0)
    gl.stencilMask(0xff)
    gl.colorMask(true, true, true, true)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    const layout = frame.layout
    // The font's own outlines are the detail layer's; the preview always draws polygons.
    if (!layout || (view.kind === 'canvas' && style.outline === 'source')) return
    const now = typeof performance === 'undefined' ? Date.now() : performance.now()
    const items = this.collect(view, style, frame, layout, now)
    if (items.length === 0) {
      this.evict(now)
      return
    }
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.DEPTH_TEST)
    const canvasView = view.kind === 'canvas'
    const fill = canvasView ? style.fill && style.outline !== 'source' : style.fill
    const compare = canvasView && style.outline === 'compare'
    const stroke = !style.fill || compare
    const half = canvasView || style.scalingStroke === null ? (OUTLINE_PX * view.dpr) / 2 : this.scalingHalf(view, style.scalingStroke)
    for (const item of items) {
      if (fill) this.fillItem(item, compare ? COMPARE_ALPHA : 1, width, height)
      if (stroke) this.strokeItem(item, half, width, height)
    }
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.SCISSOR_TEST)
    gl.bindVertexArray(null)
    this.evict(now)
  }

  /** The preview's outline (font units, scaling with the artboard), as device pixels: half of it. */
  private scalingHalf(view: Extract<RenderView, { kind: 'artboard' }>, width: number): number {
    const k = (this.canvas.width / view.artboard.width + this.canvas.height / view.artboard.height) / 2
    return (width / view.layout.unitsPerPx) * k * 0.5
  }

  private evict(now: number) {
    this.shapes.evict(now)
    this.plans.evict(now, GPU_LIMITS.maxBytes - this.shapes.bytes)
  }

  /** Which glyphs to draw (culled as the SVG canvas culls them), each with its positions on the GPU. */
  private collect(view: RenderView, style: RenderStyle, frame: GlideFrame, layout: SpecimenScene, now: number): Item[] {
    const { gl } = this
    const items: Item[] = []
    const transient: { item: Item; polygon: PolygonGlyph }[] = []
    const morphs = frame.morphs
    let cpu: PlacedGlyph[] | null = null
    const cpuGlyph = (occurrence: number): PlacedGlyph | null => {
      if (!cpu) cpu = (frame.scene()?.lines ?? []).flatMap((line) => line.glyphs)
      return cpu[occurrence] ?? null
    }
    const canvasView = view.kind === 'canvas'
    const base: Matrix = canvasView
      ? canvasMatrix(view, this.offsetX, this.offsetY)
      : artboardMatrix(this.canvas.width, this.canvas.height, view.artboard, view.layout)
    const cull = canvasView ? canvasCull(view, style) : NO_CULL
    const grew = { bytes: 0 }
    const touched = new Set<GpuPlan>()
    let occurrence = 0
    for (const line of layout.lines) {
      const band = cull.band(line.baseline)
      if (!band && !cull.ink(line.ink)) {
        occurrence += line.glyphs.length
        continue
      }
      for (const g of line.glyphs) {
        const occ = occurrence++
        if (g.missing || !cull.glyph(g, band)) continue
        if (view.kind === 'canvas' && this.source) {
          const source = this.source(g.index)
          if (!source || source.contours.length === 0) continue
        }
        const lit = view.kind === 'canvas' && (occ === this.hover || g.index === this.selected)
        const color = view.kind === 'canvas' ? (lit ? style.colors.highlight : style.colors.ink) : style.colors.ink
        const item: Item = {
          matrix: glyphMatrix(base, g.x, g.y, layout.slant),
          color: rgbaOf(color, this.colors),
          shape: null,
          plan: null,
          slot: null,
          batch: null,
          bounds: [0, 0, 0, 0],
        }
        const morph = morphs?.[occ] ?? null
        if (morph && morph.plan.data) {
          let plan = this.plans.get(morph.plan, now)
          if (!plan) {
            const uploaded = uploadPlan(gl, morph.plan, morph.plan.data)
            plan = uploaded.plan
            this.plans.set(morph.plan, plan, uploaded.bytes, now)
          }
          if (!touched.has(plan)) {
            touched.add(plan)
            plan.used = 0
          }
          // A slot already at this progress (this frame's, or one a frame drawn again left) is not evaluated again.
          const before = grew.bytes
          const { slot, fresh } = planSlot(gl, plan, morph.p, grew)
          this.plans.grow(morph.plan, grew.bytes - before)
          if (fresh) this.evaluate(plan, slot, morph.p)
          item.plan = plan
          item.slot = slot
          item.bounds = plan.bounds
        } else {
          const polygon = morph ? cpuGlyph(occ)?.polygon : g.polygon
          if (!polygon || polygon.contours.length === 0) continue
          if (morph) {
            transient.push({ item, polygon })
            const b = polygon.contours.flatMap((c) => c.points)
            item.bounds = b.reduce<Box>((box, p) => [Math.min(box[0], p.x), Math.min(box[1], p.y), Math.max(box[2], p.x), Math.max(box[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity])
          } else {
            let shape = this.shapes.get(polygon, now)
            if (!shape) {
              const uploaded = uploadShape(gl, polygon)
              shape = uploaded.shape
              this.shapes.set(polygon, shape, uploaded.bytes, now)
            }
            item.shape = shape
            item.slot = shape.slot
            item.bounds = shape.bounds
          }
        }
        items.push(item)
      }
    }
    if (transient.length > 0) {
      const offsets = this.batch.upload(transient.map((t) => t.polygon))
      transient.forEach((t, i) => (t.item.batch = offsets[i]))
    }
    return items
  }

  /** Writes the plan's anchors at progress p into `slot` (mesh plans: the path pass first, into its texture). */
  private evaluate(plan: GpuPlan, slot: GpuSlot, p: number) {
    const { gl } = this
    const u: PlanUniforms = planUniforms(plan.data)
    gl.enable(gl.RASTERIZER_DISCARD)
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback)
    if (plan.paths && plan.paths.count > 0) {
      const prog = this.pathProgram
      gl.useProgram(prog.program)
      gl.uniform1f(prog.uniforms.u_p, p)
      gl.uniform2f(prog.uniforms.u_centre, u.meshX, u.meshY)
      gl.uniform3f(prog.uniforms.u_ring, u.meshRing.first, u.meshRing.step, u.meshRing.cosHalf)
      gl.bindVertexArray(plan.paths.array)
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, plan.paths.positions)
      gl.beginTransformFeedback(gl.POINTS)
      gl.drawArrays(gl.POINTS, 0, plan.paths.count)
      gl.endTransformFeedback()
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
      copyToTexture(gl, plan.paths.positions, plan.paths.texture, plan.paths.count)
    }
    if (plan.points > 0) {
      const prog = this.evalProgram
      gl.useProgram(prog.program)
      gl.uniform1f(prog.uniforms.u_p, p)
      gl.uniform2f(prog.uniforms.u_start, u.startX, u.startY)
      gl.uniform2f(prog.uniforms.u_end, u.endX, u.endY)
      gl.uniform3f(prog.uniforms.u_ringA, u.ringA.first, u.ringA.step, u.ringA.cosHalf)
      gl.uniform3f(prog.uniforms.u_ringB, u.ringB.first, u.ringB.step, u.ringB.cosHalf)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, plan.paths?.texture ?? this.blank)
      gl.uniform1i(prog.uniforms.u_paths, 0)
      gl.bindVertexArray(plan.anchorArray)
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, slot.positions)
      gl.beginTransformFeedback(gl.POINTS)
      gl.drawArrays(gl.POINTS, 0, plan.points)
      gl.endTransformFeedback()
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null)
    gl.bindVertexArray(null)
    gl.disable(gl.RASTERIZER_DISCARD)
    slot.p = p
    slot.textured = false
  }

  private setGlyph(prog: Program, m: Matrix, width: number, height: number) {
    const { gl } = this
    // Column-major mat3 of the affine transform.
    gl.uniformMatrix3fv(prog.uniforms.u_glyph, false, [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1])
    gl.uniform2f(prog.uniforms.u_viewport, width, height)
  }

  /** The bounds' four corners through the transform: the device-pixel box the cover quad spans. */
  private deviceRect(item: Item, pad: number): [number, number, number, number] {
    const [x0, y0, x1, y1] = item.bounds
    const m = item.matrix
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ]) {
      const dx = m[0] * x + m[2] * y + m[4]
      const dy = m[1] * x + m[3] * y + m[5]
      minX = Math.min(minX, dx)
      minY = Math.min(minY, dy)
      maxX = Math.max(maxX, dx)
      maxY = Math.max(maxY, dy)
    }
    return [minX - pad, minY - pad, maxX + pad, maxY + pad]
  }

  /** Stencil the fan (+1 front, −1 back), then cover where it is not zero and zero it again. */
  private fillItem(item: Item, alpha: number, width: number, height: number) {
    const { gl } = this
    const fanCount = item.batch ? item.batch.fanCount : (item.plan ?? item.shape)!.fanCount
    if (fanCount === 0) return
    const fill = this.fillProgram
    gl.useProgram(fill.program)
    this.setGlyph(fill, item.matrix, width, height)
    gl.colorMask(false, false, false, false)
    gl.stencilFunc(gl.ALWAYS, 0, 0xff)
    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP)
    gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP)
    if (item.batch) {
      gl.bindVertexArray(this.batch.fill)
      gl.drawElements(gl.TRIANGLES, item.batch.fanCount, gl.UNSIGNED_INT, item.batch.fanOffset * 4)
    } else {
      gl.bindVertexArray(item.slot!.fill)
      gl.drawElements(gl.TRIANGLES, fanCount, gl.UNSIGNED_INT, 0)
    }
    gl.colorMask(true, true, true, true)
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff)
    gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO)
    const cover = this.coverProgram
    gl.useProgram(cover.program)
    const [x0, y0, x1, y1] = this.deviceRect(item, 1)
    gl.uniform4f(cover.uniforms.u_rect, x0, y0, x1, y1)
    gl.uniform2f(cover.uniforms.u_viewport, width, height)
    const [r, g, b, a] = item.color
    const k = a * alpha
    gl.uniform4f(cover.uniforms.u_color, r * k, g * k, b * k, k)
    gl.bindVertexArray(this.emptyArray)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** Each side once per pixel (stencil: draw where 0, then mark), then the marks cleared within the glyph's box. */
  private strokeItem(item: Item, half: number, width: number, height: number) {
    const { gl } = this
    let texture: WebGLTexture | null
    let count: number
    if (item.batch) {
      texture = this.batch.texture
      count = item.batch.segCount
    } else {
      const slot = item.slot!
      if (!slot.textured) {
        copyToTexture(gl, slot.positions, slot.texture, (item.plan ?? item.shape)!.points)
        slot.textured = true
      }
      texture = slot.texture
      count = (item.plan ?? item.shape)!.segmentCount
    }
    if (count === 0 || !texture) return
    const prog = this.strokeProgram
    gl.useProgram(prog.program)
    this.setGlyph(prog, item.matrix, width, height)
    gl.uniform1f(prog.uniforms.u_half, half)
    gl.uniform1f(prog.uniforms.u_limit, MITER_LIMIT)
    const [r, g, b, a] = item.color
    gl.uniform4f(prog.uniforms.u_color, r * a, g * a, b * a, a)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(prog.uniforms.u_pos, 0)
    gl.stencilFunc(gl.EQUAL, 0, 0xff)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR)
    if (item.batch) {
      gl.bindVertexArray(this.batch.stroke)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.batch.segments)
      gl.vertexAttribIPointer(ATTRIB.segment, 4, gl.UNSIGNED_INT, 16, item.batch.segOffset * 16)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
    } else gl.bindVertexArray((item.plan ?? item.shape)!.stroke)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 9, count)
    gl.bindTexture(gl.TEXTURE_2D, null)
    // Clear this glyph's marks: a scissored stencil clear over its box, widened by the longest miter.
    const [x0, y0, x1, y1] = this.deviceRect(item, half * MITER_LIMIT + 2)
    const sx = Math.max(0, Math.floor(x0))
    const sy = Math.max(0, Math.floor(height - y1))
    const sw = Math.min(width, Math.ceil(x1)) - sx
    const sh = Math.min(height, Math.ceil(height - y0)) - sy
    if (sw > 0 && sh > 0) {
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(sx, sy, sw, sh)
      gl.clear(gl.STENCIL_BUFFER_BIT)
      gl.disable(gl.SCISSOR_TEST)
    }
  }
}
