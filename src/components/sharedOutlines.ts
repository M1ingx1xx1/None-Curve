// Shared outlines for the canvas (SpecimenView): every copy of a glyph usually has the same shape, so each distinct
// outline is one path in the view's <defs> that the copies draw with <use>. A live frame then rewrites those few paths,
// and the copies (same ids, same places) skip re-rendering; the browser also reads each outline once instead of once
// per copy. Copies of a glyph can differ (mid-glide they start at different frames, and a letter may react to Sound by
// its own amount), so the outlines of glyph i are numbered g<i>-<n> in order of first use within the frame.

import { contoursToPath, polygonGlyphToPath, sourceGlyphToPath } from '../geometry/sourcePath'
import type { PolygonGlyph, SourceGlyph } from '../geometry/types'

export interface SharedOutline {
  id: string
  /** Path data in font units (y up): M, L and Z only for polygons and click outlines. */
  d: string
}

export interface SharedOutlines {
  /** The id of this glyph's outline. */
  polygon(index: number, polygon: PolygonGlyph): string
  /** The id of its click outline (PolygonGlyph.clickOutline, with thorns), or null without one. */
  click(index: number, polygon: PolygonGlyph): string | null
  /** The id of the font's own outline of glyph `index`. */
  source(index: number, source: SourceGlyph): string
  /** Every outline asked for, in order of first use: the paths to write in <defs>. */
  readonly defs: readonly SharedOutline[]
}

/** Outlines for one render of the view; `prefix` keeps the ids unique in the page (useId). */
export function sharedOutlines(prefix: string): SharedOutlines {
  const polygonsOf = new Map<number, PolygonGlyph[]>()
  const sources = new Set<number>()
  const defs: SharedOutline[] = []
  const slot = (index: number, polygon: PolygonGlyph) => {
    let list = polygonsOf.get(index)
    if (!list) polygonsOf.set(index, (list = []))
    let n = list.indexOf(polygon)
    if (n < 0) {
      n = list.push(polygon) - 1
      defs.push({ id: `${prefix}-g${index}-${n}`, d: polygonGlyphToPath(polygon) })
      if (polygon.clickOutline) defs.push({ id: `${prefix}-c${index}-${n}`, d: contoursToPath(polygon.clickOutline) })
    }
    return n
  }
  return {
    polygon: (index, polygon) => `${prefix}-g${index}-${slot(index, polygon)}`,
    click: (index, polygon) => (polygon.clickOutline ? `${prefix}-c${index}-${slot(index, polygon)}` : null),
    source(index, source) {
      const id = `${prefix}-s${index}`
      if (!sources.has(index)) {
        sources.add(index)
        defs.push({ id, d: sourceGlyphToPath(source) })
      }
      return id
    },
    defs,
  }
}
