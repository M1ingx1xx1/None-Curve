import { countSelfCrossings } from '../geometry/anchors'
import { signedArea } from '../geometry/flatten'
import type { Point, PolygonGlyph } from '../geometry/types'

export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded // no "-0"
}

/**
 * Rounds every contour to `decimals` places and checks that rounding did not damage it: each contour
 * must keep at least three distinct points, its direction (so counters stay holes), non-zero area,
 * and no new self-crossings. Throws ExportError naming the glyph otherwise. Output is y-up font units.
 */
export function quantizePolygon(polygon: PolygonGlyph, decimals: number, label: string): Point[][] {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new ExportError(`Precision must be a whole number from 0 to 6 (got ${decimals}).`)
  }
  return polygon.contours.map((contour) => {
    const out: Point[] = []
    for (const p of contour.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new ExportError(`${label} has a non-finite coordinate.`)
      const q = { x: roundTo(p.x, decimals), y: roundTo(p.y, decimals) }
      const last = out[out.length - 1]
      if (!last || last.x !== q.x || last.y !== q.y) out.push(q)
    }
    while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop()

    const before = signedArea(contour.points)
    const after = signedArea(out)
    const places = decimals === 0 ? 'whole units' : `${decimals} decimal place${decimals === 1 ? '' : 's'}`
    if (out.length < 3 || Math.abs(after) < 1e-9 || Math.sign(after) !== Math.sign(before)) {
      throw new ExportError(`${label}: a contour collapses or flips when coordinates are rounded to ${places}. Use a higher precision.`)
    }
    const crossings = countSelfCrossings(out)
    if (crossings > 0 && crossings > countSelfCrossings(contour.points)) {
      throw new ExportError(`${label}: rounding to ${places} makes a contour cross itself. Use a higher precision.`)
    }
    return out
  })
}
