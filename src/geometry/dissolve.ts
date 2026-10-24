// Experimental Dissolve: the letter rebuilt as photocopied ink, broken into faceted islands and rings, dense along the
// strokes, with loose specks just outside. Pure functions in font units; no React, no DOM, no Math.random.
//
// 1. Field. A grid of nodes around the letter (one noise period, Grain × the stroke width, every six cells) gets a
//    value from the signed distance to the visible outline (in half-strokes: -1 in the middle of the thickest stroke,
//    0 on the edge) and seeded gradient noise. Ink is where it is negative, from two channels thinned by Amount and by
//    a density that is 1 deep in the stroke and falls to 0 past Spread: rings, where a noise curled by a second one
//    (Curl) is near zero, so its zero lines wander into loops; and blobs, where a third noise peaks, solid islands that
//    fill some loops and clump the ink. A band just outside the outline adds loose specks (Specks). The core stays
//    dense ink pocked with holes, and the edge breaks into squiggles and dots.
// 2. Contours. Marching squares traces the zero line: closed loops that never cross, ink on their left, so outer
//    contours run counter-clockwise and holes clockwise (y up), as the merge of overlaps draws them (overlaps.ts).
//    Loops too small to show are left out (a hole's islands are smaller than it, so they go with it).
// 3. Facets. Traced on a fine grid, every loop would read as a smooth, round blob. So each is cut down to a few long
//    straight edges with sharp corners (see facet): vertices whose triangle with their neighbours is small go first
//    (Visvalingam–Whyatt), and so does every vertex at an edge shorter than half a facet or turning by less than a
//    clear corner, and one vertex of every run of gentle turns along short edges that would read as an arc. Where a
//    vertex at a short edge may not go, the edge's two ends become one point (at its middle, or where the edges beside
//    it meet) or both go. Every change is checked against every edge nearby, so no contour comes to cross or touch
//    itself or another, and holes stay inside their islands. The smallest specks end as triangles to hexagons.
// The outline is drawn anew from the field, so the input may cross itself (fonts' overlapping contours, unmerged
// effects): the field reads it by the nonzero rule. Dissolve runs last, after the merge, and needs none of its own.
// Each glyph has a grid budget (maxNodes: a letter with long thorns is sampled on a coarser grid) and the vertex budget
// (budget.ts): a result beyond it is faceted more coarsely, and then its smallest contours are left out.
// Everything follows from the seed, the parameters and the letter's own coordinates, so every copy of a letter
// dissolves alike.

import { insideRing } from './crossings'
import { hashInts } from './distortion'
import { DISSOLVE_LIMITS, dissolveIsOn } from './limits'
import { clamp, finite, signedArea } from './primitives'
import type { DissolveParams, Point, PolygonContour, PolygonGlyph } from './types'

/** The grid and the facets, by the noise period (see the header). */
const GRID = {
  /** Cells per noise period. */
  cellsPerPeriod: 6,
  /** The finest cell, as a share of the em. */
  minCell: 1 / 600,
  /** The coarse grid that measures the stroke: cells per em, and its nodes at most. */
  coarsePerEm: 120,
  coarseNodes: 200_000,
  /** The half stroke, as a share of the em (thinner hairlines and heavier blacks are measured as these). */
  minHalfStroke: 0.012,
  maxHalfStroke: 0.15,
  /**
   * The outline is measured from as simplified to within this share of a cell (a dense outline, with a vertex every few
   * units, would otherwise make each node measure its distance to hundreds of tiny segments).
   */
  outlineTolerance: 0.1,
} as const

const FACET = {
  /** Facet length at Facets 0% and 100%, as a share of the noise period. */
  min: 0.22,
  max: 0.6,
  /** The shortest facet in font units: rounding for export keeps whole units. */
  floor: 6,
  /** No edge shorter than this share of the facet length. */
  minEdge: 0.5,
  /** A vertex whose triangle with its neighbours is smaller than this share of the facet length squared goes. */
  area: 0.12,
  /** A vertex turning by less than this many degrees is no corner. */
  minTurn: 18,
  /**
   * An arc: `arcRun` or more vertices in a row turning the same way, each by less than `arcTurn` degrees, between
   * edges shorter than `arcEdge` facet lengths.
   */
  arcTurn: 45,
  arcEdge: 1.5,
  arcRun: 3,
  /** Contours smaller than this share of the facet length squared, or narrower on average than `width`, are left out. */
  minArea: 0.25,
  width: 0.2,
  /** ...and never smaller than these, in font units and square units (export rounds to whole units). */
  floorArea: 16,
  floorWidth: 2,
  /** No new edge comes closer to another than this share of a cell. */
  clearance: 0.05,
  /** A result beyond the vertex budget is faceted again this many times, each with facets this much longer. */
  coarser: 3,
  coarserScale: 1.6,
  /** Rounds of breaking arcs (each followed by the triangle-area pass). */
  arcRounds: 24,
} as const

export interface DissolveStats {
  applied: boolean
  /** Contours of ink: islands and specks. */
  islands: number
  /** Holes in them. */
  holes: number
  /** The letter is so large (long thorns) that it was sampled on a coarser grid than Grain asks for. */
  coarser: boolean
  /** The facet length it was cut to (font units; the longer one when it was reduced). */
  facet: number
  /** Faceted more coarsely, or with its smallest contours left out, to stay within the vertex budget. */
  reduced: boolean
}

export const emptyDissolveStats = (): DissolveStats => ({
  applied: false,
  islands: 0,
  holes: 0,
  coarser: false,
  facet: 0,
  reduced: false,
})

/** Channel numbers keep Dissolve's random numbers apart from the other effects' for the same seed. */
const CHANNEL = {
  edge: 0x0d1,
  edgeFine: 0x0d2,
  edgeDetail: 0x0d3,
  patch: 0x0d4,
  curlX: 0x0d5,
  curlY: 0x0d6,
  ring: 0x0d7,
  ringFine: 0x0d8,
  blob: 0x0d9,
  blobFine: 0x0da,
  speck: 0x0db,
  speckFine: 0x0dc,
} as const

/**
 * The glyph dissolved (see the header). `maxVertices`: the glyph's vertex budget (budget.ts). Contours come out
 * counter-clockwise around ink and clockwise around holes, crossing nothing.
 */
export function applyDissolve(
  polygon: PolygonGlyph,
  params: DissolveParams,
  seed: number,
  unitsPerEm: number,
  maxVertices = Infinity,
): { polygon: PolygonGlyph; stats: DissolveStats } {
  const stats = emptyDissolveStats()
  const contours = polygon.contours.map((c) => c.points).filter((c) => c.length >= 3)
  if (!dissolveIsOn(params) || contours.length === 0) return { polygon, stats }
  const upm = unitsPerEm > 0 ? unitsPerEm : 1000
  const p = settings(params)
  const field = inkField(contours, p, seed, upm)
  if (!field) return { polygon, stats }
  stats.coarser = field.coarser
  const loops = marchingSquares(field.values, field.grid)
  const period = p.grain * 2 * field.halfStroke
  const baseFacet = Math.max(period * (FACET.min + (FACET.max - FACET.min) * p.facets), FACET.floor)
  // Beyond the budget, the result is faceted again, more coarsely.
  let result = loops
  for (let attempt = 0; attempt <= FACET.coarser; attempt++) {
    const facet = baseFacet * FACET.coarserScale ** attempt
    result = facetLoops(result, facet, field.grid.cell)
    stats.facet = facet
    if (countVertices(result) <= maxVertices) break
    stats.reduced = true
  }
  if (countVertices(result) > maxVertices) result = leaveOutSmallest(result, maxVertices)
  const out: PolygonContour[] = result.map((points) => ({ points, clockwise: signedArea(points) < 0 }))
  stats.applied = true
  stats.islands = out.filter((c) => !c.clockwise).length
  stats.holes = out.length - stats.islands
  return { polygon: { ...polygon, contours: out }, stats }
}

interface Settings {
  amount: number
  grain: number
  spread: number
  specks: number
  curl: number
  facets: number
}

/** The parameters within their ranges (missing or broken ones at the far end that does least). */
function settings(params: DissolveParams): Settings {
  return {
    amount: clamp(finite(params.amount, 0), 0, 1),
    grain: clamp(finite(params.grain, DISSOLVE_LIMITS.maxGrain), DISSOLVE_LIMITS.minGrain, DISSOLVE_LIMITS.maxGrain),
    spread: clamp(finite(params.spread, 0), 0, DISSOLVE_LIMITS.maxSpread),
    specks: clamp(finite(params.specks, 0), 0, 1),
    curl: clamp(finite(params.curl, 0), 0, 1),
    facets: clamp(finite(params.facets, 0.5), 0, 1),
  }
}

// ---- 1. The ink field ----

/** Nodes (ox + i·cell, oy + j·cell) for i < nx, j < ny. */
interface Grid {
  ox: number
  oy: number
  nx: number
  ny: number
  cell: number
}

function inkField(
  contours: Point[][],
  p: Settings,
  seed: number,
  upm: number,
): { values: Float32Array; grid: Grid; halfStroke: number; coarser: boolean } | null {
  const box = bounds(contours)
  if (!box) return null
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  const winding = new WindingIndex(contours)
  const step = Math.max(upm / 60, perimeter(contours) / 4000)
  const outline = visibleOutline(contours, winding, step, upm / 4000)

  // The half stroke (the largest distance from the outline inside the ink), on a coarse grid; it sizes the rest.
  const band = 0.16 * upm
  const coarseCell = Math.max(
    upm / GRID.coarsePerEm,
    Math.sqrt(((width + 2 * band) * (height + 2 * band)) / GRID.coarseNodes),
  )
  const coarse = gridAround(box, coarseCell, coarseCell)
  const coarseInside = insideMask(contours, coarse)
  const coarseDistance = distanceField(simplified(outline, GRID.outlineTolerance * coarseCell), coarse, band)
  let h = 0
  for (let k = 0; k < coarseDistance.length; k++) if (coarseInside[k] && coarseDistance[k] > h) h = coarseDistance[k]
  h = clamp(h, GRID.minHalfStroke * upm, GRID.maxHalfStroke * upm)

  // How far ink may reach past the outline, in half-strokes: the ragged edge and the specks fade out before it.
  const reachS = 2.2 + 1.9 * p.spread
  const period = p.grain * 2 * h
  let cell = Math.max(period / GRID.cellsPerPeriod, GRID.minCell * upm)
  const margin = (c: number) => reachS * h + 3 * c
  const nodes = (c: number) => ((width + 2 * margin(c)) / c + 3) * ((height + 2 * margin(c)) / c + 3)
  let coarser = false
  while (nodes(cell) > DISSOLVE_LIMITS.maxNodes) {
    cell *= 1.25
    coarser = true
  }
  const grid = gridAround(box, margin(cell), cell)
  const inside = insideMask(contours, grid)
  // Beyond `cap` from the outline nothing is drawn, so the distance is measured no further.
  const cap = reachS * h + cell
  const distance = distanceField(simplified(outline, GRID.outlineTolerance * cell), grid, cap)

  const noise = (channel: number) => new GradientNoise(seed, channel)
  const edge = noise(CHANNEL.edge)
  const edgeFine = noise(CHANNEL.edgeFine)
  const edgeDetail = noise(CHANNEL.edgeDetail)
  const patch = noise(CHANNEL.patch)
  const curlX = noise(CHANNEL.curlX)
  const curlY = noise(CHANNEL.curlY)
  const ring = noise(CHANNEL.ring)
  const ringFine = noise(CHANNEL.ringFine)
  const blob = noise(CHANNEL.blob)
  const blobFine = noise(CHANNEL.blobFine)
  const speck = noise(CHANNEL.speck)
  const speckFine = noise(CHANNEL.speckFine)

  // Ring width and blob threshold, in the core and at the edge: more Amount, thinner rings and fewer blobs.
  const ringCore = 0.28 - 0.13 * p.amount
  const ringEdge = 0.09 - 0.04 * p.amount
  const blobCore = 0.08 + 0.3 * p.amount
  const blobEdge = 0.45
  const edgeWobble = 1.2 + 0.6 * p.spread
  const speckAt = 0.7 * p.spread + 0.4
  const speckWidth = 0.6 * p.spread + 0.7
  const frequency = 1 / period
  const { ox, oy, nx, ny } = grid
  const values = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      // The border stays clear, so every loop closes.
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1 || (!inside[k] && distance[k] >= cap)) {
        values[k] = 1
        continue
      }
      const s = (inside[k] ? -distance[k] : distance[k]) / h
      const taper = smooth((reachS - 0.3 - s) / 0.8)
      const u = (ox + i * cell) * frequency
      const v = (oy + j * cell) * frequency
      // The edge bends where it lies, so the outline breaks unevenly; a coarse patch noise clumps the ink.
      const wobble = (edge.at(u * 0.3, v * 0.3) + 0.5 * edgeFine.at(u * 0.61 + 17.31, v * 0.61 - 9.73)) / 1.5
      const se = s + edgeWobble * wobble + edgeDetail.at(u * 0.8 + 3.7, v * 0.8 + 8.1)
      let density = smooth((p.spread + 0.2 - se) / (p.spread + 1.1)) ** 0.6
      density = clamp(density * (1 + 0.9 * patch.at(u * 0.22 + 5.3, v * 0.22 - 2.9)), 0, 1) * taper
      let value = 1
      if (density > 0.01) {
        // Curled noise: its zero lines wander into loops and rings.
        const wx = p.curl * 1.4 * curlX.at(u * 0.45, v * 0.45)
        const wy = p.curl * 1.4 * curlY.at(u * 0.45 + 31.7, v * 0.45 - 12.1)
        const rings = ring.at(u + wx, v + wy) + 0.3 * ringFine.at(2.1 * (u + wx), 2.1 * (v + wy))
        const blobs = blob.at(1.3 * u - wy, 1.3 * v + wx) + 0.35 * blobFine.at(2.7 * u, 2.7 * v)
        const ringWidth = ringEdge * Math.min(1, density * 4) + (ringCore - ringEdge) * density - 0.015
        const blobLevel = blobEdge + (blobCore - blobEdge) * density * density
        value = Math.min((Math.abs(rings) - ringWidth) * 4, (blobLevel - blobs) * 2.5)
      }
      // Specks: high-frequency peaks in a band just outside the edge.
      if (p.specks > 0 && s > -0.2) {
        const bump = Math.exp(-(((s - speckAt) / speckWidth) ** 2)) * taper
        if (bump > 0.02) {
          const peaks = speck.at(u * 1.9, v * 1.9) + 0.4 * speckFine.at(u * 4.3, v * 4.3)
          value = Math.min(value, (0.7 - 0.36 * p.specks * bump - peaks) * 2)
        }
      }
      values[k] = value
    }
  }
  return { values, grid, halfStroke: h, coarser }
}

/** A grid of `cell` over the box with `margin` around it, its nodes on whole multiples of the cell. */
function gridAround(box: Box, margin: number, cell: number): Grid {
  const i0 = Math.floor((box.minX - margin) / cell) - 1
  const j0 = Math.floor((box.minY - margin) / cell) - 1
  const i1 = Math.ceil((box.maxX + margin) / cell) + 1
  const j1 = Math.ceil((box.maxY + margin) / cell) + 1
  return { ox: i0 * cell, oy: j0 * cell, nx: i1 - i0 + 1, ny: j1 - j0 + 1, cell }
}

/** 1 for every node the contours fill by the nonzero rule, by scanlines. */
function insideMask(contours: Point[][], grid: Grid): Uint8Array {
  const { ox, oy, nx, ny, cell } = grid
  const mask = new Uint8Array(nx * ny)
  const rows: { x: number; w: number }[][] = Array.from({ length: ny }, () => [])
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i]
      const b = c[(i + 1) % c.length]
      if (a.y === b.y) continue
      const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - oy) / cell))
      const j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) - oy) / cell))
      for (let j = j0; j <= j1; j++) {
        const y = oy + j * cell
        // Half-open in y, so a vertex on the scanline counts once.
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y))
          rows[j].push({ x: a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), w: b.y > a.y ? 1 : -1 })
      }
    }
  }
  for (let j = 0; j < ny; j++) {
    const xs = rows[j]
    if (xs.length === 0) continue
    xs.sort((p, q) => p.x - q.x)
    let wind = 0
    let k = 0
    for (let i = 0; i < nx; i++) {
      const x = ox + i * cell
      while (k < xs.length && xs[k].x <= x) wind += xs[k++].w
      if (wind !== 0) mask[j * nx + i] = 1
    }
  }
  return mask
}

/**
 * The distance from every node to the nearest segment, up to `cap` (nodes further away get `cap`). Each segment visits
 * only the nodes within `cap` of it: row by row, the span where the row crosses its capsule (two end circles and the
 * two sides between them, a convex shape, so one span per row).
 */
function distanceField(segments: readonly Segment[], grid: Grid, cap: number): Float32Array {
  const { ox, oy, nx, ny, cell } = grid
  const squared = new Float32Array(nx * ny).fill(cap * cap)
  const cap2 = cap * cap
  for (const [a, b] of segments) {
    const ex = b.x - a.x
    const ey = b.y - a.y
    const length = Math.hypot(ex, ey)
    const length2 = length * length || 1e-9
    // The capsule's sides: the segment moved `cap` to either side.
    const sx = length > 0 ? (-ey / length) * cap : 0
    const sy = length > 0 ? (ex / length) * cap : 0
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - cap - oy) / cell))
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + cap - oy) / cell))
    for (let j = j0; j <= j1; j++) {
      const y = oy + j * cell
      let low = Infinity
      let high = -Infinity
      for (const end of [a, b]) {
        const dy = y - end.y
        if (dy * dy <= cap2) {
          const w = Math.sqrt(cap2 - dy * dy)
          low = Math.min(low, end.x - w)
          high = Math.max(high, end.x + w)
        }
      }
      if (ey !== 0) {
        for (const side of [1, -1]) {
          const y0 = a.y + side * sy
          const t = (y - y0) / ey
          if (t >= 0 && t <= 1) {
            const x = a.x + side * sx + t * ex
            low = Math.min(low, x)
            high = Math.max(high, x)
          }
        }
      }
      if (low > high) continue
      // One node more on either side, for rounding: the distance itself is exact.
      const i0 = Math.max(0, Math.floor((low - ox) / cell))
      const i1 = Math.min(nx - 1, Math.ceil((high - ox) / cell))
      const py = y - a.y
      for (let i = i0; i <= i1; i++) {
        const px = ox + i * cell - a.x
        let t = (px * ex + py * ey) / length2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const dx = px - t * ex
        const dy = py - t * ey
        const d2 = dx * dx + dy * dy
        const k = j * nx + i
        if (d2 < squared[k]) squared[k] = d2
      }
    }
  }
  for (let k = 0; k < squared.length; k++) squared[k] = Math.sqrt(squared[k])
  return squared
}

type Segment = readonly [Point, Point]

/**
 * The outline that shows, as polylines: every edge cut into pieces of at most `step`, keeping those with ink on one
 * side and none on the other (`probe` away), joined again along each contour. Contours that overlap (common in fonts)
 * would otherwise leave seams inside the strokes.
 */
function visibleOutline(contours: Point[][], winding: WindingIndex, step: number, probe: number): Point[][] {
  const out: Point[][] = []
  for (const c of contours) {
    // The polyline being drawn, while the outline shows up to the current point.
    let line: Point[] | null = null
    for (let i = 0; i < c.length; i++) {
      const a = c[i]
      const b = c[(i + 1) % c.length]
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length < 1e-9) continue
      const nx = -(b.y - a.y) / length
      const ny = (b.x - a.x) / length
      const pieces = Math.max(1, Math.ceil(length / step))
      const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      const shows = Array.from({ length: pieces }, (_, k) => {
        const m = at((k + 0.5) / pieces)
        return (
          (winding.at(m.x + nx * probe, m.y + ny * probe) !== 0) !==
          (winding.at(m.x - nx * probe, m.y - ny * probe) !== 0)
        )
      })
      for (let k = 0; k < pieces; k++) {
        if (!shows[k]) {
          line = null
          continue
        }
        if (!line) {
          line = [k === 0 ? a : at(k / pieces)]
          out.push(line)
        }
        // Only the ends of a visible run along one edge: the pieces between lie on the same line.
        if (k === pieces - 1) line.push(b)
        else if (!shows[k + 1]) line.push(at((k + 1) / pieces))
      }
    }
  }
  return out
}

/** The polylines simplified to within `tolerance` (Douglas–Peucker), as segments. */
function simplified(lines: readonly Point[][], tolerance: number): Segment[] {
  const out: Segment[] = []
  for (const line of lines) {
    if (line.length < 2) continue
    const keep = new Uint8Array(line.length)
    keep[0] = 1
    keep[line.length - 1] = 1
    const stack: [number, number][] = [[0, line.length - 1]]
    while (stack.length) {
      const [first, last] = stack.pop()!
      let worst = -1
      let far = tolerance
      for (let k = first + 1; k < last; k++) {
        const d = pointSegment(line[k].x, line[k].y, line[first].x, line[first].y, line[last].x, line[last].y)
        if (d > far) {
          far = d
          worst = k
        }
      }
      if (worst < 0) continue
      keep[worst] = 1
      stack.push([first, worst], [worst, last])
    }
    let previous = line[0]
    for (let k = 1; k < line.length; k++) {
      if (!keep[k]) continue
      out.push([previous, line[k]])
      previous = line[k]
    }
  }
  return out
}

/** The contours' edges by horizontal strips, for winding numbers of many points. */
class WindingIndex {
  private readonly low: number
  private readonly height: number
  private readonly strips: number[][]
  private readonly edges: Segment[] = []

  constructor(contours: Point[][]) {
    let low = Infinity
    let high = -Infinity
    for (const c of contours) {
      for (let i = 0; i < c.length; i++) {
        const a = c[i]
        const b = c[(i + 1) % c.length]
        if (a.y === b.y) continue
        this.edges.push([a, b])
        low = Math.min(low, a.y, b.y)
        high = Math.max(high, a.y, b.y)
      }
    }
    const count = clamp(Math.ceil(this.edges.length / 4), 1, 1024)
    this.low = Number.isFinite(low) ? low : 0
    this.height = Number.isFinite(high) && high > low ? (high - low) / count : 1
    this.strips = Array.from({ length: count }, () => [])
    this.edges.forEach(([a, b], e) => {
      const s0 = this.strip(Math.min(a.y, b.y))
      const s1 = this.strip(Math.max(a.y, b.y))
      for (let s = s0; s <= s1; s++) this.strips[s].push(e)
    })
  }

  private strip(y: number): number {
    return clamp(Math.floor((y - this.low) / this.height), 0, this.strips.length - 1)
  }

  /** The nonzero winding number of the contours around (x, y). */
  at(x: number, y: number): number {
    let w = 0
    for (const e of this.strips[this.strip(y)]) {
      const [a, b] = this.edges[e]
      const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)
      if (a.y <= y) {
        if (b.y > y && side > 0) w++
      } else if (b.y <= y && side < 0) w--
    }
    return w
  }
}

// ---- 2. Marching squares ----

/**
 * The loops where the values turn negative (ink), on a grid whose border nodes are all positive, so every loop closes.
 * Ink lies on the left of every loop. A saddle is resolved by the average of its cell.
 */
function marchingSquares(f: Float32Array, grid: Grid): Point[][] {
  const { ox, oy, nx, ny, cell } = grid
  // Edge ids: from node (i, j) to (i + 1, j) is 2·(j·nx + i); from (i, j) to (i, j + 1) is 2·(j·nx + i) + 1.
  const next = new Int32Array(2 * nx * ny).fill(-1)
  const H = (i: number, j: number) => 2 * (j * nx + i)
  const V = (i: number, j: number) => 2 * (j * nx + i) + 1
  const ins = [false, false, false, false]
  const edges = [0, 0, 0, 0]
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      ins[0] = f[j * nx + i] < 0
      ins[1] = f[j * nx + i + 1] < 0
      ins[2] = f[(j + 1) * nx + i + 1] < 0
      ins[3] = f[(j + 1) * nx + i] < 0
      const n = +ins[0] + +ins[1] + +ins[2] + +ins[3]
      if (n === 0 || n === 4) continue
      // Counter-clockwise around the cell: bottom, right, top, left.
      edges[0] = H(i, j)
      edges[1] = V(i + 1, j)
      edges[2] = H(i, j + 1)
      edges[3] = V(i, j)
      if (n !== 2 || ins[0] === ins[1] || ins[1] === ins[2]) {
        // One way out: from the edge where ink ends (going counter-clockwise) to the edge where it begins.
        let exit = -1
        let entry = -1
        for (let e = 0; e < 4; e++) {
          if (ins[e] && !ins[(e + 1) & 3]) exit = e
          else if (!ins[e] && ins[(e + 1) & 3]) entry = e
        }
        next[edges[exit]] = edges[entry]
      } else {
        // A saddle: ink through the middle joins each exit to the next entry; otherwise to the one before.
        const centre = (f[j * nx + i] + f[j * nx + i + 1] + f[(j + 1) * nx + i + 1] + f[(j + 1) * nx + i]) / 4 < 0
        for (let e = 0; e < 4; e++) {
          if (ins[e] && !ins[(e + 1) & 3]) next[edges[e]] = edges[centre ? (e + 1) & 3 : (e + 3) & 3]
        }
      }
    }
  }
  const point = (id: number): Point => {
    const node = id >> 1
    const i = node % nx
    const j = (node - i) / nx
    const a = f[node]
    const b = id & 1 ? f[node + nx] : f[node + 1]
    // Kept off the nodes, so loops through neighbouring cells stay apart.
    const t = clamp(a / (a - b), 0.05, 0.95)
    return id & 1 ? { x: ox + i * cell, y: oy + (j + t) * cell } : { x: ox + (i + t) * cell, y: oy + j * cell }
  }
  const loops: Point[][] = []
  for (let start = 0; start < next.length; start++) {
    if (next[start] < 0) continue
    const loop: Point[] = []
    let e = start
    while (next[e] >= 0) {
      loop.push(point(e))
      const n = next[e]
      next[e] = -1
      e = n
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

// ---- 3. Facets ----

/**
 * The loops cut into facets about `facet` long (see the header), each removal checked against every edge nearby;
 * contours too small or thin to show are left out, with whatever lies inside them.
 */
function facetLoops(loops: readonly Point[][], facet: number, cell: number): Point[][] {
  const minArea = Math.max(FACET.minArea * facet * facet, FACET.floorArea)
  const kept = loops.filter((loop) => Math.abs(signedArea(loop)) >= minArea)
  const mesh = new FacetMesh(kept, facet, cell)
  mesh.run()
  const faceted = mesh.loops()
  const minWidth = Math.max(FACET.width * facet, FACET.floorWidth)
  const small = faceted.map((loop) => {
    const area = Math.abs(signedArea(loop))
    return loop.length < 3 || area < minArea || (2 * area) / perimeter([loop]) < minWidth
  })
  return withoutInside(faceted, small)
}

/** The loops without those flagged and every loop inside one of them (so no hole is left without its island). */
function withoutInside(loops: Point[][], drop: boolean[]): Point[][] {
  if (!drop.includes(true)) return loops
  const parent = parents(loops)
  // A loop goes when it or any loop around it is flagged; parents are larger, so they are decided first.
  const order = loops.map((_, k) => k).sort((a, b) => depth(parent, a) - depth(parent, b))
  const out = drop.slice()
  for (const k of order) if (parent[k] >= 0 && out[parent[k]]) out[k] = true
  return loops.filter((_, k) => !out[k])
}

/** The loops without the smallest, until they have at most `limit` vertices (with whatever lies inside each). */
function leaveOutSmallest(loops: Point[][], limit: number): Point[][] {
  const parent = parents(loops)
  const children: number[][] = loops.map(() => [])
  parent.forEach((p, k) => p >= 0 && children[p].push(k))
  const out = loops.map(() => false)
  let total = countVertices(loops)
  const order = loops
    .map((loop, k) => ({ k, area: Math.abs(signedArea(loop)) }))
    .sort((a, b) => a.area - b.area || a.k - b.k)
  for (const { k } of order) {
    if (total <= limit) break
    if (out[k]) continue
    const stack = [k]
    while (stack.length) {
      const m = stack.pop()!
      if (out[m]) continue
      out[m] = true
      total -= loops[m].length
      stack.push(...children[m])
    }
  }
  return loops.filter((_, k) => !out[k])
}

/** For each loop, the smallest loop around it, or -1. Loops never cross, so one vertex tells. */
function parents(loops: Point[][]): number[] {
  const boxes = loops.map((loop) => bounds([loop])!)
  const areas = loops.map((loop) => Math.abs(signedArea(loop)))
  // By the left side of their boxes, so only loops starting further left can hold one.
  const byLeft = loops.map((_, k) => k).sort((a, b) => boxes[a].minX - boxes[b].minX || a - b)
  return loops.map((loop, k) => {
    const box = boxes[k]
    let best = -1
    for (const d of byLeft) {
      const outer = boxes[d]
      if (outer.minX > box.minX) break
      if (d === k || areas[d] <= areas[k] || outer.maxX < box.maxX || outer.minY > box.minY || outer.maxY < box.maxY)
        continue
      if ((best < 0 || areas[d] < areas[best]) && insideRing(loop[0], loops[d])) best = d
    }
    return best
  })
}

function depth(parent: number[], k: number): number {
  let n = 0
  for (let p = parent[k]; p >= 0; p = parent[p]) n++
  return n
}

/**
 * The loops as rings of vertices, cut into facets by leaving vertices out. Every edge sits in a grid of buckets, so a
 * removal is checked against the edges nearby only.
 */
class FacetMesh {
  private readonly x: Float64Array
  private readonly y: Float64Array
  private readonly prev: Int32Array
  private readonly next: Int32Array
  private readonly ring: Int32Array
  private readonly alive: Uint8Array
  /** Grows when a vertex or its neighbours change: the heap's entries for it are then stale. */
  private readonly version: Int32Array
  /** Grows when the edge from a vertex changes: the buckets' entries for it are then stale. */
  private readonly edgeVersion: Int32Array
  private readonly seen: Int32Array
  private visit = 0
  /** Each ring's first vertex, vertex count and signed area. */
  private readonly head: number[] = []
  private readonly count: number[] = []
  private readonly area: number[] = []
  private readonly buckets: (number[] | undefined)[]
  private readonly bx0: number
  private readonly by0: number
  private readonly bw: number
  private readonly bh: number
  private readonly size: number
  private readonly heap = new Heap()
  private readonly minEdge: number
  private readonly maxArea: number
  private readonly arcEdge: number
  private readonly clearance: number

  constructor(loops: readonly Point[][], facet: number, cell: number) {
    const n = loops.reduce((sum, loop) => sum + loop.length, 0)
    this.x = new Float64Array(n)
    this.y = new Float64Array(n)
    this.prev = new Int32Array(n)
    this.next = new Int32Array(n)
    this.ring = new Int32Array(n)
    this.alive = new Uint8Array(n).fill(1)
    this.version = new Int32Array(n)
    this.edgeVersion = new Int32Array(n)
    this.seen = new Int32Array(n)
    this.minEdge = FACET.minEdge * facet
    this.maxArea = FACET.area * facet * facet
    this.arcEdge = FACET.arcEdge * facet
    this.clearance = FACET.clearance * cell
    let v = 0
    loops.forEach((loop, r) => {
      const first = v
      for (let i = 0; i < loop.length; i++, v++) {
        this.x[v] = loop[i].x
        this.y[v] = loop[i].y
        this.prev[v] = i === 0 ? first + loop.length - 1 : v - 1
        this.next[v] = i === loop.length - 1 ? first : v + 1
        this.ring[v] = r
      }
      this.head.push(first)
      this.count.push(loop.length)
      this.area.push(signedArea(loop))
    })
    const box = bounds(loops as Point[][]) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    // Buckets about a facet across, but no more than about one per vertex.
    this.size = Math.max(
      facet,
      cell,
      Math.sqrt(((box.maxX - box.minX + 1) * (box.maxY - box.minY + 1)) / Math.max(n, 1)),
    )
    this.bx0 = Math.floor(box.minX / this.size)
    this.by0 = Math.floor(box.minY / this.size)
    this.bw = Math.floor(box.maxX / this.size) - this.bx0 + 1
    this.bh = Math.floor(box.maxY / this.size) - this.by0 + 1
    this.buckets = new Array(this.bw * this.bh)
    for (let k = 0; k < n; k++) this.addEdge(k)
  }

  /** Leaves vertices out until every contour is faceted, or no removal left would keep the outlines apart. */
  run() {
    for (let v = 0; v < this.x.length; v++) this.push(v)
    this.drain()
    for (let round = 0; round < FACET.arcRounds; round++) {
      if (!this.breakArcs()) break
      this.drain()
    }
  }

  /** The rings as they stand. */
  loops(): Point[][] {
    return this.head.map((first) => {
      const loop: Point[] = []
      let v = first
      do {
        loop.push({ x: this.x[v], y: this.y[v] })
        v = this.next[v]
      } while (v !== first)
      return loop
    })
  }

  /** Removes vertices from the heap, smallest triangle first, while they are too weak a corner and may go. */
  private drain() {
    for (;;) {
      const top = this.heap.pop()
      if (!top) return
      const [key, v, version] = top
      if (key >= 1) return
      if (!this.alive[v] || this.version[v] !== version) continue
      if (this.replaceable([v], null)) this.replace([v], null)
      else {
        // A short edge whose ends may not go on their own: both become one point, at its middle or where the edges on
        // either side meet when extended; or, where both come too close to another edge (a slit between two parts of
        // a loop), both go.
        const p = this.prev[v]
        const before = this.length(p, v)
        const after = this.length(v, this.next[v])
        if (Math.min(before, after) >= this.minEdge) continue
        const edge = before <= after ? [p, v] : [v, this.next[v]]
        const middle = { x: (this.x[edge[0]] + this.x[edge[1]]) / 2, y: (this.y[edge[0]] + this.y[edge[1]]) / 2 }
        const corner = this.corner(edge[0], edge[1])
        if (this.replaceable(edge, middle)) this.replace(edge, middle)
        else if (corner && this.replaceable(edge, corner)) this.replace(edge, corner)
        else if (this.replaceable(edge, null)) this.replace(edge, null)
      }
    }
  }

  /** Queues a vertex that is too weak a corner, by its triangle's area: first those at short edges or barely turning. */
  private push(v: number) {
    if (!this.alive[v] || this.count[this.ring[v]] <= 3) return
    const p = this.prev[v]
    const n = this.next[v]
    const area = Math.abs(cross(this.x[p], this.y[p], this.x[v], this.y[v], this.x[n], this.y[n])) / 2
    const short = Math.min(this.length(p, v), this.length(v, n)) < this.minEdge
    const flat = Math.abs(this.turn(v)) < FACET.minTurn
    const key = area / this.maxArea - (short || flat ? 10 : 0)
    if (key < 1) this.heap.push(key, v, this.version[v])
  }

  /**
   * Leaves out one vertex of every arc: a run of vertices turning the same way, each gently, between short edges (see
   * FACET). True when any went.
   */
  private breakArcs(): boolean {
    let removed = false
    for (let r = 0; r < this.head.length; r++) {
      if (this.count[r] < 4) continue
      const ring: number[] = []
      let v = this.head[r]
      do {
        ring.push(v)
        v = this.next[v]
      } while (v !== this.head[r])
      const m = ring.length
      const sign = ring.map((k) => {
        const t = this.turn(k)
        const gentle =
          Math.abs(t) < FACET.arcTurn &&
          this.length(this.prev[k], k) < this.arcEdge &&
          this.length(k, this.next[k]) < this.arcEdge
        return gentle ? Math.sign(t) : 0
      })
      const start = sign.findIndex((s) => s === 0)
      const runs: number[][] = []
      if (start < 0) runs.push(ring)
      else {
        let run: number[] = []
        let runSign = 0
        const close = () => {
          if (run.length >= FACET.arcRun) runs.push(run)
          run = []
        }
        for (let step = 1; step <= m; step++) {
          const k = (start + step) % m
          if (sign[k] === 0 || sign[k] !== runSign) close()
          runSign = sign[k]
          if (sign[k] !== 0) run.push(ring[k])
        }
        close()
      }
      for (const run of runs) {
        // The weakest corner of the run that may go.
        const order = run
          .filter((k) => this.alive[k])
          .map((k) => ({
            k,
            area: Math.abs(
              cross(
                this.x[this.prev[k]],
                this.y[this.prev[k]],
                this.x[k],
                this.y[k],
                this.x[this.next[k]],
                this.y[this.next[k]],
              ),
            ),
          }))
          .sort((a, b) => a.area - b.area || a.k - b.k)
        for (const { k } of order) {
          if (this.replaceable([k], null)) {
            this.replace([k], null)
            removed = true
            break
          }
        }
      }
    }
    return removed
  }

  /**
   * True when the path from the vertex before `gone` (one or two vertices in a row) to the one after may be replaced
   * by a straight edge, or with `via` by two edges through it, keeping the outlines valid: the ring keeps at least three
   * vertices and its direction and turns back nowhere; no vertex lies in the region between the old path and the new;
   * and within the clearance of any other edge, the new path comes no closer than the old one was (marching squares can
   * trace two loops closer than that).
   */
  private replaceable(gone: readonly number[], via: Point | null): boolean {
    const r = this.ring[gone[0]]
    if (this.count[r] - gone.length + (via ? 1 : 0) < 3) return false
    const { x, y } = this
    const p = this.prev[gone[0]]
    const n = this.next[gone[gone.length - 1]]
    const at = (k: number): Point => ({ x: x[k], y: y[k] })
    const region = [at(p), ...gone.map(at), at(n), ...(via ? [via] : [])]
    const area = this.area[r] - signedArea(region)
    if (Math.sign(area) !== Math.sign(this.area[r]) || Math.abs(area) < 1e-9) return false
    // No spike: the new path must not double back on itself or along its neighbours.
    const path = [at(this.prev[p]), at(p), ...(via ? [via] : []), at(n), at(this.next[n])]
    for (let k = 1; k < path.length - 1; k++)
      if (foldsBack(path[k - 1].x, path[k - 1].y, path[k].x, path[k].y, path[k + 1].x, path[k + 1].y)) return false
    const old = [at(p), ...gone.map(at), at(n)]
    const fresh = path.slice(1, -1)
    const distance = (line: Point[], ax: number, ay: number, bx: number, by: number) => {
      let d = Infinity
      for (let k = 0; k + 1 < line.length; k++)
        d = Math.min(d, segmentDistance(line[k].x, line[k].y, line[k + 1].x, line[k + 1].y, ax, ay, bx, by))
      return d
    }
    const c = this.clearance
    const box = bounds([region])!
    const visit = ++this.visit
    const i0 = Math.max(0, Math.floor((box.minX - c) / this.size) - this.bx0)
    const i1 = Math.min(this.bw - 1, Math.floor((box.maxX + c) / this.size) - this.bx0)
    const j0 = Math.max(0, Math.floor((box.minY - c) / this.size) - this.by0)
    const j1 = Math.min(this.bh - 1, Math.floor((box.maxY + c) / this.size) - this.by0)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const bucket = this.buckets[j * this.bw + i]
        if (!bucket) continue
        for (let k = 0; k < bucket.length; k += 2) {
          const e = bucket[k]
          if (!this.alive[e] || this.edgeVersion[e] !== bucket[k + 1] || this.seen[e] === visit) continue
          this.seen[e] = visit
          // The edges that are replaced.
          if (e === p || gone.includes(e)) continue
          const f = this.next[e]
          // The new path's neighbours (checked for folding back above): their far ends, and with `via`, the new edge
          // they do not share an end with, which could otherwise cross them in a bow tie.
          if (e === n || f === p) {
            const far = e === n ? f : e
            if (far !== p && far !== n && insideRing(at(far), region)) return false
            if (via) {
              const end = e === n ? at(p) : at(n)
              if (segmentDistance(end.x, end.y, via.x, via.y, x[e], y[e], x[f], y[f]) < c) return false
            }
            continue
          }
          if (insideRing(at(e), region)) return false
          const near = distance(fresh, x[e], y[e], x[f], y[f])
          if (near < c && (near <= 0 || near < distance(old, x[e], y[e], x[f], y[f]))) return false
        }
      }
    }
    return true
  }

  /** Replaces the path through `gone` by a straight edge, or by two through `via` (see replaceable). */
  private replace(gone: readonly number[], via: Point | null) {
    const { x, y } = this
    const p = this.prev[gone[0]]
    const n = this.next[gone[gone.length - 1]]
    const r = this.ring[p]
    const at = (k: number): Point => ({ x: x[k], y: y[k] })
    this.area[r] -= signedArea([at(p), ...gone.map(at), at(n), ...(via ? [via] : [])])
    // With `via`, the first vertex that goes is moved there instead.
    const kept = via ? gone[0] : -1
    for (const k of gone) {
      if (k === kept) continue
      this.alive[k] = 0
      this.count[r]--
      if (this.head[r] === k) this.head[r] = n
    }
    if (via) {
      x[kept] = via.x
      y[kept] = via.y
      this.next[p] = kept
      this.prev[kept] = p
      this.next[kept] = n
      this.prev[n] = kept
    } else {
      this.next[p] = n
      this.prev[n] = p
    }
    for (const k of via ? [p, kept] : [p]) {
      this.edgeVersion[k]++
      this.addEdge(k)
    }
    for (const k of via ? [p, kept, n] : [p, n]) {
      this.version[k]++
      this.push(k)
    }
  }

  /** Where the edges before `a` and after `b` meet when extended, if that is within a short edge of the edge a-b. */
  private corner(a: number, b: number): Point | null {
    const { x, y } = this
    const p = this.prev[a]
    const n = this.next[b]
    const ux = x[a] - x[p]
    const uy = y[a] - y[p]
    const wx = x[b] - x[n]
    const wy = y[b] - y[n]
    const d = ux * wy - uy * wx
    if (Math.abs(d) < 1e-12) return null
    const t = ((x[n] - x[p]) * wy - (y[n] - y[p]) * wx) / d
    const at = { x: x[p] + t * ux, y: y[p] + t * uy }
    const mx = (x[a] + x[b]) / 2
    const my = (y[a] + y[b]) / 2
    return t > 0 && Math.hypot(at.x - mx, at.y - my) < this.minEdge ? at : null
  }

  private addEdge(a: number) {
    const b = this.next[a]
    const i0 = Math.floor(Math.min(this.x[a], this.x[b]) / this.size) - this.bx0
    const i1 = Math.floor(Math.max(this.x[a], this.x[b]) / this.size) - this.bx0
    const j0 = Math.floor(Math.min(this.y[a], this.y[b]) / this.size) - this.by0
    const j1 = Math.floor(Math.max(this.y[a], this.y[b]) / this.size) - this.by0
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.bw + i
        ;(this.buckets[k] ??= []).push(a, this.edgeVersion[a])
      }
    }
  }

  private length(a: number, b: number): number {
    return Math.hypot(this.x[b] - this.x[a], this.y[b] - this.y[a])
  }

  /** How far the ring turns at v, in degrees: positive to the left. */
  private turn(v: number): number {
    const p = this.prev[v]
    const n = this.next[v]
    const ux = this.x[v] - this.x[p]
    const uy = this.y[v] - this.y[p]
    const vx = this.x[n] - this.x[v]
    const vy = this.y[n] - this.y[v]
    return (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI
  }
}

/** A binary min-heap of (key, vertex, version). */
class Heap {
  private keys: number[] = []
  private items: number[] = []
  private versions: number[] = []

  push(key: number, item: number, version: number) {
    let i = this.keys.length
    this.keys.push(key)
    this.items.push(item)
    this.versions.push(version)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.less(parent, i)) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): [number, number, number] | null {
    const n = this.keys.length
    if (n === 0) return null
    const top: [number, number, number] = [this.keys[0], this.items[0], this.versions[0]]
    this.swap(0, n - 1)
    this.keys.pop()
    this.items.pop()
    this.versions.pop()
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let smallest = i
      if (l < n - 1 && this.less(l, smallest)) smallest = l
      if (r < n - 1 && this.less(r, smallest)) smallest = r
      if (smallest === i) break
      this.swap(i, smallest)
      i = smallest
    }
    return top
  }

  /** Ties go to the lower vertex, so the order never depends on how the heap was filled. */
  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.items[a] < this.items[b])
  }

  private swap(a: number, b: number) {
    ;[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]
    ;[this.items[a], this.items[b]] = [this.items[b], this.items[a]]
    ;[this.versions[a], this.versions[b]] = [this.versions[b], this.versions[a]]
  }
}

// ---- Noise ----

/** The 16 gradient directions of the noise. */
const GX = Float64Array.from({ length: 16 }, (_, i) => Math.cos((i / 16) * 2 * Math.PI))
const GY = Float64Array.from({ length: 16 }, (_, i) => Math.sin((i / 16) * 2 * Math.PI))

/** Seeded gradient noise (Perlin's), roughly in [-0.7, 0.7], repeating every 256 units. Its lattice is shuffled by the seed. */
class GradientNoise {
  private readonly perm = new Uint8Array(512)

  constructor(seed: number, channel: number) {
    const order = Array.from({ length: 256 }, (_, i) => i)
    for (let i = 255; i > 0; i--) {
      const j = hashInts(seed, channel, i) % (i + 1)
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (let i = 0; i < 512; i++) this.perm[i] = order[i & 255]
  }

  at(x: number, y: number): number {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const perm = this.perm
    const a = perm[x0 & 255] + (y0 & 255)
    const b = perm[(x0 + 1) & 255] + (y0 & 255)
    const g00 = perm[a] & 15
    const g01 = perm[a + 1] & 15
    const g10 = perm[b] & 15
    const g11 = perm[b + 1] & 15
    const d00 = GX[g00] * fx + GY[g00] * fy
    const d10 = GX[g10] * (fx - 1) + GY[g10] * fy
    const d01 = GX[g01] * fx + GY[g01] * (fy - 1)
    const d11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1)
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    return d00 + (d10 - d00) * u + (d01 - d00) * v + (d00 - d10 - d01 + d11) * u * v
  }
}

// ---- Helpers ----

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function bounds(contours: readonly (readonly Point[])[]): Box | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of contours) {
    for (const p of c) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  return Number.isFinite(minX) && Number.isFinite(minY) ? { minX, minY, maxX, maxY } : null
}

function perimeter(contours: readonly (readonly Point[])[]): number {
  let total = 0
  for (const c of contours)
    for (let i = 0; i < c.length; i++)
      total += Math.hypot(c[(i + 1) % c.length].x - c[i].x, c[(i + 1) % c.length].y - c[i].y)
  return total
}

const countVertices = (loops: readonly Point[][]) => loops.reduce((n, loop) => n + loop.length, 0)

/** Twice the signed area of the triangle a, b, c: positive when it turns left. */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/** The distance between the segments a–b and c–d (0 when they cross). */
function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const d1 = cross(ax, ay, bx, by, cx, cy)
  const d2 = cross(ax, ay, bx, by, dx, dy)
  const d3 = cross(cx, cy, dx, dy, ax, ay)
  const d4 = cross(cx, cy, dx, dy, bx, by)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(
    pointSegment(cx, cy, ax, ay, bx, by),
    pointSegment(dx, dy, ax, ay, bx, by),
    pointSegment(ax, ay, cx, cy, dx, dy),
    pointSegment(bx, by, cx, cy, dx, dy),
  )
}

function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax
  const ey = by - ay
  const length2 = ex * ex + ey * ey
  const t = length2 > 0 ? clamp(((px - ax) * ex + (py - ay) * ey) / length2, 0, 1) : 0
  return Math.hypot(ax + t * ex - px, ay + t * ey - py)
}

/** True when the path a → b → c turns back on itself (by nearly 180°). */
function foldsBack(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const ux = bx - ax
  const uy = by - ay
  const vx = cx - bx
  const vy = cy - by
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) > (175 * Math.PI) / 180
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
