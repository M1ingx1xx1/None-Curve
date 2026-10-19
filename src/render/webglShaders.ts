// The WebGL2 renderer's shaders (GLSL ES 3.00). The evaluation shaders run with transform feedback and write each
// in-between anchor of a Glide plan at progress p; gpuReference.ts is the same maths in JavaScript, kept line for line
// (the tests hold it against morphAt). The fill draws triangle fans into the stencil (nonzero winding), the cover quad
// paints where the stencil is set, and the stroke draws each side as a quad 1.5 CSS px wide with miter joins, or bevel
// joins where a miter would reach past MITER_LIMIT half-widths (SVG's stroke-miterlimit 4). Straight segments only:
// Whorl's `along` runs from corner to corner of its ring polygon, never round a circle.

import { GPU_LIMITS } from './gpuPlans'

const W = GPU_LIMITS.texWidth

/** Shared by the evaluation shaders: trajectory.ts `along` (see gpuReference.ts alongRef). */
const ALONG = /* glsl */ `
vec2 along(vec3 ring, float size, float a0, vec2 p0, float a1, vec2 p1, float angle) {
  float lo = min(a0, a1);
  float hi = max(a0, a1);
  if (!(hi > lo)) return p0;
  float t = clamp(angle, lo, hi);
  float k = floor((t - ring.x) / ring.y);
  float c0 = ring.x + k * ring.y;
  float c1 = c0 + ring.y;
  bool fromEnd = c0 <= lo;
  bool toEnd = c1 >= hi;
  float f = fromEnd ? lo : c0;
  float e = toEnd ? hi : c1;
  float corner = size / ring.z;
  bool forward = a0 <= a1;
  vec2 pf = fromEnd ? (forward ? p0 : p1) : corner * vec2(cos(f), sin(f));
  vec2 pe = toEnd ? (forward ? p1 : p0) : corner * vec2(cos(e), sin(e));
  float w = e > f ? (t - f) / (e - f) : 0.0;
  return pf + (pe - pf) * w;
}
`

/** The anchor pass: one point per in-between anchor, its row in four vec4s (gpuPlans.ts layout). */
export const EVAL_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec4 r0;
layout(location = 1) in vec4 r1;
layout(location = 2) in vec4 r2;
layout(location = 3) in vec4 r3;
uniform float u_p;
uniform vec2 u_start;
uniform vec2 u_end;
uniform vec3 u_ringA;
uniform vec3 u_ringB;
uniform highp sampler2D u_paths;
out vec2 v_pos;
${ALONG}
vec2 pathAt(float id) {
  int i = int(id + 0.5);
  return texelFetch(u_paths, ivec2(i % ${W}, i / ${W}), 0).xy;
}
void main() {
  int kind = int(r0.x + 0.5);
  float p = u_p;
  vec2 pos = vec2(0.0);
  if (kind == 0) {
    pos = r0.yz;
  } else if (kind == 1) {
    pos = r0.yz + (vec2(r0.w, r1.x) - r0.yz) * p;
  } else if (kind == 2 || kind == 3) {
    float a0 = r0.y;
    float turn = r0.z;
    float angle = a0 + turn * p;
    float a1 = a0 + turn;
    vec2 c = u_start + (u_end - u_start) * p;
    vec2 o = r1.yz;
    vec2 e = vec2(r1.w, r2.x);
    vec2 rest = r2.yz;
    vec2 m = vec2(r2.w, r3.x);
    vec2 at;
    if (kind == 2) at = along(u_ringA, r0.w, a0, o, a1, e, angle);
    else if (p < 0.5) at = along(u_ringA, r0.w, a0, o, a0 + turn / 2.0, m, angle);
    else at = along(u_ringB, r1.x, a0 + turn / 2.0, m, a1, e, angle);
    pos = c + at + rest * p;
  } else if (kind == 4) {
    pos = r1.x * pathAt(r0.y) + r1.y * pathAt(r0.z) + r1.z * pathAt(r0.w);
  } else if (kind == 5) {
    pos = pathAt(r0.y);
  }
  v_pos = pos;
}
`

/** The path pass (mesh plans): each corner's (or outer point's) place round the mesh's ring polygon. */
export const PATH_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 q0;
layout(location = 1) in vec4 q1;
uniform float u_p;
uniform vec2 u_centre;
uniform vec3 u_ring;
out vec2 v_pos;
${ALONG}
void main() {
  float a0 = q0.x;
  float a1 = q0.y;
  v_pos = u_centre + along(u_ring, q0.z, a0, vec2(q0.w, q1.x), a1, q1.yz, a0 + (a1 - a0) * u_p);
}
`

/** Transform feedback needs a fragment shader to link; nothing is rasterised. */
export const DISCARD_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }
`

/** Device pixels (y down) to clip space. */
const TO_CLIP = /* glsl */ `
uniform vec2 u_viewport;
vec4 toClip(vec2 d) { return vec4(d.x / u_viewport.x * 2.0 - 1.0, 1.0 - d.y / u_viewport.y * 2.0, 0.0, 1.0); }
`

/** The stencil fill: fan triangles of a glyph's positions, through its transform. */
export const FILL_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
uniform mat3 u_glyph;
${TO_CLIP}
void main() { gl_Position = toClip((u_glyph * vec3(a_pos, 1.0)).xy); }
`

/** The cover quad: a rectangle in device pixels (x0, y0, x1, y1), drawn as a 4-vertex strip. */
export const COVER_VS = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 u_rect;
${TO_CLIP}
void main() {
  int i = gl_VertexID;
  vec2 d = vec2((i & 1) == 0 ? u_rect.x : u_rect.z, i < 2 ? u_rect.y : u_rect.w);
  gl_Position = toClip(d);
}
`

/**
 * The stroke: one instance per side (prev, a, b, next), nine vertices: the side's quad (six) and the bevel triangle at
 * `a` (three; degenerate where the join is a miter). Joins are worked out in device pixels, so the width does not scale.
 */
export const STROKE_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in uvec4 a_seg;
uniform highp sampler2D u_pos;
uniform mat3 u_glyph;
uniform float u_half;
uniform float u_limit;
${TO_CLIP}
vec2 dev(uint i) {
  int k = int(i);
  vec2 p = texelFetch(u_pos, ivec2(k % ${W}, k / ${W}), 0).xy;
  return (u_glyph * vec3(p, 1.0)).xy;
}
vec2 dir(vec2 from, vec2 to, vec2 fallback) {
  vec2 d = to - from;
  float l = length(d);
  return l > 1e-6 ? d / l : fallback;
}
vec2 perp(vec2 d) { return vec2(-d.y, d.x); }
// The corner of the side's quad at joint p on side s: the miter point, or the square end when the miter is too long.
vec2 corner(vec2 p, vec2 dIn, vec2 dOut, vec2 n, float s) {
  vec2 sum = perp(dIn) + perp(dOut);
  float l = length(sum);
  if (l > 1e-6) {
    vec2 m = sum / l;
    float c = dot(m, n);
    if (c > 1e-6 && 1.0 / c <= u_limit) return p + s * m * (u_half / c);
  }
  return p + s * n * u_half;
}
bool mitered(vec2 dIn, vec2 dOut, vec2 n) {
  vec2 sum = perp(dIn) + perp(dOut);
  float l = length(sum);
  if (!(l > 1e-6)) return false;
  float c = dot(sum / l, n);
  return c > 1e-6 && 1.0 / c <= u_limit;
}
void main() {
  vec2 prev = dev(a_seg.x);
  vec2 a = dev(a_seg.y);
  vec2 b = dev(a_seg.z);
  vec2 next = dev(a_seg.w);
  vec2 d1 = dir(a, b, vec2(1.0, 0.0));
  vec2 d0 = dir(prev, a, d1);
  vec2 d2 = dir(b, next, d1);
  vec2 n1 = perp(d1);
  int v = gl_VertexID;
  vec2 pos;
  if (v < 6) {
    // Triangles (A-, A+, B+) and (A-, B+, B-).
    int c = v == 0 || v == 3 ? 0 : v == 1 ? 1 : v == 2 || v == 4 ? 2 : 3;
    if (c == 0) pos = corner(a, d0, d1, n1, -1.0);
    else if (c == 1) pos = corner(a, d0, d1, n1, 1.0);
    else if (c == 2) pos = corner(b, d1, d2, n1, 1.0);
    else pos = corner(b, d1, d2, n1, -1.0);
  } else if (mitered(d0, d1, n1)) {
    pos = a;
  } else {
    // The bevel on the outer side of the turn at a.
    float turn = d0.x * d1.y - d0.y * d1.x;
    float s = turn > 0.0 ? -1.0 : 1.0;
    pos = v == 6 ? a : v == 7 ? a + s * perp(d0) * u_half : a + s * n1 * u_half;
  }
  gl_Position = toClip(pos);
}
`

/** One colour, premultiplied by the caller. */
export const COLOR_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 o;
void main() { o = u_color; }
`
