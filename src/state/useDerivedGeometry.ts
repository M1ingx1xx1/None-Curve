import { useDeferredValue, useMemo } from 'react'
import type { LoadedFont } from '../font/model'
import { paramsKey } from '../geometry/cache'
import type { DerivedGeometry, GeometryParams, GlyphRef, SourceGlyph } from '../geometry/types'
import { layoutArtboard, type ArtboardLayout } from '../specimen/artboard'
import { placePolygons, shapeSpecimen, type SpecimenScene } from '../specimen/scene'
import { useGlyphGeometry } from './geometryClient'
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
  /** The selected glyph: its source outline and its derived geometry and statistics. */
  result: GlyphGeometry
  /** The current geometry parameters. */
  params: GeometryParams
  /** Cache key of `params`. */
  paramsKey: string
  /** True while the selected glyph is still being computed for the current parameters. */
  pending: boolean
}

export interface GeometryState {
  derived: DerivedGeometryState
  /** The text set with the current polygons (earlier ones for glyphs still being computed). */
  scene: SpecimenScene | null
  layout: ArtboardLayout | null
  /** True while text or typography changes are being laid out, or glyphs are being computed. */
  scenePending: boolean
}

/**
 * All derived geometry for the page. Glyphs are computed in the geometry worker, the selected glyph
 * first (for its statistics), then the text's glyphs in reading order; the canvas keeps showing each
 * glyph's previous shape until its new one arrives, so nothing waits on a long computation. Shaping
 * the text is deferred so typing and typography sliders stay responsive. `text` is the text as shown
 * (letter case applied).
 */
export function useGeometry(state: AppState, text: string): GeometryState {
  const { font, selectedGlyph } = state.document
  const { flatten, random, squaring, anchors, grid, distortion, experimental, typography, artboard } = state.params
  const params = useMemo<GeometryParams>(
    () => ({ flatten, random, squaring, anchors, grid, distortion, experimental }),
    [flatten, random, squaring, anchors, grid, distortion, experimental],
  )
  const key = useMemo(() => paramsKey(params), [params])

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
  const geometry = useGlyphGeometry(font, params, key, indices)

  const scene = useMemo(
    () =>
      shaped
        ? placePolygons(shaped, (index) => {
            const found = geometry.lookup(index)
            if (!found) return null
            return 'error' in found.entry ? { error: found.entry.error } : { polygon: found.entry.geometry.polygon, stale: found.stale }
          })
        : null,
    [shaped, geometry],
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
    derived: { result, params, paramsKey: key, pending: Boolean(selectedGlyph && font && (!selected || selected.stale)) },
    scene,
    layout,
    scenePending: deferredText !== text || deferredTypography !== typography || (scene?.pendingGlyphs ?? 0) > 0,
  }
}
