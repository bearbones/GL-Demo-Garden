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

// Quadratic bezier curve A→C with control point B. Returns vec2(distance, t)
// where t ∈ [0, 1] is the curve parameter of the closest point — useful for
// tapering stroke thickness along the curve. B must not sit exactly on the
// midpoint of AC (degenerate: the curve collapses to a line).
// Analytic closest-point solve via Cardano; based on Inigo Quilez's sdBezier.
vec2 sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A;
  vec2 b = A - 2.0 * B + C;
  vec2 c = a * 2.0;
  vec2 d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx;
  float p3 = p * p * p;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p3;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    return vec2(length(d + (c + b * t) * t), t);
  }
  float z = sqrt(-p);
  float v = acos(q / (p * z * 2.0)) / 3.0;
  float m = cos(v);
  float n = sin(v) * 1.7320508;
  vec2 t2 = clamp(vec2(m + m, -n - m) * z - kx, 0.0, 1.0);
  float d1 = length(d + (c + b * t2.x) * t2.x);
  float d2 = length(d + (c + b * t2.y) * t2.y);
  return d1 < d2 ? vec2(d1, t2.x) : vec2(d2, t2.y);
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
