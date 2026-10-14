// Reading and wrapping font files at the byte level, apart from fontkit and opentype.js, so the tests check what
// is in the file rather than what a parser makes of it.

export interface TableRecord {
  offset: number
  length: number
}

/** The table directory of the font starting at `start` (0, or a face's offset in a collection), by tag. */
export function tableDirectory(bytes: Uint8Array, start = 0): Map<string, TableRecord> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(start + 4)
  const tables = new Map<string, TableRecord>()
  for (let k = 0; k < count; k++) {
    const record = start + 12 + 16 * k
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4))
    tables.set(tag, { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) })
  }
  return tables
}

/** A table's bytes as a DataView, or null when the font has none. */
export function table(bytes: Uint8Array, tag: string, start = 0): DataView | null {
  const record = tableDirectory(bytes, start).get(tag)
  return record ? new DataView(bytes.buffer, bytes.byteOffset + record.offset, record.length) : null
}

/** The file's first four bytes as text: 'OTTO' (CFF), '\0\x01\0\0' (TrueType), 'ttcf' (a collection). */
export const signature = (bytes: Uint8Array | ArrayBuffer) => String.fromCharCode(...(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).subarray(0, 4))

/**
 * A TrueType collection ('ttcf', version 1.0) of whole font files: each face's tables are copied as they are, after
 * the header, and the offsets in its table directory moved to where they now lie.
 */
export function makeCollection(fonts: readonly Uint8Array[]): Uint8Array {
  const pad = (n: number) => (n + 3) & ~3
  const header = pad(12 + 4 * fonts.length)
  const starts: number[] = []
  let size = header
  for (const font of fonts) {
    starts.push(size)
    size += pad(font.length)
  }
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  out.set([0x74, 0x74, 0x63, 0x66], 0) // 'ttcf'
  view.setUint32(4, 0x00010000)
  view.setUint32(8, fonts.length)
  fonts.forEach((font, k) => {
    const start = starts[k]
    view.setUint32(12 + 4 * k, start)
    out.set(font, start)
    const count = view.getUint16(start + 4)
    for (let t = 0; t < count; t++) {
      const at = start + 12 + 16 * t + 8
      view.setUint32(at, view.getUint32(at) + start)
    }
  })
  return out
}

// ---- CFF ----

/** The CFF table's bytes, or null when the font has none. */
function cffTable(bytes: Uint8Array): Uint8Array | null {
  const record = tableDirectory(bytes).get('CFF ')
  return record ? bytes.subarray(record.offset, record.offset + record.length) : null
}

/** An INDEX at `offset`: each item's bytes, and where the INDEX ends. */
function readIndex(cff: Uint8Array, offset: number): { items: Uint8Array[]; end: number } {
  const count = (cff[offset] << 8) | cff[offset + 1]
  if (count === 0) return { items: [], end: offset + 2 }
  const offSize = cff[offset + 2]
  const offsets: number[] = []
  for (let i = 0; i <= count; i++) {
    let value = 0
    for (let k = 0; k < offSize; k++) value = value * 256 + cff[offset + 3 + i * offSize + k]
    offsets.push(value)
  }
  const base = offset + 2 + (count + 1) * offSize
  return { items: offsets.slice(0, -1).map((start, i) => cff.subarray(base + start, base + offsets[i + 1])), end: base + offsets[count] }
}

/** The Top DICT's integer operands by operator (12 x as 1200 + x); real operands read as NaN. */
function topDict(cff: Uint8Array): Map<number, number[]> {
  const names = readIndex(cff, cff[2])
  const dict = readIndex(cff, names.end).items[0]
  const entries = new Map<number, number[]>()
  let operands: number[] = []
  for (let i = 0; i < dict.length; ) {
    const b = dict[i]
    if (b <= 21) {
      entries.set(b === 12 ? 1200 + dict[i + 1] : b, operands)
      operands = []
      i += b === 12 ? 2 : 1
    } else if (b === 28) {
      operands.push(((dict[i + 1] << 8) | dict[i + 2]) << 16 >> 16)
      i += 3
    } else if (b === 29) {
      operands.push((dict[i + 1] << 24) | (dict[i + 2] << 16) | (dict[i + 3] << 8) | dict[i + 4])
      i += 5
    } else if (b === 30) {
      while (i < dict.length && (dict[i] & 0x0f) !== 0x0f && dict[i] >> 4 !== 0x0f) i++
      operands.push(NaN)
      i++
    } else if (b <= 246) {
      operands.push(b - 139)
      i++
    } else if (b <= 250) {
      operands.push((b - 247) * 256 + dict[i + 1] + 108)
      i += 2
    } else {
      operands.push(-(b - 251) * 256 - dict[i + 1] - 108)
      i += 2
    }
  }
  return entries
}

/** The CFF Top DICT's FontBBox (xMin, yMin, xMax, yMax), or null when absent. */
export function cffFontBBox(bytes: Uint8Array): number[] | null {
  const cff = cffTable(bytes)
  return cff ? (topDict(cff).get(5) ?? null) : null
}

/**
 * The operators a straight-line outline needs (Type 2 charstrings), by number: how many operands each takes, and
 * whether it may come first and carry the advance width before them.
 */
const STRAIGHT_OPERATORS: Record<number, { name: string; takes: (n: number) => boolean; opens: boolean }> = {
  21: { name: 'rmoveto', takes: (n) => n === 2, opens: true },
  22: { name: 'hmoveto', takes: (n) => n === 1, opens: true },
  4: { name: 'vmoveto', takes: (n) => n === 1, opens: true },
  5: { name: 'rlineto', takes: (n) => n >= 2 && n % 2 === 0, opens: false },
  6: { name: 'hlineto', takes: (n) => n >= 1, opens: false },
  7: { name: 'vlineto', takes: (n) => n >= 1, opens: false },
  14: { name: 'endchar', takes: (n) => n === 0, opens: true },
}

/**
 * Walks every charstring in the CFF CharStrings INDEX, byte by byte, and lists whatever a font of straight outlines
 * should not hold: an operator other than the moves, lines and endchar (curves, hints, and subroutine calls, which
 * byte 29 is in a charstring, unlike in a DICT), a number in another form than a whole one of at most 16 bits, the
 * wrong count of operands, or bytes after endchar. Stands in for a font sanitiser, which the tests cannot run.
 */
export function charStringProblems(bytes: Uint8Array): string[] {
  const cff = cffTable(bytes)
  if (!cff) return ['no CFF table']
  const at = topDict(cff).get(17)?.[0]
  if (at === undefined) return ['no CharStrings offset in the Top DICT']
  const problems: string[] = []
  readIndex(cff, at).items.forEach((charString, glyph) => {
    let operands = 0
    let first = true
    let ended = false
    for (let i = 0; i < charString.length && problems.length < 20; ) {
      const b = charString[i]
      if (ended) {
        problems.push(`glyph ${glyph}: bytes after endchar`)
        break
      }
      if (b === 28) {
        operands++
        i += 3
      } else if (b >= 32 && b <= 246) {
        operands++
        i++
      } else if (b >= 247 && b <= 254) {
        operands++
        i += 2
      } else {
        const operator = STRAIGHT_OPERATORS[b]
        if (!operator) {
          problems.push(`glyph ${glyph}: ${b === 255 ? 'a fixed-point number' : `operator ${b === 12 ? `12 ${charString[i + 1]}` : b}`} at byte ${i}`)
          break
        }
        if (first && !operator.opens) problems.push(`glyph ${glyph}: starts with ${operator.name}`)
        else if (!operator.takes(operands) && !(first && operator.takes(operands - 1))) {
          problems.push(`glyph ${glyph}: ${operator.name} with ${operands} operands`)
        }
        first = false
        ended = b === 14
        operands = 0
        i++
      }
    }
    if (!ended && problems.length < 20) problems.push(`glyph ${glyph}: no endchar`)
  })
  return problems
}
