#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;       // light-being core + near glow
uniform sampler2D u_bloom;       // blurred wide glow
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_glowIntensity;
uniform float u_petalDensity;
uniform vec2 u_birdPos;
uniform float u_boilRate;

// ── Constants ───────────────────────────────────────────────────────
const vec3 SKY_COLOR   = vec3(0.024, 0.030, 0.110);  // deep indigo night
const vec3 WARM_FRINGE = vec3(1.0, 0.45, 0.30);      // fringe shifts warm-red
const vec3 PETAL_PINK  = vec3(1.0, 0.25, 0.45);
const vec3 PETAL_DEEP  = vec3(0.85, 0.08, 0.30);
const float STAR_DENSITY = 800.0;
const float COLOR_SHIFT  = 0.22;
const int MAX_PETALS = 36;

// One glowing petal: a rotated squashed-ellipse blob with its own halo,
// like the rose petals swirling around the apparition in the reference.
float petalBlob(vec2 q, float angle, float size, float squash) {
  float c = cos(angle), s = sin(angle);
  q = mat2(c, -s, s, c) * q;
  q.y /= squash;
  float d2 = dot(q, q) / (size * size);
  return exp(-d2 * 1.8);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uvA = vec2(v_uv.x * aspect, v_uv.y);

  // ── Starfield ──
  vec2 starUV = uvA * STAR_DENSITY;
  vec2 starCell = floor(starUV);
  vec2 starFrac = fract(starUV) - 0.5;

  float starBright = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 cell = starCell + vec2(float(dx), float(dy));
      vec2 starPos = hash22(cell) - 0.5;
      float dist = length(starFrac - starPos - vec2(float(dx), float(dy)));
      float h = hash21(cell);
      if (h > 0.92) {
        float twinkle = 0.6 + 0.4 * sin(u_time * (1.0 + h * 3.0) + h * 40.0);
        starBright += (h - 0.92) / 0.08 * twinkle * exp(-dist * dist * 400.0);
      }
    }
  }
  vec3 sky = SKY_COLOR + vec3(starBright * 0.9, starBright * 0.92, starBright);

  // ── Scene + bloom ──
  vec3 scene = texture(u_scene, v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;

  // 80s transmitted-light look: the wide fringe shifts toward warm red
  float bloomMag = dot(bloom, vec3(0.299, 0.587, 0.114));
  vec3 warmBloom = mix(bloom, bloom * WARM_FRINGE, COLOR_SHIFT * smoothstep(0.02, 0.25, bloomMag));

  vec3 color = sky + scene + warmBloom * u_glowIntensity;

  // ── Glowing petals swirling around the apparition ──
  float tick = floor(u_time * u_boilRate);
  vec2 birdA = vec2(u_birdPos.x * aspect, u_birdPos.y);
  vec3 petalGlow = vec3(0.0);
  for (int i = 0; i < MAX_PETALS; i++) {
    if (float(i) >= u_petalDensity * float(MAX_PETALS)) break;
    float fi = float(i);
    float h1 = hash21(vec2(fi, 1.0));
    float h2 = hash21(vec2(fi, 2.0));
    float h3 = hash21(vec2(fi, 3.0));

    // Orbit-and-rise path around the light source
    float cycle = fract(h1 + u_time * (0.030 + 0.035 * h2));
    float orbitA = h3 * 6.2832 + u_time * (0.25 + 0.30 * h1) * (h2 > 0.5 ? 1.0 : -1.0);
    float orbitR = 0.10 + 0.38 * h2 + 0.10 * sin(u_time * 0.6 + fi);
    vec2 pos = birdA + vec2(cos(orbitA) * orbitR, sin(orbitA) * orbitR * 0.55 + (cycle - 0.35) * 0.55);

    // Chunky squashed blob, tumbling as it drifts
    float size = 0.010 + 0.016 * h3;
    float spin = u_time * (0.8 + h1 * 1.5) + fi;
    float blob = petalBlob(uvA - pos, spin, size, 0.55);

    // Per-petal flicker on the boil clock; fade at cycle ends
    float flick = 0.75 + 0.25 * hash21(vec2(tick, fi));
    float fade = smoothstep(0.0, 0.15, cycle) * (1.0 - smoothstep(0.75, 1.0, cycle));
    petalGlow += mix(PETAL_DEEP, PETAL_PINK, h3) * blob * flick * fade;
  }
  color += petalGlow * 0.85;

  // Tone mapping (soft clamp)
  color = color / (1.0 + color * 0.25);

  fragColor = vec4(color, 1.0);
}
