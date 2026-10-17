// How the contours of a glyph sit relative to each other. A letter's counters (the holes in A, B, e)
// must stay inside its outer contour, separate parts must stay apart, and nested parts must not cut
// through each other: otherwise the fill rule paints the letter wrong, and a counter that leaves its
// letter becomes a solid blob beside it. Every step that changes contours checks each new contour
// against the glyph's other contours here, as well as against itself.
//
// Steps change contours one at a time and check each new contour against the others as they are at
// that moment (already changed or not yet). The last contour of any pair to change is checked against
// the other's final points, and a contour that keeps its old points was valid against all of them, so
// the finished glyph is valid as a whole.

import { findRingCrossings, insideRing, ringBox, type Box } from './crossings'
import type { Point } from './types'

interface Relation {
  /** The two contours cross or touch. Contours that already do so in the reference may keep doing so. */
  meet: boolean
  /** The first contour lies inside the second. */
  aInB: boolean
  /** The second contour lies inside the first. */
  bInA: boolean
}

export class ContourLayout {
  private relations = new Map<number, Relation>()

  /** `reference`: the contours whose arrangement must be kept, such as the outline before a step. */
  constructor(private readonly reference: readonly (readonly Point[])[]) {}

  /** True when `a` (standing for contour k) and `b` (for contour m) sit like contours k and m of the reference. */
  pairKept(k: number, m: number, a: readonly Point[], b: readonly Point[]): boolean {
    const before = this.relation(k, m)
    if (before.meet) return true
    const now = relate(a, b)
    return !now.meet && now.aInB === before.aInB && now.bInA === before.bInA
  }

  /**
   * True when contour k, with these points, sits like it did against every other contour of `current`
   * (indexed like the reference; null for contours left out).
   */
  keeps(current: readonly (readonly Point[] | null)[], k: number, points: readonly Point[]): boolean {
    for (let m = 0; m < current.length; m++) {
      const other = current[m]
      if (m !== k && other && !this.pairKept(k, m, points, other)) return false
    }
    return true
  }

  private relation(k: number, m: number): Relation {
    const [lo, hi] = k < m ? [k, m] : [m, k]
    const key = lo * 65536 + hi
    let relation = this.relations.get(key)
    if (!relation) {
      relation = relate(this.reference[lo], this.reference[hi])
      this.relations.set(key, relation)
    }
    return k < m ? relation : { meet: relation.meet, aInB: relation.bInA, bInA: relation.aInB }
  }
}

/** Whether two closed rings cross or touch, and if not, whether either lies inside the other. */
export function relate(a: readonly Point[], b: readonly Point[]): Relation {
  const boxA = ringBox(a)
  const boxB = ringBox(b)
  if (boxA.maxX < boxB.minX || boxB.maxX < boxA.minX || boxA.maxY < boxB.minY || boxB.maxY < boxA.minY) {
    return { meet: false, aInB: false, bInA: false }
  }
  if (findRingCrossings(a, b, 0).length > 0) return { meet: true, aInB: false, bInA: false }
  // Rings that do not meet are either nested or apart, so one point of each tells which.
  return {
    meet: false,
    aInB: encloses(boxB, boxA) && insideRing(a[0], b),
    bInA: encloses(boxA, boxB) && insideRing(b[0], a),
  }
}

const encloses = (outer: Box, inner: Box) =>
  outer.minX <= inner.minX && outer.maxX >= inner.maxX && outer.minY <= inner.minY && outer.maxY >= inner.maxY
