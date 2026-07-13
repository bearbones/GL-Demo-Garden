#version 300 es
precision highp float;

// One Jacobi relaxation step of the scalar stress potential (phi) used by
// the Stress Field and Weibull Bonds fracture models.
//
// While a strike is active it clamps a source disk of phi toward 1;
// cracked material grounds phi to 0 (a crack is a free surface that
// relieves stress); the slab boundary is also grounded. Relaxation
// spreads the potential between those constraints, so its gradient —
// the stress proxy the growth passes consume — concentrates exactly
// where real stress concentrates: at crack tips.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_stress;  // R = phi
uniform sampler2D u_state;   // damage field (R = depth)
uniform vec2 u_texel;
uniform vec2 u_load;         // strike position, uv (origin bottom-left)
uniform float u_loadAmp;     // 0 when no strike is active
uniform float u_loadRadius;  // source disk radius, units of frame height
uniform float u_ambient;     // stored stress held at the slab's frame
uniform float u_aspect;

void main() {
  vec2 lo = u_texel * 1.5;
  vec2 hi = 1.0 - lo;
  // The frame holds the slab under ambient stress: once a crack grows
  // long, its tips feed on this stored energy (Griffith instability)
  // rather than only on the strike's local field
  if (v_uv.x < lo.x || v_uv.x > hi.x || v_uv.y < lo.y || v_uv.y > hi.y) {
    fragColor = vec4(u_ambient, 0.0, 0.0, 1.0);
    return;
  }

  float n = texture(u_stress, clamp(v_uv + vec2(0.0, u_texel.y), lo, hi)).r;
  float s = texture(u_stress, clamp(v_uv - vec2(0.0, u_texel.y), lo, hi)).r;
  float e = texture(u_stress, clamp(v_uv + vec2(u_texel.x, 0.0), lo, hi)).r;
  float w = texture(u_stress, clamp(v_uv - vec2(u_texel.x, 0.0), lo, hi)).r;
  float phi = 0.25 * (n + s + e + w);

  // Cracks relieve stress: damaged texels pull phi to 0, which pushes
  // the gradient out to the crack tips. Grounding is suppressed near the
  // active load so the strike's own crater can't screen the source and
  // choke off growth beyond it.
  vec2 d = (v_uv - u_load) * vec2(u_aspect, 1.0);
  float near = exp(-dot(d, d) / (4.0 * u_loadRadius * u_loadRadius)) * step(0.01, u_loadAmp);
  float dmg = smoothstep(0.6, 1.8, texture(u_state, v_uv).r) * (1.0 - near);
  phi *= 1.0 - dmg;

  // Active strike: clamp the source disk up toward the load amplitude
  phi = max(phi, u_loadAmp * exp(-dot(d, d) / (u_loadRadius * u_loadRadius)));

  fragColor = vec4(phi, 0.0, 0.0, 1.0);
}
