// Drag to map (docs/SOUND_PLAN.md §5): a feature is dragged from its meter in the Sound tab's Input box and dropped on
// any control Sound can drive, or on its entry in the drop palette that opens beside the panel while dragging
// (MapDragLayer), which maps that feature to it. Pointer events, not HTML drag and drop, so a small
// chip follows the pointer exactly. Every control a mapping can drive is a drop zone: its live marker (LiveMarker,
// LiveSeed, LiveSwitch, LiveColor, LiveAxis) renders a MapTarget anchor, which marks the control's field with
// data-map-zone="<target id>". While a drag (or the keyboard's pick mode) runs, <html data-map-dragging> outlines
// every zone, and the one under the pointer gets data-map-over. Resting on a tab for MAP_DRAG_LIMITS.tabHoverMs
// switches to it.
// The drop itself is the Sound tab's (setDropHandler): it adds the row and switches on what the target needs, as
// Add mapping does.

import { useSyncExternalStore } from 'react'
import { axisTargets, featureById, targetById, TARGETS, type FeatureId, type TargetSpec } from '../sound/mapping'

const MAP_DRAG_LIMITS = {
  /** How far (px) the pointer moves on a meter before a press becomes a drag (a click only focuses the meter). */
  threshold: 4,
  /** How long (ms) the pointer rests on a tab while dragging before the tab opens. */
  tabHoverMs: 400,
  /** How long (ms) the confirmation stays beside the control after a drop. */
  statusMs: 4000,
  /** How near (px) the top or bottom edge of a scrolling panel the pointer scrolls it while dragging. */
  scrollEdge: 32,
} as const

/** The element a target anchor marks as its drop zone: the field it sits in (or a variable axis's row). */
export const ZONE_SELECTOR = '.field, li'

/**
 * The groups of the targets, by tab, as the Sound tab's target select and the drop palette list them; the switches
 * (checkboxes) of every tab have a group of their own. The font's variable axes (axisTargets) come after them.
 */
export const TARGET_GROUPS: readonly { label: string; targets: readonly TargetSpec[] }[] = [
  { label: 'Geometry', targets: TARGETS.filter((t) => t.tab === 'geometry' && t.kind !== 'switch') },
  { label: 'Experimental', targets: TARGETS.filter((t) => t.tab === 'experimental' && t.kind !== 'switch') },
  { label: 'Switches', targets: TARGETS.filter((t) => t.kind === 'switch') },
  { label: 'Typography', targets: TARGETS.filter((t) => t.tab === 'typography') },
  { label: 'Color', targets: TARGETS.filter((t) => t.tab === 'color') },
]

// ---- The drop palette (MapDragLayer) ----

/** One block of the palette: a heading and its targets (each named by its label alone, under its section). */
export interface PaletteBlock {
  /** The group (tab) it opens, shown over its first block only. */
  group: string | null
  title: string
  targets: readonly { id: string; name: string }[]
}

/** The palette's blocks: every target in the target select's order, one block per section (one for the switches). */
export function paletteBlocks(): PaletteBlock[] {
  const groups = [...TARGET_GROUPS]
  const axes = axisTargets()
  if (axes.length) groups.push({ label: 'Variable axes', targets: axes })
  const blocks: PaletteBlock[] = []
  for (const { label, targets } of groups) {
    const whole = label === 'Switches' || label === 'Variable axes'
    const sections = new Map<string, TargetSpec[]>()
    for (const t of targets) {
      const key = whole ? label : t.section
      sections.set(key, [...(sections.get(key) ?? []), t])
    }
    let first = true
    for (const [title, specs] of sections) {
      blocks.push({
        group: first && !whole ? label : null,
        title,
        targets: specs.map((t) => ({ id: t.id, name: whole ? targetName(t) : t.label })),
      })
      first = false
    }
  }
  return blocks
}

/** A palette column's width with its gap (px; .map-palette-column in styles.css). */
export const PALETTE_COLUMN = 162

/** A block's height in entries: its targets, its title, and its group's heading. */
const blockHeight = (block: PaletteBlock) => block.targets.length + (block.group ? 2.5 : 1.5)

/**
 * The blocks in order down `count` columns of about the same height: a column takes blocks until the next would take
 * it further past its share than stopping short does, so the groups read down one column after another.
 */
export function intoColumns(blocks: readonly PaletteBlock[], count: number): PaletteBlock[][] {
  const share = blocks.reduce((sum, block) => sum + blockHeight(block), 0) / count
  const columns: PaletteBlock[][] = [[]]
  let height = 0
  for (const block of blocks) {
    const h = blockHeight(block)
    if (height > 0 && height + h / 2 > share && columns.length < count) {
      columns.push([])
      height = 0
    }
    columns[columns.length - 1].push(block)
    height += h
  }
  return columns
}

/** A target as the Sound tab names it: "Distortion · Noise amplitude", or the label alone when both are the same ("Seed"). */
export function targetName(target: Pick<TargetSpec, 'section' | 'label'>): string {
  return target.section === target.label ? target.label : `${target.section} · ${target.label}`
}

/** What a drop did, as the Sound tab reports it. */
export interface DropOutcome {
  /** One or two short sentences for the confirmation and screen readers. */
  message: string
  /** The row the drop made or found, if any. */
  mappingId: string | null
  /** True when the drop added the row; false when the same mapping was there already (or none could be added). */
  created: boolean
}

export type DropHandler = (feature: FeatureId, target: string) => DropOutcome

export interface MapDragState {
  /** The feature being dragged or picking a target, or null. */
  feature: FeatureId | null
  mode: 'pointer' | 'keyboard' | null
  /** The pointer, in viewport pixels (pointer mode). */
  x: number
  y: number
  /** The target under the pointer, or the one the keyboard is on. */
  over: string | null
  /** The confirmation after a drop, beside the control (viewport pixels); `key` restarts it for each drop. */
  status: { text: string; left: number; top: number; key: number } | null
  /** The row the last drop made (`created`) or found, marked in the Sound tab until it is used. */
  marked: { id: string; created: boolean } | null
  /** What screen readers hear (an aria-live region in MapDragLayer). */
  announcement: string
}

const IDLE: MapDragState = { feature: null, mode: null, x: 0, y: 0, over: null, status: null, marked: null, announcement: '' }

let state: MapDragState = IDLE
const listeners = new Set<() => void>()
let dropHandler: DropHandler | null = null

function set(patch: Partial<MapDragState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function getMapDragState(): MapDragState {
  return state
}

function subscribeMapDrag(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The drag's state; re-renders when it changes. */
export function useMapDrag(): MapDragState {
  return useSyncExternalStore(subscribeMapDrag, getMapDragState, () => IDLE)
}

/** How the last drop marked this row: 'new' (it made the row), 'found' (the mapping was there already), or null. */
export function useMarked(id: string): 'new' | 'found' | null {
  const marked = () => (state.marked?.id === id ? (state.marked.created ? 'new' : 'found') : null)
  return useSyncExternalStore(subscribeMapDrag, marked, () => null)
}

/** Sets what a drop does (the Sound tab, while it is mounted); returns the function that unsets it. */
export function setDropHandler(handler: DropHandler): () => void {
  dropHandler = handler
  return () => {
    if (dropHandler === handler) dropHandler = null
  }
}

/** Clears the mark on a row (it was used), or on any row. */
export function clearMark(id?: string) {
  if (state.marked && (id === undefined || state.marked.id === id)) set({ marked: null })
}

// ---- Drop zones ----

/** The drop zone at a point (its data-map-zone names the target), or null. */
function zoneAt(x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint(x, y)
  return hit?.closest<HTMLElement>('[data-map-zone]') ?? null
}

/** The zone of a target, if it is in the document. */
function zoneOf(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-map-zone="${CSS.escape(target)}"]`)
}

const visible = (el: HTMLElement | null): el is HTMLElement => el !== null && el.getClientRects().length > 0

/** The class of the drop palette (MapDragLayer): its entries are drop zones too, beside the controls' own. */
export const PALETTE_CLASS = 'map-palette'

/** The control's own zone of a target when it is on view (not its entry in the drop palette), else null. */
function controlZone(target: string): HTMLElement | null {
  for (const zone of document.querySelectorAll<HTMLElement>(`[data-map-zone="${CSS.escape(target)}"]`)) {
    if (!zone.closest(`.${PALETTE_CLASS}`) && visible(zone)) return zone
  }
  return null
}

let overZone: HTMLElement | null = null

function setOver(zone: HTMLElement | null, target: string | null) {
  if (overZone !== zone) {
    overZone?.removeAttribute('data-map-over')
    zone?.setAttribute('data-map-over', '')
    overZone = zone
  }
  if (state.over !== target) set({ over: target })
}

function setDragging(mode: 'pointer' | 'keyboard' | null) {
  const root = document.documentElement
  if (mode) root.setAttribute('data-map-dragging', mode)
  else root.removeAttribute('data-map-dragging')
}

let statusTimer: ReturnType<typeof setTimeout> | undefined

/** Where a zone is on screen, if it is on view: read before the drag ends, which hides a colour's zones. */
const rectOf = (zone: HTMLElement | null): DOMRect | null => (visible(zone) ? zone.getBoundingClientRect() : null)

/** Runs the drop and shows what it did under the control (`rect`), or at the pointer. */
function drop(feature: FeatureId, target: string, rect: DOMRect | null) {
  const outcome: DropOutcome = dropHandler
    ? dropHandler(feature, target)
    : { message: 'Open the Sound tab to map a feature.', mappingId: null, created: false }
  const left = Math.max(8, Math.min(rect ? rect.left : state.x, window.innerWidth - 280))
  const top = Math.max(8, Math.min(rect ? rect.bottom + 4 : state.y + 16, window.innerHeight - 64))
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => set({ status: null }), MAP_DRAG_LIMITS.statusMs)
  set({
    status: { text: outcome.message, left, top, key: (state.status?.key ?? 0) + 1 },
    marked: outcome.mappingId ? { id: outcome.mappingId, created: outcome.created } : state.marked,
    announcement: outcome.message,
  })
}

function end() {
  setOver(null, null)
  setDragging(null)
  set({ feature: null, mode: null })
}

// ---- Pointer ----

/** Cancels the press on a meter that is under way (or its drag), if any. */
let pressing: (() => void) | null = null

/** Cancels the keyboard's pick that is under way, if any, leaving focus where it is. */
let picking: (() => void) | null = null

/** Cancels any drag, press or keyboard pick under way (the Sound tab unmounting). */
export function cancelMapDrag() {
  pressing?.()
  picking?.()
}

let hoverTab: HTMLElement | null = null
let hoverTimer: ReturnType<typeof setTimeout> | undefined

/** Opens a tab the pointer rests on while dragging. */
function hoverTabAt(hit: Element | null) {
  const tab = hit?.closest<HTMLElement>('[role="tab"]') ?? null
  const closed = tab && tab.getAttribute('aria-selected') !== 'true' ? tab : null
  if (closed === hoverTab) return
  clearTimeout(hoverTimer)
  hoverTab = closed
  if (closed) {
    hoverTimer = setTimeout(() => {
      hoverTab = null
      closed.click()
    }, MAP_DRAG_LIMITS.tabHoverMs)
  }
}

/** The nearest ancestor of `el` that scrolls vertically, if any. */
function scroller(el: Element | null): HTMLElement | null {
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
    if (!(node instanceof HTMLElement) || node.scrollHeight <= node.clientHeight) continue
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}

/**
 * While dragging, a pointer held near the top or bottom edge of a scrolling panel scrolls it, so tabs and
 * controls out of view can be reached without letting go. Returns the function that stops it.
 */
function autoScroll(): () => void {
  let frame = requestAnimationFrame(function step() {
    const panel = scroller(document.elementFromPoint(state.x, state.y))
    if (panel) {
      const rect = panel.getBoundingClientRect()
      const edge = MAP_DRAG_LIMITS.scrollEdge
      const up = state.y - rect.top
      const down = rect.bottom - state.y
      if (up < edge) panel.scrollTop -= Math.ceil((edge - up) / 3)
      else if (down < edge) panel.scrollTop += Math.ceil((edge - down) / 3)
    }
    frame = requestAnimationFrame(step)
  })
  return () => cancelAnimationFrame(frame)
}

/**
 * A press on a feature's meter: past MAP_DRAG_LIMITS.threshold it becomes a drag of that feature. Releasing over a
 * drop zone maps the feature to the zone's target; anywhere else, or Escape, cancels.
 */
export function pressMeter(feature: FeatureId, event: PointerEvent) {
  if (event.button !== 0 || state.mode === 'keyboard') return
  // A press that never saw its release (another pointer, or a pointerup lost while the window was in the background)
  // ends here, so its listeners and scrolling do not pile up.
  pressing?.()
  const startX = event.clientX
  const startY = event.clientY
  const pointerId = event.pointerId
  let dragging = false
  let stopScroll = () => {}

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < MAP_DRAG_LIMITS.threshold) return
      dragging = true
      window.getSelection()?.removeAllRanges()
      setDragging('pointer')
      const name = featureById(feature)?.label ?? feature
      set({ feature, mode: 'pointer', marked: null, announcement: `Dragging ${name}: drop it on a control to map it.` })
      stopScroll = autoScroll()
    }
    e.preventDefault()
    set({ x: e.clientX, y: e.clientY })
    const zone = zoneAt(e.clientX, e.clientY)
    setOver(zone, zone?.getAttribute('data-map-zone') ?? null)
    hoverTabAt(document.elementFromPoint(e.clientX, e.clientY))
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    stop()
    if (!dragging) return
    // The click that follows the release lands on whatever holds both ends of the drag: it must not act.
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    const zone = zoneAt(e.clientX, e.clientY)
    const target = zone?.getAttribute('data-map-zone')
    // Dropped on the palette, the confirmation goes under the control when it is on view, else where the entry was.
    const rect = rectOf((target && controlZone(target)) || zone)
    end()
    if (target && e.type === 'pointerup') drop(feature, target, rect)
    else set({ announcement: 'Mapping cancelled.' })
  }
  // Escape cancels a drag; before the press has become one, it is left to whatever else listens for it.
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !dragging) return
    e.preventDefault()
    e.stopPropagation()
    cancel()
  }
  const cancel = () => {
    stop()
    if (dragging) {
      end()
      set({ announcement: 'Mapping cancelled.' })
    }
  }
  const stop = () => {
    if (pressing === cancel) pressing = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    window.removeEventListener('keydown', key, { capture: true })
    clearTimeout(hoverTimer)
    hoverTab = null
    stopScroll()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  window.addEventListener('keydown', key, { capture: true })
  pressing = cancel
}

function swallow(e: Event) {
  e.preventDefault()
  e.stopPropagation()
}

// ---- Keyboard ----

/** Every target the keyboard can pick, in the order of the target select: the Geometry tab first, axes last. */
function pickList(): string[] {
  return [...TARGETS, ...axisTargets()].map((t) => t.id)
}

/** The tab (a [data-map-tab] button) that shows a target's control, if it is not on view. */
function openTabFor(spec: TargetSpec | undefined) {
  if (!spec) return
  const tab = document.querySelector<HTMLElement>(`[data-map-tab="${spec.tab}"]`)
  if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click()
}

/** The tab that shows `el` (the tab whose panel holds it), if any. */
function tabOf(el: HTMLElement): HTMLElement | null {
  const panel = el.closest<HTMLElement>('[role="tabpanel"]')
  return panel?.id ? document.querySelector<HTMLElement>(`[role="tab"][aria-controls="${CSS.escape(panel.id)}"]`) : null
}

/**
 * Enter or Space on a feature's meter: pick a target with the keyboard. Tab and the arrow keys move through every
 * target (opening its tab and outlining its control), Enter maps, Escape cancels; each step is announced. Focus
 * then moves to the mapped control (a colour's first input), or back to the meter when there is nothing to focus (a
 * variable axis) or on Escape. A pointer press anywhere cancels it and leaves focus to the press.
 */
export function startPick(feature: FeatureId, origin: HTMLElement) {
  if (state.mode) return
  const list = pickList()
  if (list.length === 0) return
  const originTab = tabOf(origin)
  const name = featureById(feature)?.label ?? feature
  let index = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const show = (announce: string) => {
    clearTimeout(timer)
    const id = list[index]
    const spec = targetById(id)
    const label = spec ? targetName(spec) : id
    set({ announcement: `${announce}${label}, ${index + 1} of ${list.length}.` })
    let zone = zoneOf(id)
    if (!visible(zone)) openTabFor(spec)
    // A tab opened just now (or loaded on its first visit) shows its controls a moment later; a control its
    // settings hide (Segments per curve in Adaptive mode) is announced without an outline.
    let tries = 0
    const place = () => {
      zone = zoneOf(id)
      if (visible(zone) || tries++ > 40) {
        setOver(visible(zone) ? zone : null, id)
        if (visible(zone)) zone.scrollIntoView({ block: 'nearest' })
      } else timer = setTimeout(place, 25)
    }
    place()
  }

  const finish = (mapped: boolean, refocus = true) => {
    document.removeEventListener('keydown', key, { capture: true })
    document.removeEventListener('pointerdown', cancel, { capture: true })
    if (picking === cancel) picking = null
    clearTimeout(timer)
    const id = list[index]
    const rect = rectOf(zoneOf(id))
    end()
    if (mapped) drop(feature, id, rect)
    else set({ announcement: 'Mapping cancelled.' })
    if (!refocus) return
    // Focus moves to the mapped control once the drop has shown it (switching on its mode can bring it in), else back
    // to the meter on its own tab.
    setTimeout(() => {
      // A colour's Hue or Lightness zone is shown only while dragging: its field, which is on view, holds the inputs.
      const zone = mapped ? zoneOf(id) : null
      const field = zone?.closest<HTMLElement>(ZONE_SELECTOR) ?? null
      const control = visible(field) ? field.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)') : null
      if (control) {
        control.focus()
        return
      }
      if (originTab && originTab.getAttribute('aria-selected') !== 'true') originTab.click()
      setTimeout(() => origin.focus(), 0)
    }, 50)
  }

  const key = (e: KeyboardEvent) => {
    const step = { Tab: e.shiftKey ? -1 : 1, ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    const jump = { Home: 0, End: list.length - 1 }[e.key]
    if (step === undefined && jump === undefined && e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    // Holding the Enter (or Space) that started the pick repeats it: only a fresh press maps.
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) return
    if (e.key === 'Escape') finish(false)
    else if (e.key === 'Enter' || e.key === ' ') finish(true)
    else {
      index = jump ?? (index + (step ?? 0) + list.length) % list.length
      show('')
    }
  }

  // A press with the pointer (on another control, say) ends the pick, so the keys work there again.
  const cancel = () => finish(false, false)

  setDragging('keyboard')
  set({ feature, mode: 'keyboard', marked: null })
  document.addEventListener('keydown', key, { capture: true })
  document.addEventListener('pointerdown', cancel, { capture: true })
  picking = cancel
  show(`Map ${name}: Tab or the arrow keys pick a control, Enter maps, Escape cancels. `)
}
