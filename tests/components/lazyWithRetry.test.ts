// lazyWithRetry (src/components/lazyWithRetry.ts): a failed import is tried again on the next render.

import { createElement, Suspense, type ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { lazyWithRetry } from '../../src/components/lazyWithRetry'

const Hello: ComponentType = () => createElement('p', null, 'hello')

/** Renders until React stops suspending; returns the markup, or the thrown error. */
async function settle(Lazy: ComponentType): Promise<string | Error> {
  for (let k = 0; k < 5; k++) {
    try {
      const html = renderToString(createElement(Suspense, { fallback: 'wait' }, createElement(Lazy)))
      if (!html.includes('wait')) return html
    } catch (error) {
      return error as Error
    }
    await new Promise((r) => setTimeout(r, 0))
  }
  return new Error('still suspended')
}

describe('lazyWithRetry', () => {
  it('imports again after a failure instead of keeping the rejection', async () => {
    const load = vi
      .fn<() => Promise<{ default: ComponentType }>>()
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValue({ default: Hello })
    const Lazy = lazyWithRetry(load)
    // The first render starts the failing import; a later render imports again and succeeds.
    expect(await settle(Lazy)).toContain('hello')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
