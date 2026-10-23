#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "./background.glsl"
#include "./mark-shape.glsl"

flat in vec4 v_ripple;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_squash;
uniform float u_life;
uniform float u_strokeWidth;
uniform float u_handDrawn;
uniform float u_lineBoil;
uniform int u_palette;
const float TAU = 6.28318530718;

vec3 linearInk() {
  vec3 color = rippleInk(u_palette);
  // Coverage is a fraction of light: blend into the sRGB ink attachment in
  // linear light so a stroke keeps its brightness as it crosses pixel edges.
  return mix(pow((color + 0.055) / 1.055, vec3(2.4)),
             color / 12.92, lessThanEqual(color, vec3(0.04045)));
}

// CDF of a unit square pixel projected onto a unit screen-space normal.
// Its difference integrates a thin stripe instead of leaving a half-opaque
// center when the stroke width tends to zero, as a smoothed abs(SDF) does.
float pixelCDF(float x, vec2 normal) {
  vec2 n = abs(normal);
  float a = max(n.x, n.y), b = min(n.x, n.y);
  if (b < 1e-4) return clamp(x / a + 0.5, 0.0, 1.0);
  float u = clamp(x + 0.5 * (a + b), 0.0, a + b);
  if (u < b) return u * u / (2.0 * a * b);
  if (u < a) return (u - 0.5 * b) / a;
  float v = a + b - u;
  return 1.0 - v * v / (2.0 * a * b);
}
float stripeCoverage(float distancePx, float halfWidth, vec2 normal) {
  return clamp(pixelCDF(distancePx + halfWidth, normal)
             - pixelCDF(distancePx - halfWidth, normal), 0.0, 1.0);
}
float resolved(float frequency, float angularPixel) {
  return 1.0 - smoothstep(0.25, 0.75, frequency * angularPixel);
}
float brushTaper(float theta, float seed, float age) {
  float a = mod(theta + seed * 19.0, TAU);
  float splitA = 1.70 + 0.55 * hash21(vec2(seed, 12.0));
  float splitB = 3.85 + 0.60 * hash21(vec2(seed, 31.0));
  float start = a < splitA ? 0.0 : a < splitB ? splitA : splitB;
  float end = a < splitA ? splitA : a < splitB ? splitB : TAU;
  float t = (a - start) / (end - start);
  float lift = 0.045 + 0.045 * hash21(vec2(seed, start + 41.0)) + 0.055 * age;
  return smoothstep(lift, lift + 0.15, t) * (1.0 - smoothstep(0.77, 0.97, t));
}
// Contour value and angular slope; the slope is needed for correct pixel
// coverage at the flattened tips, including the hand-set slant.
vec2 contour(vec2 dir, float theta, float seed, float footprint) {
  vec2 tangent = vec2(-dir.y, dir.x);
  float noiseValue = snoise(dir * 2.2 + seed * 33.0);
  float noiseSlope = (snoise((dir + tangent * 0.01) * 2.2 + seed * 33.0)
                   - snoise((dir - tangent * 0.01) * 2.2 + seed * 33.0)) / 0.02;
  vec2 c = vec2(0.010 * sin(theta * 2.0 + seed * 17.0),
                0.020 * cos(theta * 2.0 + seed * 17.0)) * resolved(2.0, footprint)
         + vec2(0.008 * sin(theta * 3.0 - seed * 23.0),
                0.024 * cos(theta * 3.0 - seed * 23.0)) * resolved(3.0, footprint)
         + vec2(noiseValue, noiseSlope) * 0.004 * resolved(2.2, footprint);
  return c * u_handDrawn;
}
vec2 screenGradient(vec2 radialGradient, float shear, float squash) {
  return vec2(radialGradient.x - shear * radialGradient.y / squash,
              radialGradient.y / squash);
}
float ink(float distancePx, float widthPx, vec2 normal, vec2 dir, float seed,
          float taper, float redraw, float front, float footprint) {
  float pressure = 0.80
    + 0.27 * snoise(dir * 2.4 + seed * 57.0) * resolved(2.4, footprint)
    + 0.16 * snoise(dir * 5.3 + seed * 19.0) * resolved(5.3, footprint);
  pressure *= mix(0.64, 1.18, front);
  pressure = mix(1.0, pressure, u_handDrawn);
  float halfWidth = widthPx * pressure * mix(1.0, taper, u_handDrawn) * 0.5;
  float tooth = snoise(dir * 34.0 + vec2(seed * 97.0, 11.0)) * resolved(34.0, footprint);
  float referencePixel = u_resolution.y / 720.0;
  float edge = distancePx + referencePixel * (tooth * 0.15 * u_handDrawn
      + redraw * u_lineBoil * 0.32 * resolved(3.8, footprint));
  float coverage = stripeCoverage(edge, halfWidth, normal);
  coverage *= mix(1.0, smoothstep(0.0, 0.18, taper), smoothstep(0.0, 0.25, u_handDrawn));
  float dry = max(0.0, snoise(dir * 57.0 + seed * 113.0) - 0.05) * resolved(57.0, footprint);
  float loading = 0.90 + 0.08 * snoise(dir * 3.0 + seed * 7.0) * resolved(3.0, footprint);
  return coverage * mix(1.0, loading - dry * 0.23, u_handDrawn);
}
float fallingRain(vec2 uvA, vec4 mark, float aspect) {
  float seed = fract(mark.w), px = u_resolution.y;
  vec2 head = rainHead(mark, u_time, aspect);
  vec2 axis = normalize(vec2(-0.10, 1.0));
  vec2 normal = vec2(axis.y, -axis.x);
  vec2 p = (uvA - head) * px;
  float along = dot(p, axis), lengthPx = rainLength(seed) * px;
  float t = clamp(along / lengthPx, 0.0, 1.0);
  float width = (0.9 + seed * 0.65) * px / 720.0 * pow(1.0 - t, 0.65);
  float distancePx = dot(p, normal) + sin(t * 5.0 + seed * 23.0) * 0.12 * px / 720.0;
  float ends = pixelCDF(along, axis) - pixelCDF(along - lengthPx, axis);
  return stripeCoverage(distancePx, width * 0.5, normal) * ends * (0.50 + seed * 0.22);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  // Native pixel centers are independent of how the local quad is clipped
  // or triangulated; interpolated UV roundoff can perturb thin-line coverage.
  vec2 uvA = gl_FragCoord.xy / u_resolution.y;
  vec4 rp = v_ripple;
  float age = u_time - rp.z;
  if (age < 0.0) {
    fragColor = vec4(linearInk(), fallingRain(uvA, rp, aspect));
    return;
  }
  if (age > u_life) discard;
  float kind = floor(rp.w), seed = fract(rp.w);
  float lifeFrac = age / u_life;
  float pxScale = u_resolution.y;
  float widthPx = u_strokeWidth * pxScale / 720.0;
  float squash = clamp(u_squash * mix(1.20, 0.80, rp.y), 0.08, 1.0);
  float shear = (seed - 0.5) * 0.035 * u_handDrawn;
  vec2 center = rippleCenter(rp, u_time, aspect);
  vec2 p = uvA - center;
  p.y = (p.y - p.x * shear) / squash;
  float r = length(p), rPix = r * pxScale;
  vec2 dir = r > 1e-6 ? p / r : vec2(1.0, 0.0);
  vec2 tangent = vec2(-dir.y, dir.x);
  float theta = atan(dir.y, dir.x);
  float approximateScale = length(screenGradient(dir, shear, squash));
  vec2 angularGradient = screenGradient(tangent, shear, squash) / max(rPix, 1e-4);
  float footprint = abs(angularGradient.x) + abs(angularGradient.y);
  float front = 1.0 - smoothstep(-0.65, 0.55, dir.y);
  float maxR = rippleRadius(rp);
  float stroke = 0.0;
  vec2 retrace = hash22(vec2(mod(floor(u_time * 12.0), 4096.0), 72.4)) * 23.0;

  if (kind < 1.5) {
    int rings = kind < 0.5 ? 2 : 3;
    for (int k = 0; k < 3; k++) {
      if (k >= rings) break;
      float u = (lifeFrac - float(k) * 0.145) / 0.71;
      if (u <= 0.0 || u >= 1.0) continue;
      float radiusPx = maxR * (1.0 - (1.0 - u) * (1.0 - u)) * pxScale;
      float pad = widthPx * 1.5 + pxScale / 720.0 + 1.0;
      if (abs(rPix - radiusPx) > radiusPx * 0.025 + pad * approximateScale) continue;
      float ringSeed = seed + float(k) * 0.381;
      vec2 shape = contour(dir, theta, ringSeed, footprint);
      vec2 gradient = screenGradient(dir - radiusPx * shape.y / max(rPix, 1e-4) * tangent, shear, squash);
      float scale = max(length(gradient), 1e-5);
      float distancePx = (rPix - radiusPx * (1.0 + shape.x)) / scale;
      float taper = brushTaper(theta, ringSeed, u);
      float redraw = snoise(dir * 3.8 + ringSeed * 67.0 + retrace);
      float width = widthPx * mix(1.10, 0.65, u) * (kind < 0.5 ? 0.82 : 1.0);
      float alpha = ink(distancePx, width, gradient / scale, dir, ringSeed, taper, redraw, front, footprint);
      float envelope = smoothstep(0.0, 0.055, u) * (1.0 - smoothstep(0.64, 1.0, u));
      stroke = max(stroke, alpha * envelope);
    }
    if (lifeFrac < 0.055) {
      float dotPx = length((uvA - center) * pxScale);
      float impact = exp(-dotPx * dotPx / max(0.25, widthPx * widthPx * 0.36));
      stroke = max(stroke, impact * (1.0 - lifeFrac / 0.055) * 0.8);
    }
  } else {
    float turns = 3.0;
    float R = maxR * (1.0 - pow(1.0 - min(lifeFrac * 1.25, 1.0), 2.0)) * pxScale;
    float thetaN = theta / TAU + 0.5;
    vec2 shape = contour(dir, theta, seed, footprint);
    // Evaluate all three windings so the nearest-turn selection cannot cut
    // through overlapping newborn strokes. At +/-pi the candidates shift
    // by one; the entering/leaving endpoints are always tapered to zero.
    for (int k = 0; k < 3; k++) {
      float along = (float(k) + thetaN) / turns;
      float radius = R * (1.0 + shape.x) * along;
      float slope = R * (shape.y * along + (1.0 + shape.x) / (TAU * turns));
      // A normal evaluated arbitrarily close to the origin is singular for
      // a spiral and falsely turns its center into ink. Use the candidate
      // curve's normal inside the curve, and the query normal outside it.
      vec2 gradient = screenGradient(dir - slope / max(max(rPix, radius), 1e-4) * tangent, shear, squash);
      float scale = max(length(gradient), 1e-5);
      float distancePx = (rPix - radius) / scale;
      if (abs(distancePx) > widthPx + 0.47 * pxScale / 720.0 + 0.71) continue;
      float taper = smoothstep(0.0, 0.10, along) * (1.0 - smoothstep(0.82, 1.0, along));
      float pressure = 0.77 + 0.23 * sin(along * 17.0 + seed * 12.0);
      float redraw = snoise(dir * 3.8 + along * 0.7 + seed * 67.0 + retrace);
      float alpha = ink(distancePx, widthPx * pressure, gradient / scale, dir, seed,
                        taper, redraw, front, footprint);
      // Endpoints belong to the spiral geometry even with Hand drawn = 0.
      alpha *= smoothstep(0.0, 0.035, along) * (1.0 - smoothstep(0.965, 1.0, along));
      stroke = max(stroke, alpha * smoothstep(0.0, 0.04, lifeFrac)
                   * (1.0 - smoothstep(0.55, 1.0, lifeFrac)));
    }
  }
  fragColor = vec4(linearInk(), clamp(stroke, 0.0, 1.0));
}
