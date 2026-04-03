#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_strokeWidth;
uniform float u_breakFrequency;
uniform float u_damping;

// --- Included library code ---
#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/anime-style.glsl"

// --- Constants ---
const vec3 WATER_COLOR_DEEP    = vec3(0.01, 0.03, 0.06);
const vec3 WATER_COLOR_SHALLOW = vec3(0.02, 0.06, 0.10);
const vec3 STROKE_COLOR        = vec3(0.85, 0.90, 0.95);
const float RING_FADE_DISTANCE = 0.35;    // how far from center rings remain visible
const float PERSPECTIVE_TILT   = 0.25;    // 0 = top-down, 1 = oblique
const float BREAK_AMOUNT       = 0.65;    // how strong the gaps are (0-1)
const float HEIGHT_TO_WIDTH    = 0.5;     // how much height variation affects stroke width

void main() {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv;

  // Sample heightfield
  float texelX = 1.0 / u_resolution.x;
  float texelY = 1.0 / u_resolution.y;
  float h  = texture(u_state, uv).r;
  float hL = texture(u_state, uv + vec2(-texelX, 0.0)).r;
  float hR = texture(u_state, uv + vec2( texelX, 0.0)).r;
  float hU = texture(u_state, uv + vec2(0.0,  texelY)).r;
  float hD = texture(u_state, uv + vec2(0.0, -texelY)).r;

  // Gradient of heightfield
  vec2 grad = vec2(hR - hL, hU - hD) * 0.5;
  float gradMag = length(grad);

  // Absolute height for stroke intensity
  float absH = abs(h);

  // Water surface base color with subtle noise
  float waterNoise = snoise(uv * 8.0 + u_time * 0.1) * 0.02;
  vec3 waterColor = mix(WATER_COLOR_DEEP, WATER_COLOR_SHALLOW, uv.y + waterNoise);

  // Subtle caustic-like pattern on base water
  float caustic = 0.0;
  vec2 cp = uv * 5.0;
  caustic += sin(cp.x * 2.3 + u_time * 0.3) * sin(cp.y * 2.7 - u_time * 0.2) * 0.5;
  caustic += sin(cp.x * 1.7 - u_time * 0.4) * sin(cp.y * 1.9 + u_time * 0.25) * 0.5;
  caustic = caustic * 0.5 + 0.5;
  waterColor += vec3(0.003, 0.008, 0.015) * caustic;

  // --- Anime-style ripple strokes ---
  // Use gradient magnitude to detect ring positions (where waves have steep slope)
  // and absolute height to detect peaks

  // Approach: the gradient magnitude peaks at the edges of each ring.
  // We use this to create stroke-like lines.

  // Create a seed coordinate for noise-based breaks.
  // Use angle around the nearest wave center for angular breaks.
  // Since we don't track centers explicitly, use screen-space noise.
  float angleSeed = atan(uv.y - 0.5, (uv.x - 0.5) * aspect.x) * 3.0;
  float spatialSeed = length((uv - 0.5) * aspect) * 20.0;

  // Combine gradient magnitude and height for ring detection
  float ringIntensity = gradMag * 15.0;

  // Stroke width modulation based on height (hand-drawn perspective feel)
  float widthMod = 1.0 + absH * HEIGHT_TO_WIDTH * 10.0;
  float strokeW = u_strokeWidth * widthMod;

  // Create the ink stroke effect
  // Map gradient magnitude to a stroke: high gradient = on the ring edge
  float strokeDist = 1.0 - ringIntensity;  // invert so ring = small distance
  strokeDist = max(strokeDist, 0.0);

  // Thickness variation from noise
  float thickNoise = snoise(vec2(angleSeed * 1.3, spatialSeed * 0.7)) * 0.35;
  float adjustedWidth = strokeW * (1.0 + thickNoise);

  // Base stroke from ring intensity
  float stroke = smoothstep(adjustedWidth, 0.0, strokeDist);

  // Break/gap mask - noise driven along the ring circumference
  float breakSeed = angleSeed + spatialSeed * 0.3;
  float breakNoise = snoise(vec2(breakSeed * u_breakFrequency, breakSeed * u_breakFrequency * 0.7 + 17.0));
  float breakMask = smoothstep(-0.2, 0.3, breakNoise * BREAK_AMOUNT);
  stroke *= breakMask;

  // Fade rings with distance from center (hand-drawn economy: only 2-4 visible)
  float centerDist = length((uv - 0.5) * aspect);
  float distFade = 1.0 - smoothstep(0.0, RING_FADE_DISTANCE, centerDist);
  // Actually, don't fade by center distance — fade by ring intensity instead
  // This ensures only actual wave activity shows strokes
  stroke *= smoothstep(0.01, 0.08, ringIntensity);

  // Clamp and apply
  stroke = clamp(stroke, 0.0, 1.0);

  // Apply perspective-foreshortening tilt to stroke brightness
  // Strokes at the "bottom" of screen (closer to viewer) are slightly brighter/thicker
  float perspBias = mix(1.0, 0.7 + 0.6 * uv.y, PERSPECTIVE_TILT);
  stroke *= perspBias;

  // Slight glow around strokes
  float glow = smoothstep(adjustedWidth * 3.0, 0.0, strokeDist) * 0.15;
  glow *= breakMask;
  glow *= smoothstep(0.01, 0.08, ringIntensity);

  // Compose final color
  vec3 color = waterColor;
  color += STROKE_COLOR * glow * 0.3;  // soft glow layer
  color = mix(color, STROKE_COLOR, stroke);  // hard stroke layer

  fragColor = vec4(color, 1.0);
}
