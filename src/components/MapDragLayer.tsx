// What drag to map draws over the page (mapDrag.ts): the chip that follows the pointer, the drop palette over the
// canvas while dragging, the confirmation beside the control after a drop, and what screen readers hear at each step.

import { memo, useMemo } from 'react'
import { featureById, targetById } from '../sound/mapping'
import { useMappingState } from '../sound/mappingStore'
import { intoColumns, PALETTE_CLASS, PALETTE_COLUMN, paletteBlocks, targetName, useMapDrag } from './mapDrag'

/** The palette's distance from the canvas's edges and from its toolbar (px). */
const PALETTE_MARGIN = 12
/** The palette's padding and border across, both sides (px; .map-palette in styles.css). */
const PALETTE_FRAME = 2 * 12 + 2
/** The gap between its columns (px; .map-palette in styles.css), which PALETTE_COLUMN counts once per column. */
const PALETTE_GAP = 14
/** The least it is tall (px), on a very short canvas: a few entries, then it scrolls. */
const PALETTE_MIN_HEIGHT = 160

/**
 * Where the palette opens: over the canvas itself (between its toolbar and its Canvas size bar), PALETTE_MARGIN in from
 * every edge, so it covers neither bar nor the panels around it; as tall as its entries, scrolling when the canvas is
 * shorter. Without the canvas, right of the tab panels on view, down to the workspace's foot.
 */
function paletteBox(): { left: number; top: number; maxHeight: number; width: number } {
  const area = document.querySelector('main')?.getBoundingClientRect()
  const canvas = document.querySelector('.viewport > .canvas')?.getBoundingClientRect()
  let left: number
  let right: number
  let top = area?.top ?? 0
  let bottom = area?.bottom ?? window.innerHeight
  if (canvas && canvas.width > 0) {
    left = canvas.left + PALETTE_MARGIN
    right = canvas.right - PALETTE_MARGIN
    top = canvas.top
    bottom = canvas.bottom
  } else {
    let panels = 0
    for (const panel of document.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
      if (panel.getClientRects().length > 0) panels = Math.max(panels, panel.getBoundingClientRect().right)
    }
    left = panels + PALETTE_MARGIN
    right = window.innerWidth - PALETTE_MARGIN
  }
  top += PALETTE_MARGIN
  return {
    left,
    top,
    maxHeight: Math.max(PALETTE_MIN_HEIGHT, bottom - PALETTE_MARGIN - top),
    width: Math.max(PALETTE_COLUMN + PALETTE_FRAME, right - left),
  }
}

/** How many columns fit across a palette this wide. */
const columnsFor = (width: number) => Math.max(1, Math.floor((width - PALETTE_FRAME + PALETTE_GAP) / PALETTE_COLUMN))

/**
 * Every target as a drop zone, grouped as the target select groups them, over the canvas while a feature is dragged:
 * a drop here maps as a drop on the control does, without opening its tab. Targets the dragged feature already
 * drives are marked. Pointer only (the keyboard's pick walks the controls themselves), so hidden from screen readers.
 * Memoised: the layer renders at every pointer move (the chip follows it), and every target is an entry here.
 */
const DropPalette = memo(function DropPalette({ feature }: { feature: string }) {
  const { mappings } = useMappingState()
  const box = useMemo(() => paletteBox(), [])
  const columns = useMemo(() => intoColumns(paletteBlocks(), columnsFor(box.width)), [box])
  const mapped = useMemo(
    () => new Set(mappings.filter((m) => m.feature === feature).map((m) => m.target)),
    [mappings, feature],
  )
  return (
    <div
      className={PALETTE_CLASS}
      aria-hidden="true"
      style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
    >
      {columns.map((column, k) => (
        <div key={k} className="map-palette-column">
          {column.map((block) => (
            <section key={`${block.group ?? ''}|${block.title}`} className="map-palette-block">
              {block.group && <p className="map-palette-group">{block.group}</p>}
              <p className="map-palette-title">{block.title}</p>
              {block.targets.map(({ id, name }) => (
                <div
                  key={id}
                  className="map-palette-entry"
                  data-map-zone={id}
                  data-mapped={mapped.has(id) ? '' : undefined}
                >
                  {name}
                </div>
              ))}
            </section>
          ))}
        </div>
      ))}
    </div>
  )
})

export default function MapDragLayer() {
  const { feature, mode, x, y, over, status, announcement } = useMapDrag()
  const spec = feature ? featureById(feature) : undefined
  const target = over ? targetById(over) : undefined
  return (
    <>
      {mode === 'pointer' && feature && <DropPalette feature={feature} />}
      {mode === 'pointer' && spec && (
        <div className="map-drag-chip" aria-hidden="true" style={{ transform: `translate(${x + 14}px, ${y + 14}px)` }}>
          <span>{spec.label}</span>
          {target && <span className="map-drag-chip-target">→ {targetName(target)}</span>}
        </div>
      )}
      {status && (
        <div
          key={status.key}
          className="map-drag-status"
          aria-hidden="true"
          style={{ left: status.left, top: status.top }}
        >
          {status.text}
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  )
}
