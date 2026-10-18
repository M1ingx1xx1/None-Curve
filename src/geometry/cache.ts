// Shared cache of derived glyph geometry. The canvas, the specimen, and both exporters read from it,
// so every view and every exported file uses the same polygons for the same glyph and parameters.
// Live frames (parameters Sound is driving) keep a second, smaller cache of their own, so a song
// does not push the results of normal editing out of the main one.

import type { LoadedFont } from '../font/model'
import { deriveGeometry } from './pipeline'
import type { DerivedGeometry, GeometryParams } from './types'

const MAX_ENTRIES_PER_FONT = 4000
/**
 * Most polygon points kept per font. Dense settings (Anchor spacing 1) make glyphs of thousands of
 * points; without a budget, a whole-font export would keep gigabytes of them.
 */
const MAX_POINTS_PER_FONT = 1_000_000
/** The live cache's limits: enough for repeated values of a song's frames, small next to the main cache. */
const MAX_LIVE_ENTRIES_PER_FONT = 600
const MAX_LIVE_POINTS_PER_FONT = 200_000

type Entry = { geometry: DerivedGeometry; points: number } | { error: string; points: number }

interface FontCache {
  entries: Map<string, Entry>
  points: number
}

interface Limits {
  entries: number
  points: number
}

let MAIN_LIMITS: Limits = { entries: MAX_ENTRIES_PER_FONT, points: MAX_POINTS_PER_FONT }
let LIVE_LIMITS: Limits = { entries: MAX_LIVE_ENTRIES_PER_FONT, points: MAX_LIVE_POINTS_PER_FONT }

/**
 * Keeps 1/`parts` of the limits above: each of the page's geometry workers holds its own cache, and a glyph mostly goes
 * to one of them, so the pool together keeps what one cache did. Takes effect as results are next kept.
 */
export function shareCacheLimits(parts: number) {
  const n = Math.max(1, Math.floor(parts) || 1)
  MAIN_LIMITS = { entries: Math.ceil(MAX_ENTRIES_PER_FONT / n), points: Math.ceil(MAX_POINTS_PER_FONT / n) }
  LIVE_LIMITS = { entries: Math.ceil(MAX_LIVE_ENTRIES_PER_FONT / n), points: Math.ceil(MAX_LIVE_POINTS_PER_FONT / n) }
}

/** True when a result for this glyph and key is cached already (glyphGeometry returns it without computing). */
export function isCached(font: LoadedFont, index: number, key: string): boolean {
  const cacheKey = `${index}|${key}`
  return caches.get(font)?.entries.has(cacheKey) === true || liveCaches.get(font)?.entries.has(cacheKey) === true
}

const caches = new WeakMap<LoadedFont, FontCache>()
const liveCaches = new WeakMap<LoadedFont, FontCache>()

/**
 * Stable key for a parameter set; JSON of a plain object with a fixed key order. Axis values (`variation`) join it
 * only when there are any, so every key without them is what it always was.
 */
export function paramsKey(params: GeometryParams): string {
  const groups = [params.flatten, params.random, params.squaring, params.anchors, params.grid, params.distortion, params.experimental]
  return JSON.stringify(params.variation ? [...groups, params.variation] : groups)
}

/**
 * Returns the derived geometry for one glyph, computing it once per (font, glyph, parameters).
 * Throws if the glyph cannot be read or the pipeline fails; failures are cached too. The cache keeps
 * the most recently used results, up to an entry count and a total number of polygon points.
 *
 * `live` marks a frame of parameters Sound is driving: it reads the main cache without changing it
 * and keeps its own results in the live cache. A normal call that finds its result only in the live
 * cache (a frame Freeze kept) moves it to the main cache instead of computing it again.
 */
export function glyphGeometry(
  font: LoadedFont,
  index: number,
  params: GeometryParams,
  key = paramsKey(params),
  live = false,
): DerivedGeometry {
  const cacheKey = `${index}|${key}`
  let entry: Entry | undefined
  if (live) {
    entry = caches.get(font)?.entries.get(cacheKey)
    if (!entry) {
      const cache = fontCache(liveCaches, font)
      entry = touch(cache, cacheKey)
      if (!entry) {
        entry = derive(font, index, params)
        insert(cache, cacheKey, entry, LIVE_LIMITS)
      }
    }
  } else {
    const cache = fontCache(caches, font)
    entry = touch(cache, cacheKey)
    if (!entry) {
      entry = take(liveCaches.get(font), cacheKey) ?? derive(font, index, params)
      insert(cache, cacheKey, entry, MAIN_LIMITS)
    }
  }
  if ('error' in entry) throw new Error(entry.error)
  return entry.geometry
}

function fontCache(map: WeakMap<LoadedFont, FontCache>, font: LoadedFont): FontCache {
  let cache = map.get(font)
  if (!cache) {
    cache = { entries: new Map(), points: 0 }
    map.set(font, cache)
  }
  return cache
}

/** The entry, made the most recently used: eviction (from the front) drops the least recently used. */
function touch(cache: FontCache, cacheKey: string): Entry | undefined {
  const entry = cache.entries.get(cacheKey)
  if (entry) {
    cache.entries.delete(cacheKey)
    cache.entries.set(cacheKey, entry)
  }
  return entry
}

/** Removes the entry and returns it. */
function take(cache: FontCache | undefined, cacheKey: string): Entry | undefined {
  const entry = cache?.entries.get(cacheKey)
  if (cache && entry) {
    cache.entries.delete(cacheKey)
    cache.points -= entry.points
  }
  return entry
}

function insert(cache: FontCache, cacheKey: string, entry: Entry, limits: Limits) {
  cache.entries.set(cacheKey, entry)
  cache.points += entry.points
  while (cache.entries.size > 1 && (cache.entries.size > limits.entries || cache.points > limits.points)) {
    const [oldest, evicted] = cache.entries.entries().next().value!
    cache.entries.delete(oldest)
    cache.points -= evicted.points
  }
}

function derive(font: LoadedFont, index: number, params: GeometryParams): Entry {
  try {
    // With axis values, the outline of the font's instance at them (the key holds them too).
    const source = params.variation && font.at ? font.at(params.variation) : font
    const geometry = deriveGeometry(source.getGlyph(index), params)
    // With Thorn, the result also keeps the letter's click outline.
    const click = geometry.polygon.clickOutline
    const clickPoints = click && click !== geometry.polygon.contours ? click.reduce((n, c) => n + c.points.length, 0) : 0
    return { geometry, points: geometry.vertexCount + clickPoints }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), points: 0 }
  }
}
