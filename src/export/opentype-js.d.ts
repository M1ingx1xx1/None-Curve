// Minimal types for the parts of opentype.js 2.x used to write fonts (the package ships no types).
declare module 'opentype.js' {
  export class Path {
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    close(): void
  }

  export interface GlyphOptions {
    name: string
    unicode?: number
    unicodes?: number[]
    advanceWidth: number
    path: Path
  }

  export class Glyph {
    constructor(options: GlyphOptions)
  }

  export interface FontOptions {
    familyName: string
    styleName: string
    unitsPerEm: number
    ascender: number
    descender: number
    glyphs: Glyph[]
    version?: string
    description?: string
  }

  export class Font {
    constructor(options: FontOptions)
    toArrayBuffer(): ArrayBuffer
  }
}
