import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { FontMetrics } from '../font/model'
import { polygonGlyphToPath, sourceGlyphBounds, sourceGlyphSkeleton, sourceGlyphToPath } from '../geometry/sourcePath'
import type { PolygonGlyph, SourceGlyph } from '../geometry/types'
import type { ViewParams } from '../state/types'

interface GlyphViewProps {
  glyph: SourceGlyph
  /** Final polygon after the whole pipeline, or null when it could not be derived. */
  polygon: PolygonGlyph | null
  /** Snapping grid spacing in font units, drawn for reference only; null hides it. */
  gridSize: number | null
  fontMetrics: FontMetrics
  view: ViewParams
  label: string
  onViewChange: (patch: Partial<ViewParams>) => void
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 40
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

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

/** Renders one glyph in font units (y-up) with metric guides and an optional curve skeleton. */
/** Grid lines closer than this on screen are not drawn. */
const MIN_GRID_PX = 4

export default function GlyphView({ glyph, polygon, gridSize, fontMetrics, view, label, onViewChange }: GlyphViewProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>()
  const path = useMemo(() => sourceGlyphToPath(glyph), [glyph])
  const polygonPath = useMemo(() => (polygon ? polygonGlyphToPath(polygon) : ''), [polygon])
  const vertices = useMemo(() => polygon?.contours.flatMap((c) => c.points) ?? [], [polygon])
  const skeleton = useMemo(() => sourceGlyphSkeleton(glyph), [glyph])
  const { advanceWidth } = glyph.metrics
  const { ascender, descender, xHeight, capHeight } = fontMetrics

  // Frame at zoom 1: advance box and vertical metrics, grown to include any overshooting outline.
  const frame = useMemo(() => {
    const b = sourceGlyphBounds(glyph)
    const minX = Math.min(0, b?.minX ?? 0)
    const maxX = Math.max(advanceWidth, b?.maxX ?? 0, minX + 1)
    const minY = Math.min(descender, b?.minY ?? 0)
    const maxY = Math.max(ascender, b?.maxY ?? 0)
    const pad = 0.08 * Math.max(maxX - minX, maxY - minY)
    return {
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    }
  }, [glyph, advanceWidth, ascender, descender])

  const ready = size.width > 0 && size.height > 0
  const scale = ready ? Math.min(size.width / frame.width, size.height / frame.height) * view.zoom : 1
  const u = 1 / scale // font units per screen pixel
  const visW = size.width * u
  const visH = size.height * u
  const cx = frame.cx + view.panX
  const cy = frame.cy + view.panY
  const left = cx - visW / 2
  const right = cx + visW / 2
  const top = cy + visH / 2
  const bottom = cy - visH / 2

  // Wheel zoom keeps the point under the cursor fixed. Registered natively so it can preventDefault.
  const latest = useRef({ view, frame, visW, visH, size })
  latest.current = { view, frame, visW, visH, size }
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
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
      onViewChange({
        zoom,
        panX: px - fx * visW * ratio - frame.cx,
        panY: py + fy * visH * ratio - frame.cy,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerRef, onViewChange])

  const drag = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY }
    onViewChange({ panX: view.panX - dx * u, panY: view.panY + dy * u })
  }
  const endDrag = () => {
    drag.current = null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
  }

  // Guides at the same height (e.g. x-height = cap height in an all-caps font) share one line.
  const guides: [string, number][] = []
  for (const [name, y] of [
    ['ascender', ascender],
    ['cap height', capHeight],
    ['x-height', xHeight],
    ['baseline', 0],
    ['descender', descender],
  ] as const) {
    if (y === null) continue
    const same = guides.find((g) => g[1] === y)
    if (same) same[0] = `${same[0]} / ${name}`
    else guides.push([name, y])
  }
  const r = 3.5 * u
  const { outline } = view

  // Snapping grid in font units, anchored at the origin. Display only; never part of the polygon.
  let gridLines: { xs: number[]; ys: number[] } | null = null
  if (ready && gridSize && gridSize / u >= MIN_GRID_PX) {
    const xs: number[] = []
    const ys: number[] = []
    for (let x = Math.ceil(left / gridSize) * gridSize; x <= right; x += gridSize) xs.push(x)
    for (let y = Math.ceil(bottom / gridSize) * gridSize; y <= top; y += gridSize) ys.push(y)
    gridLines = { xs, ys }
  }

  return (
    <div
      ref={containerRef}
      className="glyph-view"
      tabIndex={0}
      role="img"
      aria-label={`${label}. Drag or use arrow keys to pan, scroll or +/− to zoom, 0 to fit.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      {ready && (
        <svg viewBox={`${left} ${-top} ${visW} ${visH}`} preserveAspectRatio="none" aria-hidden="true">
          {gridLines && (
            <g className="snap-grid">
              {gridLines.xs.map((x) => (
                <line key={`x${x}`} x1={x} x2={x} y1={-top} y2={-bottom} vectorEffect="non-scaling-stroke" />
              ))}
              {gridLines.ys.map((y) => (
                <line key={`y${y}`} x1={left} x2={right} y1={-y} y2={-y} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {view.showMetrics && (
            <g className="metric-lines">
              {guides.map(([name, y]) => (
                <g key={name} className={y === 0 ? 'metric-baseline' : undefined}>
                  <line x1={left} x2={right} y1={-y} y2={-y} vectorEffect="non-scaling-stroke" />
                  <text x={left + 8 * u} y={-y - 4 * u} fontSize={10 * u}>
                    {name}
                  </text>
                </g>
              ))}
              {[0, advanceWidth].map((x, i) => (
                <line key={i} className="metric-advance" x1={x} x2={x} y1={-top} y2={-bottom} vectorEffect="non-scaling-stroke" />
              ))}
              <text x={advanceWidth + 4 * u} y={-top + 14 * u} fontSize={10 * u}>
                advance {advanceWidth}
              </text>
            </g>
          )}

          <g transform="scale(1 -1)">
            {outline === 'source' &&
              (view.showFill ? (
                <path className="glyph-fill" d={path} />
              ) : (
                <path className="outline-stroke" d={path} vectorEffect="non-scaling-stroke" />
              ))}
            {outline === 'flattened' &&
              polygon &&
              (view.showFill ? (
                <path className="glyph-fill" d={polygonPath} />
              ) : (
                <path className="outline-stroke" d={polygonPath} vectorEffect="non-scaling-stroke" />
              ))}
            {outline === 'compare' && (
              <g className="compare">
                {view.showFill && polygon && <path className="glyph-fill compare-fill" d={polygonPath} />}
                {polygon && <path className="outline-stroke" d={polygonPath} vectorEffect="non-scaling-stroke" />}
                <path className="compare-source" d={path} vectorEffect="non-scaling-stroke" />
              </g>
            )}
            {view.showSkeleton && (
              <g className="skeleton">
                <path className="skeleton-outline" d={path} vectorEffect="non-scaling-stroke" />
                {skeleton.handles.map(([a, b], i) => (
                  <line key={i} className="skeleton-handle" x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
                ))}
                {skeleton.controls.map((p, i) => (
                  <circle key={i} className="skeleton-control" cx={p.x} cy={p.y} r={r} vectorEffect="non-scaling-stroke" />
                ))}
                {skeleton.anchors.map((p, i) => (
                  <rect key={i} className="skeleton-anchor" x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            )}
            {view.showVertices && polygon && (
              <g className="vertices">
                {vertices.map((p, i) => (
                  <circle key={i} className="polygon-vertex" cx={p.x} cy={p.y} r={r * 0.7} />
                ))}
              </g>
            )}
          </g>
        </svg>
      )}
      {ready && gridSize && (
        <p className="canvas-grid-note" aria-hidden="true">
          Snap grid {gridSize} u{gridLines ? '' : ' · too dense to draw at this zoom'}
        </p>
      )}
    </div>
  )
}
