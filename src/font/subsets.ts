// A Google font in every subset: Google serves each subset (latin, latin-ext, cyrillic, …) as a file of its own, so
// "All" downloads them all and bundles them into one byte array (the font's bytes, which the geometry and font export
// workers parse themselves). Parsed, they become one font: glyph indices run through the subsets in turn, each
// character comes from the first subset that maps it, and a line is shaped in runs of the subset that owns each
// character, so kerning applies within a subset, not across two.

import type { GlyphRef, SourceGlyph } from '../geometry/types'
import type { KernLookup, KernSubtable, LoadedFont, ShapedGlyph, SourceKerning } from './model'

/** "NCSB" (None-Curve subset bundle), then the file count and each file's length as 32-bit big-endian numbers. */
const MAGIC = [0x4e, 0x43, 0x53, 0x42]

export function bundleSubsets(files: Uint8Array[]): Uint8Array {
  const header = 8 + 4 * files.length
  const out = new Uint8Array(header + files.reduce((n, f) => n + f.byteLength, 0))
  const view = new DataView(out.buffer)
  out.set(MAGIC)
  view.setUint32(4, files.length)
  let at = header
  files.forEach((file, i) => {
    view.setUint32(8 + 4 * i, file.byteLength)
    out.set(file, at)
    at += file.byteLength
  })
  return out
}

/** The files of a bundle, or null when `bytes` is not one. */
export function unbundleSubsets(bytes: Uint8Array): Uint8Array[] | null {
  if (bytes.byteLength < 8 || MAGIC.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(4)
  let at = 8 + 4 * count
  if (count === 0 || at > bytes.byteLength) return null
  const files: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const length = view.getUint32(8 + 4 * i)
    if (at + length > bytes.byteLength) return null
    files.push(bytes.subarray(at, at + length))
    at += length
  }
  return files
}

/** Combining marks join the run before them when its subset has them, so they sit on their letter. */
const MARK = /\p{M}/u

/** One font from the subsets' fonts, the first being the main one (its names, metrics and axes are the font's). */
export function composeSubsets(parts: LoadedFont[], bytes: Uint8Array, id: string): LoadedFont {
  const [main] = parts
  const offsets: number[] = []
  let count = 0
  for (const part of parts) {
    offsets.push(count)
    count += part.glyphCount
  }
  /** The part a composed glyph index belongs to, and its index there. */
  const locate = (index: number): [number, number] => {
    let p = parts.length - 1
    while (p > 0 && index < offsets[p]) p--
    return [p, index - offsets[p]]
  }
  const owner = (cp: number) => {
    const p = parts.findIndex((part) => part.hasCharacter(cp))
    return p < 0 ? 0 : p
  }

  const byCodePoint = new Map<number, GlyphRef>()
  parts.forEach((part, p) => {
    for (const ref of part.characters)
      if (!byCodePoint.has(ref.unicode!)) byCodePoint.set(ref.unicode!, { ...ref, index: ref.index + offsets[p] })
  })
  const characters = [...byCodePoint.values()].sort((a, b) => a.unicode! - b.unicode!)

  let allGlyphs: GlyphRef[] | null = null
  let kerning: SourceKerning | null | undefined
  const outlines = new Map<number, SourceGlyph>()

  const build = (fonts: LoadedFont[]): Pick<LoadedFont, 'shapeLine' | 'getGlyph' | 'getPreviewPath'> => ({
    shapeLine(text) {
      const chars = [...text]
      const out: ShapedGlyph[] = []
      let start = 0
      while (start < chars.length) {
        const p = owner(chars[start].codePointAt(0)!)
        let end = start + 1
        for (; end < chars.length; end++) {
          const cp = chars[end].codePointAt(0)!
          if (owner(cp) !== p && !(MARK.test(chars[end]) && parts[p].hasCharacter(cp))) break
        }
        for (const glyph of fonts[p].shapeLine(chars.slice(start, end).join('')))
          out.push({ ...glyph, index: glyph.index + offsets[p] })
        start = end
      }
      return out
    },
    getGlyph(index) {
      const [p, local] = locate(index)
      const glyph = fonts[p].getGlyph(local)
      return { ...glyph, ref: { ...glyph.ref, index } }
    },
    getPreviewPath(index) {
      const [p, local] = locate(index)
      return fonts[p].getPreviewPath(local)
    },
  })
  const own = build(parts)

  const font: LoadedFont = {
    ...main,
    id,
    bytes,
    faces: null,
    face: null,
    glyphCount: count,
    characters,
    listAllGlyphs() {
      allGlyphs ??= parts.flatMap((part, p) =>
        part.listAllGlyphs().map((ref) => ({ ...ref, index: ref.index + offsets[p] })),
      )
      return allGlyphs
    },
    hasCharacter: (cp) => parts.some((part) => part.hasCharacter(cp)),
    hasKerning: parts.some((part) => part.hasKerning),
    kerning() {
      if (kerning === undefined)
        kerning = mergeKerning(
          parts.map((part) => part.kerning()),
          offsets,
        )
      return kerning
    },
    shapeLine: own.shapeLine,
    getGlyph(index) {
      let outline = outlines.get(index)
      if (!outline) outlines.set(index, (outline = own.getGlyph(index)))
      return outline
    },
    getPreviewPath: own.getPreviewPath,
  }
  delete font.at
  // A variable file weighted on load: each part at the same axis values, kept per set of values like the parts.
  if (parts.every((part) => part.at)) {
    const made = new Map<string, LoadedFont>()
    font.at = (coords) => {
      const instances = parts.map((part) => part.at!(coords))
      if (instances.every((instance, p) => instance === parts[p])) return font
      const key = instances.map((instance) => JSON.stringify(instance.instance)).join('|')
      let instance = made.get(key)
      if (!instance) {
        instance = { ...font, ...build(instances), instance: instances[0].instance }
        delete instance.at
        if (made.size >= 24) made.delete(made.keys().next().value!)
        made.set(key, instance)
      }
      return instance
    }
  }
  return font
}

/** The parts' kerning in one: their lookups after one another, glyph indices moved by each part's offset. */
function mergeKerning(parts: (SourceKerning | null)[], offsets: number[]): SourceKerning | null {
  if (parts.every((k) => k === null)) return null
  const lookups: KernLookup[] = []
  const scripts = new Map<string, number[]>()
  parts.forEach((kerning, p) => {
    if (!kerning) return
    const base = lookups.length
    const shift = offsets[p]
    for (const lookup of kerning.lookups)
      lookups.push({ flags: lookup.flags, subtables: lookup.subtables.map((s) => shiftSubtable(s, shift)) })
    for (const { tag, lookups: used } of kerning.scripts) {
      const list = scripts.get(tag) ?? []
      list.push(...used.map((i) => i + base))
      scripts.set(tag, list)
    }
  })
  return {
    scripts: [...scripts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tag, used]) => ({ tag, lookups: used })),
    lookups,
  }
}

function shiftSubtable(subtable: KernSubtable, shift: number): KernSubtable {
  const keys = <V>(map: Map<number, V>) => new Map([...map].map(([k, v]) => [k + shift, v]))
  if (subtable.format === 1)
    return { format: 1, pairs: new Map([...subtable.pairs].map(([first, seconds]) => [first + shift, keys(seconds)])) }
  return {
    format: 2,
    coverage: new Set([...subtable.coverage].map((g) => g + shift)),
    classDef1: keys(subtable.classDef1),
    classDef2: keys(subtable.classDef2),
    values: subtable.values,
  }
}
