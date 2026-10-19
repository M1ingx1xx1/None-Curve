// Runtime switches read once at start-up, for comparing renderers and the precompute path (docs: PERFORMANCE).
// URL parameters first (?render=svg|canvas|webgl&precompute=0|1&workerplans=0|1&probe=1), then localStorage
// (none-curve:render, none-curve:precompute, none-curve:workerplans), then the defaults. Never throws.

export type RendererChoice = 'svg' | 'canvas' | 'webgl'

export interface RuntimeFlags {
  /** The renderer asked for; createRenderer falls back webgl → canvas → svg when one cannot start. */
  render: RendererChoice
  /** Precompute a file's features, parameters and geometry ahead of the playhead. */
  precompute: boolean
  /** Pair Glide's anchors in the geometry workers instead of on the page. */
  workerPlans: boolean
  /** Expose window.__noneCurveFrames (render/probe.ts). */
  probe: boolean
}

export const DEFAULT_FLAGS: RuntimeFlags = { render: 'webgl', precompute: true, workerPlans: true, probe: false }

const RENDERERS: readonly RendererChoice[] = ['svg', 'canvas', 'webgl']

function asRenderer(value: string | null): RendererChoice | null {
  return value !== null && (RENDERERS as readonly string[]).includes(value) ? (value as RendererChoice) : null
}

/** '1'/'true' → true, '0'/'false' → false, anything else (missing included) → null. */
function asBoolean(value: string | null): boolean | null {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return null
}

/** Reads a stored value, or null where reading throws (blocked storage). */
function safeStored(stored: (key: string) => string | null, key: string): string | null {
  try {
    return stored(key)
  } catch {
    return null
  }
}

/** The switches from a URL query (`search`, with or without '?') and a storage reader; invalid values fall through. */
export function parseFlags(search: string, stored: (key: string) => string | null): RuntimeFlags {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    params = new URLSearchParams()
  }
  const pick = <T>(param: string, key: string | null, read: (value: string | null) => T | null, fallback: T): T =>
    read(params.get(param)) ?? (key === null ? null : read(safeStored(stored, key))) ?? fallback
  return {
    render: pick('render', 'none-curve:render', asRenderer, DEFAULT_FLAGS.render),
    precompute: pick('precompute', 'none-curve:precompute', asBoolean, DEFAULT_FLAGS.precompute),
    workerPlans: pick('workerplans', 'none-curve:workerplans', asBoolean, DEFAULT_FLAGS.workerPlans),
    probe: pick('probe', null, asBoolean, DEFAULT_FLAGS.probe),
  }
}

function readFlags(): RuntimeFlags {
  try {
    const search = typeof location === 'undefined' ? '' : location.search
    const storage = typeof localStorage === 'undefined' ? null : localStorage
    return parseFlags(search, (key) => (storage ? storage.getItem(key) : null))
  } catch {
    return DEFAULT_FLAGS
  }
}

/** The switches for this page load. */
export const RUNTIME_FLAGS: RuntimeFlags = readFlags()
