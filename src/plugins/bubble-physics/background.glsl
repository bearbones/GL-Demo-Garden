#version 300 es
precision highp float;
#include "./water.glsl"
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_pointer;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  vec3 color = waterColor(p, aspect, u_time);
  if (u_pointer.z > 0.5) {
    float r = length(p - u_pointer.xy);
    float edge = abs(r - u_pointer.w);
    float width = 1.0 / u_resolution.y;
    // A quiet meniscus makes the held pressure surface discoverable.
    color += vec3(0.25, 0.52, 0.48) * exp(-edge / (width * 1.2)) * 0.6;
    color += vec3(0.035, 0.09, 0.08) * exp(-edge * 50.0);
  }
  fragColor = vec4(color, 1.0);
}
