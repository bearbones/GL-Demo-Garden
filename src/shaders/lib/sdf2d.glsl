// ── 2D SDF Primitives ───────────────────────────────────────────────

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdLine(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdArc(vec2 p, float r, float aperture) {
  float ha = aperture * 0.5;
  vec2 sca = vec2(sin(ha), cos(ha));
  p.x = abs(p.x);
  float l = length(p) - r;
  float m = length(p - sca * clamp(dot(p, sca), 0.0, r));
  return max(l, m * sign(sca.y * p.x - sca.x * p.y));
}

// ── Smooth Boolean Operations ───────────────────────────────────────

float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

float opSmoothSubtraction(float d1, float d2, float k) {
  float h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
  return mix(d2, -d1, h) + k * h * (1.0 - h);
}
