#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/sdf2d.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_birdPos;       // normalized bird center
uniform float u_wingSpread;   // 0.0–1.0

// ── Constants ───────────────────────────────────────────────────────
const vec3 CORE_COLOR   = vec3(1.0, 0.235, 0.627);   // #ff3ca0
const vec3 FRINGE_COLOR = vec3(1.0, 0.502, 0.753);   // #ff80c0
const float BIRD_SCALE  = 0.12;

// Bird SDF: body ellipse + wing arcs + tail
float birdSDF(vec2 p, float wingSpread) {
  // Body: horizontal ellipse
  vec2 bodyP = p / vec2(1.8, 1.0);
  float body = sdCircle(bodyP, BIRD_SCALE * 0.5);

  // Head: small circle offset forward
  float head = sdCircle(p - vec2(BIRD_SCALE * 0.7, BIRD_SCALE * 0.1), BIRD_SCALE * 0.25);

  float bird = opSmoothUnion(body, head, BIRD_SCALE * 0.3);

  // Wings: arcs extending from body, angle controlled by wingSpread
  float wingAngle = 1.2 + wingSpread * 1.0; // aperture
  float wingLen = BIRD_SCALE * (1.2 + wingSpread * 0.8);

  // Left wing (top)
  vec2 lwp = p - vec2(-BIRD_SCALE * 0.2, BIRD_SCALE * 0.15);
  lwp = vec2(lwp.x * 0.8 - lwp.y * 0.6, lwp.x * 0.6 + lwp.y * 0.8); // rotate
  float lwing = sdArc(lwp, wingLen, wingAngle) - BIRD_SCALE * 0.08;

  // Right wing (bottom)
  vec2 rwp = p - vec2(-BIRD_SCALE * 0.2, -BIRD_SCALE * 0.15);
  rwp = vec2(rwp.x * 0.8 + rwp.y * 0.6, -rwp.x * 0.6 + rwp.y * 0.8);
  float rwing = sdArc(rwp, wingLen, wingAngle) - BIRD_SCALE * 0.08;

  bird = opSmoothUnion(bird, lwing, BIRD_SCALE * 0.15);
  bird = opSmoothUnion(bird, rwing, BIRD_SCALE * 0.15);

  // Tail: elongated shape trailing behind
  vec2 tp = p - vec2(-BIRD_SCALE * 1.0, 0.0);
  tp /= vec2(2.5, 0.6);
  float tail = sdCircle(tp, BIRD_SCALE * 0.3);
  bird = opSmoothUnion(bird, tail, BIRD_SCALE * 0.2);

  return bird;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (uv - u_birdPos) * vec2(aspect, 1.0);

  float d = birdSDF(p, u_wingSpread);

  // Core shape: saturated magenta
  float coreMask = smoothstep(0.005, -0.005, d);

  // Inner glow falloff
  float glow = exp(-max(d, 0.0) * 15.0) * 1.5;

  // Color gradient: core → fringe
  vec3 color = mix(FRINGE_COLOR, CORE_COLOR, coreMask);
  float alpha = max(coreMask, glow);

  // Subtle pulsing
  float pulse = 1.0 + 0.08 * sin(u_time * 2.5);
  alpha *= pulse;

  fragColor = vec4(color * alpha, alpha);
}
