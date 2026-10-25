// Where the canvas looks (zoom and pan): a small store outside the editor state, so a drag or a wheel turn
// re-renders the canvas alone rather than the whole app. Neither undone nor saved; Fit, a new font and Reset all
// put it back (App.tsx).

import { useSyncExternalStore } from 'react'
import type { PanZoom } from './types'

export const DEFAULT_PAN_ZOOM: PanZoom = { zoom: 1, panX: 0, panY: 0 }

const isDefault = ({ zoom, panX, panY }: PanZoom) =>
  zoom === DEFAULT_PAN_ZOOM.zoom && panX === DEFAULT_PAN_ZOOM.panX && panY === DEFAULT_PAN_ZOOM.panY

export function createPanZoomStore() {
  let state = DEFAULT_PAN_ZOOM
  const listeners = new Set<() => void>()
  const update = (patch: Partial<PanZoom>) => {
    const next = { ...state, ...patch }
    // The same object until a value changes, so useSyncExternalStore re-renders only for a real move.
    if (next.zoom === state.zoom && next.panX === state.panX && next.panY === state.panY) return
    state = next
    for (const listener of listeners) listener()
  }
  return {
    getState: () => state,
    update,
    reset: () => update(DEFAULT_PAN_ZOOM),
    /** Zoomed or panned away from the fitted view. */
    moved: () => !isDefault(state),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The result canvas's zoom and pan. */
export const panZoomStore = createPanZoomStore()

export function usePanZoomState(): PanZoom {
  return useSyncExternalStore(panZoomStore.subscribe, panZoomStore.getState)
}

/** Whether the canvas is zoomed or panned; re-renders only when that changes (Reset all's check). */
export function usePanZoomMoved(): boolean {
  return useSyncExternalStore(panZoomStore.subscribe, panZoomStore.moved)
}
