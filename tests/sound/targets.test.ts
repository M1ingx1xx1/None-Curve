// The Sound targets beyond the Geometry and Experimental sliders (src/sound/mapping.ts): Typography, the text and
// background colours, the loaded font's variable axes, and the effects' switches. Each moves its own field and nothing
// else; an axis the font lacks and a colour without hue do nothing; switches flip in Trigger and Toggle (Follow falls
// back to a level threshold); and without any of these targets, modulate's output is exactly what it was.

import { afterEach, describe, expect, it } from 'vitest'
import { glyphGeometry } from '../../src/geometry/cache'
import { paramsKey } from '../../src/geometry/paramsKey'
import { DEFAULT_PALETTE, DEFAULT_TYPOGRAPHY } from '../../src/specimen/artboard'
import { hexToLch, isNeutralColor, lchToHex } from '../../src/specimen/color'
import {
  axisTargets,
  lookChanges,
  lookKey,
  modulate,
  setTargetFont,
  switchFires,
  targetById,
  TARGETS,
  whileSwitchesFire,
  type DrivenParams,
  type Mapping,
} from '../../src/sound/mapping'
import { SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { readSession, SESSION_VERSION } from '../../src/state/persist'
import { loadFixture } from '../helpers/fonts'
import { BASE, on } from '../helpers/params'

const DRIVEN: DrivenParams = {
  ...BASE,
  typography: DEFAULT_TYPOGRAPHY,
  palette: { ink: '#b03a2e', paper: '#f4efe6', transparent: false },
}
const frame = (level: number): FeatureFrame => ({
  ...SILENT_FRAME,
  time: 1,
  silent: level === 0,
  level,
  levelDb: level ? -20 : -Infinity,
})
const row = (target: string, depth = 0.5, patch: Partial<Mapping> = {}): Mapping => ({
  id: `${target} ${depth}`,
  enabled: true,
  feature: 'level',
  target,
  depth,
  ...patch,
})

afterEach(() => setTargetFont(null))

describe('Typography and Color targets', () => {
  it('move only their own field, on the canvas look', () => {
    const { params } = modulate(DRIVEN, frame(1), [row('typography.size', 0.1), row('typography.slant', -1)])
    expect(params.typography!.size).toBeGreaterThan(DEFAULT_TYPOGRAPHY.size)
    expect(params.typography!.slant).toBe(-30)
    expect({ ...params.typography, size: 0, slant: 0 }).toEqual({ ...DEFAULT_TYPOGRAPHY, size: 0, slant: 0 })
    // The geometry is untouched: same groups, same key.
    expect(paramsKey(params)).toBe(paramsKey(BASE))
    expect(lookChanges(DRIVEN, params)).toEqual({ typography: { size: params.typography!.size, slant: -30 } })
    expect(lookKey(params)).not.toBe(lookKey(DRIVEN))
  })

  it('move a colour in hue and lightness, keeping its chroma', () => {
    const { params } = modulate(DRIVEN, frame(1), [row('palette.inkHue', 0.5), row('palette.paperLightness', -0.5)])
    const ink = hexToLch(params.palette!.ink)
    const own = hexToLch(DRIVEN.palette!.ink)
    expect(Math.abs(ink.h - own.h)).toBeGreaterThan(90)
    expect(hexToLch(params.palette!.paper).L).toBeLessThan(hexToLch(DRIVEN.palette!.paper).L - 0.3)
    expect(params.palette!.transparent).toBe(false)
    expect(lookChanges(DRIVEN, params)).toEqual({ palette: { ink: params.palette!.ink, paper: params.palette!.paper } })
    // The conversions agree with themselves.
    expect(lchToHex(hexToLch('#3366cc'))).toBe('#3366cc')
  })

  it('leave a grey without hue and a transparent background alone, and say how to hear them', () => {
    const grey: DrivenParams = { ...DRIVEN, palette: { ...DEFAULT_PALETTE, ink: '#808080', transparent: true } }
    expect(isNeutralColor('#808080')).toBe(true)
    const hue = targetById('palette.inkHue')!
    const paper = targetById('palette.paperLightness')!
    expect(hue.inactive(grey)).toMatch(/grey/)
    expect(hue.activate(grey)).toBeNull()
    expect(paper.inactive(grey)).toMatch(/transparent/)
    expect(paper.activate(grey)?.patches).toEqual([{ group: 'palette', patch: { transparent: false } }])
    expect(modulate(grey, frame(1), [row('palette.inkHue'), row('palette.paperLightness')]).params).toBe(grey)
  })

  it('read from the defaults when the parameters carry no typography or palette', () => {
    const { params } = modulate(BASE, frame(1), [row('typography.tracking', 0.1)])
    expect(params.typography!.tracking).toBeGreaterThan(0)
    expect(params.palette).toBeUndefined()
  })
})

describe('Variable axis targets', () => {
  it('follow the loaded font: one per axis, over its range from its own value', async () => {
    const stix = await loadFixture('STIXTwoText')
    setTargetFont(stix)
    const [wght] = axisTargets()
    expect(wght.id).toBe('axis.wght')
    expect([wght.min, wght.max, wght.step, wght.tab]).toEqual([400, 700, 1, 'axes'])
    expect(wght.inactive(BASE)).toBeNull()
    expect(wght.get(BASE)).toBe(stix.instance?.wght ?? 400)
    const { params } = modulate(BASE, frame(1), [row('axis.wght', 1)])
    expect(params.variation).toEqual({ wght: 700 })
    // Its own value leaves no variation behind.
    expect(wght.set(params, wght.get(BASE)).variation).toBeUndefined()
  })

  it('are kept but do nothing without the axis', async () => {
    const stix = await loadFixture('STIXTwoText')
    const wdth = [row('axis.wdth', 1)]
    // No font: no axis targets, and every axis mapping waits.
    setTargetFont(null)
    expect(axisTargets()).toEqual([])
    expect(targetById('axis.wght')!.inactive(BASE)).toMatch(/no variable axes.*wght axis/)
    expect(modulate(BASE, frame(1), [row('axis.wght', 1), ...wdth]).params).toBe(BASE)
    // A font without the axis (STIX has only wght).
    setTargetFont(stix)
    const spec = targetById('axis.wdth')!
    expect(spec.inactive(BASE)).toMatch(/no wdth axis/)
    expect(spec.activate(BASE)).toBeNull()
    expect(modulate(BASE, frame(1), wdth).params).toBe(BASE)
    const mappings = [row('axis.wght', 1), ...wdth]
    // A saved mapping on an axis survives without the font.
    const session = readSession({ version: SESSION_VERSION, mappings })!
    expect(session.mappings.map((m) => m.target)).toEqual(['axis.wght', 'axis.wdth'])
    expect(readSession({ version: SESSION_VERSION, mappings: [row('axis.toolong', 1)] })!.mappings).toEqual([])
  })

  it('reshape the glyphs at the instance, cached once per set of values', async () => {
    const stix = await loadFixture('STIXTwoText')
    const index = stix.characters.find((c) => c.unicode === 0x4f)!.index
    const bold = stix.at!({ wght: 700 })
    expect(bold).not.toBe(stix)
    expect(stix.at!({ wght: 700 })).toBe(bold)
    expect(stix.at!({ ...(stix.instance ?? { wght: 400 }) })).toBe(stix)
    expect(bold.getPreviewPath(index)).not.toBe(stix.getPreviewPath(index))
    const plain = glyphGeometry(stix, index, BASE)
    const heavy = glyphGeometry(stix, index, { ...BASE, variation: { wght: 700 } })
    expect(heavy.polygon.contours).not.toEqual(plain.polygon.contours)
    // Without axis values the key is the seven groups, as it always was.
    expect(paramsKey(BASE)).toBe(
      JSON.stringify([
        BASE.flatten,
        BASE.random,
        BASE.squaring,
        BASE.anchors,
        BASE.grid,
        BASE.distortion,
        BASE.experimental,
      ]),
    )
  })
})

describe('Switch targets', () => {
  const burst = 'experimental.thorn.burst'
  const thornOn: DrivenParams = { ...DRIVEN, experimental: { ...BASE.experimental, ...on('thorn') } }

  it("are the effects' checkboxes, each a 0/1 switch", () => {
    const switches = TARGETS.filter((t) => t.kind === 'switch').map((t) => t.id)
    expect(switches).toEqual([
      'experimental.crumple.enabled',
      'experimental.ripple.enabled',
      'experimental.ripple.reverse',
      'experimental.whorl.enabled',
      'experimental.slipstream.enabled',
      'experimental.thorn.enabled',
      'experimental.thorn.burst',
      'experimental.thorn.reverse',
      'experimental.dissolve.enabled',
    ])
    for (const id of switches)
      expect([targetById(id)!.min, targetById(id)!.max, targetById(id)!.step]).toEqual([0, 1, 1])
  })

  it('flip in Trigger while the pulse lasts, in Toggle past half way, and in Follow at half the level', () => {
    const trigger = row(burst, 0.5, { mode: 'trigger' })
    const toggle = row(burst, 0.5, { mode: 'toggle' })
    expect([
      switchFires(trigger, 0),
      switchFires(trigger, 0.01),
      switchFires(toggle, 0.49),
      switchFires(toggle, 0.5),
    ]).toEqual([false, true, false, true])
    const flipped = modulate(thornOn, frame(1), [trigger], undefined, undefined, new Map([[trigger.id, 0.2]]))
    expect(flipped.params.experimental.thorn.burst).toBe(!thornOn.experimental.thorn.burst)
    expect(flipped.positions.get(burst)).toBe(1 - Number(thornOn.experimental.thorn.burst))
    const held = modulate(thornOn, frame(1), [toggle], undefined, undefined, new Map([[toggle.id, 0.2]]))
    expect(held.params).toBe(thornOn)
    // Follow (from a file; the Sound tab does not offer it): on at half the level and above.
    expect(modulate(thornOn, frame(0.4), [row(burst)]).params).toBe(thornOn)
    expect(modulate(thornOn, frame(0.6), [row(burst)]).params.experimental.thorn.burst).toBe(
      !thornOn.experimental.thorn.burst,
    )
  })

  it("ignore Depth's size and sign but not 0, and flip once however many mappings fire", () => {
    const flipped = !thornOn.experimental.thorn.burst
    expect(modulate(thornOn, frame(1), [row(burst, -0.1)]).params.experimental.thorn.burst).toBe(flipped)
    expect(modulate(thornOn, frame(1), [row(burst, 0)]).params).toBe(thornOn)
    const two = [row(burst, 1), { ...row(burst, 0.3), id: 'second' }]
    expect(modulate(thornOn, frame(1), two).params.experimental.thorn.burst).toBe(flipped)
  })

  it('switch an effect on for the targets that need it, and do nothing while their effect is off', () => {
    // Thorn is off: Burst does nothing, but switching Thorn on lets Thorn's sliders act in the same frame.
    expect(targetById(burst)!.inactive(DRIVEN)).not.toBeNull()
    expect(modulate(DRIVEN, frame(1), [row(burst)]).params).toBe(DRIVEN)
    const { params } = modulate(DRIVEN, frame(1), [
      row('experimental.thorn.enabled'),
      row('experimental.thorn.width', 0.5),
    ])
    expect(params.experimental.thorn.enabled).toBe(true)
    expect(params.experimental.thorn.width).not.toBe(DRIVEN.experimental.thorn.width)
  })

  it('let a switch act while another switch turns its effect on, and stop while one turns it off', () => {
    // "Use thorn" (Toggle) and "Burst" (Trigger) together, with Thorn off on the sliders: Burst flips in the same frame.
    const use = row('experimental.thorn.enabled', 0.5, { mode: 'toggle' })
    const trigger = row(burst, 0.5, { mode: 'trigger' })
    const shaped = new Map([
      [use.id, 1],
      [trigger.id, 0.2],
    ])
    const both = modulate(DRIVEN, frame(1), [trigger, use], undefined, undefined, shaped)
    expect(both.params.experimental.thorn.enabled).toBe(true)
    expect(both.params.experimental.thorn.burst).toBe(!DRIVEN.experimental.thorn.burst)
    expect(both.positions.get(burst)).toBe(1 - Number(DRIVEN.experimental.thorn.burst))
    // Ripple's Reverse the same way.
    const reverse = modulate(DRIVEN, frame(1), [row('experimental.ripple.reverse'), row('experimental.ripple.enabled')])
    expect(reverse.params.experimental.ripple.reverse).toBe(!DRIVEN.experimental.ripple.reverse)
    // Thorn on in the sliders, switched off by sound: Burst does nothing and shows no marker.
    const off = modulate(thornOn, frame(1), [trigger, use], undefined, undefined, shaped)
    expect(off.params.experimental.thorn.enabled).toBe(false)
    expect(off.params.experimental.thorn.burst).toBe(thornOn.experimental.thorn.burst)
    expect(off.positions.has(burst)).toBe(false)
  })

  it('tell the Sound tab what acts while the switch rows fire', () => {
    const width = targetById('experimental.thorn.width')!
    expect(whileSwitchesFire(DRIVEN, [row('experimental.thorn.width')])).toBe(DRIVEN)
    // Off rows and rows without Depth switch nothing.
    expect(whileSwitchesFire(DRIVEN, [row('experimental.thorn.enabled', 0)])).toBe(DRIVEN)
    const switched = whileSwitchesFire(DRIVEN, [row(burst), row('experimental.thorn.enabled')])
    expect(width.inactive(DRIVEN)).not.toBeNull()
    expect(width.inactive(switched)).toBeNull()
    expect(targetById(burst)!.inactive(switched)).toBeNull()
    expect(switched.experimental.thorn.burst).toBe(!DRIVEN.experimental.thorn.burst)
  })
})

describe('Without the new targets', () => {
  it('modulate gives exactly what it gave before: the same look, no axis values', () => {
    const mappings = [row('distortion.amount', 0.4), row('experimental.seed', 0.5)]
    for (const level of [0, 0.3, 1]) {
      const plain = modulate(BASE, frame(level), mappings)
      const driven = modulate(DRIVEN, frame(level), mappings)
      expect(paramsKey(driven.params)).toBe(paramsKey(plain.params))
      expect(driven.params.typography).toBe(DRIVEN.typography)
      expect(driven.params.palette).toBe(DRIVEN.palette)
      expect(driven.params.variation).toBeUndefined()
      expect(lookChanges(DRIVEN, driven.params)).toBeNull()
      expect(driven.positions).toEqual(plain.positions)
    }
    expect(lookKey(BASE)).toBe('')
  })
})
