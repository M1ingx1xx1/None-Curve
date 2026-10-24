// Undo and redo: the settings (every parameter group but the canvas view), the text, the Sound mappings
// and the Sound tab's Response group, as one history; Reset all (state/reset.ts) clears it. A small store outside React state, read with a hook. Changes are recorded where they are made
// (App's dispatch and text setters, the mapping store, the Response sliders), never in the reducer, so it
// stays pure; live Sound frames never dispatch, so they never enter the history.

import { useSyncExternalStore } from 'react'
import type { Mapping } from '../sound/mapping'
import type { SoundSettings } from '../sound/types'
import type { SettingsParams } from './types'

/** What one undo step brings back. */
export interface Snapshot {
  params: SettingsParams
  text: string
  mappings: readonly Mapping[]
  /** Sensitivity, Release and the response values; left out, a restore keeps them as they are. */
  sound?: SoundSettings
}

/** Where the history reads the current state and puts a restored one (App). */
export interface HistorySource {
  read(): Snapshot
  restore(snapshot: Snapshot): void
}

export const HISTORY_LIMITS = {
  /** Undo steps kept; the oldest go first. */
  maxEntries: 100,
  /** A pause after which the next change starts a new step, even with the same key (typing, the colour picker). */
  idleMs: 1000,
} as const

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  /** Counts undo, redo and resets, so a panel can drop notices about the state it replaced. */
  restores: number
}

export class UndoHistory {
  private past: Snapshot[] = []
  private future: Snapshot[] = []
  /** The step that changes with the same key join (one per slider drag); null: the next change starts one. */
  private open: { key: string; typing: boolean } | null = null
  private transactions = 0
  private transactionRecorded = false
  private restoring = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private source: HistorySource | null = null
  private state: HistoryState = { canUndo: false, canRedo: false, restores: 0 }
  private listeners = new Set<() => void>()
  private readonly idleMs: number

  constructor(idleMs: number = HISTORY_LIMITS.idleMs) {
    this.idleMs = idleMs
  }

  getState = (): HistoryState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Connects the state to read and restore; returns the disconnect. */
  connect(source: HistorySource): () => void {
    this.source = source
    return () => {
      if (this.source === source) this.source = null
    }
  }

  /**
   * Call just before a change is applied. `key` names what changes, e.g. "flatten.tolerance": a change
   * with the open step's key joins it, any other starts a new step that holds the state from before it.
   * Null always starts a step of its own (Clear, a sample, removing a mapping). A typing step stays open
   * across key presses and ends after a pause; others end at the gesture's end (endGesture).
   */
  record(key: string | null, typing = false): void {
    if (this.restoring || !this.source) return
    if (this.transactions > 0) {
      if (this.transactionRecorded) return
      this.transactionRecorded = true
      this.push(this.source.read())
      this.close()
      return
    }
    if (key !== null && this.open?.key === key) {
      this.touch()
      return
    }
    this.push(this.source.read())
    this.open = key === null ? null : { key, typing }
    this.touch()
  }

  /** Runs `change` as one step, however many changes it makes (a preset Load, Freeze, a target and what it switches on). */
  transaction<T>(change: () => T): T {
    this.transactions++
    try {
      return change()
    } finally {
      if (--this.transactions === 0) this.transactionRecorded = false
    }
  }

  /** A pointer or key was released: a slider drag or a held arrow key ends its step. Typing goes on. */
  endGesture(): void {
    if (this.open && !this.open.typing) this.close()
  }

  /** Focus left the page, or a pause: the next change starts a new step. */
  endStep(): void {
    this.close()
  }

  /**
   * Puts `snapshot` in place and forgets every step (Reset all): afterwards there is nothing to undo or
   * redo, so the reset itself cannot be undone. False, changing nothing, while a restore or a transaction runs.
   */
  startOver(snapshot: Snapshot): boolean {
    const source = this.source
    if (this.restoring || this.transactions > 0 || !source) return false
    this.past = []
    this.future = []
    this.put(source, snapshot)
    return true
  }

  undo(): boolean {
    return this.step(this.past, this.future)
  }

  redo(): boolean {
    return this.step(this.future, this.past)
  }

  private step(from: Snapshot[], to: Snapshot[]): boolean {
    const source = this.source
    const snapshot = from.pop()
    if (!source || !snapshot) return false
    to.push(source.read())
    this.put(source, snapshot)
    return true
  }

  /** Puts `snapshot` in place without recording it, and counts the restore. */
  private put(source: HistorySource, snapshot: Snapshot) {
    this.close()
    this.restoring = true
    try {
      source.restore(snapshot)
    } finally {
      this.restoring = false
    }
    this.emit(this.state.restores + 1)
  }

  private push(snapshot: Snapshot) {
    this.past.push(snapshot)
    if (this.past.length > HISTORY_LIMITS.maxEntries) this.past.shift()
    this.future = []
    this.emit(this.state.restores)
  }

  private close() {
    this.open = null
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** Restarts the pause that ends the open step. */
  private touch() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = this.open ? setTimeout(() => this.close(), this.idleMs) : null
  }

  private emit(restores: number) {
    const canUndo = this.past.length > 0
    const canRedo = this.future.length > 0
    const { state } = this
    if (state.canUndo === canUndo && state.canRedo === canRedo && state.restores === restores) return
    this.state = { canUndo, canRedo, restores }
    for (const listener of this.listeners) listener()
  }
}

export const undoHistory = new UndoHistory()

/** Whether there is something to undo or redo; re-renders when that changes. */
export function useHistoryState(): HistoryState {
  return useSyncExternalStore(undoHistory.subscribe, undoHistory.getState)
}

/** The settings leaves that differ between two settings, joined ("flatten.mode,flatten.tolerance"), or null when none does. */
export function changedSettings(before: SettingsParams, after: SettingsParams): string | null {
  const paths: string[] = []
  const walk = (a: unknown, b: unknown, path: string) => {
    if (a === b) return
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key)
      }
    } else if (!(Number.isNaN(a) && Number.isNaN(b))) paths.push(path)
  }
  walk(before, after, '')
  return paths.length ? paths.sort().join(',') : null
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** The undo shortcuts, for hints. */
export const UNDO_KEYS = IS_MAC ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Y' }

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

/** Undo: ⌘Z on a Mac, Ctrl+Z elsewhere. Redo: the same with Shift, or Ctrl+Y off a Mac. */
function undoShortcut(e: ShortcutEvent, mac = IS_MAC): 'undo' | 'redo' | null {
  const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!command || e.altKey) return null
  // The letter as typed; on a layout without Latin letters, the key in the Z or Y position.
  const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : ''
  if (letter === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (letter === 'y' && !mac && !e.shiftKey) return 'redo'
  return null
}

const TEXT_INPUTS = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password'])

/** A field with its own undo (a text box, the text area, editable content): the shortcut is left to it. */
function editsText(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return TEXT_INPUTS.has(target.type)
  return target instanceof HTMLElement && target.isContentEditable
}

/**
 * The undo and redo shortcuts on the page, and the ends of gestures that close a step. The shortcuts
 * are left alone in text fields (their own undo works there) and while a dialog is open. Returns the
 * removal.
 */
export function listenForUndo(history: UndoHistory = undoHistory): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return
    const action = undoShortcut(e)
    if (!action || editsText(e.target) || document.querySelector('dialog[open]')) return
    e.preventDefault()
    if (action === 'undo') history.undo()
    else history.redo()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) history.endGesture()
  }
  const onPointerUp = () => history.endGesture()
  const onBlur = () => history.endStep()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('blur', onBlur)
  }
}
