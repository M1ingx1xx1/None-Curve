import type { GeometryParams, GlyphRef } from '../geometry/types'

// ---- Document state ----

export type FontFormat = 'ttf' | 'otf'

export interface FontFileInfo {
  fileName: string
  format: FontFormat
  byteSize: number
  familyName: string | null
  unitsPerEm: number | null
  glyphCount: number | null
}

export type LoadStatus =
  | { kind: 'empty' }
  | { kind: 'loading'; fileName: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

export type ExportFormat = 'svg' | 'otf'

export interface ExportMeta {
  format: ExportFormat
  /** Decimal places kept in SVG coordinates. */
  precision: number
  lastExport: { fileName: string; at: string } | null
}

export interface DocumentState {
  status: LoadStatus
  font: FontFileInfo | null
  selectedGlyph: GlyphRef | null
  export: ExportMeta
}

// ---- Parameter state ----

export type ViewMode = 'outline' | 'skeleton' | 'fill'

export interface ViewParams {
  mode: ViewMode
  zoom: number
  panX: number
  panY: number
  showMetrics: boolean
}

export interface EditorParams extends GeometryParams {
  view: ViewParams
}

export interface AppState {
  document: DocumentState
  params: EditorParams
}
