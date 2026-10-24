// Which renderer draws the glyph layer: the one ?render= (or the stored switch) asks for, falling back WebGL2 → Canvas2D
// → SVG when one cannot start (no context, a shader that does not compile) or loses its context. A surface tries its
// choice on a fresh canvas and, on null, asks again with fallbackOf(choice) on another fresh canvas (a canvas that gave
// one kind of context gives no other).

import { RUNTIME_FLAGS, type RendererChoice } from '../state/flags'
import { Canvas2DRenderer } from './canvas2d'
import type { GlyphRenderer } from './types'
import { WebGL2Renderer } from './webgl2'

/** The renderer the page asked for. */
export const RENDERER_CHOICE: RendererChoice = RUNTIME_FLAGS.render

/** The next renderer to try when `choice` cannot draw. */
export function fallbackOf(choice: RendererChoice): RendererChoice {
  return choice === 'webgl' ? 'canvas' : 'svg'
}

export interface RendererOptions {
  /** 'full' for the main canvas, 'artboard' for the preview. */
  mode: 'full' | 'artboard'
  /** The stacked canvas for WebGL's detail layer (main canvas only). */
  detailCanvas?: HTMLCanvasElement | null
  /** Called when the WebGL context is lost; useGlyphRenderer waits for its restore and falls back only after repeated losses. */
  onLost?: () => void
}

/** A renderer of exactly `choice` on `canvas`, or null when it cannot start there ('svg' is not drawn on a canvas). */
export function createRenderer(
  choice: RendererChoice,
  canvas: HTMLCanvasElement,
  options: RendererOptions,
): GlyphRenderer | null {
  if (choice === 'webgl') {
    return WebGL2Renderer.create(canvas, {
      detailCanvas: options.mode === 'full' ? (options.detailCanvas ?? null) : null,
      onLost: options.onLost,
    })
  }
  if (choice === 'canvas') return Canvas2DRenderer.create(canvas, options.mode)
  return null
}

/** What a renderer draws as, for the probe ('canvas', 'webgl' or 'webgl+detail'). */
export function effectiveOf(renderer: GlyphRenderer): string {
  return renderer instanceof WebGL2Renderer ? renderer.effective : renderer.kind
}
