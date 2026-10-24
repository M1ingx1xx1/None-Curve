// The WebGL renderer's pure parts (src/render/webgl2.ts) that need no context: the colour cache, which Sound would
// otherwise fill with a new ink every frame.

import { describe, expect, it } from 'vitest'
import { rgbaOf } from '../../src/render/webgl2'
import type { Rgba } from '../../src/render/theme'

describe('rgbaOf', () => {
  it('parses a colour once and keeps the cache bounded', () => {
    const cache = new Map<string, Rgba>()
    const red = rgbaOf('#ff0000', cache)
    expect(red).toEqual([1, 0, 0, 1])
    expect(rgbaOf('#ff0000', cache)).toBe(red)
    for (let i = 0; i < 1000; i++) rgbaOf(`rgb(${i % 256}, ${Math.floor(i / 256)}, 7)`, cache)
    expect(cache.size).toBeLessThanOrEqual(256)
    expect(rgbaOf('rgb(3, 3, 7)', cache)).toEqual(rgbaOf('rgb(3, 3, 7)', new Map()))
  })
})
