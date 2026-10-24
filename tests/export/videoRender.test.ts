// The offline video (NOCUR-91, src/export/videoRender.ts): the time range, the frames read from the plan at their
// media times (commits shown from their own time, glided with Glide's time and keyframes), waiting for the plan, a
// cancel, and the scenes built from planned commits as the canvas builds them, on Roboto.

import { describe, expect, it } from 'vitest'
import { paramsKey } from '../../src/geometry/paramsKey'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { GeometryParams, PolygonGlyph } from '../../src/geometry/types'
import {
  clampRange,
  frameCount,
  RENDER_LIMITS,
  renderFrames,
  sceneBuilder,
  type BuiltFrame,
  type PlanReader,
} from '../../src/export/videoRender'
import { keyframesBetween } from '../../src/sound/keyframes'
import type { PlannedCommit } from '../../src/sound/timelineTypes'
import { DEFAULT_ARTBOARD, DEFAULT_PALETTE, DEFAULT_TYPOGRAPHY } from '../../src/specimen/artboard'
import type { SpecimenScene } from '../../src/specimen/scene'
import { loadFixture } from '../helpers/fonts'
import { BASE } from '../helpers/params'

describe('the time range', () => {
  it('keeps both ends in the file, at least the shortest stretch and at most the longest apart', () => {
    expect(clampRange({ startMs: 2000, endMs: 5000 }, 10_000)).toEqual({ startMs: 2000, endMs: 5000 })
    expect(clampRange({ startMs: -5, endMs: 99_999 }, 10_000)).toEqual({ startMs: 0, endMs: 10_000 })
    // End before start: the shortest stretch from the start.
    expect(clampRange({ startMs: 4000, endMs: 1000 }, 10_000)).toEqual({
      startMs: 4000,
      endMs: 4000 + RENDER_LIMITS.minMs,
    })
    // Start at the very end: moved back so the stretch fits.
    expect(clampRange({ startMs: 10_000, endMs: 10_000 }, 10_000)).toEqual({
      startMs: 10_000 - RENDER_LIMITS.minMs,
      endMs: 10_000,
    })
    expect(clampRange({ startMs: 0, endMs: Infinity }, 3_600_000)).toEqual({ startMs: 0, endMs: RENDER_LIMITS.maxMs })
    expect(clampRange({ startMs: Number.NaN, endMs: Number.NaN }, 1000)).toEqual({ startMs: 0, endMs: 1000 })
    expect(clampRange({ startMs: 0, endMs: 50 }, 50)).toBeNull()
    expect(frameCount({ startMs: 1000, endMs: 3000 }, 30)).toBe(60)
    expect(frameCount({ startMs: 0, endMs: 1 }, 30)).toBe(1)
  })
})

/** A commit at `mediaMs` with seq `seq` (its inner commit is never read by the fake builder). */
const commitAt = (seq: number, mediaMs: number): PlannedCommit =>
  ({
    generation: 1,
    seq,
    mediaMs,
    commit: null,
    jobs: [],
    keys: [],
    indices: new Int32Array(0),
  }) as unknown as PlannedCommit

/** A scene of one glyph whose outline is a square `size` wide (distinct per commit). */
function squareScene(size: number): SpecimenScene {
  const polygon = {
    ref: { index: 1, unicode: null, name: null },
    metrics: { unitsPerEm: 1000 },
    contours: [
      {
        clockwise: false,
        points: [
          { x: 0, y: 0 },
          { x: size, y: 0 },
          { x: size, y: size },
          { x: 0, y: size },
        ],
      },
    ],
  } as unknown as PolygonGlyph
  return {
    lines: [{ glyphs: [{ index: 1, x: 0, y: 0, polygon, ink: null }], baseline: 0, ink: null }],
    slant: 0,
    pendingGlyphs: 0,
    failedGlyphs: 0,
  } as unknown as SpecimenScene
}

function fakes(commits: PlannedCommit[], waits: string[] = []) {
  const scenes = new Map<number, SpecimenScene>()
  const built: number[] = []
  const drawn: { scene: SpecimenScene; at?: number }[] = []
  const added: [number, number][] = []
  const plan: PlanReader = {
    planUntil: () => (waits.length ? (waits.shift() as 'more' | 'waiting') : 'ready'),
    range: (fromMs, toMs) => {
      let first = 0
      commits.forEach((c, i) => {
        if (c.mediaMs <= fromMs) first = i
      })
      return commits.slice(first).filter((c) => c.mediaMs <= toMs)
    },
  }
  const build = async (commit: PlannedCommit | null): Promise<BuiltFrame> => {
    const seq = commit?.seq ?? 0
    built.push(seq)
    let scene = scenes.get(seq)
    if (!scene) scenes.set(seq, (scene = squareScene(100 + seq * 100)))
    return { scene, layout: {} as BuiltFrame['layout'], palette: DEFAULT_PALETTE, keyframes: null }
  }
  const sink = {
    draw: (scene: SpecimenScene) => drawn.push({ scene }),
    add: async (t: number, d: number) => {
      added.push([t, d])
    },
  }
  return { plan, build, sink, scenes, built, drawn, added }
}

describe('rendering the frames', () => {
  it('shows at each frame the newest commit at or before its time, from the start of the range', async () => {
    const f = fakes([commitAt(1, 0), commitAt(2, 450), commitAt(3, 1020), commitAt(4, 1900)])
    await renderFrames({ ...f, range: { startMs: 300, endMs: 1500 }, fps: 10, glideMs: 0, wait: async () => {} })
    expect(f.added).toHaveLength(12)
    expect(f.added[0]).toEqual([0, 0.1])
    expect(f.added[11][0]).toBeCloseTo(1.1, 12)
    // 300, 400: commit 1; 500…1000: commit 2; 1100…1400: commit 3. Commit 4 is past the range.
    const seqOf = (scene: SpecimenScene) => [...f.scenes].find(([, s]) => s === scene)![0]
    expect(f.drawn.map(({ scene }) => seqOf(scene))).toEqual([1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3])
    expect(f.built).toEqual([1, 2, 3])
  })

  it('glides into each commit from its media time with Glide on', async () => {
    const f = fakes([commitAt(1, 0), commitAt(2, 1000)])
    await renderFrames({ ...f, range: { startMs: 0, endMs: 1600 }, fps: 10, glideMs: 500, wait: async () => {} })
    const sizes = f.drawn.map(({ scene }) =>
      Math.max(...scene.lines[0].glyphs[0].polygon!.contours[0].points.map((p) => p.x)),
    )
    // Commit 1 (200 wide) until 1000, then on its way to commit 2 (300 wide) until 1500, eased out.
    expect(sizes.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(sizes[10]).toBe(200)
    for (let i = 11; i < 15; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1])
      expect(sizes[i]).toBeLessThan(300)
    }
    expect(f.drawn[15].scene).toBe(f.scenes.get(2))
  })

  it('waits for the plan: at once when its slice ran out, a while when features are not measured yet', async () => {
    const f = fakes([commitAt(1, 0)], ['more', 'waiting', 'more'])
    const waited: number[] = []
    await renderFrames({
      ...f,
      range: { startMs: 0, endMs: 200 },
      fps: 10,
      glideMs: 0,
      wait: async (ms) => {
        waited.push(ms)
      },
    })
    expect(waited).toEqual([0, RENDER_LIMITS.waitMs, 0])
    expect(f.added).toHaveLength(2)
  })

  it('stops at a cancel, with the signal’s reason', async () => {
    const f = fakes([commitAt(1, 0)])
    const controller = new AbortController()
    const run = renderFrames({
      ...f,
      range: { startMs: 0, endMs: 10_000 },
      fps: 30,
      glideMs: 0,
      signal: controller.signal,
      wait: async () => {},
      onProgress: (done) => {
        if (done > 0.1) controller.abort(new Error('cancelled'))
      },
    })
    await expect(run).rejects.toThrow('cancelled')
    expect(f.added.length).toBeLessThan(40)
  })
})

describe('building planned commits into scenes', async () => {
  const font = await loadFixture('Roboto')
  const ensure = async (_font: unknown, params: GeometryParams) => {
    const cache = new Map<number, PolygonGlyph>()
    return (index: number) => {
      let polygon = cache.get(index)
      if (!polygon) cache.set(index, (polygon = deriveGeometry(font.getGlyph(index), params).polygon))
      return { polygon }
    }
  }
  const setup = {
    font,
    text: 'Hi',
    typography: DEFAULT_TYPOGRAPHY,
    palette: DEFAULT_PALETTE,
    artboard: DEFAULT_ARTBOARD,
    base: BASE,
    baseKey: paramsKey(BASE),
  }
  const whorl: GeometryParams = {
    ...BASE,
    experimental: { ...BASE.experimental, whorl: { ...BASE.experimental.whorl, enabled: true, amount: 1.2 } },
  }

  it('builds the sliders’ own letters, a driven commit placed by them, and its keyframes', async () => {
    const build = sceneBuilder(setup, ensure)
    const own = await build(null)
    expect(own.scene.pendingGlyphs).toBe(0)
    expect(own.keyframes).toBeNull()
    expect(own.palette).toBe(DEFAULT_PALETTE)
    const keyframes = keyframesBetween(BASE, whorl)!
    const driven = {
      ...commitAt(5, 100),
      commit: { params: whorl, letters: null, look: { palette: { ink: '#ff0000' } }, keyframes },
    } as unknown as PlannedCommit
    const frame = await build(driven)
    const glyphs = (scene: SpecimenScene) => scene.lines.flatMap((line) => line.glyphs)
    expect(glyphs(frame.scene).map((g) => g.polygon)).not.toEqual(glyphs(own.scene).map((g) => g.polygon))
    // The block stays where the sliders' own letters put it.
    expect(frame.layout).toEqual(own.layout)
    expect(frame.palette.ink).toBe('#ff0000')
    expect(frame.keyframes).toHaveLength(2)
    for (const scene of frame.keyframes!) expect(scene.pendingGlyphs).toBe(0)
  })
})
