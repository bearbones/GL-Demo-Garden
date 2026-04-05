#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_prevFoam;
uniform vec2 u_resolution;
uniform vec2 u_boatPos;      // normalized position
uniform vec2 u_boatDir;      // normalized heading direction
uniform float u_boatSpeed;
uniform float u_foamDecay;
uniform float u_curlIntensity;
uniform float u_time;

// ── Constants ───────────────────────────────────────────────────────
const float WAKE_HALF_ANGLE = 0.48;  // ~27.5 degrees, wider for anime drama
const float FOAM_EMIT_RADIUS = 0.05; // Larger hull foam for zoomed view
const float DIFFUSION = 0.3;
const float ADVECTION = 0.5;

void main() {
  vec2 texel = 1.0 / u_resolution;

  // Read previous foam state
  float foam = texture(u_prevFoam, v_uv).r;

  // ── Diffusion (blur with neighbors) ──
  float fL = texture(u_prevFoam, v_uv + vec2(-texel.x, 0.0)).r;
  float fR = texture(u_prevFoam, v_uv + vec2( texel.x, 0.0)).r;
  float fU = texture(u_prevFoam, v_uv + vec2(0.0,  texel.y)).r;
  float fD = texture(u_prevFoam, v_uv + vec2(0.0, -texel.y)).r;
  float avg = (fL + fR + fU + fD) * 0.25;
  foam = mix(foam, avg, DIFFUSION * 0.1);

  // ── Advection (foam drifts backward from boat) ──
  vec2 advectDir = -u_boatDir * ADVECTION * 0.005;
  // Add curl noise for turbulent advection
  float n1 = snoise((v_uv + vec2(u_time * 0.05)) * 8.0);
  float n2 = snoise((v_uv + vec2(0.0, u_time * 0.05)) * 8.0 + 100.0);
  vec2 curlOffset = vec2(n1, -n2) * u_curlIntensity * 0.002;
  vec2 samplePos = v_uv - advectDir - curlOffset;
  float advectedFoam = texture(u_prevFoam, samplePos).r;
  foam = max(foam, advectedFoam * 0.95);

  // ── Decay ──
  foam *= u_foamDecay;

  // ── Foam emission in wake envelope ──
  vec2 toPixel = v_uv - u_boatPos;
  float distFromBoat = length(toPixel);

  // Project onto boat direction to get distance behind boat
  float behind = -dot(toPixel, u_boatDir);

  if (behind > 0.0 && distFromBoat > 0.005) {
    // Perpendicular distance from wake centerline
    float perpDist = abs(dot(toPixel, vec2(-u_boatDir.y, u_boatDir.x)));

    // Kelvin wake envelope
    float wakeWidth = behind * tan(WAKE_HALF_ANGLE);
    float inWake = smoothstep(wakeWidth, wakeWidth * 0.7, perpDist);

    // Foam density: stronger near the V-edges and close to boat
    float edgeFactor = smoothstep(wakeWidth * 0.3, wakeWidth * 0.8, perpDist);
    float proximityFactor = exp(-behind * 3.0);

    // Turbulence noise in wake
    float turbulence = fbm3(v_uv * 20.0 + u_time * 0.3) * 0.5 + 0.5;

    float emission = inWake * (edgeFactor * 0.8 + 0.3) * proximityFactor * u_boatSpeed;
    emission *= turbulence;

    // Direct foam near boat hull
    float hullFoam = exp(-distFromBoat * distFromBoat / (FOAM_EMIT_RADIUS * FOAM_EMIT_RADIUS));
    emission += hullFoam * u_boatSpeed * 2.0;

    foam = max(foam, emission);
  }

  // Clamp foam
  foam = clamp(foam, 0.0, 1.0);

  fragColor = vec4(foam, foam, foam, 1.0);
}
