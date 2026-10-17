// The preview's look: its blur and colour inversion, kept in App so exports can reproduce the preview,
// and saved with the session.

import { roundTo } from '../export/quantize'
import type { PaletteParams } from './artboard'

export interface PreviewLook {
  /** Blur radius in screen pixels of this preview; 0 is off. */
  blur: number
  /** Swap the palette's text and background colours. */
  inverted: boolean
}

export const DEFAULT_PREVIEW_LOOK: PreviewLook = { blur: 0, inverted: false }

/** The preview's colours: the palette, swapped when inverted. */
export function previewColors(palette: PaletteParams, look: PreviewLook): PaletteParams {
  return look.inverted ? { ...palette, ink: palette.paper, paper: palette.ink } : palette
}

export const MAX_PREVIEW_BLUR = 12
/** The Blur slider's step, in screen pixels. */
export const PREVIEW_BLUR_STEP = 0.1

/**
 * The preview's blur as the SVG export writes it: screen pixels of the preview, divided by its scale
 * (screen pixels per font unit) give font units, and by the artboard's font units per pixel give artboard
 * pixels, so the blur keeps its size relative to the letters. Rounded as the export writes it.
 */
export function previewBlur(blur: number, previewScale: number, unitsPerPx: number): number {
  return blur > 0 && previewScale > 0 ? roundTo(blur / previewScale / unitsPerPx, 3) : 0
}
