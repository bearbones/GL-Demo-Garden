#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

// One crack-propagation step over the damage field (run several times
// per frame, ping-pong).
//
// State encoding: R = crack depth, G = live fracture energy.
//
// Energy spreads to neighbours, paying a cost set by two cellular fault
// fields, and damage is only recorded along their valleys:
//
//  - PRIMARY faults: huge Voronoi cells, so the borders are long lines
//    that reach across the screen. The lookup space is domain-warped by
//    smooth noise (wander) plus a per-cell random offset (sharp kinks),
//    giving the jittery-angular look of a real sidewalk crack. Depth is
//    uncapped: these are the cracks that deepen, widen, and eventually
//    split the slab.
//
//  - WEB: a fine cellular field whose valleys carry a cost floor, so
//    tap energy only floods it for a short radius — thin spiderweb
//    crackle around the strike point. Its depth saturates at WEB_CAP,
//    below both the "deep" analysis threshold and the ember/light-shaft
//    thresholds, so repeated strikes can't chew the web into a hole.
//
// Conduction keys on depth only primary cracks (and the strike-point
// spokes) exceed, so a repeat tap floods the existing long cracks
// almost for free and pushes new growth out of their tips.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_seed;
uniform float u_aspect;

const float BASE_COST = 0.008;     // travel cost along a perfect fault line
const float STRENGTH_COST = 1.6;   // extra cost through solid rock
const float WEB_TAX = 0.014;       // cost floor on web valleys → small radius
const float CONDUCT = 0.9;         // cost reduction inside deep cracks
const float DECAY = 0.972;         // per-step energy dissipation in rock —
                                   // caps how far ONE tap can grow a crack
const float DECAY_CONDUIT = 0.995; // …but deep cracks channel energy with
                                   // little loss, so retaps reach the tips
const float DEPTH_RATE = 0.07;     // depth accumulated per step per unit energy
const float WEB_CAP = 1.3;         // web crackle saturates here (deep = 1.4)
const float CUTOFF = 0.015;        // energy below this dies out

// F2 − F1 cellular distance: zero exactly on Voronoi cell borders, which
// are straight segments meeting at sharp junctions
float voroEdge(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(ip + g + u_seed);
      vec2 r = g + o - fp;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; }
      else { f2 = min(f2, d); }
    }
  }
  return sqrt(f2) - sqrt(f1);
}

// Random offset field with LINEAR (unsmoothed) bilinear interpolation:
// continuous everywhere — so warped lines never tear — but its gradient
// jumps at cell borders, putting a sharp kink in anything it warps
vec2 kinkField(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 a = hash22(i + u_seed + 3.7);
  vec2 b = hash22(i + vec2(1.0, 0.0) + u_seed + 3.7);
  vec2 c = hash22(i + vec2(0.0, 1.0) + u_seed + 3.7);
  vec2 d = hash22(i + vec2(1.0, 1.0) + u_seed + 3.7);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) - 0.5;
}

void rockFields(vec2 uv, out float primary, out float web) {
  vec2 p = vec2(uv.x * u_aspect, uv.y);
  // The kink grid is rotated so heading changes never align with the
  // screen axes; the warp itself is continuous (see kinkField), so the
  // fault kinks ~every cell without shear discontinuities
  vec2 pr = mat2(0.891, 0.454, -0.454, 0.891) * p;
  vec2 pw = p + 0.035 * kinkField(pr * 13.0);
  primary = voroEdge(pw * 2.2 + u_seed * 7.0) * 1.4;
  web = voroEdge(p * 8.0 + u_seed * 3.0) * 2.6 + WEB_TAX;
}

void main() {
  vec4 s = texture(u_state, v_uv);

  // Strongest energy in the 8-neighbourhood. Clamp sample positions so
  // the REPEAT-wrapped state texture can't leak cracks across edges.
  vec2 lo = u_texel * 0.5;
  vec2 hi = 1.0 - lo;
  float best = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec2 uv = clamp(v_uv + vec2(float(i), float(j)) * u_texel, lo, hi);
      best = max(best, texture(u_state, uv).g);
    }
  }

  float primary, web;
  rockFields(v_uv, primary, web);

  float cost = BASE_COST + STRENGTH_COST * min(primary, web);
  // Deep cracks conduct: the gate sits above WEB_CAP so only primary
  // faults and strike spokes become highways for later taps
  float conduit = clamp((s.r - 1.0) / 1.5, 0.0, 1.0);
  cost *= 1.0 - CONDUCT * conduit;

  float e = max(s.g, best - cost) * mix(DECAY, DECAY_CONDUIT, conduit);
  if (e < CUTOFF) e = 0.0;

  // Gaussian deposit profiles, normalized by the field gradient so the
  // band is a constant width in PIXELS: a young crack crosses the
  // display threshold only in a hairline core, widens gradually as it
  // deepens, and never bloats into wedges where the field goes flat
  float gp = max(length(vec2(dFdx(primary), dFdy(primary))), 1e-4);
  float valleyP = exp(-pow(primary / (2.2 * gp), 2.0));
  float gw = max(length(vec2(dFdx(web), dFdy(web))), 1e-4);
  float valleyW = exp(-pow(max(web - WEB_TAX, 0.0) / (1.8 * gw), 2.0));
  float deposit = e * DEPTH_RATE * valleyP
                + e * DEPTH_RATE * 0.9 * valleyW * (1.0 - smoothstep(WEB_CAP - 0.2, WEB_CAP, s.r));
  float d = s.r + deposit;

  fragColor = vec4(d, e, 0.0, 1.0);
}
