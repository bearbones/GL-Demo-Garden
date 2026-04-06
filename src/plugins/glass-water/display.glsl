#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/anime-style.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_warpStrength;
uniform float u_coarseWidth;
uniform float u_fineWidth;
uniform float u_driftSpeed;
uniform float u_coarseLevels;

// ── Color Palette ──────────────────────────────────────────────────
const vec3 WATER_DEEP  = vec3(0.02, 0.12, 0.22);
const vec3 WATER_MID   = vec3(0.04, 0.22, 0.38);
const vec3 WATER_LIGHT = vec3(0.06, 0.28, 0.45);
const vec3 CREST_COLOR = vec3(0.90, 0.94, 0.98);

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;
  uv.x *= aspect;

  float time = u_time;

  // ── Directional drift ──────────────────────────────────────────
  vec2 driftDir = normalize(vec2(0.3, 1.0));
  vec2 drift = driftDir * u_driftSpeed * time;
  vec2 baseUV = uv + drift;

  // ── Two-level recursive domain warp ────────────────────────────
  vec2 warp1 = vec2(
    snoise(baseUV * 1.2 + time * 0.04),
    snoise(baseUV * 1.2 + time * 0.04 + 37.0)
  ) * u_warpStrength;

  vec2 warp2 = vec2(
    snoise((baseUV + warp1 * 0.3) * 2.5 + time * 0.02 + 73.0),
    snoise((baseUV + warp1 * 0.3) * 2.5 + time * 0.02 + 111.0)
  ) * u_warpStrength * 0.55;

  vec2 warpedUV = baseUV + warp1 + warp2;

  // Finite-difference step for gradient compensation
  float eps = 1.5 / u_resolution.y;

  // ── Layer A: Coarse crests ─────────────────────────────────────
  float freqA = 2.8;
  float levelsA = u_coarseLevels;

  float nA  = snoise(warpedUV * freqA) * levelsA;
  float nAr = snoise((warpedUV + vec2(eps, 0.0)) * freqA) * levelsA;
  float nAu = snoise((warpedUV + vec2(0.0, eps)) * freqA) * levelsA;
  vec2 gradA = vec2(nAr - nA, nAu - nA) / eps;
  float gradLenA = length(gradA);

  float fractA = fract(nA);
  float distA = abs(fractA - 0.5) * 2.0;
  float pixDistA = distA / max(gradLenA, 0.01);

  // Width modulation for hand-drawn variation
  float widthModA = 0.7 + 0.6 * snoise(warpedUV * 5.0 + 200.0);
  float baseWidthA = u_coarseWidth * widthModA;
  float lineA = 1.0 - smoothstep(baseWidthA * 0.15, baseWidthA, pixDistA);

  // Ink-stroke breaks
  float breakSeedA = atan(gradA.y, gradA.x) * 4.0 + length(warpedUV) * 15.0;
  float breakNoiseA = snoise(vec2(breakSeedA * 0.7, breakSeedA * 0.3));
  float breakMaskA = smoothstep(-0.15, 0.35,
    sin(breakSeedA * 2.5 + breakNoiseA * 2.0));
  lineA *= breakMaskA;

  // ── Layer B: Fine detail crests ────────────────────────────────
  vec2 fineWarp = warpedUV + vec2(
    snoise(baseUV * 3.5 + 150.0 + time * 0.03),
    snoise(baseUV * 3.5 + 190.0 + time * 0.03)
  ) * 0.12;
  // Slightly faster drift for parallax
  fineWarp += driftDir * u_driftSpeed * 0.3 * time;

  float freqB = 6.5;
  float levelsB = 7.0;

  float nB  = snoise(fineWarp * freqB + 50.0) * levelsB;
  float nBr = snoise((fineWarp + vec2(eps, 0.0)) * freqB + 50.0) * levelsB;
  float nBu = snoise((fineWarp + vec2(0.0, eps)) * freqB + 50.0) * levelsB;
  vec2 gradB = vec2(nBr - nB, nBu - nB) / eps;
  float gradLenB = length(gradB);

  float fractB = fract(nB);
  float distB = abs(fractB - 0.5) * 2.0;
  float pixDistB = distB / max(gradLenB, 0.01);

  float widthModB = 0.6 + 0.8 * snoise(fineWarp * 8.0 + 300.0);
  float baseWidthB = u_fineWidth * widthModB;
  float lineB = 1.0 - smoothstep(baseWidthB * 0.1, baseWidthB, pixDistB);

  // More frequent breaks for dashed feel
  float breakSeedB = atan(gradB.y, gradB.x) * 6.0 + length(fineWarp) * 25.0;
  float breakNoiseB = snoise(vec2(breakSeedB * 0.5, breakSeedB * 0.4));
  float breakMaskB = smoothstep(-0.1, 0.4,
    sin(breakSeedB * 4.0 + breakNoiseB * 2.5));
  lineB *= breakMaskB;

  // ── Composite crest alpha ──────────────────────────────────────
  float crestAlpha = clamp(lineA * 0.85 + lineB * 0.45, 0.0, 1.0);

  // ── Water background ───────────────────────────────────────────
  float bgNoise = fbm3(uv * 3.0 + time * 0.02) * 0.5 + 0.5;
  vec3 water = mix(WATER_DEEP, WATER_MID, bgNoise * 0.7 + 0.15);

  // Darken near crest convergence zones
  float convergence = smoothstep(0.0, 0.06, gradLenA * 0.01);
  water = mix(water, WATER_DEEP, convergence * 0.3);

  // Lighter patches between crests
  float betweenCrests = smoothstep(0.3, 0.6, pixDistA * baseWidthA);
  water = mix(water, WATER_LIGHT, betweenCrests * bgNoise * 0.15);

  // ── Final composite ────────────────────────────────────────────
  vec3 color = mix(water, CREST_COLOR, crestAlpha);

  // Subtle posterization for cel-shaded feel
  color = posterize(color, 12.0);

  fragColor = vec4(color, 1.0);
}
