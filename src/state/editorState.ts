import type { FontErrorKind } from '../font/errors'
import { pickDefaultGlyph, type LoadedFont } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import type { AppState, EditorParams, ExportMeta, ImportOrigin, ViewParams } from './types'

const initialView: ViewParams = {
  outline: 'flattened',
  showFill: true,
  showSkeleton: false,
  showVertices: true,
  showMetrics: true,
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
    flatten: { mode: 'adaptive', tolerance: 4, segmentsPerCurve: 4 },
    anchors: { spacing: 0, simplify: 0 },
    grid: { snap: false, size: 10, angleLock: false, angleStep: 45 },
    distortion: { amount: 0, frequency: 8, normalBias: 0.7, seed: 1 },
    view: initialView,
  },
}

type ParamGroup = keyof EditorParams

export type Action =
  | { [G in ParamGroup]: { type: 'updateParams'; group: G; patch: Partial<EditorParams[G]> } }[ParamGroup]
  | { type: 'resetView' }
  | { type: 'updateExport'; patch: Partial<ExportMeta> }
  | { type: 'selectGlyph'; glyph: GlyphRef | null }
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
        params: { ...state.params, view: { ...state.params.view, zoom: 1, panX: 0, panY: 0 } },
      }
    case 'importStarted':
      return {
        ...state,
        document: {
          ...state.document,
          status: { kind: 'loading', requestId: action.requestId, origin: action.origin, label: action.label },
        },
      }
    case 'importSucceeded':
      // A newer import has started since this one; drop the stale result.
      if (!isActiveRequest(state, action.requestId)) return state
      return {
        ...state,
        document: {
          ...state.document,
          status: { kind: 'ready' },
          font: action.font,
          selectedGlyph: pickDefaultGlyph(action.font),
        },
        params: { ...state.params, view: { ...state.params.view, zoom: 1, panX: 0, panY: 0 } },
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
