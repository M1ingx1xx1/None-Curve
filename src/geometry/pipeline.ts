import { applyAnchorControls } from './anchors'
import { applyConstraints } from './constraints'
import { applyDistortion } from './distortion'
import { flattenGlyph } from './flatten'
import type { DerivedGeometry, GeometryParams, SourceGlyph } from './types'

/**
 * Source curves + parameters → canonical polygon, always rebuilt from the original curves.
 * Fixed order: Flatten → Anchor spacing → Anchor reduction → Grid snapping → Angle lock →
 * Vertex distortion. Distortion is last, so it moves vertices off the grid and off locked angles.
 */
export function deriveGeometry(source: SourceGlyph, params: GeometryParams): DerivedGeometry {
  const flattened = flattenGlyph(source, params.flatten)
  const anchored = applyAnchorControls(flattened.polygon, params.anchors)
  const constrained = applyConstraints(anchored.polygon, params.grid)
  const distorted = applyDistortion(constrained.polygon, params.distortion)
  const polygon = distorted.polygon
  return {
    source,
    polygon,
    vertexCount: polygon.contours.reduce((n, c) => n + c.points.length, 0),
    flatten: flattened.stats,
    anchors: anchored.stats,
    constraints: constrained.stats,
    distortion: distorted.stats,
  }
}
