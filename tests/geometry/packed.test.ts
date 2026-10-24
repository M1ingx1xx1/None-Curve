// Packed glyphs (src/geometry/packed.ts, NOCUR-85): a glyph packed into typed arrays unpacks to the same geometry, with
// its click outline (Thorn), layout hull and motion (Whorl's outline packed apart), and its byte estimate grows with its
// points.

import { describe, expect, it } from 'vitest'
import { packedBytes, packedPoints, packGeometry, unpackEntry, unpackGeometry } from '../../src/geometry/packed'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { WorkerGeometry } from '../../src/geometry/protocol'
import { loadFixture, sampleGlyphs } from '../helpers/fonts'
import { burst, whorl } from '../helpers/planCases'
import { BASE } from '../helpers/params'

describe('packed glyphs', async () => {
  const font = await loadFixture('Roboto')
  const glyphs = sampleGlyphs(font, 'Ag&o').map((g) => g.index)
  const geometryOf = (index: number, params = BASE): WorkerGeometry => {
    const { source: _source, ...geometry } = deriveGeometry(font.getGlyph(index), params)
    return geometry
  }

  it('unpack gives the glyph as it was packed', () => {
    for (const params of [BASE, burst(3)]) {
      for (const index of glyphs) {
        const geometry = geometryOf(index, params)
        const { packed, transfer } = packGeometry(geometry)
        expect(unpackGeometry(packed)).toEqual(geometry)
        // Every typed array goes in the transfer list.
        expect(transfer).toContain(packed.contours.xy.buffer)
        expect(packedPoints(packed)).toBe(
          geometry.polygon.contours.reduce((n, c) => n + c.points.length, 0) +
            (geometry.polygon.clickOutline && geometry.polygon.clickOutline !== geometry.polygon.contours
              ? geometry.polygon.clickOutline.reduce((n, c) => n + c.points.length, 0)
              : 0),
        )
      }
    }
  })

  it('keeps Thorn’s click outline apart, or as the outline itself, and its layout hull', () => {
    const geometry = geometryOf(glyphs[0], burst(3))
    expect(geometry.polygon.clickOutline).toBeDefined()
    expect(geometry.polygon.layoutHull).toBeDefined()
    const { packed } = packGeometry(geometry)
    expect(packed.click).not.toBe('same')
    expect(packed.hull).not.toBeNull()
    const same: WorkerGeometry = { ...geometry, polygon: { ...geometry.polygon, clickOutline: geometry.polygon.contours } }
    const packedSame = packGeometry(same).packed
    expect(packedSame.click).toBe('same')
    const back = unpackGeometry(packedSame)
    expect(back.polygon.clickOutline).toBe(back.polygon.contours)
  })

  it('keeps exact numbers, -0 included', () => {
    const geometry = geometryOf(glyphs[1])
    geometry.polygon.contours[0].points[0] = { x: -0, y: 1e-300 }
    const back = unpackGeometry(packGeometry(geometry).packed)
    expect(Object.is(back.polygon.contours[0].points[0].x, -0)).toBe(true)
    expect(back.polygon.contours[0].points[0].y).toBe(1e-300)
  })

  it('counts its bytes: 16 a point, plus its statistics', () => {
    const small = packGeometry(geometryOf(glyphs[3])).packed
    const large = packGeometry(geometryOf(glyphs[2])).packed
    for (const packed of [small, large]) expect(packedBytes(packed)).toBeGreaterThanOrEqual(16 * packedPoints(packed) + 2000)
    expect(packedPoints(large)).toBeGreaterThan(packedPoints(small))
    expect(packedBytes(large)).toBeGreaterThan(packedBytes(small))
  })

  it('packs Whorl’s outline apart (transferred and counted), the motion kept without it', () => {
    const geometry = geometryOf(glyphs[0], whorl(0.6))
    const outline = geometry.polygon.motion?.whorl?.outline
    expect(outline?.length).toBeGreaterThan(0)
    const { packed, transfer } = packGeometry(geometry)
    expect(packed.outline).not.toBeNull()
    expect('outline' in packed.rest.motion!.whorl!).toBe(false)
    expect(transfer).toContain(packed.outline!.xy.buffer)
    const { outline: _outline, ...kept } = geometry.polygon.motion!.whorl!
    const without = packGeometry({ ...geometry, polygon: { ...geometry.polygon, motion: { whorl: kept } } }).packed
    const points = outline!.reduce((n, ring) => n + ring.length, 0)
    expect(packedPoints(packed)).toBe(packedPoints(without) + points)
    expect(packedBytes(packed)).toBe(packedBytes(without) + 16 * points + 4 * (outline!.length + 1) + outline!.length)
    expect(unpackGeometry(packed)).toEqual(geometry)
    // The glyph packed keeps its outline (the cache's own objects are not changed).
    expect(geometry.polygon.motion?.whorl?.outline).toBe(outline)
  })

  it('leaves the statistics out when asked, counting fewer bytes', () => {
    const geometry = geometryOf(glyphs[1])
    const lean = packGeometry(geometry, false).packed
    expect(lean.stats).toBeNull()
    expect(packedBytes(lean)).toBeLessThan(packedBytes(packGeometry(geometry).packed))
    const { polygon, vertexCount } = geometry
    expect(unpackGeometry(lean)).toEqual({ polygon, vertexCount })
    expect(unpackEntry(lean)).toEqual({ geometry: { polygon, vertexCount }, lean: true })
    expect(unpackEntry(packGeometry(geometry).packed)).toEqual({ geometry })
  })
})
