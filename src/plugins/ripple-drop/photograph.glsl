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

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec4 sceneAt(vec2 uv) {
  // Stay inside the painted plate even when weave exposes an image edge.
  vec2 halfTexel = 0.5 / max(u_artResolution, vec2(1.0));
  return texture(u_scene, clamp(uv, halfTexel, 1.0 - halfTexel));
}

vec3 brightInk(vec3 color) {
  // Diffusion comes from the creamy ink, not the dark painted water.
  return color * smoothstep(0.52, 0.88, dot(color, LUMA));
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
  if (softness > 0.0) {
    vec2 stepUV = filmPixel * (0.55 + 1.10 * softness);
    vec3 north = sceneAt(uv + vec2(0.0, stepUV.y)).rgb;
    vec3 south = sceneAt(uv - vec2(0.0, stepUV.y)).rgb;
    vec3 east = sceneAt(uv + vec2(stepUV.x, 0.0)).rgb;
    vec3 west = sceneAt(uv - vec2(stepUV.x, 0.0)).rgb;
    // Squaring is an economical approximation to linear-light diffusion.
    // Keep most of the center exposure so thin ink retains its identity.
    vec3 diffuse = sqrt(max(vec3(0.0), source.rgb * source.rgb * 0.40
      + (north * north + south * south + east * east + west * west) * 0.15));
    color = mix(source.rgb, diffuse, softness * 0.58);

    vec2 wide = filmPixel * (2.8 + 3.0 * softness) * 0.70710678;
    vec3 halo = brightInk(sceneAt(uv + wide).rgb)
              + brightInk(sceneAt(uv - wide).rgb)
              + brightInk(sceneAt(uv + vec2(wide.x, -wide.y)).rgb)
              + brightInk(sceneAt(uv + vec2(-wide.x, wide.y)).rgb);
    // A low-energy neutral-cream fringe, not a colored emissive bloom.
    color += halo * (0.25 * 0.035 * softness) * vec3(1.0, 0.99, 0.95);

    float luminance = dot(color, LUMA);
    float toe = 1.0 - smoothstep(0.04, 0.28, luminance);
    color += vec3(0.0060, 0.0062, 0.0060) * softness * toe;
    float breathing = 0.0035 * sin(u_time * 0.55)
                    + 0.0015 * sin(u_time * 0.79 + 1.3);
    color *= 1.0 + breathing * softness;
  }

  if (grain > 0.0) {
    // Grain belongs to the photographed plate and refreshes on its own
    // 24 Hz clock. Small correlated clumps avoid both TV static and an
    // overly smooth, cloud-like noise overlay.
    vec2 p = uv * filmSize;
    vec2 offset = hash22(vec2(frame, 217.3)) * 257.0;
    float fine = snoise(p * 0.88 + offset);
    float clump = snoise(p * 0.29 + offset + vec2(13.7, 39.1));
    float density = fine * 0.74 + clump * 0.26;
    float chroma = snoise(p * 0.42 + offset + vec2(71.2, 9.6));
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
