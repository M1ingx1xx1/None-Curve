// The session saved between visits (src/state/persist.ts): it survives a round trip, and whatever is in storage
// (damaged JSON, an older version, unknown keys, values out of range, a full or blocked storage) never breaks the
// start: every leaf is checked against the defaults, the Sound tab's Response group too. The config file (Export →
// Config) holds the same session, marked as the app's: it round-trips, is migrated, and anything else is refused.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasDiagonalEm, THORN_LIMITS, thornIsOn } from '../../src/geometry/thorn'
import { DEFAULT_SOUND_SETTINGS, SOUND_LIMITS } from '../../src/sound/types'
import { initialState } from '../../src/state/editorState'
import {
  capText,
  clearRestoring,
  CONFIG_MARKER,
  createSessionSaver,
  loadSession,
  markRestoring,
  MAX_SAVED_TEXT,
  parseConfig,
  parseSession,
  readSession,
  saveSession,
  serializeConfig,
  serializeSession,
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
      { id: 'm3', enabled: true, feature: 'melody', target: 'distortion.amount', depth: -0.4 },
    ],
    sound: { sensitivity: -6, releaseMs: 400, strength: 2.5, contrast: 0.6, pitchReactive: 1.25, melody: 0.15, glideMs: 320 },
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
      sound: DEFAULT_SOUND_SETTINGS,
      font: null,
      glyph: null,
    })
  })

  it('checks the Sound settings: each clamped to its slider and rounded to its step, otherwise the default', () => {
    const read = (sound: unknown) => readSession({ version: SESSION_VERSION, sound })!.sound
    // A version 2 session saved before the Response group existed: neutral Sound, as it was (Glide at its default, which
    // changes only how the shapes are shown).
    expect(read(undefined)).toEqual(DEFAULT_SOUND_SETTINGS)
    for (const garbage of [null, 'loud', 7, [], { strength: '2' }]) expect(read(garbage), JSON.stringify(garbage)).toEqual(DEFAULT_SOUND_SETTINGS)
    expect(read({ sensitivity: 99, releaseMs: 1, strength: -3, contrast: 7, pitchReactive: Infinity, melody: Number.NaN })).toEqual({
      ...DEFAULT_SOUND_SETTINGS,
      sensitivity: SOUND_LIMITS.maxSensitivity,
      releaseMs: SOUND_LIMITS.minReleaseMs,
      strength: 0,
      contrast: 1,
    })
    // Steps of 1 dB, 1 ms and 0.01 (Release and the Response sliders went from 10 ms and 0.05 to these in NOCUR-63).
    expect(read({ sensitivity: -3.4, releaseMs: 237.4, strength: 1.234, contrast: 0.456, pitchReactive: 0.333, melody: 1.967, extra: 1 })).toEqual({
      sensitivity: -3,
      releaseMs: 237,
      strength: 1.23,
      contrast: 0.46,
      pitchReactive: 0.33,
      melody: 1.97,
      // Saved before Glide existed: its default.
      glideMs: DEFAULT_SOUND_SETTINGS.glideMs,
    })
    // Glide: 0–1000 ms in steps of 10.
    expect([1234, 147, -5, 0].map((glideMs) => read({ glideMs })?.glideMs)).toEqual([1000, 150, 0, 0])
    // Values saved on the coarser steps are still on the finer ones, so they come back as they were.
    const coarse = { sensitivity: -3, releaseMs: 240, strength: 1.25, contrast: 0.46, pitchReactive: 0.35, melody: 1.95, glideMs: 150 }
    expect(read(coarse)).toEqual(coarse)
    // Saved as JSON, the values come back exactly.
    const storage = new MemoryStorage()
    saveSession({ ...changedSession(), sound: { ...DEFAULT_SOUND_SETTINGS, strength: 0.15, contrast: 0.07 } }, storage)
    expect(loadSession(storage).session!.sound).toEqual({ ...DEFAULT_SOUND_SETTINGS, strength: 0.15, contrast: 0.07 })
  })

  it('drops unknown keys and keeps the known ones', () => {
    const session = readSession({ version: 1, params: { anchors: { spacing: 9, wobble: 3 }, gizmo: { on: true } }, extra: 'x', view: { zoom: 4, outline: 'source' } })!
    expect(session.params.anchors).toEqual({ ...DEFAULT_SETTINGS.anchors, spacing: 9 })
    expect('gizmo' in session.params).toBe(false)
    expect('extra' in session).toBe(false)
    expect(session.view).toEqual({ ...DEFAULT_VIEW, outline: 'source' })
  })

  it('reads settings and configs saved before Dissolve with it off at its defaults, and a saved Dissolve clamped to its sliders', () => {
    const before = { version: SESSION_VERSION, params: { experimental: { seed: 7, thorn: { enabled: true } } } }
    const old = readSession(before)!
    expect(old.params.experimental.dissolve).toEqual(DEFAULT_SETTINGS.experimental.dissolve)
    expect(old.params.experimental.dissolve.enabled).toBe(false)
    expect([old.params.experimental.seed, old.params.experimental.thorn.enabled]).toEqual([7, true])
    const config = parseConfig(JSON.stringify({ ...CONFIG_MARKER, ...before }))
    expect(config).toEqual({ ok: true, session: old, newer: false })

    const saved = readSession({
      version: SESSION_VERSION,
      params: { experimental: { dissolve: { enabled: true, amount: 3, grain: 0.01, spread: 'wide', specks: -1, curl: 0.25, facets: 0.7 } } },
    })!
    expect(saved.params.experimental.dissolve).toEqual({
      enabled: true,
      amount: SLIDER_RANGES['experimental.dissolve.amount'].max,
      grain: SLIDER_RANGES['experimental.dissolve.grain'].min,
      spread: DEFAULT_SETTINGS.experimental.dissolve.spread,
      specks: 0,
      curl: 0.25,
      facets: 0.7,
    })
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

  it('round-trips Ripple and Thorn Reverse, and reads it as off where it is missing or not a boolean', () => {
    const storage = new MemoryStorage()
    const session = changedSession()
    const { ripple, thorn } = session.params.experimental
    session.params = { ...session.params, experimental: { ...session.params.experimental, ripple: { ...ripple, reverse: true }, thorn: { ...thorn, reverse: true } } }
    saveSession(session, storage)
    expect(JSON.parse(storage.items.get(SESSION_KEY)!).params.experimental.ripple.reverse).toBe(true)
    expect(loadSession(storage)).toEqual({ session, crashed: false })
    // Saved before Reverse existed (same session version), or damaged: off, the other settings kept.
    const { reverse: _ripple, ...oldRipple } = { ...ripple, amount: 0.8 }
    const { reverse: _thorn, ...oldThorn } = { ...thorn, count: 5 }
    const old = readSession({ version: SESSION_VERSION, params: { experimental: { ripple: oldRipple, thorn: oldThorn } } })!.params.experimental
    expect([old.ripple.reverse, old.ripple.amount, old.thorn.reverse, old.thorn.count]).toEqual([false, 0.8, false, 5])
    const damaged = readSession({ version: SESSION_VERSION, params: { experimental: { ripple: { reverse: 'yes' }, thorn: { reverse: 1 } } } })!.params.experimental
    expect([damaged.ripple.reverse, damaged.thorn.reverse]).toEqual([false, false])
  })

  it('round-trips Thorn Burst, and reads its keys at their defaults where missing or damaged, clamped to the sliders', () => {
    const storage = new MemoryStorage()
    const session = changedSession()
    const { thorn } = session.params.experimental
    session.params = { ...session.params, experimental: { ...session.params.experimental, thorn: { ...thorn, burst: true, spikes: 72, dent: 0.35, count: 12 } } }
    saveSession(session, storage)
    expect(JSON.parse(storage.items.get(SESSION_KEY)!).params.experimental.thorn).toMatchObject({ burst: true, spikes: 72, dent: 0.35, count: 12 })
    expect(loadSession(storage)).toEqual({ session, crashed: false })
    // Saved before Burst existed (same session version): off, at 40 spikes and Dent 80%, the other settings kept.
    const { burst: _burst, spikes: _spikes, dent: _dent, ...oldThorn } = { ...thorn, count: 5, reverse: true }
    const old = readSession({ version: SESSION_VERSION, params: { experimental: { thorn: oldThorn } } })!.params.experimental.thorn
    expect([old.burst, old.spikes, old.dent, old.count, old.reverse]).toEqual([false, 40, 0.8, 5, true])
    const damaged = readSession({ version: SESSION_VERSION, params: { experimental: { thorn: { burst: 'yes', spikes: '9', dent: null } } } })!.params.experimental.thorn
    expect([damaged.burst, damaged.spikes, damaged.dent]).toEqual([false, 40, 0.8])
    // Out of range: Burst's Anchors to 0–80 in whole spikes, Dent to 0–1, and Anchors without Burst to 0–12, apart.
    const wild = readSession({ version: SESSION_VERSION, params: { experimental: { thorn: { spikes: 500, dent: -2, count: 80 } } } })!.params.experimental.thorn
    expect([wild.spikes, wild.dent, wild.count]).toEqual([80, 0, 12])
    expect(readSession({ version: SESSION_VERSION, params: { experimental: { thorn: { spikes: 2.4 } } } })!.params.experimental.thorn.spikes).toBe(2)
    expect(readSession({ version: SESSION_VERSION, params: { experimental: { thorn: { spikes: 33.6 } } } })!.params.experimental.thorn.spikes).toBe(34)
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
    // The Blur slider's 0.1 px step; a blur saved on the old 0.5 px step stays as it was.
    for (const [blur, expected] of [[2.34, 2.3], [2.5, 2.5]]) expect(readSession({ version: SESSION_VERSION, previewLook: { blur } })!.previewLook.blur).toBe(expected)
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

describe('config file', () => {
  const NOT_CONFIG = 'This is not a None-Curve config file. Save one with Export → Config.'

  it('round-trips every part, marked and versioned, the same as the saved session', () => {
    const session = changedSession()
    const text = serializeConfig(session)
    const raw = JSON.parse(text)
    expect([raw.app, raw.kind, raw.version]).toEqual([CONFIG_MARKER.app, CONFIG_MARKER.kind, SESSION_VERSION])
    expect(parseConfig(text)).toEqual({ ok: true, session, newer: false })
    // The config is the saved session with the marker: the same keys and values.
    const { app: _app, kind: _kind, ...rest } = raw
    expect(rest).toEqual(JSON.parse(serializeSession(session)))
    expect(parseSession(serializeSession(session))).toEqual(session)
  })

  it('never writes Thorn\'s derived canvasEm, and caps the text', () => {
    const session = changedSession()
    const thorn = { ...session.params.experimental.thorn, canvasEm: 30.04 }
    const long = 'x'.repeat(MAX_SAVED_TEXT + 5)
    const raw = JSON.parse(serializeConfig({ ...session, text: long, params: { ...session.params, experimental: { ...session.params.experimental, thorn } } }))
    expect('canvasEm' in raw.params.experimental.thorn).toBe(false)
    expect(raw.text).toHaveLength(MAX_SAVED_TEXT)
  })

  it('refuses damaged JSON and JSON that is not a config, the saved session included', () => {
    expect(parseConfig('{"app":')).toEqual({ ok: false, error: 'The file is not valid JSON.' })
    expect(parseConfig('')).toEqual({ ok: false, error: 'The file is not valid JSON.' })
    const foreign = [
      null,
      42,
      'config',
      [CONFIG_MARKER],
      {},
      JSON.parse(serializeSession(changedSession())),
      { app: 'other-app', kind: 'config', version: SESSION_VERSION },
      { app: CONFIG_MARKER.app, kind: 'preset', version: SESSION_VERSION },
      { kind: CONFIG_MARKER.kind, params: {} },
    ]
    for (const value of foreign) expect(parseConfig(JSON.stringify(value)), JSON.stringify(value)).toEqual({ ok: false, error: NOT_CONFIG })
  })

  it('reads a damaged config leaf by leaf: wrong values are the defaults, unknown keys dropped', () => {
    const parsed = parseConfig(
      JSON.stringify({ ...CONFIG_MARKER, version: SESSION_VERSION, params: { anchors: { spacing: 'wide' }, palette: { ink: '#abc' } }, text: 7, mappings: 'all', extra: true }),
    )
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.session.params.anchors.spacing).toBe(DEFAULT_SETTINGS.anchors.spacing)
    expect(parsed.session.params.palette.ink).toBe('#aabbcc')
    expect(parsed.session.text).toBe(DEFAULT_TEXT)
    expect(parsed.session.mappings).toEqual([])
    expect('extra' in parsed.session).toBe(false)
  })

  it('migrates an older config as it migrates an older saved session', () => {
    const v1 = {
      version: 1,
      params: { experimental: { thorn: { enabled: true, reach: 0.6 } }, typography: { size: 48 }, artboard: { width: 1200, height: 800 } },
      mappings: [{ feature: 'level', target: 'experimental.thorn.reach', depth: 0.3 }],
    }
    const parsed = parseConfig(JSON.stringify({ ...CONFIG_MARKER, ...v1 }))
    expect(parsed).toEqual({ ok: true, session: readSession(v1), newer: false })
    if (!parsed.ok) return
    expect(parsed.session.params.experimental.thorn.canvasReach).toBe(0.02)
    expect(parsed.session.mappings[0].target).toBe('experimental.thorn.canvasReach')
    // Without a version: the oldest names (Noise became Crumple, Low became Bass).
    const unversioned = parseConfig(
      JSON.stringify({ ...CONFIG_MARKER, params: { experimental: { noise: { enabled: true } } }, mappings: [{ feature: 'low', target: 'experimental.noise.amount', depth: 0.4 }] }),
    )
    if (!unversioned.ok) throw new Error(unversioned.error)
    expect(unversioned.session.params.experimental.crumple.enabled).toBe(true)
    expect(unversioned.session.mappings.map((m) => [m.feature, m.target])).toEqual([['bass', 'experimental.crumple.amount']])
  })

  it('reads a newer config as far as it fits, and says so', () => {
    const session = changedSession()
    const raw = { ...JSON.parse(serializeConfig(session)), version: SESSION_VERSION + 1, future: { setting: 1 } }
    expect(parseConfig(JSON.stringify(raw))).toEqual({ ok: true, session, newer: true })
  })
})
