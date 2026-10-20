// The Canvas2D renderer (src/render/canvas2d.ts) with a context that records its calls, against the SVG canvas it
// matches (SpecimenView, GlyphLayers, styles.css): each glyph's transform is the SVG's viewBox mapping times
// translate(x y) skewX(-slant) scale(1 -1); polygons are straight segments only, filled nonzero; outlines are built in
// screen space and stroked 1.5 CSS px wide (× DPR) with miter joins, limit 4; Compare fills at 35 % and dashes the
// original; hover colours one occurrence and selection every occurrence of the glyph; 'detail' leaves the polygons out.

import { describe, expect, it } from 'vitest'
import { Canvas2DRenderer, needsDetail, type Canvas2DMode } from '../../src/render/canvas2d'
import type { CanvasView, GlideFrame, RenderStyle } from '../../src/render/types'
import type { SpecimenScene } from '../../src/specimen/scene'
import { RecordingContext, RecordingPath, sceneOf, square, squareSource, testStyle, type Call } from './fixtures'

const still = (scene: SpecimenScene): GlideFrame => ({ target: scene, layout: scene, morphs: null, scene: () => scene })

const VIEW: CanvasView = { kind: 'canvas', left: -500, top: 1000, u: 2.5, cssWidth: 800, cssHeight: 600, dpr: 2 }

function draw(scene: SpecimenScene, style: RenderStyle, setup?: (r: Canvas2DRenderer<RecordingPath>) => void, mode: Canvas2DMode = 'full', view = VIEW) {
  const ctx = new RecordingContext()
  const canvas = { width: 0, height: 0 }
  const renderer = new Canvas2DRenderer<RecordingPath>(canvas, ctx, mode, () => new RecordingPath())
  renderer.setView(view)
  renderer.setStyle(style)
  renderer.setFrame(still(scene), () => squareSource())
  setup?.(renderer)
  const drew = renderer.draw()
  return { ctx, canvas, renderer, drew }
}

const fills = (ctx: RecordingContext) => ctx.calls.map((c, i) => [c, i] as const).filter(([c]) => c[0] === 'fill')
const strokes = (ctx: RecordingContext) => ctx.calls.map((c, i) => [c, i] as const).filter(([c]) => c[0] === 'stroke')
const stateOf = (call: Call) => call[call.length - 1] as Record<string, unknown>

/** Where SpecimenView's SVG puts glyph point (px, py) of a glyph at (x, y): viewBox mapping, then the glyph's transform. */
function svgDevice(view: CanvasView, x: number, y: number, slant: number, px: number, py: number): [number, number] {
  const skew = Math.tan((-slant * Math.PI) / 180)
  // translate(x y) skewX(-slant) scale(1 -1)
  const sx = x + px + skew * -py
  const sy = y - py
  // viewBox `${left} ${-top} ${visW} ${visH}` stretched over the element, times the DPR.
  return [((sx - view.left) / view.u) * view.dpr, ((sy + view.top) / view.u) * view.dpr]
}

const applyM = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

describe('the Canvas2D renderer', () => {
  it('sizes the backing store by the DPR', () => {
    const { canvas } = draw(sceneOf([[{ index: 1, polygon: square(0, 0, 100, 100) }]]), testStyle())
    expect(canvas).toEqual({ width: 1600, height: 1200 })
  })

  it('places each glyph exactly as the SVG canvas does: translate, slant, flip', () => {
    for (const slant of [0, 12, -30]) {
      const scene = sceneOf([[{ index: 1, polygon: square(0, 0, 400, 700) }, { index: 1, polygon: square(0, 0, 400, 700), x: 650, y: 40 }]], slant)
      const { ctx } = draw(scene, testStyle())
      const found = fills(ctx)
      expect(found).toHaveLength(2)
      scene.lines[0].glyphs.forEach((g, k) => {
        const m = ctx.transformBefore(found[k][1])
        for (const [px, py] of [
          [0, 0],
          [400, 0],
          [123, 456],
        ]) {
          const [ex, ey] = svgDevice(VIEW, g.x, g.y, slant, px, py)
          const [ax, ay] = applyM(m, px, py)
          expect(ax).toBeCloseTo(ex, 9)
          expect(ay).toBeCloseTo(ey, 9)
        }
      })
    }
  })

  it('draws polygons with straight segments only, filled nonzero', () => {
    const { ctx } = draw(sceneOf([[{ index: 1, polygon: square(0, 0, 400, 700) }]]), testStyle())
    const [[call]] = fills(ctx)
    expect(call[2]).toBe('nonzero')
    const path = call[1] as RecordingPath
    expect(new Set(path.commands.map((c) => c[0]))).toEqual(new Set(['M', 'L', 'Z']))
    expect(stateOf(call).fillStyle).toBe('ink')
  })

  it('strokes outlines in screen space, 1.5 CSS px × DPR, miter joins limited to 4 (Fill off)', () => {
    const scene = sceneOf([[{ index: 1, polygon: square(0, 0, 400, 700), x: 100, y: 50 }]], 15)
    const { ctx } = draw(scene, testStyle({ fill: false }))
    expect(fills(ctx)).toHaveLength(0)
    const found = strokes(ctx)
    expect(found).toHaveLength(1)
    const [call, i] = found[0]
    expect(ctx.transformBefore(i)).toEqual([1, 0, 0, 1, 0, 0])
    expect(stateOf(call)).toMatchObject({ lineWidth: 1.5 * VIEW.dpr, lineJoin: 'miter', miterLimit: 4, strokeStyle: 'ink' })
    const path = call[1] as RecordingPath
    expect(new Set(path.commands.map((c) => c[0]))).toEqual(new Set(['M', 'L', 'Z']))
    // The path's points are the glyph's corners in device pixels.
    const [ex, ey] = svgDevice(VIEW, 100, 50, 15, 400, 700)
    expect(path.commands[2][1]).toBeCloseTo(ex, 9)
    expect(path.commands[2][2]).toBeCloseTo(ey, 9)
  })

  it('in Compare fills at 35 %, strokes the polygon, and dashes the original in the accent colour', () => {
    const { ctx } = draw(sceneOf([[{ index: 1, polygon: square(0, 0, 400, 700) }]]), testStyle({ outline: 'compare' }))
    const [[fill]] = fills(ctx)
    expect(stateOf(fill)).toMatchObject({ globalAlpha: 0.35, fillStyle: 'ink' })
    const found = strokes(ctx).map(([c]) => c)
    expect(found).toHaveLength(2)
    expect(stateOf(found[0])).toMatchObject({ strokeStyle: 'ink', globalAlpha: 1, lineWidth: 3 })
    expect(stateOf(found[1])).toMatchObject({ strokeStyle: 'accent', dash: [5 * VIEW.dpr, 3 * VIEW.dpr], lineWidth: 3 })
    // The original keeps its curves.
    expect((found[1][1] as RecordingPath).commands.some((c) => c[0] === 'Q')).toBe(true)
  })

  it('colours the hovered occurrence alone, and every occurrence of the selected glyph', () => {
    const scene = sceneOf([[1, 2, 1, 2].map((index, i) => ({ index, polygon: square(0, 0, 400, 700), x: i * 600 }))])
    const hovered = draw(scene, testStyle(), (r) => r.setHover(1))
    expect(fills(hovered.ctx).map(([c]) => stateOf(c).fillStyle)).toEqual(['ink', 'highlight', 'ink', 'ink'])
    const selected = draw(scene, testStyle(), (r) => r.setSelected(1))
    expect(fills(selected.ctx).map(([c]) => stateOf(c).fillStyle)).toEqual(['highlight', 'ink', 'highlight', 'ink'])
  })

  it('draws missing characters as dashed danger boxes, not slanted', () => {
    const scene = sceneOf([[{ index: 0, missing: true, x: 0, y: 0, advance: 500 }]], 20)
    const { ctx } = draw(scene, testStyle())
    const [[call, i]] = strokes(ctx)
    expect(ctx.transformBefore(i)).toEqual([1, 0, 0, 1, 0, 0])
    expect(stateOf(call)).toMatchObject({ strokeStyle: 'danger', lineWidth: 3, dash: [8, 6] })
    const [cmd] = (call[1] as RecordingPath).commands
    const [x0, y0] = svgDevice(VIEW, 0, 0, 0, 50, 0.7 * 900)
    expect(cmd[0]).toBe('R')
    expect(cmd[1]).toBeCloseTo(x0, 9)
    expect(cmd[2]).toBeCloseTo(y0, 9)
  })

  it('culls glyphs out of view as the SVG canvas does', () => {
    const far = sceneOf([[{ index: 1, polygon: square(0, 0, 400, 700), x: 100000 }]])
    expect(fills(draw(far, testStyle()).ctx)).toHaveLength(0)
  })

  it("leaves polygons to WebGL in 'detail' mode, and draws only what WebGL does not", () => {
    const scene = sceneOf([[{ index: 1, polygon: square(0, 0, 400, 700) }]])
    expect(needsDetail(testStyle(), scene)).toBe(false)
    const flat = draw(scene, testStyle(), undefined, 'detail')
    expect(fills(flat.ctx)).toHaveLength(0)
    expect(strokes(flat.ctx)).toHaveLength(0)
    const compare = draw(scene, testStyle({ outline: 'compare' }), undefined, 'detail')
    expect(fills(compare.ctx)).toHaveLength(0)
    expect(strokes(compare.ctx).map(([c]) => stateOf(c).strokeStyle)).toEqual(['accent'])
    expect(needsDetail(testStyle(), sceneOf([[{ index: 0, missing: true, text: 'x' }]]))).toBe(true)
  })

  it('draws only when something changed', () => {
    const { renderer, drew } = draw(sceneOf([[{ index: 1, polygon: square(0, 0, 400, 700) }]]), testStyle())
    expect(drew).toBe(true)
    expect(renderer.draw()).toBe(false)
    renderer.setHover(0)
    expect(renderer.draw()).toBe(true)
  })

  it("draws the preview as drawArtboard does in 'artboard' mode, with a scaling outline", () => {
    const layout = { unitsPerPx: 2, x: -100, y: -900, width: 2000, height: 1200 }
    const view = { kind: 'artboard' as const, layout, artboard: { width: 1000, height: 600 }, cssWidth: 500, cssHeight: 300, dpr: 2 }
    const scene = sceneOf([[{ index: 1, polygon: square(0, 0, 400, 700), x: 30 }]], 10)
    const { ctx } = draw(scene, testStyle({ fill: false, scalingStroke: 3 }), undefined, 'artboard', view as never)
    const [[call, i]] = strokes(ctx)
    expect(stateOf(call)).toMatchObject({ lineWidth: 3, lineJoin: 'miter', miterLimit: 4, strokeStyle: 'ink' })
    // drawArtboard: kx·s, −x·kx·s, then translate, skew, flip.
    const kx = 1000 / 1000
    const s = 1 / 2
    const m = ctx.transformBefore(i)
    const skew = Math.tan((-10 * Math.PI) / 180)
    const expected = [kx * s, 0, -skew * kx * s, -kx * s, (30 - layout.x) * kx * s, (0 - layout.y) * kx * s]
    m.forEach((v, k) => expect(v).toBeCloseTo(expected[k], 9))
  })
})
