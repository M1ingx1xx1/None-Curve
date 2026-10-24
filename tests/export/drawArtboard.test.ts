// The video's canvas drawing (src/export/drawArtboard.ts) with a painter that records its calls: the paper first,
// always; the same group transform and glyph positions as the SVG export (specimenPaths) on Roboto's default
// text; a skew only with slant; one nonzero fill per occurrence; the blur through a layer, scaled with the canvas;
// no blur where the canvas cannot; the polygon paths built once, from straight segments only.

import { describe, expect, it } from 'vitest'
import {
  canvasFilterWorks,
  drawArtboard,
  polygonPaths,
  touchCanvas,
  type DrawTarget,
  type Painter,
  type PathSink,
  type Touchable,
} from '../../src/export/drawArtboard'
import { specimenPaths } from '../../src/export/svg'
import { glyphGeometry } from '../../src/geometry/cache'
import { paramsKey } from '../../src/geometry/paramsKey'
import type { PolygonGlyph } from '../../src/geometry/types'
import { DEFAULT_ARTBOARD, DEFAULT_TYPOGRAPHY, layoutArtboard, type ArtboardLayout } from '../../src/specimen/artboard'
import { DEFAULT_TEXT } from '../../src/specimen/samples'
import { placePolygons, shapeSpecimen, type SpecimenScene } from '../../src/specimen/scene'
import { loadFixture } from '../helpers/fonts'
import { BASE } from '../helpers/params'

/** A path that records its commands. */
class FakePath implements PathSink {
  commands: string[] = []
  moveTo(x: number, y: number) {
    this.commands.push(`M${x} ${y}`)
  }
  lineTo(x: number, y: number) {
    this.commands.push(`L${x} ${y}`)
  }
  closePath() {
    this.commands.push('Z')
  }
}

type Call = [string, ...unknown[]]

/** A 2D context that records every call and every fillStyle and filter set; `filters` false ignores filters. */
class FakePainter implements Painter<FakePath> {
  calls: Call[] = []
  private fill_: unknown = '#000000'
  private filter_ = 'none'
  constructor(private readonly filters = true) {}
  get fillStyle() {
    return this.fill_
  }
  set fillStyle(value: unknown) {
    this.calls.push(['fillStyle', value])
    this.fill_ = value
  }
  private stroke_: unknown = '#000000'
  private lineWidth_ = 1
  private lineJoin_ = 'miter'
  private miterLimit_ = 10
  get strokeStyle() {
    return this.stroke_
  }
  set strokeStyle(value: unknown) {
    this.calls.push(['strokeStyle', value])
    this.stroke_ = value
  }
  get lineWidth() {
    return this.lineWidth_
  }
  set lineWidth(value: number) {
    this.calls.push(['lineWidth', value])
    this.lineWidth_ = value
  }
  get lineJoin() {
    return this.lineJoin_
  }
  set lineJoin(value: string) {
    this.calls.push(['lineJoin', value])
    this.lineJoin_ = value
  }
  get miterLimit() {
    return this.miterLimit_
  }
  set miterLimit(value: number) {
    this.calls.push(['miterLimit', value])
    this.miterLimit_ = value
  }
  get filter() {
    return this.filter_
  }
  set filter(value: string) {
    this.calls.push(['filter', value])
    if (this.filters) this.filter_ = value
  }
  setTransform(...m: number[]) {
    this.calls.push(['setTransform', ...m])
  }
  transform(...m: number[]) {
    this.calls.push(['transform', ...m])
  }
  translate(x: number, y: number) {
    this.calls.push(['translate', x, y])
  }
  scale(x: number, y: number) {
    this.calls.push(['scale', x, y])
  }
  save() {
    this.calls.push(['save'])
  }
  restore() {
    this.calls.push(['restore'])
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(['fillRect', x, y, w, h])
  }
  clearRect(x: number, y: number, w: number, h: number) {
    this.calls.push(['clearRect', x, y, w, h])
  }
  fill(path: FakePath, rule: 'nonzero') {
    this.calls.push(['fill', path, rule])
  }
  stroke(path: FakePath) {
    this.calls.push(['stroke', path])
  }
  drawImage(image: unknown, x: number, y: number) {
    this.calls.push(['drawImage', image, x, y])
  }
  named(name: string): Call[] {
    return this.calls.filter((c) => c[0] === name)
  }
}

const LOOK = { ink: '#111111', paper: '#fafafa', blur: 0 }
const ARTBOARD = { width: 1200, height: 800 }
const LAYOUT: ArtboardLayout = { unitsPerPx: 2, x: -100, y: -300, width: 2400, height: 1600 }

function square(size = 100): PolygonGlyph {
  const points = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ]
  return { contours: [{ points, clockwise: false }] } as unknown as PolygonGlyph
}

/** A scene of one line with these glyphs (only the fields drawing reads). */
function sceneOf(
  glyphs: { index: number; x: number; y: number; polygon: PolygonGlyph | null }[],
  slant = 0,
): SpecimenScene {
  return { lines: [{ glyphs }], slant } as unknown as SpecimenScene
}

function target(width: number, height: number, options: { layer?: boolean; filter?: boolean } = {}) {
  const ctx = new FakePainter(options.filter !== false)
  const layerCtx = new FakePainter(options.filter !== false)
  const image = { layer: true }
  const t: DrawTarget<FakePath> = {
    ctx,
    width,
    height,
    layer: options.layer ? { ctx: layerCtx, image } : null,
    filter: options.filter !== false,
  }
  return { t, ctx, layerCtx, image }
}

const numbers = (text: string) => (text.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)

describe('drawArtboard', () => {
  it('paints the paper first, always, over the whole canvas', () => {
    const { t, ctx } = target(2400, 1600)
    drawArtboard(
      t,
      sceneOf([{ index: 1, x: 0, y: 0, polygon: square() }]),
      LAYOUT,
      ARTBOARD,
      LOOK,
      polygonPaths(() => new FakePath()),
    )
    const firstFill = ctx.calls.findIndex((c) => c[0] === 'fill')
    const paper = ctx.calls.findIndex((c) => c[0] === 'fillRect')
    expect(paper).toBeGreaterThan(-1)
    expect(paper).toBeLessThan(firstFill)
    expect(ctx.calls[0]).toEqual(['setTransform', 1, 0, 0, 1, 0, 0])
    expect(ctx.calls[paper]).toEqual(['fillRect', 0, 0, 2400, 1600])
    // The fill style at the paper is the paper colour.
    const styles = ctx.calls.slice(0, paper).filter((c) => c[0] === 'fillStyle')
    expect(styles.at(-1)).toEqual(['fillStyle', LOOK.paper])
    // An empty scene still gets its paper.
    const empty = target(100, 100)
    expect(
      drawArtboard(
        empty.t,
        sceneOf([]),
        LAYOUT,
        ARTBOARD,
        LOOK,
        polygonPaths(() => new FakePath()),
      ),
    ).toEqual({ glyphs: 0, blurred: false })
    expect(empty.ctx.named('fillRect')).toEqual([['fillRect', 0, 0, 100, 100]])
  })

  it('places the glyphs exactly as the SVG export does, on Roboto’s default text', async () => {
    const font = await loadFixture('Roboto')
    const key = paramsKey(BASE)
    const { tracking, lineHeight, align, slant } = DEFAULT_TYPOGRAPHY
    const shaped = shapeSpecimen(font, DEFAULT_TEXT, { tracking, lineHeight, align, slant })
    const scene = placePolygons(shaped, (index) => ({ polygon: glyphGeometry(font, index, BASE, key, true).polygon }))
    const layout = layoutArtboard(scene, DEFAULT_TYPOGRAPHY, DEFAULT_ARTBOARD, font.metrics.unitsPerEm)
    const svg = specimenPaths(scene, layout, 6)
    expect(svg.paths.length).toBeGreaterThan(150)

    // Stretched to twice the artboard, and to a canvas of another shape.
    for (const [kx, ky] of [
      [2, 2],
      [1, 1.5],
    ]) {
      const { t, ctx } = target(DEFAULT_ARTBOARD.width * kx, DEFAULT_ARTBOARD.height * ky)
      const paths = polygonPaths(() => new FakePath())
      const result = drawArtboard(t, scene, layout, DEFAULT_ARTBOARD, LOOK, paths)
      expect(result).toEqual({ glyphs: svg.paths.length, blurred: false })

      // The group: `scale(S) translate(X Y)` in artboard pixels, times the canvas stretch.
      const [S, X, Y] = numbers(svg.transform)
      const group = ctx.named('setTransform')[1].slice(1) as number[]
      const expected = [kx * S, 0, 0, ky * S, kx * S * X, ky * S * Y]
      group.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 4))

      // Each glyph: `translate(x y) scale(1 -1)`, in order, one fill per occurrence.
      const translates = ctx.named('translate')
      const fills = ctx.named('fill')
      expect(translates).toHaveLength(svg.paths.length)
      expect(fills).toHaveLength(svg.paths.length)
      svg.paths.forEach((path, i) => {
        const [x, y] = numbers(path.transform)
        expect(Math.abs((translates[i][1] as number) - x)).toBeLessThan(1e-4)
        expect(Math.abs((translates[i][2] as number) - y)).toBeLessThan(1e-4)
        expect(fills[i][2]).toBe('nonzero')
      })
      expect(ctx.named('scale')).toHaveLength(svg.paths.length)
      for (const call of ctx.named('scale')) expect(call).toEqual(['scale', 1, -1])
      expect(ctx.named('transform')).toHaveLength(0)
      expect(ctx.named('save')).toHaveLength(ctx.named('restore').length)

      // Straight segments only.
      for (const call of fills)
        for (const command of (call[1] as FakePath).commands) expect(command).toMatch(/^([ML]-?[\d.e-]+ -?[\d.e-]+|Z)$/)
    }
  })

  it('skews each glyph only when the text is slanted', () => {
    const glyphs = [
      { index: 1, x: 10, y: 20, polygon: square() },
      { index: 2, x: 200, y: 20, polygon: square() },
    ]
    const plain = target(1200, 800)
    drawArtboard(
      plain.t,
      sceneOf(glyphs, 0),
      LAYOUT,
      ARTBOARD,
      LOOK,
      polygonPaths(() => new FakePath()),
    )
    expect(plain.ctx.named('transform')).toHaveLength(0)

    const slanted = target(1200, 800)
    drawArtboard(
      slanted.t,
      sceneOf(glyphs, 12),
      LAYOUT,
      ARTBOARD,
      LOOK,
      polygonPaths(() => new FakePath()),
    )
    const skews = slanted.ctx.named('transform')
    expect(skews).toHaveLength(2)
    for (const skew of skews) {
      const [a, b, c, d, e, f] = skew.slice(1) as number[]
      expect([a, b, d, e, f]).toEqual([1, 0, 1, 0, 0])
      // SVG `skewX(-12)`.
      expect(c).toBeCloseTo(Math.tan((-12 * Math.PI) / 180), 12)
    }
    // In SVG order: translate, skew, flip, fill.
    const order = slanted.ctx.calls
      .map((c) => c[0])
      .filter((name) => ['translate', 'transform', 'scale', 'fill'].includes(name))
    expect(order).toEqual(['translate', 'transform', 'scale', 'fill', 'translate', 'transform', 'scale', 'fill'])
  })

  it('fills every occurrence, repeats with their own polygons, and leaves out glyphs without outlines', () => {
    const a = square(100)
    const b = square(50)
    const glyphs = [
      { index: 7, x: 0, y: 0, polygon: a },
      { index: 7, x: 100, y: 0, polygon: b },
      { index: 7, x: 200, y: 0, polygon: a },
      { index: 3, x: 300, y: 0, polygon: null },
      { index: 4, x: 400, y: 0, polygon: { contours: [] } as unknown as PolygonGlyph },
    ]
    const { t, ctx } = target(1200, 800)
    const paths = polygonPaths(() => new FakePath())
    expect(drawArtboard(t, sceneOf(glyphs), LAYOUT, ARTBOARD, LOOK, paths).glyphs).toBe(3)
    const filled = ctx.named('fill').map((c) => c[1])
    expect(filled).toEqual([paths(a), paths(b), paths(a)])
    expect(filled[0]).not.toBe(filled[1])
    expect(filled[0]).toBe(filled[2])
    for (const call of ctx.named('fill')) expect(call[2]).toBe('nonzero')
  })

  it('blurs the glyphs as one layer, by the blur times the canvas stretch', () => {
    const look = { ...LOOK, blur: 3 }
    const { t, ctx, layerCtx, image } = target(2400, 1200, { layer: true })
    const result = drawArtboard(
      t,
      sceneOf([{ index: 1, x: 0, y: 0, polygon: square() }]),
      LAYOUT,
      ARTBOARD,
      look,
      polygonPaths(() => new FakePath()),
    )
    expect(result).toEqual({ glyphs: 1, blurred: true })
    // The glyphs go to the cleared layer, in the ink.
    expect(layerCtx.calls.slice(0, 3)).toEqual([
      ['setTransform', 1, 0, 0, 1, 0, 0],
      ['filter', 'none'],
      ['clearRect', 0, 0, 2400, 1200],
    ])
    expect(layerCtx.named('fill')).toHaveLength(1)
    expect(layerCtx.named('fillStyle')).toEqual([['fillStyle', LOOK.ink]])
    expect(ctx.named('fill')).toHaveLength(0)
    // The canvas: paper, then the layer through the blur (kx 2, ky 1.5 → 3 × 1.75), then no filter.
    const tail = ctx.calls.slice(ctx.calls.findIndex((c) => c[0] === 'fillRect') + 1)
    expect(tail).toEqual([
      ['setTransform', 1, 0, 0, 1, 0, 0],
      ['filter', 'blur(5.25px)'],
      ['drawImage', image, 0, 0],
      ['filter', 'none'],
    ])
  })

  it('draws without blur where the canvas cannot blur, or has no layer', () => {
    const look = { ...LOOK, blur: 3 }
    const scene = sceneOf([{ index: 1, x: 0, y: 0, polygon: square() }])
    const noFilter = target(1200, 800, { layer: true, filter: false })
    expect(
      drawArtboard(
        noFilter.t,
        scene,
        LAYOUT,
        ARTBOARD,
        look,
        polygonPaths(() => new FakePath()),
      ),
    ).toEqual({ glyphs: 1, blurred: false })
    expect(noFilter.ctx.named('fill')).toHaveLength(1)
    expect(noFilter.layerCtx.calls).toEqual([])
    // `filter` is never set where it does not work.
    expect(noFilter.ctx.named('filter')).toEqual([])

    const noLayer = target(1200, 800)
    expect(
      drawArtboard(
        noLayer.t,
        scene,
        LAYOUT,
        ARTBOARD,
        look,
        polygonPaths(() => new FakePath()),
      ),
    ).toEqual({ glyphs: 1, blurred: false })
    expect(noLayer.ctx.named('drawImage')).toEqual([])

    const unblurred = target(1200, 800, { layer: true })
    expect(
      drawArtboard(
        unblurred.t,
        scene,
        LAYOUT,
        ARTBOARD,
        LOOK,
        polygonPaths(() => new FakePath()),
      ).blurred,
    ).toBe(false)
    expect(unblurred.layerCtx.calls).toEqual([])
  })
})

describe('polygonPaths', () => {
  it('builds each polygon’s path once, from straight segments, every contour closed', () => {
    let created = 0
    const paths = polygonPaths(() => {
      created++
      return new FakePath()
    })
    const polygon = {
      contours: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          clockwise: false,
        },
        { points: [], clockwise: true },
        {
          points: [
            { x: 2, y: 2 },
            { x: 4, y: 2 },
            { x: 3, y: 4 },
          ],
          clockwise: true,
        },
      ],
    } as unknown as PolygonGlyph
    const path = paths(polygon)
    expect(path.commands).toEqual(['M0 0', 'L10 0', 'L10 10', 'Z', 'M2 2', 'L4 2', 'L3 4', 'Z'])
    expect(paths(polygon)).toBe(path)

    // Drawing twice reuses the cache.
    const scene = sceneOf([
      { index: 1, x: 0, y: 0, polygon },
      { index: 1, x: 50, y: 0, polygon },
    ])
    drawArtboard(target(100, 100).t, scene, LAYOUT, ARTBOARD, LOOK, paths)
    drawArtboard(target(100, 100).t, scene, LAYOUT, ARTBOARD, LOOK, paths)
    expect(created).toBe(1)
  })
})

describe('canvasFilterWorks', () => {
  it('reads a blur back, and leaves the filter as it was', () => {
    const ctx = { filter: 'none' }
    expect(canvasFilterWorks(ctx)).toBe(true)
    expect(ctx.filter).toBe('none')
  })

  it('is false without a filter, or with one that ignores what is set', () => {
    expect(canvasFilterWorks({})).toBe(false)
    expect(canvasFilterWorks({ filter: undefined })).toBe(false)
    const ignoring = {
      get filter() {
        return 'none'
      },
      set filter(_: string) {},
    }
    expect(canvasFilterWorks(ignoring)).toBe(false)
  })
})

describe('touchCanvas', () => {
  it('copies the top-left pixel onto itself, clipped to that pixel so the rest of the canvas is kept', () => {
    const calls: string[] = []
    const ctx: Touchable = {
      canvas: 'canvas',
      setTransform: (...a: number[]) => calls.push(`setTransform ${a.join(',')}`),
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('beginPath'),
      rect: (...a: number[]) => calls.push(`rect ${a.join(',')}`),
      clip: () => calls.push('clip'),
      drawImage: (image: unknown, ...a: number[]) =>
        calls.push(`drawImage ${String(image)} ${a.join(',')} ${ctx.globalCompositeOperation}`),
      globalAlpha: 0.5,
      globalCompositeOperation: 'source-over',
      filter: 'blur(2px)',
    }
    touchCanvas(ctx)
    // 'copy' is unbounded: without the clip it clears everything outside the copied pixel.
    expect(calls).toEqual([
      'save',
      'setTransform 1,0,0,1,0,0',
      'beginPath',
      'rect 0,0,1,1',
      'clip',
      'drawImage canvas 0,0,1,1,0,0,1,1 copy',
      'restore',
    ])
  })
})
