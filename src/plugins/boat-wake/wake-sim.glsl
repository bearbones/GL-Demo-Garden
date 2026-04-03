#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;    // .r = foam density, .g = foam age
uniform vec2 u_resolution;    // simulation texture size
uniform float u_time;
uniform float u_dt;
uniform vec2 u_boatPos;       // normalized boat position
uniform vec2 u_boatVel;       // boat velocity (normalized units/sec)
uniform float u_boatSpeed;    // |velocity| for wake strength
uniform float u_foamDecay;    // decay rate
uniform float u_curlIntensity;

#include "../../shaders/lib/noise.glsl"

// --- Constants ---
const float WAKE_ANGLE = 0.34;    // ~19.5 degrees in radians (Kelvin wake)
const float EMISSION_WIDTH = 0.015;
const float DIFFUSION = 0.3;

void main() {
  vec2 texel = 1.0 / u_resolution;
  vec4 state = texture(u_state, v_uv).rgba;
  float foam = state.r;
  float age = state.g;

  // --- Diffusion: average with neighbors ---
  float fL = texture(u_state, v_uv + vec2(-texel.x, 0.0)).r;
  float fR = texture(u_state, v_uv + vec2( texel.x, 0.0)).r;
  float fU = texture(u_state, v_uv + vec2(0.0,  texel.y)).r;
  float fD = texture(u_state, v_uv + vec2(0.0, -texel.y)).r;
  float laplacian = (fL + fR + fU + fD) - 4.0 * foam;
  foam += DIFFUSION * laplacian * u_dt;

  // --- Advection by curl noise ---
  // This creates the characteristic flowing, organic foam patterns
  float n1 = snoise(v_uv * 12.0 + u_time * 0.3);
  float n2 = snoise(v_uv * 12.0 + vec2(17.0, 31.0) + u_time * 0.3);
  vec2 curlVel = vec2(n1, -n2) * u_curlIntensity * 0.001;

  // Also advect foam away from boat (outward spread)
  vec2 toHere = v_uv - u_boatPos;
  float distToBoat = length(toHere);
  vec2 outward = distToBoat > 0.001 ? normalize(toHere) * 0.0005 : vec2(0.0);

  vec2 advectVel = curlVel + outward;
  vec2 srcUV = v_uv - advectVel;
  foam = mix(foam, texture(u_state, srcUV).r, 0.3);

  // --- Decay ---
  foam *= (1.0 - u_foamDecay * u_dt);
  age += u_dt;

  // --- Foam emission from boat wake ---
  if (u_boatSpeed > 0.001) {
    vec2 boatDir = normalize(u_boatVel);
    vec2 toPoint = v_uv - u_boatPos;

    // Project onto boat direction
    float along = dot(toPoint, boatDir);
    float across = abs(dot(toPoint, vec2(-boatDir.y, boatDir.x)));

    // Only behind the boat (negative along direction)
    if (along < 0.0) {
      float behindDist = -along;

      // Kelvin wake envelope: V-shape at WAKE_ANGLE
      float wakeWidth = behindDist * tan(WAKE_ANGLE);
      float inWake = smoothstep(wakeWidth + EMISSION_WIDTH, wakeWidth - EMISSION_WIDTH, across);

      // Turbulent center wake (directly behind boat)
      float centerWake = exp(-across * across * 8000.0) * exp(-behindDist * 4.0);

      // V-wake edges (the two diverging lines)
      float edgeDist = abs(across - wakeWidth);
      float edgeWake = exp(-edgeDist * edgeDist * 5000.0) * smoothstep(0.5, 0.0, behindDist);

      // Foam noise within wake envelope for organic texture
      float foamNoise = snoise(v_uv * 30.0 + u_time * 0.5) * 0.5 + 0.5;
      foamNoise *= snoise(v_uv * 15.0 - u_time * 0.3) * 0.5 + 0.5;

      float emission = (centerWake * 2.0 + edgeWake * 1.5 + inWake * foamNoise * 0.3);
      emission *= u_boatSpeed * 3.0;
      emission *= smoothstep(0.6, 0.0, behindDist); // fade with distance behind

      foam += emission * u_dt;
      if (emission > 0.01) age = 0.0; // reset age for fresh foam
    }

    // Small splash at boat position
    float boatDist = length(v_uv - u_boatPos);
    foam += exp(-boatDist * boatDist * 3000.0) * u_boatSpeed * u_dt * 2.0;
  }

  foam = clamp(foam, 0.0, 1.5);

  fragColor = vec4(foam, age, 0.0, 1.0);
}
