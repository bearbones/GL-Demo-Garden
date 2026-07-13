#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

// Weibull Bonds model: random-fuse-style discrete breakdown.
// Every texel carries a quenched strength drawn from a Weibull
// distribution (rock strength statistics); a texel adjacent to the
// crack network breaks outright when the stress-potential gradient
// beats its strength. Broken texels ground the potential, stress
// redistributes on the next relaxation steps, and the next-weakest
// bonds fail — avalanche dynamics, jagged tortuous cracks.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform sampler2D u_stress;
uniform vec2 u_texel;
uniform float u_seed;
uniform float u_aspect;
uniform float u_strength;  // strength scale (slider)
uniform float u_scatter;   // Weibull 1/m: higher = wilder strength scatter (slider)
uniform float u_fatigue;   // cumulative weakening from repeated strikes
                           // (subcritical crack growth), multiplies strength

const float BROKEN = 2.2;  // depth assigned to a freshly broken bond

void main() {
  vec4 st = texture(u_state, v_uv);
  if (st.r >= BROKEN) {
    fragColor = st;
    return;
  }
  // No growth in the boundary layer (see grow-stress.glsl)
  vec2 margin = u_texel * 3.0;
  if (v_uv.x < margin.x || v_uv.x > 1.0 - margin.x || v_uv.y < margin.y || v_uv.y > 1.0 - margin.y) {
    fragColor = st;
    return;
  }

  // Candidate bonds sit on the crack surface: at least one 8-neighbour
  // is already broken (the strike stamps the initial crater)
  vec2 lo = u_texel * 0.5;
  vec2 hi = 1.0 - lo;
  float adj = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec2 uv = clamp(v_uv + vec2(float(i), float(j)) * u_texel, lo, hi);
      adj = max(adj, texture(u_state, uv).r);
    }
  }
  if (adj < 1.8) {
    fragColor = st;
    return;
  }

  float e = texture(u_stress, clamp(v_uv + vec2(u_texel.x, 0.0), lo, hi)).r;
  float w = texture(u_stress, clamp(v_uv - vec2(u_texel.x, 0.0), lo, hi)).r;
  float n = texture(u_stress, clamp(v_uv + vec2(0.0, u_texel.y), lo, hi)).r;
  float s = texture(u_stress, clamp(v_uv - vec2(0.0, u_texel.y), lo, hi)).r;
  vec2 g = vec2(e - w, n - s);

  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  float u = hash21(floor(p * 977.0) + u_seed * 13.7);
  float strength = u_strength * u_fatigue * pow(-log(max(1.0 - u, 1e-4)), u_scatter);

  float d = dot(g, g) > strength ? max(st.r, BROKEN) : st.r;
  fragColor = vec4(d, st.g, 0.0, 1.0);
}
