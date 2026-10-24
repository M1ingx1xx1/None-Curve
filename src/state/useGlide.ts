// The page's side of Glide (specimen/glide.ts): a small store that keeps the shapes on screen gliding into the newest
// scene, one in-between frame per animation frame (requestAnimationFrame) while a glide is on its way, and nothing
// otherwise. The canvas, the preview and the recording canvas draw from it (components/Glided.tsx), so a video records
// the very frames the canvas shows, timed by the same clock (performance.now). Only those views re-render each frame.
//
// Glide applies while Sound moves the letters: to a scene that comes while Sound drives them, or the first one after it
// stops (the letters glide back to the sliders' own). Other changes (a slider moved by hand with Sound off, the text,
// the font) show at once, as does everything with Glide at 0 or while the system asks for reduced motion (Drive letters
// is off then anyway).
//
// The canvas renderers read each frame's layout and morphs (snapshot.frame) and draw the morphs themselves; the scene
// with the morphs drawn on the CPU (snapshot.scene) is made only for the views that read it.

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GlideFrame } from '../render/types'
import { mappingStore } from '../sound/mappingStore'
import type { CommitTiming } from '../sound/timelineTypes'
import { SceneGlide, type GlideSources } from '../specimen/glide'
import type { SpecimenScene } from '../specimen/scene'
import { getPlanSource } from './aheadTypes'
import { RUNTIME_FLAGS } from './flags'
import { geometryClient } from './geometryClient'

export interface GlideSnapshot {
  /** The scene glided into; views showing another scene (one render early) draw that one as it is. */
  target: SpecimenScene | null
  /** The scene to draw now, with the morphs drawn on the CPU (made when first read: `frame.scene()`). */
  readonly scene: SpecimenScene | null
  /** The same frame for the canvas renderers (render/types.ts): the layout and each glyph's morph. */
  frame: GlideFrame
}

/** A snapshot of `frame`: its scene is drawn only when a view reads it. */
function snapshotOf(target: SpecimenScene | null, frame: GlideFrame): GlideSnapshot {
  return {
    target,
    frame,
    get scene() {
      return frame.scene()
    },
  }
}

/** A frame with nothing morphing: `scene` as it is. */
function stillFrame(target: SpecimenScene | null, scene: SpecimenScene | null): GlideFrame {
  return { target, layout: scene, morphs: null, scene: () => scene }
}

/** Options of GlideStore.show. */
export interface ShowOptions {
  durationMs: number
  live: boolean
  key: string
  /** Page time the scene counts as shown from (a precomputed commit's media time, mapped): the glide starts there. */
  at?: number
  /** A precomputed commit's place in the plan chain (its timing): worker plans chained ahead are used when they fit. */
  chain?: Pick<CommitTiming, 'lineage' | 'seq' | 'prevSeq'> | null
  /** The scenes the glide passes through on its way (keyframes, sound/keyframes.ts), oldest first. */
  keyframes?: readonly SpecimenScene[] | null
}

export interface GlideClock {
  now(): number
  request(callback: () => void): number
  cancel(handle: number): void
}

const pageClock: GlideClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(() => callback()),
  cancel: (handle) => cancelAnimationFrame(handle),
}

export class GlideStore {
  private readonly glide: SceneGlide
  private snapshot: GlideSnapshot = snapshotOf(null, stillFrame(null, null))
  private listeners = new Set<() => void>()
  private handle: number | null = null
  private lastLive = false
  /** The keyframes last shown: a scene that comes later with the same ones (a glyph arriving late) skips them. */
  private lastKeyframes: ShowOptions['keyframes'] = null

  /** `sources`: where plans come from besides pairing on the page (none: every glyph is paired here, as in tests). */
  constructor(
    private readonly clock: GlideClock = pageClock,
    sources: Omit<GlideSources, 'onPlan'> = {},
  ) {
    // A plan arriving from a worker draws the next frame (the chain may have stopped while the glyph waited).
    this.glide = new SceneGlide(undefined, { ...sources, onPlan: () => this.schedule() })
  }

  getSnapshot = (): GlideSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  /** Shows `scene`: glides into it when `live` (or the last scene was) and `durationMs` > 0, otherwise at once. */
  show(scene: SpecimenScene | null, options: ShowOptions) {
    if (scene === this.snapshot.target && scene === this.glide.current) {
      this.lastLive = options.live
      return
    }
    const glide = options.live || this.lastLive
    this.lastLive = options.live
    const now = options.at ?? this.clock.now()
    const keyframes = options.keyframes !== this.lastKeyframes ? options.keyframes : null
    this.lastKeyframes = options.keyframes ?? null
    this.glide.retarget(scene, now, {
      durationMs: options.durationMs,
      glide,
      key: options.key,
      chain: options.chain ?? null,
      keyframes,
    })
    // The frame already asked for would run tick a second time: one chain of frames at most.
    this.stop()
    this.tick()
  }

  private tick = () => {
    this.handle = null
    const now = this.clock.now()
    const target = this.glide.current
    this.snapshot = snapshotOf(target, this.glide.frameInfo(now))
    for (const listener of this.listeners) listener()
    if (this.glide.moving(now)) this.schedule()
  }

  private schedule() {
    if (this.handle === null) this.handle = this.clock.request(this.tick)
  }

  private stop() {
    if (this.handle !== null) this.clock.cancel(this.handle)
    this.handle = null
  }
}

/** Glide's time as set (0 while the system asks for reduced motion). */
function glideMs(): number {
  const { response, reducedMotion } = mappingStore.getState()
  return reducedMotion ? 0 : response.glideMs
}

/**
 * The page's Glide store for `scene` (call once, in App): `live` while Sound drives the letters; `key` names the text and
 * font the scene sets; `timing`, a precomputed commit's (the director's), starts the glide at the commit's time and
 * lets it use the plans the workers chained ahead; `keyframes`, the scenes a large change passes through on its way.
 * Views draw from it with <Glided>.
 */
export function useSceneGlide(
  scene: SpecimenScene | null,
  live: boolean,
  key: string,
  timing?: CommitTiming | null,
  keyframes?: readonly SpecimenScene[] | null,
): GlideStore {
  const [store] = useState(
    () =>
      new GlideStore(pageClock, {
        plans: getPlanSource,
        workerPlans: RUNTIME_FLAGS.workerPlans,
        keyOf: (polygon) => geometryClient.keyOf(polygon),
      }),
  )
  const durationMs = useSyncExternalStore(mappingStore.subscribe, glideMs)
  const latest = useRef<ShowOptions>({ durationMs, live, key })
  latest.current = { durationMs, live, key, at: timing?.wallMs, chain: timing ?? null, keyframes }
  useLayoutEffect(() => store.show(scene, latest.current), [store, scene])
  return store
}
