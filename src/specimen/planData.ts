// A Glide plan as data (morph.ts builds every plan from it): typed arrays only, so it crosses postMessage
// (transferable) and uploads to the GPU as it is. The closures a plan runs on the page are rebuilt from it.

export const PLAN_DATA_VERSION = 1

/** A contour that does not change: drawn as the target's contour `contour` (its anchors are in `to`). */
export interface StillTrack { kind: 'still'; clockwise: boolean; contour: number /* index into to.contours */; kept: Uint8Array }
/** Anchors moving in straight lines: x = s + (t − s)·p. */
export interface StraightTrack { kind: 'straight'; clockwise: boolean; sx: Float64Array; sy: Float64Array; tx: Float64Array; ty: Float64Array; kept: Uint8Array; base: Uint8Array }
/**
 * Anchors sweeping round Whorl's ring polygon (trajectory.ts whorlTrajectory.path): per anchor the start angle, the
 * turn, the ring sizes, the start offset o, the sweep's end e, the straight rest r and, with Sides changed, the
 * midpoint m. Ring and centres are the plan's (WhorlPlanParams).
 */
export interface WhorlTrack {
  kind: 'whorl'; clockwise: boolean; kept: Uint8Array; base: Uint8Array
  sx: Float64Array; sy: Float64Array; tx: Float64Array; ty: Float64Array
  a0: Float64Array; turn: Float64Array; sizeA: Float64Array; sizeB: Float64Array
  ox: Float64Array; oy: Float64Array; ex: Float64Array; ey: Float64Array; rx: Float64Array; ry: Float64Array
  mx: Float64Array | null; my: Float64Array | null
}
export type TrackData = StillTrack | StraightTrack | WhorlTrack

export interface WhorlPlanParams { startX: number; startY: number; endX: number; endY: number; sidesA: number; sidesB: number }

/** Whorl's mesh glide (whorlGlide.ts): paths for corners then outer points, and each point's mix of them. */
export interface MeshData {
  meshKey: string
  sides: number
  centreX: number; centreY: number
  corners: number
  a0: Float64Array; a1: Float64Array; size: Float64Array; x0: Float64Array; y0: Float64Array; x1: Float64Array; y1: Float64Array
  ids: Int32Array; weights: Float64Array; outerOf: Int32Array
  contours: { start: number; n: number; clockwise: boolean }[]
  startTurns: Float64Array; endTurns: Float64Array
}

/** What the plan's `from` was, so the page can tell whether it matches the glyph it shows. */
export type PlanFrom =
  | { kind: 'computed'; key: string }                                   // a computed outline (arrived, or no glide before)
  | { kind: 'between'; lineage: number; seq: number; q: number }       // the in-between shape of `lineage`'s plan of commit `seq` at eased q
  | { kind: 'value' }                                                   // sent by value (on-demand request)

export interface PlanData {
  version: typeof PLAN_DATA_VERSION
  trajectory: string               // 'straight' | 'whorl' | 'whorl-mesh'
  points: number
  longest: number
  whorl: WhorlPlanParams | null
  mesh: MeshData | null
  tracks: TrackData[]
  /** The settled `from` contours when settleInBetween changed them (else the page's own glyph is the plan's from). */
  settled: { points: Float64Array /* x,y pairs */; counts: Int32Array; clockwise: Uint8Array } | null
}
