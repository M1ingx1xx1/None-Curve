// Debug hook for the measurement driver (?probe=1): every renderer reports each frame it actually drew, so
// changes on screen can be measured the same way for SVG, Canvas2D and WebGL. Off by default: one boolean check.

import type { PlacedGlyph, SpecimenScene } from '../specimen/scene'
import { RUNTIME_FLAGS } from '../state/flags'

/** Index, position, anchors, and a hash of the anchors (rounded to 1/64 unit). */
export interface ProbeGlyph { i: number; x: number; y: number; n: number; h: number }
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
  precompute: { covered: boolean; shown: number; live: number; misses: number; held: number; generation: number }
  preview: { frames: number; drawMs: number[] }
}

const DRAW_MS_KEEP = 600

export const probeOn: boolean = RUNTIME_FLAGS.probe

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
    precompute: { covered: false, shown: 0, live: 0, misses: 0, held: 0, generation: 0 },
    preview: { frames: 0, drawMs: [] },
  }
  if (typeof window !== 'undefined') (window as unknown as { __noneCurveFrames?: ProbeState }).__noneCurveFrames = state
  return state
}

function pushRing(ring: number[], ms: number) {
  ring.push(ms)
  if (ring.length > DRAW_MS_KEEP) ring.splice(0, ring.length - DRAW_MS_KEEP)
}

/** FNV-1a over a glyph's anchors rounded to 1/64 unit, contour by contour. */
function hashAnchors(glyph: PlacedGlyph): { n: number; h: number } {
  let h = 0x811c9dc5
  let n = 0
  const mix = (value: number) => {
    h ^= value | 0
    h = Math.imul(h, 0x01000193)
  }
  for (const contour of glyph.polygon?.contours ?? []) {
    mix(contour.points.length)
    for (const p of contour.points) {
      mix(Math.round(p.x * 64))
      mix(Math.round(p.y * 64))
      n++
    }
  }
  return { n, h: h >>> 0 }
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
  for (const line of scene()?.lines ?? []) {
    for (const glyph of line.glyphs) {
      if (!glyph.polygon) continue
      glyphs.push({ i: glyph.index, x: glyph.x, y: glyph.y, ...hashAnchors(glyph) })
    }
  }
  s.last = { t: typeof performance === 'undefined' ? Date.now() : performance.now(), scale, glyphs }
}

export function reportPrecompute(patch: Partial<ProbeState['precompute']>): void {
  if (!probeOn) return
  Object.assign(probeState().precompute, patch)
}

// The driver finds the hook as soon as the page loads, before the first frame is drawn.
if (probeOn) probeState()
