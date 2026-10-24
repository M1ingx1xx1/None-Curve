// Pair kerning as the canvas applies it, read from a parsed font so an exported font can carry it.
// Follows fontkit's layout rules: the GPOS kern feature of each script's default language, pair
// adjustment lookups only, with variation deltas for an instance; the legacy kern table where that
// feature is missing. No React, no DOM; fontkit is only used through the font object handed in.

import type { Font } from 'fontkit'
import type { KernLookup, KernPairValue, KernSubtable, KernValue, SourceKerning } from './model'

const ZERO: KernValue = [0, 0, 0, 0]
const ZERO_PAIR: KernPairValue = [ZERO, ZERO]

/** LookupFlag bits kept: ignore base glyphs, ligatures, marks. The others need a GDEF table. */
const KEPT_FLAGS = 0x000e

// fontkit's decoded tables; part of its runtime API but not typed.
interface Coverage {
  version: number
  glyphs?: number[]
  rangeRecords?: { start: number; end: number; startCoverageIndex: number }[]
}
interface ClassDef {
  version: number
  startGlyph?: number
  classValueArray?: number[]
  classRangeRecord?: { start: number; end: number; class: number }[]
}
interface Device {
  a: number
  b: number
}
type ValueRecord = Partial<Record<'xPlacement' | 'yPlacement' | 'xAdvance' | 'yAdvance', number>> &
  Partial<Record<'xPlaDevice' | 'yPlaDevice' | 'xAdvDevice' | 'yAdvDevice', Device | null>>
interface Indexed<T> {
  get(index: number): T
  length: number
}
interface PairPos {
  version: number
  coverage: Coverage
  pairSets?: Indexed<{ secondGlyph: number; value1?: ValueRecord; value2?: ValueRecord }[]>
  classDef1?: ClassDef
  classDef2?: ClassDef
  class1Count?: number
  class2Count?: number
  classRecords?: Indexed<Indexed<{ value1?: ValueRecord; value2?: ValueRecord }>>
}
interface Lookup {
  lookupType: number
  flags: { markAttachmentType: number; flags: Record<string, boolean> }
  subTables: Iterable<PairPos & { lookupType?: number; extension?: PairPos }>
}
interface Feature {
  lookupListIndexes: number[]
}
interface Gpos {
  scriptList: { tag: string; script: { defaultLangSys: { featureIndexes: number[] } | null } }[]
  featureList: { tag: string; feature: Feature }[]
  lookupList: Indexed<Lookup>
  featureVariations?: {
    featureVariationRecords: {
      conditionSet: {
        conditionTable: { axisIndex: number; filterRangeMinValue: number; filterRangeMaxValue: number }[]
      }
      featureTableSubstitution: { substitutions: { featureIndex: number; alternateFeatureTable: Feature }[] }
    }[]
  }
}
interface KernTable {
  tables?: {
    version: number
    format: number
    coverage: Record<string, boolean>
    subtable: { pairs?: { left: number; right: number; value: number }[] }
  }[]
}
interface FontTables {
  morx?: unknown
  GSUB?: unknown
  GPOS?: Gpos
  GDEF?: { itemVariationStore?: unknown }
  kern?: KernTable
  _variationProcessor?: {
    normalizedCoords: number[]
    getDelta(store: unknown, outer: number, inner: number): number
  } | null
}

const LOOKUP_FLAG_BITS = ['rightToLeft', 'ignoreBaseGlyphs', 'ignoreLigatures', 'ignoreMarks', 'useMarkFilteringSet']

/** The font's pair kerning, or null if it has none (or its layout tables cannot be read). */
export function readKerning(font: Font): SourceKerning | null {
  try {
    return read(font as unknown as FontTables)
  } catch {
    return null
  }
}

function read(font: FontTables): SourceKerning | null {
  // fontkit lays out with the AAT engine when there is a morx table, which ignores GPOS.
  const gpos = !font.morx && (font.GSUB || font.GPOS) ? font.GPOS : undefined
  let legacy: KernLookup[] | null = null
  const legacyLookups = () => (legacy ??= readLegacyKern(font))

  if (!gpos) {
    const lookups = legacyLookups()
    return lookups.length ? { scripts: [{ tag: 'DFLT', lookups: lookups.map((_, i) => i) }], lookups } : null
  }

  const substitutions = featureSubstitutions(font, gpos)
  const perScript: { tag: string; gposLookups: number[] | null }[] = []
  const seen = new Set<string>()
  for (const { tag, script } of gpos.scriptList) {
    if (seen.has(tag)) continue // fontkit uses the first record of a tag
    seen.add(tag)
    let kern: Feature | null = null
    for (const index of script.defaultLangSys?.featureIndexes ?? []) {
      const record = gpos.featureList[index]
      if (record?.tag === 'kern') kern = substitutions.get(index) ?? record.feature
    }
    perScript.push({ tag, gposLookups: kern ? [...new Set(kern.lookupListIndexes)].sort((a, b) => a - b) : null })
  }

  // Lookups in lookup-list order, then the legacy kern table's, which scripts without a kern feature use.
  const used = [...new Set(perScript.flatMap((s) => s.gposLookups ?? []))].sort((a, b) => a - b)
  const lookups: KernLookup[] = []
  const position = new Map<number, number>()
  for (const index of used) {
    const lookup = readPairLookup(font, gpos.lookupList.get(index))
    if (lookup) {
      position.set(index, lookups.length)
      lookups.push(lookup)
    }
  }
  let legacyStart = -1
  const scripts = perScript.map(({ tag, gposLookups }) => {
    if (gposLookups) return { tag, lookups: gposLookups.flatMap((i) => position.get(i) ?? []) }
    if (legacyStart < 0 && legacyLookups().length) {
      legacyStart = lookups.length
      lookups.push(...legacyLookups())
    }
    return { tag, lookups: legacyStart < 0 ? [] : legacyLookups().map((_, i) => legacyStart + i) }
  })
  if (!lookups.length) return null
  return { scripts: scripts.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)), lookups }
}

/** Feature tables a variable font's instance swaps in (GPOS FeatureVariations), as fontkit picks them. */
function featureSubstitutions(font: FontTables, gpos: Gpos): Map<number, Feature> {
  const out = new Map<number, Feature>()
  const coords = font._variationProcessor?.normalizedCoords
  if (!coords || !gpos.featureVariations) return out
  const record = gpos.featureVariations.featureVariationRecords.find((r) =>
    r.conditionSet.conditionTable.every((c) => {
      const coord = c.axisIndex < coords.length ? coords[c.axisIndex] : 0
      return c.filterRangeMinValue <= coord && coord <= c.filterRangeMaxValue
    }),
  )
  for (const s of record?.featureTableSubstitution.substitutions ?? []) out.set(s.featureIndex, s.alternateFeatureTable)
  return out
}

function lookupFlags(lookup: Lookup): number {
  const flags = lookup.flags?.flags ?? {}
  return LOOKUP_FLAG_BITS.reduce((value, name, bit) => (flags[name] ? value | (1 << bit) : value), 0) & KEPT_FLAGS
}

/** A pair adjustment lookup (type 2, or type 9 wrapping type 2); null for any other type. */
function readPairLookup(font: FontTables, lookup: Lookup | undefined): KernLookup | null {
  if (!lookup || (lookup.lookupType !== 2 && lookup.lookupType !== 9)) return null
  const subtables: KernSubtable[] = []
  for (const table of lookup.subTables) {
    const pair = lookup.lookupType === 9 ? (table.lookupType === 2 ? table.extension : undefined) : table
    if (!pair) continue
    const subtable = readPairPos(font, pair)
    if (subtable) subtables.push(subtable)
  }
  return subtables.length ? { flags: lookupFlags(lookup), subtables } : null
}

function readPairPos(font: FontTables, table: PairPos): KernSubtable | null {
  const value = valueReader(font)
  const covered = coverageGlyphs(table.coverage)
  if (table.version === 1 && table.pairSets) {
    const pairs = new Map<number, Map<number, KernPairValue>>()
    covered.forEach((glyph, index) => {
      if (pairs.has(glyph)) return
      const row = new Map<number, KernPairValue>()
      for (const record of table.pairSets!.get(index) ?? []) {
        if (!row.has(record.secondGlyph))
          row.set(record.secondGlyph, pairValue(value(record.value1), value(record.value2)))
      }
      pairs.set(glyph, row)
    })
    return { format: 1, pairs }
  }
  if (table.version === 2 && table.classRecords) {
    const values: KernPairValue[][] = []
    for (let c1 = 0; c1 < (table.class1Count ?? 0); c1++) {
      const row = table.classRecords.get(c1)
      values.push(
        Array.from({ length: table.class2Count ?? 0 }, (_, c2) => {
          const record = row?.get(c2)
          return pairValue(value(record?.value1), value(record?.value2))
        }),
      )
    }
    return {
      format: 2,
      coverage: new Set(covered.filter(() => true)),
      classDef1: classMap(table.classDef1),
      classDef2: classMap(table.classDef2),
      values,
    }
  }
  return null
}

/** Reads value records the way fontkit applies them: variation deltas only for an instance. */
function valueReader(font: FontTables): (record: ValueRecord | undefined) => KernValue {
  const variations = font._variationProcessor
  const store = variations ? font.GDEF?.itemVariationStore : undefined
  const delta = (device: Device | null | undefined) =>
    variations && store && device ? variations.getDelta(store, device.a, device.b) : 0
  return (record) => {
    if (!record) return ZERO
    const value: KernValue = [
      Math.round((record.xPlacement ?? 0) + delta(record.xPlaDevice)),
      Math.round((record.yPlacement ?? 0) + delta(record.yPlaDevice)),
      Math.round((record.xAdvance ?? 0) + delta(record.xAdvDevice)),
      Math.round((record.yAdvance ?? 0) + delta(record.yAdvDevice)),
    ]
    return value.every((v) => v === 0) ? ZERO : value
  }
}

function pairValue(first: KernValue, second: KernValue): KernPairValue {
  return first === ZERO && second === ZERO ? ZERO_PAIR : [first, second]
}

/** Glyphs by coverage index (an array with gaps if the ranges skip an index). */
function coverageGlyphs(coverage: Coverage): number[] {
  if (coverage.version === 1) return coverage.glyphs ?? []
  const glyphs: number[] = []
  for (const range of coverage.rangeRecords ?? []) {
    for (let g = range.start; g <= range.end; g++) glyphs[range.startCoverageIndex + g - range.start] ??= g
  }
  return glyphs
}

function classMap(classDef: ClassDef | undefined): Map<number, number> {
  const map = new Map<number, number>()
  if (classDef?.version === 1) {
    classDef.classValueArray?.forEach((c, i) => {
      if (c) map.set(classDef.startGlyph! + i, c)
    })
  } else if (classDef?.version === 2) {
    for (const range of classDef.classRangeRecord ?? []) {
      for (let g = range.start; g <= range.end; g++) if (range.class && !map.has(g)) map.set(g, range.class)
    }
  }
  return map
}

/**
 * The legacy kern table's horizontal pair lists (format 0), one lookup each, since its subtables add
 * up. An override subtable replaces the sum so far, so only it and the ones after it count. Apple's
 * class-based formats 2 and 3 are not read.
 */
function readLegacyKern(font: FontTables): KernLookup[] {
  let tables: NonNullable<KernTable['tables']>
  try {
    tables = font.kern?.tables ?? []
  } catch {
    return []
  }
  const applies = tables.filter((t) =>
    t.coverage.crossStream
      ? false
      : t.version === 0
        ? t.coverage.horizontal
        : !(t.coverage.vertical || t.coverage.variation),
  )
  const lastOverride = applies.map((t) => Boolean(t.coverage.override)).lastIndexOf(true)
  const lookups: KernLookup[] = []
  for (const table of applies.slice(Math.max(0, lastOverride))) {
    if (table.format !== 0 || !table.subtable.pairs?.length) continue
    const pairs = new Map<number, Map<number, KernPairValue>>()
    for (const { left, right, value } of table.subtable.pairs) {
      let row = pairs.get(left)
      if (!row) pairs.set(left, (row = new Map()))
      if (!row.has(right)) row.set(right, value ? [[0, 0, value, 0], ZERO] : ZERO_PAIR)
    }
    lookups.push({ flags: 0, subtables: [{ format: 1, pairs }] })
  }
  return lookups
}

/**
 * What the given lookups do to the pair `first`, `second` standing alone: x/y placement and x/y
 * advance changes of the first glyph, then of the second.
 */
export function pairKerning(
  kerning: SourceKerning,
  lookups: readonly number[],
  first: number,
  second: number,
): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0, 0]
  for (const index of lookups) {
    for (const subtable of kerning.lookups[index].subtables) {
      let value: KernPairValue | undefined
      if (subtable.format === 1) {
        value = subtable.pairs.get(first)?.get(second)
        if (!value) continue
      } else {
        if (!subtable.coverage.has(first)) continue
        value = subtable.values[subtable.classDef1.get(first) ?? 0]?.[subtable.classDef2.get(second) ?? 0] ?? ZERO_PAIR
      }
      for (let k = 0; k < 4; k++) {
        out[k] += value[0][k]
        out[4 + k] += value[1][k]
      }
      break
    }
  }
  return out
}
