// The session saved between visits (src/state/persist.ts): it survives a round trip, and whatever is in storage
// (damaged JSON, an older version, unknown keys, values out of range, a full or blocked storage) never breaks the
// start: every leaf is checked against the defaults.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasDiagonalEm, THORN_LIMITS, thornIsOn } from '../../src/geometry/thorn'
import { initialState } from '../../src/state/editorState'
import {
  capText,
  clearRestoring,
  createSessionSaver,
  loadSession,
  markRestoring,
  MAX_SAVED_TEXT,
  readSession,
  saveSession,
  SESSION_VERSION,
  type Session,
} from '../../src/state/persist'
import { roundReach, SLIDER_RANGES } from '../../src/state/sliderScales'
import { DEFAULT_TEXT } from '../../src/specimen/samples'
import type { SettingsParams } from '../../src/state/types'

const SESSION_KEY = 'none-curve:session'
const RESTORING_KEY = 'none-curve:restoring'

/** An in-memory localStorage, which can refuse writes (full) or every access (blocked). */
class MemoryStorage {
  readonly items = new Map<string, string>()
  full = false
  blocked = false
  getItem(key: string) {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError')
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError')
    if (this.full) throw new DOMException('full', 'QuotaExceededError')
    this.items.set(key, value)
  }
  removeItem(key: string) {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError')
    this.items.delete(key)
  }
}

const DEFAULT_SETTINGS: SettingsParams = (({ view: _view, ...settings }) => settings)(initialState.params)
const DEFAULT_VIEW = (({ outline, showFill, showSkeleton, showVertices, showMetrics }) => ({ outline, showFill, showSkeleton, showVertices, showMetrics }))(
  initialState.params.view,
)
const DEFAULT_PRECISION = initialState.document.export.precision

/** A session unlike the defaults in every part. */
function changedSession(): Session {
  const d = DEFAULT_SETTINGS
  return {
    params: {
      ...d,
      anchors: { ...d.anchors, spacing: 12 },
      experimental: { ...d.experimental, seed: 42, crumple: { ...d.experimental.crumple, enabled: true, amount: SLIDER_RANGES['experimental.crumple.amount'].max } },
      typography: { ...d.typography, align: 'right', tracking: 25 },
      palette: { ...d.palette, ink: '#112233' },
    },
    view: { ...DEFAULT_VIEW, outline: 'compare', showVertices: !DEFAULT_VIEW.showVertices },
    text: 'Straight lines only',
    previewLook: { blur: 2.5, inverted: true },
    precision: 3,
    mappings: [
      { id: 'm1', enabled: true, feature: 'bass', target: 'experimental.crumple.amount', depth: 0.5 },
      { id: 'm2', enabled: false, feature: 'beat', target: 'experimental.seed', depth: 0.25 },
    ],
    font: { kind: 'google', family: 'Roboto', weight: 400, italic: false, subset: 'latin' },
    glyph: { family: 'Roboto', style: 'Regular', index: 37, unicode: 0x41 },
  }
}

const stored = (storage: MemoryStorage, value: unknown) => storage.items.set(SESSION_KEY, typeof value === 'string' ? value : JSON.stringify(value))

describe('saved session', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips every part', () => {
    const storage = new MemoryStorage()
    const session = changedSession()
    expect(saveSession(session, storage)).toBe(true)
    expect(JSON.parse(storage.items.get(SESSION_KEY)!).version).toBe(SESSION_VERSION)
    expect(loadSession(storage)).toEqual({ session, crashed: false })
  })

  it('starts fresh from nothing, damaged JSON, or something that is not a session', () => {
    const storage = new MemoryStorage()
    expect(loadSession(storage)).toEqual({ session: null, crashed: false })
    for (const text of ['{"params":', 'not json', '[]', '42', 'null', '"text"']) {
      stored(storage, text)
      expect(loadSession(storage), text).toEqual({ session: null, crashed: false })
    }
  })

  it('reads an empty object as all defaults', () => {
    expect(readSession({})).toEqual({
      params: DEFAULT_SETTINGS,
      view: DEFAULT_VIEW,
      text: DEFAULT_TEXT,
      previewLook: { blur: 0, inverted: false },
      precision: DEFAULT_PRECISION,
      mappings: [],
      font: null,
      glyph: null,
    })
  })

  it('drops unknown keys and keeps the known ones', () => {
    const session = readSession({ version: 1, params: { anchors: { spacing: 9, wobble: 3 }, gizmo: { on: true } }, extra: 'x', view: { zoom: 4, outline: 'source' } })!
    expect(session.params.anchors).toEqual({ ...DEFAULT_SETTINGS.anchors, spacing: 9 })
    expect('gizmo' in session.params).toBe(false)
    expect('extra' in session).toBe(false)
    expect(session.view).toEqual({ ...DEFAULT_VIEW, outline: 'source' })
  })

  it('reads a session from before versions, with the old effect and feature names', () => {
    const session = readSession({
      params: { experimental: { noise: { enabled: true, amount: 1.5 }, curl: { enabled: true }, wind: { enabled: true }, spikes: { enabled: true } } },
      mappings: [
        { feature: 'low', target: 'experimental.noise.amount', depth: 0.4 },
        { feature: 'kickPulse', target: 'experimental.spikes.count', depth: 0.2 },
        { feature: 'sub', target: 'distortion.amount', depth: 0.3 },
      ],
    })!
    const x = session.params.experimental
    expect([x.crumple.enabled, x.whorl.enabled, x.slipstream.enabled, x.thorn.enabled]).toEqual([true, true, true, true])
    expect(x.crumple.amount).toBe(1.5)
    expect('noise' in x).toBe(false)
    // The dropped feature "sub" has no new name: its row is left out.
    expect(session.mappings).toEqual([
      { id: 'm1', enabled: true, feature: 'bass', target: 'experimental.crumple.amount', depth: 0.4 },
      { id: 'm2', enabled: true, feature: 'beat', target: 'experimental.thorn.count', depth: 0.2 },
    ])
  })

  it('reads a version 1 Thorn Reach (em) as the same share of the canvas diagonal, and its Sound rows', () => {
    const v1 = (reach: unknown, sizes: Record<string, unknown> = {}) =>
      readSession({
        version: 1,
        params: { experimental: { thorn: { enabled: true, reach } }, ...sizes },
        mappings: [
          { feature: 'level', target: 'experimental.thorn.reach', depth: 0.3 },
          { feature: 'beat', target: 'experimental.thorn.count', depth: 0.15 },
        ],
      })!
    const session = v1(0.6, { typography: { size: 48 }, artboard: { width: 1200, height: 800 } })
    const thorn = session.params.experimental.thorn
    // Rounded to 4 decimals, like every value the slider writes.
    expect(thorn.canvasReach).toBe(roundReach((0.6 * 48) / Math.hypot(1200, 800)))
    expect(thorn.canvasReach).toBe(0.02)
    expect(thorn.enabled).toBe(true)
    expect('reach' in thorn).toBe(false)
    expect(session.mappings).toEqual([
      { id: 'm1', enabled: true, feature: 'level', target: 'experimental.thorn.canvasReach', depth: 0.3 },
      { id: 'm2', enabled: true, feature: 'beat', target: 'experimental.thorn.count', depth: 0.15 },
    ])
    // The saved text size and canvas, read as the session reads them (missing ones at their defaults, out of range clamped).
    expect(v1(0.6).params.experimental.thorn.canvasReach).toBe(thorn.canvasReach)
    expect(v1(1, { typography: { size: 96 }, artboard: { width: 600, height: 400 } }).params.experimental.thorn.canvasReach).toBe(
      roundReach(96 / Math.hypot(600, 400)),
    )
    expect(v1(2, { typography: { size: 1e9 }, artboard: { width: 1, height: 1 } }).params.experimental.thorn.canvasReach).toBe(1)
    // Thorn caps the canvas diagonal at THORN_LIMITS.maxReachEm, so on small text or a large canvas the reach is a share
    // of the cap (the same length again), and a reach that was on never rounds to off.
    const small = (reach: number, size: number, width: number, height: number) =>
      v1(reach, { typography: { size }, artboard: { width, height } }).params.experimental.thorn
    expect(small(0.6, 12, 4000, 4000).canvasReach).toBe(roundReach(0.6 / THORN_LIMITS.maxReachEm))
    expect(small(0.6, 4, 1200, 800).canvasReach).toBe(roundReach(0.6 / THORN_LIMITS.maxReachEm))
    expect(small(2, 4, 4000, 4000).canvasReach).toBe(roundReach(2 / THORN_LIMITS.maxReachEm))
    expect(small(0.05, 4, 4000, 4000).canvasReach).toBe(0.0002)
    for (const [reach, size, width, height] of [
      [0.6, 12, 4000, 4000],
      [0.6, 4, 1200, 800],
      [0.1, 4, 4000, 4000],
      [0.05, 4, 4000, 4000],
      [2, 4, 4000, 4000],
    ]) {
      const thorn = small(reach, size, width, height)
      const em = Math.min(canvasDiagonalEm(width, height, size), THORN_LIMITS.maxReachEm)
      expect(thornIsOn({ ...thorn, canvasEm: em }), `${reach} em`).toBe(true)
      // Within the rounding to a hundredth of a percent.
      expect(Math.abs(thorn.canvasReach * em - reach), `${reach} em`).toBeLessThanOrEqual(0.00005 * em + 1e-9)
    }
    expect(v1(0.001, { typography: { size: 4 }, artboard: { width: 4000, height: 4000 } }).params.experimental.thorn.canvasReach).toBe(0.0001)
    expect(v1(0).params.experimental.thorn.canvasReach).toBe(0)
    // No usable reach: the default.
    expect(v1('far').params.experimental.thorn.canvasReach).toBe(DEFAULT_SETTINGS.experimental.thorn.canvasReach)
  })

  it('round-trips a version 2 Reach, and never saves Thorn\'s derived canvasEm', () => {
    const storage = new MemoryStorage()
    const session = changedSession()
    const thorn = { ...session.params.experimental.thorn, enabled: true, canvasReach: 0.4321 }
    session.params = { ...session.params, experimental: { ...session.params.experimental, thorn } }
    session.mappings = [{ id: 'm1', enabled: true, feature: 'level', target: 'experimental.thorn.canvasReach', depth: -0.5 }]
    saveSession({ ...session, params: { ...session.params, experimental: { ...session.params.experimental, thorn: { ...thorn, canvasEm: 30.04 } } } }, storage)
    const raw = JSON.parse(storage.items.get(SESSION_KEY)!)
    expect(raw.version).toBe(2)
    expect('canvasEm' in raw.params.experimental.thorn).toBe(false)
    expect(loadSession(storage)).toEqual({ session, crashed: false })
    // Nor is one read back from storage.
    expect('canvasEm' in readSession({ version: 2, params: { experimental: { thorn: { canvasEm: 12 } } } })!.params.experimental.thorn).toBe(false)
  })

  it('clamps numbers to their sliders and drops wrong types, enums and choices', () => {
    const amount = SLIDER_RANGES['experimental.crumple.amount']
    const session = readSession({
      version: 1,
      params: {
        experimental: { seed: 2.6, crumple: { amount: 1e9, enabled: 'yes' } },
        anchors: { spacing: -50 },
        distortion: { amount: Number.NaN },
        flatten: { mode: 'bezier' },
        grid: { angleStep: 7 },
        typography: { size: 1e9, align: 'justify' },
        artboard: { width: 123.4 },
        palette: { ink: 'abc', paper: 'red' },
      },
      previewLook: { blur: 99, inverted: 1 },
      precision: 9,
    })!
    const p = session.params
    expect(p.experimental.crumple.amount).toBe(amount.max)
    expect(p.experimental.crumple.enabled).toBe(DEFAULT_SETTINGS.experimental.crumple.enabled)
    expect(p.experimental.seed).toBe(3)
    expect(p.anchors.spacing).toBe(SLIDER_RANGES['anchors.spacing'].min)
    expect(p.distortion.amount).toBe(DEFAULT_SETTINGS.distortion.amount)
    expect(p.flatten.mode).toBe(DEFAULT_SETTINGS.flatten.mode)
    expect(p.grid.angleStep).toBe(DEFAULT_SETTINGS.grid.angleStep)
    expect(p.typography.size).toBeLessThan(1e9)
    expect(p.typography.align).toBe(DEFAULT_SETTINGS.typography.align)
    expect(Number.isInteger(p.artboard.width)).toBe(true)
    expect(p.palette.ink).toMatch(/^#[0-9a-f]{6}$/i)
    expect(p.palette.paper).toBe(DEFAULT_SETTINGS.palette.paper)
    expect(session.previewLook).toEqual({ blur: 12, inverted: false })
    expect(session.precision).toBe(DEFAULT_PRECISION)
  })

  it('checks the mappings: at most 8, known features and targets, depth clamped, Rates never negative', () => {
    const rows = Array.from({ length: 12 }, (_, k) => ({ feature: 'level', target: 'distortion.amount', depth: k % 2 ? 5 : -5 }))
    const session = readSession({ version: 1, mappings: [{ feature: 'nope', target: 'distortion.amount', depth: 1 }, { feature: 'level', target: 'experimental.seed', depth: -0.5 }, ...rows] })!
    expect(session.mappings).toHaveLength(8)
    expect(session.mappings[0]).toEqual({ id: 'm1', enabled: true, feature: 'level', target: 'experimental.seed', depth: 0.5 })
    expect(session.mappings.slice(1).map((m) => m.depth)).toEqual([-1, 1, -1, 1, -1, 1, -1])
    expect(session.mappings.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'])
  })

  it('checks the font and glyph to reopen', () => {
    const read = (font: unknown, glyph: unknown) => readSession({ version: 1, font, glyph })!
    expect(read({ kind: 'local', fileName: 'My Font.otf' }, null).font).toEqual({ kind: 'local', fileName: 'My Font.otf' })
    expect(read({ kind: 'google', family: 'Roboto', weight: 4000, italic: false, subset: 'latin' }, null).font).toBeNull()
    expect(read({ kind: 'ftp' }, null).font).toBeNull()
    expect(read(null, { family: 'A', style: 'B', index: -1, unicode: 65 }).glyph).toBeNull()
    expect(read(null, { family: 'A', style: 'B', index: 3, unicode: 0x110000 }).glyph).toBeNull()
    expect(read(null, { family: 'A', style: 'B', index: 3, unicode: null }).glyph).toEqual({ family: 'A', style: 'B', index: 3, unicode: null })
  })

  it('caps the text without splitting a surrogate pair', () => {
    expect(capText('short')).toBe('short')
    const long = 'a'.repeat(MAX_SAVED_TEXT - 1) + '\u{1F600}' + 'b'
    const capped = capText(long)
    expect(capped).toBe('a'.repeat(MAX_SAVED_TEXT - 1))
    expect(capText('c'.repeat(MAX_SAVED_TEXT + 5))).toHaveLength(MAX_SAVED_TEXT)
  })

  it('reports a full storage instead of throwing, and starts fresh from a blocked one', () => {
    const storage = new MemoryStorage()
    storage.full = true
    expect(saveSession(changedSession(), storage)).toBe(false)
    storage.full = false
    saveSession(changedSession(), storage)
    storage.blocked = true
    expect(loadSession(storage)).toEqual({ session: null, crashed: false })
    expect(() => markRestoring(storage)).not.toThrow()
    expect(() => clearRestoring(storage)).not.toThrow()
    expect(saveSession(changedSession(), storage)).toBe(false)
  })

  it('leaves the settings at their defaults after a visit that crashed while drawing them', () => {
    const storage = new MemoryStorage()
    const session = changedSession()
    saveSession(session, storage)
    markRestoring(storage)
    expect(loadSession(storage)).toEqual({ session: { ...session, params: DEFAULT_SETTINGS, view: DEFAULT_VIEW }, crashed: true })
    // The mark is gone once read: the next start restores everything again.
    expect(storage.items.has(RESTORING_KEY)).toBe(false)
    expect(loadSession(storage)).toEqual({ session, crashed: false })
    markRestoring(storage)
    clearRestoring(storage)
    expect(loadSession(storage).crashed).toBe(false)
  })

  it('saves once, a moment after the last change, or at once on flush', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const read = vi.fn(changedSession)
    const saver = createSessionSaver(read, storage as unknown as Storage, 500)
    for (let k = 0; k < 5; k++) {
      saver.schedule()
      vi.advanceTimersByTime(200)
    }
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(read).toHaveBeenCalledTimes(1)
    expect(storage.items.has(SESSION_KEY)).toBe(true)
    saver.schedule()
    saver.flush()
    expect(read).toHaveBeenCalledTimes(2)
    saver.flush()
    vi.advanceTimersByTime(1000)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
