// The view helpers both canvas renderers share (src/render/view.ts): the backing store, the base transforms, the
// culling SpecimenView does, and the hit options.

import { describe, expect, it } from 'vitest'
import { apply } from '../../src/render/strokes'
import type { CanvasView, RenderStyle } from '../../src/render/types'
import {
  artboardMatrix,
  canvasCull,
  canvasMatrix,
  hitOptions,
  NO_CULL,
  scenePoint,
  sizeBackingStore,
} from '../../src/render/view'
import type { PlacedGlyph } from '../../src/specimen/scene'

const view: CanvasView = { kind: 'canvas', left: -100, top: 200, u: 2, cssWidth: 300, cssHeight: 150, dpr: 2 }
const metrics = { unitsPerEm: 1000, ascender: 800, descender: -200 }

const glyph = (x: number, advance: number, ink: PlacedGlyph['ink']): PlacedGlyph => ({
  index: 1,
  text: 'a',
  x,
  y: 0,
  advance,
  missing: false,
  polygon: null,
  error: null,
  ink,
})

describe('the backing store', () => {
  it('is the CSS size times the DPR, at least 1 × 1, and left alone when it is right', () => {
    const canvas = { width: 0, height: 0 }
    sizeBackingStore(canvas, view)
    expect(canvas).toEqual({ width: 600, height: 300 })
    sizeBackingStore(canvas, { ...view, cssWidth: 0.1, cssHeight: 0 })
    expect(canvas).toEqual({ width: 1, height: 1 })
    let writes = 0
    const watched = {
      get width() {
        return 600
      },
      set width(_: number) {
        writes++
      },
      height: 300,
    }
    sizeBackingStore(watched, view)
    expect(writes).toBe(0)
  })
})

describe('the base transforms', () => {
  it('put the view’s top-left at device pixel 0, 0 and scale by DPR / u, after the Free drag', () => {
    const m = canvasMatrix(view, 0, 0)
    expect(apply(m, view.left, -view.top)).toEqual([0, 0])
    expect(apply(m, view.left + view.cssWidth * view.u, -view.top + view.cssHeight * view.u)).toEqual([600, 300])
    const moved = canvasMatrix(view, 10, -4)
    expect(apply(moved, view.left - 10, -view.top + 4)).toEqual([0, 0])
  })

  it('stretch the artboard over the canvas', () => {
    const m = artboardMatrix(400, 200, { width: 200, height: 100 }, { x: 50, y: -30, unitsPerPx: 5 })
    expect(apply(m, 50, -30)).toEqual([0, 0])
    expect(apply(m, 50 + 200 * 5, -30 + 100 * 5)).toEqual([400, 200])
  })
})

describe('culling', () => {
  const cull = canvasCull(view, metrics)

  it('takes a line whose band, widened by an em, crosses the view', () => {
    // The view spans scene y −200 to 100.
    expect(cull.band(0)).toBe(true)
    expect(cull.band(-200 - 200 - 1000)).toBe(true)
    expect(cull.band(-200 - 200 - 1000 - 1)).toBe(false)
    expect(cull.band(100 + 800 + 1000)).toBe(true)
    expect(cull.band(100 + 800 + 1000 + 1)).toBe(false)
  })

  it('takes a glyph near by its advance on a band in view, or by its ink alone', () => {
    // The view spans scene x −100 to 500.
    expect(cull.glyph(glyph(500 + 1000, 10, null), true)).toBe(true)
    expect(cull.glyph(glyph(500 + 1001, 10, null), true)).toBe(false)
    expect(cull.glyph(glyph(-100 - 1000 - 10, 10, null), true)).toBe(true)
    expect(cull.glyph(glyph(0, 10, null), false)).toBe(false)
    expect(cull.glyph(glyph(5000, 10, { minX: 400, minY: 0, maxX: 6000, maxY: 50 }), false)).toBe(true)
    expect(cull.ink(null)).toBe(false)
    expect(NO_CULL.glyph(glyph(1e9, 1, null), false)).toBe(true)
  })
})

describe('hit options', () => {
  it('carry the style, the view’s u and the drag, never the block', () => {
    const style = {
      outline: 'compare',
      fill: false,
      showSkeleton: true,
      showVertices: true,
      showMarkers: true,
      markerRadius: 7,
      ...metrics,
    } as RenderStyle
    const source = () => null
    expect(hitOptions(view, style, 3, 4, source)).toEqual({
      outline: 'compare',
      fill: false,
      showSkeleton: true,
      showVertices: true,
      showMarkers: true,
      markerRadius: 7,
      u: 2,
      ascender: 800,
      descender: -200,
      freeMove: false,
      offsetX: 3,
      offsetY: 4,
      source,
    })
    expect(scenePoint(view, 10, 20)).toEqual([-80, -160])
  })
})
