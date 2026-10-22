#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_squash;       // ellipse foreshortening (1 = round, small = flat)
uniform float u_life;         // ripple lifetime in seconds
uniform float u_strokeWidth;  // stroke width, normalized to a 700px-tall frame
uniform float u_rain;         // 0..1 ambient rain amount
uniform float u_inkWobble;    // 0..1 restrained, smoothly evolving ink texture

// Each ripple: x, y in UV (origin bottom-left), birth time, kind + seed.
// kind = floor(w): 0 = small rain ring, 1 = tap rings, 2 = spiral.
const int MAX_RIPPLES = 48;
uniform vec4 u_ripples[MAX_RIPPLES];
uniform int u_count;

// ── Palette: flat gouache pond, pale hand-inked strokes ────────────
const vec3 WATER_DEEP   = vec3(0.075, 0.145, 0.160);
const vec3 WATER_MID    = vec3(0.180, 0.290, 0.315);
const vec3 WATER_LIGHT  = vec3(0.300, 0.415, 0.435);
const vec3 STROKE_COLOR = vec3(0.900, 0.935, 0.905);

// One hand-inked elliptical ring. Positions are pre-squashed; `dir` is the
// unit vector around the ring so noise wraps without a seam at ±π.
// Ink follows the ring's angular coordinates, with a slow continuous drift.
// Expansion and current always use real time; the texture never re-seeds.
float ringStroke(float rPix, float radiusPix, float widthPx, vec2 dir, float theta,
                 float seed, float gapCount, float gapPhase, float wobAmp, float gapBias, float inkTime) {
  // Almost every pixel is far from this thin stroke. Reject it before
  // evaluating noise, using a conservative bound on radial displacement.
  if (abs(rPix - radiusPix) > radiusPix * wobAmp + widthPx + 2.0) return 0.0;
  radiusPix *= 1.0 + wobAmp * snoise(dir * 1.6 + seed * 37.0 + inkTime);
  float w = widthPx * (1.0 + u_inkWobble * 0.18 * snoise(dir * 2.3 + seed * 53.0 + inkTime)) * 0.5;
  float alpha = 1.0 - smoothstep(w - 0.8, w + 0.8, abs(rPix - radiusPix));
  // Sparse, persistent gaps keep the painted character without flickering.
  float g = sin(theta * gapCount + gapPhase) + 0.25 * snoise(dir * 1.2 + seed * 71.0 + inkTime);
  return alpha * smoothstep(-0.80 + gapBias, -0.40 + gapBias, g);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uvA = vec2(v_uv.x * aspect, v_uv.y);
  // Pixel scale normalized so stroke widths are resolution-independent
  float pxScale = u_resolution.y;
  float widthPx = u_strokeWidth * u_resolution.y / 700.0;

  // ── Flat painted water: gradient + soft tonal blotches ───────────
  float blotch = fbm3(uvA * 1.9 + 7.3);
  float tone = clamp(0.42 + 0.38 * blotch + 0.18 * v_uv.y, 0.0, 1.0);
  vec3 water = mix(WATER_DEEP, WATER_MID, tone);

  // Soft sky-reflection patch, upper middle of frame
  vec2 glowP = uvA - vec2(aspect * 0.55, 0.68);
  water = mix(water, WATER_LIGHT, 0.30 * exp(-dot(glowP, glowP) * 4.5));

  // Gentle vignette toward frame edges
  float edge = smoothstep(0.0, 0.35, v_uv.x) * smoothstep(1.0, 0.65, v_uv.x)
             * smoothstep(0.0, 0.30, v_uv.y);
  water = mix(WATER_DEEP, water, 0.55 + 0.45 * edge);

  // ── Ripples ───────────────────────────────────────────────────────
  float stroke = 0.0;

  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= u_count) break;
    vec4 rp = u_ripples[i];
    float age = u_time - rp.z;
    if (age < 0.0 || age > u_life) continue;
    float kind = floor(rp.w);
    float seed = fract(rp.w);

    float lifeFrac = age / u_life;
    float inkTime = age * 0.045;

    // Perspective: ripples higher in frame are smaller and flatter
    float persp = mix(1.20, 0.65, rp.y);
    float squash = clamp(u_squash * mix(1.20, 0.80, rp.y), 0.05, 1.0);

    // Slight pond current: rings drift off-center as they expand
    float da = seed * 37.0;
    vec2 center = vec2(rp.x * aspect, rp.y) + vec2(cos(da), sin(da) * 0.5) * age * 0.006;

    vec2 p = uvA - center;
    p.y /= squash;
    float r = length(p);
    float maxR = (kind < 0.5 ? 0.068 : (kind < 1.5 ? 0.165 : 0.15)) * persp;
    if (kind < 1.5) maxR *= 0.75 + 0.5 * seed;
    // The entire ripple is local: skip direction, angle, and all ink noise
    // outside its largest possible footprint. No derivatives are needed.
    if (r > maxR * 1.016 + (widthPx + 2.0) / pxScale) continue;
    float rPix = r * pxScale;
    vec2 dir = p / max(r, 1e-5);
    float theta = atan(dir.y, dir.x);

    if (kind < 1.5) {
      // ── Concentric ring drop (rain = 2 rings, tap = 3) ─────────────
      float rings = kind < 0.5 ? 2.0 : 3.0;
      float dim = kind < 0.5 ? 0.85 : 1.0;

      for (int k = 0; k < 3; k++) {
        if (float(k) >= rings) break;
        float u = (lifeFrac - float(k) * 0.16) / 0.70;
        if (u <= 0.0 || u >= 1.0) continue;
        float radius = maxR * (1.0 - (1.0 - u) * (1.0 - u));  // ease-out
        float env = smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.72, 1.0, u));
        // Keep the ellipse readable throughout its life; aging primarily
        // thins and fades it rather than turning it into a wavy contour.
        float wobAmp = u_inkWobble * mix(0.004, 0.012, u);
        float gapBias = 0.12 * smoothstep(0.4, 1.0, u);
        float width = widthPx * mix(1.05, 0.70, u);
        float gapCount = 2.0 + floor(mod(seed * 13.0 + float(k), 2.0));
        float gapPhase = seed * 6.2832 + float(k) * 2.4;
        stroke += ringStroke(rPix, radius * pxScale, width, dir, theta, seed + float(k) * 0.31,
                             gapCount, gapPhase, wobAmp, gapBias, inkTime) * env * dim;
      }

      // Impact flash: a small dot right after the drop lands
      if (lifeFrac < 0.10) {
        stroke += (1.0 - smoothstep(0.0, widthPx * 1.6, rPix)) * (1.0 - lifeFrac / 0.10);
      }
    } else {
      // ── Spiral ripple (anime shorthand for dense concentric rings) ──
      float turns = 3.0;
      float R = maxR * (1.0 - pow(1.0 - min(lifeFrac * 1.25, 1.0), 2.0));
      if (r > R * 1.016 + (widthPx + 2.0) / pxScale) continue;
      float thetaN = theta / 6.2832 + 0.5;  // 0..1 around
      float rWob = r * (1.0 + u_inkWobble * 0.012 * snoise(dir * 1.6 + seed * 37.0 + inkTime));
      float rq = rWob / max(R, 1e-4);
      float m = rq * turns - thetaN;
      float k = floor(m + 0.5);
      float tAlong = (k + thetaN) / turns;           // 0 center → 1 outer tip

      if (k >= 0.0 && k < turns && tAlong < 1.0) {
        float dPix = abs(m - k) / turns * R * pxScale;
        float w = widthPx * (1.0 + u_inkWobble * 0.18 * snoise(dir * 2.1 + seed * 53.0 + inkTime)) * 0.5;
        float alpha = 1.0 - smoothstep(w - 0.8, w + 0.8, dPix);
        // Taper both ends of the spiral stroke
        alpha *= smoothstep(0.02, 0.12, tAlong) * (1.0 - smoothstep(0.80, 1.0, tAlong));
        // Sparse ink gaps remain attached to the expanding spiral.
        float g = sin(theta * 2.0 + seed * 6.2832 + k * 1.7) + 0.25 * snoise(dir * 1.3 + seed * 71.0 + inkTime);
        alpha *= smoothstep(-0.9 + 0.2 * smoothstep(0.5, 1.0, lifeFrac), -0.5, g);
        // Whole spiral fades in fast, out slow
        alpha *= smoothstep(0.0, 0.04, lifeFrac) * (1.0 - smoothstep(0.60, 1.0, lifeFrac));
        stroke += alpha;
      }
    }
  }

  vec3 color = mix(water, STROKE_COLOR, clamp(stroke, 0.0, 1.0));

  // ── Rain streaks: thin falling dashes, only when rain is up ───────
  if (u_rain > 0.001) {
    float cells = 70.0;
    float cx = floor(uvA.x * cells);
    float rn = hash21(vec2(cx, 17.0));
    if (rn > 1.0 - 0.30 * u_rain) {
      float speed = 1.6 + rn * 1.2;
      float f = fract(v_uv.y + u_time * speed + rn * 31.0);
      float dash = smoothstep(0.00, 0.03, f) * (1.0 - smoothstep(0.10, 0.16, f));
      float xProf = 1.0 - smoothstep(0.0, 0.10, abs(fract(uvA.x * cells) - 0.5));
      color += vec3(0.35, 0.40, 0.40) * dash * xProf * 0.10 * u_rain;
    }
  }

  fragColor = vec4(color, 1.0);
}
