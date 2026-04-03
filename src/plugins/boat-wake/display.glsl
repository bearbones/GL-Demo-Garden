#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/anime-style.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_foam;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_strokeBoldness;
uniform vec2 u_boatPos;

// ── Constants ───────────────────────────────────────────────────────
const vec3 WATER_COLOR   = vec3(0.102, 0.290, 0.353);  // #1a4a5a
const vec3 WATER_DEEP    = vec3(0.051, 0.157, 0.251);  // #0d2840
const vec3 FOAM_COLOR    = vec3(0.910, 0.941, 1.0);    // #e8f0ff
const vec3 OUTLINE_COLOR = vec3(0.102, 0.165, 0.227);  // #1a2a3a
const float CURL_SCALE   = 12.0;

void main() {
  vec2 texel = 1.0 / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;

  // Sample foam field
  float foam = texture(u_foam, v_uv).r;

  // Gradient of foam for edge detection
  float fL = texture(u_foam, v_uv + vec2(-texel.x, 0.0)).r;
  float fR = texture(u_foam, v_uv + vec2( texel.x, 0.0)).r;
  float fU = texture(u_foam, v_uv + vec2(0.0,  texel.y)).r;
  float fD = texture(u_foam, v_uv + vec2(0.0, -texel.y)).r;
  vec2 grad = vec2(fR - fL, fU - fD) * 0.5;
  float gradMag = length(grad);

  // ── Water base ──
  // Subtle wave pattern
  float waveNoise = snoise(v_uv * 6.0 + vec2(u_time * 0.08, u_time * 0.03)) * 0.5 + 0.5;
  float waveNoise2 = snoise(v_uv * 15.0 + vec2(-u_time * 0.05, u_time * 0.06)) * 0.5 + 0.5;
  vec3 water = mix(WATER_DEEP, WATER_COLOR, waveNoise * 0.6 + 0.2);
  water += vec3(0.01, 0.02, 0.03) * waveNoise2;

  // ── Foam rendering ──
  // Bold outlines at foam edges (ukiyo-e style)
  float edgeSeed = atan(grad.y, grad.x) * 5.0 + length(v_uv - u_boatPos) * 30.0;
  float edgeStroke = inkStroke(
    gradMag - 0.02,
    u_strokeBoldness * 0.02,
    5.0,
    edgeSeed
  );
  edgeStroke *= smoothstep(0.005, 0.02, gradMag);

  // Interior foam fill (lighter, flat regions)
  float foamFill = smoothstep(0.15, 0.4, foam);

  // Curling wave shapes from warped noise
  vec2 warpedUV = v_uv * CURL_SCALE + vec2(
    snoise(v_uv * 4.0 + u_time * 0.1) * 0.5,
    snoise(v_uv * 4.0 + 100.0 + u_time * 0.1) * 0.5
  );
  float curlPattern = smoothstep(0.3, 0.5, snoise(warpedUV)) * foam;

  // Composite foam
  vec3 foamRender = mix(water, FOAM_COLOR * 0.8, foamFill * 0.6);
  foamRender = mix(foamRender, FOAM_COLOR, curlPattern * 0.4);

  // Bold outline
  foamRender = mix(foamRender, OUTLINE_COLOR, edgeStroke * 0.7);

  // Bright foam highlights
  float highlight = smoothstep(0.5, 0.8, foam) * 0.3;
  foamRender += vec3(highlight);

  // ── Boat marker ──
  float boatDist = length((v_uv - u_boatPos) * vec2(aspect, 1.0));
  float boatMarker = smoothstep(0.008, 0.004, boatDist);
  vec3 boatColor = vec3(0.9, 0.85, 0.7);

  vec3 color = mix(foamRender, boatColor, boatMarker);

  fragColor = vec4(color, 1.0);
}
