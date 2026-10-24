import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createRenderer, effectiveOf, fallbackOf } from '../render/createRenderer'
import { measureDraw, probeOn, reportFrame } from '../render/probe'
import type { GlideFrame, GlyphRenderer, SourceLookup } from '../render/types'
import type { SpecimenScene } from '../specimen/scene'
import type { GlideStore } from '../state/useGlide'

/** A third lost WebGL context within this time gives WebGL up for Canvas2D; fewer are restored. */
export const LOSS_WINDOW_MS = 60_000
export const MAX_LOSSES = 3
/** A lost context the browser has not restored by then is given up as well. */
export const RESTORE_WAIT_MS = 5_000

/** A frame with nothing gliding: the scene as it is. */
function stillFrame(scene: SpecimenScene): GlideFrame {
  return { target: scene, layout: scene, morphs: null, scene: () => scene }
}

/**
 * Whether a lost context at `now` is one too many: `losses` (times of the earlier ones, kept in place) gets `now`,
 * without the ones older than LOSS_WINDOW_MS.
 */
export function tooManyLosses(losses: number[], now: number): boolean {
  const recent = losses.filter((t) => now - t < LOSS_WINDOW_MS)
  recent.push(now)
  losses.splice(0, losses.length, ...recent)
  return recent.length >= MAX_LOSSES
}

interface GlyphRendererOptions {
  mode: 'full' | 'artboard'
  /** The scene glided into; the frames on its way come from `glide`. */
  scene: SpecimenScene
  glide: GlideStore
  /** The font's source outlines (the main canvas), or null. */
  source: SourceLookup | null
  /** The stacked canvas for WebGL's detail layer (main canvas only). */
  detailRef?: RefObject<HTMLCanvasElement | null>
  /** Called when Canvas2D cannot draw either: the surface draws with SVG instead. */
  onFallback: () => void
  /** For the probe: which surface, and (the main canvas) device pixels per font unit. */
  probe: 'canvas' | 'preview'
  probeScale?: () => number
  /** Anything else that gives the surface a new canvas (the preview's, after an error), so a new renderer is made. */
  remount?: unknown
  /** After each frame of Glide reaches the renderer. */
  onFrame?: () => void
}

/**
 * The canvas renderer of GlyphSurface and PreviewSurface: made on `canvasRef`'s canvas for `choice`, falling back
 * WebGL2 → Canvas2D → SVG (onFallback) when one cannot start or throws. A lost WebGL context is kept for the browser to
 * restore, and the renderer is made again on it; only a third loss within a minute, or one not restored in time, falls
 * back to Canvas2D. Every frame of Glide goes straight to the renderer. The surface sets the view, style and selection
 * in a layout effect on `kind` and `generation` (a new renderer), then paints.
 */
export function useGlyphRenderer(
  choice: 'canvas' | 'webgl',
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: GlyphRendererOptions,
) {
  const { mode, scene, glide, source, detailRef, onFallback, probe, remount } = options
  // The renderer kind drawing now; a new kind gets fresh canvases (one that gave a WebGL context gives no 2D one).
  const [kind, setKind] = useState<'canvas' | 'webgl'>(choice)
  // Counts the renderers made again on the same canvas (a restored context).
  const [generation, setGeneration] = useState(0)
  const rendererRef = useRef<GlyphRenderer | null>(null)
  const latest = useRef({ scene, still: stillFrame(scene), probeScale: options.probeScale, onFrame: options.onFrame })
  const still = useMemo(() => stillFrame(scene), [scene])
  latest.current = { scene, still, probeScale: options.probeScale, onFrame: options.onFrame }
  const frameNow = useCallback((): GlideFrame => {
    const snapshot = glide.getSnapshot()
    return snapshot.target === latest.current.scene ? snapshot.frame : latest.current.still
  }, [glide])

  /** Gives the renderer up (fallBack, below): set once fallBack is made. */
  const broke = useRef<() => void>(() => {})

  /** Draws now if anything changed, and reports the frame to the probe. */
  const paint = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer || renderer.broken) return
    const start = performance.now()
    let drew: boolean
    try {
      drew = renderer.draw()
    } catch (error) {
      // A renderer that throws is given up like a lost one: the next renderer draws from here on.
      console.error('The glyph renderer failed; falling back', error)
      broke.current()
      return
    }
    if (!drew) return
    const end = performance.now()
    measureDraw(probe, start, end)
    if (probeOn) {
      const scale = latest.current.probeScale
      const shown = frameNow()
      reportFrame(probe, effectiveOf(renderer), end - start, scale ? () => shown.scene() : () => null, scale?.() ?? 0)
    }
  }, [frameNow, probe])

  const fallBack = useCallback(() => {
    rendererRef.current?.dispose()
    rendererRef.current = null
    const next = fallbackOf(kind)
    if (next === 'svg') onFallback()
    else setKind(next)
  }, [kind, onFallback])
  broke.current = fallBack

  // When the WebGL contexts were lost (for every renderer this surface makes).
  const losses = useRef<number[]>([])
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let restoreTimer: ReturnType<typeof setTimeout> | null = null
    let alive = true
    // Once: a lost renderer is let go at once, while its context is lost (its GL objects die with it).
    const release = () => {
      if (!alive) return
      alive = false
      renderer?.dispose()
      if (rendererRef.current === renderer) rendererRef.current = null
    }
    const onLost = () => {
      release()
      if (tooManyLosses(losses.current, performance.now())) broke.current()
      else restoreTimer = setTimeout(() => broke.current(), RESTORE_WAIT_MS)
    }
    const onRestored = () => setGeneration((g) => g + 1)
    const renderer = createRenderer(kind, canvas, { mode, detailCanvas: detailRef?.current ?? null, onLost })
    if (!renderer) {
      fallBack()
      return
    }
    rendererRef.current = renderer
    if (kind === 'webgl') canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (restoreTimer !== null) clearTimeout(restoreTimer)
      release()
    }
    // fallBack changes with kind only, which already re-runs this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, generation, remount])

  // Every frame of Glide, straight to the renderer.
  useEffect(
    () =>
      glide.subscribe(() => {
        const renderer = rendererRef.current
        if (!renderer) return
        renderer.setFrame(frameNow(), source)
        paint()
        latest.current.onFrame?.()
      }),
    [glide, frameNow, source, paint, kind, generation],
  )

  return { kind, generation, rendererRef, frameNow, paint }
}
