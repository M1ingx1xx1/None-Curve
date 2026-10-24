// SVG path data and basic shapes as source contours (src/geometry/types.ts), in the SVG's own user space (y down).
// Every command (M L H V C S Q T A Z, absolute and relative) is read; arcs become cubics, at most a quarter turn each.
// Pure functions; no DOM, so the geometry worker runs them too.

import type { Point, SourceContour, SourceSegment } from '../geometry/types'

/** An affine transform [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG's matrix order). */
export type Matrix = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

/** The contours with every point moved by `m` (exact for lines and Bézier curves). */
export function transformContours(contours: SourceContour[], m: Matrix): SourceContour[] {
  if (m === IDENTITY) return contours
  const t = (p: Point) => apply(m, p)
  return contours.map(({ start, segments }) => ({
    start: t(start),
    segments: segments.map((s): SourceSegment => {
      if (s.type === 'line') return { type: 'line', to: t(s.to) }
      if (s.type === 'quad') return { type: 'quad', control: t(s.control), to: t(s.to) }
      return { type: 'cubic', control1: t(s.control1), control2: t(s.control2), to: t(s.to) }
    }),
  }))
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/

/** Reads numbers and command letters from path data; `flag` reads an arc flag, which may touch the next number. */
class Scanner {
  private i = 0
  constructor(private readonly text: string) {}

  private skip(): void {
    while (this.i < this.text.length && /[\s,]/.test(this.text[this.i])) this.i++
  }

  done(): boolean {
    this.skip()
    return this.i >= this.text.length
  }

  /** The next command letter, or null when a number (an implicit repeat) or the end comes next. */
  command(): string | null {
    this.skip()
    const c = this.text[this.i]
    if (c !== undefined && /[MmZzLlHhVvCcSsQqTtAa]/.test(c)) {
      this.i++
      return c
    }
    return null
  }

  number(): number {
    this.skip()
    const match = NUMBER.exec(this.text.slice(this.i))
    if (!match) throw new PathError()
    this.i += match[0].length
    const value = Number(match[0])
    if (!Number.isFinite(value)) throw new PathError()
    return value
  }

  flag(): boolean {
    this.skip()
    const c = this.text[this.i]
    if (c !== '0' && c !== '1') throw new PathError()
    this.i++
    return c === '1'
  }
}

class PathError extends Error {}

/**
 * The contours of SVG path data. As SVG renders it, data that goes wrong part way keeps what came before the error.
 * A contour is closed whether or not it ends with Z (a fill closes it); one with no segments is dropped.
 */
export function parsePathData(d: string): SourceContour[] {
  const contours: SourceContour[] = []
  const scan = new Scanner(d)
  let current: SourceContour | null = null
  let pen: Point = { x: 0, y: 0 }
  let start: Point = { x: 0, y: 0 }
  // The previous segment's last control point, for S and T.
  let lastCubic: Point | null = null
  let lastQuad: Point | null = null
  let command: string | null = null

  const moveTo = (p: Point) => {
    current = { start: p, segments: [] }
    contours.push(current)
    pen = start = p
  }
  const push = (segment: SourceSegment) => {
    if (!current) moveTo(pen)
    current!.segments.push(segment)
    pen = segment.to
  }

  try {
    while (!scan.done()) {
      const letter = scan.command()
      if (letter) command = letter
      else if (!command || command === 'z' || command === 'Z') throw new PathError()
      const c: string = command!
      const relative: boolean = c === c.toLowerCase()
      const at = (x: number, y: number): Point => (relative ? { x: pen.x + x, y: pen.y + y } : { x, y })
      let cubic: Point | null = null
      let quad: Point | null = null

      switch (c.toUpperCase()) {
        case 'M': {
          moveTo(at(scan.number(), scan.number()))
          // Pairs after a moveto are linetos.
          command = relative ? 'l' : 'L'
          break
        }
        case 'Z': {
          if (current) pen = start
          current = null
          break
        }
        case 'L':
          push({ type: 'line', to: at(scan.number(), scan.number()) })
          break
        case 'H': {
          const x = scan.number()
          push({ type: 'line', to: { x: relative ? pen.x + x : x, y: pen.y } })
          break
        }
        case 'V': {
          const y = scan.number()
          push({ type: 'line', to: { x: pen.x, y: relative ? pen.y + y : y } })
          break
        }
        case 'C': {
          const control1 = at(scan.number(), scan.number())
          const control2 = at(scan.number(), scan.number())
          const to = at(scan.number(), scan.number())
          push({ type: 'cubic', control1, control2, to })
          cubic = control2
          break
        }
        case 'S': {
          const control1 = lastCubic ? reflect(lastCubic, pen) : pen
          const control2 = at(scan.number(), scan.number())
          const to = at(scan.number(), scan.number())
          push({ type: 'cubic', control1, control2, to })
          cubic = control2
          break
        }
        case 'Q': {
          const control = at(scan.number(), scan.number())
          const to = at(scan.number(), scan.number())
          push({ type: 'quad', control, to })
          quad = control
          break
        }
        case 'T': {
          const control: Point = lastQuad ? reflect(lastQuad, pen) : pen
          const to = at(scan.number(), scan.number())
          push({ type: 'quad', control, to })
          quad = control
          break
        }
        case 'A': {
          const rx = scan.number()
          const ry = scan.number()
          const rotation = scan.number()
          const large = scan.flag()
          const sweep = scan.flag()
          const to = at(scan.number(), scan.number())
          for (const segment of arcToCubics(pen, rx, ry, rotation, large, sweep, to)) push(segment)
          break
        }
      }
      lastCubic = cubic
      lastQuad = quad
    }
  } catch (error) {
    if (!(error instanceof PathError)) throw error
  }
  return contours.filter((c) => c.segments.length > 0)
}

function reflect(control: Point, about: Point): Point {
  return { x: 2 * about.x - control.x, y: 2 * about.y - control.y }
}

/**
 * An elliptical arc (SVG implementation notes, F.6) as cubics of at most 90° each. Radii too small are scaled up; a
 * zero radius is a straight line, and an arc to its own start point is nothing.
 */
export function arcToCubics(
  from: Point,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  large: boolean,
  sweep: boolean,
  to: Point,
): SourceSegment[] {
  if (from.x === to.x && from.y === to.y) return []
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0) return [{ type: 'line', to }]
  const phi = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from.x - to.x) / 2
  const dy = (from.y - to.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let k = Math.sqrt(Math.max(0, num / den))
  if (large === sweep) k = -k
  const cx1 = (k * rx * y1) / ry
  const cy1 = (-k * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI

  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9))
  const step = delta / pieces
  const handle = (4 / 3) * Math.tan(step / 4)
  // A point of the unit circle, stretched to the ellipse, turned and moved to its centre.
  const place = (ux: number, uy: number): Point => {
    const ex = rx * ux
    const ey = ry * uy
    return { x: cx + cos * ex - sin * ey, y: cy + sin * ex + cos * ey }
  }
  const segments: SourceSegment[] = []
  for (let i = 0; i < pieces; i++) {
    const t1 = theta1 + i * step
    const t2 = t1 + step
    segments.push({
      type: 'cubic',
      control1: place(Math.cos(t1) - handle * Math.sin(t1), Math.sin(t1) + handle * Math.cos(t1)),
      control2: place(Math.cos(t2) + handle * Math.sin(t2), Math.sin(t2) - handle * Math.cos(t2)),
      to: i === pieces - 1 ? to : place(Math.cos(t2), Math.sin(t2)),
    })
  }
  return segments
}

/** A rectangle with optional rounded corners (rx, ry as SVG resolves them), clockwise in y-down space. */
export function rectContour(x: number, y: number, w: number, h: number, rxIn: number | null, ryIn: number | null) {
  if (!(w > 0 && h > 0)) return []
  let rx = rxIn ?? ryIn ?? 0
  let ry = ryIn ?? rxIn ?? 0
  rx = Math.min(Math.max(0, rx), w / 2)
  ry = Math.min(Math.max(0, ry), h / 2)
  if (rx === 0 || ry === 0) {
    return [
      {
        start: { x, y },
        segments: [
          { type: 'line', to: { x: x + w, y } },
          { type: 'line', to: { x: x + w, y: y + h } },
          { type: 'line', to: { x, y: y + h } },
        ],
      } satisfies SourceContour,
    ]
  }
  const d =
    `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}` +
    `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
    `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
  return parsePathData(d)
}

export function ellipseContour(cx: number, cy: number, rx: number, ry: number): SourceContour[] {
  if (!(rx > 0 && ry > 0)) return []
  return parsePathData(`M${cx + rx},${cy}A${rx},${ry} 0 1 1 ${cx - rx},${cy}A${rx},${ry} 0 1 1 ${cx + rx},${cy}Z`)
}

/** A polygon or polyline's points ("x,y x,y …"); an odd number drops the last coordinate. */
export function pointsContour(points: string): SourceContour[] {
  const numbers = (points.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number)
  if (numbers.length < 4 || numbers.some((n) => !Number.isFinite(n))) return []
  const segments: SourceSegment[] = []
  for (let i = 2; i + 1 < numbers.length; i += 2)
    segments.push({ type: 'line', to: { x: numbers[i], y: numbers[i + 1] } })
  return [{ start: { x: numbers[0], y: numbers[1] }, segments }]
}

/**
 * A transform attribute (matrix, translate, scale, rotate, skewX, skewY, in any number, applied right to left as SVG
 * does). Anything it cannot read makes it the identity, as a browser ignores a bad transform.
 */
export function parseTransform(text: string | undefined): Matrix {
  if (!text) return IDENTITY
  let m: Matrix = IDENTITY
  const re = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/gy
  let match: RegExpExecArray | null
  let end = 0
  while ((match = re.exec(text))) {
    end = re.lastIndex
    const args = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number)
    if (args.some((n) => !Number.isFinite(n))) return IDENTITY
    const [a = 0, b, c] = args
    let t: Matrix
    switch (match[1]) {
      case 'matrix':
        if (args.length !== 6) return IDENTITY
        t = args as unknown as Matrix
        break
      case 'translate':
        t = [1, 0, 0, 1, a, b ?? 0]
        break
      case 'scale':
        t = [a, 0, 0, b ?? a, 0, 0]
        break
      case 'rotate': {
        const r = (a * Math.PI) / 180
        const rot: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
        const cx = b ?? 0
        const cy = c ?? 0
        t = multiply(multiply([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy])
        break
      }
      case 'skewX':
        t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0]
        break
      default:
        t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0]
    }
    m = multiply(m, t)
  }
  return text.slice(end).trim() ? IDENTITY : m
}
