import { useDeferredValue, useMemo } from 'react'
import type { LoadedFont } from '../font/model'
import { glyphGeometry, paramsKey } from '../geometry/cache'
import type { DerivedGeometry, GeometryParams, GlyphRef, SourceGlyph } from '../geometry/types'
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
  result: GlyphGeometry
  /** The parameters the displayed geometry was computed with (the deferred values). */
  params: GeometryParams
  /** Cache key of `params`. */
  paramsKey: string
  /** True while a newer parameter change is still being computed. */
  pending: boolean
}

/**
 * Derives the polygon for the selected glyph from the original curves through the shared geometry
 * cache. The result is never stored in reducer state. All geometry parameters are deferred so fast
 * slider drags stay responsive; React always renders the latest parameters once it catches up.
 */
export function useDerivedGeometry(state: AppState): DerivedGeometryState {
  const { font, selectedGlyph } = state.document
  const { flatten, random, squaring, anchors, grid, distortion } = state.params
  const deferredFlatten = useDeferredValue(flatten)
  const deferredRandom = useDeferredValue(random)
  const deferredSquaring = useDeferredValue(squaring)
  const deferredAnchors = useDeferredValue(anchors)
  const deferredGrid = useDeferredValue(grid)
  const deferredDistortion = useDeferredValue(distortion)

  const params = useMemo<GeometryParams>(
    () => ({
      flatten: deferredFlatten,
      random: deferredRandom,
      squaring: deferredSquaring,
      anchors: deferredAnchors,
      grid: deferredGrid,
      distortion: deferredDistortion,
    }),
    [deferredFlatten, deferredRandom, deferredSquaring, deferredAnchors, deferredGrid, deferredDistortion],
  )
  const key = useMemo(() => paramsKey(params), [params])

  const source = useMemo(() => readSource(font, selectedGlyph), [font, selectedGlyph])

  const result = useMemo<GlyphGeometry>(() => {
    if (!font || !selectedGlyph || !source) return { kind: 'none' }
    if (!source.source) return { kind: 'source-error', message: source.error ?? 'Unknown error' }
    try {
      const geometry = glyphGeometry(font, selectedGlyph.index, params, key)
      return { kind: 'ready', source: source.source, geometry, geometryError: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'ready', source: source.source, geometry: null, geometryError: message }
    }
  }, [font, selectedGlyph, source, params, key])

  return {
    result,
    params,
    paramsKey: key,
    pending:
      deferredFlatten !== flatten ||
      deferredRandom !== random ||
      deferredSquaring !== squaring ||
      deferredAnchors !== anchors ||
      deferredGrid !== grid ||
      deferredDistortion !== distortion,
  }
}
