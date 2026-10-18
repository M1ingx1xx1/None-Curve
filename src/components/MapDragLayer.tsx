// What drag to map draws over the page (mapDrag.ts): the chip that follows the pointer, the confirmation beside the
// control after a drop, and what screen readers hear at each step.

import { featureById, targetById } from '../sound/mapping'
import { targetName, useMapDrag } from './mapDrag'

export default function MapDragLayer() {
  const { feature, mode, x, y, over, status, announcement } = useMapDrag()
  const spec = feature ? featureById(feature) : undefined
  const target = over ? targetById(over) : undefined
  return (
    <>
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
