import { useSyncExternalStore } from 'react'

const ratioNow = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1

/**
 * Calls `onChange` when devicePixelRatio changes (the window moved to another monitor, or the browser zoomed): a media
 * query matching the ratio now stops matching, and is armed again for the new ratio.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  let query: MediaQueryList | null = null
  const arm = () => {
    query?.removeEventListener('change', changed)
    query = window.matchMedia(`(resolution: ${ratioNow()}dppx)`)
    query.addEventListener('change', changed)
  }
  const changed = () => {
    arm()
    onChange()
  }
  arm()
  return () => query?.removeEventListener('change', changed)
}

/** The window's devicePixelRatio, rendering again when it changes (a canvas sizes its backing store by it). */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribe, ratioNow, () => 1)
}
