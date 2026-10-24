import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { LoadedFont } from '../font/model'
import type { GlyphRef } from '../geometry/types'
import { textBox, type ArtboardLayout } from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { usePanZoom } from './usePanZoom'

type PanZoom = ReturnType<typeof usePanZoom>

/** The glyph a click on an occurrence selects: the character it stands for, else any character with its index. */
export function glyphRefOf(font: LoadedFont, index: number, text: string): GlyphRef {
  const cp = text.codePointAt(0)
  return (
    font.characters.find((c) => c.index === index && c.unicode === cp) ??
    font.characters.find((c) => c.index === index) ?? { index, name: '', unicode: null }
  )
}

/** The canvas's keys, for its aria-label (SpecimenView and GlyphSurface). */
export const CANVAS_KEYS =
  'Drag or use arrow keys to pan, scroll or +/− to zoom, 0 to fit. Click a glyph, or press Shift with the left or right arrow, to select a glyph; click empty space or press Escape to clear the highlight.'

/**
 * The occurrence (reading order, every line) that Shift+→ (`step` 1) or Shift+← (−1) selects: the next letter that is
 * in the font, is not a space, and is not the glyph selected now (its every copy is highlighted already). It steps from
 * `from` when that occurrence is of the selected glyph, else from the selected glyph's first occurrence, else (nothing
 * selected) from the start or the end. Null at the end of the text.
 */
export function stepGlyph(scene: SpecimenScene, selected: number | null, from: number | null, step: 1 | -1) {
  const glyphs = scene.lines.flatMap((line) => line.glyphs)
  const selectable = (i: number) => !glyphs[i].missing && glyphs[i].text.trim() !== '' && glyphs[i].index !== selected
  let at = from !== null && selected !== null && glyphs[from]?.index === selected ? from : -1
  if (at < 0 && selected !== null) at = glyphs.findIndex((g) => g.index === selected && !g.missing)
  if (at < 0) at = step > 0 ? -1 : glyphs.length
  for (let i = at + step; i >= 0 && i < glyphs.length; i += step) if (selectable(i)) return i
  return null
}

/**
 * Free position's move: called once, on release, with the move in font units. It may return a promise of whether the
 * text moved; on false (or a failure) the drag's offset is cleared at once instead of when the new layout arrives.
 */
export type MoveText = (dx: number, dy: number) => void | PromiseLike<boolean>

interface TextDragOptions {
  scene: SpecimenScene
  layout: ArtboardLayout
  /** Font units per CSS px. */
  u: number
  panZoom: Pick<PanZoom, 'handlers' | 'wasDrag'>
  onMoveText?: MoveText
  onClearSelection?: () => void
  /** Whether a press here starts a text drag (on a glyph or the text block). */
  startsOnText: (e: PointerEvent<HTMLDivElement>) => boolean
  /** The drag's offset (font units, scene y down) besides the underlay's moving group: 0, 0 clears it. */
  onOffset?: (dx: number, dy: number) => void
  /** A pointer move that drags neither the text nor the view. */
  onHover?: (e: PointerEvent<HTMLDivElement>) => void
  /** The pointer left while the text is not dragged. */
  onLeave?: () => void
  /** Keyboard selection (Shift+← / Shift+→, Enter): the glyph highlighted now (null: none) and how to select one. */
  selection?: { font: LoadedFont; selected: GlyphRef | null; onSelect: (glyph: GlyphRef) => void }
}

/**
 * The canvas's pointer and keys, shared by the SVG view (SpecimenView) and the canvas renderers' (GlyphSurface): pan and
 * zoom (usePanZoom), Shift+← / Shift+→ (and Enter) to select a letter, Escape to clear the selection, and Free position's text drag. A drag that starts on the text moves
 * it; anywhere else it pans. While dragging, only the moving group's transform (and `onOffset`) changes, so nothing
 * re-renders however long the text; the move is committed once, on release, and the offset is cleared when that
 * position arrives back as a new layout, or at once when the move changed nothing.
 */
export function useTextDrag(options: TextDragOptions) {
  const { scene, layout, u, panZoom, onMoveText, onClearSelection, startsOnText, onHover, onLeave } = options
  const { handlers, wasDrag } = panZoom
  const freeMove = onMoveText !== undefined
  // True while the text is being dragged (Free position); the grid then shows inside the artboard.
  const [draggingText, setDraggingText] = useState(false)
  const movingRef = useRef<SVGGElement>(null)
  const textDrag = useRef<{ x: number; y: number; moved: boolean; dx: number; dy: number } | null>(null)
  const textMoved = useRef(false)
  const committed = useRef(false)
  const moves = useRef(0)
  const offset = useRef({ dx: 0, dy: 0 })
  const onOffset = useRef(options.onOffset)
  onOffset.current = options.onOffset

  /** True when the last gesture dragged the view or the text, so its click selects nothing. */
  const dragged = () => wasDrag() || textMoved.current
  const setOffset = (dx: number, dy: number) => {
    offset.current = { dx, dy }
    if (dx || dy) movingRef.current?.setAttribute('transform', `translate(${dx} ${dy})`)
    else movingRef.current?.removeAttribute('transform')
    onOffset.current?.(dx, dy)
  }
  const settle = () => {
    if (!committed.current) return
    committed.current = false
    setOffset(0, 0)
  }
  useLayoutEffect(() => {
    settle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  const pointer = {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (freeMove && e.button === 0 && startsOnText(e)) {
        committed.current = false
        setOffset(0, 0)
        textDrag.current = { x: e.clientX, y: e.clientY, moved: false, dx: 0, dy: 0 }
        return
      }
      handlers.onPointerDown(e)
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const d = textDrag.current
      if (!d) {
        handlers.onPointerMove(e)
        onHover?.(e)
        return
      }
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return
        d.moved = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // Capture is a convenience; the drag still works while the pointer stays on the canvas.
        }
        setDraggingText(true)
      }
      // Screen pixels to font units (both axes point down in the scene), stopped at the artboard edges.
      // Along an axis where the text is larger than the artboard it does not move (see moveFreeText).
      const block = textBox(scene)
      const along = (delta: number, low: number, high: number) =>
        low <= high ? Math.min(high, Math.max(low, delta)) : 0
      d.dx = along((e.clientX - d.x) * u, layout.x - block.minX, layout.x + layout.width - block.minX - block.width)
      d.dy = along((e.clientY - d.y) * u, layout.y - block.minY, layout.y + layout.height - block.minY - block.height)
      setOffset(d.dx, d.dy)
    },
    onPointerUp() {
      const d = textDrag.current
      textMoved.current = d?.moved ?? false
      textDrag.current = null
      if (d?.moved) {
        setDraggingText(false)
        // Held at the edges the whole way: nothing to move, and no layout will come to clear the offset.
        if (d.dx || d.dy) {
          committed.current = true
          const move = ++moves.current
          const result = onMoveText?.(d.dx, d.dy) as PromiseLike<boolean> | undefined
          const unmoved = () => {
            if (move === moves.current) settle()
          }
          if (result && typeof result.then === 'function') {
            result.then((moved) => {
              if (!moved) unmoved()
            }, unmoved)
          }
        } else setOffset(0, 0)
      }
      handlers.onPointerUp()
    },
    onPointerCancel() {
      if (textDrag.current?.moved) setDraggingText(false)
      textDrag.current = null
      textMoved.current = false
      setOffset(0, 0)
      handlers.onPointerCancel()
    },
    onPointerLeave() {
      if (!textDrag.current) onLeave?.()
    },
  }

  // The occurrence last selected with the keyboard, to step on from (another copy of the same glyph comes later), and
  // what the live region says about it.
  const stepped = useRef<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const stepTo = (step: 1 | -1) => {
    const { selection } = options
    if (!selection) return false
    const at = stepGlyph(scene, selection.selected?.index ?? null, stepped.current, step)
    if (at === null) return true
    const glyph = scene.lines.flatMap((line) => line.glyphs)[at]
    stepped.current = at
    selection.onSelect(glyphRefOf(selection.font, glyph.index, glyph.text))
    setAnnouncement(`Selected ${glyph.text}`)
    return true
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const own = e.target === e.currentTarget
    const step =
      e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey ? { ArrowLeft: -1, ArrowRight: 1 }[e.key] : undefined
    if (own && step !== undefined && stepTo(step as 1 | -1)) e.preventDefault()
    else if (own && e.key === 'Enter' && options.selection && !options.selection.selected) {
      e.preventDefault()
      stepTo(1)
    } else if (e.key === 'Escape' && own && onClearSelection) {
      e.preventDefault()
      onClearSelection()
      setAnnouncement('Selection cleared')
    } else handlers.onKeyDown(e)
  }

  return { freeMove, draggingText, movingRef, offset, dragged, pointer, onKeyDown, announcement }
}
