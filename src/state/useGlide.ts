// The page's side of Glide (specimen/glide.ts): a small store that keeps the shapes on screen gliding into the newest
// scene, one in-between frame per animation frame (requestAnimationFrame) while a glide is on its way, and nothing
// otherwise. The canvas, the preview and the recording canvas draw from it (components/Glided.tsx), so a video records
// the very frames the canvas shows, timed by the same clock (performance.now). Only those views re-render each frame.
//
// Glide applies while Sound moves the letters: to a scene that comes while Sound drives them, or the first one after it
// stops (the letters glide back to the sliders' own). Other changes (a slider moved by hand with Sound off, the text,
// the font) show at once, as does everything with Glide at 0 or while the system asks for reduced motion (Drive letters
// is off then anyway).

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GlideFrame } from '../render/types'
import { mappingStore } from '../sound/mappingStore'
import { SceneGlide } from '../specimen/glide'
import type { SpecimenScene } from '../specimen/scene'

export interface GlideSnapshot {
  /** The scene glided into; views showing another scene (one render early) draw that one as it is. */
  target: SpecimenScene | null
  /** The scene to draw now. */
  scene: SpecimenScene | null
  /** The same frame for the canvas renderers (render/types.ts); morphs stay null until Glide hands them over. */
  frame: GlideFrame
}

/** A frame with nothing morphing: `scene` as it is. */
function stillFrame(target: SpecimenScene | null, scene: SpecimenScene | null): GlideFrame {
  return { target, layout: scene, morphs: null, scene: () => scene }
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
  private readonly glide = new SceneGlide()
  private snapshot: GlideSnapshot = { target: null, scene: null, frame: stillFrame(null, null) }
  private listeners = new Set<() => void>()
  private handle: number | null = null
  private lastLive = false

  constructor(private readonly clock: GlideClock = pageClock) {}

  getSnapshot = (): GlideSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  /** Shows `scene`: glides into it when `live` (or the last scene was) and `durationMs` > 0, otherwise at once. */
  show(scene: SpecimenScene | null, options: { durationMs: number; live: boolean; key: string }) {
    if (scene === this.snapshot.target && scene === this.glide.current) {
      this.lastLive = options.live
      return
    }
    const glide = options.live || this.lastLive
    this.lastLive = options.live
    this.glide.retarget(scene, this.clock.now(), { durationMs: options.durationMs, glide, key: options.key })
    // The frame already asked for would run tick a second time: one chain of frames at most.
    this.stop()
    this.tick()
  }

  private tick = () => {
    this.handle = null
    const now = this.clock.now()
    const target = this.glide.current
    const scene = this.glide.frame(now)
    this.snapshot = { target, scene, frame: stillFrame(target, scene) }
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
 * font the scene sets. Views draw from it with <Glided>.
 */
export function useSceneGlide(scene: SpecimenScene | null, live: boolean, key: string): GlideStore {
  const [store] = useState(() => new GlideStore())
  const durationMs = useSyncExternalStore(mappingStore.subscribe, glideMs)
  const latest = useRef({ durationMs, live, key })
  latest.current = { durationMs, live, key }
  useLayoutEffect(() => store.show(scene, latest.current), [store, scene])
  return store
}
