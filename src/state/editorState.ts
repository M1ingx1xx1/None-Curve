import type { FontErrorKind } from '../font/errors'
import { pickDefaultGlyph, type LoadedFont } from '../font/model'
import { DEFAULT_ARTBOARD, DEFAULT_PALETTE, DEFAULT_TYPOGRAPHY } from '../specimen/artboard'
import { canvasDiagonalEm } from '../geometry/thorn'
import type { ExperimentalParams, GlyphRef } from '../geometry/types'
import type { AppState, EditorParams, ExportMeta, ImportOrigin, SettingsParams, ViewParams } from './types'

const initialView: ViewParams = {
  outline: 'flattened',
  showFill: true,
  showSkeleton: false,
  showVertices: false,
  showMetrics: false,
  zoom: 1,
  panX: 0,
  panY: 0,
}

export const initialState: AppState = {
  document: {
    status: { kind: 'empty' },
    font: null,
    selectedGlyph: null,
    export: { format: 'svg', precision: 2, lastExport: null },
  },
  params: {
    flatten: { mode: 'adaptive', tolerance: 4, segmentsPerCurve: 4, mergeCurves: false, breakAt: 'extrema', cornerAngle: 15, mergeLines: false },
    random: { enabled: false, density: 12, randomness: 1, keepCorners: true, seed: 1 },
    squaring: { amount: 0, scope: 'round' },
    anchors: { spacing: 0, simplify: 0 },
    grid: { snap: false, size: 10, angleLock: false, angleStep: 45 },
    distortion: { amount: 0, frequency: 8, normalBias: 0.7, seed: 1, sparse: false },
    experimental: {
      seed: 1,
      crumple: { enabled: false, amount: 0.7, facet: 0.18, turn: 0 },
      ripple: { enabled: false, amount: 0.5, wavelength: 0.3, sides: 8, centerX: 0.5, centerY: 0.5, fade: 0, petals: 0 },
      whorl: { enabled: false, amount: 0.6, rings: 6, sides: 8, pinned: true },
      slipstream: { enabled: false, direction: 0, strength: 0.15, gust: 0.12, gustiness: 0.6, slip: 0.15, cuts: 2, trails: 2 },
      thorn: { enabled: false, count: 3, canvasReach: 0.1, spread: 0.5, width: 0.3, root: 0.5, refraction: 0, flute: 0.1 },
      dissolve: { enabled: false, amount: 0.5, grain: 0.4, spread: 0.8, specks: 0.4, curl: 0.6, facets: 0.3 },
    },
    view: initialView,
    typography: DEFAULT_TYPOGRAPHY,
    palette: DEFAULT_PALETTE,
    artboard: DEFAULT_ARTBOARD,
  },
}

/**
 * The canvas diagonal in em (canvasDiagonalEm), which Thorn's Reach is a share of, while Thorn is on; else
 * null, so with Thorn off the text size and canvas never change the geometry. The PNG scale never counts.
 */
export function thornCanvasEm({ experimental, typography, artboard }: Pick<EditorParams, 'experimental' | 'typography' | 'artboard'>): number | null {
  return experimental.thorn?.enabled ? canvasDiagonalEm(artboard.width, artboard.height, typography.size) : null
}

/**
 * The Experimental params with Thorn's derived `canvasEm` set, or removed for null; the same object when
 * nothing changes. It only rides on the geometry parameters: never in the state, undo history or saved sessions.
 */
export function withThornCanvasEm(experimental: ExperimentalParams, canvasEm: number | null): ExperimentalParams {
  const { thorn } = experimental
  if (!thorn || (thorn.canvasEm ?? null) === canvasEm) return experimental
  if (canvasEm !== null) return { ...experimental, thorn: { ...thorn, canvasEm } }
  const { canvasEm: _derived, ...settings } = thorn
  return { ...experimental, thorn: settings }
}

type ParamGroup = keyof EditorParams

export type Action =
  | { [G in ParamGroup]: { type: 'updateParams'; group: G; patch: Partial<EditorParams[G]> } }[ParamGroup]
  /** Undo and redo: every settings group at once; the canvas view is kept. */
  | { type: 'restoreParams'; params: SettingsParams }
  | { type: 'resetView' }
  /** Reset all: the state the editor first opens with, the font closed (an import in flight is dropped). */
  | { type: 'resetAll' }
  | { type: 'updateExport'; patch: Partial<ExportMeta> }
  /** keepView leaves zoom and pan alone (selecting inside the text specimen). */
  | { type: 'selectGlyph'; glyph: GlyphRef | null; keepView?: boolean }
  | { type: 'importStarted'; requestId: number; origin: ImportOrigin; label: string }
  | { type: 'importSucceeded'; requestId: number; font: LoadedFont }
  | { type: 'importFailed'; requestId: number; origin: ImportOrigin; errorKind: FontErrorKind; message: string }
  | { type: 'importCancelled'; requestId: number }

function isActiveRequest(state: AppState, requestId: number): boolean {
  return state.document.status.kind === 'loading' && state.document.status.requestId === requestId
}

export function editorReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'updateParams':
      return {
        ...state,
        params: {
          ...state.params,
          [action.group]: { ...state.params[action.group], ...action.patch },
        },
      }
    case 'restoreParams':
      return { ...state, params: { ...action.params, view: state.params.view } }
    case 'resetAll':
      return initialState
    case 'resetView':
      return { ...state, params: { ...state.params, view: { ...state.params.view, zoom: 1, panX: 0, panY: 0 } } }
    case 'updateExport':
      return {
        ...state,
        document: { ...state.document, export: { ...state.document.export, ...action.patch } },
      }
    case 'selectGlyph':
      return {
        ...state,
        document: { ...state.document, selectedGlyph: action.glyph },
        params: action.keepView
          ? state.params
          : { ...state.params, view: { ...state.params.view, zoom: 1, panX: 0, panY: 0 } },
      }
    case 'importStarted':
      return {
        ...state,
        document: {
          ...state.document,
          status: { kind: 'loading', requestId: action.requestId, origin: action.origin, label: action.label },
        },
      }
    case 'importSucceeded': {
      // A newer import has started since this one; drop the stale result.
      if (!isActiveRequest(state, action.requestId)) return state
      const { font } = action
      // Another face of the open collection (the same file in memory, see selectFace): the view stays, and so
      // does the selected character when this face has it.
      const otherFace = font.faces !== null && state.document.font?.bytes === font.bytes
      const unicode = otherFace ? (state.document.selectedGlyph?.unicode ?? null) : null
      const kept = unicode === null ? undefined : font.characters.find((c) => c.unicode === unicode)
      return {
        ...state,
        document: {
          ...state.document,
          status: { kind: 'ready' },
          font,
          selectedGlyph: kept ?? pickDefaultGlyph(font),
        },
        params: otherFace ? state.params : { ...state.params, view: { ...state.params.view, zoom: 1, panX: 0, panY: 0 } },
      }
    }
    case 'importFailed':
      if (!isActiveRequest(state, action.requestId)) return state
      return {
        ...state,
        document: {
          ...state.document,
          status: { kind: 'error', origin: action.origin, errorKind: action.errorKind, message: action.message },
        },
      }
    case 'importCancelled':
      if (!isActiveRequest(state, action.requestId)) return state
      return {
        ...state,
        document: { ...state.document, status: state.document.font ? { kind: 'ready' } : { kind: 'empty' } },
      }
  }
}
