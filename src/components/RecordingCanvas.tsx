import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  canvasFilterWorks,
  drawArtboard,
  polygonPaths,
  touchCanvas,
  type DrawTarget,
  type VideoLook,
} from '../export/drawArtboard'
import { getRecorder, useRecording, type TakeSpec } from '../export/recorder'
import type { ArtboardLayout, PaletteParams } from '../specimen/artboard'
import { previewBlur, previewColors, type PreviewLook } from '../specimen/previewLook'
import type { SpecimenScene } from '../specimen/scene'

interface RecordingCanvasProps {
  /** The text as the canvas shows it (live shapes while Sound drives), and where it sits on the artboard. */
  scene: SpecimenScene | null
  layout: ArtboardLayout | null
  /** Artboard pixels: the video shows the whole artboard, stretched to the take's size. */
  artboard: { width: number; height: number }
  palette: PaletteParams
  /** The bottom-right preview's look and scale, for a take with "Use the preview look". */
  previewLook: PreviewLook
  previewScale: number
  /** The canvas's Fill: off, the video draws outlines only, as the SVG export. */
  fill: boolean
}

/**
 * The canvas a take is recorded from, there only while one runs: the artboard drawn again whenever the
 * scene changes, each drawing one video frame. Mount it once (in App); it renders nothing between takes.
 */
export default function RecordingCanvas(props: RecordingCanvasProps) {
  const { take } = useRecording()
  // A new take always follows a null one, so each take gets a canvas of its own.
  return take ? <TakeCanvas {...props} take={take} /> : null
}

function TakeCanvas({
  scene,
  layout,
  artboard,
  palette,
  previewLook,
  previewScale,
  fill,
  take,
}: RecordingCanvasProps & { take: TakeSpec }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetRef = useRef<DrawTarget<Path2D> | null>(null)
  // Each polygon's outline as a Path2D, built once: repeated letters and unchanged shapes reuse it.
  const [pathOf] = useState(() => polygonPaths(() => new Path2D()))

  const colors = take.previewLook ? previewColors(palette, previewLook) : palette
  const blur = take.previewLook && layout ? previewBlur(previewLook.blur, previewScale, layout.unitsPerPx) : 0
  const { ink, paper } = colors
  const look = useMemo<VideoLook>(() => ({ ink, paper, blur, outlineOnly: !fill }), [ink, paper, blur, fill])

  // First: hand the canvas to the recorder, which captures it once the sound runs and a frame is drawn.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) {
      getRecorder().stop('error')
      return
    }
    // Before anything sets the context's filter (canvasFilterWorks reads it back).
    const filter = canvasFilterWorks(ctx)
    targetRef.current = { ctx, width: take.width, height: take.height, layer: null, filter }
    getRecorder().canvasReady(canvas, filter || look.blur === 0, () => touchCanvas(ctx))
    return () => {
      targetRef.current = null
    }
    // The look at the start decides only whether a missing blur is noted; later changes are drawn as they come.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take])

  // Then a frame for every change: the shapes (live frames), the layout, or the look.
  useLayoutEffect(() => {
    const target = targetRef.current
    if (!target) return
    // The glyphs are drawn into a layer of their own only to blur them as one, as the SVG does.
    if (look.blur > 0 && target.filter) target.layer ??= glyphLayer(take)
    else target.layer = null
    if (scene && layout) drawArtboard(target, scene, layout, artboard, look, pathOf)
    else {
      // No text placed yet: the paper alone.
      target.ctx.setTransform(1, 0, 0, 1, 0, 0)
      target.ctx.fillStyle = look.paper
      target.ctx.fillRect(0, 0, target.width, target.height)
    }
    getRecorder().frameDrawn()
  }, [scene, layout, artboard, look, take, pathOf])

  // Attached but out of sight: a canvas that is not displayed may not be drawn or captured.
  return (
    <canvas ref={canvasRef} className="recording-canvas" width={take.width} height={take.height} aria-hidden="true" />
  )
}

/** A transparent canvas of the take's size for the glyphs, or null when the browser cannot give one. */
function glyphLayer(take: TakeSpec): DrawTarget<Path2D>['layer'] {
  const canvas = document.createElement('canvas')
  canvas.width = take.width
  canvas.height = take.height
  const ctx = canvas.getContext('2d')
  return ctx ? { ctx, image: canvas } : null
}
