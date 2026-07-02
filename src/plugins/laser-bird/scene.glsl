#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/sdf2d.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_birdPos;     // normalized center
uniform float u_form;       // 0 = bird, 1 = swallowtail butterfly (SDF morph)
uniform float u_boilRate;   // cel redraws per second

// ── Constants ───────────────────────────────────────────────────────
// The reference (Windaria's light-bird apparition) is a being of pure
// light: white-hot core, hot-pink body glow, deep red-magenta fringe.
// No outlines, no interior detail — the airbrushed glow IS the drawing.
const vec3 CORE_WHITE  = vec3(1.00, 0.93, 0.97);
const vec3 HOT_PINK    = vec3(1.00, 0.20, 0.55);
const vec3 DEEP_RED    = vec3(0.75, 0.02, 0.22);
const float S          = 0.16;   // creature scale

// Thick-stroke bezier: distance to curve minus a thickness tapering
// from `w0` at the root (t=0) to `w1` at the tip (t=1).
float wingStroke(vec2 p, vec2 A, vec2 B, vec2 C, float w0, float w1) {
  vec2 dt = sdBezier(p, A, B, C);
  float taper = mix(w0, w1, dt.y * dt.y); // quadratic: holds width, then tapers
  return dt.x - taper;
}

// ── Rising light-bird (phoenix gesture, wings swept up in a V) ─────
float birdSDF(vec2 p, float flap) {
  vec2 mp = vec2(abs(p.x), p.y);

  // Wing: one curved ribbon from shoulder sweeping up and out.
  // Flap flexes the outer half of the wing up/down.
  vec2 wA = vec2(S * 0.06, S * 0.24);
  vec2 wB = vec2(S * 0.70, S * (0.40 + 0.18 * flap));
  vec2 wC = vec2(S * 1.42, S * (1.36 + 0.45 * flap));
  float wing = wingStroke(mp, wA, wB, wC, S * 0.18, S * 0.015);

  // Leading-edge notch: carve the underside so the wing reads as a
  // crescent rather than a sausage.
  vec2 nA = vec2(S * 0.30, S * 0.02);
  vec2 nB = vec2(S * 0.85, S * (0.30 + 0.12 * flap));
  vec2 nC = vec2(S * 1.28, S * (1.18 + 0.40 * flap));
  float notch = wingStroke(mp, nA, nB, nC, S * 0.10, S * 0.03);
  wing = max(wing, -notch);

  // Body: slim vertical capsule with a small head nub between the wings
  float body = sdLine(p, vec2(0.0, S * 0.30), vec2(0.0, -S * 0.10)) - S * 0.065;
  float head = sdCircle(p - vec2(0.0, S * 0.40), S * 0.062);
  body = opSmoothUnion(body, head, S * 0.05);

  // Tail: thin beam trailing down to the source, swaying gently
  vec2 tA = vec2(0.0, -S * 0.05);
  vec2 tB = vec2(S * 0.10 * sin(u_time * 1.1), -S * 0.75);
  vec2 tC = vec2(S * 0.06 * sin(u_time * 0.7 + 2.0), -S * 1.55);
  float tail = wingStroke(p, tA, tB, tC, S * 0.055, S * 0.008);

  float bird = opSmoothUnion(wing, body, S * 0.10);
  bird = opSmoothUnion(bird, tail, S * 0.08);
  return bird;
}

// ── Swallowtail butterfly (kept from the original demo) ────────────
float butterflySDF(vec2 p, float flap) {
  vec2 mp = vec2(abs(p.x), p.y);

  float body = sdLine(p, vec2(0.0, -S * 0.45), vec2(0.0, S * 0.42)) - S * 0.055;
  float head = sdCircle(p - vec2(0.0, S * 0.5), S * 0.08);
  body = opSmoothUnion(body, head, S * 0.04);

  vec2 fwC = vec2(S * 0.42, S * 0.28);
  vec2 fwP = (mp - fwC) / vec2(1.05 * flap, 0.85);
  float forewing = sdCircle(fwP, S * 0.5);

  vec2 tipA = vec2(S * 0.25, S * 0.55);
  vec2 tipB = vec2(S * 1.0 * flap, S * 0.58);
  float fwTip = sdLine(mp, tipA, tipB) - S * 0.14;
  forewing = opSmoothUnion(forewing, fwTip, S * 0.18);

  vec2 hwC = vec2(S * 0.35, -S * 0.3);
  vec2 hwP = (mp - hwC) / vec2(0.95 * flap, 0.95);
  float hindwing = sdCircle(hwP, S * 0.44);

  vec2 tailA = vec2(S * 0.25, -S * 0.45);
  vec2 tailB = vec2(S * 0.62 * flap, -S * 1.0);
  float tail = sdLine(mp, tailA, tailB) - S * 0.045;
  hindwing = opSmoothUnion(hindwing, tail, S * 0.14);

  float wings = opSmoothUnion(forewing, hindwing, S * 0.1);
  float butterfly = opSmoothUnion(body, wings, S * 0.06);

  vec2 antTip = vec2(S * 0.32, S * 0.98);
  float antenna = sdLine(mp, vec2(0.0, S * 0.55), antTip) - S * 0.012;
  antenna = min(antenna, sdCircle(mp - antTip, S * 0.025));
  return min(butterfly, antenna);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (v_uv - u_birdPos) * vec2(aspect, 1.0);

  // Slow hover bob + flap
  p.y -= 0.012 * sin(u_time * 0.9);
  float flapBird = sin(u_time * 2.2);
  float flapFly  = 1.0 - 0.25 * (0.5 - 0.5 * sin(u_time * 3.2)); // 0.75..1.0

  // Morph between forms: SDFs interpolate cleanly
  float d = mix(birdSDF(p, flapBird), butterflySDF(p, flapFly), u_form);

  // Cel boil: the light being is repainted a few times a second —
  // edges waver and brightness flickers like hand-airbrushed cels.
  float tick = floor(u_time * u_boilRate);
  d += 0.0055 * snoise(p * 22.0 + tick * 29.7);
  float flicker = 0.90 + 0.10 * hash21(vec2(tick, 3.7)) + 0.05 * sin(u_time * 7.3);

  // ── Pure-light shading ─────────────────────────────────────────
  // Interior: white-hot center fading to pink at the silhouette edge.
  // The white ramp is deeper for the butterfly, whose SDF interior is
  // much thicker than the bird's slim ribbons — otherwise it whites out.
  float core = smoothstep(0.006, -0.006, d);
  float depth = smoothstep(0.0, -mix(0.065, 0.17, u_form), d);
  vec3 coreCol = mix(HOT_PINK, CORE_WHITE, depth);

  // Halo: tight hot glow + wide soft falloff, fringe shifting to red
  float glowTight = exp(-max(d, 0.0) * 26.0);
  float glowWide  = exp(-max(d, 0.0) * 7.0);
  vec3 halo = HOT_PINK * glowTight * 0.9 + mix(DEEP_RED, HOT_PINK, glowTight) * glowWide * 0.30;

  vec3 color = coreCol * core * 1.35 + halo * (1.0 - core * 0.4);
  color *= flicker;

  float alpha = clamp(max(core, glowWide * 0.55), 0.0, 1.0) * flicker;
  fragColor = vec4(color, alpha);
}
