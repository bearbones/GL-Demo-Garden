#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

// Composites the rock slab, crack shading, near-break ember glow,
// light-shaft bursts, camera shake, and — during the shatter phase —
// the rigid falling pieces over the freshly revealed next slab.

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_rock;        // current (cracking) slab
uniform sampler2D u_rockNext;    // slab revealed behind falling pieces
uniform sampler2D u_state;       // crack field (R = depth, G = energy)
uniform vec2 u_stateTexel;
uniform vec2 u_shake;            // camera shake offset, UV units
uniform float u_breakProgress;   // 0..1 how close to shattering
uniform vec4 u_burst;            // xy = light-shaft origin, z = seconds since
                                 // burst start (< 0 when inactive), w = strength
uniform float u_phase;           // 0 = intact, 1 = falling pieces
uniform float u_fallT;           // seconds since shatter began

const int NP = 12;
uniform vec2 u_pieceSeed[NP];    // Voronoi seeds, aspect-corrected UV space
uniform vec4 u_pieceState[NP];   // xy = offset, z = rotation (radians)

const float BURST_DUR = 0.5;

// The display pass binds the state texture through a LINEAR +
// CLAMP_TO_EDGE sampler object: hardware filtering replaces a manual
// 4-fetch bilinear, and edge texels never wrap to the opposite side of
// the slab (the texture itself is REPEAT-wrapped for the compute pass).
float crackDepth(vec2 uv) {
  return texture(u_state, uv).r;
}

// Shade one slab pixel: rock colour with crack crevices carved in
vec3 shadeRock(sampler2D rock, vec2 uv, float emberAmt) {
  vec3 col = texture(rock, uv).rgb;

  float d = crackDepth(uv);
  float dn = clamp(d / 6.0, 0.0, 1.0);
  // Hard threshold, set above the partial flood a near-break tap pushes
  // through the whole fault network: a crack is either formed and crisp
  // or invisible — no translucent fuzz, no brush-stroke tails.
  float m = smoothstep(0.85, 1.1, d);

  // Faint weathering stain hugging only the deep cracks
  vec2 o = u_stateTexel * 1.2;
  float ao = crackDepth(uv + vec2(o.x, 0.0)) + crackDepth(uv - vec2(o.x, 0.0)) +
             crackDepth(uv + vec2(0.0, o.y)) + crackDepth(uv - vec2(0.0, o.y));
  ao = clamp(ao * 0.25 - 0.6, 0.0, 1.0);
  col *= 1.0 - 0.14 * ao;

  // Chipped-edge rim light from the field gradient (key light top-left)
  vec2 g = vec2(
    crackDepth(uv + vec2(u_stateTexel.x, 0.0)) - crackDepth(uv - vec2(u_stateTexel.x, 0.0)),
    crackDepth(uv + vec2(0.0, u_stateTexel.y)) - crackDepth(uv - vec2(0.0, u_stateTexel.y)));
  float rim = clamp(dot(normalize(g + 1e-5), normalize(vec2(-0.7, 0.7))), 0.0, 1.0);
  col += rim * m * (1.0 - dn) * 0.18;

  // Dark crevice core, deeper cracks darker and visually wider
  col *= 1.0 - m * (0.5 + 0.42 * dn);

  // Near the breaking point, the deepest cracks smoulder from inside
  float deep = smoothstep(2.5, 5.5, d);
  float pulse = 0.7 + 0.3 * sin(u_time * 9.0 + uv.x * 20.0 + uv.y * 14.0);
  col += vec3(1.0, 0.55, 0.22) * deep * emberAmt * pulse;

  return col;
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = clamp(v_uv + u_shake, 0.001, 0.999);
  vec3 col;

  if (u_phase < 0.5) {
    // ── Intact slab ─────────────────────────────────────────────────
    float ember = smoothstep(0.75, 1.0, u_breakProgress) * 0.5;
    col = shadeRock(u_rock, uv, ember);
  } else {
    // ── Shatter: pieces fall away over the next slab ────────────────
    col = texture(u_rockNext, uv).rgb;
    col *= mix(0.72, 1.0, clamp(u_fallT / 0.7, 0.0, 1.0)); // dust settling

    vec2 uvA = vec2(uv.x * aspect, uv.y);
    for (int i = 0; i < NP; i++) {
      vec2 c = u_pieceSeed[i];
      vec4 ps = u_pieceState[i];
      // Inverse rigid transform: where was this pixel before the piece moved?
      vec2 q = uvA - c - ps.xy;
      float cs = cos(-ps.z);
      float sn = sin(-ps.z);
      vec2 p = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) + c;
      if (p.x < 0.0 || p.x > aspect || p.y < 0.0 || p.y > 1.0) continue;

      // Jittered Voronoi membership → jagged fracture boundaries
      vec2 pj = p + 0.014 * vec2(snoise(p * 27.0), snoise(p * 27.0 + 47.1));
      int best = 0;
      float b1 = 1e9;
      float b2 = 1e9;
      for (int k = 0; k < NP; k++) {
        float dk = distance(pj, u_pieceSeed[k]);
        if (dk < b1) { b2 = b1; b1 = dk; best = k; }
        else { b2 = min(b2, dk); }
      }
      if (best != i) continue;

      vec2 puv = vec2(p.x / aspect, p.y);
      vec3 rc = shadeRock(u_rock, puv, 0.0);   // pieces keep their crack marks
      float edge = smoothstep(0.045, 0.0, b2 - b1);
      rc *= 1.0 - 0.55 * edge;                 // raw fractured rim
      col = rc;
      break;
    }
  }

  // ── Light shafts bursting from deep cracks (brief) ────────────────
  float bt = u_burst.z;
  if (bt >= 0.0 && bt < BURST_DUR) {
    float env = smoothstep(0.0, 0.05, bt) * (1.0 - smoothstep(0.18, BURST_DUR, bt));
    vec2 bc = u_burst.xy;

    // March from this pixel toward the burst origin; deep cracks along
    // the ray emit light → radial streaks anchored to the crack shapes.
    const int NS = 22;
    vec2 pos = uv;
    vec2 delta = (bc - uv) / float(NS);
    float illum = 0.0;
    float w = 1.0;
    for (int i = 0; i < NS; i++) {
      pos += delta;
      illum += w * smoothstep(2.0, 4.5, crackDepth(pos));
      w *= 0.92;
    }
    illum /= 10.0;

    float dist = length((uv - bc) * vec2(aspect, 1.0));
    float coreFlash = exp(-dist * dist * 26.0) * 0.85;
    vec3 shaft = vec3(1.0, 0.9, 0.62);
    col += shaft * env * u_burst.w * (illum * (0.35 + exp(-dist * 2.2)) + coreFlash);
  }

  fragColor = vec4(col, 1.0);
}
