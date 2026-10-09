// Shared cache of derived glyph geometry. The canvas, the specimen, and both exporters read from it,
// so every view and every exported file uses the same polygons for the same glyph and parameters.

import type { LoadedFont } from '../font/model'
import { deriveGeometry } from './pipeline'
import type { DerivedGeometry, GeometryParams } from './types'

const MAX_ENTRIES_PER_FONT = 4000
/**
 * Most polygon points kept per font. Dense settings (Anchor spacing 1) make glyphs of thousands of
 * points; without a budget, a whole-font export would keep gigabytes of them.
 */
const MAX_POINTS_PER_FONT = 1_000_000

type Entry = { geometry: DerivedGeometry; points: number } | { error: string; points: number }

interface FontCache {
  entries: Map<string, Entry>
  points: number
}

const caches = new WeakMap<LoadedFont, FontCache>()

/** Stable key for a parameter set; JSON of a plain object with a fixed key order. */
export function paramsKey(params: GeometryParams): string {
  return JSON.stringify([params.flatten, params.random, params.squaring, params.anchors, params.grid, params.distortion])
}

/**
 * Returns the derived geometry for one glyph, computing it once per (font, glyph, parameters).
 * Throws if the glyph cannot be read or the pipeline fails; failures are cached too. The cache keeps
 * the most recently used results, up to an entry count and a total number of polygon points.
 */
export function glyphGeometry(font: LoadedFont, index: number, params: GeometryParams, key = paramsKey(params)): DerivedGeometry {
  let cache = caches.get(font)
  if (!cache) {
    cache = { entries: new Map(), points: 0 }
    caches.set(font, cache)
  }
  const cacheKey = `${index}|${key}`
  let entry = cache.entries.get(cacheKey)
  if (entry) {
    // Most recently used goes last, so eviction (from the front) drops the least recently used.
    cache.entries.delete(cacheKey)
    cache.entries.set(cacheKey, entry)
  } else {
    try {
      const geometry = deriveGeometry(font.getGlyph(index), params)
      entry = { geometry, points: geometry.vertexCount }
    } catch (error) {
      entry = { error: error instanceof Error ? error.message : String(error), points: 0 }
    }
    cache.entries.set(cacheKey, entry)
    cache.points += entry.points
    while (cache.entries.size > 1 && (cache.entries.size > MAX_ENTRIES_PER_FONT || cache.points > MAX_POINTS_PER_FONT)) {
      const [oldest, evicted] = cache.entries.entries().next().value!
      cache.entries.delete(oldest)
      cache.points -= evicted.points
    }
  }
  if ('error' in entry) throw new Error(entry.error)
  return entry.geometry
}
