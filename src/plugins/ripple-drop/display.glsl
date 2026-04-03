#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/anime-style.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_heightfield;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_strokeWidth;
uniform float u_breakFreq;

// ── Constants ───────────────────────────────────────────────────────
const vec3 WATER_DEEP   = vec3(0.039, 0.055, 0.165);   // #0a0e2a
const vec3 WATER_MID    = vec3(0.055, 0.082, 0.200);
const vec3 STROKE_COLOR = vec3(0.784, 0.871, 1.0);      // #c8deff
const float RING_FADE   = 0.6;
const float PERSPECTIVE_TILT = 0.15;

void main() {
  vec2 texel = 1.0 / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;

  // Sample heightfield
  float h = texture(u_heightfield, v_uv).r;

  // Gradient of heightfield for edge/ring detection
  float hL = texture(u_heightfield, v_uv + vec2(-texel.x, 0.0)).r;
  float hR = texture(u_heightfield, v_uv + vec2( texel.x, 0.0)).r;
  float hU = texture(u_heightfield, v_uv + vec2(0.0,  texel.y)).r;
  float hD = texture(u_heightfield, v_uv + vec2(0.0, -texel.y)).r;

  vec2 grad = vec2(hR - hL, hU - hD) * 0.5;
  float gradMag = length(grad);

  // Ring detection: zero-crossings / peaks of height
  float dh_dx = hR - hL;
  float dh_dy = hU - hD;
  float curvature = abs((hL + hR + hU + hD) - 4.0 * h);

  // Combine gradient magnitude and curvature for ring visibility
  float ringStrength = smoothstep(0.001, 0.02, gradMag) * smoothstep(0.0, 0.005, curvature);

  // Angle along ring for break pattern
  float angle = atan(grad.y, grad.x);

  // Perspective foreshortening: make strokes thinner toward top
  float perspFactor = 1.0 - PERSPECTIVE_TILT * (1.0 - v_uv.y);

  // Ink stroke with hand-drawn breaks
  float seed = angle * 3.0 + length(v_uv - 0.5) * 20.0;
  float strokeAlpha = inkStroke(
    gradMag - 0.01,   // SDF-like distance
    u_strokeWidth * perspFactor * 0.03,
    u_breakFreq,
    seed
  );

  // Additional ring emphasis from height peaks
  float peakStroke = smoothstep(0.005, 0.015, abs(h)) * ringStrength;
  strokeAlpha = max(strokeAlpha * ringStrength, peakStroke * 0.6);

  // Clamp stroke
  strokeAlpha = clamp(strokeAlpha, 0.0, 1.0);

  // Fade rings with distance from center (amplitude naturally decays)
  float distFromCenter = length(v_uv - 0.5);
  float fadeFactor = 1.0 - smoothstep(0.1, RING_FADE, distFromCenter) * 0.5;
  strokeAlpha *= fadeFactor;

  // Water base color with subtle variation
  float waterNoise = snoise(v_uv * 8.0 + u_time * 0.1) * 0.03;
  vec3 waterColor = mix(WATER_DEEP, WATER_MID, v_uv.y * 0.5 + waterNoise);

  // Height-based subtle color shift
  waterColor += vec3(0.0, 0.01, 0.03) * h * 10.0;

  // Composite stroke over water
  vec3 color = mix(waterColor, STROKE_COLOR, strokeAlpha);

  // Subtle specular highlight on wave peaks
  float specular = smoothstep(0.01, 0.03, h) * 0.15;
  color += vec3(specular);

  fragColor = vec4(color, 1.0);
}
