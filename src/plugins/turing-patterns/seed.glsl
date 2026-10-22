#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform float u_seed;
uniform float u_density;
uniform float u_aspect;
uniform int u_layout;

float hash(vec2 p) {
  return fract(sin(dot(p + u_seed, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float B = 0.0;
  if (u_layout == 0) {
    // Preserve the original scattered field at the default density of 0.35.
    vec2 cell = floor(v_uv * 30.0);
    if (hash(cell) > 1.0 - u_density) {
      float d = length(fract(v_uv * 30.0) - 0.5);
      B = 1.0 - smoothstep(0.05, 0.4, d);
    }
  } else if (u_layout > 0) {
    vec2 p = (v_uv - 0.5) * vec2(u_aspect, 1.0) / min(u_aspect, 1.0);
    float d = length(p);
    if (u_layout == 2) {
      float angle = atan(p.y, p.x);
      float sector = 6.2831853 / 12.0;
      float nearest = floor(angle / sector + 0.5) * sector;
      d = length(p - 0.23 * vec2(cos(nearest), sin(nearest)));
    }
    B = 1.0 - smoothstep(0.018, 0.035, d);
  }
  fragColor = vec4(1.0, B, 0.0, 1.0);
}
