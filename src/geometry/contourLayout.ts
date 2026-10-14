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

import { findRingCrossings, insideRing, ringBox, type Box, type RingIndex } from './crossings'
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
  /** How pairs of reference contours sit, by lo × reference.length + hi (only pairs that are not plainly apart). */
  private relations = new Map<number, Relation>()
  private referenceBoxes: Box[] = []
  /** The points last passed for each contour, and their boxes: callers pass the same ones again and again. */
  private seen: (readonly Point[] | undefined)[] = []
  private seenBoxes: Box[] = []

  /** `reference`: the contours whose arrangement must be kept, such as the outline before a step. */
  constructor(private readonly reference: readonly (readonly Point[])[]) {}

  /** True when `a` (standing for contour k) and `b` (for contour m) sit like contours k and m of the reference. */
  pairKept(k: number, m: number, a: readonly Point[], b: readonly Point[]): boolean {
    // Boxes apart, in the reference and now: neither crosses nor holds the other, then or now. Most pairs of a glyph
    // with many contours (thousands, after strong effects) are, so they are told without remembering anything.
    if (apart(this.referenceBox(k), this.referenceBox(m)) && apart(this.boxOf(k, a), this.boxOf(m, b))) return true
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
    const key = lo * this.reference.length + hi
    let relation = this.relations.get(key)
    if (!relation) {
      relation = relate(this.reference[lo], this.reference[hi])
      this.relations.set(key, relation)
    }
    return k < m ? relation : { meet: relation.meet, aInB: relation.bInA, bInA: relation.aInB }
  }

  private referenceBox(k: number): Box {
    return (this.referenceBoxes[k] ??= ringBox(this.reference[k]))
  }

  private boxOf(k: number, points: readonly Point[]): Box {
    if (this.seen[k] !== points) {
      this.seen[k] = points
      this.seenBoxes[k] = ringBox(points)
    }
    return this.seenBoxes[k]
  }
}

/**
 * Whether two closed rings cross or touch, and if not, whether either lies inside the other. Indexes of
 * either ring (see RingIndex) only make it faster.
 */
export function relate(a: readonly Point[], b: readonly Point[], indexA?: RingIndex, indexB?: RingIndex): Relation {
  const boxA = ringBox(a)
  const boxB = ringBox(b)
  if (apart(boxA, boxB)) return { meet: false, aInB: false, bInA: false }
  if (findRingCrossings(a, b, 0, indexA, indexB).length > 0) return { meet: true, aInB: false, bInA: false }
  // Rings that do not meet are either nested or apart, so one point of each tells which.
  return {
    meet: false,
    aInB: encloses(boxB, boxA) && (indexB?.points === b ? indexB.contains(a[0]) : insideRing(a[0], b)),
    bInA: encloses(boxA, boxB) && (indexA?.points === a ? indexA.contains(b[0]) : insideRing(b[0], a)),
  }
}

/** True when the boxes have no point in common. */
const apart = (a: Box, b: Box) => a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY

const encloses = (outer: Box, inner: Box) =>
  outer.minX <= inner.minX && outer.maxX >= inner.maxX && outer.minY <= inner.minY && outer.maxY >= inner.maxY
