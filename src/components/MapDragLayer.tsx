// What drag to map draws over the page (mapDrag.ts): the chip that follows the pointer, the drop palette beside the
// panel while dragging, the confirmation beside the control after a drop, and what screen readers hear at each step.

import { memo, useMemo } from 'react'
import { featureById, targetById } from '../sound/mapping'
import { useMappingState } from '../sound/mappingStore'
import { intoColumns, PALETTE_CLASS, PALETTE_COLUMN, paletteBlocks, targetName, useMapDrag } from './mapDrag'

/**
 * Where the palette opens: in the workspace, right of the panels (the tab panels on view), 12px in from its edges; as
 * tall as its entries, at most down to the workspace's foot.
 */
function paletteBox(): { left: number; top: number; maxHeight: number; width: number } {
  let right = 0
  for (const panel of document.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
    if (panel.getClientRects().length > 0) right = Math.max(right, panel.getBoundingClientRect().right)
  }
  const area = document.querySelector('main')?.getBoundingClientRect()
  const left = right + 12
  const top = (area?.top ?? 0) + 12
  return {
    left,
    top,
    maxHeight: (area?.bottom ?? window.innerHeight) - 12 - top,
    width: Math.max(PALETTE_COLUMN, window.innerWidth - left - 12),
  }
}

/**
 * Every target as a drop zone, grouped as the target select groups them, over the canvas while a feature is dragged:
 * a drop here maps as a drop on the control does, without opening its tab. Targets the dragged feature already
 * drives are marked. Pointer only (the keyboard's pick walks the controls themselves), so hidden from screen readers.
 * Memoised: the layer renders at every pointer move (the chip follows it), and every target is an entry here.
 */
const DropPalette = memo(function DropPalette({ feature }: { feature: string }) {
  const { mappings } = useMappingState()
  const box = useMemo(() => paletteBox(), [])
  const columns = useMemo(() => intoColumns(paletteBlocks(), Math.max(1, Math.floor(box.width / PALETTE_COLUMN))), [box])
  const mapped = useMemo(() => new Set(mappings.filter((m) => m.feature === feature).map((m) => m.target)), [mappings, feature])
  return (
    <div className={PALETTE_CLASS} aria-hidden="true" style={{ left: box.left, top: box.top, maxHeight: box.maxHeight }}>
      {columns.map((column, k) => (
        <div key={k} className="map-palette-column">
          {column.map((block) => (
            <section key={`${block.group ?? ''}|${block.title}`} className="map-palette-block">
              {block.group && <p className="map-palette-group">{block.group}</p>}
              <p className="map-palette-title">{block.title}</p>
              {block.targets.map(({ id, name }) => (
                <div key={id} className="map-palette-entry" data-map-zone={id} data-mapped={mapped.has(id) ? '' : undefined}>
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
        <div key={status.key} className="map-drag-status" aria-hidden="true" style={{ left: status.left, top: status.top }}>
          {status.text}
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  )
}
