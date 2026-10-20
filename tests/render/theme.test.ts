// The canvas renderers' interface colours (src/render/theme.ts): colour parsing for WebGL, token resolution with
// fallbacks, the hidden probe span, and the cache that re-resolves only when the theme changes.

import { describe, expect, it } from 'vitest'
import { parseColor, probeReader, resolveTokens, ThemeColors, type ThemeEnvironment } from '../../src/render/theme'

describe('parseColor', () => {
  it('reads hex, rgb() in both syntaxes, color(srgb) and transparent', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1])
    expect(parseColor('#00000080')![3]).toBeCloseTo(128 / 255, 9)
    expect(parseColor('#1f4fd1')).toEqual([31 / 255, 79 / 255, 209 / 255, 1])
    expect(parseColor('rgb(255, 0, 51)')).toEqual([1, 0, 0.2, 1])
    expect(parseColor('rgba(255, 0, 51, 0.5)')).toEqual([1, 0, 0.2, 0.5])
    expect(parseColor('rgb(255 0 51 / 50%)')).toEqual([1, 0, 0.2, 0.5])
    expect(parseColor('color(srgb 1 0.5 0 / 0.25)')).toEqual([1, 0.5, 0, 0.25])
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0])
    expect(parseColor('light-dark(#fff, #000)')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor('rgb(a, b, c)')).toBeNull()
  })
})

describe('resolveTokens', () => {
  it('reads each token as var(), keeping the fallback for an unresolved or throwing one', () => {
    const asked: string[] = []
    const colors = resolveTokens((expr) => {
      asked.push(expr)
      if (expr === 'var(--danger)') throw new Error('no')
      if (expr === 'var(--vertex)') return 'light-dark(red, blue)'
      return 'rgb(1, 2, 3)'
    })
    expect(asked).toEqual(['var(--accent)', 'var(--control)', 'var(--vertex)', 'var(--danger)', 'var(--canvas)'])
    expect(colors.accent).toBe('rgb(1, 2, 3)')
    expect(colors.canvas).toBe('rgb(1, 2, 3)')
    expect(parseColor(colors.vertex)).not.toBeNull()
    expect(colors.vertex).not.toContain('light-dark')
    expect(parseColor(colors.danger)).not.toBeNull()
  })
})

describe('probeReader', () => {
  it('resolves through a hidden span inside the container, removed again', () => {
    const children: unknown[] = []
    const container = {
      ownerDocument: {
        createElement: () => {
          const span = { style: { display: '', color: '' }, remove: () => children.splice(children.indexOf(span), 1) }
          return span
        },
      },
      appendChild: (el: unknown) => children.push(el),
    }
    const read = probeReader(container as never, (el) => {
      const span = el as unknown as { style: { display: string; color: string } }
      expect(children).toContain(span)
      expect(span.style.display).toBe('none')
      return { color: span.style.color === 'var(--accent)' ? 'rgb(9, 9, 9)' : '' }
    })
    expect(read('var(--accent)')).toBe('rgb(9, 9, 9)')
    expect(children).toHaveLength(0)
  })
})

describe('ThemeColors', () => {
  function fakeEnvironment() {
    const root = new Set<() => void>()
    const scheme = new Set<() => void>()
    const env: ThemeEnvironment = {
      observeRoot: (l) => (root.add(l), () => void root.delete(l)),
      observeScheme: (l) => (scheme.add(l), () => void scheme.delete(l)),
    }
    return { env, root, scheme }
  }

  it('caches until data-theme or the system scheme changes, then tells subscribers', () => {
    let theme = 'light'
    let reads = 0
    const { env, root, scheme } = fakeEnvironment()
    const colors = new ThemeColors(() => {
      reads++
      return theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)'
    }, env)
    let told = 0
    colors.subscribe(() => told++)
    expect(colors.get().canvas).toBe('rgb(255, 255, 255)')
    const first = reads
    colors.get()
    expect(reads).toBe(first)
    theme = 'dark'
    for (const l of root) l()
    expect(told).toBe(1)
    expect(colors.get().canvas).toBe('rgb(0, 0, 0)')
    expect(reads).toBe(2 * first)
    theme = 'light'
    for (const l of scheme) l()
    expect(told).toBe(2)
    expect(colors.get().canvas).toBe('rgb(255, 255, 255)')
    colors.dispose()
    expect(root.size + scheme.size).toBe(0)
  })
})
