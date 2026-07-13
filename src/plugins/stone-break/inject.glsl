#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

// Splats fracture energy into the damage field at the tap point, stamps a
// small impact crater, and scores a handful of short radial spokes so every
// strike spiderwebs immediately (the compute passes then extend the web
// outward along the rock's fault lines).

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_center;      // tap position, state UV space (origin bottom-left)
uniform float u_energy;
uniform float u_radius;     // energy splat radius, in units of frame height
uniform float u_aspect;
uniform float u_spokeRot;   // random rotation per tap
uniform float u_spokeCount;
uniform float u_spokeLen;   // spoke reach, in units of frame height

void main() {
  vec4 s = texture(u_state, v_uv);
  vec2 d = (v_uv - u_center) * vec2(u_aspect, 1.0);
  float r = length(d);

  float fall = exp(-r * r / (u_radius * u_radius));
  float e = s.g + u_energy * fall;

  float crater = fall * fall;
  crater *= crater;
  crater *= crater; // fall^8 — a small pockmark, not a wide disc

  // Radial spokes: sharp angular ridges, broken up along their length
  float theta = atan(d.y, d.x);
  float spoke = pow(0.5 + 0.5 * cos(theta * u_spokeCount + u_spokeRot), 60.0);
  spoke *= smoothstep(u_spokeLen, u_spokeLen * 0.2, r);
  spoke *= 0.55 + 0.65 * snoise(vec2(theta * 3.0 + u_spokeRot * 5.0, r * 40.0));
  spoke = max(spoke, 0.0);
  e += u_energy * 0.4 * spoke;

  // Strike-local damage saturates: repeat strikes on the same spot keep
  // pumping energy into the long cracks but don't chew a hole here.
  // The cap sits above the conduction gate so spokes act as short
  // conduits that carry strike energy out to nearby faults.
  float local = 0.35 * crater + 1.5 * spoke;
  float depth = max(s.r, min(s.r + local, 2.6));

  fragColor = vec4(depth, e, 0.0, 1.0);
}
