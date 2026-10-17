import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ViewParams } from '../state/types'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 40
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** What zoom 1 shows, in font units with y up. */
export interface Frame {
  cx: number
  cy: number
  width: number
  height: number
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Measure once now so the first render does not wait for the observer callback.
    const rect = el.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

/**
 * Shared pan / zoom for the result canvas. Coordinates are font units with y up; the returned
 * view box is for an SVG whose content is drawn at (x, −y). Wheel zooms around the cursor, drag and
 * arrow keys pan, + / − zoom, 0 fits. With `interactive` false only the view box is computed (no wheel
 * listener), for read-only views.
 */
export function usePanZoom(
  frame: Frame,
  view: ViewParams,
  onViewChange: (patch: Partial<ViewParams>) => void,
  interactive = true,
) {
  const [containerRef, size] = useElementSize<HTMLDivElement>()
  const ready = size.width > 0 && size.height > 0
  const scale = ready ? Math.min(size.width / frame.width, size.height / frame.height) * view.zoom : 1
  const u = 1 / scale // font units per screen pixel
  const visW = size.width * u
  const visH = size.height * u
  const cx = frame.cx + view.panX
  const cy = frame.cy + view.panY
  const box = { left: cx - visW / 2, right: cx + visW / 2, top: cy + visH / 2, bottom: cy - visH / 2 }

  const latest = useRef({ view, frame, visW, visH, size })
  latest.current = { view, frame, visW, visH, size }
  useEffect(() => {
    const el = containerRef.current
    if (!el || !interactive) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view, frame, visW, visH, size } = latest.current
      const rect = el.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / size.width - 0.5
      const fy = (e.clientY - rect.top) / size.height - 0.5
      const zoom = clampZoom(view.zoom * Math.exp(-e.deltaY * 0.0015))
      const ratio = view.zoom / zoom
      const px = frame.cx + view.panX + fx * visW
      const py = frame.cy + view.panY - fy * visH
      onViewChange({ zoom, panX: px - fx * visW * ratio - frame.cx, panY: py + fy * visH * ratio - frame.cy })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerRef, onViewChange, interactive])

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const lastGestureMoved = useRef(false)
  const handlers = {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button !== 0) return
      drag.current = { x: e.clientX, y: e.clientY, moved: false }
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId)
      d.moved = true
      drag.current = { x: e.clientX, y: e.clientY, moved: true }
      onViewChange({ panX: view.panX - dx * u, panY: view.panY + dy * u })
    },
    onPointerUp() {
      lastGestureMoved.current = drag.current?.moved ?? false
      drag.current = null
    },
    onPointerCancel() {
      lastGestureMoved.current = false
      drag.current = null
    },
    onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      if (e.target !== e.currentTarget) return
      const step = 40 * u
      const pans: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      if (pans[e.key]) {
        const [x, y] = pans[e.key]
        onViewChange({ panX: view.panX + x, panY: view.panY + y })
      } else if (e.key === '+' || e.key === '=') onViewChange({ zoom: clampZoom(view.zoom * 1.25) })
      else if (e.key === '-') onViewChange({ zoom: clampZoom(view.zoom / 1.25) })
      else if (e.key === '0') onViewChange({ zoom: 1, panX: 0, panY: 0 })
      else return
      e.preventDefault()
    },
  }

  /** True when the last pointer gesture was a drag, so a click on a glyph should not select it. */
  const wasDrag = () => lastGestureMoved.current

  return { containerRef, ready, u, visW, visH, box, handlers, wasDrag }
}
