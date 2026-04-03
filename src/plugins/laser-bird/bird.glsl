#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_birdPos;      // normalized bird center position
uniform float u_wingSpread;   // wing spread angle (radians, ~0.4 - 1.2)

#include "../../shaders/lib/sdf2d.glsl"
#include "../../shaders/lib/noise.glsl"

// --- Constants ---
const vec3 CORE_COLOR  = vec3(1.0, 0.35, 0.65);  // hot pink
const vec3 BRIGHT_CORE = vec3(1.0, 0.85, 0.90);   // near-white pink
const float BIRD_SCALE = 0.12;                     // base scale relative to screen height

float birdSDF(vec2 p, float wingAngle) {
  // Body: horizontal ellipse
  float body = sdEllipse(p, vec2(0.035, 0.015));

  // Head: small circle at front
  float head = sdCircle(p - vec2(0.03, 0.005), 0.012);

  // Wings: two arced shapes spreading upward
  // Left wing
  vec2 lwp = p - vec2(-0.005, 0.005);
  float lwa = atan(lwp.y, -lwp.x);
  float lwd = length(lwp);
  float leftWing = abs(lwd - 0.07) - 0.006;
  // Mask to wing angle range
  float lwMask = smoothstep(wingAngle + 0.15, wingAngle, abs(lwa - 1.2));
  leftWing = mix(1.0, leftWing, lwMask);

  // Right wing (mirror)
  vec2 rwp = p - vec2(-0.005, -0.005);
  float rwa = atan(-rwp.y, -rwp.x);
  float rwd = length(rwp);
  float rightWing = abs(rwd - 0.07) - 0.006;
  float rwMask = smoothstep(wingAngle + 0.15, wingAngle, abs(rwa - 1.2));
  rightWing = mix(1.0, rightWing, rwMask);

  // Tail: thin elongated shape behind
  vec2 tp = p - vec2(-0.04, 0.0);
  float tail = sdEllipse(tp, vec2(0.025, 0.004));

  // Combine all parts
  float d = body;
  d = opSmoothUnion(d, head, 0.008);
  d = opSmoothUnion(d, leftWing, 0.01);
  d = opSmoothUnion(d, rightWing, 0.01);
  d = opSmoothUnion(d, tail, 0.008);

  return d;
}

void main() {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv;
  vec2 p = (uv - u_birdPos) * aspect;

  // Subtle wing animation
  float wingAngle = u_wingSpread + sin(u_time * 1.5) * 0.08;

  float d = birdSDF(p, wingAngle);

  // Core brightness: bright center fading outward
  float coreBright = exp(-max(d, 0.0) * max(d, 0.0) * 30000.0);
  float innerGlow = exp(-max(d, 0.0) * max(d, 0.0) * 3000.0);
  float outerGlow = exp(-max(d, 0.0) * max(d, 0.0) * 300.0);
  float wideGlow = exp(-max(d, 0.0) * max(d, 0.0) * 30.0);

  // Inside the shape: bright white-pink
  float inside = d < 0.0 ? 1.0 : 0.0;

  // Color layering
  vec3 color = vec3(0.0);
  color += BRIGHT_CORE * (inside + coreBright) * 1.5;
  color += CORE_COLOR * innerGlow * 1.2;
  color += vec3(0.9, 0.3, 0.5) * outerGlow * 0.8;
  color += vec3(0.7, 0.2, 0.35) * wideGlow * 0.4;

  // Slight pulsing
  float pulse = 1.0 + sin(u_time * 2.0) * 0.05;
  color *= pulse;

  fragColor = vec4(color, 1.0);
}
