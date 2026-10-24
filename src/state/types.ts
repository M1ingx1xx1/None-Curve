import type { GeometryParams, GlyphRef } from '../geometry/types'
import type { FontErrorKind } from '../font/errors'
import type { LoadedFont } from '../font/model'
import type { ArtboardParams, PaletteParams, TypographyParams } from '../specimen/artboard'

// ---- Document state ----

export type ImportOrigin = 'local' | 'google'

export type LoadStatus =
  | { kind: 'empty' }
  | { kind: 'loading'; requestId: number; origin: ImportOrigin; label: string }
  | { kind: 'ready' }
  | { kind: 'error'; origin: ImportOrigin; errorKind: FontErrorKind; message: string }

export interface ExportMeta {
  /** Decimal places kept in SVG coordinates. */
  precision: number
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

/** The canvas view's outline and layer buttons: saved between visits, but not undone. */
export interface ViewToggles {
  outline: OutlineView
  showFill: boolean
  showSkeleton: boolean
  /** Generated polygon vertices. */
  showVertices: boolean
  showMetrics: boolean
}

/**
 * Where the canvas looks: neither undone nor saved. Kept outside the editor state (state/canvasView.ts), so a drag
 * or a wheel turn re-renders the canvas alone.
 */
export interface PanZoom {
  /** 1 = glyph fitted to the viewport. */
  zoom: number
  /** Pan offset in font units. */
  panX: number
  panY: number
}

/** The whole canvas view, as the canvas renderers draw it. */
export type ViewParams = ViewToggles & PanZoom

export interface EditorParams extends GeometryParams {
  view: ViewToggles
  /** How the text is set on the artboard; not part of the glyph geometry or the font export. */
  typography: TypographyParams
  palette: PaletteParams
  artboard: ArtboardParams
}

/**
 * The settings: every parameter group except the canvas view (outline and layers). Undo restores them; they are
 * also saved between visits.
 */
export type SettingsParams = Omit<EditorParams, 'view'>

export interface AppState {
  document: DocumentState
  params: EditorParams
}
