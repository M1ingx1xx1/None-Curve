// Undo and redo (src/state/history.ts), driven the way App drives it: settings changes recorded with the leaves they
// change as the key (one step per slider drag), typing joined until a pause, the Sound mappings in the same history,
// a preset Load as one step, and live Sound frames never recorded.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeometryParams } from '../../src/geometry/types'
import { mappingStore } from '../../src/sound/mappingStore'
import { PRESETS, presetSettings } from '../../src/sound/presets'
import { LiveScheduler, type LiveCommit } from '../../src/sound/live'
import { SILENT_FRAME } from '../../src/sound/types'
import { editorReducer, initialState, type Action } from '../../src/state/editorState'
import { changedSettings, HISTORY_LIMITS, undoHistory, UndoHistory } from '../../src/state/history'
import type { AppState, SettingsParams } from '../../src/state/types'

const settingsOf = ({ view: _view, ...settings }: AppState['params']): SettingsParams => settings

/** App's side of the history: its state, text and edit functions, connected to `history`. */
function app(history: UndoHistory) {
  let state: AppState = initialState
  let text = 'Text'
  const edit = (action: Action) => {
    const after = editorReducer(state, action)
    if (action.type === 'updateParams' && action.group !== 'view') {
      const key = changedSettings(settingsOf(state.params), settingsOf(after.params))
      if (key) history.record(key)
    }
    state = after
  }
  const disconnect = history.connect({
    read: () => ({ params: settingsOf(state.params), text, mappings: mappingStore.getState().mappings }),
    restore: (snapshot) => {
      state = editorReducer(state, { type: 'restoreParams', params: snapshot.params })
      text = snapshot.text
      mappingStore.restore(snapshot.mappings)
    },
  })
  return {
    edit,
    setSpacing: (spacing: number) => edit({ type: 'updateParams', group: 'anchors', patch: { spacing } }),
    type: (next: string) => {
      history.record('text', true)
      text = next
    },
    get params() {
      return state.params
    },
    get text() {
      return text
    },
    disconnect,
  }
}

describe('undo history', () => {
  let history: UndoHistory
  let a: ReturnType<typeof app>

  beforeEach(() => {
    vi.useFakeTimers()
    history = new UndoHistory()
    a = app(history)
  })
  afterEach(() => {
    a.disconnect()
    vi.useRealTimers()
  })

  it('makes one step of a slider drag, ended by the gesture', () => {
    const start = a.params.anchors.spacing
    for (const spacing of [start + 1, start + 2, start + 3]) a.setSpacing(spacing)
    history.endGesture()
    a.setSpacing(start + 10)
    expect(history.undo()).toBe(true)
    expect(a.params.anchors.spacing).toBe(start + 3)
    expect(history.undo()).toBe(true)
    expect(a.params.anchors.spacing).toBe(start)
    expect(history.undo()).toBe(false)
    expect(history.redo()).toBe(true)
    expect(history.redo()).toBe(true)
    expect(a.params.anchors.spacing).toBe(start + 10)
    expect(history.getState()).toMatchObject({ canUndo: true, canRedo: false, restores: 4 })
  })

  it('starts a new step when another setting changes', () => {
    const start = a.params
    a.setSpacing(start.anchors.spacing + 1)
    a.edit({ type: 'updateParams', group: 'distortion', patch: { amount: start.distortion.amount + 5 } })
    history.undo()
    expect(a.params.distortion.amount).toBe(start.distortion.amount)
    expect(a.params.anchors.spacing).toBe(start.anchors.spacing + 1)
  })

  it('joins typing until a pause', () => {
    a.type('T')
    a.type('Te')
    vi.advanceTimersByTime(HISTORY_LIMITS.idleMs / 2)
    a.type('Tex')
    // The pause restarts with every key; a gesture's end does not close a typing step.
    history.endGesture()
    vi.advanceTimersByTime(HISTORY_LIMITS.idleMs + 1)
    a.type('Text!')
    history.undo()
    expect(a.text).toBe('Tex')
    history.undo()
    expect(a.text).toBe('Text')
  })

  it('records nothing while it restores, and a new change drops the redo steps', () => {
    a.setSpacing(a.params.anchors.spacing + 1)
    history.endStep()
    history.undo()
    expect(history.getState().canRedo).toBe(true)
    a.setSpacing(a.params.anchors.spacing + 2)
    expect(history.getState().canRedo).toBe(false)
  })

  it('keeps at most 100 steps', () => {
    for (let k = 0; k < 130; k++) {
      a.setSpacing(1 + (k % 50))
      history.endStep()
    }
    let steps = 0
    while (history.undo()) steps++
    expect(steps).toBe(HISTORY_LIMITS.maxEntries)
  })
})

describe('undo history with the Sound mappings (the app-wide history)', () => {
  let a: ReturnType<typeof app>

  beforeEach(() => {
    a = app(undoHistory)
    mappingStore.restore([])
    // Start from a history with nothing in it.
    while (undoHistory.undo());
    undoHistory.endStep()
  })
  afterEach(() => {
    a.disconnect()
    mappingStore.restore([])
  })

  it('undoes adding, changing and removing a mapping', () => {
    const id = mappingStore.add('bass', 'distortion.amount', 0.5)!
    undoHistory.endStep()
    mappingStore.update(id, { depth: 0.6 })
    mappingStore.update(id, { depth: 0.7 })
    undoHistory.endGesture()
    mappingStore.remove(id)
    expect(mappingStore.getState().mappings).toEqual([])
    undoHistory.undo()
    expect(mappingStore.getState().mappings.map((m) => m.depth)).toEqual([0.7])
    undoHistory.undo()
    expect(mappingStore.getState().mappings.map((m) => m.depth)).toEqual([0.5])
    undoHistory.undo()
    expect(mappingStore.getState().mappings).toEqual([])
  })

  it('undoes a preset Load in one step: the settings and the mappings from before', () => {
    a.setSpacing(17)
    a.edit({ type: 'updateParams', group: 'experimental', patch: { crumple: { ...a.params.experimental.crumple, enabled: true } } })
    mappingStore.add('treble', 'anchors.spacing', -0.3)
    undoHistory.endStep()
    const before = { params: settingsOf(a.params), mappings: mappingStore.getState().mappings }
    const preset = PRESETS.find((p) => p.mappings.length > 1)!
    // As the Sound tab's Load does it.
    undoHistory.transaction(() => {
      const loaded = presetSettings(a.params, preset)
      undoHistory.transaction(() => {
        for (const { group, patch } of loaded.patches) a.edit({ type: 'updateParams', group, patch } as Action)
      })
      mappingStore.replace(preset.mappings)
    })
    expect(mappingStore.getState().mappings).toHaveLength(preset.mappings.length)
    expect(undoHistory.undo()).toBe(true)
    expect(settingsOf(a.params)).toEqual(before.params)
    expect(mappingStore.getState().mappings).toEqual(before.mappings)
    expect(undoHistory.redo()).toBe(true)
    expect(mappingStore.getState().mappings.map((m) => m.target)).toEqual(preset.mappings.map((m) => m.target))
  })

  it('never records live Sound frames', () => {
    mappingStore.add('level', 'distortion.amount', 1)
    undoHistory.endStep()
    /** The undo steps there are (undone, then redone again). */
    const steps = () => {
      let n = 0
      while (undoHistory.undo()) n++
      while (undoHistory.redo());
      return n
    }
    const recorded = steps()
    const base: GeometryParams = settingsOf(a.params)
    const commits: (LiveCommit | null)[] = []
    let now = 0
    const live = new LiveScheduler({
      now: () => now,
      sourceRunning: () => true,
      isComputing: () => false,
      request: () => false,
      commit: (c) => {
        commits.push(c)
        if (c) live.rendered(c.seq)
      },
      pauseSound: () => {},
      setTimer: () => 0,
      clearTimer: () => {},
    })
    live.setBase(base)
    live.setMappings(mappingStore.getState().mappings, true)
    for (let k = 1; k <= 60; k++) {
      now = k * 50
      live.setFrame({ ...SILENT_FRAME, time: now, silent: false, levelDb: -20, level: (k % 10) / 10 })
    }
    live.dispose()
    expect(commits.filter((c) => c?.params).length).toBeGreaterThan(10)
    expect(steps()).toBe(recorded)
  })
})
