import type { GeometryParams, GlyphRef } from '../geometry/types'
import type { FontErrorKind } from '../font/errors'
import type { LoadedFont } from '../font/model'

// ---- Document state ----

export type ImportOrigin = 'local' | 'google'

export type LoadStatus =
  | { kind: 'empty' }
  | { kind: 'loading'; requestId: number; origin: ImportOrigin; label: string }
  | { kind: 'ready' }
  | { kind: 'error'; origin: ImportOrigin; errorKind: FontErrorKind; message: string }

export type ExportFormat = 'svg' | 'otf'

export interface ExportMeta {
  format: ExportFormat
  /** Decimal places kept in SVG coordinates. */
  precision: number
  lastExport: { fileName: string; at: string } | null
}

export interface DocumentState {
  status: LoadStatus
  /** The last successfully parsed font. Kept while a new import loads or fails. */
  font: LoadedFont | null
  selectedGlyph: GlyphRef | null
  export: ExportMeta
}

// ---- Parameter state ----

/** Which outline the canvas draws: original curves, the flattened polygon, or both overlaid. */
export type OutlineView = 'source' | 'flattened' | 'compare'

export interface ViewParams {
  outline: OutlineView
  showFill: boolean
  showSkeleton: boolean
  /** Generated polygon vertices. */
  showVertices: boolean
  showMetrics: boolean
  /** 1 = glyph fitted to the viewport. */
  zoom: number
  /** Pan offset in font units. */
  panX: number
  panY: number
}

export interface EditorParams extends GeometryParams {
  view: ViewParams
}

export interface AppState {
  document: DocumentState
  params: EditorParams
}
