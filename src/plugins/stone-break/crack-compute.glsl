#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

// One crack-propagation step over the damage field (run several times
// per frame, ping-pong).
//
// State encoding: R = crack depth (accumulates, never heals),
//                 G = live fracture energy.
//
// Energy spreads to neighbours, paying a cost set by the rock's local
// strength. Strength is a min-of-ridges noise field: its valleys are
// thin connected curves, so energy only travels far along those curves
// and the surviving trace is a branching crack rather than a blob.
// Pixels that are already cracked conduct energy almost for free, so a
// repeat tap floods the existing network and pushes new growth out of
// its tips — deepening and branching what was already there.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_seed;
uniform float u_aspect;

const float BASE_COST = 0.008;     // travel cost along a perfect fault line
const float STRENGTH_COST = 1.6;   // extra cost through solid rock
const float CONDUCT = 0.9;         // cost reduction inside existing cracks
const float DECAY = 0.988;         // per-step energy dissipation
const float DEPTH_RATE = 0.05;     // depth accumulated per step per unit energy
const float CUTOFF = 0.015;        // energy below this dies out

// F2 − F1 cellular distance: zero exactly on Voronoi cell borders, which
// are straight segments meeting at sharp junctions — sidewalk-crack angles
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

float rockStrength(vec2 uv) {
  vec2 p = vec2(uv.x * u_aspect, uv.y);
  float v1 = voroEdge(p * 3.0 + u_seed * 7.0);  // primary slab joints
  float v2 = voroEdge(p * 8.0 + u_seed * 3.0);  // fine connector web
  // The fine web costs more, so it's only affordable near a strike —
  // dense spiderwebbing close in, long straight faults farther out
  return min(v1 * 1.4, v2 * 2.6);
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

  float st = rockStrength(v_uv);
  float cost = BASE_COST + STRENGTH_COST * st;
  // Only genuinely cracked pixels conduct — faint damage doesn't count,
  // or the conductivity feedback swells cracks into blobs
  cost *= 1.0 - CONDUCT * clamp(s.r - 0.25, 0.0, 1.0);

  float e = max(s.g, best - cost) * DECAY;
  if (e < CUTOFF) e = 0.0;

  // Damage is only recorded along fault valleys (and in existing cracks);
  // solid rock passes energy near the impact but doesn't scar
  float valley = smoothstep(0.1, 0.03, st);
  float d = s.r + e * DEPTH_RATE * max(valley, step(0.25, s.r));

  fragColor = vec4(d, e, 0.0, 1.0);
}
