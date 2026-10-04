import type { FontMetrics } from '../font/model'

/** Grid lines closer than this on screen are not drawn. */
export const MIN_GRID_PX = 4

/** Horizontal metric guides; guides at the same height (e.g. x-height = cap height) share one line. */
export function metricGuides(metrics: FontMetrics): [string, number][] {
  const guides: [string, number][] = []
  for (const [name, y] of [
    ['ascender', metrics.ascender],
    ['cap height', metrics.capHeight],
    ['x-height', metrics.xHeight],
    ['baseline', 0],
    ['descender', metrics.descender],
  ] as const) {
    if (y === null) continue
    const same = guides.find((g) => g[1] === y)
    if (same) same[0] = `${same[0]} / ${name}`
    else guides.push([name, y])
  }
  return guides
}

/** Snapping-grid lines inside a visible box (font units, y up), or null if too dense to draw. */
export function gridLines(
  box: { left: number; right: number; top: number; bottom: number },
  size: number | null,
  unitsPerPixel: number,
): { xs: number[]; ys: number[] } | null {
  if (!size || size / unitsPerPixel < MIN_GRID_PX) return null
  const xs: number[] = []
  const ys: number[] = []
  for (let x = Math.ceil(box.left / size) * size; x <= box.right; x += size) xs.push(x)
  for (let y = Math.ceil(box.bottom / size) * size; y <= box.top; y += size) ys.push(y)
  return { xs, ys }
}
