// PNG export: rasterizes an exported SVG document in the browser. The SVG already carries the
// look (background, inversion, blur), so the image matches the SVG export pixel for pixel.

/**
 * Renders the SVG at `width` pixels wide (height follows the aspect ratio) and returns PNG bytes.
 * The SVG's own width and height (font units) only set the aspect ratio.
 */
export async function svgToPng(svg: string, svgWidth: number, svgHeight: number, width: number): Promise<Blob> {
  const height = Math.max(1, Math.round((width * svgHeight) / svgWidth))
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot draw the PNG image.')
    context.drawImage(image, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG image could not be encoded.'))), 'image/png'),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Width and height of an exported SVG document, read from its root element. */
export function svgSize(svg: string): { width: number; height: number } {
  const match = /<svg[^>]*\swidth="([\d.]+)"\s+height="([\d.]+)"/.exec(svg)
  if (!match) throw new Error('The SVG has no size.')
  return { width: Number(match[1]), height: Number(match[2]) }
}
