// Every slider in the panels is one SliderField (src/components/SliderField.tsx): a label, the range input with its
// live marker, and a number box, in the head layout (Geometry, Experimental) or the row layout (Typography). The
// markup is pinned to the hand-written blocks it replaced, which styles.css lays out (.field-head, .live-slider,
// .slider-number; .slider-row, .slider-unit), and the explanation is wired to the slider and its ⓘ button.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/sound/live', () => ({
  useLivePosition: () => null,
  useLiveSeed: () => null,
  useLiveDriving: () => false,
  useLiveStatus: () => ({ driving: false }),
  LIVE_LIMITS: {},
}))

const { default: SliderField } = await import('../../src/components/SliderField')
const { HintsContext } = await import('../../src/components/Hint')
const { scaledBox } = await import('../../src/components/SliderNumber')
const { REACH_CURVE, TOLERANCE_CURVE, TYPOGRAPHY_RANGES } = await import('../../src/state/sliderScales')
const { TARGETS } = await import('../../src/sound/mapping')

type Props = Parameters<typeof SliderField>[0]

/** The markup, with React's generated ids replaced by ID0, ID1… in order of appearance. */
function render(props: Props, open = false): string {
  const ids = new Map<string, string>()
  const html = renderToStaticMarkup(createElement(HintsContext.Provider, { value: open }, createElement(SliderField, props)))
  return html.replace(/«[^»]*»|_R_[A-Za-z0-9_]*_|:r[0-9a-z]+:/g, (m) => {
    if (!ids.has(m)) ids.set(m, `ID${ids.size}`)
    return ids.get(m)!
  })
}

const MARKER = '<span class="map-target-anchor" data-map-target="squaring.amount" hidden=""></span>'

describe('SliderField', () => {
  it('lays out the head layout as the Geometry blocks did: title and number box, then the slider', () => {
    const html = render({
      id: 'squaring-amount',
      target: 'squaring.amount',
      label: 'Amount',
      value: 0.25,
      scale: 100,
      unit: '%',
      valueText: '25 percent',
      onChange: () => {},
    })
    expect(html.replace(/<span[^>]*data-map-target[^>]*><\/span>/, MARKER)).toBe(
      '<div class="field"><div class="field-head"><span class="field-title"><label for="squaring-amount">Amount</label></span>' +
        '<span class="slider-number"><input class="number-field" style="--chars:3" type="number" min="0" max="100" step="1" aria-label="Amount (%)" value="25"/>' +
        '<span class="unit">%</span></span></div>' +
        '<span class="live-slider"><input id="squaring-amount" type="range" min="0" max="1" step="0.01" aria-valuetext="25 percent" value="0.25"/>' +
        MARKER +
        '</span></div>',
    )
  })

  it('lays out the row layout as Typography did: the number box and unit after the slider', () => {
    const html = render({ layout: 'row', id: 'type-size', target: 'typography.size', label: 'Size', value: 120, unit: 'px', onChange: () => {} })
    expect(html).toMatch(
      /^<div class="field slider-field"><span class="field-title"><label for="type-size">Size<\/label><\/span><div class="slider-row"><span class="live-slider"><input id="type-size" type="range" min="\d+" max="\d+" step="1" value="120"\/><span[^>]*data-map-target="typography.size"[^>]*><\/span><\/span><input class="number-field"[^>]*aria-label="Size \(px\)" value="120"\/><span class="unit slider-unit">px<\/span><\/div><\/div>$/,
    )
  })

  it('wires an explanation to the slider and its ⓘ button, closed until Show all explanations opens it', () => {
    const props: Props = { id: 'x', target: 'grid.size', label: 'Grid size', value: 10, hint: 'Why.', onChange: () => {} }
    const closed = render(props)
    expect(closed).toContain('aria-controls="ID0" aria-label="About Grid size"')
    expect(closed).toContain('aria-describedby="ID0"')
    expect(closed).toMatch(/<p id="ID0" class="field-hint hint-text" hidden="">Why.<\/p><\/div>$/)
    expect(render(props, true)).toMatch(/<p id="ID0" class="field-hint hint-text">Why.<\/p><\/div>$/)
    // Without one, no button and no description.
    const bare = render({ ...props, hint: undefined })
    expect(bare).not.toContain('hint-button')
    expect(bare).not.toContain('aria-describedby')
  })

  it('puts more controls under the slider, above the explanation', () => {
    const html = render({ id: 'x', target: 'squaring.amount', label: 'Amount', value: 0, hint: 'Why.', onChange: () => {} })
    const withPresets = render({
      id: 'x',
      target: 'squaring.amount',
      label: 'Amount',
      value: 0,
      hint: 'Why.',
      onChange: () => {},
      children: createElement('div', { className: 'preset-row' }),
    })
    expect(withPresets).toBe(html.replace('</span><p ', '</span><div class="preset-row"></div><p '))
  })

  it('places a curved slider by its curve and types the value itself in its number box', () => {
    const html = render({ id: 'thorn-reach', target: 'experimental.thorn.canvasReach', curve: REACH_CURVE, label: 'Reach', value: 0.125, scale: 100, unit: '% canvas', onChange: () => {} })
    expect(html).toContain('type="range" min="0" max="1" step="0.005" value="0.5"')
    expect(html).toContain('min="0" max="100" step="0.01" aria-label="Reach (% canvas)" value="12.5"')
    const tolerance = render({ id: 't', target: 'flatten.tolerance', curve: TOLERANCE_CURVE, label: 'Tolerance', value: 4, unit: 'u', onChange: () => {} })
    expect(tolerance).toContain('min="0.1" max="500" step="0.01" aria-label="Tolerance (u)" value="4"')
  })
})

describe('Number box scale', () => {
  it('shows a share in percent and commits the share, on its own step', () => {
    let committed = NaN
    const box = scaledBox(0.07, { min: 0, max: 1, step: 0.01 }, 100, (v) => (committed = v))
    expect(box).toMatchObject({ value: 7, min: 0, max: 100, step: 1 })
    box.onCommit(33)
    expect(committed).toBe(0.33)
  })
})

describe('Typography ranges', () => {
  it('are the ranges Sound drives the Typography sliders through', () => {
    for (const [id, range] of Object.entries(TYPOGRAPHY_RANGES)) {
      const target = TARGETS.find((t) => t.id === id)
      expect(target, id).toBeDefined()
      expect({ min: target!.min, max: target!.max, step: target!.step }, id).toEqual(range)
    }
  })
})
