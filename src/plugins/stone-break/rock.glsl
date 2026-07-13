#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

// Bakes one procedural rock/mineral slab into an RGBA8 texture.
// Run once per rock (and on resize) — never per frame.

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_seed;

// Round mineral flecks: one jittered blob per cell, present with `density`
float fleckLayer(vec2 p, float scale, float density, float seed) {
  vec2 cell = floor(p * scale);
  vec2 f = fract(p * scale);
  vec2 h = hash22(cell + seed);
  float present = step(1.0 - density, hash21(cell + seed + 13.0));
  vec2 ctr = 0.25 + 0.5 * h;
  float rad = 0.14 + 0.22 * hash21(cell + seed + 29.0);
  return present * smoothstep(rad, rad * 0.35, length(f - ctr));
}

// ── Speckled igneous: granite / basalt / diorite ────────────────────
vec3 igneous(vec2 p, float pick) {
  vec3 baseA, baseB, fleck;
  if (pick < 0.34) {        // pink granite
    baseA = vec3(0.62, 0.55, 0.50);
    baseB = vec3(0.78, 0.66, 0.60);
    fleck = vec3(0.16, 0.14, 0.15);
  } else if (pick < 0.67) { // basalt
    baseA = vec3(0.20, 0.21, 0.24);
    baseB = vec3(0.30, 0.32, 0.36);
    fleck = vec3(0.08, 0.08, 0.10);
  } else {                  // diorite
    baseA = vec3(0.58, 0.58, 0.56);
    baseB = vec3(0.74, 0.74, 0.71);
    fleck = vec3(0.12, 0.12, 0.13);
  }
  float mottle = 0.5 + 0.5 * fbm5(p * 2.5 + u_seed * 7.0);
  vec3 col = mix(baseA, baseB, mottle);

  // Mineral grain: two scales of round flecks plus fine sand noise
  col = mix(col, fleck, fleckLayer(p, 90.0, 0.4, u_seed) * 0.8);
  col = mix(col, fleck * 1.25, fleckLayer(p, 38.0, 0.3, u_seed + 51.0) * 0.55);
  col = mix(col, vec3(0.93, 0.91, 0.87), fleckLayer(p, 70.0, 0.08, u_seed + 87.0) * 0.7); // quartz glints
  col *= 0.94 + 0.06 * snoise(p * 240.0 + u_seed);
  return col;
}

// ── Banded sedimentary: sandstone / red rock / malachite ────────────
vec3 banded(vec2 p, float pick) {
  vec3 colA, colB, colC;
  if (pick < 0.34) {        // sandstone
    colA = vec3(0.76, 0.60, 0.42);
    colB = vec3(0.62, 0.46, 0.30);
    colC = vec3(0.83, 0.70, 0.52);
  } else if (pick < 0.67) { // red desert rock
    colA = vec3(0.62, 0.30, 0.20);
    colB = vec3(0.45, 0.20, 0.14);
    colC = vec3(0.74, 0.44, 0.28);
  } else {                  // malachite
    colA = vec3(0.05, 0.38, 0.26);
    colB = vec3(0.02, 0.22, 0.15);
    colC = vec3(0.22, 0.62, 0.44);
  }
  float warp = fbm3(p * 1.6 + u_seed * 3.0);
  float t = p.y * 10.0 + warp * 0.9 + u_seed;
  float band = fract(t);
  float id = hash21(vec2(floor(t), u_seed));
  vec3 col = mix(colA, colB, id);
  col = mix(col, colC, smoothstep(0.75, 0.95, band) * step(0.4, id));
  col *= 0.92 + 0.08 * snoise(p * 60.0 + u_seed);      // fine grit
  col *= 0.95 + 0.05 * fbm3(p * 5.0 - u_seed * 2.0);   // broad tone drift
  return col;
}

// ── Veined crystalline: marble / amethyst / jade ────────────────────
vec3 veined(vec2 p, float pick) {
  vec3 base, deep, vein;
  if (pick < 0.34) {        // white marble
    base = vec3(0.88, 0.87, 0.84);
    deep = vec3(0.70, 0.70, 0.72);
    vein = vec3(0.32, 0.32, 0.38);
  } else if (pick < 0.67) { // amethyst
    base = vec3(0.52, 0.36, 0.68);
    deep = vec3(0.28, 0.16, 0.44);
    vein = vec3(0.86, 0.78, 0.96);
  } else {                  // jade
    base = vec3(0.42, 0.62, 0.46);
    deep = vec3(0.22, 0.42, 0.30);
    vein = vec3(0.78, 0.88, 0.74);
  }
  vec2 w = vec2(fbm3(p * 2.2 + u_seed * 5.0), fbm3(p * 2.2 + u_seed * 5.0 + 17.3));
  vec3 col = mix(base, deep, 0.5 + 0.5 * fbm5(p * 3.0 + w * 1.5 + u_seed));
  float v1 = 1.0 - abs(snoise(p * 3.5 + w * 2.0 + u_seed * 11.0));
  float v2 = 1.0 - abs(snoise(p * 8.0 + w * 3.0 + u_seed * 23.0));
  col = mix(col, vein, pow(v1, 20.0) * 0.65 + pow(v2, 26.0) * 0.3);
  // crystalline facet shimmer
  float facet = hash21(floor(p * 26.0 + w * 4.0) + u_seed);
  col *= 0.93 + 0.14 * facet;
  return col;
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);

  float family = hash21(vec2(u_seed, 3.7));
  float pick = hash21(vec2(u_seed, 9.1));

  vec3 col;
  if (family < 0.34) col = igneous(p, pick);
  else if (family < 0.67) col = banded(p, pick);
  else col = veined(p, pick);

  // Broad top-left key light and edge vignette so the slab reads as lit
  col *= 0.9 + 0.18 * (1.0 - v_uv.x * 0.5 - (1.0 - v_uv.y) * 0.5);
  vec2 vig = v_uv * (1.0 - v_uv);
  col *= 0.75 + 0.25 * pow(vig.x * vig.y * 16.0, 0.25);

  fragColor = vec4(col, 1.0);
}
