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
// GLIDE_LIMITS.planBudgetMs on it; a glyph whose turn has not come yet holds the shape it had on screen and starts its
// glide (of the full time) in the frame that pairs it. The glyphs take turns: each frame goes on where the last one
// stopped (in reading order, round to the start), also across new shapes, so in a long text that Sound reshapes faster
// than all its glyphs can be paired, every glyph still gets its turn instead of the last ones waiting for good. A glide
// nearly done (GLIDE_LIMITS.arrived) when the next shape comes counts as arrived: its next glide starts from the
// computed shape, whose plans are shared between frames and repeated letters (the jump this takes is at most 1% of the
// last move, too small to see).
//
// Glide never decides what is computed or when: the live scheduler, its flash limit and its frame rate work as without
// it. The flash limit counts how often the shapes change; Glide only softens each change on screen.
//
// Plans can come from the geometry workers (a PlanSource, state/aheadGeometry.ts). A precomputed commit names each
// occurrence's glide lineage: the worker planned that glyph's glide ahead, from the shape it worked out would be on
// screen, and the plan is used, starting at once, when the shape on screen matches (an in-between shape is told by the
// tag it got when it was drawn from such a plan). Otherwise, with worker plans on, each glyph waiting to be paired is
// sent to a worker, and starts its glide in the frame after its plan arrives; without them it is paired here as above.

import type { PolygonGlyph } from '../geometry/types'
import type { GlideFrame, GlyphMorph } from '../render/types'
import type { CommitTiming } from '../sound/timelineTypes'
import type { ChainTag, PlanSource } from '../state/aheadTypes'
import { morphAt, planMorph, settleInBetween, type MorphPlan } from './morph'
import type { PlacedGlyph, SpecimenScene } from './scene'

export const GLIDE_LIMITS = {
  /**
   * A glyph this far along its glide (eased) when a new shape arrives counts as arrived: its next glide starts from the
   * shape it was heading for (a jump of at most this share of the last move's rest).
   */
  arrived: 0.99,
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
  /** A precomputed commit's glide lineages (per occurrence, reading order) and its place in the chain; none on the live path. */
  chain?: Pick<CommitTiming, 'lineage' | 'seq' | 'prevSeq'> | null
}

/** Where SceneGlide gets plans from the workers, and how it tells computed outlines apart. */
export interface GlideSources {
  /** The PlanSource now (null: every glyph is paired here). */
  plans?: () => PlanSource | null
  /** Ask the workers for plans of glyphs waiting to be paired (else they are paired here, within the frame budget). */
  workerPlans?: boolean
  /** The key a computed outline was computed under (geometryClient.keyOf); null for any other shape. */
  keyOf?: (polygon: PolygonGlyph) => string | null
  /** A plan asked of a worker arrived: a frame should be drawn soon. */
  onPlan?: () => void
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
  /** The worker's chained plan this glide runs (its in-between shapes are tagged with it). */
  chain?: { lineage: number; seq: number }
}

/** A plan asked of a worker for one old and new outline (glyphs on the same outlines share it), and its answer. */
interface PlanAsk {
  cancel: () => void
  /** undefined: not answered yet. */
  plan?: MorphPlan | null
}

interface Tween {
  start: number
  duration: number
  fromSlant: number
  /** One per glyph of the target, in reading order; null: shown as it is. */
  glyphs: (GlyphGlide | null)[]
  /** Glyphs not paired yet. */
  pending: number
  /** Plans asked of the workers, by old then new outline. */
  asks: Map<PolygonGlyph, Map<PolygonGlyph, PlanAsk>>
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
  /** Where the next frame starts pairing (the glyph after the last one paired), so every glyph gets its turn. */
  private cursor = 0
  /** The last frame drawn, for the same time asked again (several views draw each frame). */
  private last: { now: number; frame: GlideFrame } | null = null
  /** What each in-between shape drawn from a worker's chained plan was (only shapes a new glide starts from need it). */
  private chainTags = new WeakMap<PolygonGlyph, ChainTag>()
  private readonly sources: GlideSources

  /** `clock` measures the pairing budget (GLIDE_LIMITS.planBudgetMs); tests pass one that stands still. */
  constructor(
    private readonly clock: () => number = () => performance.now(),
    sources: GlideSources = {},
  ) {
    this.sources = sources
  }

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
    const before = this.tween
    this.target = scene
    this.key = options.key
    this.last = null
    this.tween = glide ? this.begin(shown!, scene!, now, options.durationMs, options.chain ?? null, before) : null
    if (before) this.dropAsks(before, this.tween)
  }

  /** What is on screen at `now`, as the next glide starts from it: a glyph nearly arrived counts as arrived. */
  private shown(now: number): SpecimenScene | null {
    const tween = this.tween
    const target = this.target
    if (!tween || !target) return target
    // Repeated letters on the same glide share one outline, so the next glide pairs them once.
    const shared = new Map<MorphPlan, { start: number; polygon: PolygonGlyph }>()
    const outline = (glide: GlyphGlide, plan: MorphPlan, start: number) => {
      const known = shared.get(plan)
      if (known && known.start === start) return known.polygon
      const q = easeOut((now - start) / tween.duration)
      const polygon = q >= GLIDE_LIMITS.arrived ? plan.to : morphAt(plan, q)
      // A worker's chain may go on from this shape: it is told by what it was drawn from.
      if (glide.chain && polygon !== plan.to) this.chainTags.set(polygon, { lineage: glide.chain.lineage, seq: glide.chain.seq, q })
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
        return { ...g, x, y, polygon: outline(glide, glide.plan, glide.start) }
      }),
    }))
    const p = easeOut((now - tween.start) / tween.duration)
    return { ...target, lines, slant: tween.fromSlant + (target.slant - tween.fromSlant) * p }
  }

  private begin(
    shown: SpecimenScene,
    scene: SpecimenScene,
    now: number,
    duration: number,
    chain: GlideTarget['chain'] | null,
    before: Tween | null,
  ): Tween | null {
    const glyphs: (GlyphGlide | null)[] = []
    let moves = shown.slant !== scene.slant
    let pending = 0
    const source = chain?.lineage ? (this.sources.plans?.() ?? null) : null
    const asks: Tween['asks'] = new Map()
    let k = 0
    for (let l = 0; l < scene.lines.length; l++) {
      const from = shown.lines[l].glyphs
      const to = scene.lines[l].glyphs
      for (let i = 0; i < to.length; i++, k++) {
        const a = from[i]
        const b = to[i]
        const reshaped = a.polygon !== null && b.polygon !== null && a.polygon !== b.polygon
        const moved = a.x !== b.x || a.y !== b.y
        if (!reshaped && !moved) {
          glyphs.push(null)
          continue
        }
        moves = true
        const glide: GlyphGlide = { from: a.polygon, to: b.polygon, plan: reshaped ? undefined : null, start: now, fromX: a.x, fromY: a.y }
        if (reshaped && source && chain!.lineage && k < chain!.lineage.length) {
          // The worker's plan for this glyph's lineage, when it starts from the shape on screen.
          const lineage = chain!.lineage[k]
          const fromKey = this.sources.keyOf?.(a.polygon!) ?? null
          const plan = source.chained(lineage, chain!.seq, a.polygon!, b.polygon!, this.chainTags.get(a.polygon!) ?? null, fromKey)
          if (plan !== undefined) {
            glide.plan = plan
            if (plan) glide.chain = { lineage, seq: chain!.seq }
          }
        }
        if (glide.plan === undefined) {
          pending++
          // A plan already asked of a worker for the same outlines goes on serving this glyph.
          const ask = before?.asks.get(glide.from!)?.get(glide.to!)
          if (ask) {
            let byTarget = asks.get(glide.from!)
            if (!byTarget) asks.set(glide.from!, (byTarget = new Map()))
            byTarget.set(glide.to!, ask)
          }
        }
        glyphs.push(glide)
      }
    }
    return moves ? { start: now, duration, fromSlant: shown.slant, glyphs, pending, asks } : null
  }

  /** Cancels the plans asked of the workers that the new tween does not wait on. */
  private dropAsks(old: Tween, next: Tween | null) {
    for (const [from, byTarget] of old.asks)
      for (const [to, ask] of byTarget) if (next?.asks.get(from)?.get(to) !== ask) ask.cancel()
  }

  /**
   * Pairs the glyphs still waiting within this frame's budget, from where the last frame stopped (see the top of the
   * file); they start gliding at `now`. With worker plans, each waiting glyph is asked of a worker instead, and those
   * whose plans arrived start now.
   */
  private pair(tween: Tween, now: number) {
    const count = tween.glyphs.length
    if (count === 0) return
    const source = this.sources.workerPlans ? (this.sources.plans?.() ?? null) : null
    if (source) return this.ask(tween, now, source)
    const started = this.clock()
    const first = this.cursor % count
    // At least one glyph each frame, however slow, so the glide always moves on.
    let planned = false
    for (let k = 0; k < count && tween.pending > 0; k++) {
      const index = (first + k) % count
      const glide = tween.glyphs[index]
      if (!glide || glide.plan !== undefined) continue
      const known = this.plans.get(glide.from!)?.has(glide.to!)
      if (!known && planned && this.clock() - started > GLIDE_LIMITS.planBudgetMs) {
        this.cursor = index
        return
      }
      if (!known) planned = true
      glide.plan = this.planFor(glide.from!, glide.to!)
      glide.start = now
      tween.pending--
      this.cursor = index + 1
    }
  }

  /** The worker side of `pair`: answered asks start their glyphs at `now`; glyphs not asked yet are asked. */
  private ask(tween: Tween, now: number, source: PlanSource) {
    for (const glide of tween.glyphs) {
      if (!glide || glide.plan !== undefined) continue
      const from = glide.from!
      const to = glide.to!
      const known = this.plans.get(from)
      if (known?.has(to)) {
        glide.plan = known.get(to)!
        glide.start = now
        tween.pending--
        continue
      }
      let byTarget = tween.asks.get(from)
      if (!byTarget) tween.asks.set(from, (byTarget = new Map()))
      let ask = byTarget.get(to)
      if (!ask) {
        const made: PlanAsk = { cancel: () => {} }
        byTarget.set(to, (ask = made))
        let answered = false
        made.cancel = source.request({ from, to, toRef: null }, (plan) => {
          answered = true
          made.plan = plan
          let cached = this.plans.get(from)
          if (!cached) this.plans.set(from, (cached = new WeakMap()))
          cached.set(to, plan)
          this.sources.onPlan?.()
        })
        // Answered at once (no worker to ask): the plan was made here.
        if (answered) made.cancel = () => {}
      }
      if (ask.plan !== undefined) {
        glide.plan = ask.plan
        glide.start = now
        tween.pending--
      }
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
    return this.frameInfo(now).scene()
  }

  /**
   * The frame at `now` for the renderers (render/types.ts GlideFrame): every occurrence's place, and each glyph's
   * morph (plan and eased progress) while it is on its way; the scene with the morphs drawn is made only when asked
   * for, once per frame, occurrences with the same plan and progress sharing one outline.
   */
  frameInfo(now: number): GlideFrame {
    const tween = this.tween
    const target = this.target
    if (!tween) return stillFrame(target)
    if (this.last && this.last.now === now) return this.last.frame
    if (!target || !this.moving(now)) {
      this.tween = null
      return stillFrame(target)
    }
    this.pair(tween, now)
    const p = easeOut((now - tween.start) / tween.duration)
    const lerp = (a: number, b: number) => a + (b - a) * p
    const morphs: (GlyphMorph | null)[] = []
    let morphing = false
    let k = 0
    const lines = target.lines.map((line) => {
      let changed = false
      const glyphs = line.glyphs.map((g): PlacedGlyph => {
        const glide = tween.glyphs[k++]
        let morph: GlyphMorph | null = null
        let polygon = g.polygon
        if (glide?.plan === undefined) {
          if (glide) polygon = glide.from
        } else if (glide.plan) {
          const q = easeOut((now - glide.start) / tween.duration)
          if (!(q > 0)) polygon = glide.plan.from
          else if (q >= 1) polygon = glide.plan.to
          else {
            // The target's polygon stays in the layout; the morph is drawn in its place.
            morph = { plan: glide.plan, p: q }
            polygon = glide.plan.to
            morphing = true
          }
        }
        morphs.push(morph)
        if (!glide) return g
        const x = lerp(glide.fromX, g.x)
        const y = lerp(glide.fromY, g.y)
        if (polygon === g.polygon && x === g.x && y === g.y) return g
        changed = true
        return { ...g, x, y, polygon }
      })
      return changed ? { ...line, glyphs } : line
    })
    const layout: SpecimenScene = { ...target, lines, slant: lerp(tween.fromSlant, target.slant) }
    let scene: SpecimenScene | undefined
    const frame: GlideFrame = {
      target,
      layout,
      morphs: morphing ? morphs : null,
      scene: () => (scene ??= morphing ? drawMorphs(layout, morphs) : layout),
    }
    this.last = { now, frame }
    return frame
  }
}

/** A frame with nothing on its way: the scene as it is. */
function stillFrame(scene: SpecimenScene | null): GlideFrame {
  return { target: scene, layout: scene, morphs: null, scene: () => scene }
}

/** The layout with every morph drawn (morphAt), occurrences with the same plan and progress sharing one outline. */
function drawMorphs(layout: SpecimenScene, morphs: readonly (GlyphMorph | null)[]): SpecimenScene {
  const shared = new Map<MorphPlan, Map<number, PolygonGlyph>>()
  let k = 0
  const lines = layout.lines.map((line) => {
    let changed = false
    const glyphs = line.glyphs.map((g): PlacedGlyph => {
      const morph = morphs[k++]
      if (!morph) return g
      let byProgress = shared.get(morph.plan)
      if (!byProgress) shared.set(morph.plan, (byProgress = new Map()))
      let polygon = byProgress.get(morph.p)
      if (!polygon) byProgress.set(morph.p, (polygon = morphAt(morph.plan, morph.p)))
      changed = true
      return { ...g, polygon }
    })
    return changed ? { ...line, glyphs } : line
  })
  return { ...layout, lines }
}
