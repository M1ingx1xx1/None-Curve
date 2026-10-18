// The session saved between visits in localStorage: the settings, the canvas view's buttons, the text,
// the preview look, the export precision, the Sound mappings and Response group (Sensitivity, Release,
// Strength, Motion contrast, Pitch reactive, Melody tracking, Glide), and which font and glyph were open. Read
// once on start and checked leaf by leaf against the defaults, so a damaged or older entry never breaks
// the app; written a moment after each change. A config file (Export → Config, Import → Config file) holds
// the same session, marked as this app's, and is read back the same way.

import { ANGLE_STEPS } from '../geometry/constraints'
import type { BreakRule } from '../geometry/curveRuns'
import type { FlattenMode } from '../geometry/types'
import type { SquaringScope } from '../geometry/squaring'
import { THORN_LIMITS } from '../geometry/thorn'
import type { GoogleFontRequest } from '../font/google'
import type { LoadedFont } from '../font/model'
import { clampShaping, featureById, shapingChanges, targetById, type FeatureId, type Mapping } from '../sound/mapping'
import { clampDepth, MAPPING_LIMITS } from '../sound/mappingStore'
import { DEFAULT_SOUND_SETTINGS, RESPONSE_LIMITS, snapToStep, SOUND_LIMITS, type SoundSettings } from '../sound/types'
import {
  ARTBOARD_LIMITS,
  normalizeHex,
  TEXT_ANCHORS,
  TYPOGRAPHY_LIMITS,
  type TextAlign,
  type TextCase,
  type TextPosition,
} from '../specimen/artboard'
import { DEFAULT_TEXT } from '../specimen/samples'
import { DEFAULT_PREVIEW_LOOK, MAX_PREVIEW_BLUR, PREVIEW_BLUR_STEP, type PreviewLook } from '../specimen/previewLook'
import { initialState, withThornCanvasEm } from './editorState'
import { reachFromSlider, roundReach, THORN_REACH } from './sliderScales'
import type { OutlineView, SettingsParams, ViewToggles } from './types'

const SESSION_KEY = 'none-curve:session'
/** Set while settings restored from the last visit are first drawn; still set on the next start means that visit never finished. */
const RESTORING_KEY = 'none-curve:restoring'
export const SESSION_VERSION = 2
/** Characters of text saved at most. */
export const MAX_SAVED_TEXT = 10_000
/** Wait this long after a change before saving (changes during a slider drag are saved once). */
export const SAVE_DELAY_MS = 500

/** The font to open again: a Google Fonts face is downloaded again; a local file can only be named. */
export type SavedFont = ({ kind: 'google' } & GoogleFontRequest) | { kind: 'local'; fileName: string }

/** The selected glyph, restored only in the same family and style. */
export interface SavedGlyph {
  family: string
  style: string
  index: number
  unicode: number | null
}

export interface Session {
  params: SettingsParams
  view: ViewToggles
  text: string
  previewLook: PreviewLook
  precision: number
  mappings: readonly Mapping[]
  /** The Sound tab's Response group; readSession always fills it (missing in sessions saved before it existed). */
  sound?: SoundSettings
  font: SavedFont | null
  glyph: SavedGlyph | null
}

export interface RestoredSession {
  /** Null when nothing usable was saved. */
  session: Session | null
  /**
   * The last visit closed while drawing its restored settings (the page may have crashed): the settings
   * and the view are left at their defaults this time; the rest is restored.
   */
  crashed: boolean
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

/** localStorage, or null where reading it throws (blocked storage). */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const DEFAULT_SETTINGS: SettingsParams = (({ view: _view, ...settings }) => settings)(initialState.params)
const { outline, showFill, showSkeleton, showVertices, showMetrics } = initialState.params.view
const DEFAULT_VIEW: ViewToggles = { outline, showFill, showSkeleton, showVertices, showMetrics }

// ---- Migrations ----

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Phase 9 of the Experimental tab renamed the effects (EXPERIMENTAL_PLAN). */
const EFFECT_RENAMES: Record<string, string> = { noise: 'crumple', curl: 'whorl', wind: 'slipstream', spikes: 'thorn' }
/** The Sound features merged from 20 to 10 (SOUND_PLAN); dropped ones (Sub, Presence, Width…) have no entry. */
const FEATURE_RENAMES: Record<string, FeatureId> = {
  low: 'bass',
  mid: 'mids',
  high: 'treble',
  beatPulse: 'beat',
  kick: 'beat',
  kickPulse: 'beat',
  change: 'activity',
  pace: 'activity',
  balance: 'pan',
}

/** Settings written before sessions had a version: the old effect and feature names become the new ones. */
function fromUnversioned(raw: Raw): Raw {
  const params = isObject(raw.params) ? { ...raw.params } : raw.params
  if (isObject(params) && isObject(params.experimental)) {
    const experimental = { ...params.experimental }
    for (const [old, name] of Object.entries(EFFECT_RENAMES)) {
      if (experimental[name] === undefined && experimental[old] !== undefined) experimental[name] = experimental[old]
      delete experimental[old]
    }
    params.experimental = experimental
  }
  const mappings = Array.isArray(raw.mappings)
    ? raw.mappings.map((m) => {
        if (!isObject(m)) return m
        const feature = typeof m.feature === 'string' ? (FEATURE_RENAMES[m.feature] ?? m.feature) : m.feature
        const effect = typeof m.target === 'string' ? /^experimental\.(\w+)\.(.+)$/.exec(m.target) : null
        const target = effect && EFFECT_RENAMES[effect[1]] ? `experimental.${EFFECT_RENAMES[effect[1]]}.${effect[2]}` : m.target
        return { ...m, feature, target }
      })
    : raw.mappings
  return { ...raw, params, mappings, version: 1 }
}

/**
 * Version 2 measures Thorn's Reach on the canvas diagonal (canvasReach, 0–1) instead of the em (reach, 0–2):
 * the old reach becomes the same length on the saved text size and canvas (read as sanitize reads them, and
 * capped at THORN_LIMITS.maxReachEm, as Thorn caps it), and Sound rows on Reach keep their depth.
 */
function fromV1(raw: Raw): Raw {
  const params = isObject(raw.params) ? { ...raw.params } : raw.params
  if (isObject(params) && isObject(params.experimental) && isObject(params.experimental.thorn)) {
    const { reach, ...thorn } = params.experimental.thorn
    if (typeof reach === 'number' && Number.isFinite(reach)) {
      const { size } = sanitize(DEFAULT_SETTINGS.typography, params.typography, 'typography')
      const { width, height } = sanitize(DEFAULT_SETTINGS.artboard, params.artboard, 'artboard')
      const canvasEm = Math.min(Math.hypot(width, height) / size, THORN_LIMITS.maxReachEm)
      // A reach that was on stays on: at least the slider's first step.
      thorn.canvasReach = reach > 0 ? Math.max(roundReach(clamp(reach / canvasEm, 0, 1)), reachFromSlider(THORN_REACH.slider.step)) : 0
    }
    params.experimental = { ...params.experimental, thorn }
  }
  const mappings = Array.isArray(raw.mappings)
    ? raw.mappings.map((m) => (isObject(m) && m.target === 'experimental.thorn.reach' ? { ...m, target: 'experimental.thorn.canvasReach' } : m))
    : raw.mappings
  return { ...raw, params, mappings, version: 2 }
}

/** Steps from each older version to the next; the last one reaches SESSION_VERSION. */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = { 0: fromUnversioned, 1: fromV1 }

function migrate(raw: Raw): Raw {
  let version = typeof raw.version === 'number' && Number.isInteger(raw.version) ? raw.version : 0
  while (version < SESSION_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) break
    raw = step(raw)
    version++
  }
  // A newer version's session (after going back to an older app) is read as far as it fits.
  return raw
}

// ---- Checking a saved session ----

const ENUMS: Record<string, readonly string[]> = {
  'flatten.mode': ['adaptive', 'segments'] satisfies FlattenMode[],
  'flatten.breakAt': ['extrema', 'corners'] satisfies BreakRule[],
  'squaring.scope': ['round', 'all'] satisfies SquaringScope[],
  'typography.align': ['left', 'center', 'right'] satisfies TextAlign[],
  'typography.position': [...TEXT_ANCHORS, 'free'] satisfies TextPosition[],
  'typography.textCase': ['none', 'upper', 'lower', 'title'] satisfies TextCase[],
  outline: ['source', 'flattened', 'compare'] satisfies OutlineView[],
}

const { minSize, maxSize, minTracking, maxTracking, minLineHeight, maxLineHeight, maxSlant } = TYPOGRAPHY_LIMITS
/** Ranges of the settings no Sound target describes; [min, max, whole numbers]. */
const RANGES: Record<string, readonly [number, number, boolean?]> = {
  'typography.size': [minSize, maxSize],
  'typography.tracking': [minTracking, maxTracking],
  'typography.lineHeight': [minLineHeight, maxLineHeight],
  'typography.slant': [-maxSlant, maxSlant],
  'typography.freeX': [0, 1],
  'typography.freeY': [0, 1],
  'artboard.width': [ARTBOARD_LIMITS.min, ARTBOARD_LIMITS.max, true],
  'artboard.height': [ARTBOARD_LIMITS.min, ARTBOARD_LIMITS.max, true],
}
/** Settings that take only some numbers. */
const CHOICES: Record<string, readonly number[]> = {
  'grid.angleStep': ANGLE_STEPS,
  'artboard.scale': ARTBOARD_LIMITS.scales,
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** A saved leaf as the setting at `path` accepts it, or undefined (the default is used). */
function readLeaf(path: string, value: unknown, fallback: unknown): unknown {
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : undefined
  if (typeof fallback === 'string') {
    if (typeof value !== 'string') return undefined
    if (path === 'palette.ink' || path === 'palette.paper') return normalizeHex(value) ?? undefined
    return ENUMS[path]?.includes(value) ? value : undefined
  }
  if (typeof fallback !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const choices = CHOICES[path]
  if (choices) return choices.includes(value) ? value : undefined
  // The slider's own range: every Geometry and Experimental slider and seed is a Sound target (the Typography
  // sliders are too, but keep their ranges below, which do not round).
  const target = targetById(path)
  if (target && (target.tab === 'geometry' || target.tab === 'experimental')) return Number.isInteger(target.step) ? Math.round(clamp(value, target.min, target.max)) : clamp(value, target.min, target.max)
  const range = RANGES[path]
  if (range) return range[2] ? Math.round(clamp(value, range[0], range[1])) : clamp(value, range[0], range[1])
  return value
}

/** `saved` reshaped like `defaults`: each leaf saved with the right type and in range, every other leaf (and every missing one) the default. Unknown keys are dropped. */
function sanitize<T>(defaults: T, saved: unknown, path = ''): T {
  if (!isObject(defaults)) {
    const value = readLeaf(path, saved, defaults)
    return (value === undefined ? defaults : value) as T
  }
  const source = isObject(saved) ? saved : {}
  const result: Raw = {}
  for (const [key, fallback] of Object.entries(defaults)) result[key] = sanitize(fallback, source[key], path ? `${path}.${key}` : key)
  return result as T
}

/** At most MAX_SAVED_TEXT characters, never ending in half a surrogate pair. */
export function capText(text: string): string {
  if (text.length <= MAX_SAVED_TEXT) return text
  const end = /[\uD800-\uDBFF]/.test(text[MAX_SAVED_TEXT - 1]) ? MAX_SAVED_TEXT - 1 : MAX_SAVED_TEXT
  return text.slice(0, end)
}

/**
 * The saved mappings, each checked. Their shaping (Range, Curve, Smooth, Gate, Mode) is clamped to its limits; a field
 * that is missing (mappings saved before shaping existed) or damaged is its default, and only fields that differ from
 * their defaults are kept, so an older mapping reads back exactly as it was saved.
 */
function readMappings(saved: unknown): Mapping[] {
  if (!Array.isArray(saved)) return []
  const mappings: Mapping[] = []
  for (const m of saved) {
    if (mappings.length >= MAPPING_LIMITS.maxMappings) break
    if (!isObject(m) || typeof m.feature !== 'string' || typeof m.target !== 'string') continue
    const feature = featureById(m.feature)
    const target = targetById(m.target)
    if (!feature || !target || typeof m.depth !== 'number' || !Number.isFinite(m.depth)) continue
    // A seed's Rate is never negative (as the Sound tab keeps it).
    const depth = target.kind === 'jump' ? Math.abs(clampDepth(m.depth)) : clampDepth(m.depth)
    mappings.push({
      id: `m${mappings.length + 1}`,
      enabled: typeof m.enabled === 'boolean' ? m.enabled : true,
      feature: feature.id,
      target: target.id,
      depth,
      ...shapingChanges(clampShaping(m)),
    })
  }
  return mappings
}

/** Range and step of each saved Sound setting: the Response group's sliders. */
const SOUND_RANGES: { [K in keyof SoundSettings]: { min: number; max: number; step: number } } = {
  sensitivity: { min: SOUND_LIMITS.minSensitivity, max: SOUND_LIMITS.maxSensitivity, step: SOUND_LIMITS.sensitivityStep },
  releaseMs: { min: SOUND_LIMITS.minReleaseMs, max: SOUND_LIMITS.maxReleaseMs, step: SOUND_LIMITS.releaseStepMs },
  strength: RESPONSE_LIMITS.strength,
  contrast: RESPONSE_LIMITS.contrast,
  pitchReactive: RESPONSE_LIMITS.pitchReactive,
  melody: RESPONSE_LIMITS.melody,
  glideMs: RESPONSE_LIMITS.glideMs,
}

/** The saved Sound settings: each a finite number, clamped to its slider and rounded to its step; otherwise the default. */
export function readSound(saved: unknown): SoundSettings {
  const source = isObject(saved) ? saved : {}
  const sound = { ...DEFAULT_SOUND_SETTINGS }
  for (const key of Object.keys(SOUND_RANGES) as (keyof SoundSettings)[]) {
    const value = source[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max, step } = SOUND_RANGES[key]
    sound[key] = snapToStep(clamp(value, min, max), step)
  }
  return sound
}

const shortText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

function readFont(saved: unknown): SavedFont | null {
  if (!isObject(saved)) return null
  if (saved.kind === 'local') return shortText(saved.fileName, 255) ? { kind: 'local', fileName: saved.fileName } : null
  if (saved.kind !== 'google') return null
  const { family, weight, italic, subset } = saved
  if (!shortText(family, 200) || !shortText(subset, 100) || typeof italic !== 'boolean') return null
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1 || weight > 1000) return null
  return { kind: 'google', family, weight, italic, subset }
}

function readGlyph(saved: unknown): SavedGlyph | null {
  if (!isObject(saved) || typeof saved.family !== 'string' || typeof saved.style !== 'string') return null
  const { index, unicode } = saved
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
  if (unicode !== null && (typeof unicode !== 'number' || !Number.isInteger(unicode) || unicode < 0 || unicode > 0x10ffff)) return null
  return { family: saved.family, style: saved.style, index, unicode }
}

/** A saved session (any version) as this version reads it; null when it is not a session at all. */
export function readSession(raw: unknown): Session | null {
  if (!isObject(raw)) return null
  const saved = migrate(raw)
  const look = isObject(saved.previewLook) ? saved.previewLook : {}
  const blur = typeof look.blur === 'number' && Number.isFinite(look.blur) ? snapToStep(clamp(look.blur, 0, MAX_PREVIEW_BLUR), PREVIEW_BLUR_STEP) : DEFAULT_PREVIEW_LOOK.blur
  const precision = saved.precision
  return {
    params: sanitize(DEFAULT_SETTINGS, saved.params),
    view: sanitize(DEFAULT_VIEW, saved.view),
    text: typeof saved.text === 'string' ? capText(saved.text) : DEFAULT_TEXT,
    previewLook: { blur, inverted: typeof look.inverted === 'boolean' ? look.inverted : DEFAULT_PREVIEW_LOOK.inverted },
    precision:
      typeof precision === 'number' && Number.isInteger(precision) && precision >= 0 && precision <= 4
        ? precision
        : initialState.document.export.precision,
    mappings: readMappings(saved.mappings),
    sound: readSound(saved.sound),
    font: readFont(saved.font),
    glyph: readGlyph(saved.glyph),
  }
}

// ---- As text: the saved session and the config file ----

/** The session as it is written: with its version, without Thorn's derived canvasEm, the text capped. */
function sessionRecord(session: Session): Raw {
  const params = { ...session.params, experimental: withThornCanvasEm(session.params.experimental, null) }
  return { version: SESSION_VERSION, ...session, params, text: capText(session.text) }
}

/** The session as the JSON kept in storage. */
export function serializeSession(session: Session): string {
  return JSON.stringify(sessionRecord(session))
}

/** JSON written by serializeSession (any version), checked; null when it is not JSON or not a session. */
export function parseSession(text: string): Session | null {
  try {
    return readSession(JSON.parse(text))
  } catch {
    return null
  }
}

/** Marks a config file (Export → Config) as this app's: `app` and `kind` beside the session's own keys. */
export const CONFIG_MARKER = { app: 'none-curve', kind: 'config' } as const
/** A larger file is not read: a config holds at most MAX_SAVED_TEXT characters of text and a few mappings. */
export const MAX_CONFIG_BYTES = 1_000_000

/** The session as a config file: the same keys as the saved session, marked, indented to be readable. */
export function serializeConfig(session: Session): string {
  return `${JSON.stringify({ ...CONFIG_MARKER, ...sessionRecord(session) }, null, 2)}\n`
}

export type ParsedConfig =
  /** `newer`: written by a newer version of the app; what this one does not know was left out. */
  | { ok: true; session: Session; newer: boolean }
  | { ok: false; error: string }

/** A config file's text, read as a saved session is (migrated, checked leaf by leaf); anything else is refused. */
export function parseConfig(text: string): ParsedConfig {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }
  if (!isObject(raw) || raw.app !== CONFIG_MARKER.app || raw.kind !== CONFIG_MARKER.kind) {
    return { ok: false, error: 'This is not a None-Curve config file. Save one with Export → Config.' }
  }
  const { app: _app, kind: _kind, ...saved } = raw
  // An object always reads as a session (every damaged leaf is the default).
  return { ok: true, session: readSession(saved)!, newer: typeof saved.version === 'number' && saved.version > SESSION_VERSION }
}

// ---- Storage ----

/**
 * The session saved by the last visit, checked. After a visit that closed while drawing restored
 * settings, those settings (and the view) are left out this time, so a setting that crashes the page
 * cannot do so on every start.
 */
export function loadSession(storage: Storage | null = browserStorage()): RestoredSession {
  if (!storage) return { session: null, crashed: false }
  let session: Session | null = null
  let crashed = false
  try {
    const text = storage.getItem(SESSION_KEY)
    session = text ? parseSession(text) : null
    crashed = session !== null && storage.getItem(RESTORING_KEY) !== null
    storage.removeItem(RESTORING_KEY)
  } catch {
    // Unreadable (blocked storage, damaged JSON): start fresh.
    return { session: null, crashed: false }
  }
  if (session && crashed) session = { ...session, params: DEFAULT_SETTINGS, view: DEFAULT_VIEW }
  return { session, crashed }
}

/** Saves the session; false when the browser refuses (storage full or blocked). */
export function saveSession(session: Session, storage: Storage | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(SESSION_KEY, serializeSession(session))
    return true
  } catch {
    return false
  }
}

/** Restored settings are about to be drawn for the first time (see loadSession). */
export function markRestoring(storage: Storage | null = browserStorage()): void {
  try {
    storage?.setItem(RESTORING_KEY, '1')
  } catch {
    // Without the mark a crash is not detected next time; nothing else changes.
  }
}

/** The restored settings were drawn (or the page closed normally). */
export function clearRestoring(storage: Storage | null = browserStorage()): void {
  try {
    storage?.removeItem(RESTORING_KEY)
  } catch {
    // As above.
  }
}

/** Saves `read()` SAVE_DELAY_MS after the last schedule(), or at once on flush() (the page is hidden or closing). */
export function createSessionSaver(read: () => Session, storage?: Storage | null, delay: number = SAVE_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
    saveSession(read(), storage)
  }
  const schedule = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, delay)
  }
  return { schedule, flush }
}

/** How to open a loaded font again next visit. */
export function savedFont(font: LoadedFont): SavedFont {
  const { source } = font
  return source.kind === 'google'
    ? { kind: 'google', family: source.family, weight: source.weight, italic: source.italic, subset: source.subset }
    : { kind: 'local', fileName: source.fileName }
}
