import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

/** Thickness of every split handle (the line itself); must match the handle tracks in styles.css. */
export const HANDLE_PX = 1
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

export interface SplitsOptions {
  /** localStorage key; the split is remembered per browser. */
  storageKey: string
  /** Default share of the container for each pane (adding up to 1). */
  defaults: number[]
  /** 'x': panes side by side, the handles move left and right. 'y': stacked, they move up and down. */
  axis: 'x' | 'y'
  /** Minimum size of each pane, in pixels. */
  mins: number[]
  /** CSS custom properties that receive each pane's `fr` value. */
  cssVars: string[]
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** The stored shares: an array, or (two panes, older versions) the first pane's share alone. */
function readStored(key: string, fallback: number[]): number[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    const values = typeof parsed === 'number' && fallback.length === 2 ? [parsed, 1 - parsed] : parsed
    if (!Array.isArray(values) || values.length !== fallback.length || !values.every((v) => typeof v === 'number' && v > 0)) {
      return fallback
    }
    const total = sum(values)
    return values.map((v) => v / total)
  } catch {
    return fallback
  }
}

/** Rounded to 0.1 %, so stored values stay short. */
const round = (v: number) => Math.round(v * 1000) / 1000

/**
 * The shares to show at the current size: every pane at least its minimum share, the room for that
 * taken from the panes above their minimums. When the minimums do not all fit, they shrink alike.
 */
function fit(values: number[], minShares: number[]): number[] {
  const total = sum(minShares)
  const mins = total > 1 ? minShares.map((m) => m / total) : minShares
  const raised = values.map((v, i) => Math.max(v, mins[i]))
  const excess = sum(raised) - 1
  if (excess <= 0) return raised
  const slack = raised.map((v, i) => v - mins[i])
  const slackTotal = sum(slack)
  return raised.map((v, i) => (slackTotal > 0 ? v - (excess * slack[i]) / slackTotal : mins[i]))
}

/**
 * Side-by-side (or stacked) panes with a draggable handle between each pair. The panes always share
 * the container's full size (minus the handles); a handle only moves the border between its two
 * neighbours, so every other pane keeps its size. Each pane keeps a minimum size; the stored value is
 * the user's choice and the shown value is fitted to what fits right now, so a smaller window does
 * not lose the preference.
 */
export function useSplits<T extends HTMLElement>({ storageKey, defaults, axis, mins, cssVars }: SplitsOptions) {
  const containerRef = useRef<T>(null)
  const [values, setValues] = useState(() => readStored(storageKey, defaults))
  const [size, setSize] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)
  // Read by the move handler, which can run before React re-renders with the new state.
  const draggingRef = useRef<number | null>(null)

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
      localStorage.setItem(storageKey, JSON.stringify(values))
    } catch {
      // Not saved (for example in a private window); the split still works for this visit.
    }
  }, [storageKey, values])

  const handles = defaults.length - 1
  const usable = size - HANDLE_PX * handles
  const minShares = mins.map((m) => (usable > 0 ? m / usable : 0))
  const shown = fit(values, minShares)
  const percents = shown.map((v) => Math.round(v * 100))

  /** Range of border `k` (after pane k): its neighbours keep at least their minimums. */
  const range = (k: number) => {
    const before = sum(shown.slice(0, k))
    const pair = shown[k] + shown[k + 1]
    const low = before + Math.min(minShares[k], pair / 2)
    const high = before + pair - Math.min(minShares[k + 1], pair / 2)
    return { before, pair, low, high }
  }

  /** Moves border `k` to `position` (a share of the container); only panes k and k + 1 change. */
  const moveBorder = (k: number, position: number) => {
    const { before, pair, low, high } = range(k)
    const first = Math.min(high, Math.max(low, position)) - before
    setValues(shown.map((v, i) => round(i === k ? first : i === k + 1 ? pair - first : v)))
  }

  const moveTo = (k: number, clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || usable <= 0) return
    const offset = (axis === 'x' ? clientX - rect.left : clientY - rect.top) - HANDLE_PX * k - HANDLE_PX / 2
    moveBorder(k, offset / usable)
  }

  const stop = () => {
    draggingRef.current = null
    setDragging(null)
  }

  const handleProps = Array.from({ length: handles }, (_, k) => {
    const { before, low, high } = range(k)
    const position = before + shown[k]
    return {
      role: 'separator',
      tabIndex: 0,
      // A handle between side-by-side panes is a vertical line, and the other way round.
      'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
      'aria-valuemin': Math.round(low * 100),
      'aria-valuemax': Math.round(high * 100),
      'aria-valuenow': Math.round(position * 100),
      'data-dragging': dragging === k,
      title: 'Drag to resize. Double-click to reset.',
      onPointerDown(e: PointerEvent<HTMLDivElement>) {
        if (e.button !== 0) return
        e.preventDefault() // no text selection while dragging
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // Capture is a convenience; dragging still works while the pointer stays on the handle.
        }
        draggingRef.current = k
        setDragging(k)
      },
      onPointerMove(e: PointerEvent<HTMLDivElement>) {
        if (draggingRef.current === k) moveTo(k, e.clientX, e.clientY)
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onDoubleClick() {
        setValues(defaults)
      },
      onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
        const keys: Record<string, number> =
          axis === 'x'
            ? { ArrowLeft: position - KEY_STEP, ArrowRight: position + KEY_STEP, Home: low, End: high }
            : { ArrowUp: position - KEY_STEP, ArrowDown: position + KEY_STEP, Home: low, End: high }
        const next = keys[e.key]
        if (next === undefined) return
        e.preventDefault()
        moveBorder(k, next)
      },
    } as const
  })

  const style = Object.fromEntries(cssVars.map((name, i) => [name, `${shown[i]}fr`])) as CSSProperties

  return { containerRef, shown, percents, style, handleProps }
}

/** Two panes with one handle between them (see useSplits). */
export function useSplit<T extends HTMLElement>({ storageKey, defaultValue, axis, minStart, minEnd, cssVars }: SplitOptions) {
  const split = useSplits<T>({
    storageKey,
    defaults: [defaultValue, 1 - defaultValue],
    axis,
    mins: [minStart, minEnd],
    cssVars,
  })
  return {
    containerRef: split.containerRef,
    shown: split.shown[0],
    percent: split.percents[0],
    style: split.style,
    handleProps: split.handleProps[0],
  }
}

interface SplitHandleProps {
  axis: 'x' | 'y'
  label: string
  valueText: string
  handleProps: ReturnType<typeof useSplits>['handleProps'][number]
}

/** The draggable line between two panes of a split. Hidden on narrow screens, where panes stack. */
export function SplitHandle({ axis, label, valueText, handleProps }: SplitHandleProps) {
  return (
    <div
      className={`split-handle split-handle-${axis}`}
      aria-label={label}
      aria-valuetext={valueText}
      {...handleProps}
    />
  )
}
