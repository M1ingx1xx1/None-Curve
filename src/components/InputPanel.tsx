import type { ReactNode } from 'react'
import { SplitHandle, useSplit } from './useSplit'

interface InputPanelProps {
  text: ReactNode
  preview: ReactNode
}

/**
 * Bottom right: the text input on the left and the canvas miniature on the right, with a draggable
 * handle between them. The two always share the same total width; the handle only moves the border.
 */
export default function InputPanel({ text, preview }: InputPanelProps) {
  const split = useSplit<HTMLDivElement>({
    storageKey: 'none-curve:input-split',
    defaultValue: 0.4,
    axis: 'x',
    minStart: 180,
    minEnd: 200,
    cssVars: ['--split-text', '--split-preview'],
  })

  return (
    <div ref={split.containerRef} className="input-panel" style={split.style}>
      <div className="input-panel-text">{text}</div>
      <SplitHandle
        axis="x"
        label="Resize the text input and the preview"
        valueText={`Text ${split.percent}%, preview ${100 - split.percent}%`}
        handleProps={split.handleProps}
      />
      <div className="input-panel-preview">{preview}</div>
    </div>
  )
}
