#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;       // bird shape + core glow
uniform sampler2D u_bloom;       // blurred glow
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_glowIntensity;
uniform float u_particleDensity;

// ── Constants ───────────────────────────────────────────────────────
const vec3 SKY_COLOR     = vec3(0.020, 0.031, 0.094);  // #050818
const vec3 WARM_FRINGE   = vec3(1.0, 0.627, 0.376);    // #ffa060
const float STAR_DENSITY = 800.0;
const float COLOR_SHIFT  = 0.15;

// Particle state (passed as uniforms would be complex, so generate procedurally)
const int MAX_PARTICLES = 40;

void main() {
  float aspect = u_resolution.x / u_resolution.y;

  // ── Starfield background ──
  vec2 starUV = v_uv * vec2(aspect, 1.0) * STAR_DENSITY;
  vec2 starCell = floor(starUV);
  vec2 starFrac = fract(starUV) - 0.5;

  float starBright = 0.0;
  // Check this cell and neighbors for stars
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 cell = starCell + vec2(float(dx), float(dy));
      vec2 starPos = hash22(cell) - 0.5;
      float dist = length(starFrac - starPos - vec2(float(dx), float(dy)));

      float h = hash21(cell);
      if (h > 0.92) { // only ~8% of cells have stars
        float twinkle = 0.6 + 0.4 * sin(u_time * (1.0 + h * 3.0) + h * 40.0);
        float brightness = (h - 0.92) / 0.08; // 0..1
        float star = brightness * twinkle * exp(-dist * dist * 400.0);
        starBright += star;
      }
    }
  }

  vec3 sky = SKY_COLOR + vec3(starBright * 0.9, starBright * 0.92, starBright);

  // ── Scene + bloom compositing ──
  vec3 scene = texture(u_scene, v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;

  // Color temperature shift at bloom fringe
  float bloomMag = dot(bloom, vec3(0.299, 0.587, 0.114));
  vec3 warmBloom = mix(bloom, bloom * WARM_FRINGE, COLOR_SHIFT * smoothstep(0.05, 0.3, bloomMag));

  // Additive composite
  vec3 color = sky + scene + warmBloom * u_glowIntensity;

  // ── Floating particles ──
  float particleGlow = 0.0;
  for (int i = 0; i < MAX_PARTICLES; i++) {
    if (float(i) >= u_particleDensity * float(MAX_PARTICLES)) break;

    float fi = float(i);
    float seed = fi * 0.1;

    // Particle position: slow upward drift with lateral wobble
    float px = 0.3 + 0.4 * hash21(vec2(fi, 0.0));
    float baseY = fract(hash21(vec2(fi, 1.0)) + u_time * (0.02 + 0.02 * hash21(vec2(fi, 2.0))));
    float py = baseY;
    px += sin(u_time * 0.5 + fi * 1.7) * 0.03;

    vec2 pPos = vec2(px, py);
    float dist = length((v_uv - pPos) * vec2(aspect, 1.0));

    // Soft radial particle
    float pSize = 0.003 + 0.004 * hash21(vec2(fi, 3.0));
    float particle = exp(-dist * dist / (pSize * pSize));

    // Fade at top/bottom edges
    float fade = smoothstep(0.0, 0.1, py) * smoothstep(1.0, 0.9, py);
    particleGlow += particle * fade * 0.4;
  }

  // Particles are pinkish-white
  vec3 particleColor = vec3(1.0, 0.75, 0.85);
  color += particleColor * particleGlow;

  // Tone mapping (soft clamp)
  color = color / (1.0 + color * 0.3);

  fragColor = vec4(color, 1.0);
}
