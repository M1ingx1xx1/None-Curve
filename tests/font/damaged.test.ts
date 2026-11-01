// Damaged font files (src/font/parse.ts): a file missing a table the app reads, an axis without a name, or a nonsense
// em size fails to open with the usual "could not be read" message, not a raw error from deep inside the parser.

import { describe, expect, it } from 'vitest'
import { FontLoadError } from '../../src/font/errors'
import { parseFont } from '../../src/font/parse'
import { fixtureBytes, localSource } from '../helpers/fonts'
import { table, tableDirectory } from '../helpers/sfnt'

/** Roboto with `change` applied to a copy of its bytes. */
function damaged(change: (bytes: Uint8Array) => void): Uint8Array {
  const bytes = fixtureBytes('Roboto').slice()
  change(bytes)
  return bytes
}

/** Renames the table `tag` in the directory, so the parser finds no table of that name. */
const hide = (tag: string) => (bytes: Uint8Array) => {
  for (let k = 0; k < tableDirectory(bytes).size; k++) {
    const record = 12 + 16 * k
    if (String.fromCharCode(...bytes.subarray(record, record + 4)) === tag) bytes.set([0x78, 0x78, 0x78, 0x78], record)
  }
}

const unitsPerEm = (value: number) => (bytes: Uint8Array) => table(bytes, 'head')!.setUint16(18, value)

/** Points the first variation axis at a name the name table does not have. */
const unnamedAxis = (bytes: Uint8Array) => {
  const fvar = table(bytes, 'fvar')!
  fvar.setUint16(fvar.getUint16(4) + 18, 0xfff0)
}

const open = (bytes: Uint8Array) => parseFont(bytes, localSource('Damaged.ttf', bytes), new AbortController().signal)

describe('damaged font files', () => {
  it.each([
    ['no hhea table', hide('hhea')],
    ['an unnamed variation axis', unnamedAxis],
    ['unitsPerEm 0', unitsPerEm(0)],
  ])('%s: could not be read, the file may be damaged', async (_, change) => {
    const result = open(damaged(change))
    await expect(result).rejects.toBeInstanceOf(FontLoadError)
    await expect(result).rejects.toThrow(/could not be read .*The file may be damaged\./)
  })
})
