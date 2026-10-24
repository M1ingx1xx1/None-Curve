// Drag to map's drop palette (src/components/mapDrag.ts, MapDragLayer): every target once, in the target select's
// order, in blocks by section, and the blocks down columns of about the same height without reordering them.

import { describe, expect, it } from 'vitest'
import { intoColumns, paletteBlocks, TARGET_GROUPS, type PaletteBlock } from '../../src/components/mapDrag'
import { TARGETS } from '../../src/sound/mapping'

const ids = (blocks: readonly PaletteBlock[]) => blocks.flatMap((block) => block.targets.map((t) => t.id))

describe('drop palette', () => {
  it('lists every target once, in the order of the target select', () => {
    const blocks = paletteBlocks()
    const listed = ids(blocks)
    expect(listed).toEqual(TARGET_GROUPS.flatMap((group) => group.targets.map((t) => t.id)))
    expect(new Set(listed).size).toBe(TARGETS.length)
  })

  it('heads each group once, over its first block, and names entries by their label under their section', () => {
    const blocks = paletteBlocks()
    expect(blocks.filter((block) => block.group).map((block) => block.group)).toEqual(['Geometry', 'Experimental', 'Typography', 'Color'])
    const ripple = blocks.find((block) => block.title === 'Ripple')!
    expect(ripple.targets.find((t) => t.id === 'experimental.ripple.amount')?.name).toBe('Amount')
    // The switches are one block, each named in full.
    const switches = blocks.find((block) => block.title === 'Switches')!
    expect(switches.targets.find((t) => t.id === 'experimental.ripple.enabled')?.name).toBe('Ripple · Use ripple')
  })

  it('shares the blocks down at most the given columns, in order, of about the same height', () => {
    const blocks = paletteBlocks()
    for (const count of [1, 2, 3, 4, 6, 40]) {
      const columns = intoColumns(blocks, count)
      expect(columns.length).toBeLessThanOrEqual(count)
      expect(columns.every((column) => column.length > 0)).toBe(true)
      expect(ids(columns.flat())).toEqual(ids(blocks))
    }
    const heights = intoColumns(blocks, 4).map((column) => column.reduce((sum, block) => sum + block.targets.length + 2, 0))
    expect(Math.max(...heights) / Math.min(...heights)).toBeLessThan(2)
  })
})
