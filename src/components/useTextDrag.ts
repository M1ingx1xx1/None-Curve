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
}

/**
 * The canvas's pointer and keys, shared by the SVG view (SpecimenView) and the canvas renderers' (GlyphSurface): pan and
 * zoom (usePanZoom), Escape to clear the selection, and Free position's text drag. A drag that starts on the text moves
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

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && e.target === e.currentTarget && onClearSelection) {
      e.preventDefault()
      onClearSelection()
    } else handlers.onKeyDown(e)
  }

  return { freeMove, draggingText, movingRef, offset, dragged, pointer, onKeyDown }
}
