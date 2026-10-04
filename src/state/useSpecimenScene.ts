import { useDeferredValue, useMemo } from 'react'
import type { LoadedFont } from '../font/model'
import type { GeometryParams } from '../geometry/types'
import { buildSpecimenScene, type SpecimenScene } from '../specimen/scene'

/**
 * Lays out the specimen text once for the canvas, the text panel, and export. Typing is deferred so
 * the input stays responsive; glyph geometry comes from the shared cache, so repeated characters and
 * unchanged glyphs are never processed twice for the same parameters.
 */
export function useSpecimenScene(
  font: LoadedFont | null,
  text: string,
  params: GeometryParams,
  paramsKey: string,
): { scene: SpecimenScene | null; pending: boolean } {
  const deferredText = useDeferredValue(text)
  const scene = useMemo(
    () => (font ? buildSpecimenScene(font, deferredText, params, paramsKey) : null),
    [font, deferredText, params, paramsKey],
  )
  return { scene, pending: deferredText !== text }
}
