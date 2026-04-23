#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/anime-style.glsl"

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  // ── Layer 1: Dark sky gradient ───────────────────────────────────
  vec3 color = mix(
    vec3(0.01, 0.01, 0.02),
    vec3(0.04, 0.02, 0.09),
    uv.y
  );

  // ── Layer 2: Starfield ───────────────────────────────────────────
  float gridSize = 60.0;
  vec2 starUV = uv * vec2(gridSize * aspect, gridSize);
  vec2 starCell = floor(starUV);
  vec2 starFrac = fract(starUV);

  float starSeed = hash21(starCell);
  if (starSeed > 0.96) {
    vec2 starOffset = hash22(starCell);
    float dist = length(starFrac - starOffset);
    float brightness = hash21(starCell + 137.0);
    float twinkle = 0.6 + 0.4 * sin(u_time * (1.5 + brightness * 3.0) + starSeed * 6.2831);
    float star = smoothstep(0.06, 0.0, dist) * brightness * twinkle;
    color += vec3(star * 0.8, star * 0.85, star);
  }

  // ── Layer 3: Aurora curtains ─────────────────────────────────────
  float freqs[3]  = float[3](1.8, 2.5, 3.5);
  float speeds[3] = float[3](0.07, -0.05, 0.1);
  float intens[3] = float[3](0.55, 0.4, 0.3);
  float yShift[3] = float[3](0.0, 0.05, -0.04);
  vec3  hueOff[3] = vec3[3](
    vec3(0.0, 0.33, 0.67),
    vec3(0.1, 0.45, 0.75),
    vec3(0.25, 0.55, 0.85)
  );

  for (int i = 0; i < 3; i++) {
    vec2 noiseCoord = vec2(
      uv.x * aspect * freqs[i] + u_time * speeds[i],
      uv.y * 1.2 + float(i) * 1.7
    );

    // Mouse warp
    vec2 toMouse = u_mouse - uv;
    float mouseDist = dot(toMouse, toMouse);
    float mouseInfluence = 0.35 * exp(-mouseDist * 3.5);
    noiseCoord += toMouse * mouseInfluence * freqs[i];

    float n = fbm3(noiseCoord);
    float ridge = pow(1.0 - abs(n), 5.0);

    // Vertical envelope
    float envLow = 0.28 + yShift[i];
    float envHigh = 0.75 + yShift[i];
    float envelope = smoothstep(envLow, envLow + 0.18, uv.y)
                   * smoothstep(envHigh + 0.2, envHigh, uv.y);

    // Color: green at bottom of band, purple/magenta at top
    float hueT = (uv.y - envLow) / (envHigh - envLow + 0.2);
    vec3 auroraColor = 0.5 + 0.5 * cos(
      6.2831 * (hueOff[i] + hueT * 0.4 + u_time * 0.015)
    );

    // Glow bloom
    float glow = expGlow(1.0 - ridge, 0.6, 3.5);
    float finalRidge = ridge + glow * 0.25;

    color += auroraColor * finalRidge * envelope * intens[i];
  }

  // ── Layer 4: Atmospheric glow ────────────────────────────────────
  float atmoDist = max(0.0, 0.42 - uv.y);
  float atmoGlow = softGlow(atmoDist, 0.12, 7.0);
  color += vec3(0.08, 0.35, 0.18) * atmoGlow;

  // ── Layer 5: Mountain silhouette ─────────────────────────────────
  float mountainHeight = 0.11
    + 0.07 * fbm3(vec2(uv.x * aspect * 2.5 + 0.5, 0.0))
    + 0.025 * snoise(vec2(uv.x * aspect * 10.0, 1.0));
  float mountain = smoothstep(0.0, 0.004, uv.y - mountainHeight);
  color = mix(vec3(0.005, 0.005, 0.012), color, mountain);

  fragColor = vec4(color, 1.0);
}
