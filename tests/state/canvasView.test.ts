// The canvas's zoom and pan, kept outside the editor state so a drag re-renders the canvas alone.

import { describe, expect, it, vi } from 'vitest'
import type { LoadedFont } from '../../src/font/model'
import { createPanZoomStore, DEFAULT_PAN_ZOOM } from '../../src/state/canvasView'
import { editorReducer, initialState, isOtherFace } from '../../src/state/editorState'

describe('canvas view store', () => {
  it('builds each change on the one before, telling its listeners only of real moves', () => {
    const store = createPanZoomStore()
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.getState()).toBe(DEFAULT_PAN_ZOOM)
    expect(store.moved()).toBe(false)
    store.update({ panX: 10 })
    store.update({ panY: -4 })
    store.update({ zoom: 2 })
    expect(store.getState()).toEqual({ zoom: 2, panX: 10, panY: -4 })
    expect(store.moved()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(3)
    const before = store.getState()
    store.update({ zoom: 2 })
    store.update({})
    expect(store.getState()).toBe(before)
    expect(listener).toHaveBeenCalledTimes(3)
    store.reset()
    expect(store.getState()).toEqual(DEFAULT_PAN_ZOOM)
    expect(store.moved()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('stops telling a listener that unsubscribed', () => {
    const store = createPanZoomStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.update({ panX: 1 })
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('the editor state without zoom and pan', () => {
  it('keeps only the outline and layer buttons as its view', () => {
    expect(Object.keys(initialState.params.view).sort()).toEqual(['outline', 'showFill', 'showMetrics', 'showSkeleton', 'showVertices'])
    expect(initialState.document.export).toEqual({ precision: 2 })
  })

  it('knows another face of the open collection, which keeps the view', () => {
    const bytes = new ArrayBuffer(4)
    const open = { bytes, faces: [{}, {}] } as unknown as LoadedFont
    expect(isOtherFace(open, { bytes, faces: [{}, {}] } as unknown as LoadedFont)).toBe(true)
    expect(isOtherFace(open, { bytes: new ArrayBuffer(4), faces: [{}, {}] } as unknown as LoadedFont)).toBe(false)
    expect(isOtherFace(null, open)).toBe(false)
    expect(isOtherFace({ bytes, faces: null } as unknown as LoadedFont, { bytes, faces: null } as unknown as LoadedFont)).toBe(false)
  })

  it('selects a glyph without touching the view', () => {
    const state = editorReducer(initialState, { type: 'selectGlyph', glyph: { index: 5, name: 'b', unicode: 98 } })
    expect(state.params).toBe(initialState.params)
  })
})
