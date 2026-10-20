// Glide chains planned in the workers (src/geometry/aheadCore.ts, NOCUR-82): over a scripted run of commits, the
// worker's chain works out the same shapes on screen and the same plans as SceneGlide pairing on the page at the same
// times; the page uses the chained plans when its shapes match (state/aheadGeometry.ts); and a plan asked of a worker
// on the live path starts its glide when it arrives.

import { describe, expect, it } from 'vitest'
import { AheadCore, type StepRecord } from '../../src/geometry/aheadCore'
import { paramsKey } from '../../src/geometry/cache'
import { packGeometry } from '../../src/geometry/packed'
import { deriveGeometry } from '../../src/geometry/pipeline'
import type { AheadItem } from '../../src/geometry/protocol'
import type { GeometryParams, PolygonGlyph } from '../../src/geometry/types'
import { easeOut, GLIDE_LIMITS, SceneGlide } from '../../src/specimen/glide'
import { planMorph, settleInBetween, type MorphPlan } from '../../src/specimen/morph'
import { encodeSettled } from '../../src/specimen/planCodec'
import { placePolygons, shapeSpecimen, type SpecimenScene } from '../../src/specimen/scene'
import type { AheadListener, GeometryClient } from '../../src/state/geometryClient'
import type { PlanSource } from '../../src/state/aheadTypes'
import { PageAhead } from '../../src/state/aheadGeometry'
import { AheadStore } from '../../src/state/aheadStore'
import { loadFixture } from '../helpers/fonts'
import { burst, thorny, whorl } from '../helpers/planCases'

const GLIDE = 150

describe('Glide chains', async () => {
  const font = await loadFixture('Roboto')
  const shaped = shapeSpecimen(font, 'Ha')
  /** Each key's polygons, computed once per side (the page and the worker each hold their own objects). */
  const side = () => {
    const cache = new Map<string, PolygonGlyph>()
    return (params: GeometryParams, index: number) => {
      const id = `${paramsKey(params)}|${index}`
      let polygon = cache.get(id)
      if (!polygon) cache.set(id, (polygon = deriveGeometry(font.getGlyph(index), params).polygon))
      return polygon
    }
  }

  interface Run {
    times: number[]
    params: GeometryParams[]
  }
  const steady: Run = { times: [0, 33, 66, 99, 132, 165], params: [burst(1), burst(2), burst(3), burst(4), burst(5), burst(6)] }
  // A gap long enough to arrive (q ≥ 0.99), the same key again on the way (glides on to it), then again once arrived (unchanged).
  const gaps: Run = {
    times: [0, 33, 66, 196, 229, 400, 433],
    params: [burst(1), burst(2), burst(3), burst(4), burst(4), burst(4), burst(5)],
  }
  const whorled: Run = { times: [0, 33, 66, 99], params: [whorl(0.3), whorl(0.6), thorny(0.9, 0.05), whorl(1.2)] }

  /** Lineage of occurrence `k` at commit `seq` (one per commit: the history grows by one each time). */
  const lineageOf = (seq: number, k: number) => 100 * (seq + 1) + k

  /** The worker's chain over the run: its records, commit by commit. */
  function workerChain(run: Run): StepRecord[][] {
    const core = new AheadCore()
    core.begin('roboto', 1)
    const polygon = side()
    return run.times.map((mediaMs, seq) => {
      const key = paramsKey(run.params[seq])
      for (const index of shaped.indices) {
        const { source: _source, ...geometry } = deriveGeometry(font.getGlyph(index), run.params[seq])
        core.put(key, index, { packed: packGeometry({ ...geometry, polygon: polygon(run.params[seq], index) }).packed }, seq)
      }
      return occurrences().map(({ index }, k) => core.step(seq, mediaMs, lineageOf(seq, k), seq > 0 ? lineageOf(seq - 1, k) : -1, index, key, GLIDE))
    })
  }

  const occurrences = () => shaped.lines.flatMap((l) => l.glyphs)
  const sceneFor = (polygon: ReturnType<typeof side>, params: GeometryParams): SpecimenScene => placePolygons(shaped, (index) => ({ polygon: polygon(params, index) }))
  /** The plan each occurrence glides by just after `now` (null when it does not glide). */
  const plansAt = (glide: SceneGlide, now: number): (MorphPlan | null)[] => {
    // The frame at `now` pairs (the page's store draws one as soon as a scene comes); the next shows the morphs.
    glide.frameInfo(now)
    const frame = glide.frameInfo(now + 1)
    return (frame.morphs ?? occurrences().map(() => null)).map((m) => m?.plan ?? null)
  }

  for (const [name, run] of [
    ['steady', steady],
    ['gaps', gaps],
    ['Whorl', whorled],
  ] as const) {
    it(`${name}: the worker's chain plans what SceneGlide pairs on the page at the same times`, () => {
      const records = workerChain(run)
      const polygon = side()
      const glide = new SceneGlide(() => 0)
      run.times.forEach((now, seq) => {
        glide.retarget(sceneFor(polygon, run.params[seq]), now, { durationMs: GLIDE, glide: seq > 0, key: 'k' })
        const plans = plansAt(glide, now)
        records[seq].forEach((record, k) => {
          const plan = plans[k]
          if (record.unchanged) {
            expect(plan, `${seq}/${k}`).toBeNull()
            return
          }
          expect(record.data, `${seq}/${k}`).not.toBeNull()
          const { settled, ...data } = record.data!
          const { settled: none, ...mine } = plan!.data!
          expect(none).toBeNull()
          expect(data).toEqual(mine)
          // The page's plan starts from the settled shape the worker sent (or from the shape itself).
          expect(settled ?? encodeSettled(plan!.from)).toEqual(encodeSettled(plan!.from))
        })
      })
    })
  }

  it('says where each glide starts from: computed when arrived (q ≥ 0.99), in between otherwise; unchanged for the same glyph', () => {
    const records = workerChain(gaps)
    const kinds = records.map((r) => r[0].from.kind + (r[0].unchanged ? ' unchanged' : ''))
    expect(kinds).toEqual(['computed unchanged', 'computed', 'between', 'computed', 'between', 'computed unchanged', 'computed'])
    const q = easeOut((196 - 66) / GLIDE)
    expect(q).toBeGreaterThanOrEqual(GLIDE_LIMITS.arrived)
    expect(records[2][0].from).toEqual({ kind: 'between', lineage: lineageOf(1, 0), seq: 1, q: easeOut(33 / GLIDE) })
    expect(records[3][0].from).toEqual({ kind: 'computed', key: paramsKey(gaps.params[2]) })
  })

  it('the page uses the chained plans when its shapes match, and pairs nothing itself', async () => {
    for (const run of [steady, gaps, whorled]) {
      const records = workerChain(run)
      const polygon = side()
      const keys = new Map<PolygonGlyph, string>()
      for (const params of run.params) for (const index of shaped.indices) keys.set(polygon(params, index), paramsKey(params))
      // A client that holds every glyph and hands the steps' records straight back.
      let listener: AheadListener | null = null
      const client = {
        setAheadListener: (l: AheadListener) => (listener = l),
        has: () => true,
        sendAhead: (_font: string, generation: number, _glide: number, _playhead: number, items: readonly AheadItem[]) => {
          const seqs = [...new Set(items.filter((i) => i.kind === 'step').map((i) => i.seq))]
          queueMicrotask(() => {
            for (const seq of seqs) listener!.plans({ type: 'ahead-plans', requestId: 1, generation, seq, plans: records[seq] })
          })
          return true
        },
        releaseAhead: () => {},
        aheadStore: new AheadStore(),
        workerCount: () => 1,
        requestPlan: () => null,
      } as unknown as GeometryClient
      const ahead = new PageAhead(() => client)
      const commits = run.times.map((mediaMs, seq) => ({
        seq,
        prevSeq: seq - 1,
        mediaMs,
        endMs: mediaMs + 33,
        jobs: [],
        steps: occurrences().map(({ index }, k) => ({ lineage: lineageOf(seq, k), parent: seq > 0 ? lineageOf(seq - 1, k) : -1, index, key: paramsKey(run.params[seq]) })),
      }))
      ahead.want({ generation: 1, level: 1, fontId: 'roboto', glideMs: GLIDE, playheadMs: 0, dueSeq: 0, commits })
      await Promise.resolve()
      for (const commit of commits) expect(ahead.ready(commit.seq)).toBe(true)
      let hits = 0
      let misses = 0
      const source: PlanSource = {
        chained: (...args) => {
          const plan = ahead.chained(...args)
          if (plan === undefined) misses++
          else hits++
          return plan
        },
        request: () => {
          throw new Error('no glyph should be paired on the page')
        },
      }
      // A glyph paired on the page (by a request, with worker plans on) would throw: every one is chained.
      const glide = new SceneGlide(() => 0, { plans: () => source, workerPlans: true, keyOf: (p) => keys.get(p) ?? null })
      run.times.forEach((now, seq) => {
        const lineage = Int32Array.from(occurrences().map((_, k) => lineageOf(seq, k)))
        glide.retarget(sceneFor(polygon, run.params[seq]), now, { durationMs: GLIDE, glide: seq > 0, key: 'k', chain: { lineage, seq, prevSeq: seq - 1 } })
        const plans = plansAt(glide, now)
        records[seq].forEach((record, k) => {
          if (record.unchanged || !record.data) expect(plans[k]).toBeNull()
          else expect(plans[k]!.data!.tracks).toEqual(record.data.tracks)
        })
      })
      expect(misses).toBe(0)
      expect(hits).toBe(records.slice(1).flat().filter((r) => !r.unchanged).length)
    }
  })

  it('a chained plan whose start does not match the shape on screen is not used', async () => {
    const records = workerChain(steady)
    let listener: AheadListener | null = null
    const client = {
      setAheadListener: (l: AheadListener) => (listener = l),
      has: () => true,
      sendAhead: () => true,
      releaseAhead: () => {},
      aheadStore: new AheadStore(),
      workerCount: () => 1,
    } as unknown as GeometryClient
    const ahead = new PageAhead(() => client)
    ahead.want({ generation: 1, level: 1, fontId: 'roboto', glideMs: GLIDE, playheadMs: 0, dueSeq: 0, commits: [] })
    listener!.plans({ type: 'ahead-plans', requestId: 1, generation: 1, seq: 2, plans: records[2] })
    const polygon = side()
    const from = polygon(burst(3), shaped.indices[0])
    const to = polygon(burst(4), shaped.indices[0])
    const record = records[2][0]
    expect(record.from.kind).toBe('between')
    const tag = record.from.kind === 'between' ? record.from : null
    // Another lineage, another commit, or another progress: no.
    expect(ahead.chained(lineageOf(2, 0), 2, from, to, { lineage: tag!.lineage + 1, seq: tag!.seq, q: tag!.q }, null)).toBeUndefined()
    expect(ahead.chained(lineageOf(2, 0), 2, from, to, { lineage: tag!.lineage, seq: tag!.seq, q: tag!.q + 0.01 }, null)).toBeUndefined()
    expect(ahead.chained(lineageOf(2, 0), 2, from, to, null, 'some key')).toBeUndefined()
    expect(ahead.chained(lineageOf(2, 0), 3, from, to, tag, null)).toBeUndefined()
    expect(ahead.chained(lineageOf(2, 0), 2, from, to, { ...tag! }, null)).toBeTruthy()
  })

  it('with an async PlanSource, a glyph shows its old shape until its plan arrives, then glides from that frame', () => {
    const polygon = side()
    const a = sceneFor(polygon, burst(1))
    const b = sceneFor(polygon, burst(2))
    const waiting: { from: PolygonGlyph; to: PolygonGlyph; done: (plan: MorphPlan | null) => void }[] = []
    let cancelled = 0
    let notified = 0
    const source: PlanSource = {
      chained: () => undefined,
      request: (job, done) => {
        waiting.push({ from: job.from, to: job.to, done })
        return () => cancelled++
      },
    }
    const glide = new SceneGlide(() => 0, { plans: () => source, workerPlans: true, onPlan: () => notified++ })
    glide.retarget(a, 0, { durationMs: GLIDE, glide: false, key: 'k' })
    glide.retarget(b, 0, { durationMs: GLIDE, glide: true, key: 'k' })
    const first = glide.frame(10)!
    const olds = a.lines.flatMap((l) => l.glyphs.map((g) => g.polygon))
    expect(first.lines.flatMap((l) => l.glyphs.map((g) => g.polygon))).toEqual(olds)
    expect(waiting).toHaveLength(2)
    expect(glide.moving(500)).toBe(true)
    // The plans arrive at 40; the next frame (50) starts them.
    for (const w of waiting) w.done(planMorph(settleInBetween(w.from, w.to), w.to))
    expect(notified).toBe(2)
    const at50 = glide.frameInfo(50)
    expect(at50.morphs).toBeNull()
    const later = glide.frameInfo(50 + GLIDE / 2)
    expect(later.morphs!.every((m) => m !== null && m.p === easeOut(0.5))).toBe(true)
    expect(glide.frame(50 + GLIDE)).toBe(b)
    expect(cancelled).toBe(0)
  })

  it('a new scene cancels the plans it no longer waits on, and keeps one for the same outlines', () => {
    const polygon = side()
    const scenes = [burst(1), burst(2), burst(3)].map((p) => sceneFor(polygon, p))
    const asked: { to: PolygonGlyph; cancelled: boolean }[] = []
    const source: PlanSource = {
      chained: () => undefined,
      request: (job) => {
        const entry = { to: job.to, cancelled: false }
        asked.push(entry)
        return () => (entry.cancelled = true)
      },
    }
    const glide = new SceneGlide(() => 0, { plans: () => source, workerPlans: true })
    glide.retarget(scenes[0], 0, { durationMs: GLIDE, glide: false, key: 'k' })
    glide.retarget(scenes[1], 0, { durationMs: GLIDE, glide: true, key: 'k' })
    glide.frame(5)
    expect(asked).toHaveLength(2)
    // Nothing was paired yet: the glyphs still show their old shapes, so the next scene asks from the same outlines anew.
    glide.retarget(scenes[2], 10, { durationMs: GLIDE, glide: true, key: 'k' })
    expect(asked.every((a) => a.cancelled)).toBe(true)
    glide.frame(15)
    expect(asked).toHaveLength(4)
    // The same scene's outlines again (a scene object made anew): the asks on their way go on serving.
    glide.retarget({ ...scenes[2] }, 20, { durationMs: GLIDE, glide: true, key: 'k' })
    expect(asked.slice(2).some((a) => a.cancelled)).toBe(false)
  })
})
