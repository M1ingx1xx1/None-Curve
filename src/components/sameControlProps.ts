/**
 * Props comparison for the memoized Geometry and Experimental controls: every prop by identity, except
 * `stats`, by value. Each live frame's worker results bring new statistics objects, but the steps
 * before a driven parameter give the same numbers, so their groups need not render again.
 */
export function sameControlProps<P extends object>(prev: Readonly<P>, next: Readonly<P>): boolean {
  const a = prev as Record<string, unknown>
  const b = next as Record<string, unknown>
  const keys = Object.keys(b)
  if (keys.length !== Object.keys(a).length) return false
  return keys.every((k) => Object.is(a[k], b[k]) || (k === 'stats' && JSON.stringify(a[k]) === JSON.stringify(b[k])))
}
