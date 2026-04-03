// ----- Anime-Style Rendering Helpers -----
// Requires: noise.glsl (snoise, hash21) to be included before this file

// Render an SDF distance as a hand-drawn ink stroke.
// d: signed distance to the stroke center line
// width: base half-width of the stroke
// seed: spatial coordinate used to generate breaks and variation
// breakFreq: how many breaks per unit of seed space
// breakAmount: 0 = no breaks, 1 = fully broken
// Returns: stroke alpha (0..1)
float inkStroke(float d, float width, float seed, float breakFreq, float breakAmount) {
  // Thickness variation along the stroke
  float thicknessNoise = snoise(vec2(seed * 3.7, 0.0)) * 0.3;
  float w = width * (1.0 + thicknessNoise);

  // Base stroke from SDF
  float stroke = 1.0 - smoothstep(0.0, w, abs(d));

  // Breaks / gaps — periodic noise-driven holes
  float breakNoise = snoise(vec2(seed * breakFreq, seed * breakFreq * 0.7 + 17.0));
  float breakMask = smoothstep(-0.2, 0.3, breakNoise * breakAmount);
  stroke *= breakMask;

  return stroke;
}

// Simplified inkStroke with fewer parameters
float inkStroke(float d, float width, float seed) {
  return inkStroke(d, width, seed, 4.0, 0.6);
}

// Soft radial glow — exponential falloff from center
// d: distance from glow center (positive = outside)
// intensity: peak brightness
// falloff: controls how quickly glow fades (higher = tighter)
float softGlow(float d, float intensity, float falloff) {
  return intensity * exp(-d * d * falloff);
}

// Layered glow with anime-style color fringe
// d: distance from glow source
// coreColor: bright center color
// fringeColor: color at glow edge
// intensity: overall brightness
// falloff: glow tightness
vec3 animeGlow(float d, vec3 coreColor, vec3 fringeColor, float intensity, float falloff) {
  float core = exp(-d * d * falloff * 4.0);
  float outer = exp(-d * d * falloff);
  vec3 color = mix(fringeColor, coreColor, core);
  return color * outer * intensity;
}

// Color posterization — reduces smooth gradients to stepped bands
vec3 posterize(vec3 color, float levels) {
  return floor(color * levels + 0.5) / levels;
}

// Anime-style specular highlight — hard-edged with soft falloff
float animeSpecular(float NdotH, float sharpness, float size) {
  return smoothstep(size - sharpness, size + sharpness, NdotH);
}
