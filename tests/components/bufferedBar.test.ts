// The buffered bar under the Position slider (src/components/BufferedBar.tsx): its layers as shares of the file, what
// screen readers hear, and the markup (straight rects only, nothing without a precomputed file).

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BufferedBar, { bufferDescription, bufferShares } from '../../src/components/BufferedBar'
import { EMPTY_BUFFER, createBufferStore, type BufferSnapshot } from '../../src/sound/bufferStore'

const format = (seconds: number) => {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const snapshot = (plannedMs: number, ready: number[]): BufferSnapshot => ({
  durationMs: 100_000,
  plannedMs,
  ready: Float32Array.from(ready),
  version: 1,
})

describe('buffered bar shares', () => {
  it('is null without a precomputed file', () => {
    expect(bufferShares(EMPTY_BUFFER)).toBeNull()
  })

  it('gives the plan and the ready spans as shares, clamped and without empty spans', () => {
    const shares = bufferShares(snapshot(40_000, [0, 10_000, 20_000, 20_000, 90_000, 120_000]))
    expect(shares).toEqual({ planned: 0.4, ready: [[0, 0.1], [0.9, 1]] })
  })
})

describe('buffered bar description', () => {
  it('is empty without a precomputed file', () => {
    expect(bufferDescription(EMPTY_BUFFER, 0, format)).toBe('')
  })

  it('names how far the moves are worked out and the ready span around the position', () => {
    const s = snapshot(70_000, [5_000, 35_000])
    expect(bufferDescription(s, 12_000, format)).toBe('Prepared for smooth playback: moves worked out to 1:10; shapes ready from 0:05 to 0:35.')
    expect(bufferDescription(s, 50_000, format)).toBe('Prepared for smooth playback: moves worked out to 1:10; shapes not ready here yet.')
  })

  it('says the whole file once the plan reaches the end', () => {
    expect(bufferDescription(snapshot(100_000, []), 0, format)).toContain('moves worked out for the whole file')
  })
})

describe('buffered bar markup', () => {
  const render = (store: ReturnType<typeof createBufferStore>) =>
    renderToStaticMarkup(createElement(BufferedBar, { id: 'buffer', position: 12, format, store }))

  it('draws no bar without a precomputed file, but keeps the description element', () => {
    const html = render(createBufferStore())
    expect(html).not.toContain('<svg')
    expect(html).toContain('id="buffer"')
  })

  it('draws the plan and each ready span as straight rects, hidden from screen readers', () => {
    const store = createBufferStore()
    store.offer({ durationMs: 100_000, plannedMs: 50_000, ready: Float32Array.from([0, 20_000, 50_000, 75_000]) }, 0, true)
    const html = render(store)
    expect(html).toContain('aria-hidden="true"')
    expect(html.match(/<rect /g)).toHaveLength(3)
    expect(html).toContain('class="sound-buffer-planned" x="0" y="0" width="500"')
    expect(html).toContain('class="sound-buffer-ready" x="500" y="0" width="250"')
    expect(html).not.toMatch(/<(path|circle|ellipse)|rx=/)
    expect(html).toContain('shapes ready from 0:00 to 0:20')
  })
})
