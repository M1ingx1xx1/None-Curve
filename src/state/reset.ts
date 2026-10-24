// Reset all (the status bar's button): the editor goes back to how it first opens, and the undo history is
// cleared, so a reset cannot be undone (a closed font could not come back). The font closes and the text is
// the sample again; every setting, the canvas view (outline, layers, zoom and pan), the Sound mappings, the
// Response group, Drive letters, the preview look (Blur and Invert) and the export precision go back to their
// defaults; a playing sound file pauses and the microphone stops. The interface theme, the panel sizes and
// open tabs, and a loaded sound file stay. App does the parts outside the history (resetAll in App.tsx).

import { DEFAULT_SOUND_SETTINGS } from '../sound/types'
import { DEFAULT_PREVIEW_LOOK, type PreviewLook } from '../specimen/previewLook'
import { DEFAULT_TEXT } from '../specimen/samples'
import { initialState } from './editorState'
import { changedSettings, undoHistory, type Snapshot, type UndoHistory } from './history'
import type { DocumentState, SettingsParams, ViewToggles } from './types'

const { view: initialView, ...defaultSettings } = initialState.params

/** Every settings group at its default. */
export const DEFAULT_SETTINGS: SettingsParams = defaultSettings

/** What the history holds as the editor first opens: the defaults and the sample text. */
export const START_SNAPSHOT: Snapshot = { params: DEFAULT_SETTINGS, text: DEFAULT_TEXT, mappings: [], sound: DEFAULT_SOUND_SETTINGS }

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

/** Whether the settings, mappings and Sound values are at their defaults (the text is not looked at). */
export function isDefaultSnapshot({ params, mappings, sound }: Omit<Snapshot, 'text'>): boolean {
  return (
    mappings.length === 0 &&
    changedSettings(params, DEFAULT_SETTINGS) === null &&
    (!sound || (Object.keys(DEFAULT_SOUND_SETTINGS) as (keyof typeof DEFAULT_SOUND_SETTINGS)[]).every((key) => sound[key] === DEFAULT_SOUND_SETTINGS[key]))
  )
}

/** What Reset all looks at beside the history's snapshot. */
export interface StartCheck {
  document: DocumentState
  view: ViewToggles
  /** The canvas is zoomed or panned (state/canvasView.ts). */
  viewMoved: boolean
  extras: ResetExtras
  /** Drive letters, and what it starts as (off when the system asks for reduced motion). */
  drive: boolean
  defaultDrive: boolean
}

/** Whether Reset all would change nothing: no font, the sample text, and everything at its default. */
export function isAtStart(snapshot: Snapshot, { document, view, viewMoved, extras, drive, defaultDrive }: StartCheck): boolean {
  return (
    document.font === null &&
    document.status.kind === 'empty' &&
    snapshot.text === DEFAULT_TEXT &&
    drive === defaultDrive &&
    !viewMoved &&
    (Object.keys(initialView) as (keyof ViewToggles)[]).every((key) => view[key] === initialView[key]) &&
    isDefaultSnapshot(snapshot) &&
    isDefaultExtras(extras)
  )
}

/** Puts the history's part back to the start and clears the history; false, changing nothing, while a restore or transaction runs. */
export function resetHistory(history: UndoHistory = undoHistory): boolean {
  return history.startOver(START_SNAPSHOT)
}
