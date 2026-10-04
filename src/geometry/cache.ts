// Shared cache of derived glyph geometry. The canvas, the specimen, and both exporters read from it,
// so every view and every exported file uses the same polygons for the same glyph and parameters.

import type { LoadedFont } from '../font/model'
import { deriveGeometry } from './pipeline'
import type { DerivedGeometry, GeometryParams } from './types'

const MAX_ENTRIES_PER_FONT = 4000

type Entry = { geometry: DerivedGeometry } | { error: string }

const caches = new WeakMap<LoadedFont, Map<string, Entry>>()

/** Stable key for a parameter set; JSON of a plain object with a fixed key order. */
export function paramsKey(params: GeometryParams): string {
  return JSON.stringify([params.flatten, params.anchors, params.grid, params.distortion])
}

/**
 * Returns the derived geometry for one glyph, computing it once per (font, glyph, parameters).
 * Throws if the glyph cannot be read or the pipeline fails; failures are cached too.
 */
export function glyphGeometry(font: LoadedFont, index: number, params: GeometryParams, key = paramsKey(params)): DerivedGeometry {
  let cache = caches.get(font)
  if (!cache) {
    cache = new Map()
    caches.set(font, cache)
  }
  const cacheKey = `${index}|${key}`
  let entry = cache.get(cacheKey)
  if (!entry) {
    try {
      entry = { geometry: deriveGeometry(font.getGlyph(index), params) }
    } catch (error) {
      entry = { error: error instanceof Error ? error.message : String(error) }
    }
    if (cache.size >= MAX_ENTRIES_PER_FONT) cache.delete(cache.keys().next().value!)
    cache.set(cacheKey, entry)
  }
  if ('error' in entry) throw new Error(entry.error)
  return entry.geometry
}
