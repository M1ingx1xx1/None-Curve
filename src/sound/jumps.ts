// Seeds that jump with the sound: how far each driven seed has moved on, from the measured frames (see
// docs/SOUND_PLAN.md §5, §10). Pure: no React, no DOM, no Web Audio.
//
// A mapping to a seed (a jump target) moves it on by one on each jump, so every anchor lands somewhere
// new. Its Depth, as a Rate (the sign is ignored), sets how often: a Beat mapping counts onsets (from either
// detector; Rate 100%: every one, 50%: every other one), any other feature jumps at a rate that follows its value,
// up to maxRate a second at Rate 100%. Seeds that jump in the same frame jump together, and each such frame is
// a large change taken from the flash budget the driven sliders share (flash.ts): over budget, the jump is skipped.
//
// Shaping (shaping.ts): in Follow mode a continuous feature is read after its Gate, Smooth and Curve; Beat counts its
// onsets as ever. In Trigger and Toggle mode every rise past the Gate counts as an onset does (Rate 50%: every other
// one). Range does nothing on a seed.

import type { GeometryParams } from '../geometry/types'
import { FLASH_LIMITS, FlashBudget } from './flash'
import { featureById, shapeStateless, targetById, type Mapping, type TargetSpec } from './mapping'
import { NO_SHAPING, type ShapedFrame } from './shaping'
import { SILENT_FRAME, type FeatureFrame } from './types'

export const JUMP_LIMITS = {
  /**
   * Jumps a second at Rate 100% while a continuous feature reads 1: the most the flash limit allows on average
   * (2 × maxFlashes edges within windowMs, FLASH_LIMITS: 4.8).
   */
  maxRate: (2 * FLASH_LIMITS.maxFlashes * 1000) / FLASH_LIMITS.windowMs,
  /** A longer gap between measured frames counts as this long (ms), so a stall does not release a burst of jumps. */
  maxStepMs: 100,
} as const

const NO_JUMPS: ReadonlyMap<string, number> = new Map()
/** Progress this close under a whole number counts as reaching it (Rate steps of 1% do not add up exactly). */
const EPSILON = 1e-9

/**
 * Counts the jumps of every driven seed (see the file comment). Feed it every measured frame while Sound
 * can drive the letters; modulate() adds the jumps to the seed fields' values.
 */
export class JumpTracker {
  /** Progress towards the next jump of each mapping that drives a seed, by mapping id; whole jumps are given up. */
  private progress = new Map<string, number>()
  /** Jumps so far by target id, wrapped past the largest seed; replaced (never changed) when it changes. */
  private current: ReadonlyMap<string, number> = NO_JUMPS
  private lastTime: number | null = null
  // Reused every frame.
  private readonly drivers = new Set<string>()
  private readonly driven = new Set<string>()
  private readonly wanting = new Set<TargetSpec>()

  /** @param budget the flash budget, shared with the driven sliders (LiveScheduler); its own when alone */
  constructor(private readonly budget = new FlashBudget()) {}

  /**
   * Advances with one measured frame and returns the jumps so far by target id (the same Map object when nothing
   * changed). Uses frame.time for the time step and the flash budget. SILENT_FRAME / time <= 0: no change.
   * `strength` (the Response group's Strength) multiplies every Rate, which still caps at 1. `shaped`: this frame's
   * shaping (ShapingTracker); without it, Follow is shaped without memory and Trigger and Toggle never jump.
   */
  advance(
    frame: FeatureFrame,
    mappings: readonly Mapping[],
    base: GeometryParams,
    strength = 1,
    shaped: ShapedFrame = NO_SHAPING,
  ): ReadonlyMap<string, number> {
    if (frame === SILENT_FRAME || !(frame.time > 0)) return this.current
    const dt = this.lastTime === null ? 0 : Math.min(JUMP_LIMITS.maxStepMs, Math.max(0, frame.time - this.lastTime))
    this.lastTime = frame.time
    const { drivers, driven, wanting } = this
    drivers.clear()
    driven.clear()
    wanting.clear()
    for (const mapping of mappings) {
      if (!mapping.enabled || mapping.depth === 0 || !Number.isFinite(mapping.depth)) continue
      const spec = targetById(mapping.target)
      if (!spec || spec.kind !== 'jump' || spec.inactive(base) !== null) continue
      drivers.add(mapping.id)
      driven.add(spec.id)
      const rate = Math.min(1, strength * Math.abs(mapping.depth))
      const event = featureById(mapping.feature)?.event
      const step =
        (mapping.mode ?? 'follow') !== 'follow'
          ? shaped.rises.has(mapping.id)
            ? rate
            : 0
          : event
            ? frame[event] === true
              ? rate
              : 0
            : (rate *
                Math.abs(shaped.values.get(mapping.id) ?? shapeStateless(mapping, frame)) *
                JUMP_LIMITS.maxRate *
                dt) /
              1000
      let sum = (this.progress.get(mapping.id) ?? 0) + step
      const whole = Math.floor(sum + EPSILON)
      if (whole >= 1) {
        sum = Math.max(0, sum - whole)
        wanting.add(spec)
      }
      this.progress.set(mapping.id, sum)
    }

    // Mappings that are gone or no longer drive a seed lose their progress; seeds no longer driven, their jumps.
    for (const id of this.progress.keys()) if (!drivers.has(id)) this.progress.delete(id)
    let next: Map<string, number> | null = null
    for (const id of this.current.keys()) {
      if (driven.has(id)) continue
      next ??= new Map(this.current)
      next.delete(id)
    }
    // Over the budget the jump is skipped, not put off: a late jump would no longer follow the sound.
    if (wanting.size && this.budget.take(frame.time)) {
      next ??= new Map(this.current)
      for (const spec of wanting) next.set(spec.id, ((next.get(spec.id) ?? 0) + 1) % (spec.max + 1))
    }
    if (next) this.current = next
    return this.current
  }

  get jumps(): ReadonlyMap<string, number> {
    return this.current
  }

  /**
   * Goes on from `jumps` (the precomputed commit on screen, live.ts follow): the seeds stay where the screen shows them
   * instead of jumping back to this tracker's own count. The accumulators are kept; the next frame's time step is 0.
   */
  restore(jumps: ReadonlyMap<string, number>): void {
    this.current = jumps
    this.lastTime = null
  }

  /**
   * Forgets every jump and accumulator (Sound stopped driving): the seeds go back to their fields' values. The
   * budget keeps its edges, and going back spends one (at the last frame's time) when a seed had moved, so a quick
   * pause and play (or Drive letters off and on) cannot let a second burst of jumps through.
   */
  reset(): void {
    let moved = false
    for (const jumps of this.current.values()) if (jumps !== 0) moved = true
    if (moved && this.lastTime !== null) this.budget.spend(this.lastTime)
    this.progress.clear()
    this.lastTime = null
    this.current = NO_JUMPS
  }
}
