import { applyAnchorControls } from './anchors'
import { applyConstraints } from './constraints'
import { applyDistortion } from './distortion'
import { flattenGlyph } from './flatten'
import { applyRandomAnchors } from './randomAnchors'
import { applySquaring } from './squaring'
import type { DerivedGeometry, GeometryParams, SourceGlyph } from './types'

/**
 * Source curves + parameters → canonical polygon, always rebuilt from the original curves.
 * Fixed order: Flatten (or experimental Random anchors) → Squaring → Anchor spacing → Anchor reduction → Grid snapping →
 * Angle lock → Vertex distortion. Squaring runs right after flattening so reduction can then drop the
 * collinear points left on the new straight sides. Distortion is last, so it moves vertices off the grid and off locked angles.
 */
export function deriveGeometry(source: SourceGlyph, params: GeometryParams): DerivedGeometry {
  const flattened = flattenGlyph(source, params.flatten)
  // Random anchors sample the original curves too, so they replace Flatten's polygon rather than follow it.
  const randomized = applyRandomAnchors(source, flattened.polygon, params.random, params.flatten)
  const squared = applySquaring(randomized.polygon, params.squaring)
  const anchored = applyAnchorControls(squared.polygon, params.anchors)
  const constrained = applyConstraints(anchored.polygon, params.grid)
  const distorted = applyDistortion(constrained.polygon, params.distortion)
  const polygon = distorted.polygon
  return {
    source,
    polygon,
    vertexCount: polygon.contours.reduce((n, c) => n + c.points.length, 0),
    flatten: flattened.stats,
    random: randomized.stats,
    squaring: squared.stats,
    anchors: anchored.stats,
    constraints: constrained.stats,
    distortion: distorted.stats,
  }
}
