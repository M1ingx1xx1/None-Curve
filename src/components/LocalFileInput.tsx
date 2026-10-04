import { forwardRef } from 'react'
import { LOCAL_FONT_ACCEPT } from '../font/local'

interface LocalFileInputProps {
  onFile: (file: File) => void
}

/** Hidden file input; open it with `ref.current.click()`. */
const LocalFileInput = forwardRef<HTMLInputElement, LocalFileInputProps>(function LocalFileInput({ onFile }, ref) {
  return (
    <input
      ref={ref}
      type="file"
      accept={LOCAL_FONT_ACCEPT}
      hidden
      tabIndex={-1}
      onChange={(e) => {
        const file = e.target.files?.[0]
        // Reset so choosing the same file again still triggers a change.
        e.target.value = ''
        if (file) onFile(file)
      }}
    />
  )
})

export default LocalFileInput
