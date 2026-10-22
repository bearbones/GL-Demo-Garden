// Shared by the water and refracted bubble interiors. The same moving
// shafts remain continuous across the silhouette instead of being a decal.
vec3 waterColor(vec2 p, float aspect, float time) {
  float depth = clamp(p.y, 0.0, 1.0);
  vec3 color = mix(vec3(0.018, 0.065, 0.095), vec3(0.055, 0.235, 0.245), pow(depth, 1.25));
  float bend = 0.12 * sin(p.y * 4.4 + time * 0.22) + 0.06 * sin(p.y * 8.0 - time * 0.13);
  float beam = pow(max(0.0, 0.5 + 0.5 * sin((p.x + p.y * 0.23 + bend) * 6.7 + time * 0.11)), 12.0);
  float beam2 = pow(max(0.0, 0.5 + 0.5 * sin((p.x - p.y * 0.15 - bend * 0.4) * 10.0 - time * 0.08)), 22.0);
  color += vec3(0.08, 0.20, 0.18) * (beam * 0.45 + beam2 * 0.20) * (0.2 + depth * 0.8);
  float sheen = sin(p.x * 12.0 + p.y * 8.0 + time * 0.25) * sin(p.x * 4.5 - p.y * 10.0 - time * 0.17);
  color += vec3(0.006, 0.014, 0.014) * sheen;
  float vignette = clamp(1.0 - 0.19 * pow((p.x - aspect * 0.5) / max(aspect * 0.5, 0.01), 2.0), 0.65, 1.0);
  return color * vignette;
}
