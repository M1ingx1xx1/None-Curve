// Neutral Sound is today's Sound. The constants below were pinned at commit 4a54e5d, before the per-letter Response
// controls (Strength, Motion contrast, Pitch reactive, Melody tracking) existed, and must never be edited: with the
// Response settings at their neutral values (Strength 100%, the other three 0) every output here must stay what it
// was. A failure means a change reached the neutral path; fix the change, not the hash.
//
// Four outputs, each hashed (FNV-1a): modulate for every preset over seeded frames and jumps, and the live
// scheduler's geometry requests, commits and Freeze over 3 s of seeded frames per preset without Thorn (with fake
// time, as live.test.ts), over exact values; the FeatureFrame fields the analyser gives today, to 10 significant
// digits; and the default text in Roboto under Flicker at one frame, from the pipeline to the SVG.
//
// The scheduler leaves out Flare, the only preset whose start turns Thorn on: while Thorn is on, its settings and
// the Experimental seed reach the letters by turns, a few letters at a time (THORN_TURNS, src/sound/letters.ts and
// live.ts), which changes Flare's live frames on purpose; tests/sound/turns.test.ts tests it. The scheduler's pin was
// taken again from 4a54e5d with Flare left out, and checked there and on the new code on arm64 and x64.
//
// The features are rounded because V8's Math.log2 and Math.log10 can differ in the last bit between its x64 and arm64
// builds (Pitch and Level dB here, by about 2e-16): exact, they hash differently on CI (Linux x64) than on an Apple
// silicon Mac. Their pin was taken from 4a54e5d on both, which agree to 10 digits.

import { describe, expect, it } from 'vitest'
import { glyphGeometry, paramsKey } from '../../src/geometry/cache'
import type { GeometryParams } from '../../src/geometry/types'
import { specimenPaths, specimenToSvg } from '../../src/export/svg'
import { LiveScheduler, type LiveCommit, type LiveDeps } from '../../src/sound/live'
import { modulate, targetById, type Mapping } from '../../src/sound/mapping'
import { PRESETS, presetSettings, type Preset } from '../../src/sound/presets'
import { DEFAULT_FEATURE_SETTINGS, SILENT_FRAME, type FeatureFrame } from '../../src/sound/types'
import { DEFAULT_ARTBOARD, DEFAULT_TYPOGRAPHY, layoutArtboard } from '../../src/specimen/artboard'
import { DEFAULT_TEXT } from '../../src/specimen/samples'
import { placePolygons, shapeSpecimen } from '../../src/specimen/scene'
import { analyse, drumHits, hiHat, hitTimes, mix, noise, reseed, sine, type ProbedFrame } from '../helpers/audio'
import { loadFixture } from '../helpers/fonts'
import { BASE } from '../helpers/params'

// Pinned at 4a54e5d (features to 10 significant digits, on arm64 and x64; the scheduler without Flare). Never edit,
// except for a change of the params' shape: modulate and scheduler hash whole params, so they were pinned again when
// Crumple lost Detail (NOCUR-60); with that field put back they give the 4a54e5d values (ef59f235, 32a8121b).
// Pinned again when the sliders got finer steps (NOCUR-63): Sound snaps a live value to its slider's step, so
// modulate and scheduler moved; with the old steps put back in SLIDER_RANGES they give a0bbe805 and c91cc307.
// Pinned again when Ripple and Thorn got Reverse (NOCUR-68); with the reverse fields taken out they give a02149f5 /
// cf6faa50. Pinned again when Thorn got Burst (NOCUR-70); with the burst, spikes and dent fields taken out they give
// bdfa9875 / f3f239b8. Pinned again when Dissolve was added (NOCUR-69, off by default); with its default left out
// of the params they give 20eebabd / 5d255e78.
const PINNED = {
  modulate: '107bb3bd',
  scheduler: 'abe13938',
  features: 'f797c3bc',
  svg: '7813f93d',
  paths: '43e22fd6',
} as const

/** FNV-1a (32 bits) over UTF-16 code units; each part ends with a separator, so ['ab', 'c'] and ['a', 'bc'] differ. */
function fnv1a() {
  let h = 0x811c9dc5
  const unit = (u: number) => {
    h ^= u & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= u >>> 8
    h = Math.imul(h, 0x01000193)
  }
  return {
    add(part: string) {
      for (let i = 0; i < part.length; i++) unit(part.charCodeAt(i))
      unit(0x1f)
    },
    get hex() {
      return (h >>> 0).toString(16).padStart(8, '0')
    },
  }
}

/** mulberry32: uniform in [0, 1), a stream of its own per seed. */
function random(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A sounding frame at `time`: every feature from `rand` (now and then exactly 0 or 1; Pan −1–1), an onset about one frame in six. */
function soundFrame(rand: () => number, time: number): FeatureFrame {
  const value = () => {
    const r = rand()
    return r < 0.08 ? 0 : r > 0.92 ? 1 : r
  }
  const level = value()
  const onset = rand() < 1 / 6
  return {
    ...SILENT_FRAME,
    time,
    levelDb: level > 0 ? 20 * Math.log10(level) : -Infinity,
    level,
    swell: value(),
    bass: value(),
    mids: value(),
    treble: value(),
    brightness: value(),
    pitch: value(),
    beat: onset ? 1 : value() / 2,
    activity: value(),
    pan: value() * 2 - 1,
    onset,
    silent: false,
  }
}

/** A sounding frame at `time` whose features follow slow waves, with an onset every 500 ms. */
function waveFrame(time: number): FeatureFrame {
  const wave = (period: number, phase: number) => 0.5 + 0.5 * Math.sin((2 * Math.PI * time) / period + phase)
  const onset = Math.floor(time / 500) !== Math.floor((time - 1000 / 60) / 500)
  const level = wave(1300, 0)
  return {
    ...SILENT_FRAME,
    time,
    levelDb: 20 * Math.log10(Math.max(1e-6, level)),
    level,
    swell: wave(2900, 1),
    bass: wave(700, 2),
    mids: wave(1100, 3),
    treble: wave(450, 4),
    brightness: wave(1700, 5),
    pitch: wave(2300, 6),
    beat: onset ? 1 : Math.exp(-(time % 500) / 150),
    activity: wave(900, 7),
    pan: Math.sin((2 * Math.PI * time) / 1900),
    onset,
    silent: false,
  }
}

const quietFrame = (time: number): FeatureFrame => ({ ...SILENT_FRAME, time })

const mappingsOf = (preset: Preset): Mapping[] => preset.mappings.map((m, i) => ({ ...m, id: `${preset.id} ${i}` }))
const startOf = (preset: Preset): GeometryParams => presetSettings(BASE, preset).params
const entries = (values: ReadonlyMap<string, number>) => JSON.stringify([...values])
/** The presets whose start leaves Thorn off: Thorn turns change the live frames of the others (Flare). */
const UNTHORNED = PRESETS.filter((preset) => startOf(preset).experimental.thorn?.enabled !== true)

describe('neutral Sound reproduces 4a54e5d', () => {
  it('modulate: every preset over 64 seeded frames, with 0 and 3 jumps', () => {
    const hash = fnv1a()
    let moved = 0
    for (const preset of PRESETS) {
      const base = startOf(preset)
      const mappings = mappingsOf(preset)
      const seeds = [...new Set(mappings.map((m) => m.target).filter((id) => targetById(id)?.kind === 'jump'))]
      const rand = random(17)
      for (let f = 0; f < 64; f++) {
        const frame = soundFrame(rand, 100 + f * 16)
        for (const count of [0, 3]) {
          const { params, positions, seeds: live } = modulate(base, frame, mappings, new Map(seeds.map((id) => [id, count])))
          if (params !== base) moved++
          hash.add(`${preset.id}|${f}|${count}|${paramsKey(params)}|${entries(positions)}|${entries(live)}`)
        }
      }
    }
    // Most frames move something (a frame of zeros and no jumps moves nothing).
    expect(moved).toBeGreaterThan(PRESETS.length * 64)
    expect(hash.hex).toBe(PINNED.modulate)
  })

  it('live scheduler: every preset without Thorn for 3 s at 60 fps, its requests, commits and Freeze', () => {
    expect(PRESETS.filter((preset) => !UNTHORNED.includes(preset)).map((preset) => preset.id)).toEqual(['flare'])
    const hash = fnv1a()
    let live = 0
    for (const preset of UNTHORNED) {
      const r = rig()
      r.live.setBase(startOf(preset))
      r.live.setMappings(mappingsOf(preset), true)
      const rand = random(29)
      // Quiet, seeded sound (the flash limit holds much of it back), a quiet gap, then slow waves.
      r.play(3000, (t) => (t < 300 ? quietFrame(t) : t < 1500 ? soundFrame(rand, t) : t < 1800 ? quietFrame(t) : waveFrame(t)))
      const freeze = r.live.freezeChanges()
      r.setRunning(false)
      live += r.commits.filter((c) => c.startsWith('[')).length
      hash.add(`${preset.id}|${r.requests.join(';')}|${r.commits.join(';')}|${freeze ? JSON.stringify(freeze) : 'null'}`)
    }
    expect(live).toBeGreaterThan(UNTHORNED.length * 20)
    expect(hash.hex).toBe(PINNED.scheduler)
  })

  it('features: the FeatureFrame fields of today over tones, drums and noise', () => {
    const seconds = 4
    reseed(41)
    const kick = drumHits(hitTimes(2, seconds), seconds, -8)
    const hats = hiHat(4, seconds, -22, 0.55)
    const left = mix(sine(220, -14, seconds, 0, 2), sine(330, -16, seconds, 2, seconds), kick, hats, noise(-40, seconds))
    const right = mix(sine(220, -20, seconds, 0, 2), sine(330, -14, seconds, 2, seconds), kick, noise(-40, seconds))
    const runs = [
      analyse(left, right),
      analyse(mix(left, right), null, { jitterMs: 3, quantum: 128, settings: { ...DEFAULT_FEATURE_SETTINGS, sensitivity: 6, releaseMs: 300 } }),
    ]
    const hash = fnv1a()
    for (const frames of runs) for (const f of frames) hash.add(featureFields(f))
    // Not a degenerate signal: onsets, a pitch, and both sides of Pan.
    expect(runs[0].filter((f) => f.onset).length).toBeGreaterThan(4)
    expect(runs[0].some((f) => f.pitch > 0)).toBe(true)
    expect(runs[0].some((f) => f.pan > 0.05)).toBe(true)
    expect(hash.hex).toBe(PINNED.features)
  })

  it('render: the default text in Roboto under Flicker at one frame, to SVG', async () => {
    const font = await loadFixture('Roboto')
    const preset = PRESETS.find((p) => p.id === 'flicker')!
    const base = startOf(preset)
    const frame: FeatureFrame = { ...soundFrame(random(53), 1234), level: 0.7, beat: 1, onset: true }
    const params = modulate(base, frame, mappingsOf(preset), new Map([['distortion.seed', 3]])).params
    expect(params).not.toBe(base)
    const key = paramsKey(params)
    const { tracking, lineHeight, align, slant } = DEFAULT_TYPOGRAPHY
    const shaped = shapeSpecimen(font, DEFAULT_TEXT, { tracking, lineHeight, align, slant })
    const scene = placePolygons(shaped, (index) => {
      try {
        return { polygon: glyphGeometry(font, index, params, key, true).polygon }
      } catch (error) {
        return { error: String(error) }
      }
    })
    expect(scene.failedGlyphs).toBe(0)
    const layout = layoutArtboard(scene, DEFAULT_TYPOGRAPHY, DEFAULT_ARTBOARD, font.metrics.unitsPerEm)
    const size = { width: DEFAULT_ARTBOARD.width, height: DEFAULT_ARTBOARD.height }
    const svg = specimenToSvg(scene, layout, size, 2, { fontName: 'Roboto Regular', subject: 'neutral', pipeline: ['Flatten', 'Noise'] }, {
      ink: '#111111',
      paper: '#ffffff',
      background: true,
      blur: 0,
    })
    const paths = specimenPaths(scene, layout, 2)
    // Straight segments only.
    for (const path of paths.paths) expect(path.d).toMatch(/^[MLZ0-9 .-]+$/)
    expect(paths.paths.length).toBeGreaterThan(150)

    const svgHash = fnv1a()
    svgHash.add(svg.svg)
    const pathsHash = fnv1a()
    pathsHash.add(paths.transform)
    for (const path of paths.paths) pathsHash.add(`${path.transform}|${path.d}`)
    pathsHash.add(String(paths.vertices))
    expect([svgHash.hex, pathsHash.hex]).toEqual([PINNED.svg, PINNED.paths])
  })
})

/** Today's FeatureFrame fields, listed so that fields added later are left out. */
function featureFields(f: ProbedFrame): string {
  return [f.time, f.levelDb, f.level, f.swell, f.bass, f.mids, f.treble, f.brightness, f.pitch, f.beat, f.activity, f.pan, f.onset, f.silent]
    .map((v) => (typeof v === 'number' && Number.isFinite(v) ? v.toPrecision(10) : String(v)))
    .join(',')
}

/**
 * The live scheduler with fake time, timers, client and React, as live.test.ts: a request computes its glyphs in
 * 12 ms unless they are known, a commit renders 2 ms later. `request` takes today's (params, key) and a list of jobs
 * ({ params, key, indices? }) alike, and records each job as its key and indices (or 'shown' without them).
 */
function rig() {
  let now = 0
  let running = true
  let computing = false
  let nextId = 1
  const timers: { at: number; id: number; run: () => void }[] = []
  const later = (ms: number, run: () => void) => {
    const id = nextId++
    timers.push({ at: now + Math.max(0, ms), id, run })
    return id
  }
  const known = new Set<string>()
  const requests: string[] = []
  const commits: string[] = []
  type Job = { params: GeometryParams; key: string; indices?: readonly number[] }
  const deps: LiveDeps = {
    now: () => now,
    sourceRunning: () => running,
    isComputing: () => computing,
    request: ((a: unknown, b?: unknown) => {
      const jobs = (Array.isArray(a) ? a : [{ params: a, key: b }]) as Job[]
      for (const job of jobs) expect(job.key).toBe(paramsKey(job.params))
      requests.push(`${now}:${jobs.map((job) => `${job.key}#${job.indices ? job.indices.join(',') : 'shown'}`).join('+')}`)
      const missing = jobs.filter((job) => !known.has(job.key))
      if (missing.length === 0) return false
      computing = true
      later(12, () => {
        computing = false
        for (const job of missing) known.add(job.key)
        live.idle()
      })
      return true
    }) as LiveDeps['request'],
    commit: (commit: LiveCommit | null) => {
      // Neutral: no per-letter frame rides along.
      expect((commit as { letters?: unknown } | null)?.letters ?? null).toBeNull()
      commits.push(commit ? `${commit.params ? paramsKey(commit.params) : 'null'}|${commit.seq}|${now}` : `stop|${now}`)
      if (commit) later(2, () => live.rendered(commit.seq))
    },
    pauseSound: () => {
      running = false
      live.sourceChanged()
    },
    setTimer: (run, ms) => later(ms, run),
    clearTimer: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
  }
  const live = new LiveScheduler(deps)
  const advance = (to: number) => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id)
      const next = timers[0]
      if (!next || next.at > to) break
      timers.shift()
      now = Math.max(now, next.at)
      next.run()
    }
    now = Math.max(now, to)
  }
  return {
    live,
    requests,
    commits,
    /** Frames every 1/60 s until `until`. */
    play(until: number, frameAt: (t: number) => FeatureFrame) {
      for (let t = now; t <= until; t += 1000 / 60) {
        advance(t)
        live.setFrame(frameAt(t))
      }
      advance(until)
    },
    setRunning(value: boolean) {
      running = value
      live.sourceChanged()
    },
  }
}
