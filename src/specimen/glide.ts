// Glide (Sound's Response group): while Sound moves the letters, each new shape is not shown at once but reached over
// Glide's time, every anchor travelling from where it is on screen to its new place (morph.ts), along its effect's path
// (trajectory.ts), eased out. Only what is drawn glides: the live frames, their geometry, the flash limit, the markers,
// the status and Freeze all keep to the shapes as computed. Pure and clock-free: the page's clock (useGlide) and a
// test's give the same frames for the same times.
//
// A new shape that arrives on the way glides on from the shape on screen (no jump back). Each glyph of the text glides on
// its own (one occurrence each; occurrences with the same old and new outline share the work and the result); its
// position (Sound's tracking and line height) and the text's slant glide with it, in straight lines. The text changes at
// once when its glyphs are not the same ones in the same order (a text or font change), and a glyph changes at once
// when it has no outline on either side or its in-between would be too large (MORPH_LIMITS.maxPoints).
//
// Pairing the anchors of a glyph costs time on the page, so each animation frame spends at most
// GLIDE_LIMITS.planBudgetMs on it, in reading order; a glyph whose turn has not come yet holds the shape it had on screen
// and starts its glide (of the full time) in the frame that pairs it. A glide nearly done (GLIDE_LIMITS.arrived) when the
// next shape comes counts as arrived, so at slower frame rates every glide starts from a computed shape, whose plans are
// shared between frames and repeated letters.
//
// Glide never decides what is computed or when: the live scheduler, its flash limit and its frame rate work as without
// it. The flash limit counts how often the shapes change; Glide only softens each change on screen.

import type { PolygonGlyph } from '../geometry/types'
import { morphAt, planMorph, settleInBetween, type MorphPlan } from './morph'
import type { PlacedGlyph, SpecimenScene } from './scene'

export const GLIDE_LIMITS = {
  /**
   * A glyph this far along its glide (eased) when a new shape arrives counts as arrived: its next glide starts from the
   * shape it was heading for (a jump of at most this share of the last move's rest).
   */
  arrived: 0.95,
  /** Page time (ms) each animation frame may spend pairing anchors; the glyphs left wait for the next frame. */
  planBudgetMs: 6,
} as const

/** The easing of a glide: fast at first, settling into place (cubic ease-out). */
export function easeOut(t: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  const r = 1 - t
  return 1 - r * r * r
}

export interface GlideTarget {
  /** Glide's time (ms); 0 changes at once. */
  durationMs: number
  /** False: this change is shown at once (not a change Sound made). */
  glide: boolean
  /** The text and font the scene sets: a scene with another key is never glided into. */
  key: string
}

/** A glyph on its way. `plan` undefined: not paired yet (it shows `from`); null: it shows its new outline at once. */
interface GlyphGlide {
  from: PolygonGlyph | null
  to: PolygonGlyph | null
  plan: MorphPlan | null | undefined
  /** When its glide started (the frame that paired it). */
  start: number
  fromX: number
  fromY: number
}

interface Tween {
  start: number
  duration: number
  fromSlant: number
  /** One per glyph of the target, in reading order; null: shown as it is. */
  glyphs: (GlyphGlide | null)[]
  /** Glyphs not paired yet. */
  pending: number
}

/** True when both scenes set the same glyphs, line by line, in the same order. */
function sameGlyphs(a: SpecimenScene, b: SpecimenScene): boolean {
  if (a.lines.length !== b.lines.length) return false
  for (let l = 0; l < a.lines.length; l++) {
    const x = a.lines[l].glyphs
    const y = b.lines[l].glyphs
    if (x.length !== y.length) return false
    for (let k = 0; k < x.length; k++) if (x[k].index !== y[k].index) return false
  }
  return true
}

export class SceneGlide {
  private target: SpecimenScene | null = null
  private key = ''
  private tween: Tween | null = null
  /** Plans by old and new outline: repeated letters, and glides from computed outlines, share them. */
  private plans = new WeakMap<PolygonGlyph, WeakMap<PolygonGlyph, MorphPlan | null>>()
  /** The last frame drawn, for the same time asked again (several views draw each frame). */
  private last: { now: number; scene: SpecimenScene | null } | null = null

  /** `clock` measures the pairing budget (GLIDE_LIMITS.planBudgetMs); tests pass one that stands still. */
  constructor(private readonly clock: () => number = () => performance.now()) {}

  /** The scene glided into, as computed. */
  get current(): SpecimenScene | null {
    return this.target
  }

  /** True while a glide is on its way at `now` (or glyphs wait to be paired). */
  moving(now: number): boolean {
    const tween = this.tween
    if (!tween) return false
    if (tween.pending > 0) return true
    return tween.glyphs.some((g) => g !== null && g.plan && now < g.start + tween.duration) || now < tween.start + tween.duration
  }

  /** Shows `scene` from `now`: glides into it from what is shown at `now`, or shows it at once (see the top of the file). */
  retarget(scene: SpecimenScene | null, now: number, options: GlideTarget): void {
    if (scene === this.target && options.key === this.key) return
    const shown = this.shown(now)
    const glide = options.glide && options.durationMs > 0 && scene !== null && shown !== null && options.key === this.key && sameGlyphs(shown, scene)
    this.target = scene
    this.key = options.key
    this.last = null
    this.tween = glide ? this.begin(shown!, scene!, now, options.durationMs) : null
  }

  /** What is on screen at `now`, as the next glide starts from it: a glyph nearly arrived counts as arrived. */
  private shown(now: number): SpecimenScene | null {
    const tween = this.tween
    const target = this.target
    if (!tween || !target) return target
    // Repeated letters on the same glide share one outline, so the next glide pairs them once.
    const shared = new Map<MorphPlan, { start: number; polygon: PolygonGlyph }>()
    const outline = (plan: MorphPlan, start: number) => {
      const known = shared.get(plan)
      if (known && known.start === start) return known.polygon
      const q = easeOut((now - start) / tween.duration)
      const polygon = q >= GLIDE_LIMITS.arrived ? plan.to : morphAt(plan, q)
      shared.set(plan, { start, polygon })
      return polygon
    }
    let k = 0
    const lines = target.lines.map((line) => ({
      ...line,
      glyphs: line.glyphs.map((g): PlacedGlyph => {
        const glide = tween.glyphs[k++]
        if (!glide) return g
        const p = easeOut((now - tween.start) / tween.duration)
        const x = glide.fromX + (g.x - glide.fromX) * p
        const y = glide.fromY + (g.y - glide.fromY) * p
        if (glide.plan === undefined) return { ...g, x, y, polygon: glide.from }
        if (!glide.plan) return { ...g, x, y }
        return { ...g, x, y, polygon: outline(glide.plan, glide.start) }
      }),
    }))
    const p = easeOut((now - tween.start) / tween.duration)
    return { ...target, lines, slant: tween.fromSlant + (target.slant - tween.fromSlant) * p }
  }

  private begin(shown: SpecimenScene, scene: SpecimenScene, now: number, duration: number): Tween | null {
    const glyphs: (GlyphGlide | null)[] = []
    let moves = shown.slant !== scene.slant
    let pending = 0
    for (let l = 0; l < scene.lines.length; l++) {
      const from = shown.lines[l].glyphs
      const to = scene.lines[l].glyphs
      for (let k = 0; k < to.length; k++) {
        const a = from[k]
        const b = to[k]
        const reshaped = a.polygon !== null && b.polygon !== null && a.polygon !== b.polygon
        const moved = a.x !== b.x || a.y !== b.y
        if (!reshaped && !moved) {
          glyphs.push(null)
          continue
        }
        moves = true
        if (reshaped) pending++
        glyphs.push({ from: a.polygon, to: b.polygon, plan: reshaped ? undefined : null, start: now, fromX: a.x, fromY: a.y })
      }
    }
    return moves ? { start: now, duration, fromSlant: shown.slant, glyphs, pending } : null
  }

  /** Pairs the glyphs still waiting, in reading order, within this frame's budget; they start gliding at `now`. */
  private pair(tween: Tween, now: number) {
    const started = this.clock()
    for (const glide of tween.glyphs) {
      if (tween.pending === 0) return
      if (!glide || glide.plan !== undefined) continue
      const known = this.plans.get(glide.from!)?.has(glide.to!)
      if (!known && this.clock() - started > GLIDE_LIMITS.planBudgetMs) return
      glide.plan = this.planFor(glide.from!, glide.to!)
      glide.start = now
      tween.pending--
    }
  }

  private planFor(from: PolygonGlyph, to: PolygonGlyph): MorphPlan | null {
    let byTarget = this.plans.get(from)
    if (!byTarget) this.plans.set(from, (byTarget = new WeakMap()))
    if (byTarget.has(to)) return byTarget.get(to)!
    const plan = planMorph(settleInBetween(from, to), to)
    byTarget.set(to, plan)
    return plan
  }

  /** The scene to draw at `now`: the target itself once every glyph has arrived (or without a glide). */
  frame(now: number): SpecimenScene | null {
    const tween = this.tween
    if (!tween) return this.target
    if (this.last && this.last.now === now) return this.last.scene
    const target = this.target
    if (!target || !this.moving(now)) {
      this.tween = null
      return target
    }
    this.pair(tween, now)
    const p = easeOut((now - tween.start) / tween.duration)
    const lerp = (a: number, b: number) => a + (b - a) * p
    // Occurrences with the same plan and start share one in-between outline per frame.
    const shared = new Map<MorphPlan, { start: number; polygon: PolygonGlyph }>()
    let k = 0
    const lines = target.lines.map((line) => {
      let changed = false
      const glyphs = line.glyphs.map((g): PlacedGlyph => {
        const glide = tween.glyphs[k++]
        if (!glide) return g
        let polygon = g.polygon
        if (glide.plan === undefined) polygon = glide.from
        else if (glide.plan) {
          const known = shared.get(glide.plan)
          if (known && known.start === glide.start) polygon = known.polygon
          else {
            polygon = morphAt(glide.plan, easeOut((now - glide.start) / tween.duration))
            shared.set(glide.plan, { start: glide.start, polygon })
          }
        }
        const x = lerp(glide.fromX, g.x)
        const y = lerp(glide.fromY, g.y)
        if (polygon === g.polygon && x === g.x && y === g.y) return g
        changed = true
        return { ...g, x, y, polygon }
      })
      return changed ? { ...line, glyphs } : line
    })
    const scene: SpecimenScene = { ...target, lines, slant: lerp(tween.fromSlant, target.slant) }
    this.last = { now, scene }
    return scene
  }
}
