#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;     // original bird render
uniform sampler2D u_bloom;     // blurred glow
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_glowIntensity;

#include "../../shaders/lib/noise.glsl"

// --- Constants ---
const vec3 SKY_TOP    = vec3(0.01, 0.01, 0.05);
const vec3 SKY_BOTTOM = vec3(0.02, 0.02, 0.08);
const float STAR_DENSITY = 400.0;
const float PARTICLE_COUNT = 30.0;
const vec3 PARTICLE_COLOR = vec3(1.0, 0.5, 0.7);
const float PARTICLE_DRIFT = 0.06;   // upward drift speed
const float COLOR_SHIFT = 0.15;      // bloom edge warm shift

// Starfield — hash-based
float starField(vec2 uv) {
  float stars = 0.0;
  vec2 cell = floor(uv * STAR_DENSITY);
  vec2 cellUV = fract(uv * STAR_DENSITY);
  float rnd = hash21(cell);
  if (rnd > 0.97) {
    float size = (rnd - 0.97) * 33.0;  // 0..1
    float brightness = size * size;
    float d = length(cellUV - 0.5);
    stars = brightness * smoothstep(0.1 * (1.0 + size), 0.0, d);
    // Twinkle
    stars *= 0.7 + 0.3 * sin(u_time * (2.0 + rnd * 5.0) + rnd * 6.28);
  }
  return stars;
}

// Floating particles (petals/sparks)
float particles(vec2 uv, vec2 aspect) {
  float result = 0.0;
  for (float i = 0.0; i < PARTICLE_COUNT; i++) {
    float seed = i * 0.127 + 0.31;
    float rnd1 = hash21(vec2(seed, seed * 2.1));
    float rnd2 = hash21(vec2(seed * 1.7, seed * 0.9));
    float rnd3 = hash21(vec2(seed * 3.1, seed * 1.3));

    // Base position: scattered around center, drifting upward
    float lifetime = mod(u_time * PARTICLE_DRIFT + rnd1 * 10.0, 1.0);
    float px = 0.3 + rnd2 * 0.4 + sin(u_time * 0.5 + rnd1 * 6.28) * 0.08;
    float py = mix(0.2, 0.9, lifetime);
    vec2 pPos = vec2(px, py);

    // Slight horizontal drift
    pPos.x += sin(u_time * 0.7 + rnd3 * 6.28) * 0.02;

    float d = length((uv - pPos) * aspect);
    float size = 0.003 + rnd3 * 0.004;
    float alpha = smoothstep(size, size * 0.3, d);

    // Fade in/out over lifetime
    alpha *= smoothstep(0.0, 0.1, lifetime) * smoothstep(1.0, 0.8, lifetime);
    alpha *= 0.4 + rnd1 * 0.6;

    result += alpha;
  }
  return result;
}

void main() {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);

  // Night sky background
  vec3 sky = mix(SKY_BOTTOM, SKY_TOP, v_uv.y);

  // Stars
  float stars = starField(v_uv);
  sky += vec3(0.8, 0.85, 1.0) * stars;

  // Sample scene and bloom
  vec3 scene = texture(u_scene, v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;

  // Color temperature shift at bloom edges: warmer (orange-pink) at fringe
  vec3 warmBloom = bloom + vec3(COLOR_SHIFT, -COLOR_SHIFT * 0.3, -COLOR_SHIFT * 0.5) * length(bloom);

  // Combine: sky + additive bloom + scene
  vec3 color = sky;
  color += warmBloom * u_glowIntensity;  // additive bloom
  color += scene;                         // original bright source

  // Particles
  float ptcl = particles(v_uv, aspect);
  color += PARTICLE_COLOR * ptcl * 0.6;

  // Tone mapping: soft clamp to prevent harsh clipping
  color = 1.0 - exp(-color * 1.2);

  fragColor = vec4(color, 1.0);
}
