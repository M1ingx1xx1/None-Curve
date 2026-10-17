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
