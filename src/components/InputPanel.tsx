import type { ReactNode } from 'react'
import { HANDLE_PX, SplitHandle, useSplits } from './useSplit'

interface InputPanelProps {
  text: ReactNode
  /** Typography and Color tabs. */
  style: ReactNode
  preview: ReactNode
}

/** Minimum widths of the text input, the style tabs, and the preview. */
export const INPUT_PANE_MINS = [180, 240, 200]
/** Minimum width of the whole panel: every pane at its minimum, plus the two handles. */
export const INPUT_PANEL_MIN = INPUT_PANE_MINS.reduce((a, b) => a + b, 0) + 2 * HANDLE_PX

/**
 * Bottom right: the text input, the Typography and Color tabs, and the canvas miniature, with a
 * draggable handle between each pair. The three always share the same total width; a handle only
 * moves the border between its two neighbours.
 */
export default function InputPanel({ text, style, preview }: InputPanelProps) {
  const split = useSplits<HTMLDivElement>({
    storageKey: 'none-curve:input-splits',
    defaults: [0.3, 0.3, 0.4],
    axis: 'x',
    mins: INPUT_PANE_MINS,
    cssVars: ['--split-text', '--split-style', '--split-preview'],
  })
  const [textPct, stylePct, previewPct] = split.percents

  return (
    <div ref={split.containerRef} className="input-panel" style={split.style}>
      <div className="input-panel-text">{text}</div>
      <SplitHandle
        axis="x"
        strong
        label="Resize the text input and the style tabs"
        valueText={`Text ${textPct}%, typography and color ${stylePct}%`}
        handleProps={split.handleProps[0]}
      />
      <div className="input-panel-style">{style}</div>
      <SplitHandle
        axis="x"
        strong
        label="Resize the style tabs and the preview"
        valueText={`Typography and color ${stylePct}%, preview ${previewPct}%`}
        handleProps={split.handleProps[1]}
      />
      <div className="input-panel-preview">{preview}</div>
    </div>
  )
}
