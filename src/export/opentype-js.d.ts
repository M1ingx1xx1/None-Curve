// Minimal types for the parts of opentype.js 2.x used to write fonts (the package ships no types).
declare module 'opentype.js' {
  export interface PathCommand {
    type: string
    x?: number
    y?: number
  }

  export class Path {
    commands: PathCommand[]
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
    path: Path
  }

  export interface FontOptions {
    familyName: string
    styleName: string
    unitsPerEm: number
    ascender: number
    descender: number
    glyphs: Glyph[]
    postScriptName?: string
    version?: string
    description?: string
    copyright?: string
    trademark?: string
    manufacturer?: string
    manufacturerURL?: string
    designer?: string
    designerURL?: string
    license?: string
    licenseURL?: string
    /** OS/2 usWeightClass and usWidthClass. */
    weightClass?: number
    widthClass?: number
    /** OS/2 fsSelection bits. */
    fsSelection?: number
    /** Degrees; negative leans right. */
    italicAngle?: number
    /** The ten PANOSE bytes. */
    panose?: number[]
    /** Values merged over the tables the writer builds (field names as in opentype.js). */
    tables?: { os2?: Record<string, number>; post?: Record<string, number> }
  }

  export class Font {
    constructor(options: FontOptions)
    /** Name records per platform (unicode, macintosh, windows), keyed like `copyright` or `uniqueID`. */
    names: Record<string, Record<string, { en: string }>>
    toArrayBuffer(): ArrayBuffer
  }
}
