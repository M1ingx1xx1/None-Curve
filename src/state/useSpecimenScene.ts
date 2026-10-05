import { useDeferredValue, useMemo } from 'react'
import type { LoadedFont } from '../font/model'
import type { GeometryParams } from '../geometry/types'
import { layoutArtboard, type ArtboardLayout, type ArtboardParams, type TypographyParams } from '../specimen/artboard'
import { buildSpecimenScene, type SpecimenScene } from '../specimen/scene'

/**
 * Lays out the specimen text once for the canvas, the preview, the text panel, and export, and places
 * it on the artboard. Typing and typography changes are deferred so the input and sliders stay
 * responsive; glyph geometry comes from the shared cache, so repeated characters and unchanged glyphs
 * are never processed twice for the same parameters. `text` is the text as shown (case applied).
 */
export function useSpecimenScene(
  font: LoadedFont | null,
  text: string,
  params: GeometryParams,
  paramsKey: string,
  typography: TypographyParams,
  artboard: ArtboardParams,
): { scene: SpecimenScene | null; layout: ArtboardLayout | null; pending: boolean } {
  const deferredText = useDeferredValue(text)
  const deferredTypography = useDeferredValue(typography)
  const { tracking, lineHeight, align, slant } = deferredTypography
  const scene = useMemo(
    () => (font ? buildSpecimenScene(font, deferredText, params, paramsKey, { tracking, lineHeight, align, slant }) : null),
    [font, deferredText, params, paramsKey, tracking, lineHeight, align, slant],
  )
  const layout = useMemo(
    () => (font && scene ? layoutArtboard(scene, deferredTypography, artboard, font.metrics.unitsPerEm) : null),
    [font, scene, deferredTypography, artboard],
  )
  return { scene, layout, pending: deferredText !== text || deferredTypography !== typography }
}
