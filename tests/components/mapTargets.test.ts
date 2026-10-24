// Drag to map (src/components/mapDrag.ts): every target Sound can drive has a drop zone. The panels are rendered to
// markup and their MapTarget anchors (data-map-target, rendered by each control's live marker) are collected, in
// every state that shows a different control (Flatten's two modes and Merge joined curves, Thorn's Burst), and compared with TARGETS and the
// loaded font's axes. Each anchor must mark a zone of its own (no two share a field).

import { createElement, type ComponentType, type Dispatch } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The live values need the running app; a control that Sound does not drive shows no marker, only its anchor.
vi.mock('../../src/sound/live', () => ({
  useLivePosition: () => null,
  useLiveSeed: () => null,
  useLiveDriving: () => false,
  useLiveStatus: () => ({ driving: false }),
  LIVE_LIMITS: {},
}))

const { default: FlattenControls } = await import('../../src/components/FlattenControls')
const { default: SquaringControls } = await import('../../src/components/SquaringControls')
const { default: AnchorControls } = await import('../../src/components/AnchorControls')
const { default: GridControls } = await import('../../src/components/GridControls')
const { default: DistortionControls } = await import('../../src/components/DistortionControls')
const { default: RandomAnchorControls } = await import('../../src/components/RandomAnchorControls')
const { default: ExperimentalControls } = await import('../../src/components/ExperimentalControls')
const { default: TypographyControls } = await import('../../src/components/TypographyControls')
const { default: ColorControls } = await import('../../src/components/ColorControls')
const { default: FontStatus } = await import('../../src/components/FontStatus')
const { axisTargets, setTargetFont, TARGETS } = await import('../../src/sound/mapping')
const { initialState } = await import('../../src/state/editorState')
const { loadFixture } = await import('../helpers/fonts')

const dispatch: Dispatch<unknown> = () => {}
const params = initialState.params
const common = { pending: false, disabled: false, dispatch, stats: null }

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/**
 * The anchors in a markup string, each with the element MapTarget marks as its zone: the nearest `.field` or `li`
 * around it (ZONE_SELECTOR), else its parent, as an index into the markup's elements; a labelled anchor (a colour's
 * Hue or Lightness chip) is a zone of its own. React escapes `<` and `>` in attributes, so a tag ends at its `>`.
 */
function zones(html: string): { target: string; zone: number }[] {
  const stack: { index: number; tag: string; isZone: boolean }[] = []
  const found: { target: string; zone: number }[] = []
  let count = 0
  for (const [, close, tag, attrs] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if (close) {
      stack.pop()
      continue
    }
    const index = count++
    const classes = /\bclass="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? []
    const target = /\bdata-map-target="([^"]+)"/.exec(attrs)?.[1]
    if (target) {
      const own = classes.includes('map-zone-chip')
      const zone = own ? index : ([...stack].reverse().find((el) => el.isZone) ?? stack[stack.length - 1])?.index
      expect(zone, `anchor ${target} has no zone`).toBeDefined()
      found.push({ target, zone: zone! })
    }
    if (!VOID.has(tag) && !attrs.trimEnd().endsWith('/'))
      stack.push({ index, tag, isZone: tag === 'li' || classes.includes('field') })
  }
  return found
}

/**
 * The target ids of the anchors in a component's markup. No two anchors may mark the same zone: the second would
 * overwrite the first's data-map-zone, and nothing could be dropped on the first target.
 */
function anchors<P extends object>(component: ComponentType<P>, props: P): string[] {
  const found = zones(renderToStaticMarkup(createElement(component, props)))
  const shared = found.filter((a, i) => found.findIndex((b) => b.zone === a.zone) !== i)
  expect(shared.map((a) => a.target)).toEqual([])
  return found.map((a) => a.target)
}

describe('Drop zones', () => {
  it('are one per anchor (the markup reader finds a shared field)', () => {
    const shared = zones(
      '<div class="field"><span data-map-target="a" hidden=""></span><span data-map-target="b" hidden=""></span></div>',
    )
    expect(shared[0].zone).toBe(shared[1].zone)
    const own = zones(
      '<ul><li><input/><span data-map-target="a" hidden=""></span></li><li><span data-map-target="b" hidden=""></span></li></ul>',
    )
    expect(own[0].zone).not.toBe(own[1].zone)
  })

  it('cover every target, in every tab', async () => {
    const thorn = params.experimental.thorn
    const found = [
      ...(['adaptive', 'segments'] as const).flatMap((mode) =>
        [false, true].flatMap((mergeCurves) =>
          anchors(FlattenControls, {
            ...common,
            params: { ...params.flatten, mode, mergeCurves },
            unitsPerEm: 1000,
            replacedByRandom: false,
          }),
        ),
      ),
      ...anchors(SquaringControls, { ...common, params: params.squaring }),
      ...anchors(AnchorControls, { ...common, params: params.anchors, unitsPerEm: 1000 }),
      ...anchors(GridControls, { ...common, params: params.grid, unitsPerEm: 1000 }),
      ...anchors(DistortionControls, { ...common, params: params.distortion, finalVertices: null }),
      ...anchors(RandomAnchorControls, { ...common, params: params.random }),
      ...[false, true].flatMap((burst) =>
        anchors(ExperimentalControls, {
          ...common,
          params: { ...params.experimental, thorn: { ...thorn, burst } },
          reachEm: 1,
        }),
      ),
      ...anchors(TypographyControls, {
        params: params.typography,
        artboard: params.artboard,
        font: null,
        scene: null,
        loadSliderScene: async () => null,
        disabled: false,
        dispatch,
      }),
      ...anchors(ColorControls, { params: params.palette, disabled: false, dispatch }),
    ]
    const ids = new Set(found)
    const missing = TARGETS.map((t) => t.id).filter((id) => !ids.has(id))
    expect(missing).toEqual([])
    // Nothing that is not a target.
    expect([...ids].filter((id) => !TARGETS.some((t) => t.id === id))).toEqual([])
  })

  it("cover the loaded font's variable axes", async () => {
    const stix = await loadFixture('STIXTwoText')
    setTargetFont(stix)
    const found = anchors(FontStatus, {
      status: { kind: 'ready' },
      font: stix,
      onRetry: () => {},
      onCancel: () => {},
      onFace: () => {},
    })
    expect(axisTargets().length).toBeGreaterThan(0)
    expect(found).toEqual(axisTargets().map((t) => t.id))
    setTargetFont(null)
  })
})
