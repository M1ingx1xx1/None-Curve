// WOFF2 → TrueType. fontkit reads WOFF2 files but cannot apply variations to them (it decodes the
// compressed glyph table up front, without the variation data), so a variable WOFF2 is first turned
// back into an ordinary TrueType file, which fontkit can instance at any axis value. The glyph table
// is rebuilt from fontkit's decoded glyphs (points, flags, components; hinting instructions are left
// out); every other table is copied as it is. No React, no DOM.

import { writeTables } from '../export/sfnt'

/** The parts of fontkit's WOFF2Font this relies on (not in its public types). */
interface Woff2Internals {
  type: string
  numGlyphs: number
  directory: { flavor: number; tables: Record<string, { tag: string; offset: number; length: number; transformed: boolean }> }
  stream: { buffer: Uint8Array }
  _decompress(): void
  _transformGlyfTable(): void
  _transformedGlyphs: DecodedGlyph[]
}

interface DecodedPoint {
  x: number
  y: number
  onCurve: boolean
  endContour: boolean
}

interface DecodedComponent {
  glyphID: number
  dx: number
  dy: number
  scaleX: number
  scaleY: number
  scale01: number
  scale10: number
}

interface DecodedGlyph {
  numberOfContours: number
  points?: DecodedPoint[]
  components?: DecodedComponent[]
}

/**
 * The font as TrueType bytes, or null when it is not a TrueType-flavoured WOFF2 that can be rebuilt
 * (for example when its hmtx table is transformed, which fontkit cannot read either).
 */
export function woff2ToTrueType(font: unknown): Uint8Array | null {
  const woff2 = font as Woff2Internals
  if (woff2.type !== 'WOFF2') return null
  const entries = woff2.directory.tables
  if (!entries.glyf || !entries.loca) return null
  if (Object.values(entries).some((e) => e.transformed && e.tag !== 'glyf' && e.tag !== 'loca')) return null

  woff2._decompress()
  const data = woff2.stream.buffer
  const tables = new Map<string, Uint8Array>()
  for (const entry of Object.values(entries)) {
    if (entry.tag === 'glyf' || entry.tag === 'loca') continue
    tables.set(entry.tag, data.slice(entry.offset, entry.offset + entry.length))
  }
  const head = tables.get('head')
  if (!head) return null

  if (entries.glyf.transformed) woff2._transformGlyfTable()
  const glyphs = woff2._transformedGlyphs
  if (!glyphs) return null
  const boxes = new Map<number, Box | null>()
  const boxOf = (id: number): Box | null => {
    if (!boxes.has(id)) {
      boxes.set(id, null) // guards against component cycles
      boxes.set(id, glyphBox(glyphs[id], boxOf))
    }
    return boxes.get(id)!
  }

  const parts = glyphs.map((glyph, id) => encodeGlyph(glyph, boxOf(id)))
  const loca = new DataView(new ArrayBuffer((parts.length + 1) * 4))
  let offset = 0
  parts.forEach((part, i) => {
    loca.setUint32(i * 4, offset)
    offset += part.length
  })
  loca.setUint32(parts.length * 4, offset)
  const glyf = new Uint8Array(offset)
  offset = 0
  for (const part of parts) {
    glyf.set(part, offset)
    offset += part.length
  }
  tables.set('glyf', glyf)
  tables.set('loca', new Uint8Array(loca.buffer))
  // The rebuilt loca uses 32-bit offsets.
  const headCopy = head.slice()
  new DataView(headCopy.buffer).setInt16(50, 1)
  tables.set('head', headCopy)
  return new Uint8Array(writeTables(0x00010000, tables))
}

interface Box {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

function glyphBox(glyph: DecodedGlyph | undefined, boxOf: (id: number) => Box | null): Box | null {
  if (!glyph || glyph.numberOfContours === 0) return null
  const box: Box = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
  const add = (x: number, y: number) => {
    box.xMin = Math.min(box.xMin, x)
    box.yMin = Math.min(box.yMin, y)
    box.xMax = Math.max(box.xMax, x)
    box.yMax = Math.max(box.yMax, y)
  }
  if (glyph.numberOfContours > 0) {
    for (const p of glyph.points ?? []) add(p.x, p.y)
  } else {
    for (const c of glyph.components ?? []) {
      const inner = boxOf(c.glyphID)
      if (!inner) continue
      for (const [x, y] of [
        [inner.xMin, inner.yMin],
        [inner.xMin, inner.yMax],
        [inner.xMax, inner.yMin],
        [inner.xMax, inner.yMax],
      ]) {
        add(x * c.scaleX + y * c.scale01 + c.dx, y * c.scaleY + x * c.scale10 + c.dy)
      }
    }
  }
  return Number.isFinite(box.xMin) ? box : null
}

const ON_CURVE = 0x01
const ARG_1_AND_2_ARE_WORDS = 0x0001
const ARGS_ARE_XY_VALUES = 0x0002
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const WE_HAVE_A_TWO_BY_TWO = 0x0080

/** One glyf entry, padded to 4 bytes; an empty glyph is zero bytes. */
function encodeGlyph(glyph: DecodedGlyph | undefined, box: Box | null): Uint8Array {
  if (!glyph || glyph.numberOfContours === 0 || !box) return new Uint8Array(0)
  const bytes: number[] = []
  const u16 = (v: number) => bytes.push((v >> 8) & 0xff, v & 0xff)
  const i16 = (v: number) => u16(Math.round(v) & 0xffff)
  const f2dot14 = (v: number) => u16(Math.round(v * 16384) & 0xffff)
  i16(glyph.numberOfContours > 0 ? glyph.numberOfContours : -1)
  i16(Math.floor(box.xMin))
  i16(Math.floor(box.yMin))
  i16(Math.ceil(box.xMax))
  i16(Math.ceil(box.yMax))

  if (glyph.numberOfContours > 0) {
    const points = glyph.points ?? []
    points.forEach((p, i) => {
      if (p.endContour) u16(i)
    })
    u16(0) // no instructions
    for (const p of points) bytes.push(p.onCurve ? ON_CURVE : 0)
    let last = 0
    for (const p of points) {
      i16(p.x - last)
      last = p.x
    }
    last = 0
    for (const p of points) {
      i16(p.y - last)
      last = p.y
    }
  } else {
    const components = glyph.components ?? []
    components.forEach((c, i) => {
      let flags = ARG_1_AND_2_ARE_WORDS | ARGS_ARE_XY_VALUES
      if (i < components.length - 1) flags |= MORE_COMPONENTS
      const twoByTwo = c.scale01 !== 0 || c.scale10 !== 0
      if (twoByTwo) flags |= WE_HAVE_A_TWO_BY_TWO
      else if (c.scaleX !== c.scaleY) flags |= WE_HAVE_AN_X_AND_Y_SCALE
      else if (c.scaleX !== 1) flags |= WE_HAVE_A_SCALE
      u16(flags)
      u16(c.glyphID)
      i16(c.dx)
      i16(c.dy)
      if (twoByTwo) [c.scaleX, c.scale01, c.scale10, c.scaleY].forEach(f2dot14)
      else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) [c.scaleX, c.scaleY].forEach(f2dot14)
      else if (flags & WE_HAVE_A_SCALE) f2dot14(c.scaleX)
    })
  }
  while (bytes.length % 4) bytes.push(0)
  return new Uint8Array(bytes)
}
