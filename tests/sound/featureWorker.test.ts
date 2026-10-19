// The feature worker's core (src/sound/featureWorkerCore.ts) with a fake `post`: it measures the file in chunks, in
// order, exactly as one offline pass would; a seek beyond what is covered is measured first, from a warm-up before it
// with a fresh extractor; and new settings drop the old generation's work.

import { describe, expect, it } from 'vitest'
import { analyserFftSize } from '../../src/sound/engine'
import { FeatureExtractor } from '../../src/sound/features'
import { CHUNK_FRAMES, FeatureWorkerCore, type FeatureWorkerResponse } from '../../src/sound/featureWorkerCore'
import { gridFrameCount, highpassInPlace, measureFrames } from '../../src/sound/offline'
import { FEATURE_STRIDE, packFrame, PRECOMPUTE_LIMITS } from '../../src/sound/timelineTypes'
import { DEFAULT_FEATURE_SETTINGS, type FeatureSettings } from '../../src/sound/types'
import { drumHits, glide, hitTimes, mix, SR } from '../helpers/audio'

const SECONDS = 8
const signal = () => Float32Array.from(mix(drumHits(hitTimes(2, SECONDS), SECONDS), glide(110, 880, SECONDS, -12)))
const GRID = { hz: PRECOMPUTE_LIMITS.gridHz }

/** What one offline pass gives for frames from..to, packed: the high-passed signal, a fresh extractor at `from`. */
function expected(from: number, to: number, settings: FeatureSettings = DEFAULT_FEATURE_SETTINGS): Float64Array {
  const left = signal()
  highpassInPlace(left, SR)
  const frames = measureFrames({ left, right: left }, SR, settings, GRID, from, to, new FeatureExtractor(SR, analyserFftSize(SR)))
  const values = new Float64Array(frames.length * FEATURE_STRIDE)
  frames.forEach((frame, row) => packFrame(frame, values, row))
  return values
}

function worker() {
  const posted: FeatureWorkerResponse[] = []
  const core = new FeatureWorkerCore((message) => posted.push(message))
  const columns = () => posted.filter((m): m is Extract<FeatureWorkerResponse, { type: 'columns' }> => m.type === 'columns')
  const runAll = () => {
    while (core.step());
  }
  return { core, posted, columns, runAll }
}

const FRAMES = gridFrameCount(SR * SECONDS, SR, GRID)

describe('feature worker core', () => {
  it('posts the chunks in order, and together they are one offline pass', () => {
    const { core, posted, columns, runAll } = worker()
    core.handle({ type: 'load', generation: 1, sampleRate: SR, left: signal(), right: null, settings: DEFAULT_FEATURE_SETTINGS, fromMs: 0 })
    runAll()
    const chunks = columns()
    expect(chunks.length).toBe(Math.ceil(FRAMES / CHUNK_FRAMES))
    let next = 0
    for (const chunk of chunks) {
      expect(chunk.start).toBe(next)
      expect(chunk.values.length).toBe(chunk.count * FEATURE_STRIDE)
      next += chunk.count
    }
    expect(next).toBe(FRAMES)
    const all = new Float64Array(FRAMES * FEATURE_STRIDE)
    for (const chunk of chunks) all.set(chunk.values, chunk.start * FEATURE_STRIDE)
    expect(all).toEqual(expected(0, FRAMES))
    expect(posted.at(-1)).toEqual({ type: 'done', generation: 1 })
  })

  it('measures a seek beyond the covered frames first, from a warm-up before it with a fresh extractor', () => {
    const { core, columns, runAll } = worker()
    core.handle({ type: 'load', generation: 1, sampleRate: SR, left: signal(), right: null, settings: DEFAULT_FEATURE_SETTINGS, fromMs: 0 })
    core.step()
    const seekMs = 6500
    core.handle({ type: 'seek', generation: 1, ms: seekMs })
    core.step()
    const start = Math.floor((seekMs * GRID.hz) / 1000) - Math.round((PRECOMPUTE_LIMITS.warmupMs * GRID.hz) / 1000)
    const priority = columns()[1]
    expect(priority.start).toBe(start)
    runAll()
    // The priority segment runs to the end of the file, then the linear pass resumes and stops where it starts.
    const fromSeek = columns().filter((c) => c.start >= start)
    const values = new Float64Array((FRAMES - start) * FEATURE_STRIDE)
    for (const chunk of fromSeek) values.set(chunk.values, (chunk.start - start) * FEATURE_STRIDE)
    expect(values).toEqual(expected(start, FRAMES))
    const linear = columns().filter((c) => c.start < start)
    expect(linear.reduce((n, c) => n + c.count, 0)).toBe(start)
    expect(columns().indexOf(fromSeek[0])).toBe(1)
  })

  it('ignores a seek into frames already measured or about to be', () => {
    const { core, columns } = worker()
    core.handle({ type: 'load', generation: 1, sampleRate: SR, left: signal(), right: null, settings: DEFAULT_FEATURE_SETTINGS, fromMs: 0 })
    core.step()
    core.step()
    core.handle({ type: 'seek', generation: 1, ms: 500 })
    core.handle({ type: 'seek', generation: 1, ms: 3000 })
    core.step()
    expect(columns().map((c) => c.start)).toEqual([0, CHUNK_FRAMES, 2 * CHUNK_FRAMES])
  })

  it('drops the old generation on new settings and measures from the playhead first', () => {
    const { core, columns, runAll } = worker()
    core.handle({ type: 'load', generation: 1, sampleRate: SR, left: signal(), right: null, settings: DEFAULT_FEATURE_SETTINGS, fromMs: 0 })
    core.step()
    const louder = { ...DEFAULT_FEATURE_SETTINGS, sensitivity: 12 }
    core.handle({ type: 'settings', generation: 2, settings: louder, fromMs: 7000 })
    // A stale seek of the old generation does nothing.
    core.handle({ type: 'seek', generation: 1, ms: 100 })
    runAll()
    const later = columns().slice(1)
    expect(later.every((c) => c.generation === 2)).toBe(true)
    expect(later[0].start).toBe(Math.floor((7000 * GRID.hz) / 1000) - Math.round((PRECOMPUTE_LIMITS.warmupMs * GRID.hz) / 1000))
    const linear = later.filter((c) => c.start < later[0].start)
    const values = new Float64Array(later[0].start * FEATURE_STRIDE)
    for (const chunk of linear) values.set(chunk.values, chunk.start * FEATURE_STRIDE)
    expect(values).toEqual(expected(0, later[0].start, louder))
  })
})
