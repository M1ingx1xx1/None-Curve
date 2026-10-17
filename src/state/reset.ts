// Reset all settings (the status bar's button): every setting the undo history holds goes back to its
// default in one undo step: Geometry, Experimental, typography, colour and canvas, the Sound mappings and
// the Response group. The preview look (Blur and Invert) and the export precision go back too, outside the
// history, so Undo leaves them reset. The font, the selected glyph and the text stay, and so does the rest
// of what the history leaves alone: the canvas view (outline, layers, zoom and pan), the other export
// options, Drive letters and the interface theme.

import { DEFAULT_SOUND_SETTINGS } from '../sound/types'
import { DEFAULT_PREVIEW_LOOK, type PreviewLook } from '../specimen/previewLook'
import { initialState } from './editorState'
import { changedSettings, undoHistory, type Snapshot, type UndoHistory } from './history'
import type { SettingsParams } from './types'

const { view: _view, ...defaultSettings } = initialState.params

/** Every settings group at its default. */
export const DEFAULT_SETTINGS: SettingsParams = defaultSettings

/** The state a reset puts in place: the defaults, with the text as it is. */
export function resetSnapshot(text: string): Snapshot {
  return { params: DEFAULT_SETTINGS, text, mappings: [], sound: DEFAULT_SOUND_SETTINGS }
}

/** What Reset also restores outside the undo history: the preview look and the export precision. */
export interface ResetExtras {
  previewLook: PreviewLook
  precision: number
}

export const DEFAULT_RESET_EXTRAS: ResetExtras = { previewLook: DEFAULT_PREVIEW_LOOK, precision: initialState.document.export.precision }

/** Whether the preview look and the export precision are at their defaults. */
export function isDefaultExtras({ previewLook, precision }: ResetExtras): boolean {
  const look = DEFAULT_RESET_EXTRAS.previewLook
  return previewLook.blur === look.blur && previewLook.inverted === look.inverted && precision === DEFAULT_RESET_EXTRAS.precision
}

/** Whether a reset would change nothing (the text never counts). */
export function isDefaultSnapshot({ params, mappings, sound }: Omit<Snapshot, 'text'>): boolean {
  return (
    mappings.length === 0 &&
    changedSettings(params, DEFAULT_SETTINGS) === null &&
    (!sound || (Object.keys(DEFAULT_SOUND_SETTINGS) as (keyof typeof DEFAULT_SOUND_SETTINGS)[]).every((key) => sound[key] === DEFAULT_SOUND_SETTINGS[key]))
  )
}

/** Resets every setting as one undo step; false when they already were at their defaults. */
export function resetSettings(history: UndoHistory = undoHistory): boolean {
  return history.apply((current) => (isDefaultSnapshot(current) ? null : resetSnapshot(current.text)))
}
