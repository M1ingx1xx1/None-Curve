import type { ReactNode } from 'react'

interface InputPanelProps {
  text: ReactNode
  preview: ReactNode
}

/** Bottom right: the text input on the left and the selected-glyph preview on the right. */
export default function InputPanel({ text, preview }: InputPanelProps) {
  return (
    <div className="input-panel">
      <div className="input-panel-text">{text}</div>
      <div className="input-panel-preview">{preview}</div>
    </div>
  )
}
