#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

// Stress Field model: phase-field-style continuum damage growth.
// Damage accumulates wherever the squared stress-potential gradient
// exceeds the local fracture toughness — an fbm-heterogeneous field, so
// cracks curve organically instead of following prescribed geometry.
// Because damaged texels ground the potential (see stress-relax.glsl),
// the gradient concentrates at crack tips and growth self-propagates,
// branching where the field splits around obstacles.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform sampler2D u_stress;
uniform vec2 u_texel;
uniform float u_seed;
uniform float u_aspect;
uniform float u_time;
uniform float u_toughness;  // base drive threshold (slider)
uniform float u_hetero;     // toughness heterogeneity amplitude (slider)

const float BITE = 2.0;     // damage when a texel yields — fully grounds the
                            // potential so failures chain into filaments

void main() {
  vec4 st = texture(u_state, v_uv);

  vec2 lo = u_texel * 1.5;
  vec2 hi = 1.0 - lo;
  // No growth in the boundary layer: the fixed-value frame makes
  // one-sided gradients there that would nucleate phantom edge cracks
  vec2 margin = u_texel * 3.0;
  if (v_uv.x < margin.x || v_uv.x > 1.0 - margin.x || v_uv.y < margin.y || v_uv.y > 1.0 - margin.y) {
    fragColor = st;
    return;
  }
  float e = texture(u_stress, clamp(v_uv + vec2(u_texel.x, 0.0), lo, hi)).r;
  float w = texture(u_stress, clamp(v_uv - vec2(u_texel.x, 0.0), lo, hi)).r;
  float n = texture(u_stress, clamp(v_uv + vec2(0.0, u_texel.y), lo, hi)).r;
  float s = texture(u_stress, clamp(v_uv - vec2(0.0, u_texel.y), lo, hi)).r;
  vec2 g = vec2(e - w, n - s);
  float drive = dot(g, g);

  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  float tough = max(1.0 + u_hetero * fbm3(p * 5.0 + u_seed * 9.0), 0.12);

  // Stochastic sparse growth (dielectric-breakdown style): a texel above
  // threshold only yields with probability ~ excess², so the strongest-
  // driven site — the crack tip — consistently wins and growth stays
  // line-like instead of compacting into an Eden blob.
  float x = drive / (u_toughness * tough * tough);
  float prob = min(0.06 * pow(max(x - 1.0, 0.0), 2.0), 0.25);
  float r = hash21(p * 517.7 + vec2(fract(u_time * 7.31), fract(u_time * 3.17)) * 41.0);
  float d = st.r + (r < prob ? BITE : 0.0);

  fragColor = vec4(d, st.g, 0.0, 1.0);
}
