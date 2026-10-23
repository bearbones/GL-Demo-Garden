#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "./background.glsl"

in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform sampler2D u_background;
uniform float u_time;
uniform float u_squash;
uniform float u_life;
uniform float u_strokeWidth;
uniform float u_rain;
uniform float u_handDrawn;
uniform float u_lineBoil;
uniform int u_palette;

const float TAU = 6.28318530718;
const int MAX_RIPPLES = 48;
uniform vec4 u_ripples[MAX_RIPPLES];
uniform int u_count;

// Pressure comes from a few deliberate brush passes. Unequal arc lengths and
// long tapered lifts replace the old regularly spaced sinusoidal cutouts.
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

// Broad deviations change the drawing's proportions, not its legibility.
// Sampling the unit circle keeps contour and pressure continuous at +/-pi.
float contour(vec2 dir, float theta, float seed) {
  return 0.010 * sin(theta * 2.0 + seed * 17.0)
       + 0.008 * sin(theta * 3.0 - seed * 23.0)
       + 0.004 * snoise(dir * 2.2 + seed * 33.0);
}

float ink(float distancePx, float widthPx, vec2 dir, float seed,
          float taper, float redraw, float front) {
  float pressure = 0.80 + 0.27 * snoise(dir * 2.4 + seed * 57.0)
                 + 0.16 * snoise(dir * 5.3 + seed * 19.0);
  // The facing arc carries a fuller stroke; the far arc is a lighter touch.
  pressure *= mix(0.64, 1.18, front);
  pressure = mix(1.0, pressure, u_handDrawn);
  float halfWidth = widthPx * pressure * mix(1.0, taper, u_handDrawn) * 0.5;
  float tooth = snoise(dir * 34.0 + vec2(seed * 97.0, 11.0));
  float edge = distancePx + tooth * 0.15 * u_handDrawn
             + redraw * u_lineBoil * 0.32;
  float coverage = 1.0 - smoothstep(halfWidth - 0.55, halfWidth + 0.55, abs(edge));
  coverage *= mix(1.0, smoothstep(0.0, 0.18, taper), smoothstep(0.0, 0.25, u_handDrawn));
  float dry = max(0.0, snoise(dir * 57.0 + seed * 113.0) - 0.05);
  float loading = 0.90 + 0.08 * snoise(dir * 3.0 + seed * 7.0);
  return coverage * mix(1.0, loading - dry * 0.23, u_handDrawn);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uvA = vec2(v_uv.x * aspect, v_uv.y);
  float pxScale = u_resolution.y;
  float widthPx = u_strokeWidth * pxScale / 720.0;
  vec3 water = texture(u_background, v_uv).rgb;
  float stroke = 0.0;
  // Only the tiny re-traced edge changes on twos. Geometry, births, fading
  // and current remain continuous, so this never holds a whole animation.
  float cel = floor(u_time * 12.0);
  vec2 retrace = hash22(vec2(mod(cel, 4096.0), 72.4)) * 23.0;

  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= u_count) break;
    vec4 rp = u_ripples[i];
    float age = u_time - rp.z;
    if (age < 0.0 || age > u_life) continue;
    float kind = floor(rp.w), seed = fract(rp.w);
    float lifeFrac = age / u_life;
    float persp = mix(1.20, 0.65, rp.y);
    float squash = clamp(u_squash * mix(1.20, 0.80, rp.y), 0.08, 1.0);
    vec2 center = vec2(rp.x * aspect, rp.y)
      + vec2(cos(seed * 37.0), sin(seed * 37.0) * 0.35) * age * 0.003;
    vec2 p = uvA - center;
    // A slight hand-set slant, shared by all marks from this drop.
    p.y -= p.x * (seed - 0.5) * 0.035 * u_handDrawn;
    p.y /= squash;
    float r = length(p);
    float maxR = (kind < 0.5 ? 0.080 : kind < 1.5 ? 0.175 : 0.16) * persp;
    maxR *= 0.80 + 0.40 * seed;
    if (r > maxR * 1.035 + (widthPx + 2.0) / (pxScale * squash)) continue;
    vec2 dir = p / max(r, 1e-6);
    float theta = r > 1e-6 ? atan(dir.y, dir.x) : 0.0;
    // Convert radial distance in the ellipse to actual image-space distance.
    // This prevents the upper/lower edges collapsing into hairlines.
    float normalScale = max(length(vec2(dir.x, dir.y / squash)), 1.0);
    float front = 1.0 - smoothstep(-0.65, 0.55, dir.y);
    float rPix = r * pxScale;

    if (kind < 1.5) {
      int rings = kind < 0.5 ? 2 : 3;
      for (int k = 0; k < 3; k++) {
        if (k >= rings) break;
        float u = (lifeFrac - float(k) * 0.145) / 0.71;
        if (u <= 0.0 || u >= 1.0) continue;
        float radiusPx = maxR * (1.0 - (1.0 - u) * (1.0 - u)) * pxScale;
        // Conservative rejection includes contour, full screen-space width,
        // retracing and AA, even at the flattest supported perspective.
        if (abs(rPix - radiusPx) > radiusPx * 0.025 + (widthPx + 1.0) * normalScale) continue;
        float ringSeed = seed + float(k) * 0.381;
        float shape = contour(dir, theta, ringSeed) * u_handDrawn;
        float distancePx = (rPix - radiusPx * (1.0 + shape)) / normalScale;
        float taper = brushTaper(theta, ringSeed, u);
        float redraw = snoise(dir * 3.8 + ringSeed * 67.0 + retrace);
        float width = widthPx * mix(1.10, 0.65, u) * (kind < 0.5 ? 0.82 : 1.0);
        float alpha = ink(distancePx, width, dir, ringSeed, taper, redraw, front);
        float envelope = smoothstep(0.0, 0.055, u) * (1.0 - smoothstep(0.64, 1.0, u));
        stroke = max(stroke, alpha * envelope);
      }
      if (lifeFrac < 0.055) {
        float dotPx = length((uvA - center) * pxScale);
        float impact = 1.0 - smoothstep(0.15, max(0.3, widthPx * 0.85), dotPx);
        stroke = max(stroke, impact * (1.0 - lifeFrac / 0.055) * 0.8);
      }
    } else {
      float turns = 3.0;
      float R = maxR * (1.0 - pow(1.0 - min(lifeFrac * 1.25, 1.0), 2.0));
      float thetaN = theta / TAU + 0.5;
      float shape = contour(dir, theta, seed) * u_handDrawn;
      float winding = r / max(R * (1.0 + shape), 1e-5) * turns - thetaN;
      float turn = floor(winding + 0.5);
      float along = (turn + thetaN) / turns;
      if (turn >= 0.0 && turn < turns && along >= 0.0 && along <= 1.0) {
        float distancePx = (winding - turn) / turns * R * pxScale / normalScale;
        if (abs(distancePx) < widthPx + 1.0) {
          // Unwrapped arc length is continuous across the atan seam, unlike
          // a fresh random seed for each winding of the spiral.
          float taper = smoothstep(0.0, 0.10, along) * (1.0 - smoothstep(0.82, 1.0, along));
          float pressure = 0.77 + 0.23 * sin(along * 17.0 + seed * 12.0);
          float redraw = snoise(dir * 3.8 + along * 0.7 + seed * 67.0 + retrace);
          float alpha = ink(distancePx, widthPx * pressure, dir, seed, taper, redraw, front);
          alpha *= smoothstep(0.0, 0.04, lifeFrac) * (1.0 - smoothstep(0.55, 1.0, lifeFrac));
          stroke = max(stroke, alpha);
        }
      }
    }
  }

  vec3 color = mix(water, rippleInk(u_palette), clamp(stroke, 0.0, 1.0));
  // Sparse pale dry-brush rain, behind the ink. Continuous falling motion.
  if (u_rain > 0.001) {
    vec2 rainPos = vec2(uvA.x + v_uv.y * 0.025, v_uv.y);
    float column = floor(rainPos.x * 45.0);
    float seed = hash21(vec2(column, 17.0));
    if (seed > 1.0 - u_rain * 0.30) {
      float y = fract(rainPos.y + u_time * (1.4 + seed) + seed * 31.0);
      float dash = smoothstep(0.0, 0.02, y) * (1.0 - smoothstep(0.055, 0.11, y));
      float line = 1.0 - smoothstep(0.01, 0.045, abs(fract(rainPos.x * 45.0) - 0.5));
      color = mix(color, rippleInk(u_palette), dash * line * 0.07 * u_rain);
    }
  }
  fragColor = vec4(color, 1.0);
}
