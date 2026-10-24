// Debug hook for the measurement driver (?probe=1): every renderer reports each frame it actually drew, so
// changes on screen can be measured the same way for SVG, Canvas2D and WebGL. Off by default: one boolean check.

import type { PlacedGlyph, SpecimenScene } from '../specimen/scene'
import { RUNTIME_FLAGS } from '../state/flags'

/**
 * Index, position, anchors, a hash of the anchors (rounded to 1/64 unit), and `d`: how far its anchors moved since the
 * last frame reported (font units, the largest of any anchor; 0 when it is new or its anchor count changed).
 */
export interface ProbeGlyph { i: number; x: number; y: number; n: number; h: number; d: number }
/** scale = CSS px per font unit × DPR. */
export interface ProbeFrame { t: number; scale: number; glyphs: ProbeGlyph[] }
export interface ProbeState {
  frames: number
  /** The renderer asked for. */
  renderer: string
  /** The renderer drawing ('svg' | 'canvas' | 'webgl' | 'webgl+detail'). */
  effective: string
  /** Ring of the last DRAW_MS_KEEP draw times. */
  drawMs: number[]
  last: ProbeFrame | null
  precompute: PrecomputeProbe
  preview: { frames: number; drawMs: number[] }
}

/** Precomputed playback (sound/director.ts, state/aheadGeometry.ts): what the director did, and what is prepared. */
export interface PrecomputeProbe {
  covered: boolean
  shown: number
  live: number
  misses: number
  held: number
  backoffs: number
  generation: number
  /** The whole-file plan: planned and measured from 0 up to (media ms), its bytes (estimate) and CPU so far (ms). */
  plannedMs: number
  measuredMs: number
  planBytes: number
  planCpuMs: number
  /** The page's ahead store (aheadStore.ts). */
  store: { entries: number; points: number; bytes: number; evictions: number; orphans: number }
  /** Each worker's ahead store (bytes, at its last answer). */
  workers: { bytes: number[] }
  /** Ready geometry from the playhead on, contiguous, each way (media ms). */
  readyAheadMs: number
  readyBehindMs: number
  /** Live frames between the last Play and the first planned commit shown. */
  firstPlayLiveFrames: number
  /** Glyphs of the window found held or computed since the plan last changed. */
  reuse: { hits: number; misses: number }
  /** Why background work is paused now, or null. */
  paused: 'settling' | 'hidden' | 'backoff' | null
}

const DRAW_MS_KEEP = 600

export const probeOn: boolean = RUNTIME_FLAGS.probe

declare global {
  interface Window {
    /** The probe's state, for a measuring script to read (?probe=1). */
    __noneCurveFrames?: ProbeState
  }
}

let state: ProbeState | null = null

/** The probe's state, made (and put on window.__noneCurveFrames) on first use. */
function probeState(): ProbeState {
  if (state) return state
  state = {
    frames: 0,
    renderer: RUNTIME_FLAGS.render,
    effective: '',
    drawMs: [],
    last: null,
    precompute: {
      covered: false,
      shown: 0,
      live: 0,
      misses: 0,
      held: 0,
      backoffs: 0,
      generation: 0,
      plannedMs: 0,
      measuredMs: 0,
      planBytes: 0,
      planCpuMs: 0,
      store: { entries: 0, points: 0, bytes: 0, evictions: 0, orphans: 0 },
      workers: { bytes: [] },
      readyAheadMs: 0,
      readyBehindMs: 0,
      firstPlayLiveFrames: 0,
      reuse: { hits: 0, misses: 0 },
      paused: null,
    },
    preview: { frames: 0, drawMs: [] },
  }
  if (typeof window !== 'undefined') window.__noneCurveFrames = state
  return state
}

function pushRing(ring: number[], ms: number) {
  ring.push(ms)
  if (ring.length > DRAW_MS_KEEP) ring.splice(0, ring.length - DRAW_MS_KEEP)
}

/** The anchors (x, y pairs) and glyph index of each occurrence in the last frame reported, for `d`. */
let previous: { i: number; xy: Float64Array }[] = []

/** FNV-1a over a glyph's anchors rounded to 1/64 unit, contour by contour; its anchors as x, y pairs. */
function hashAnchors(glyph: PlacedGlyph): { n: number; h: number; xy: Float64Array } {
  let h = 0x811c9dc5
  const contours = glyph.polygon?.contours ?? []
  const xy = new Float64Array(2 * contours.reduce((total, c) => total + c.points.length, 0))
  let n = 0
  const mix = (value: number) => {
    h ^= value | 0
    h = Math.imul(h, 0x01000193)
  }
  for (const contour of contours) {
    mix(contour.points.length)
    for (const p of contour.points) {
      mix(Math.round(p.x * 64))
      mix(Math.round(p.y * 64))
      xy[2 * n] = p.x
      xy[2 * n + 1] = p.y
      n++
    }
  }
  return { n, h: h >>> 0, xy }
}

/** The largest distance any anchor moved between two runs of the same length. */
function moved(a: Float64Array, b: Float64Array): number {
  let most = 0
  for (let k = 0; k + 1 < a.length; k += 2) most = Math.max(most, Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1]))
  return most
}

/** Called by a renderer after it drew `scene` (morphs evaluated by the reporter; the GPU path passes the CPU scene lazily only when probeOn). */
export function reportFrame(which: 'canvas' | 'preview', effective: string, ms: number, scene: () => SpecimenScene | null, scale: number): void {
  if (!probeOn) return
  const s = probeState()
  if (which === 'preview') {
    s.preview.frames++
    pushRing(s.preview.drawMs, ms)
    return
  }
  s.frames++
  s.effective = effective
  pushRing(s.drawMs, ms)
  const glyphs: ProbeGlyph[] = []
  const anchors: { i: number; xy: Float64Array }[] = []
  for (const line of scene()?.lines ?? []) {
    for (const glyph of line.glyphs) {
      if (!glyph.polygon) continue
      const { n, h, xy } = hashAnchors(glyph)
      const before = previous[glyphs.length]
      const d = before && before.i === glyph.index && before.xy.length === xy.length ? moved(before.xy, xy) : 0
      glyphs.push({ i: glyph.index, x: glyph.x, y: glyph.y, n, h, d })
      anchors.push({ i: glyph.index, xy })
    }
  }
  previous = anchors
  s.last = { t: typeof performance === 'undefined' ? Date.now() : performance.now(), scale, glyphs }
}

/** User timing entries kept before the oldest are cleared (a PerformanceObserver still hears every one). */
const MEASURES_KEEP = 600
let measures = 0

/**
 * Marks a drawn frame as the user timing measure `nc-draw` (canvas) or `nc-draw-preview`, with or without the probe,
 * so the driver's timing runs (?probe=0) read draw cost with a PerformanceObserver. About a microsecond a frame.
 */
export function measureDraw(which: 'canvas' | 'preview', start: number, end: number): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return
  try {
    performance.measure(which === 'canvas' ? 'nc-draw' : 'nc-draw-preview', { start, end })
    if (++measures >= MEASURES_KEEP) {
      measures = 0
      performance.clearMeasures('nc-draw')
      performance.clearMeasures('nc-draw-preview')
    }
  } catch {
    // Older engines without measure options: no timing, nothing else changes.
  }
}

export function reportPrecompute(patch: Partial<PrecomputeProbe>): void {
  if (!probeOn) return
  Object.assign(probeState().precompute, patch)
}

// The driver finds the hook as soon as the page loads, before the first frame is drawn.
if (probeOn) probeState()
