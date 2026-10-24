// Drag to map's side of the mapping store (mappingStore.connect): a drop makes a row at +50%, in Toggle on a switch,
// on, one undo step; the same feature on the same target again finds the row instead of doubling it; the limit holds.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { targetName } from '../../src/components/mapDrag'
import { targetById, TARGETS } from '../../src/sound/mapping'
import { MAPPING_LIMITS, mappingStore } from '../../src/sound/mappingStore'
import { initialState } from '../../src/state/editorState'
import { undoHistory } from '../../src/state/history'

const { view: _view, ...settings } = initialState.params
let disconnect: () => void = () => {}

beforeEach(() => {
  mappingStore.restore([])
  disconnect = undoHistory.connect({
    read: () => ({ params: settings, text: '', mappings: mappingStore.getState().mappings }),
    restore: (snapshot) => mappingStore.restore(snapshot.mappings),
  })
  // Each test starts with nothing to undo.
  undoHistory.startOver({ params: settings, text: '', mappings: [] })
})

afterEach(() => {
  disconnect()
  mappingStore.restore([])
})

const rows = () => mappingStore.getState().mappings

describe('Drag to map: connect', () => {
  it('adds an enabled row at +50% Depth, Follow left at its default', () => {
    const result = mappingStore.connect('bass', 'distortion.amount')
    expect(result?.created).toBe(true)
    expect(rows()).toEqual([
      { id: result?.id, enabled: true, feature: 'bass', target: 'distortion.amount', depth: 0.5 },
    ])
  })

  it('puts a switch in Toggle', () => {
    const switches = TARGETS.filter((t) => t.kind === 'switch')
    expect(switches.length).toBeGreaterThan(0)
    for (const target of switches.slice(0, MAPPING_LIMITS.maxMappings)) mappingStore.connect('beat', target.id)
    expect(rows().every((m) => m.mode === 'toggle' && m.depth === 0.5 && m.enabled)).toBe(true)
  })

  it('finds the row already mapping the same feature to the same target instead of doubling it', () => {
    const first = mappingStore.connect('level', 'typography.size')
    const again = mappingStore.connect('level', 'typography.size')
    expect(again).toEqual({ id: first?.id, created: false, switchedOn: false })
    expect(rows()).toHaveLength(1)
    // Another feature on the same target, or the same feature elsewhere, is a new row.
    expect(mappingStore.connect('bass', 'typography.size')?.created).toBe(true)
    expect(mappingStore.connect('level', 'typography.tracking')?.created).toBe(true)
    expect(rows()).toHaveLength(3)
  })

  it('stops at the limit, but still finds an existing row there', () => {
    const ids = TARGETS.slice(0, MAPPING_LIMITS.maxMappings).map((t) => mappingStore.connect('level', t.id)?.id)
    expect(rows()).toHaveLength(MAPPING_LIMITS.maxMappings)
    expect(mappingStore.connect('level', TARGETS[MAPPING_LIMITS.maxMappings].id)).toBeNull()
    expect(mappingStore.connect('level', TARGETS[0].id)).toEqual({ id: ids[0], created: false, switchedOn: false })
    expect(rows()).toHaveLength(MAPPING_LIMITS.maxMappings)
  })

  it('is one undo step, and a found row records none', () => {
    mappingStore.connect('pan', 'experimental.ripple.centerX')
    undoHistory.endStep()
    mappingStore.connect('pan', 'experimental.ripple.centerX')
    undoHistory.endStep()
    expect(rows()).toHaveLength(1)
    expect(undoHistory.undo()).toBe(true)
    expect(rows()).toEqual([])
    expect(undoHistory.getState().canUndo).toBe(false)
  })

  it('switches a found row on when it was off, as one undo step', () => {
    const first = mappingStore.connect('bass', 'typography.size')
    mappingStore.update(first!.id, { enabled: false })
    undoHistory.endStep()
    expect(mappingStore.connect('bass', 'typography.size')).toEqual({ id: first?.id, created: false, switchedOn: true })
    undoHistory.endStep()
    expect(rows()).toHaveLength(1)
    expect(rows()[0].enabled).toBe(true)
    expect(undoHistory.undo()).toBe(true)
    expect(rows()[0].enabled).toBe(false)
  })

  it('names a target as the Sound tab does', () => {
    expect(targetName(targetById('distortion.amount')!)).toBe('Distortion · Noise amplitude')
    expect(targetName(targetById('experimental.seed')!)).toBe('Seed')
  })
})
