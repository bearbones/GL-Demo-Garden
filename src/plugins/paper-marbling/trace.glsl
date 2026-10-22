#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// ── Backward replay of the marbling op list ──────────────────────────
// Every op (ink drop, stylus/comb stroke) is an exactly invertible map of
// the bath. A pixel is traced newest → oldest through the inverse maps; the
// first drop whose disk contains the traced point is the paint it shows.
// Nothing is ever resampled, so edges stay knife-sharp however hard the
// paint is combed. The same pass renders the live paint layer (ops newer
// than the bake, then the bake texture) and the progressive bake strips.

#include "../../shaders/lib/noise.glsl"

in vec2 v_uv;
out vec4 fragColor;

const int OPS_PER_ROW = 512; // must match index.ts

uniform sampler2D u_ops;      // RGBA32F, 3 texels per op
uniform int u_opEnd;          // trace ops [0, u_opEnd)
uniform int u_bakeCount;      // ops [0, u_bakeCount) are cached in u_bake
uniform sampler2D u_bake;     // premultiplied paint after u_bakeCount ops
uniform vec4 u_bakeRect;      // bath rect covered by u_bake (xy min, zw size)
uniform sampler2D u_flat;     // flattened paint from before op 0
uniform vec4 u_flatRect;      // zw = 0 when there is no flattened layer
uniform vec4 u_targetRect;    // bath rect this pass renders
uniform float u_pxPerBU;      // target pixels per bath unit
uniform float u_time;

// Stylus shape, in units of the op's rod size
const float ALONG = 2.6;    // along-path drag length α (sets pull distance)
const float ROUND = 0.8;    // rounding of the chevron tip
const float FALL = 3.0;     // cross-path falloff length
const float SUPPORT = 7.0;  // cross-path support, in falloff lengths

vec4 opTexel(int i, int j) {
  return texelFetch(u_ops, ivec2((i % OPS_PER_ROW) * 3 + j, i / OPS_PER_ROW), 0);
}

bool inRect(vec4 rect, vec2 p) {
  vec2 uv = (p - rect.xy) / rect.zw;
  return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
}

vec4 sampleRect(sampler2D s, vec4 rect, vec2 p) {
  return texture(s, (p - rect.xy) / rect.zw);
}

// Drops land small and spread: radius eases out over the spread time
float dropRadius(float R, float birth, float spread) {
  float u = clamp((u_time - birth) / spread, 0.0, 1.0);
  float v = 1.0 - u;
  return R * (1.0 - v * v * v);
}

// ── Paint shading ─────────────────────────────────────────────────────
// Shading is evaluated in the drop's birth frame, so the pigment mottle and
// the denser rim stretch and comb with the paint. `edgeGrad` is the screen
// gradient of the radial coordinate and `stretch` the Jacobian norm; both
// fade detail out before it would alias.
vec4 shadeDrop(vec3 col, float alpha, float seed, vec2 local, float R, float edgeGrad, float stretch) {
  float rho = length(local);
  // Pigment piles up slightly at the spreading front: a darker rim band
  float bandPx = 0.2 * R * u_pxPerBU / max(edgeGrad, 1e-6);
  float rim = mix(0.25, smoothstep(0.8, 1.0, rho), smoothstep(0.75, 2.5, bandPx));
  col *= 1.0 - 0.13 * rim;
  // Uneven pigment: low mottle plus fine grain, faded when compressed
  float cyclesPerPx = stretch / (R * u_pxPerBU);
  float m1 = snoise(local * 1.6 + seed * 31.7) * (1.0 - smoothstep(0.08, 0.25, cyclesPerPx * 1.6));
  float m2 = snoise(local * 5.5 + seed * 17.3) * (1.0 - smoothstep(0.08, 0.25, cyclesPerPx * 5.5));
  col *= 1.0 + 0.055 * m1 + 0.03 * m2;
  return vec4(col * alpha, alpha);
}

// ── Stylus / comb stroke ──────────────────────────────────────────────
// Each tine slides paint along lines parallel to its motion. On a line at
// offset h the paint moves at κ(h)·sech²(ξ/α) of the rod speed, ξ being its
// position relative to the rod. That 1D flow integrates in closed form:
//   G(ξ) = ξ + α s atan(s tanh(ξ/α)),  s = √(κ/(1−κ)),
// and a rod moving 0 → L maps the final relative position ξ₁ to the initial
// ξ₀ = G⁻¹(G(ξ₁) + L). The map is a bijection for any L, so a whole straight
// stroke is one op, and splitting a stroke in two composes exactly.

float tanhSafe(float x) {
  float e = exp(-2.0 * abs(x));
  return sign(x) * (1.0 - e) / (1.0 + e);
}

float flowG(float x, float s, float a) {
  return x + a * s * atan(s * tanhSafe(x / a));
}

// 1 / G'(ξ) = 1 − κ sech²(ξ/α)
float flowInvGp(float x, float k, float a) {
  float T = tanhSafe(x / a);
  return 1.0 - k * (1.0 - T * T);
}

// ∂G/∂κ, for the cross-path Jacobian term
float flowGk(float x, float k, float s, float a) {
  float sT = s * tanhSafe(x / a);
  float sk = 0.5 / (s * (1.0 - k) * (1.0 - k));
  return a * sk * (atan(sT) + sT / (1.0 + sT * sT));
}

// G⁻¹ by Newton. G is odd and concave on ξ ≥ 0, so starting left of the
// root (at y − G(∞) offset) converges monotonically.
float flowGinv(float Y, float k, float s, float a) {
  float y = abs(Y);
  float x = max(0.0, y - a * s * atan(s));
  for (int it = 0; it < 4; ++it) {
    x -= (flowG(x, s, a) - y) * flowInvGp(x, k, a);
  }
  return sign(Y) * x;
}

// Cross-path strength κ(h): a rounded cusp (pointed chevrons) with smooth
// cut-off at H so neighbouring comb tines never overlap by more than one.
vec2 crossProfile(float h, float k0, float rr, float c, float H) {
  float q = sqrt(h * h + rr * rr);
  float E = exp(-(q - rr) / c);
  float e0 = 0.5 * H;
  float u = clamp((abs(h) - e0) / (H - e0), 0.0, 1.0);
  float W = 1.0 - u * u * (3.0 - 2.0 * u);
  float dW = -sign(h) * 6.0 * u * (1.0 - u) / (H - e0);
  return vec2(k0 * E * W, k0 * E * (-h / (c * q) * W + dW));
}

void strokeOp(int i, vec4 o0, inout vec2 p, inout mat2 J) {
  vec4 o1 = opTexel(i, 1);
  vec4 o2 = opTexel(i, 2);
  vec2 a = o0.yz;
  vec2 ab = o1.xy - a;
  float L = length(ab);
  if (L < 1e-7) return;
  vec2 m = ab / L;
  vec2 nrm = vec2(-m.y, m.x);

  float K = o0.w;          // tine count
  float spacing = o1.z;
  float size = o1.w;       // rod size
  float k0 = o2.z;         // drag at the rod
  float alpha = ALONG * size;
  float rr = ROUND * size;
  float c = FALL * size;

  // Tines sit along the comb axis; split each offset into its cross-path
  // and along-path parts relative to this segment's motion
  float sigH = spacing * dot(o2.xy, nrm);
  float sigT = spacing * dot(o2.xy, m);
  float mid = (K - 1.0) * 0.5;

  vec2 d = p - a;
  float t = dot(d, m);
  float reach = 6.0 * alpha + mid * abs(sigT);
  if (t < -reach || t > L + reach) return;
  float hc = dot(d, nrm);

  float H = SUPPORT * c;
  float u = mid;
  if (K > 1.5) {
    H = min(H, 0.95 * abs(sigH));
    u = hc / sigH + mid;
  }
  float j0 = clamp(floor(u), 0.0, K - 1.0);
  float j1 = min(j0 + 1.0, K - 1.0);

  float tCur = t;
  float dtdt = 1.0;
  float dtdh = 0.0;
  bool touched = false;
  for (int pass = 0; pass < 2; ++pass) {
    float j = pass == 0 ? j1 : j0;
    if (pass == 1 && j0 == j1) break;
    float o = j - mid;
    float h = hc - o * sigH;
    if (abs(h) >= H) continue;
    float tl = tCur - o * sigT; // along coordinate in this tine's frame
    if (tl < -6.0 * alpha || tl > L + 6.0 * alpha) continue;
    vec2 kp = crossProfile(h, k0, rr, c, H);
    float k = kp.x;
    if (k < 1e-5) continue;
    float s = sqrt(k / (1.0 - k));
    float x1 = tl - L;
    float x0 = flowGinv(flowG(x1, s, alpha) + L, k, s, alpha);
    float igp0 = flowInvGp(x0, k, alpha);
    float fT = igp0 / flowInvGp(x1, k, alpha);
    float fH = (flowGk(x1, k, s, alpha) - flowGk(x0, k, s, alpha)) * kp.y * igp0;
    dtdh = fT * dtdh + fH;
    dtdt = fT * dtdt;
    tCur = x0 + o * sigT;
    touched = true;
  }
  if (!touched) return;
  p += (tCur - t) * m;
  J = (mat2(1.0) + outerProduct(m, (dtdt - 1.0) * m + dtdh * nrm)) * J;
}

void main() {
  vec2 q = u_targetRect.xy + v_uv * u_targetRect.zw;
  vec2 p = q;
  mat2 J = mat2(1.0);  // ∂p/∂q: traced position w.r.t. this pixel

  // Every edge in a marbled image is the boundary of some drop, with the
  // newer drop on one side. Pixels just outside a newer drop remember the
  // nearest one and blend toward it over a 1 px ramp.
  float nearPx = 1e6;
  vec4 nearCol = vec4(0.0);
  vec4 col = vec4(0.0);
  bool hit = false;

  for (int i = u_opEnd - 1; i >= 0; --i) {
    if (i < u_bakeCount && inRect(u_bakeRect, p)) {
      col = sampleRect(u_bake, u_bakeRect, p);
      hit = true;
      break;
    }
    vec4 o0 = opTexel(i, 0);
    if (o0.x > 0.5) {
      strokeOp(i, o0, p, J);
      continue;
    }

    // Ink drop: Jaffer's push p' = c + (p−c)·√(1 + R²/|p−c|²), inverted
    vec4 o1 = opTexel(i, 1);
    float R = dropRadius(o0.w, o1.x, o1.w);
    vec2 cen = o0.yz;
    vec2 dv = p - cen;
    float r2 = dot(dv, dv);
    float R2 = R * R;
    float r = sqrt(r2);
    vec2 n = dv / max(r, 1e-9);
    float edgeGrad = length(n * J);
    if (r2 < R2) {
      vec4 o2 = opTexel(i, 2);
      float stretch = length(J[0]) + length(J[1]);
      col = shadeDrop(o2.rgb, o1.z, o1.y, dv / max(R, 1e-6), R, edgeGrad, stretch);
      hit = true;
      break;
    }
    float sPx = (r - R) * u_pxPerBU / max(edgeGrad, 1e-9);
    if (sPx < nearPx) {
      nearPx = sPx;
      vec4 o2 = opTexel(i, 2);
      nearCol = vec4(o2.rgb * 0.87 * o1.z, o1.z);
    }
    float k = sqrt((r2 - R2) / r2);
    float g = R2 / (k * r2 * r2);
    J = mat2(k + g * dv.x * dv.x, g * dv.x * dv.y, g * dv.x * dv.y, k + g * dv.y * dv.y) * J;
    p = cen + dv * k;
  }

  if (!hit && u_flatRect.z > 0.0 && inRect(u_flatRect, p)) {
    col = sampleRect(u_flat, u_flatRect, p);
  }

  fragColor = mix(col, nearCol, 1.0 - clamp(nearPx, 0.0, 1.0));
}
