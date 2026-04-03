// ── Anime-Style Shader Utilities ────────────────────────────────────

// Renders SDF distance as a hand-drawn ink stroke with thickness variation
// and intentional breaks via noise
float inkStroke(float d, float width, float breakFreq, float seed) {
  // Noise-driven width variation
  float noiseVal = snoise(vec2(seed * 7.3, seed * 3.7));
  float w = width * (0.7 + 0.3 * noiseVal);

  // Break pattern: creates gaps in the stroke
  float breakNoise = snoise(vec2(seed * 13.1, seed * 5.9));
  float breakMask = smoothstep(-0.2, 0.3, sin(seed * breakFreq + breakNoise * 2.0));

  // Stroke alpha from SDF
  float inner = smoothstep(w, w * 0.3, abs(d));
  return inner * breakMask;
}

// Anime-style soft glow falloff
float softGlow(float d, float intensity, float falloff) {
  return intensity / (1.0 + pow(max(d, 0.0) * falloff, 2.0));
}

// Exponential glow for bloom passes
float expGlow(float d, float intensity, float falloff) {
  return intensity * exp(-abs(d) * falloff);
}

// Color quantization for cel-shading / posterization
vec3 posterize(vec3 color, float levels) {
  return floor(color * levels + 0.5) / levels;
}
