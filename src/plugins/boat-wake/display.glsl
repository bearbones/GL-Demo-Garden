#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_strokeBoldness;
uniform vec2 u_boatPos;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/anime-style.glsl"

// --- Constants ---
const vec3 WATER_COLOR     = vec3(0.08, 0.35, 0.50);  // flat teal-blue
const vec3 WATER_DEEP      = vec3(0.04, 0.22, 0.38);  // slightly darker variation
const vec3 FOAM_COLOR      = vec3(0.90, 0.92, 0.88);  // off-white foam
const vec3 FOAM_FILL_COLOR = vec3(0.45, 0.65, 0.72);  // lighter blue for foam interior
const float CURL_SCALE     = 25.0;       // scale of curling wave motifs
const float EDGE_THRESHOLD = 0.08;       // foam density threshold for edge detection

void main() {
  vec2 texel = 1.0 / u_resolution;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);

  // Sample foam field and neighbors for edge detection
  float foam = texture(u_state, v_uv).r;
  float fL = texture(u_state, v_uv + vec2(-texel.x * 2.0, 0.0)).r;
  float fR = texture(u_state, v_uv + vec2( texel.x * 2.0, 0.0)).r;
  float fU = texture(u_state, v_uv + vec2(0.0,  texel.y * 2.0)).r;
  float fD = texture(u_state, v_uv + vec2(0.0, -texel.y * 2.0)).r;

  // Gradient magnitude for edge detection
  vec2 grad = vec2(fR - fL, fU - fD) * 0.5;
  float gradMag = length(grad);

  // --- Base water with subtle variation ---
  float waterVar = snoise(v_uv * 4.0 + u_time * 0.05) * 0.5 + 0.5;
  vec3 water = mix(WATER_DEEP, WATER_COLOR, 0.5 + waterVar * 0.3);

  // Very subtle wave texture on open water
  float openWaveNoise = snoise(v_uv * 8.0 + u_time * 0.15);
  water += vec3(0.01, 0.02, 0.03) * openWaveNoise;

  // --- Curling wave motifs ---
  // Domain-warped noise creates flowing organic curl patterns within foam areas
  vec2 curlUV = v_uv * CURL_SCALE;
  float warp1 = snoise(curlUV * 0.3 + u_time * 0.1);
  float warp2 = snoise(curlUV * 0.3 + vec2(5.0, 7.0) + u_time * 0.1);
  vec2 warpedUV = curlUV + vec2(warp1, warp2) * 2.0;

  // The warped noise creates spiral/curl-like patterns
  float curlPattern = snoise(warpedUV * 0.5);
  curlPattern = smoothstep(-0.1, 0.4, curlPattern);

  // Combine foam density with curl pattern
  float foamWithCurls = foam * (0.6 + curlPattern * 0.6);

  // --- Edge extraction: bold outlines ---
  float edges = smoothstep(EDGE_THRESHOLD * 0.5, EDGE_THRESHOLD * 2.0, gradMag);

  // Add edges from curl pattern boundaries within foam area
  float curlGradX = snoise(warpedUV * 0.5 + vec2(0.01, 0.0)) - snoise(warpedUV * 0.5 - vec2(0.01, 0.0));
  float curlGradY = snoise(warpedUV * 0.5 + vec2(0.0, 0.01)) - snoise(warpedUV * 0.5 - vec2(0.0, 0.01));
  float curlEdge = length(vec2(curlGradX, curlGradY)) * 15.0;
  curlEdge *= smoothstep(0.05, 0.2, foam); // only show curl edges within foam

  edges = max(edges, curlEdge);

  // --- Stroke rendering ---
  // Seed for stroke variation
  float strokeSeed = v_uv.x * 30.0 + v_uv.y * 20.0;
  float thickNoise = snoise(vec2(strokeSeed, strokeSeed * 0.7)) * 0.2;
  float strokeWidth = u_strokeBoldness * (1.0 + thickNoise);

  // Bold stroke from edges
  float stroke = smoothstep(0.0, strokeWidth, edges) * smoothstep(strokeWidth * 3.0, strokeWidth, edges - strokeWidth);
  // Simpler: just threshold the edges for bold lines
  stroke = smoothstep(0.3, 0.6, edges) * smoothstep(0.0, 0.15, foam);

  // --- Interior foam fill ---
  float interiorFill = smoothstep(0.08, 0.25, foamWithCurls);

  // --- Compose ---
  vec3 color = water;

  // Interior fill: slightly lighter water within foam areas
  color = mix(color, FOAM_FILL_COLOR, interiorFill * 0.4);

  // Bold foam outlines
  color = mix(color, FOAM_COLOR, stroke * 0.9);

  // Small boat marker
  float boatDist = length((v_uv - u_boatPos) * aspect);
  float boat = smoothstep(0.008, 0.004, boatDist);
  color = mix(color, vec3(0.3, 0.2, 0.15), boat);

  fragColor = vec4(color, 1.0);
}
