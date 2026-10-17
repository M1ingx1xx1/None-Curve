// The number boxes beside the sliders (src/components/NumberField.tsx) are sized by their widest value.

import { describe, expect, it } from 'vitest'
import { decimals, widestChars } from '../../src/components/NumberField'

describe('number box width', () => {
  it('counts the characters of the widest value, with the step’s decimals and a minus sign', () => {
    expect(widestChars(0, 100, 1)).toBe(3)
    expect(widestChars(0, 359, 1)).toBe(3)
    expect(widestChars(-100, 100, 1)).toBe(4)
    expect(widestChars(-30, 30, 1)).toBe(3)
    expect(widestChars(0.5, 3, 0.01)).toBe(4)
    expect(widestChars(0, 12, 0.1)).toBe(4)
    expect(widestChars(0.01, 500, 0.01)).toBe(6)
    expect(widestChars(16, 4000, 1)).toBe(4)
  })

  it('reads the decimals of a step as written', () => {
    expect(decimals(1)).toBe(0)
    expect(decimals(0.1)).toBe(1)
    expect(decimals(0.05)).toBe(2)
  })
})
