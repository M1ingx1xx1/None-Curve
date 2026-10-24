// The feature worker's core (src/sound/featureWorkerCore.ts) with a fake `post`: it measures the file in chunks, in
// order, exactly as one offline pass would; a seek beyond what is covered is measured first, from a warm-up before it
// with a fresh extractor; and new settings drop the old generation's work. The page's timeline
// (src/sound/featureTimeline.ts) over a fake worker running that core keeps what arrives for the current generation.

import { describe, expect, it } from 'vitest'
import { analyserFftSize, FeatureExtractor } from '../../src/sound/features'
import { FeatureTimeline, type FeatureWorkerLike } from '../../src/sound/featureTimeline'
import {
  CHUNK_FRAMES,
  FeatureWorkerCore,
  type FeatureWorkerRequest,
  type FeatureWorkerResponse,
} from '../../src/sound/featureWorkerCore'
import { gridFrameCount, highpassInPlace, measureFrames } from '../../src/sound/offline'
import { FEATURE_STRIDE, packFrame, PRECOMPUTE_LIMITS, unpackFrame } from '../../src/sound/timelineTypes'
import { DEFAULT_FEATURE_SETTINGS, type FeatureSettings } from '../../src/sound/types'
import { drumHits, glide, hitTimes, mix, SR } from '../helpers/audio'

const SECONDS = 8
const signal = () => Float32Array.from(mix(drumHits(hitTimes(2, SECONDS), SECONDS), glide(110, 880, SECONDS, -12)))
const GRID = { hz: PRECOMPUTE_LIMITS.gridHz }

/** What one offline pass gives for frames from..to, packed: the high-passed signal, a fresh extractor at `from`. */
function expected(from: number, to: number, settings: FeatureSettings = DEFAULT_FEATURE_SETTINGS): Float64Array {
  const left = signal()
  highpassInPlace(left, SR)
  const frames = measureFrames(
    { left, right: left },
    SR,
    settings,
    GRID,
    from,
    to,
    new FeatureExtractor(SR, analyserFftSize(SR)),
  )
  const values = new Float64Array(frames.length * FEATURE_STRIDE)
  frames.forEach((frame, row) => packFrame(frame, values, row))
  return values
}

function worker() {
  const posted: FeatureWorkerResponse[] = []
  const core = new FeatureWorkerCore((message) => posted.push(message))
  const columns = () =>
    posted.filter((m): m is Extract<FeatureWorkerResponse, { type: 'columns' }> => m.type === 'columns')
  const runAll = () => {
    while (core.step());
  }
  return { core, posted, columns, runAll }
}

const FRAMES = gridFrameCount(SR * SECONDS, SR, GRID)

describe('feature worker core', () => {
  it('posts the chunks in order, and together they are one offline pass', () => {
    const { core, posted, columns, runAll } = worker()
    core.handle({
      type: 'load',
      generation: 1,
      sampleRate: SR,
      left: signal(),
      right: null,
      settings: DEFAULT_FEATURE_SETTINGS,
      fromMs: 0,
    })
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
    core.handle({
      type: 'load',
      generation: 1,
      sampleRate: SR,
      left: signal(),
      right: null,
      settings: DEFAULT_FEATURE_SETTINGS,
      fromMs: 0,
    })
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
    core.handle({
      type: 'load',
      generation: 1,
      sampleRate: SR,
      left: signal(),
      right: null,
      settings: DEFAULT_FEATURE_SETTINGS,
      fromMs: 0,
    })
    core.step()
    core.step()
    core.handle({ type: 'seek', generation: 1, ms: 500 })
    core.handle({ type: 'seek', generation: 1, ms: 3000 })
    core.step()
    expect(columns().map((c) => c.start)).toEqual([0, CHUNK_FRAMES, 2 * CHUNK_FRAMES])
  })

  it('drops the old generation on new settings and measures from the playhead first', () => {
    const { core, columns, runAll } = worker()
    core.handle({
      type: 'load',
      generation: 1,
      sampleRate: SR,
      left: signal(),
      right: null,
      settings: DEFAULT_FEATURE_SETTINGS,
      fromMs: 0,
    })
    core.step()
    const louder = { ...DEFAULT_FEATURE_SETTINGS, sensitivity: 12 }
    core.handle({ type: 'settings', generation: 2, settings: louder, fromMs: 7000 })
    // A stale seek of the old generation does nothing.
    core.handle({ type: 'seek', generation: 1, ms: 100 })
    runAll()
    const later = columns().slice(1)
    expect(later.every((c) => c.generation === 2)).toBe(true)
    expect(later[0].start).toBe(
      Math.floor((7000 * GRID.hz) / 1000) - Math.round((PRECOMPUTE_LIMITS.warmupMs * GRID.hz) / 1000),
    )
    const linear = later.filter((c) => c.start < later[0].start)
    const values = new Float64Array(later[0].start * FEATURE_STRIDE)
    for (const chunk of linear) values.set(chunk.values, chunk.start * FEATURE_STRIDE)
    expect(values).toEqual(expected(0, later[0].start, louder))
  })
})

describe('feature timeline', () => {
  /** A worker running the real core; `pump` lets it measure (its messages arrive one by one, as a worker's would). */
  function fakeWorker() {
    const outbox: FeatureWorkerResponse[] = []
    const worker: FeatureWorkerLike & { pump: () => void; sent: FeatureWorkerRequest[] } = {
      onmessage: null,
      sent: [],
      postMessage(message) {
        this.sent.push(message)
        core.handle(message)
      },
      terminate() {},
      pump() {
        while (core.step()) {
          for (const m of outbox.splice(0)) this.onmessage?.({ data: m } as MessageEvent<FeatureWorkerResponse>)
        }
        for (const m of outbox.splice(0)) this.onmessage?.({ data: m } as MessageEvent<FeatureWorkerResponse>)
      },
    }
    const core = new FeatureWorkerCore((message) => outbox.push(message))
    return worker
  }

  /** A decoded AudioBuffer stand-in. */
  const decoded = (seconds: number) => {
    const data = signal().subarray(0, SR * seconds)
    return async () =>
      ({
        duration: data.length / SR,
        length: data.length,
        sampleRate: SR,
        numberOfChannels: 1,
        getChannelData: () => data,
      }) as unknown as AudioBuffer
  }
  const blob = new Blob([new Uint8Array(4)])

  it('keeps the frames the worker measures, and reads them back by index and time', async () => {
    const worker = fakeWorker()
    const timeline = new FeatureTimeline(() => worker)
    expect(await timeline.load(blob, decoded(SECONDS), DEFAULT_FEATURE_SETTINGS)).toBe(true)
    expect(timeline.frameCount()).toBe(FRAMES)
    expect(timeline.covered(1000)).toBe(false)
    worker.pump()
    const want = expected(0, FRAMES)
    for (const index of [0, 1, 60, FRAMES - 1])
      expect(timeline.frameAt(index)).toEqual(unpackFrame(want, index, (index * 1000) / GRID.hz))
    expect(timeline.covered(SECONDS * 1000 - 10)).toBe(true)
    // Between two grid frames: interpolated, events from the earlier one.
    const a = timeline.frameAt(60)!
    const b = timeline.frameAt(61)!
    const mid = timeline.at(1000 + 500 / GRID.hz)!
    expect(mid.level).toBeCloseTo((a.level + b.level) / 2, 12)
    expect(mid.onset).toBe(a.onset)
  })

  it('pauses measuring and resumes it, keeping what was measured', async () => {
    const worker = fakeWorker()
    const timeline = new FeatureTimeline(() => worker)
    await timeline.load(blob, decoded(SECONDS), DEFAULT_FEATURE_SETTINGS)
    timeline.pause()
    worker.pump()
    expect(timeline.isLoaded()).toBe(true)
    expect(timeline.covered(0)).toBe(false)
    timeline.resume()
    worker.pump()
    expect(timeline.covered(SECONDS * 1000 - 10)).toBe(true)
  })

  it('keeps a file whose samples would pass the byte cap on the live path, before copying them', async () => {
    const worker = fakeWorker()
    const timeline = new FeatureTimeline(() => worker)
    // 360 s at 96 kHz stereo: twice the cap.
    const big = async () =>
      ({
        duration: 360,
        length: 360 * 96_000,
        sampleRate: 96_000,
        numberOfChannels: 2,
        getChannelData: () => {
          throw new Error('copied')
        },
      }) as unknown as AudioBuffer
    expect(await timeline.load(blob, big, DEFAULT_FEATURE_SETTINGS)).toBe(false)
    expect(timeline.isLoaded()).toBe(false)
  })

  it('measures again with new settings, and drops frames of the old generation', async () => {
    const worker = fakeWorker()
    const timeline = new FeatureTimeline(() => worker)
    await timeline.load(blob, decoded(SECONDS), DEFAULT_FEATURE_SETTINGS)
    worker.pump()
    const generation = timeline.currentGeneration()
    const louder = { ...DEFAULT_FEATURE_SETTINGS, sensitivity: 12 }
    timeline.setSettings(louder, 2000)
    expect(timeline.currentGeneration()).toBe(generation + 1)
    expect(timeline.covered(2000)).toBe(false)
    // A stale chunk of the old generation is ignored.
    worker.onmessage?.({
      data: { type: 'columns', generation, start: 0, count: 1, values: new Float64Array(FEATURE_STRIDE) },
    } as MessageEvent<FeatureWorkerResponse>)
    expect(timeline.covered(0)).toBe(false)
    worker.pump()
    expect(timeline.frameAt(10)).toEqual(unpackFrame(expected(0, 11, louder), 10, (10 * 1000) / GRID.hz))
    // Too long a file stays live.
    const long = async () =>
      ({
        duration: PRECOMPUTE_LIMITS.maxSeconds + 1,
        length: 10,
        sampleRate: SR,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(10),
      }) as unknown as AudioBuffer
    expect(await timeline.load(blob, long, DEFAULT_FEATURE_SETTINGS)).toBe(false)
    expect(timeline.isLoaded()).toBe(false)
  })

  it('measured from the start, reports how far every frame is measured; a chunk out of order does not count yet', async () => {
    const worker = fakeWorker()
    const timeline = new FeatureTimeline(() => worker)
    await timeline.load(blob, decoded(SECONDS), DEFAULT_FEATURE_SETTINGS, 0)
    expect(worker.sent.at(-1)).toMatchObject({ type: 'load', fromMs: 0 })
    expect(timeline.measuredUntil()).toBe(0)
    const generation = timeline.currentGeneration()
    const chunk = (start: number, count: number) =>
      worker.onmessage?.({
        data: { type: 'columns', generation, start, count, values: new Float64Array(count * FEATURE_STRIDE) },
      } as MessageEvent<FeatureWorkerResponse>)
    chunk(60, 30)
    expect(timeline.measuredUntil()).toBe(0)
    chunk(0, 60)
    expect(timeline.measuredUntil()).toBe((90 * 1000) / GRID.hz)
    worker.pump()
    expect(timeline.measuredUntil()).toBe((FRAMES * 1000) / GRID.hz)
    // New settings: measured again from the start.
    timeline.setSettings({ ...DEFAULT_FEATURE_SETTINGS, sensitivity: 12 })
    expect(worker.sent.at(-1)).toMatchObject({ type: 'settings', fromMs: 0 })
    expect(timeline.measuredUntil()).toBe(0)
  })
})
