#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform vec2 u_artResolution;
uniform float u_time;
uniform float u_softness;
uniform float u_grain;
uniform float u_weave;
// Horizontal diffusion writes a native-size intermediate plate. The
// vertical pass finishes that plate with gate movement and emulsion grain.
uniform vec2 u_blurAxis;
uniform bool u_finish;
// An sRGB ink attachment is decoded automatically by the texture unit;
// the encoded RGBA8 diffusion intermediate still needs manual decoding.
uniform bool u_sourceLinear;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 linearLight(vec3 color) {
  return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)),
    greaterThan(color, vec3(0.04045)));
}

vec3 encodedLight(vec3 color) {
  color = max(color, vec3(0.0));
  return mix(color * 12.92, 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
    greaterThan(color, vec3(0.0031308)));
}

vec4 sceneAt(vec2 uv) {
  // Stay inside the painted plate even when weave exposes an image edge.
  vec2 halfTexel = 0.5 / max(u_artResolution, vec2(1.0));
  vec4 color = texture(u_scene, clamp(uv, halfTexel, 1.0 - halfTexel));
  // Clean drawing and the grain calculation operate in display-encoded
  // RGB. Re-encode the sRGB source here, including the all-zero fast path.
  if (u_sourceLinear) color.rgb = encodedLight(color.rgb);
  return color;
}

vec3 linearTexel(vec2 pixel) {
  ivec2 at = ivec2(clamp(pixel, vec2(0.0), u_artResolution - 1.0));
  vec3 color = texelFetch(u_scene, at, 0).rgb;
  return u_sourceLinear ? color : linearLight(color);
}

float erfApprox(float x) {
  float t = 1.0 / (1.0 + 0.3275911 * abs(x));
  float p = (((((1.061405429 * t - 1.453152027) * t)
    + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign(x) * (1.0 - p * exp(-x * x));
}

float integratedGaussian(float x, float sigma) {
  float z = x / sigma;
  return 0.5 * (x * erfApprox(z * 0.7071067812)
    + sigma * 0.7978845608 * exp(-0.5 * z * z));
}

vec3 diffusePlate(vec2 uv, float sigma) {
  vec2 pixel = uv * u_artResolution - 0.5;
  vec2 base = floor(pixel);
  vec2 phase = fract(pixel);
  if (!u_finish) {
    // Both native targets have identical dimensions, so eliminate only
    // floating-point UV roundoff, not any intended photographic movement.
    base = floor(pixel + 0.5);
    phase = vec2(0.0);
  }
  vec2 across = u_blurAxis.yx;
  float alongPhase = dot(phase, u_blurAxis);
  float acrossPhase = dot(phase, across);
  // At most 33 adjacent samples along each axis. The default uses 9
  // horizontal samples at 800 px high and 15 at 1688 px high. Never skip
  // texels as the photographic footprint grows on high-density screens.
  int radius = min(16, int(ceil(3.0 * sigma + 1.0)));
  vec3 sum = vec3(0.0);
  float mass = 0.0;
  // Consecutive tent weights share two Gaussian integrals. Carry them
  // forward so only one new integral is evaluated for each adjacent tap.
  float safeSigma = max(sigma, 0.025);
  float previous = integratedGaussian(-float(radius) - 1.0 - alongPhase, safeSigma);
  float current = integratedGaussian(-float(radius) - alongPhase, safeSigma);
  for (int tap = 0; tap <= 32; ++tap) {
    int i = tap - radius;
    if (i > radius) break;
    float distance = float(i) - alongPhase;
    float next = integratedGaussian(distance + 1.0, safeSigma);
    // Gaussian convolved with the one-pixel reconstruction tent. Its
    // narrow limit is bilinear sampling, including during gate weave.
    float weight = sigma < 0.025 ? max(1.0 - abs(distance), 0.0)
      : max(0.0, previous - 2.0 * current + next);
    previous = current;
    current = next;
    vec2 at = base + float(i) * u_blurAxis;
    vec3 sampleColor = linearTexel(at);
    // The first pass is registered to native texel centers. The finishing
    // pass may be shifted by weave: interpolate decoded neighbors, never
    // encoded RGB, so a moving thin stroke retains its light energy.
    if (u_finish) sampleColor = mix(sampleColor, linearTexel(at + across), acrossPhase);
    sum += sampleColor * weight;
    mass += weight;
  }
  return encodedLight(sum / max(mass, 1e-6));
}

float grainBand(float frequency, float footprint) {
  // Simplex noise has a broad spectrum; begin attenuation well before
  // Nyquist, and fully remove a band once its nominal cells are subpixel.
  return 1.0 - smoothstep(0.20, 0.50, frequency * footprint);
}

void main() {
  float softness = clamp(u_softness, 0.0, 1.0);
  float grain = clamp(u_grain, 0.0, 1.0);
  float weave = clamp(u_weave, 0.0, 1.0);
  if (softness == 0.0 && grain == 0.0 && weave == 0.0) {
    fragColor = sceneAt(v_uv);
    return;
  }

  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  // Optical size is measured against a 720-high photograph, independent
  // of output density and of the resolution used to paint the scene.
  vec2 filmSize = vec2(max(aspect, 1e-4), 1.0) * 720.0;
  vec2 filmPixel = 1.0 / filmSize;
  // Sigma is measured in reference photograph pixels. The support cap
  // covers DPR 1–3 at common desktop/phone sizes without sparse taps; at
  // extreme resolutions its bounded cost takes priority over a wider blur.
  float sigma = min(5.0, 1.30 * softness * u_artResolution.y / 720.0);
  if (!u_finish) {
    fragColor = vec4(diffusePlate(v_uv, sigma), sceneAt(v_uv).a);
    return;
  }
  float frame = mod(floor(max(u_time, 0.0) * 24.0), 4096.0);
  vec2 uv = v_uv;

  if (weave > 0.0) {
    // Slow mechanical wander plus a much smaller frame-to-frame gate
    // variation. This transforms the complete plate, never its layers.
    vec2 wander = vec2(
      0.28 * sin(u_time * 0.63) + 0.17 * snoise(vec2(u_time * 0.39, 7.1)),
      0.24 * sin(u_time * 0.51 + 1.8) + 0.17 * snoise(vec2(19.2, u_time * 0.43)));
    vec2 gate = (hash22(vec2(frame, 83.7)) - 0.5) * 0.24;
    uv += (wander + gate) * weave * filmPixel;
    // Rotation is also subpixel at the plate's edge; use film coordinates
    // so portrait and wide compositions receive the same tiny angle.
    vec2 plate = (uv - 0.5) * vec2(aspect, 1.0);
    float angle = 0.00015 * weave * sin(u_time * 0.47 + 0.6);
    plate += vec2(-plate.y, plate.x) * angle;
    uv = plate / vec2(max(aspect, 1e-4), 1.0) + 0.5;
  }

  vec4 source = sceneAt(uv);
  vec3 color = source.rgb;
  if (softness > 0.0 || weave > 0.0) color = diffusePlate(uv, sigma);

  if (grain > 0.0) {
    // Grain belongs to the photographed plate and refreshes on its own
    // 24 Hz clock. Small correlated clumps avoid both TV static and an
    // overly smooth, cloud-like noise overlay.
    vec2 p = uv * filmSize;
    vec2 offset = hash22(vec2(frame, 217.3)) * 257.0;
    float footprint = 720.0 / max(u_resolution.y, 1.0);
    float fineVisibility = grainBand(0.88, footprint);
    float clumpVisibility = grainBand(0.29, footprint);
    float fine = snoise(p * 0.88 + offset) * fineVisibility;
    float clump = snoise(p * 0.29 + offset + vec2(13.7, 39.1)) * clumpVisibility;
    // Keep the surviving emulsion texture legible at ordinary window
    // sizes. Bounded gain lets unresolved grain still fade away; it never
    // moves a noise band to a new frequency or amplifies chroma speckles.
    float resolved = 0.74 * fineVisibility + 0.26 * clumpVisibility;
    float grainGain = min(3.0, 1.0 / max(resolved, 0.001));
    float density = (fine * 0.74 + clump * 0.26) * grainGain;
    float chroma = snoise(p * 0.42 + offset + vec2(71.2, 9.6)) * grainBand(0.42, footprint);
    float luminance = clamp(dot(color, LUMA), 0.0, 1.0);
    float sensitivity = mix(0.45, 1.0, smoothstep(0.01, 0.18, luminance))
                      * mix(1.0, 0.45, smoothstep(0.55, 0.95, luminance));
    // The channels share almost all their noise. A faint opposing warm/
    // cool component suggests dye layers without independent RGB specks.
    vec3 emulsion = vec3(density) + chroma * vec3(0.12, -0.04, -0.10);
    color += emulsion * grain * sensitivity * 0.027;
  }

  fragColor = vec4(clamp(color, 0.0, 1.0), source.a);
}
