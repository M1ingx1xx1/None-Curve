// The key a parameter set is cached and asked for by, on the page and in the workers alike. Kept apart from cache.ts,
// which runs the pipeline, so the page can name a parameter set without loading the geometry.

import type { GeometryParams } from './types'

/**
 * Stable key for a parameter set; JSON of a plain object with a fixed key order. Axis values (`variation`) join it
 * only when there are any, so every key without them is what it always was.
 */
export function paramsKey(params: GeometryParams): string {
  const groups = [
    params.flatten,
    params.random,
    params.squaring,
    params.anchors,
    params.grid,
    params.distortion,
    params.experimental,
  ]
  return JSON.stringify(params.variation ? [...groups, params.variation] : groups)
}
