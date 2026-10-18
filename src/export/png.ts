// PNG export: rasterizes an exported SVG document in the browser. The SVG already carries the
// look (background, inversion, blur), so the image matches the SVG export pixel for pixel.

export const PNG_LIMITS = {
  /**
   * Longest side and area of the image. Browsers refuse larger canvases (Chrome and Firefox stop at 32,767 px a side,
   * Safari at about 16,384) and the pixels sit in memory four bytes each, so 2^27 pixels is half a gigabyte.
   */
  maxSide: 16384,
  maxPixels: 2 ** 27,
} as const

/**
 * The PNG's size in pixels: the canvas at its export scale, scaled down to fit PNG_LIMITS. `capped` when scaled down.
 */
export function pngSize(width: number, height: number, scale: number): { width: number; height: number; capped: boolean } {
  const w0 = width * scale
  const h0 = height * scale
  const f = Math.min(1, PNG_LIMITS.maxSide / Math.max(w0, h0), Math.sqrt(PNG_LIMITS.maxPixels / (w0 * h0)))
  const side = (v: number) => Math.max(1, Math.floor(v * f))
  return { width: side(w0), height: side(h0), capped: f < 1 }
}

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
