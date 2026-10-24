import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { LoadedFont } from '../font/model'
import { paramsKey } from '../geometry/paramsKey'
import type { DerivedGeometry, GeometryParams, GlyphRef, SourceGlyph } from '../geometry/types'
import { NO_SLOTS, letterSlots, lettersOn, levelKeyAt, type LetterSlots } from '../sound/letters'
import type { LiveView } from '../sound/live'
import {
  layoutArtboard,
  placementScene,
  type ArtboardLayout,
  type SliderPlacement,
  type TypographyParams,
} from '../specimen/artboard'
import {
  placePolygons,
  shapeSpecimen,
  type PolygonLookup,
  type ShapedSpecimen,
  type SpecimenScene,
} from '../specimen/scene'
import { geometryClient, useGlyphGeometry } from './geometryClient'
import type { AppState } from './types'

/**
 * While Sound drives the letters, how long (ms) the sliders, text, font and typography must rest before the sliders'
 * own letters that place the text block are asked for: each request competes with the live frames for the worker.
 */
const SLIDER_SCENE_DELAY_MS = 200

export type GlyphGeometry =
  | { kind: 'none' }
  | { kind: 'source-error'; message: string }
  | { kind: 'ready'; source: SourceGlyph; geometry: DerivedGeometry | null; geometryError: string | null }

function readSource(font: LoadedFont | null, glyph: GlyphRef | null) {
  if (!font || !glyph) return null
  try {
    return { source: font.getGlyph(glyph.index), error: null }
  } catch (error) {
    return { source: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The glyph's result computed in this font for these settings (not an earlier one standing in), or null. */
function settled(font: LoadedFont, key: string, index: number): ReturnType<PolygonLookup> {
  const found = geometryClient.holds(font.id) ? geometryClient.lookup(key, index) : null
  if (!found || found.stale) return null
  return 'error' in found.entry ? { error: found.entry.error } : { polygon: found.entry.geometry.polygon }
}

export interface DerivedGeometryState {
  /** The selected glyph: its source outline and its derived geometry and statistics (as shown, live or not). */
  result: GlyphGeometry
  /** The current geometry parameters: the sliders' values, also while Sound drives the letters (exports use these). */
  params: GeometryParams
  /** The parameters the canvas shows: the live ones while Sound drives them, otherwise `params`. */
  shownParams: GeometryParams
  /** Cache key of `params`. */
  paramsKey: string
  /**
   * True while the selected glyph is still being computed for the parameters shown, or while the canvas
   * shows live parameters that differ from the sliders. (GeometryPanel also treats the statistics as busy
   * the whole time Sound drives the letters, so aria-busy holds back announcements; exports use
   * `pending && !live`.)
   */
  pending: boolean
  /** True while the canvas shows live parameters (Sound is driving them) that differ from the sliders. */
  live: boolean
}

export interface GeometryState {
  derived: DerivedGeometryState
  /** The text set with the current polygons (earlier ones for glyphs still being computed). */
  scene: SpecimenScene | null
  /** The scenes Glide passes through on the way to `scene` (its keyframes, oldest first), or null for none. */
  keyframes: readonly SpecimenScene[] | null
  /**
   * Where `scene` sits on the artboard. While Sound drives the letters, the block is placed by the sliders'
   * own letters (placementScene), so the live frames never move it.
   */
  layout: ArtboardLayout | null
  /**
   * The scene `layout` places the block by: `scene`, except while Sound drives the letters, when it is the
   * sliders' own letters (the live scene only until those are first computed). For measures that should
   * not follow the live frames, such as whether the text runs past the canvas edge (the exports use the
   * sliders' letters too).
   */
  placement: SpecimenScene | null
  /** True while text or typography changes are being laid out, or glyphs are being computed. */
  scenePending: boolean
  /**
   * The text set with the sliders' own polygons, built on demand. It is `scene` unless Sound is driving
   * the letters; then it resolves once the geometry worker has computed every glyph for the sliders
   * (nothing is computed on the page). Used by actions that save typography values measured from the
   * outlines (Fit text, Free, dragging the text in Free position), so a live frame never leaks into them.
   */
  loadSliderScene: () => Promise<SpecimenScene | null>
  /** The letters of the shaped text (one per occurrence), for the live scheduler (useLiveLetters). */
  letterSlots: LetterSlots
  /**
   * The font as the canvas sets it: while Sound drives a variable axis, the font at the live axis values (its
   * outlines and shaping; LoadedFont.at), otherwise the font itself (null without one).
   */
  shownFont: LoadedFont | null
}

/** The typography fields shaping uses. */
const layoutOf = ({ tracking, lineHeight, align, slant }: TypographyParams) => ({ tracking, lineHeight, align, slant })

/** Whether `shaped` sets the glyphs `slots` were made for, in the same order (the same text set otherwise). */
function sameGlyphs(slots: LetterSlots, shaped: ShapedSpecimen): boolean {
  let j = 0
  for (const line of shaped.lines) {
    for (const glyph of line.glyphs) if (j >= slots.count || slots.index[j++] !== glyph.index) return false
  }
  return j === slots.count
}

/**
 * All derived geometry for the page. Glyphs are computed in the geometry worker, the selected glyph
 * first (for its statistics), then the text's glyphs in reading order; the canvas keeps showing each
 * glyph's previous shape until its new one arrives, so nothing waits on a long computation. Shaping
 * the text is deferred so typing and typography sliders stay responsive. `text` is the text as shown
 * (letter case applied). `params` is the sliders' geometry parameters as App builds them (with Thorn's
 * canvasEm), so the canvas, Sound's live frames and the exports share one key. `live` is the frame
 * Sound is driving (useLiveFrame): when its parameters differ from the sliders, the glyphs are computed
 * and shown with them, as live requests, and letters that react by other amounts show their own level.
 * The text block stays placed by the sliders' own letters meanwhile (placementScene). Sound's typography and colours
 * (`live.look`) and axis values (`live.params.variation`) set the text as shown, at once (not deferred): it is shaped
 * with the live typography, in the font at the live axis values. Shaping again costs a few milliseconds a frame (a
 * fresh axis instance about 2 ms more), within a live frame's budget; the font keeps its recent instances.
 */
export function useGeometry(state: AppState, text: string, params: GeometryParams, live?: LiveView): GeometryState {
  const { font, selectedGlyph } = state.document
  const { typography, artboard } = state.params
  const key = useMemo(() => paramsKey(params), [params])
  // Live parameters equal to the sliders' change nothing: the sliders' own params and key are used, as without Sound.
  // With Thorn turns, letters can still show other settings while the shared live values are the sliders' own.
  const liveParams = live?.params
  const liveKey = useMemo(
    () => (liveParams && liveParams !== params ? paramsKey(liveParams) : key),
    [liveParams, params, key],
  )
  const isLive = liveKey !== key || !!live?.letters
  const shownParams = isLive && liveParams ? liveParams : params
  const shownKey = isLive ? liveKey : key

  const deferredText = useDeferredValue(text)
  const deferredTypography = useDeferredValue(typography)
  // Sound's typography over the sliders', and the font at Sound's axis values.
  const liveTypography = live?.look?.typography
  const shownTypography = useMemo(
    () => (liveTypography ? { ...deferredTypography, ...liveTypography } : deferredTypography),
    [deferredTypography, liveTypography],
  )
  const variation = live?.params.variation
  const shownFont = useMemo(() => (font && variation && font.at ? font.at(variation) : font), [font, variation])
  // The text as the sliders set it, which places the block and assigns the letters' levels.
  const own = layoutOf(deferredTypography)
  const sliderShaped = useMemo(
    () =>
      font
        ? shapeSpecimen(font, deferredText, {
            tracking: own.tracking,
            lineHeight: own.lineHeight,
            align: own.align,
            slant: own.slant,
          })
        : null,
    [font, deferredText, own.tracking, own.lineHeight, own.align, own.slant],
  )
  // Shaped otherwise than by the sliders: Sound's typography or axes shape the text again, every frame they change.
  const liveShaping = shownFont !== font || liveTypography !== undefined
  const { tracking, lineHeight, align, slant } = shownTypography
  const shaped = useMemo(
    () =>
      liveShaping && shownFont
        ? shapeSpecimen(shownFont, deferredText, { tracking, lineHeight, align, slant })
        : sliderShaped,
    [liveShaping, shownFont, sliderShaped, deferredText, tracking, lineHeight, align, slant],
  )
  // Placed by the sliders' own letters whenever Sound changes the letters or how the text is set.
  const placeLive = isLive || liveShaping

  const indices = useMemo(() => {
    const list = shaped ? shaped.indices.slice() : []
    if (selectedGlyph) {
      const at = list.indexOf(selectedGlyph.index)
      if (at >= 0) list.splice(at, 1)
      list.unshift(selectedGlyph.index)
    }
    return list
  }, [shaped, selectedGlyph])
  // The letters on other levels belong to the letters they were assigned for: the same text set differently keeps
  // them; after a text edit they wait for the next frame. The sliders' own setting gives them, so Sound's typography
  // and axes neither make new slots each frame nor move letters between levels (a letter's place across the block);
  // only live glyphs other than the sliders' (an axis that substitutes glyphs) are assigned on their own.
  const sliderSlots = useMemo(() => (sliderShaped ? letterSlots(sliderShaped) : NO_SLOTS), [sliderShaped])
  const slots = useMemo(
    () =>
      !shaped
        ? NO_SLOTS
        : shaped === sliderShaped || sameGlyphs(sliderSlots, shaped)
          ? sliderSlots
          : letterSlots(shaped),
    [shaped, sliderShaped, sliderSlots],
  )
  const letters = isLive ? lettersOn(live?.letters, slots) : null
  // With Thorn turns, the shown parameters only for the glyphs of the letters that show them (and the selected glyph).
  const geometry = useGlyphGeometry(font, shownParams, shownKey, indices, isLive, letters?.jobs, letters?.sharedGlyphs)

  const scene = useMemo(
    () =>
      shaped
        ? placePolygons(shaped, (index, occurrence) => {
            const levelKey = levelKeyAt(letters, occurrence, shownKey)
            const found = levelKey === shownKey ? geometry.lookup(index) : geometryClient.lookup(levelKey, index)
            if (!found) return null
            // Live frames are shown one after another as they arrive: the newest is not "outdated", so the
            // canvas does not flash "Updating" at every frame.
            return 'error' in found.entry
              ? { error: found.entry.error }
              : { polygon: found.entry.geometry.polygon, stale: found.stale && !isLive }
          })
        : null,
    [shaped, geometry, isLive, letters, shownKey],
  )
  // The keyframes Glide passes through on the way to `scene` (sound/keyframes.ts): the same text with the shared set's
  // glyphs at each keyframe (letters on other levels as in `scene`). Their glyphs are computed before the frame is
  // committed (live.ts), so they are read once per frame; one whose glyphs are not all here is left out.
  const liveKeyframes = live?.keyframes
  const keyframes = useMemo(() => {
    if (!shaped || !liveKeyframes) return null
    const scenes: SpecimenScene[] = []
    for (const keyframe of liveKeyframes) {
      const at = placePolygons(shaped, (index, occurrence) => {
        const levelKey = levelKeyAt(letters, occurrence, shownKey)
        const found = geometryClient.lookup(levelKey === shownKey ? keyframe.key : levelKey, index)
        if (!found) return null
        return 'error' in found.entry ? { error: found.entry.error } : { polygon: found.entry.geometry.polygon }
      })
      if (at.pendingGlyphs === 0) scenes.push(at)
    }
    return scenes.length > 0 ? scenes : null
  }, [shaped, liveKeyframes, letters, shownKey])

  // The sliders' own letters while Sound drives the letters, which place the text block (placementScene).
  // Usually kept from normal editing; when the sliders, text, font or typography change while live, the
  // glyphs still missing are asked for once they have rested SLIDER_SCENE_DELAY_MS (so a dragged slider asks
  // once, not every frame of the drag), and the block keeps its place meanwhile.
  // (The same settings have the same key in every font: what was asked for belongs to its font.)
  const [asked, setAsked] = useState<{ font: LoadedFont; key: string; lookup: PolygonLookup } | null>(null)
  const sliderScene = useMemo(() => {
    if (!placeLive || !font || !sliderShaped) return null
    const known = asked && asked.font === font && asked.key === key ? asked.lookup : null
    return placePolygons(sliderShaped, (index, occurrence) => known?.(index, occurrence) ?? settled(font, key, index))
  }, [placeLive, sliderShaped, font, key, asked])
  const sliderPending = (sliderScene?.pendingGlyphs ?? 0) > 0
  useEffect(() => {
    if (!sliderPending || !font || !sliderShaped) return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      geometryClient.ensure(font, params, key, sliderShaped.indices, abort.signal).then(
        (lookup) => setAsked({ font, key, lookup }),
        () => {},
      )
    }, SLIDER_SCENE_DELAY_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [sliderPending, font, sliderShaped, params, key])
  // The sliders' letters last set in full for this text (without Sound, the scene shown) stand in meanwhile:
  // kept by an effect, read by a render where the sliders' letters are pending.
  const sliderLetters = placeLive ? sliderScene : scene
  const lastSlider = useRef<SliderPlacement | null>(null)
  useEffect(() => {
    if (sliderShaped && sliderLetters && sliderLetters.pendingGlyphs === 0)
      lastSlider.current = { shaped: sliderShaped, scene: sliderLetters }
  }, [sliderShaped, sliderLetters])
  const placement =
    scene && sliderShaped ? placementScene(scene, placeLive, sliderShaped, sliderScene, lastSlider.current) : null

  const loadSliderScene = useCallback(async () => {
    if (!font || !sliderShaped || !placeLive) return scene
    if (sliderScene && !sliderPending) return sliderScene
    return placePolygons(sliderShaped, await geometryClient.ensure(font, params, key, sliderShaped.indices))
  }, [placeLive, font, sliderShaped, params, key, scene, sliderScene, sliderPending])
  const layout = useMemo(
    () => (font && placement ? layoutArtboard(placement, shownTypography, artboard, font.metrics.unitsPerEm) : null),
    [font, placement, shownTypography, artboard],
  )

  const source = useMemo(() => readSource(shownFont, selectedGlyph), [shownFont, selectedGlyph])
  const selected = selectedGlyph ? geometry.lookup(selectedGlyph.index) : null
  const selectedEntry = selected?.entry ?? null
  const result = useMemo<GlyphGeometry>(() => {
    if (!font || !selectedGlyph || !source) return { kind: 'none' }
    if (!source.source) return { kind: 'source-error', message: source.error ?? 'Unknown error' }
    if (!selectedEntry) return { kind: 'ready', source: source.source, geometry: null, geometryError: null }
    if ('error' in selectedEntry)
      return { kind: 'ready', source: source.source, geometry: null, geometryError: selectedEntry.error }
    // Kept without its statistics (computed while another glyph was selected): they are on their way (useGlyphGeometry).
    if ('lean' in selectedEntry) return { kind: 'ready', source: source.source, geometry: null, geometryError: null }
    return {
      kind: 'ready',
      source: source.source,
      geometry: { ...selectedEntry.geometry, source: source.source },
      geometryError: null,
    }
  }, [font, selectedGlyph, source, selectedEntry])

  return {
    derived: {
      result,
      params,
      shownParams,
      paramsKey: key,
      pending: Boolean(selectedGlyph && font && (isLive || !selected || selected.stale || 'lean' in selected.entry)),
      live: isLive,
    },
    scene,
    keyframes,
    layout,
    placement,
    scenePending: deferredText !== text || deferredTypography !== typography || (scene?.pendingGlyphs ?? 0) > 0,
    loadSliderScene,
    letterSlots: slots,
    shownFont,
  }
}
