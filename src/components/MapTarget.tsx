// A control's drop zone for drag to map (mapDrag.ts). The live marker of every control Sound can drive renders one,
// so each target has a zone without its panel naming it twice.

import { useLayoutEffect, useRef } from 'react'
import { ZONE_SELECTOR } from './mapDrag'

/**
 * Marks the field this sits in (the nearest `.field`, or a variable axis's `li`) as the drop zone of `target`:
 * a hidden anchor that sets data-map-zone on it. With a `label`, the anchor is a zone of its own instead, shown
 * only while dragging: a field that holds two targets (a colour's Hue and Lightness) shows one small zone each.
 */
export default function MapTarget({ target, label }: { target: string; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const anchor = ref.current
    if (!anchor || label) return
    const zone = anchor.parentElement?.closest<HTMLElement>(ZONE_SELECTOR) ?? anchor.parentElement
    if (!zone) return
    zone.setAttribute('data-map-zone', target)
    return () => {
      if (zone.getAttribute('data-map-zone') === target) zone.removeAttribute('data-map-zone')
    }
  }, [target, label])
  return label ? (
    <span ref={ref} className="map-zone-chip" data-map-target={target} data-map-zone={target} aria-hidden="true">
      {label}
    </span>
  ) : (
    <span ref={ref} data-map-target={target} hidden />
  )
}
