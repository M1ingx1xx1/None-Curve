import type { GlyphRef } from '../geometry/types'
import type { AppState, EditorParams, ExportMeta } from './types'

export const initialState: AppState = {
  document: {
    status: { kind: 'empty' },
    font: null,
    selectedGlyph: null,
    export: { format: 'svg', precision: 2, lastExport: null },
  },
  params: {
    flatten: { mode: 'adaptive', tolerance: 2, segmentsPerCurve: 4 },
    anchors: { spacing: 0, simplify: 0 },
    grid: { snap: false, size: 10, angleLock: false, angleStep: 15 },
    distortion: { amount: 0, seed: 1 },
    view: { mode: 'outline', zoom: 1, panX: 0, panY: 0, showMetrics: true },
  },
}

type ParamGroup = keyof EditorParams

export type Action =
  | { [G in ParamGroup]: { type: 'updateParams'; group: G; patch: Partial<EditorParams[G]> } }[ParamGroup]
  | { type: 'updateExport'; patch: Partial<ExportMeta> }
  | { type: 'selectGlyph'; glyph: GlyphRef | null }

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
    case 'updateExport':
      return {
        ...state,
        document: { ...state.document, export: { ...state.document.export, ...action.patch } },
      }
    case 'selectGlyph':
      return { ...state, document: { ...state.document, selectedGlyph: action.glyph } }
  }
}
