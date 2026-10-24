// Kerning for an exported font: the source's pair kerning cut down to the exported glyphs and written
// as a GPOS table (pair adjustment lookups under the kern feature), the subtables mirroring the source's
// so class kerning stays compact. Also the checks that the written table reads back the same.
// No React, no DOM.

import { pairKerning } from '../font/kerning'
import type { KernLookup, KernPairValue, KernSubtable, KernValue, SourceKerning } from '../font/model'

const ZERO_VALUE: KernValue = [0, 0, 0, 0]
const ZERO_PAIR: KernPairValue = [ZERO_VALUE, ZERO_VALUE]

/**
 * The kerning between exported glyphs, renumbered with `newGid` (source glyph → exported glyph), or
 * null if no pair is left. Every script keeps its record, so text picks the same script's kerning.
 */
export function exportKerning(kerning: SourceKerning, newGid: Map<number, number>): SourceKerning | null {
  const position = new Map<number, number>()
  const lookups: KernLookup[] = []
  kerning.lookups.forEach((lookup, i) => {
    const subtables = lookup.subtables.flatMap((s) => remapSubtable(s, newGid) ?? [])
    if (!subtables.length) return
    position.set(i, lookups.length)
    lookups.push({ flags: lookup.flags, subtables })
  })
  if (!lookups.length) return null
  return {
    scripts: kerning.scripts.map(({ tag, lookups: list }) => ({
      tag,
      lookups: list.flatMap((i) => position.get(i) ?? []),
    })),
    lookups,
  }
}

function remapSubtable(subtable: KernSubtable, newGid: Map<number, number>): KernSubtable | null {
  if (subtable.format === 1) {
    // Pairs with a zero value stay: a pair found here stops the later subtables.
    const pairs = new Map<number, Map<number, KernPairValue>>()
    for (const [first, seconds] of subtable.pairs) {
      const a = newGid.get(first)
      if (a === undefined) continue
      const row = new Map<number, KernPairValue>()
      for (const [second, value] of seconds) {
        const b = newGid.get(second)
        if (b !== undefined) row.set(b, value)
      }
      if (row.size) pairs.set(a, row)
    }
    return pairs.size ? { format: 1, pairs } : null
  }
  // Classes the exported glyphs use, numbered again from 1; class 0 (glyphs not listed) stays 0.
  const coverage = new Set<number>()
  const classDef1 = new Map<number, number>()
  const used1 = new Map([[0, 0]])
  for (const glyph of subtable.coverage) {
    const g = newGid.get(glyph)
    if (g === undefined) continue
    coverage.add(g)
    const c = subtable.classDef1.get(glyph) ?? 0
    if (!used1.has(c)) used1.set(c, used1.size)
    if (c) classDef1.set(g, used1.get(c)!)
  }
  if (!coverage.size) return null
  const classDef2 = new Map<number, number>()
  const used2 = new Map([[0, 0]])
  for (const [glyph, g] of newGid) {
    const c = subtable.classDef2.get(glyph) ?? 0
    if (!c) continue
    if (!used2.has(c)) used2.set(c, used2.size)
    classDef2.set(g, used2.get(c)!)
  }
  const values = [...used1.keys()].map((c1) => [...used2.keys()].map((c2) => subtable.values[c1]?.[c2] ?? ZERO_PAIR))
  return { format: 2, coverage, classDef1, classDef2, values }
}

// ---- Writing ----

/** Bytes of an OpenType table, with 16- and 32-bit offsets filled in once their targets are known. */
class Writer {
  bytes: number[] = []

  get length() {
    return this.bytes.length
  }

  u16(value: number) {
    this.bytes.push((value >> 8) & 0xff, value & 0xff)
  }

  u32(value: number) {
    this.u16(Math.floor(value / 0x10000))
    this.u16(value & 0xffff)
  }

  tag(tag: string) {
    for (let i = 0; i < 4; i++) this.bytes.push(tag.charCodeAt(i))
  }

  append(bytes: number[]) {
    for (const b of bytes) this.bytes.push(b)
  }

  setOffset16(at: number, value: number) {
    if (value < 0 || value > 0xffff) throw new Error('a GPOS offset is out of range')
    this.bytes[at] = (value >> 8) & 0xff
    this.bytes[at + 1] = value & 0xff
  }

  setOffset32(at: number, value: number) {
    for (let k = 0; k < 4; k++) this.bytes[at + k] = (value >>> (24 - k * 8)) & 0xff
  }
}

const VALUE_BITS = 4 // xPlacement, yPlacement, xAdvance, yAdvance
const X_ADVANCE = 0x0004
/** Subtable bytes above which lookups go through Extension subtables (32-bit offsets). */
const EXTENSION_THRESHOLD = 0xf000
/** Largest pair-list subtable before it is split in two (its offsets are 16-bit). */
const MAX_SUBTABLE = 0xf000

/** ValueFormat bits for the fields any of these values uses (x advance if none, so records are not empty). */
function valueFormat(values: KernValue[]): number {
  let format = 0
  for (const value of values) for (let k = 0; k < VALUE_BITS; k++) if (value[k]) format |= 1 << k
  return format
}

function valueSize(format: number): number {
  let size = 0
  for (let k = 0; k < VALUE_BITS; k++) if (format & (1 << k)) size += 2
  return size
}

function writeValue(w: Writer, format: number, value: KernValue) {
  for (let k = 0; k < VALUE_BITS; k++)
    if (format & (1 << k)) w.u16(Math.max(-32768, Math.min(32767, value[k])) & 0xffff)
}

function formats(values: KernPairValue[]): [number, number] {
  const first = valueFormat(values.map((v) => v[0]))
  const second = valueFormat(values.map((v) => v[1]))
  return first || second ? [first, second] : [X_ADVANCE, 0]
}

/** Coverage: a glyph list (format 1) or glyph ranges (format 2), whichever is smaller. */
function coverageTable(glyphs: number[]): number[] {
  const ranges: [number, number][] = []
  for (const g of glyphs) {
    const last = ranges[ranges.length - 1]
    if (last && last[1] === g - 1) last[1] = g
    else ranges.push([g, g])
  }
  const w = new Writer()
  if (4 + glyphs.length * 2 <= 4 + ranges.length * 6) {
    w.u16(1)
    w.u16(glyphs.length)
    for (const g of glyphs) w.u16(g)
  } else {
    w.u16(2)
    w.u16(ranges.length)
    let index = 0
    for (const [start, end] of ranges) {
      w.u16(start)
      w.u16(end)
      w.u16(index)
      index += end - start + 1
    }
  }
  return w.bytes
}

/** ClassDef: a class array (format 1) or class ranges (format 2), whichever is smaller. */
function classDefTable(classes: Map<number, number>): number[] {
  const glyphs = [...classes.keys()].sort((a, b) => a - b)
  const ranges: [number, number, number][] = []
  for (const g of glyphs) {
    const c = classes.get(g)!
    const last = ranges[ranges.length - 1]
    if (last && last[1] === g - 1 && last[2] === c) last[1] = g
    else ranges.push([g, g, c])
  }
  const w = new Writer()
  const span = glyphs.length ? glyphs[glyphs.length - 1] - glyphs[0] + 1 : 0
  if (glyphs.length && 6 + span * 2 < 4 + ranges.length * 6) {
    w.u16(1)
    w.u16(glyphs[0])
    w.u16(span)
    for (let g = glyphs[0]; g < glyphs[0] + span; g++) w.u16(classes.get(g) ?? 0)
  } else {
    w.u16(2)
    w.u16(ranges.length)
    for (const [start, end, c] of ranges) {
      w.u16(start)
      w.u16(end)
      w.u16(c)
    }
  }
  return w.bytes
}

/** PairPos format 1 subtables, split by first glyph wherever one would outgrow its 16-bit offsets. */
function pairListSubtables(pairs: Map<number, Map<number, KernPairValue>>): number[][] {
  const firsts = [...pairs.keys()].sort((a, b) => a - b)
  const [format1, format2] = formats([...pairs.values()].flatMap((row) => [...row.values()]))
  const recordSize = 2 + valueSize(format1) + valueSize(format2)
  const pieces: number[][] = [[]]
  let size = 10
  for (const g of firsts) {
    // A first glyph adds an offset, a coverage entry (at most 6 bytes as a range), and its pair set.
    const add = 2 + 6 + 2 + pairs.get(g)!.size * recordSize
    if (size + add > MAX_SUBTABLE && pieces[pieces.length - 1].length) {
      pieces.push([])
      size = 10
    }
    pieces[pieces.length - 1].push(g)
    size += add
  }
  return pieces.map((glyphs) => {
    // Coverage before the pair sets, so its offset stays small whatever the sets' size.
    const w = new Writer()
    w.u16(1)
    const coverageAt = w.length
    w.u16(0)
    w.u16(format1)
    w.u16(format2)
    w.u16(glyphs.length)
    const setsAt = w.length
    for (let i = 0; i < glyphs.length; i++) w.u16(0)
    w.setOffset16(coverageAt, w.length)
    w.append(coverageTable(glyphs))
    glyphs.forEach((g, i) => {
      w.setOffset16(setsAt + i * 2, w.length)
      const row = [...pairs.get(g)!].sort((a, b) => a[0] - b[0])
      w.u16(row.length)
      for (const [second, value] of row) {
        w.u16(second)
        writeValue(w, format1, value[0])
        writeValue(w, format2, value[1])
      }
    })
    return w.bytes
  })
}

/** PairPos format 2: the class matrix, then coverage and both class definitions. */
function classPairSubtable(subtable: Extract<KernSubtable, { format: 2 }>): number[] {
  const [format1, format2] = formats(subtable.values.flat())
  const class2Count = subtable.values[0]?.length ?? 1
  const w = new Writer()
  w.u16(2)
  const coverageAt = w.length
  w.u16(0)
  w.u16(format1)
  w.u16(format2)
  const classDef1At = w.length
  w.u16(0)
  const classDef2At = w.length
  w.u16(0)
  w.u16(subtable.values.length)
  w.u16(class2Count)
  for (const row of subtable.values) {
    for (let c2 = 0; c2 < class2Count; c2++) {
      const value = row[c2] ?? ZERO_PAIR
      writeValue(w, format1, value[0])
      writeValue(w, format2, value[1])
    }
  }
  w.setOffset16(coverageAt, w.length)
  w.append(coverageTable([...subtable.coverage].sort((a, b) => a - b)))
  w.setOffset16(classDef1At, w.length)
  w.append(classDefTable(subtable.classDef1))
  w.setOffset16(classDef2At, w.length)
  w.append(classDefTable(subtable.classDef2))
  return w.bytes
}

/**
 * The GPOS table: every script with a default language that turns on one kern feature, one feature per
 * distinct set of lookups, and the pair adjustment lookups in order.
 */
export function writeGpos(kerning: SourceKerning): Uint8Array {
  const subtables = kerning.lookups.map((lookup) =>
    lookup.subtables.flatMap((s) => (s.format === 1 ? pairListSubtables(s.pairs) : [classPairSubtable(s)])),
  )
  const extension = subtables.flat().reduce((n, s) => n + s.length, 0) > EXTENSION_THRESHOLD

  const featureSets: number[][] = []
  const featureOf = new Map<string, number>()
  for (const { lookups } of kerning.scripts) {
    const key = lookups.join(',')
    if (lookups.length && !featureOf.has(key)) {
      featureOf.set(key, featureSets.length)
      featureSets.push(lookups)
    }
  }

  const w = new Writer()
  w.u16(1) // version 1.0
  w.u16(0)
  const scriptListAt = w.length
  w.u16(0)
  const featureListAt = w.length
  w.u16(0)
  const lookupListAt = w.length
  w.u16(0)

  // ScriptList: each script's default language system lists its kern feature (or nothing).
  w.setOffset16(scriptListAt, w.length)
  const scriptList = w.length
  w.u16(kerning.scripts.length)
  const scriptRecordsAt = w.length
  for (const { tag } of kerning.scripts) {
    w.tag(tag)
    w.u16(0)
  }
  kerning.scripts.forEach(({ lookups }, i) => {
    w.setOffset16(scriptRecordsAt + i * 6 + 4, w.length - scriptList)
    const feature = featureOf.get(lookups.join(','))
    w.u16(4) // default LangSys right after this Script table
    w.u16(0) // no other language systems
    w.u16(0) // lookupOrder (reserved)
    w.u16(0xffff) // no required feature
    w.u16(feature === undefined ? 0 : 1)
    if (feature !== undefined) w.u16(feature)
  })

  // FeatureList: one kern feature per set of lookups.
  w.setOffset16(featureListAt, w.length)
  const featureList = w.length
  w.u16(featureSets.length)
  const featureRecordsAt = w.length
  for (let i = 0; i < featureSets.length; i++) {
    w.tag('kern')
    w.u16(0)
  }
  featureSets.forEach((lookups, i) => {
    w.setOffset16(featureRecordsAt + i * 6 + 4, w.length - featureList)
    w.u16(0) // no feature parameters
    w.u16(lookups.length)
    for (const index of lookups) w.u16(index)
  })

  // LookupList: pair adjustment lookups, their subtables inline or behind Extension subtables.
  w.setOffset16(lookupListAt, w.length)
  const lookupList = w.length
  w.u16(kerning.lookups.length)
  const lookupOffsetsAt = w.length
  for (let i = 0; i < kerning.lookups.length; i++) w.u16(0)
  const deferred: { at: number; bytes: number[] }[] = []
  kerning.lookups.forEach((lookup, i) => {
    w.setOffset16(lookupOffsetsAt + i * 2, w.length - lookupList)
    const start = w.length
    w.u16(extension ? 9 : 2)
    w.u16(lookup.flags)
    w.u16(subtables[i].length)
    const offsetsAt = w.length
    for (let k = 0; k < subtables[i].length; k++) w.u16(0)
    subtables[i].forEach((bytes, k) => {
      w.setOffset16(offsetsAt + k * 2, w.length - start)
      if (extension) {
        const at = w.length
        w.u16(1) // ExtensionPosFormat1
        w.u16(2) // of pair adjustment subtables
        w.u32(0)
        deferred.push({ at, bytes })
      } else {
        w.append(bytes)
      }
    })
  })
  for (const { at, bytes } of deferred) {
    w.setOffset32(at + 4, w.length - at)
    w.append(bytes)
  }
  return Uint8Array.from(w.bytes)
}

// ---- Checking ----

const MAX_CHECKED_PAIRS = 400_000

/**
 * Glyph pairs that exercise every part of the kerning: each listed pair, each covered first glyph
 * against one glyph of every second class, one glyph of every first class against every glyph, and
 * a fixed sample of other pairs. Huge class matrices are checked on an even spread of these, at most
 * MAX_CHECKED_PAIRS. `glyphCount` includes .notdef.
 */
function checkPairs(kerning: SourceKerning, glyphCount: number): [number, number][] {
  const visit = (add: (first: number, second: number) => void) => {
    for (const lookup of kerning.lookups) {
      for (const subtable of lookup.subtables) {
        if (subtable.format === 1) {
          for (const [first, row] of subtable.pairs) for (const second of row.keys()) add(first, second)
          continue
        }
        const firstOfClass = new Map<number, number>()
        for (const g of subtable.coverage) {
          const c = subtable.classDef1.get(g) ?? 0
          if (!firstOfClass.has(c) || g < firstOfClass.get(c)!) firstOfClass.set(c, g)
        }
        const secondOfClass = new Map<number, number>()
        for (let g = 1; g < glyphCount; g++) {
          const c = subtable.classDef2.get(g) ?? 0
          if (!secondOfClass.has(c)) secondOfClass.set(c, g)
        }
        for (const first of subtable.coverage) for (const second of secondOfClass.values()) add(first, second)
        for (const first of firstOfClass.values())
          for (let second = 1; second < glyphCount; second++) add(first, second)
      }
    }
    let seed = 1
    const random = () => {
      seed = (seed * 48271) % 0x7fffffff
      return 1 + (seed % Math.max(1, glyphCount - 1))
    }
    for (let i = 0; i < 2000 && glyphCount > 1; i++) add(random(), random())
  }
  let total = 0
  visit(() => total++)
  const step = Math.ceil(total / MAX_CHECKED_PAIRS)
  const keys = new Set<number>()
  const pairs: [number, number][] = []
  let n = 0
  visit((first, second) => {
    const key = first * 0x10000 + second
    if (n++ % step || keys.has(key)) return
    keys.add(key)
    pairs.push([first, second])
  })
  return pairs
}

/**
 * Where the kerning read back from a written font differs from the kerning meant to be written:
 * scripts, lookup flags, and the value of every pair from `checkPairs`. Empty when they agree.
 */
export function kerningDifferences(
  want: SourceKerning | null,
  got: SourceKerning | null,
  glyphCount: number,
): string[] {
  if (!want || !got)
    return want === got ? [] : [want ? 'the kerning is missing' : 'there is kerning that was not written']
  const problems: string[] = []
  const tags = (k: SourceKerning) => k.scripts.map((s) => s.tag).join(' ')
  if (tags(want) !== tags(got)) return [`kerning scripts read back as “${tags(got)}”, expected “${tags(want)}”`]
  if (want.lookups.length !== got.lookups.length)
    return [`${got.lookups.length} kerning lookups read back, expected ${want.lookups.length}`]
  want.lookups.forEach((lookup, i) => {
    if (lookup.flags !== got.lookups[i].flags)
      problems.push(`kerning lookup ${i + 1} flags read back as ${got.lookups[i].flags}`)
  })
  const pairs = checkPairs(want, glyphCount)
  want.scripts.forEach((script, i) => {
    if (script.lookups.join(',') !== got.scripts[i].lookups.join(',')) {
      problems.push(`the ${script.tag} script's kerning lookups differ`)
      return
    }
    // Scripts sharing the same lookups need only one check.
    if (want.scripts.findIndex((s) => s.lookups.join(',') === script.lookups.join(',')) !== i) return
    // Shown as the first glyph's advance change, or all eight values if anything else changes.
    const show = (v: number[]) => (v.every((x, k) => k === 2 || x === 0) ? String(v[2]) : v.join(' '))
    let wrong = 0
    for (const [first, second] of pairs) {
      const a = pairKerning(want, script.lookups, first, second)
      const b = pairKerning(got, script.lookups, first, second)
      if (a.some((v, k) => v !== b[k]) && wrong++ < 3)
        problems.push(`kerning of glyphs ${first} and ${second} reads back as ${show(b)}, expected ${show(a)}`)
    }
    if (wrong > 3) problems.push(`and ${wrong - 3} more kerning pairs differ`)
  })
  return problems
}
