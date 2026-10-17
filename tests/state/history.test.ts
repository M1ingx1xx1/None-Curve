// Undo and redo (src/state/history.ts), driven the way App drives it: settings changes recorded with the leaves they
// change as the key (one step per slider drag), typing joined until a pause, the Sound mappings and the Response
// group in the same history, a preset Load, Reset sound, Reset all settings and a config import as one step each,
// and live Sound frames never recorded.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeometryParams } from '../../src/geometry/types'
import { mappingStore } from '../../src/sound/mappingStore'
import { PRESETS, presetSettings } from '../../src/sound/presets'
import { LiveScheduler, type LiveCommit } from '../../src/sound/live'
import { DEFAULT_FEATURE_SETTINGS, NEUTRAL_RESPONSE, SILENT_FRAME, type FeatureSettings } from '../../src/sound/types'
import { editorReducer, initialState, type Action } from '../../src/state/editorState'
import { changedSettings, HISTORY_LIMITS, undoHistory, UndoHistory, type Snapshot } from '../../src/state/history'
import { parseConfig, readSession, serializeConfig } from '../../src/state/persist'
import { DEFAULT_SETTINGS, isDefaultSnapshot, resetSettings } from '../../src/state/reset'
import type { AppState, SettingsParams } from '../../src/state/types'

const settingsOf = ({ view: _view, ...settings }: AppState['params']): SettingsParams => settings

/** The sound engine's settings, as the Response group's Sensitivity and Release change them. */
function fakeEngine() {
  return {
    settings: DEFAULT_FEATURE_SETTINGS,
    setSettings(patch: Partial<FeatureSettings>) {
      this.settings = { ...this.settings, ...patch }
    },
  }
}

/** App's side of the history: its state, text and edit functions, connected to `history`. */
function app(history: UndoHistory) {
  let state: AppState = initialState
  let text = 'Text'
  const engine = fakeEngine()
  const edit = (action: Action) => {
    const after = editorReducer(state, action)
    if (action.type === 'updateParams' && action.group !== 'view') {
      const key = changedSettings(settingsOf(state.params), settingsOf(after.params))
      if (key) history.record(key)
    }
    state = after
  }
  // App's applySnapshot: what undo, redo and a config file put back.
  const apply = (snapshot: Snapshot) => {
    state = editorReducer(state, { type: 'restoreParams', params: snapshot.params })
    text = snapshot.text
    mappingStore.restore(snapshot.mappings)
    if (snapshot.sound) {
      engine.setSettings({ sensitivity: snapshot.sound.sensitivity, releaseMs: snapshot.sound.releaseMs })
      mappingStore.restoreResponse(snapshot.sound)
    }
  }
  const disconnect = history.connect({
    read: () => ({
      params: settingsOf(state.params),
      text,
      mappings: mappingStore.getState().mappings,
      sound: { ...engine.settings, ...mappingStore.getState().response },
    }),
    restore: apply,
  })
  return {
    edit,
    apply,
    setSpacing: (spacing: number) => edit({ type: 'updateParams', group: 'anchors', patch: { spacing } }),
    type: (next: string) => {
      history.record('text', true)
      text = next
    },
    get state() {
      return state
    },
    get params() {
      return state.params
    },
    get text() {
      return text
    },
    engine,
    /** As the Response group's Sensitivity and Release sliders do it. */
    setSetting: (key: keyof FeatureSettings, value: number) => {
      history.record(`sound:${key}`)
      engine.setSettings({ [key]: value })
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
    mappingStore.restoreResponse(NEUTRAL_RESPONSE)
    // Start from a history with nothing in it.
    while (undoHistory.undo());
    undoHistory.endStep()
  })
  afterEach(() => {
    a.disconnect()
    mappingStore.restore([])
    mappingStore.restoreResponse(NEUTRAL_RESPONSE)
  })

  it('makes one step of a Strength drag, and of a Release drag, and puts both back', () => {
    for (const strength of [1.1, 1.5, 2.25]) mappingStore.setResponse({ strength })
    undoHistory.endGesture()
    for (const releaseMs of [200, 300]) a.setSetting('releaseMs', releaseMs)
    undoHistory.endGesture()
    mappingStore.setResponse({ contrast: 0.4 })
    expect(mappingStore.getState().response).toEqual({ ...NEUTRAL_RESPONSE, strength: 2.25, contrast: 0.4 })
    undoHistory.undo()
    expect(mappingStore.getState().response).toEqual({ ...NEUTRAL_RESPONSE, strength: 2.25 })
    expect(a.engine.settings.releaseMs).toBe(300)
    undoHistory.undo()
    expect(a.engine.settings.releaseMs).toBe(DEFAULT_FEATURE_SETTINGS.releaseMs)
    expect(mappingStore.getState().response.strength).toBe(2.25)
    undoHistory.undo()
    expect(mappingStore.getState().response).toEqual(NEUTRAL_RESPONSE)
    expect(undoHistory.undo()).toBe(false)
    undoHistory.redo()
    undoHistory.redo()
    expect([mappingStore.getState().response.strength, a.engine.settings.releaseMs]).toEqual([2.25, 300])
  })

  it('records nothing for a response value that does not change, and clamps and snaps the rest', () => {
    mappingStore.setResponse({ strength: 1, melody: Number.NaN })
    expect(undoHistory.getState().canUndo).toBe(false)
    // Melody snaps to its 0.01 step (0.05 before NOCUR-63, when 0.52 snapped to 0.5).
    mappingStore.setResponse({ strength: 9, contrast: 0.333, pitchReactive: -1, melody: 0.523 })
    expect(mappingStore.getState().response).toEqual({ strength: 4, contrast: 0.33, pitchReactive: 0, melody: 0.52 })
  })

  it('undoes Reset sound in one step, and leaves the response alone on a preset Load', () => {
    a.setSetting('sensitivity', 9)
    undoHistory.endGesture()
    mappingStore.setResponse({ strength: 0.5, pitchReactive: 1.5, melody: 2 })
    undoHistory.endGesture()
    const before = { settings: a.engine.settings, response: mappingStore.getState().response }
    // A preset replaces the mappings only.
    mappingStore.replace(PRESETS[0].mappings)
    expect(mappingStore.getState().response).toBe(before.response)
    undoHistory.endStep()
    // As the Sound tab's Reset sound does it.
    undoHistory.transaction(() => {
      undoHistory.record(null)
      a.engine.setSettings(DEFAULT_FEATURE_SETTINGS)
      mappingStore.setResponse(NEUTRAL_RESPONSE)
    })
    expect([a.engine.settings, mappingStore.getState().response]).toEqual([DEFAULT_FEATURE_SETTINGS, NEUTRAL_RESPONSE])
    undoHistory.undo()
    expect([a.engine.settings, mappingStore.getState().response]).toEqual([before.settings, before.response])
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

  it('undoes a config import in one step: the settings, the text, the mappings and the Response group', () => {
    a.setSpacing(17)
    a.type('Before')
    mappingStore.add('treble', 'anchors.spacing', -0.3)
    a.setSetting('sensitivity', 4)
    undoHistory.endStep()
    const before = { params: settingsOf(a.params), text: a.text, mappings: mappingStore.getState().mappings, settings: a.engine.settings }
    const saved = readSession({})!
    const file = serializeConfig({
      ...saved,
      params: { ...saved.params, anchors: { ...saved.params.anchors, spacing: 30 } },
      text: 'From the file',
      mappings: [{ id: 'm1', enabled: true, feature: 'bass', target: 'distortion.amount', depth: 0.5 }],
      sound: { ...saved.sound!, sensitivity: -6, strength: 2 },
    })
    const parsed = parseConfig(file)
    if (!parsed.ok) throw new Error(parsed.error)
    // As App's importConfig does it.
    undoHistory.transaction(() => {
      undoHistory.record(null)
      a.apply(parsed.session)
    })
    expect([a.params.anchors.spacing, a.text, a.engine.settings.sensitivity, mappingStore.getState().response.strength]).toEqual([30, 'From the file', -6, 2])
    expect(mappingStore.getState().mappings.map((m) => m.feature)).toEqual(['bass'])
    expect(undoHistory.undo()).toBe(true)
    expect(settingsOf(a.params)).toEqual(before.params)
    expect(a.text).toBe(before.text)
    expect(mappingStore.getState().mappings).toEqual(before.mappings)
    expect(a.engine.settings).toEqual(before.settings)
    expect(mappingStore.getState().response).toEqual(NEUTRAL_RESPONSE)
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

describe('Reset all settings', () => {
  let a: ReturnType<typeof app>

  beforeEach(() => {
    a = app(undoHistory)
    mappingStore.restore([])
    mappingStore.restoreResponse(NEUTRAL_RESPONSE)
    while (undoHistory.undo());
    undoHistory.endStep()
  })
  afterEach(() => {
    a.disconnect()
    mappingStore.restore([])
    mappingStore.restoreResponse(NEUTRAL_RESPONSE)
  })

  /** Every kind of setting changed, each as its own step, with the text typed and the view and glyph changed (not undone). */
  function changeEverything() {
    a.setSpacing(17)
    a.edit({ type: 'updateParams', group: 'experimental', patch: { seed: 7, crumple: { ...a.params.experimental.crumple, enabled: true } } })
    a.edit({ type: 'updateParams', group: 'typography', patch: { size: 96, tracking: 40 } })
    a.edit({ type: 'updateParams', group: 'palette', patch: { ink: '#123456', transparent: true } })
    a.edit({ type: 'updateParams', group: 'artboard', patch: { width: 640 } })
    undoHistory.endStep()
    mappingStore.add('bass', 'distortion.amount', 0.5)
    undoHistory.endStep()
    a.setSetting('sensitivity', 9)
    undoHistory.endGesture()
    mappingStore.setResponse({ strength: 2, melody: 1 })
    undoHistory.endGesture()
    a.type('Typed text')
    undoHistory.endStep()
    a.edit({ type: 'selectGlyph', glyph: { index: 5, name: 'b', unicode: 98 } })
    a.edit({ type: 'updateParams', group: 'view', patch: { outline: 'compare', showVertices: true, zoom: 3 } })
  }

  const soundNow = () => ({ settings: a.engine.settings, response: mappingStore.getState().response })

  it('puts every setting back to its default and keeps the text, the glyph and the view', () => {
    changeEverything()
    const { document, params } = a.state
    const restores = undoHistory.getState().restores
    expect(resetSettings()).toBe(true)
    expect(settingsOf(a.params)).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toEqual(settingsOf(initialState.params))
    expect(mappingStore.getState().mappings).toEqual([])
    expect(soundNow()).toEqual({ settings: DEFAULT_FEATURE_SETTINGS, response: NEUTRAL_RESPONSE })
    expect(a.text).toBe('Typed text')
    expect(a.state.document).toBe(document)
    expect(a.params.view).toBe(params.view)
    // A panel drops its notices about the state the reset replaced, as after an undo.
    expect(undoHistory.getState().restores).toBe(restores + 1)
  })

  it('is one undo step: undo brings everything back, redo resets again', () => {
    changeEverything()
    const before = { params: settingsOf(a.params), mappings: mappingStore.getState().mappings, sound: soundNow() }
    resetSettings()
    expect(undoHistory.undo()).toBe(true)
    expect(settingsOf(a.params)).toEqual(before.params)
    expect(mappingStore.getState().mappings).toEqual(before.mappings)
    expect(soundNow()).toEqual(before.sound)
    expect(a.text).toBe('Typed text')
    // The step before the reset is the text, still as typed.
    expect(undoHistory.redo()).toBe(true)
    expect(settingsOf(a.params)).toEqual(DEFAULT_SETTINGS)
    expect(mappingStore.getState().mappings).toEqual([])
    expect(soundNow()).toEqual({ settings: DEFAULT_FEATURE_SETTINGS, response: NEUTRAL_RESPONSE })
    expect(undoHistory.getState().canRedo).toBe(false)
  })

  it('does nothing, and records nothing, when every setting is already at its default', () => {
    a.type('Only the text')
    undoHistory.endStep()
    expect(resetSettings()).toBe(false)
    expect(undoHistory.undo()).toBe(true)
    expect(a.text).toBe('Text')
    expect(undoHistory.getState().canUndo).toBe(false)
  })

  it('ends the open slider step, so the next drag is a step of its own', () => {
    a.setSpacing(5)
    resetSettings()
    a.setSpacing(6)
    undoHistory.undo()
    expect(a.params.anchors.spacing).toBe(DEFAULT_SETTINGS.anchors.spacing)
    undoHistory.undo()
    expect(a.params.anchors.spacing).toBe(5)
  })

  it('knows when there is nothing to reset: the text never counts, any setting, mapping or Sound value does', () => {
    const defaults = { params: DEFAULT_SETTINGS, mappings: [], sound: { ...DEFAULT_FEATURE_SETTINGS, ...NEUTRAL_RESPONSE } }
    expect(isDefaultSnapshot(defaults)).toBe(true)
    expect(isDefaultSnapshot({ ...defaults, params: { ...DEFAULT_SETTINGS, grid: { ...DEFAULT_SETTINGS.grid, snap: true } } })).toBe(false)
    expect(isDefaultSnapshot({ ...defaults, mappings: [{ id: 'm1', enabled: true, feature: 'level', target: 'distortion.amount', depth: 0.5 }] })).toBe(false)
    expect(isDefaultSnapshot({ ...defaults, sound: { ...defaults.sound, releaseMs: defaults.sound.releaseMs + 50 } })).toBe(false)
    expect(isDefaultSnapshot({ ...defaults, sound: { ...defaults.sound, contrast: 0.5 } })).toBe(false)
  })
})
