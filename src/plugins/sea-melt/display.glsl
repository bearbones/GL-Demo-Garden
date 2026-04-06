#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/anime-style.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_warpStrength;
uniform float u_crestWidth;
uniform float u_driftSpeed;
uniform float u_crestCount;

// ── Color Palette ──────────────────────────────────────────────────
const vec3 WATER_DEEP  = vec3(0.03, 0.14, 0.28);
const vec3 WATER_MID   = vec3(0.05, 0.20, 0.38);
const vec3 CREST_WHITE = vec3(0.92, 0.94, 0.96);

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;
  uv.x *= aspect;

  float time = u_time;

  // ── Gentle directional drift ─────────────────────────────────────
  vec2 drift = vec2(0.08, 0.22) * u_driftSpeed * time;
  vec2 baseUV = uv + drift;

  // ── Smooth domain warp (gentle meander, not chaotic) ─────────────
  // Single level of low-frequency warp for smooth, flowing curves
  vec2 warp = vec2(
    snoise(baseUV * 0.7 + time * 0.025),
    snoise(baseUV * 0.7 + time * 0.025 + 37.0)
  ) * u_warpStrength;

  // Subtle secondary warp for organic variation (NOT turbulence)
  vec2 warp2 = vec2(
    snoise((baseUV + warp * 0.2) * 1.4 + time * 0.015 + 73.0),
    snoise((baseUV + warp * 0.2) * 1.4 + time * 0.015 + 111.0)
  ) * u_warpStrength * 0.3;

  vec2 warpedUV = baseUV + warp + warp2;

  // ── Gradient-compensated isolines ────────────────────────────────
  float eps = 1.5 / u_resolution.y;
  float freq = 1.2;
  float levels = u_crestCount;

  float n  = snoise(warpedUV * freq) * levels;
  float nr = snoise((warpedUV + vec2(eps, 0.0)) * freq) * levels;
  float nu = snoise((warpedUV + vec2(0.0, eps)) * freq) * levels;
  vec2 grad = vec2(nr - n, nu - n) / eps;
  float gradLen = length(grad);

  // Distance to nearest isoline in UV space
  float fractN = fract(n);
  float distToLine = abs(fractN - 0.5) * 2.0;
  float pixDist = distToLine / max(gradLen, 2.0);

  // ── Width modulation along the crest ─────────────────────────────
  // Slow noise makes some parts of the ribbon wider/narrower
  float widthMod = 0.6 + 0.8 * (snoise(warpedUV * 2.0 + 200.0) * 0.5 + 0.5);
  float crestW = u_crestWidth * widthMod;

  // ── Flat, matte crest with razor-sharp edges ──────────────────────
  // Slight edge irregularity for hand-painted feel
  float edgeNoise = snoise(warpedUV * 12.0 + 500.0) * 0.002;
  float d = pixDist + edgeNoise;

  // 1-pixel anti-aliased hard edge via fwidth
  float aa = fwidth(d);
  float crest = 1.0 - smoothstep(crestW - aa, crestW + aa, d);

  // ── Water background ─────────────────────────────────────────────
  // Subtle variation, mostly flat
  float bgNoise = snoise(uv * 2.5 + time * 0.015) * 0.5 + 0.5;
  vec3 water = mix(WATER_DEEP, WATER_MID, bgNoise * 0.3 + 0.2);

  // Slight darkening in troughs (far from crests)
  float troughDark = smoothstep(0.05, 0.15, pixDist) * 0.08;
  water -= vec3(troughDark * 0.5, troughDark * 0.3, troughDark * 0.1);

  // ── Final composite ──────────────────────────────────────────────
  vec3 color = mix(water, CREST_WHITE, crest);

  fragColor = vec4(color, 1.0);
}
