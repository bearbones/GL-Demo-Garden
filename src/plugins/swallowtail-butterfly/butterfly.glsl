#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/sdf2d.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_butterflyPos;   // normalized center
uniform float u_wingSpread;    // 0.0–1.0, user control for aperture

// ── Constants ───────────────────────────────────────────────────────
const vec3 CORE_COLOR   = vec3(1.0, 0.235, 0.627);   // #ff3ca0 magenta
const vec3 FRINGE_COLOR = vec3(0.624, 0.451, 1.0);   // #9f73ff violet
const vec3 VEIN_COLOR   = vec3(1.0, 0.90, 0.55);     // warm gold for wing veins
const float S           = 0.13;                      // butterfly scale

// Swallowtail butterfly SDF (viewed from above, symmetric about y-axis).
// `openness` scales wing extent horizontally; `flap` scales vertically
// for the flapping animation.
float butterflySDF(vec2 p, float openness, float flap) {
  // Mirror for left/right symmetry — build only the right half.
  vec2 mp = vec2(abs(p.x), p.y);

  // ── Body: thin vertical capsule with small head on top ──
  float body = sdLine(p, vec2(0.0, -S * 0.45), vec2(0.0, S * 0.42)) - S * 0.055;
  float head = sdCircle(p - vec2(0.0, S * 0.5), S * 0.08);
  body = opSmoothUnion(body, head, S * 0.04);

  // ── Forewing (upper): broad rounded shape with pointed outer tip ──
  vec2 fwC = vec2(S * 0.42 * openness, S * 0.28);
  vec2 fwP = (mp - fwC) / vec2(1.05 * flap, 0.85);
  float forewing = sdCircle(fwP, S * 0.5);

  // Characteristic swept tip
  vec2 tipA = vec2(S * 0.25 * openness, S * 0.55);
  vec2 tipB = vec2(S * 1.0  * openness * flap, S * 0.58);
  float fwTip = sdLine(mp, tipA, tipB) - S * 0.14;
  forewing = opSmoothUnion(forewing, fwTip, S * 0.18);

  // ── Hindwing (lower): rounded body with trailing swallowtail ──
  vec2 hwC = vec2(S * 0.35 * openness, -S * 0.3);
  vec2 hwP = (mp - hwC) / vec2(0.95 * flap, 0.95);
  float hindwing = sdCircle(hwP, S * 0.44);

  // Swallowtail: elongated trailing extension behind the hindwing
  vec2 tailA = vec2(S * 0.25 * openness, -S * 0.45);
  vec2 tailB = vec2(S * 0.62 * openness * flap, -S * 1.0);
  float tail = sdLine(mp, tailA, tailB) - S * 0.045;
  hindwing = opSmoothUnion(hindwing, tail, S * 0.14);

  // Combine wings, then attach to body
  float wings = opSmoothUnion(forewing, hindwing, S * 0.1);
  float butterfly = opSmoothUnion(body, wings, S * 0.06);

  // ── Antennae: thin curves from head, splayed upward/outward ──
  vec2 antBase = vec2(0.0, S * 0.55);
  vec2 antTip  = vec2(S * 0.32, S * 0.98);
  float antenna = sdLine(mp, antBase, antTip) - S * 0.012;
  float antClub = sdCircle(mp - antTip, S * 0.025);
  antenna = min(antenna, antClub);
  butterfly = min(butterfly, antenna);

  return butterfly;
}

float veinBand(vec2 p, vec2 a, vec2 b, float width) {
  float d = sdLine(p, a, b);
  return smoothstep(width, 0.0, d);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (uv - u_butterflyPos) * vec2(aspect, 1.0);

  // Flap animation: wings compress horizontally over time.
  float flapPhase = sin(u_time * 3.2);
  float flap = 1.0 - 0.25 * (0.5 - 0.5 * flapPhase); // 0.75..1.0
  float openness = mix(0.75, 1.15, u_wingSpread);

  float d = butterflySDF(p, openness, flap);

  float coreMask = smoothstep(0.005, -0.005, d);
  float glow = exp(-max(d, 0.0) * 14.0) * 1.4;

  // Wing vein pattern — only visible inside the core shape.
  vec2 mp = vec2(abs(p.x), p.y);
  float veins = 0.0;
  veins = max(veins, veinBand(mp, vec2(0.0, S * 0.1),  vec2(S * 0.85 * openness, S * 0.55), S * 0.012));
  veins = max(veins, veinBand(mp, vec2(0.0, S * 0.05), vec2(S * 0.75 * openness, S * 0.25), S * 0.012));
  veins = max(veins, veinBand(mp, vec2(0.0, 0.0),      vec2(S * 0.65 * openness, S * 0.0),  S * 0.012));
  veins = max(veins, veinBand(mp, vec2(0.0, -S * 0.1), vec2(S * 0.55 * openness, -S * 0.4), S * 0.012));
  veins = max(veins, veinBand(mp, vec2(0.0, -S * 0.2), vec2(S * 0.6  * openness * flap, -S * 0.95), S * 0.01));
  veins *= coreMask;

  vec3 color = mix(FRINGE_COLOR, CORE_COLOR, coreMask);
  color = mix(color, VEIN_COLOR, veins * 0.65);

  float alpha = max(coreMask, glow);
  float pulse = 1.0 + 0.08 * sin(u_time * 2.5);
  alpha *= pulse;

  fragColor = vec4(color * alpha, alpha);
}
