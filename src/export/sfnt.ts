// Small edits to a finished OpenType file: fields the font writer (opentype.js) always fills in
// itself. The file is split into its tables, the tables are edited, and the file is put back
// together with fresh table checksums and head.checkSumAdjustment. No React, no DOM.

export interface FontPatch {
  /** hhea.lineGap. */
  lineGap: number
  /** head.macStyle (bold, italic, …). */
  macStyle: number
  /** The CFF FontBBox: the union of every glyph's bounds (xMin, yMin, xMax, yMax). */
  fontBBox: [number, number, number, number]
}

export function patchFont(bytes: ArrayBuffer, patch: FontPatch): ArrayBuffer {
  const { flavor, tables } = readTables(bytes)
  const edit = (tag: string, change: (view: DataView, data: Uint8Array) => Uint8Array | void) => {
    const data = tables.get(tag)
    if (!data) throw new Error(`the ${tag.trim()} table is missing`)
    const copy = data.slice()
    tables.set(tag, change(new DataView(copy.buffer), copy) ?? copy)
  }
  edit('hhea', (view) => view.setInt16(8, patch.lineGap))
  edit('head', (view) => view.setUint16(44, patch.macStyle))
  edit('CFF ', (_, data) => setCffFontBBox(data, patch.fontBBox))
  return writeTables(flavor, tables)
}

function readTables(bytes: ArrayBuffer): { flavor: number; tables: Map<string, Uint8Array> } {
  const view = new DataView(bytes)
  const flavor = view.getUint32(0)
  const count = view.getUint16(4)
  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    const tag = String.fromCharCode(...new Uint8Array(bytes, record, 4))
    const offset = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    tables.set(tag, new Uint8Array(bytes, offset, length).slice())
  }
  return { flavor, tables }
}

function checksum(data: Uint8Array): number {
  const padded = new Uint8Array((data.length + 3) & ~3)
  padded.set(data)
  const view = new DataView(padded.buffer)
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0
  return sum
}

export function writeTables(flavor: number, tables: Map<string, Uint8Array>): ArrayBuffer {
  const tags = [...tables.keys()].sort()
  const count = tags.length
  const maxPower = 2 ** Math.floor(Math.log2(count))
  let size = 12 + count * 16
  const offsets = tags.map((tag) => {
    const offset = size
    size += (tables.get(tag)!.length + 3) & ~3
    return offset
  })
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, flavor)
  view.setUint16(4, count)
  view.setUint16(6, maxPower * 16)
  view.setUint16(8, Math.log2(maxPower))
  view.setUint16(10, count * 16 - maxPower * 16)
  tags.forEach((tag, i) => {
    const data = tables.get(tag)!
    if (tag === 'head') new DataView(data.buffer, data.byteOffset).setUint32(8, 0) // checkSumAdjustment
    const record = 12 + i * 16
    for (let k = 0; k < 4; k++) out[record + k] = tag.charCodeAt(k)
    view.setUint32(record + 4, checksum(data))
    view.setUint32(record + 8, offsets[i])
    view.setUint32(record + 12, data.length)
    out.set(data, offsets[i])
  })
  const head = tags.indexOf('head')
  if (head >= 0) view.setUint32(offsets[head] + 8, (0xb1b0afba - checksum(out)) >>> 0)
  return out.buffer
}

// ---- CFF ----

/** An INDEX at `offset`: where its data starts and where the whole INDEX ends. */
function readIndex(data: Uint8Array, offset: number): { count: number; offSize: number; offsets: number[]; dataStart: number; end: number } {
  const count = (data[offset] << 8) | data[offset + 1]
  if (count === 0) return { count, offSize: 0, offsets: [], dataStart: offset + 2, end: offset + 2 }
  const offSize = data[offset + 2]
  const offsets: number[] = []
  for (let i = 0; i <= count; i++) {
    let value = 0
    for (let k = 0; k < offSize; k++) value = value * 256 + data[offset + 3 + i * offSize + k]
    offsets.push(value)
  }
  const dataStart = offset + 3 + (count + 1) * offSize - 1
  return { count, offSize, offsets, dataStart, end: dataStart + offsets[count] }
}

interface DictEntry {
  operator: number[]
  /** Operand bytes as stored, kept for entries that are not rewritten. */
  raw: number[]
  operands: number[]
}

/** Splits a DICT into entries. Integer operands are decoded; reals are kept only as raw bytes. */
function readDict(bytes: Uint8Array): DictEntry[] {
  const entries: DictEntry[] = []
  let raw: number[] = []
  let operands: number[] = []
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]
    if (b <= 21) {
      const operator = b === 12 ? [b, bytes[i + 1]] : [b]
      entries.push({ operator, raw, operands })
      raw = []
      operands = []
      i += operator.length
    } else if (b === 28) {
      raw.push(...bytes.slice(i, i + 3))
      operands.push(((bytes[i + 1] << 8) | bytes[i + 2]) << 16 >> 16)
      i += 3
    } else if (b === 29) {
      raw.push(...bytes.slice(i, i + 5))
      operands.push((bytes[i + 1] << 24) | (bytes[i + 2] << 16) | (bytes[i + 3] << 8) | bytes[i + 4])
      i += 5
    } else if (b === 30) {
      // Real number: nibbles until one is 0xf.
      let end = i + 1
      while (end < bytes.length && (bytes[end] & 0x0f) !== 0x0f && (bytes[end] >> 4) !== 0x0f) end++
      raw.push(...bytes.slice(i, end + 1))
      operands.push(NaN)
      i = end + 1
    } else if (b >= 32 && b <= 246) {
      raw.push(b)
      operands.push(b - 139)
      i += 1
    } else if (b >= 247 && b <= 250) {
      raw.push(b, bytes[i + 1])
      operands.push((b - 247) * 256 + bytes[i + 1] + 108)
      i += 2
    } else if (b >= 251 && b <= 254) {
      raw.push(b, bytes[i + 1])
      operands.push(-(b - 251) * 256 - bytes[i + 1] - 108)
      i += 2
    } else {
      throw new Error(`unexpected byte ${b} in a CFF DICT`)
    }
  }
  return entries
}

/** A whole number in the shortest DICT form, or always the five-byte form (stable length, for offsets). */
function encodeInteger(value: number, fixedWidth = false): number[] {
  if (!fixedWidth) {
    if (value >= -107 && value <= 107) return [value + 139]
    if (value >= 108 && value <= 1131) return [((value - 108) >> 8) + 247, (value - 108) & 0xff]
    if (value >= -1131 && value <= -108) return [((-value - 108) >> 8) + 251, (-value - 108) & 0xff]
    if (value >= -32768 && value <= 32767) return [28, (value >> 8) & 0xff, value & 0xff]
  }
  return [29, (value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

const FONT_BBOX = 5
const CHARSET = 15
const ENCODING = 16
const CHAR_STRINGS = 17
const PRIVATE = 18

/**
 * Replaces the Top DICT's FontBBox. The Top DICT may change length, which moves everything after it,
 * so the offsets it holds (charset, encoding, CharStrings, Private) move by the same amount.
 */
function setCffFontBBox(cff: Uint8Array, bbox: [number, number, number, number]): Uint8Array {
  const names = readIndex(cff, cff[2])
  const top = readIndex(cff, names.end)
  if (top.count !== 1) throw new Error('expected one font in the CFF table')
  const dict = readDict(cff.slice(top.dataStart + top.offsets[0], top.dataStart + top.offsets[1]))
  if (!dict.some((e) => e.operator[0] === FONT_BBOX && e.operator.length === 1)) dict.unshift({ operator: [FONT_BBOX], raw: [], operands: [] })

  const encode = (shift: number) =>
    dict.flatMap((e) => {
      const op = e.operator.length === 1 ? e.operator[0] : -1
      if (op === FONT_BBOX) return [...bbox.flatMap((v) => encodeInteger(Math.round(v))), ...e.operator]
      if (op === CHARSET || op === CHAR_STRINGS || (op === ENCODING && e.operands[0] > 1)) {
        return [...encodeInteger(e.operands[0] + shift, true), ...e.operator]
      }
      if (op === PRIVATE) return [...encodeInteger(e.operands[0]), ...encodeInteger(e.operands[1] + shift, true), ...e.operator]
      return [...e.raw, ...e.operator]
    })

  const indexLength = (dataLength: number) => 2 + 1 + 2 * offSizeFor(dataLength + 1) + dataLength
  const shift = indexLength(encode(0).length) - (top.end - names.end)
  const data = encode(shift)
  const offSize = offSizeFor(data.length + 1)
  const index = [0, 1, offSize, ...bytesOf(1, offSize), ...bytesOf(data.length + 1, offSize), ...data]
  const out = new Uint8Array(names.end + index.length + (cff.length - top.end))
  out.set(cff.subarray(0, names.end))
  out.set(index, names.end)
  out.set(cff.subarray(top.end), names.end + index.length)
  return out
}

const offSizeFor = (value: number) => (value < 0x100 ? 1 : value < 0x10000 ? 2 : value < 0x1000000 ? 3 : 4)

function bytesOf(value: number, size: number): number[] {
  const out: number[] = []
  for (let k = size - 1; k >= 0; k--) out.push(Math.floor(value / 256 ** k) & 0xff)
  return out
}
