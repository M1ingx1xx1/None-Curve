import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

/** Thickness of every split handle; must match the handle tracks in styles.css. */
export const HANDLE_PX = 8
const KEY_STEP = 0.02

export interface SplitOptions {
  /** localStorage key; the split is remembered per browser. */
  storageKey: string
  /** Share of the container given to the first pane (0–1). */
  defaultValue: number
  /** 'x': panes side by side, the handle moves left and right. 'y': stacked, it moves up and down. */
  axis: 'x' | 'y'
  /** Minimum size of the first and the second pane, in pixels. */
  minStart: number
  minEnd: number
  /** CSS custom properties that receive the two panes' `fr` values. */
  cssVars: [string, string]
}

function readStored(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key))
    return value > 0 && value < 1 ? value : fallback
  } catch {
    return fallback
  }
}

/** Clamped and rounded to 0.1 %, so stored values stay short. */
function clamp(v: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, v)) * 1000) / 1000
}

/**
 * A two-pane split with a draggable handle. The panes always share the container's full size (minus
 * the handle); moving the handle only moves the border between them. Each pane keeps a minimum size;
 * the stored value is the user's choice and the shown value is clamped to what fits right now, so a
 * smaller window does not lose the preference.
 */
export function useSplit<T extends HTMLElement>({ storageKey, defaultValue, axis, minStart, minEnd, cssVars }: SplitOptions) {
  const containerRef = useRef<T>(null)
  const [value, setValue] = useState(() => readStored(storageKey, defaultValue))
  const [size, setSize] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Read by the move handler, which can run before React re-renders with the new state.
  const draggingRef = useRef(false)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = (rect: { width: number; height: number }) => setSize(axis === 'x' ? rect.width : rect.height)
    measure(el.getBoundingClientRect())
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect))
    observer.observe(el)
    return () => observer.disconnect()
  }, [axis])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(value))
    } catch {
      // Not saved (for example in a private window); the split still works for this visit.
    }
  }, [storageKey, value])

  const usable = size - HANDLE_PX
  const min = usable > 0 ? Math.min(0.5, minStart / usable) : 0.1
  const max = usable > 0 ? Math.max(0.5, 1 - minEnd / usable) : 0.9
  const shown = clamp(value, min, max)
  const percent = Math.round(shown * 100)

  const moveTo = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const start = axis === 'x' ? rect.left : rect.top
    const length = (axis === 'x' ? rect.width : rect.height) - HANDLE_PX
    if (length <= 0) return
    setValue(clamp(((axis === 'x' ? clientX : clientY) - start - HANDLE_PX / 2) / length, min, max))
  }

  const stop = () => {
    draggingRef.current = false
    setDragging(false)
  }

  const handleProps = {
    role: 'separator',
    tabIndex: 0,
    // A handle between side-by-side panes is a vertical line, and the other way round.
    'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
    'aria-valuemin': Math.round(min * 100),
    'aria-valuemax': Math.round(max * 100),
    'aria-valuenow': percent,
    'data-dragging': dragging,
    title: 'Drag to resize. Double-click to reset.',
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button !== 0) return
      e.preventDefault() // no text selection while dragging
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Capture is a convenience; dragging still works while the pointer stays on the handle.
      }
      draggingRef.current = true
      setDragging(true)
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      if (draggingRef.current) moveTo(e.clientX, e.clientY)
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onDoubleClick() {
      setValue(defaultValue)
    },
    onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      const keys: Record<string, number> =
        axis === 'x'
          ? { ArrowLeft: shown - KEY_STEP, ArrowRight: shown + KEY_STEP, Home: min, End: max }
          : { ArrowUp: shown - KEY_STEP, ArrowDown: shown + KEY_STEP, Home: min, End: max }
      const next = keys[e.key]
      if (next === undefined) return
      e.preventDefault()
      setValue(clamp(next, min, max))
    },
  } as const

  const style = { [cssVars[0]]: `${shown}fr`, [cssVars[1]]: `${1 - shown}fr` } as CSSProperties

  return { containerRef, shown, percent, style, handleProps }
}

interface SplitHandleProps {
  axis: 'x' | 'y'
  label: string
  valueText: string
  /** A stronger line, for the borders between the main areas. */
  strong?: boolean
  handleProps: ReturnType<typeof useSplit>['handleProps']
}

/** The draggable line between two panes of a split. Hidden on narrow screens, where panes stack. */
export function SplitHandle({ axis, label, valueText, strong = false, handleProps }: SplitHandleProps) {
  return (
    <div
      className={`split-handle split-handle-${axis}${strong ? ' split-handle-strong' : ''}`}
      aria-label={label}
      aria-valuetext={valueText}
      {...handleProps}
    />
  )
}
