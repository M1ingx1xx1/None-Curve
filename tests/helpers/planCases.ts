// Glide plans the plan tests run (planCodec, glideChain): pairs of outlines from Roboto and STIX under the effects
// whose glides take each kind of track (straight, Whorl on one ring and on two, Whorl's mesh, growing and shrinking
// contours, contours that stay), plus glides that go on from an in-between shape; and a hash of what a plan draws.

import { deriveGeometry } from '../../src/geometry/pipeline'
import type { GeometryParams, PolygonContour, PolygonGlyph } from '../../src/geometry/types'
import { morphAt, planMorph, settleInBetween, type MorphPlan } from '../../src/specimen/morph'
import { shapeSpecimen } from '../../src/specimen/scene'
import { loadFixture, type FixtureFont } from './fonts'
import { BASE } from './params'

export const exp = (patch: Partial<GeometryParams['experimental']>, seed = 1): GeometryParams => ({
  ...BASE,
  experimental: { ...BASE.experimental, seed, ...patch },
})
export const whorl = (amount: number, patch: Partial<GeometryParams['experimental']['whorl']> = {}) =>
  exp({ whorl: { ...BASE.experimental.whorl, enabled: true, amount, ...patch } })
export const burst = (seed: number) =>
  exp({ thorn: { ...BASE.experimental.thorn, enabled: true, burst: true, canvasReach: 0.05, canvasEm: 30 } }, seed)
export const thorny = (amount: number, reach: number) =>
  exp({
    whorl: { ...BASE.experimental.whorl, enabled: true, amount },
    thorn: { ...BASE.experimental.thorn, enabled: true, canvasReach: reach, canvasEm: 30 },
  })
export const dissolve = (seed: number) => exp({ dissolve: { ...BASE.experimental.dissolve, enabled: true } }, seed)

/** The polygon of the `k`th glyph of `text` in `font` under `params`. */
export async function glyphOf(
  font: FixtureFont,
  text: string,
  k: number,
  params: GeometryParams,
): Promise<PolygonGlyph> {
  const loaded = await loadFixture(font)
  const index = shapeSpecimen(loaded, text).indices[k]
  return deriveGeometry(loaded.getGlyph(index), params).polygon
}

const contour = (points: [number, number][], clockwise = false): PolygonContour => ({
  points: points.map(([x, y]) => ({ x, y })),
  clockwise,
})
const made = (...contours: PolygonContour[]): PolygonGlyph => ({
  ref: { index: 1, unicode: null, name: null } as unknown as PolygonGlyph['ref'],
  metrics: { unitsPerEm: 1000 } as PolygonGlyph['metrics'],
  contours,
})
const square = (x: number, y: number, s: number, clockwise = false) =>
  contour(
    [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
    ],
    clockwise,
  )

export interface PlanCase {
  name: string
  from: PolygonGlyph
  to: PolygonGlyph
}

/** Every case: its outlines `from` → `to` (a `from` may be an in-between shape, ready to glide on). */
export async function planCases(): Promise<PlanCase[]> {
  const cases: PlanCase[] = []
  const pair = async (name: string, font: FixtureFont, text: string, k: number, a: GeometryParams, b: GeometryParams) =>
    cases.push({ name, from: await glyphOf(font, text, k, a), to: await glyphOf(font, text, k, b) })
  for (const k of [0, 1, 6]) await pair(`burst H/a/g ${k}`, 'Roboto', 'Hamburg', k, burst(1), burst(2))
  await pair('whorl one ring', 'Roboto', 'Hamburg', 1, thorny(0.3, 0.03), thorny(0.9, 0.12))
  await pair('whorl rings', 'Roboto', 'Hamburg', 1, whorl(0.6), whorl(0.6, { rings: 3 }))
  await pair('whorl two rings', 'Roboto', 'Hamburg', 1, whorl(0.6), whorl(0.9, { sides: 5 }))
  await pair('whorl comes on', 'Roboto', 'Hamburg', 3, BASE, thorny(0.8, 0.05))
  await pair('mesh on', 'Roboto', 'Hamburg', 0, BASE, whorl(1.5))
  await pair('mesh amount', 'Roboto', 'Hamburg', 0, whorl(0.3), whorl(0.9))
  await pair('mesh off', 'Roboto', 'Hamburg', 2, whorl(1.2), BASE)
  await pair('dissolve STIX', 'STIXTwoText', 'Hamburg', 1, dissolve(1), dissolve(2))
  await pair('whorl STIX', 'STIXTwoText', 'Hamburg', 0, thorny(0.4, 0.04), whorl(1.1, { sides: 6 }))
  // Glides that go on from an in-between shape: by pairing, and by the mesh's pose.
  {
    const a = await glyphOf('Roboto', 'Hamburg', 1, burst(1))
    const b = await glyphOf('Roboto', 'Hamburg', 1, burst(2))
    const c = await glyphOf('Roboto', 'Hamburg', 1, burst(3))
    cases.push({ name: 'burst goes on', from: settleInBetween(morphAt(planMorph(a, b)!, 0.4), c), to: c })
  }
  {
    const a = await glyphOf('Roboto', 'Hamburg', 0, whorl(0.3))
    const b = await glyphOf('Roboto', 'Hamburg', 0, whorl(0.9))
    const c = await glyphOf('Roboto', 'Hamburg', 0, whorl(1.4))
    cases.push({ name: 'mesh goes on', from: settleInBetween(morphAt(planMorph(a, b)!, 0.35), c), to: c })
  }
  // Made up: a contour that grows from its centre and one that shrinks into it, and one that stays.
  const ring = made(square(0, 0, 300), square(100, 100, 100, true))
  const island = made(square(0, 0, 300), square(500, 500, 40))
  cases.push({ name: 'grow and shrink', from: ring, to: island })
  cases.push({
    name: 'still and moved',
    from: made(square(0, 0, 100), square(300, 0, 100)),
    to: made(square(0, 0, 100), square(320, 10, 100)),
  })
  return cases
}

/** The progress values the plan tests sample. */
export const SAMPLES = [0.001, 0.1, 0.37, 0.5, 0.5001, 0.9, 0.999] as const

/** FNV-1a over the bits of every anchor, the windings and the counts of what `plan` draws at each sample (and settled). */
export function planHash(plan: MorphPlan | null): string {
  if (!plan) return 'null'
  let h = 0x811c9dc5
  const f = new Float64Array(1)
  const bytes = new Uint8Array(f.buffer)
  const mix = (v: number) => {
    f[0] = v
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0
  }
  for (const p of SAMPLES) {
    const g = morphAt(plan, p)
    const settled = settleInBetween(g, plan.to)
    for (const glyph of [g, settled]) {
      mix(glyph.contours.length)
      for (const c of glyph.contours) {
        mix(c.clockwise ? 1 : 0)
        mix(c.points.length)
        for (const q of c.points) {
          mix(q.x)
          mix(q.y)
        }
      }
    }
    const w = g.motion?.whorl
    if (w) for (const v of [w.x, w.y, w.amount, w.radius, ...w.turns]) mix(v)
  }
  return `${plan.trajectory}:${plan.points}:${h.toString(16)}`
}
