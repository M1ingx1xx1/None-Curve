// Exports with the canvas's Fill off (NOCUR-64): the SVG (and the PNG, rasterized from that SVG), the video canvas and
// the preview draw the outlines as strokes in the text colour with no fill, OUTLINE_STROKE_PX artboard pixels wide
// with miter joins, still from straight segments only; with Fill on they are what they were.
//
// PINNED was taken on develop at 59b732d, before this change existed, by these same calls with Fill on (the SVG
// export in three looks and slanted; the video canvas's recorded calls). Never edit it: a failure means a change
// reached the filled exports; fix the change, not the hash.

import { createHash } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ExportedArtboard from '../../src/components/ExportedArtboard'
import { drawArtboard, polygonPaths, type DrawTarget, type Painter, type PathSink, type VideoLook } from '../../src/export/drawArtboard'
import { OUTLINE_MITER_LIMIT, OUTLINE_STROKE_PX, outlineStrokeWidth, specimenToSvg, type SvgLook } from '../../src/export/svg'
import { glyphGeometry, paramsKey } from '../../src/geometry/cache'
import { DEFAULT_ARTBOARD, DEFAULT_TYPOGRAPHY, layoutArtboard } from '../../src/specimen/artboard'
import { DEFAULT_TEXT } from '../../src/specimen/samples'
import { placePolygons, shapeSpecimen } from '../../src/specimen/scene'
import { loadFixture } from '../helpers/fonts'
import { BASE } from '../helpers/params'

const PINNED = {
  svg: ['2b0359c92cbc43d9', '7f395a8ceb68c554', 'c443488aa03ef4d8'],
  slanted: '39cbc394bbe13492',
  video: '6aa2f4261fdd43c4',
  videoCalls: 986,
}

const META = { fontName: 'Roboto Regular', subject: 'outline', pipeline: ['Flatten'] }
const LOOKS: SvgLook[] = [
  { ink: '#111111', paper: '#ffffff', background: true, blur: 0 },
  { ink: '#ff0000', paper: '#000000', background: false, blur: 0 },
  { ink: '#111111', paper: '#fafafa', background: true, blur: 2.5 },
]
const VIDEO_LOOK: VideoLook = { ink: '#111111', paper: '#fafafa', blur: 0 }

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

async function robotoScene(slant = 0) {
  const font = await loadFixture('Roboto')
  const key = paramsKey(BASE)
  const { tracking, lineHeight, align } = DEFAULT_TYPOGRAPHY
  const shaped = shapeSpecimen(font, DEFAULT_TEXT, { tracking, lineHeight, align, slant })
  const scene = placePolygons(shaped, (index) => ({ polygon: glyphGeometry(font, index, BASE, key, true).polygon }))
  const layout = layoutArtboard(scene, { ...DEFAULT_TYPOGRAPHY, slant }, DEFAULT_ARTBOARD, font.metrics.unitsPerEm)
  return { scene, layout }
}
type Roboto = Awaited<ReturnType<typeof robotoScene>>

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

/** A 2D context that records every call and every property set, paths as their commands. */
function recordingPainter() {
  const calls: unknown[][] = []
  const props: Record<string, unknown> = {}
  const painter = new Proxy({} as Record<string, unknown>, {
    get(_, name: string) {
      if (name in props) return props[name]
      return (...args: unknown[]) => calls.push([name, ...args.map((a) => (a instanceof FakePath ? a.commands.join('') : a))])
    },
    set(_, name: string, value) {
      calls.push(['set', name, value])
      props[name] = value
      return true
    },
  }) as unknown as Painter<FakePath>
  return { painter, calls }
}

function drawVideo({ scene, layout }: Roboto, look: VideoLook) {
  const { painter, calls } = recordingPainter()
  const target: DrawTarget<FakePath> = { ctx: painter, width: 2400, height: 1600, layer: null, filter: true }
  const result = drawArtboard(target, scene, layout, DEFAULT_ARTBOARD, look, polygonPaths(() => new FakePath()))
  return { calls, result }
}

const groupLine = (svg: string) => svg.split('\n').find((line) => line.startsWith('  <g ') && line.includes('transform='))!
const pathData = (svg: string) => [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => m[1])

describe('exports with Fill on are unchanged', () => {
  it('SVG: byte for byte as on develop, with outlineOnly left out or false', async () => {
    const roboto = await robotoScene()
    for (const outlineOnly of [undefined, false]) {
      const hashes = LOOKS.map((look) => sha(specimenToSvg(roboto.scene, roboto.layout, DEFAULT_ARTBOARD, 2, META, { ...look, outlineOnly }).svg))
      expect(hashes).toEqual(PINNED.svg)
    }
    const slanted = await robotoScene(12)
    expect(sha(specimenToSvg(slanted.scene, slanted.layout, DEFAULT_ARTBOARD, 2, META, LOOKS[0]).svg)).toBe(PINNED.slanted)
  })

  it('video canvas: the same calls as on develop', async () => {
    const roboto = await robotoScene()
    for (const look of [VIDEO_LOOK, { ...VIDEO_LOOK, outlineOnly: false }]) {
      const { calls } = drawVideo(roboto, look)
      expect([sha(JSON.stringify(calls)), calls.length]).toEqual([PINNED.video, PINNED.videoCalls])
    }
  })
})

describe('exports with Fill off draw outlines only', () => {
  it('SVG: the glyph group is stroked in the ink with fill="none", 2 artboard px wide, miter joins; paths M/L/Z only', async () => {
    const roboto = await robotoScene()
    for (const look of LOOKS) {
      const filled = specimenToSvg(roboto.scene, roboto.layout, DEFAULT_ARTBOARD, 2, META, look)
      const outlined = specimenToSvg(roboto.scene, roboto.layout, DEFAULT_ARTBOARD, 2, META, { ...look, outlineOnly: true })
      const group = groupLine(outlined.svg)
      expect(group).toContain('fill="none"')
      expect(group).toContain(`stroke="${look.ink}"`)
      expect(group).toContain(`stroke-linejoin="miter"`)
      expect(group).toContain(`stroke-miterlimit="${OUTLINE_MITER_LIMIT}"`)
      expect(group).not.toContain('fill-rule')
      // In font units on the group, which scales them to artboard pixels: OUTLINE_STROKE_PX artboard pixels, so
      // the PNG multiplier and the video size scale it with the letters.
      const width = Number(group.match(/stroke-width="([^"]+)"/)![1])
      expect(width).toBe(outlineStrokeWidth(roboto.layout.unitsPerPx))
      expect(width / roboto.layout.unitsPerPx).toBeCloseTo(OUTLINE_STROKE_PX, 4)
      // Nothing is filled in the ink: only the background (when painted) has a fill colour.
      expect(outlined.svg).not.toContain(`fill="${look.ink}"`)
      expect([...outlined.svg.matchAll(/fill="([^"]*)"/g)].map((m) => m[1])).toEqual(look.background ? [look.paper, 'none'] : ['none'])

      // The same paths, straight segments only, and the same counts.
      const paths = pathData(outlined.svg)
      expect(paths).toEqual(pathData(filled.svg))
      expect(paths.length).toBe(outlined.paths)
      for (const d of paths) expect(d).toMatch(/^(M[^MLZA-Za-z]+(L[^MLZA-Za-z]+)*Z)+$/)
      expect(outlined.svg).not.toMatch(/ d="[^"]*[CcQqSsTtAaHhVv]/)
      expect([outlined.paths, outlined.vertices]).toEqual([filled.paths, filled.vertices])

      // Only the group line differs, plus one comment saying so.
      const a = filled.svg.split('\n')
      const b = outlined.svg.split('\n')
      expect(b.length).toBe(a.length + 1)
      const comment = b.findIndex((line) => line.startsWith('<!-- Outlines only'))
      expect(comment).toBeGreaterThan(0)
      b.splice(comment, 1)
      const differ = a.flatMap((line, i) => (line === b[i] ? [] : [i]))
      expect(differ).toEqual([a.indexOf(groupLine(filled.svg))])
    }
  })

  it('video canvas: one stroke per glyph in the ink, no glyph fills, the same width and joins as the SVG', async () => {
    const roboto = await robotoScene()
    const filled = drawVideo(roboto, VIDEO_LOOK)
    const outlined = drawVideo(roboto, { ...VIDEO_LOOK, outlineOnly: true })
    expect(outlined.result).toEqual(filled.result)
    const named = (calls: unknown[][], name: string) => calls.filter((c) => c[0] === name)
    expect(named(outlined.calls, 'fill')).toHaveLength(0)
    const strokes = named(outlined.calls, 'stroke')
    expect(strokes.map((c) => c[1])).toEqual(named(filled.calls, 'fill').map((c) => c[1]))
    for (const [, commands] of strokes) expect(commands).toMatch(/^(M[^MLZ]+(L[^MLZ]+)*Z)+$/)

    const sets = named(outlined.calls, 'set').map((c) => [c[1], c[2]])
    // The paper is the only fill.
    expect(sets.filter(([name]) => name === 'fillStyle')).toEqual([['fillStyle', VIDEO_LOOK.paper]])
    expect(sets.filter(([name]) => name !== 'fillStyle' && name !== 'filter')).toEqual([
      ['strokeStyle', VIDEO_LOOK.ink],
      ['lineWidth', outlineStrokeWidth(roboto.layout.unitsPerPx)],
      ['lineJoin', 'miter'],
      ['miterLimit', OUTLINE_MITER_LIMIT],
    ])
    // Set under the group transform (font units), before the first glyph is placed.
    const index = (name: string) => outlined.calls.findIndex((c) => c[0] === 'set' && c[1] === name)
    const groupTransform = outlined.calls.findIndex((c, i) => c[0] === 'setTransform' && i > 0 && (c[1] as number) !== 1)
    expect(index('lineWidth')).toBeGreaterThan(groupTransform)
    expect(index('lineWidth')).toBeLessThan(outlined.calls.findIndex((c) => c[0] === 'translate'))
  })

  it('preview: draws what the SVG export writes, filled or outlines only', async () => {
    const { scene, layout } = await robotoScene()
    const render = (outlineOnly: boolean) =>
      renderToStaticMarkup(
        createElement(ExportedArtboard, {
          scene,
          layout,
          width: DEFAULT_ARTBOARD.width,
          height: DEFAULT_ARTBOARD.height,
          precision: 2,
          ink: '#111111',
          paper: '#ffffff',
          transparent: false,
          pixelsPerArtboardPixel: 0.5,
          blur: 0,
          outlineOnly,
          label: 'Preview',
        }),
      )
    const filled = render(false)
    const outlined = render(true)
    expect(filled).toContain('<g transform="scale(')
    expect(filled).toMatch(/<g transform="[^"]+" fill="#111111" fill-rule="nonzero">/)
    const width = outlineStrokeWidth(layout.unitsPerPx)
    expect(outlined).toMatch(
      new RegExp(`<g transform="[^"]+" fill="none" stroke="#111111" stroke-width="${width}" stroke-linejoin="miter" stroke-miterlimit="${OUTLINE_MITER_LIMIT}">`),
    )
    expect(pathData(outlined)).toEqual(pathData(filled))
  })
})
