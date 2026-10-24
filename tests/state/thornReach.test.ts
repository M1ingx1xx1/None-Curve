// Thorn's Reach as a share of the canvas diagonal: the cubic slider (src/state/sliderScales.ts) and the canvas
// diagonal in em that App puts on the geometry parameters only while Thorn is on (src/state/editorState.ts), so
// with Thorn off the text size and canvas never change the geometry, and the derived value never lands in the state.

import { describe, expect, it } from 'vitest'
import { canvasDiagonalEm, THORN_LIMITS } from '../../src/geometry/limits'
import { paramsKey } from '../../src/geometry/paramsKey'
import type { GeometryParams } from '../../src/geometry/types'
import { describePipeline } from '../../src/geometry/describe'
import { initialState, thornCanvasEm, withThornCanvasEm } from '../../src/state/editorState'
import { reachFromSlider, reachPercent, reachReadout, reachToSlider, THORN_REACH } from '../../src/state/sliderScales'

const { flatten, random, squaring, anchors, grid, distortion, experimental, typography, artboard } = initialState.params
const base: GeometryParams = { flatten, random, squaring, anchors, grid, distortion, experimental }
const thornOn = { ...experimental, thorn: { ...experimental.thorn, enabled: true } }

describe('Reach slider', () => {
  const { min, max, step } = THORN_REACH.slider
  const positions = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, k) => min + k * step)

  it('is cubic from no reach to the whole canvas diagonal, rounded to 4 decimals, a hundredth of a percent per step near 0', () => {
    expect(reachFromSlider(0)).toBe(0)
    expect(reachFromSlider(1)).toBe(THORN_REACH.max)
    expect(reachFromSlider(0.5)).toBe(0.125)
    expect(reachFromSlider(0.2)).toBe(0.008)
    positions.forEach((p, k) => {
      const reach = reachFromSlider(p)
      expect(Math.abs(reach * 10_000 - Math.round(reach * 10_000)), `${p}`).toBeLessThan(1e-9)
      // The cube, until it grows by more than a hundredth of a percent per step (from 0.145 on).
      if (k <= 28) expect(reach, `${p}`).toBe(k / 10_000)
      else expect(reach, `${p}`).toBeCloseTo(p ** 3, 4)
    })
  })

  it('gives every step a reach of its own, so each arrow key press moves it', () => {
    const reaches = positions.map(reachFromSlider)
    for (let k = 1; k < reaches.length; k++) expect(reaches[k] - reaches[k - 1], `${positions[k]}`).toBeGreaterThanOrEqual(0.0001 - 1e-12)
    // A browser range input: the thumb snaps to the step nearest the value, an arrow key moves it one step, and the
    // panel writes back the reach there (a reach the state already holds would put the thumb straight back).
    const press = (reach: number, dir: 1 | -1) => {
      const k = Math.round(reachToSlider(reach) / step) + dir
      return reachFromSlider(Math.min(max, Math.max(min, min + k * step)))
    }
    reaches.forEach((reach, k) => {
      if (k < reaches.length - 1) expect(press(reach, 1), `right from ${reach}`).toBe(reaches[k + 1])
      if (k > 0) expect(press(reach, -1), `left from ${reach}`).toBe(reaches[k - 1])
    })
    // Off the slider's own values too (an older session's Reach): one press always lands on a different reach.
    for (const reach of [0.00004, 0.00015, 0.0029, 0.0123, 0.4321]) {
      expect(press(reach, 1)).toBeGreaterThan(reach)
      expect(press(reach, -1)).toBeLessThan(reach)
    }
  })

  it('round-trips every value the slider produces, and puts the thumb where it was', () => {
    for (const p of positions) {
      const reach = reachFromSlider(p)
      expect(reachFromSlider(reachToSlider(reach)), `${p}`).toBe(reach)
      expect(Math.round(reachToSlider(reach) / step), `${p}`).toBe(Math.round(p / step))
    }
    expect(reachToSlider(0)).toBe(0)
    expect(reachToSlider(THORN_REACH.max)).toBe(1)
  })

  it('reads in percent of the canvas: hundredths below 1%, one decimal below 10%, whole above', () => {
    expect(reachPercent(0)).toBe('0.0')
    expect(reachPercent(0.0001)).toBe('0.01')
    expect(reachPercent(0.0028)).toBe('0.28')
    expect(reachPercent(0.0099)).toBe('0.99')
    expect(reachPercent(0.01)).toBe('1.0')
    expect(reachPercent(0.02)).toBe('2.0')
    expect(reachPercent(0.0123)).toBe('1.2')
    expect(reachPercent(0.0999)).toBe('10')
    expect(reachPercent(0.125)).toBe('13')
    expect(reachPercent(1)).toBe('100')
  })

  it('never reads a reach that draws thorns as 0', () => {
    // 0.0 means off, as thornIsOn reads it.
    for (const off of [0, -0.1, Number.NaN]) expect(reachPercent(off)).toBe('0.0')
    expect(reachPercent(1e-6)).toBe('0.01')
    // Every step of the slider below 1% reads as its own value.
    const shown = positions.map(reachFromSlider).filter((r) => r > 0 && r < 0.01).map(reachPercent)
    expect(shown.length).toBeGreaterThan(30)
    expect(new Set(shown).size).toBe(shown.length)
    expect(shown.every((t) => Number(t) > 0)).toBe(true)
    expect(reachReadout(0.003)).toBe('0.01')
  })

  it('reads the same in the status line as on the slider', () => {
    const line = (canvasReach: number, canvasEm?: number) =>
      describePipeline({ ...base, experimental: { ...thornOn, thorn: { ...thornOn.thorn, canvasReach, canvasEm } } }).find((step) => step.startsWith('thorn'))
    expect(line(0.1, 30.05)).toContain('reach 10% canvas (about 3.0 em)')
    expect(line(0.0001, 30.05)).toContain('reach 0.01% canvas (about 0.01 em)')
    expect(line(0.0004, 256)).toContain('reach 0.04% canvas (about 0.10 em)')
    // The em length is capped as Thorn caps it.
    expect(line(0.5, 1000)).toContain('reach 50% canvas (about 128 em)')
    for (const reach of positions.map(reachFromSlider).filter((r) => r > 0)) expect(line(reach), `${reach}`).toContain(`reach ${reachPercent(reach)}% canvas`)
  })
})

describe('canvasEm on the geometry parameters', () => {
  it('is the canvas diagonal in em while Thorn is on, and null while it is off', () => {
    expect(thornCanvasEm({ experimental, typography, artboard })).toBeNull()
    const em = thornCanvasEm({ experimental: thornOn, typography, artboard })
    expect(em).toBe(canvasDiagonalEm(artboard.width, artboard.height, typography.size))
    expect(em).toBeCloseTo(Math.hypot(1200, 800) / 48, 2)
    expect(em).toBe(THORN_LIMITS.defaultCanvasEm)
    // The PNG scale never counts.
    expect(thornCanvasEm({ experimental: thornOn, typography, artboard: { ...artboard, scale: 4 } })).toBe(em)
    expect(thornCanvasEm({ experimental: thornOn, typography: { ...typography, size: 96 }, artboard })).toBeCloseTo(em! / 2, 1)
  })

  it('with Thorn off, leaves the parameters and their key alone at every text size and canvas', () => {
    for (const size of [4, 48, 1000]) {
      for (const width of [100, 1200, 4000]) {
        const em = thornCanvasEm({ experimental, typography: { ...typography, size }, artboard: { ...artboard, width } })
        const params = { ...base, experimental: withThornCanvasEm(experimental, em) }
        expect(params.experimental).toBe(experimental)
        expect(paramsKey(params)).toBe(paramsKey(base))
      }
    }
  })

  it('is set on Thorn only, keyed, and removed again without touching the settings', () => {
    const on = withThornCanvasEm(thornOn, 30.04)
    expect(on.thorn).toEqual({ ...thornOn.thorn, canvasEm: 30.04 })
    expect(on.crumple).toBe(thornOn.crumple)
    expect(withThornCanvasEm(on, 30.04)).toBe(on)
    expect(paramsKey({ ...base, experimental: on })).not.toBe(paramsKey({ ...base, experimental: withThornCanvasEm(thornOn, 15.02) }))
    const off = withThornCanvasEm(on, null)
    expect(off.thorn).toEqual(thornOn.thorn)
    expect('canvasEm' in off.thorn).toBe(false)
    expect(withThornCanvasEm(thornOn, null)).toBe(thornOn)
  })
})
