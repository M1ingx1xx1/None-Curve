// The flash limit (WCAG 2.3.1, see docs/SOUND_PLAN.md §10): one budget of large changes, shared by every
// driven slider (FlashLimiter, live.ts) and every driven seed (JumpTracker, jumps.ts), so that Sound makes at
// most maxFlashes flashes a second however many mappings it has. Pure: no React, no DOM, no Web Audio.
//
// A large change (an edge) is a driven slider turning back by a swing, or the sliders together doing so (see
// FlashLimiter), or a seed jump (which redraws every anchor). A flash is a pair of opposing changes, so at most
// 2 × maxFlashes edges fall within windowMs. Edges in one measured frame reach the screen together and count once.

export const FLASH_LIMITS = {
  /** At most this many flashes (pairs of large changes) a second, from all driven sliders and seeds together. */
  maxFlashes: 3,
  /**
   * Edges are remembered this long (ms): a little over a second, so that frames reaching the screen up to a quarter
   * second after they were measured (waiting for the geometry, at most one frame in flight) still make at most
   * 2 × maxFlashes edges in any second on screen.
   */
  windowMs: 1250,
  /**
   * A slider's turn counts when it moves back by at least this share of the slider's travel; for several sliders,
   * when their moves back add up to it (FlashLimiter).
   */
  swing: 0.1,
} as const

/** Edges closer than this (ms) are one measured frame's (the sliders and seeds of one frame share its time). */
const SAME_FRAME_MS = 1

/** The shared budget: the times of the recent edges. */
export class FlashBudget {
  /** Times (ms) of the edges within the window, oldest first. */
  private edges: number[] = []

  /**
   * Asks to show an edge at `time` (a measured frame's time): true when the budget allows it (it is counted, unless
   * this frame already has one), false when the budget is spent and the change must wait.
   */
  take(time: number): boolean {
    if (this.sameFrame(time)) return true
    this.forget(time)
    if (this.edges.length >= 2 * FLASH_LIMITS.maxFlashes) return false
    this.edges.push(time)
    return true
  }

  /** Counts an edge that shows whatever the budget says: Sound stopping puts the sliders and seeds back (exact restore). */
  spend(time: number): void {
    if (this.sameFrame(time)) return
    this.forget(time)
    this.edges.push(time)
  }

  /** How many of the remembered edges are at `time` or later (the precompute director's handover check). */
  countSince(time: number): number {
    let count = 0
    for (let i = this.edges.length - 1; i >= 0 && this.edges[i] >= time; i--) count++
    return count
  }

  private sameFrame(time: number): boolean {
    const last = this.edges[this.edges.length - 1]
    return last !== undefined && Math.abs(time - last) < SAME_FRAME_MS
  }

  private forget(time: number) {
    while (this.edges.length && time - this.edges[0] >= FLASH_LIMITS.windowMs) this.edges.shift()
  }
}
