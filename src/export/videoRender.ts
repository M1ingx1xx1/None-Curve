// Offline video (NOCUR-91): a stretch of the audio file rendered frame by frame from the precomputed plan, faster than
// real time and the same every time, instead of capturing the canvas while it plays. Each video frame at media time t
// shows what playback would show when t is heard: the planned commits up to t (planner.ts, the same plan the director
// plays) built into scenes the way the canvas builds them (useDerivedGeometry: Sound's typography and axes, the
// letters' levels, the text block placed by the sliders' own letters), glided into at their media times with Glide's
// time and keyframes (specimen/glide.ts, on the video's own clock), and drawn as the recording canvas draws them
// (drawArtboard). The encoder and the canvas come in as a FrameSink (videoEncode.ts in the page), the plan and the
// geometry as functions, so tests run it with fakes.

import { paramsKey } from '../geometry/paramsKey'
import type { GeometryParams } from '../geometry/types'
import type { LoadedFont } from '../font/model'
import { letterSlots, lettersOn, levelKeyAt, setsSlots, type LetterFrame } from '../sound/letters'
import type { PlannedCommit } from '../sound/timelineTypes'
import {
  layoutArtboard,
  placementScene,
  type ArtboardLayout,
  type ArtboardParams,
  type PaletteParams,
  type TypographyParams,
} from '../specimen/artboard'
import { SceneGlide } from '../specimen/glide'
import {
  placePolygons,
  shapeSpecimen,
  type PolygonLookup,
  type ShapedSpecimen,
  type SpecimenScene,
} from '../specimen/scene'
import { VIDEO_LIMITS } from './videoFormat'

export const RENDER_LIMITS = {
  /** The shortest stretch rendered (ms). */
  minMs: 100,
  /** The longest (ms): as long as a live take may run. */
  maxMs: VIDEO_LIMITS.maxMs,
  /** While the plan waits for features not measured yet, it looks again after this long (ms). */
  waitMs: 40,
  /** Page time (ms) the plan may take in one go before the renderer lets the page breathe. */
  planSliceMs: 30,
} as const

/** A stretch of the file in media ms, start before end. */
export interface RenderRange {
  startMs: number
  endMs: number
}

/**
 * `range` within a file `durationMs` long: both ends inside it, at least RENDER_LIMITS.minMs and at most
 * RENDER_LIMITS.maxMs apart (the end moves); null when the file is shorter than the shortest stretch.
 */
export function clampRange(range: RenderRange, durationMs: number): RenderRange | null {
  if (!(durationMs >= RENDER_LIMITS.minMs)) return null
  const finite = (ms: number, fallback: number) => (Number.isFinite(ms) ? ms : fallback)
  const startMs = Math.min(Math.max(0, finite(range.startMs, 0)), durationMs - RENDER_LIMITS.minMs)
  const endMs = Math.min(
    durationMs,
    startMs + RENDER_LIMITS.maxMs,
    Math.max(startMs + RENDER_LIMITS.minMs, finite(range.endMs, durationMs)),
  )
  return { startMs, endMs }
}

/** The number of video frames for `range` at `fps`: one per frame time from its start, at least one. */
export function frameCount(range: RenderRange, fps: number): number {
  return Math.max(1, Math.round(((range.endMs - range.startMs) * fps) / 1000))
}

/** The plan the frames are read from (a PlaybackPlanner of its own, on the file's feature timeline). */
export interface PlanReader {
  /**
   * Plans up to media ms `ms` within a slice of page time: 'ready' once planned that far, 'more' when the slice ran out
   * first, 'waiting' while features there are not measured yet.
   */
  planUntil(ms: number): 'ready' | 'more' | 'waiting'
  /** The commits with media time up to `toMs`, from the one on screen at `fromMs`, in media order. */
  range(fromMs: number, toMs: number): readonly PlannedCommit[]
}

/** One commit built for the video: its scene, where the block sits, the colours, and the scenes on the way. */
export interface BuiltFrame {
  scene: SpecimenScene
  layout: ArtboardLayout
  palette: PaletteParams
  keyframes: readonly SpecimenScene[] | null
}

/** Where the frames go: draws one, then adds it to the video at `timestampS` for `durationS`. */
export interface FrameSink {
  draw(scene: SpecimenScene, layout: ArtboardLayout, palette: PaletteParams): void
  add(timestampS: number, durationS: number): Promise<void>
}

export interface RenderJob {
  plan: PlanReader
  build: (commit: PlannedCommit | null, signal?: AbortSignal) => Promise<BuiltFrame>
  sink: FrameSink
  range: RenderRange
  fps: number
  /** Glide's time (ms); 0 shows each commit at once. */
  glideMs: number
  signal?: AbortSignal
  /** Called after each frame with the share done (0–1). */
  onProgress?: (done: number) => void
  /** Waits `ms` (tests pass one that does not). */
  wait?: (ms: number) => Promise<void>
}

/** A 0 ms pause posts a message instead: a background tab slows timers to one a second or less, not messages. */
function pause(ms: number): Promise<void> {
  if (ms > 0) return new Promise((resolve) => setTimeout(resolve, ms))
  const { port1, port2 } = new MessageChannel()
  return new Promise((resolve) => {
    port1.onmessage = () => {
      port1.close()
      resolve()
    }
    port2.postMessage(null)
  })
}

/** Renders every frame of `job.range` into its sink (see the top of the file). Rejects with the signal's reason. */
export async function renderFrames(job: RenderJob): Promise<void> {
  const { plan, build, sink, range, fps, glideMs, signal } = job
  const wait = job.wait ?? pause
  const glide = new SceneGlide(() => 0)
  const count = frameCount(range, fps)
  let shownSeq: number | null = null
  let shown: BuiltFrame | null = null
  let fromMs = range.startMs
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted()
    const t = range.startMs + (i * 1000) / fps
    for (let state = plan.planUntil(t); state !== 'ready'; state = plan.planUntil(t)) {
      // A slice that ran out lets the page breathe; features still being measured are waited for.
      await wait(state === 'more' ? 0 : RENDER_LIMITS.waitMs)
      signal?.throwIfAborted()
    }
    for (const commit of plan.range(fromMs, t)) {
      if (shownSeq !== null && commit.seq <= shownSeq) continue
      const built = await build(commit, signal)
      signal?.throwIfAborted()
      // Glided into from its media time (the first is shown as it is); paired at once, so its glide starts there.
      const at = Math.max(range.startMs, commit.mediaMs)
      glide.retarget(built.scene, at, {
        durationMs: glideMs,
        glide: shownSeq !== null,
        key: 'video',
        keyframes: built.keyframes,
      })
      glide.frameInfo(at)
      shownSeq = commit.seq
      shown = built
    }
    // Nothing planned at all yet (an empty plan): the sliders' own letters.
    if (!shown) {
      shown = await build(null, signal)
      glide.retarget(shown.scene, t, { durationMs: 0, glide: false, key: 'video' })
      shownSeq = -Infinity
    }
    fromMs = t
    sink.draw(glide.frame(t) ?? shown.scene, shown.layout, shown.palette)
    await sink.add(i / fps, 1 / fps)
    job.onProgress?.((i + 1) / count)
  }
}

/** What the scenes are built from: the canvas's text and settings when the render starts. */
export interface SceneSetup {
  font: LoadedFont
  /** The text as shown (letter case applied). */
  text: string
  typography: TypographyParams
  palette: PaletteParams
  artboard: ArtboardParams
  /** The sliders' own geometry parameters (with Thorn's canvasEm, as App builds them), and their key. */
  base: GeometryParams
  baseKey: string
}

/** Resolves once these glyphs have results under these settings (geometryClient.ensure). */
export type EnsureGlyphs = (
  font: LoadedFont,
  params: GeometryParams,
  key: string,
  indices: readonly number[],
  signal?: AbortSignal,
) => Promise<PolygonLookup>

/** The typography fields shaping uses. */
const layoutOf = ({ tracking, lineHeight, align, slant }: TypographyParams) => ({ tracking, lineHeight, align, slant })

/**
 * Builds planned commits into scenes as the canvas would show them (useDerivedGeometry), computing their glyphs with
 * `ensure`. The sliders' own letters, which place the block, are computed once.
 */
export function sceneBuilder(setup: SceneSetup, ensure: EnsureGlyphs) {
  const { font, text, typography, palette, artboard, base, baseKey } = setup
  const sliderShaped = shapeSpecimen(font, text, layoutOf(typography))
  const sliderSlots = letterSlots(sliderShaped)
  let sliderScene: Promise<SpecimenScene> | null = null
  const shapedBy = new Map<string, ShapedSpecimen>()
  const shapedFor = (shownFont: LoadedFont, shownTypography: TypographyParams): ShapedSpecimen => {
    if (shownFont === font && shownTypography === typography) return sliderShaped
    const layout = layoutOf(shownTypography)
    const key = `${shownFont.id}|${layout.tracking}|${layout.lineHeight}|${layout.align}|${layout.slant}`
    let shaped = shapedBy.get(key)
    if (!shaped) shapedBy.set(key, (shaped = shapeSpecimen(shownFont, text, layout)))
    return shaped
  }

  return async function build(commit: PlannedCommit | null, signal?: AbortSignal): Promise<BuiltFrame> {
    const inner = commit?.commit ?? null
    const params = inner?.params ?? null
    const look = params ? inner!.look : null
    const shownTypography = look?.typography ? { ...typography, ...look.typography } : typography
    const variation = params?.variation
    const shownFont = variation && font.at ? font.at(variation) : font
    const shaped = shapedFor(shownFont, shownTypography)
    const slots = shaped === sliderShaped || setsSlots(shaped, sliderSlots) ? sliderSlots : letterSlots(shaped)
    const letters: LetterFrame | null = params ? lettersOn(inner!.letters, slots) : null
    const shared = params ?? base
    const sharedKey = params ? paramsKey(params) : baseKey
    const indices = shaped.indices
    // Every parameter set the commit shows, and its keyframes, each computed for the glyphs it needs.
    const lookups = new Map<string, Promise<PolygonLookup>>()
    const ask = (p: GeometryParams, key: string, glyphs: readonly number[]) => {
      if (!lookups.has(key)) lookups.set(key, ensure(font, p, key, glyphs, signal))
    }
    ask(shared, sharedKey, indices)
    for (const job of letters?.jobs ?? []) ask(job.params, job.key, job.indices)
    const keyframes = inner?.keyframes ?? []
    for (const keyframe of keyframes) ask(keyframe.params, keyframe.key, indices)
    sliderScene ??= ensure(font, base, baseKey, sliderShaped.indices, signal).then((lookup) =>
      placePolygons(sliderShaped, lookup),
    )
    const found = new Map<string, PolygonLookup>()
    await Promise.all([...lookups].map(async ([key, lookup]) => found.set(key, await lookup)))
    const sceneWith = (sharedLookup: PolygonLookup) =>
      placePolygons(shaped, (index, occurrence) => {
        const key = levelKeyAt(letters, occurrence, sharedKey)
        return key === sharedKey ? sharedLookup(index, occurrence) : (found.get(key)?.(index, occurrence) ?? null)
      })
    const scene = sceneWith(found.get(sharedKey)!)
    const between = keyframes.map((keyframe) => sceneWith(found.get(keyframe.key)!))
    // Placed by the sliders' own letters whenever Sound changes the letters or how the text is set.
    const placeLive = params !== null || shaped !== sliderShaped
    const placement = placementScene(scene, placeLive, sliderShaped, await sliderScene, null)
    return {
      scene,
      layout: layoutArtboard(placement, shownTypography, artboard, font.metrics.unitsPerEm),
      palette: look?.palette ? { ...palette, ...look.palette } : palette,
      keyframes: between.length > 0 ? between : null,
    }
  }
}
