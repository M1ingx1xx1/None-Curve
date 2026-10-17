import { useCallback, useDeferredValue, useMemo } from 'react'
import type { LoadedFont } from '../font/model'
import { paramsKey } from '../geometry/cache'
import type { DerivedGeometry, GeometryParams, GlyphRef, SourceGlyph } from '../geometry/types'
import { layoutArtboard, type ArtboardLayout } from '../specimen/artboard'
import { placePolygons, shapeSpecimen, type SpecimenScene } from '../specimen/scene'
import { exportPolygonLookup, useGlyphGeometry } from './geometryClient'
import type { AppState } from './types'

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
  layout: ArtboardLayout | null
  /** True while text or typography changes are being laid out, or glyphs are being computed. */
  scenePending: boolean
  /**
   * The text set with the sliders' own polygons, built on demand. It equals `scene` unless Sound is
   * driving the letters. Used by actions that save typography values measured from the outlines (Fit
   * text, Free), so a live frame never leaks into them.
   */
  sliderScene: () => SpecimenScene | null
}

/**
 * All derived geometry for the page. Glyphs are computed in the geometry worker, the selected glyph
 * first (for its statistics), then the text's glyphs in reading order; the canvas keeps showing each
 * glyph's previous shape until its new one arrives, so nothing waits on a long computation. Shaping
 * the text is deferred so typing and typography sliders stay responsive. `text` is the text as shown
 * (letter case applied). `live` is the parameters Sound is driving (useLiveParams): when they differ
 * from the sliders, the glyphs are computed and shown with them, as live requests.
 */
export function useGeometry(state: AppState, text: string, live?: GeometryParams): GeometryState {
  const { font, selectedGlyph } = state.document
  const { flatten, random, squaring, anchors, grid, distortion, experimental, typography, artboard } = state.params
  const params = useMemo<GeometryParams>(
    () => ({ flatten, random, squaring, anchors, grid, distortion, experimental }),
    [flatten, random, squaring, anchors, grid, distortion, experimental],
  )
  const key = useMemo(() => paramsKey(params), [params])
  // Live parameters equal to the sliders' change nothing: the sliders' own params and key are used, as without Sound.
  const liveKey = useMemo(() => (live && live !== params ? paramsKey(live) : key), [live, params, key])
  const isLive = liveKey !== key
  const shownParams = isLive && live ? live : params
  const shownKey = isLive ? liveKey : key

  const deferredText = useDeferredValue(text)
  const deferredTypography = useDeferredValue(typography)
  const { tracking, lineHeight, align, slant } = deferredTypography
  const shaped = useMemo(
    () => (font ? shapeSpecimen(font, deferredText, { tracking, lineHeight, align, slant }) : null),
    [font, deferredText, tracking, lineHeight, align, slant],
  )

  const indices = useMemo(() => {
    const list = shaped ? shaped.indices.slice() : []
    if (selectedGlyph) {
      const at = list.indexOf(selectedGlyph.index)
      if (at >= 0) list.splice(at, 1)
      list.unshift(selectedGlyph.index)
    }
    return list
  }, [shaped, selectedGlyph])
  const geometry = useGlyphGeometry(font, shownParams, shownKey, indices, isLive)

  const scene = useMemo(
    () =>
      shaped
        ? placePolygons(shaped, (index) => {
            const found = geometry.lookup(index)
            if (!found) return null
            // Live frames are shown one after another as they arrive: the newest is not "outdated", so the
            // canvas does not flash "Updating" at every frame.
            return 'error' in found.entry ? { error: found.entry.error } : { polygon: found.entry.geometry.polygon, stale: found.stale && !isLive }
          })
        : null,
    [shaped, geometry, isLive],
  )
  const sliderScene = useCallback(
    () => (isLive && font && shaped ? placePolygons(shaped, exportPolygonLookup(font, params, key)) : scene),
    [isLive, font, shaped, params, key, scene],
  )
  const layout = useMemo(
    () => (font && scene ? layoutArtboard(scene, deferredTypography, artboard, font.metrics.unitsPerEm) : null),
    [font, scene, deferredTypography, artboard],
  )

  const source = useMemo(() => readSource(font, selectedGlyph), [font, selectedGlyph])
  const selected = selectedGlyph ? geometry.lookup(selectedGlyph.index) : null
  const selectedEntry = selected?.entry ?? null
  const result = useMemo<GlyphGeometry>(() => {
    if (!font || !selectedGlyph || !source) return { kind: 'none' }
    if (!source.source) return { kind: 'source-error', message: source.error ?? 'Unknown error' }
    if (!selectedEntry) return { kind: 'ready', source: source.source, geometry: null, geometryError: null }
    if ('error' in selectedEntry) return { kind: 'ready', source: source.source, geometry: null, geometryError: selectedEntry.error }
    return { kind: 'ready', source: source.source, geometry: { ...selectedEntry.geometry, source: source.source }, geometryError: null }
  }, [font, selectedGlyph, source, selectedEntry])

  return {
    derived: {
      result,
      params,
      shownParams,
      paramsKey: key,
      pending: Boolean(selectedGlyph && font && (isLive || !selected || selected.stale)),
      live: isLive,
    },
    scene,
    layout,
    scenePending: deferredText !== text || deferredTypography !== typography || (scene?.pendingGlyphs ?? 0) > 0,
    sliderScene,
  }
}
