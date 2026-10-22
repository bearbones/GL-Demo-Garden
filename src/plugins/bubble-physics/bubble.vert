#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_bubble; // center, radius, phase; height units
layout(location = 2) in vec4 a_surface; // deformation tensor, opacity, flex
uniform vec2 u_resolution;
out vec2 v_local;
out vec2 v_world;
flat out vec4 v_bubble;
flat out vec4 v_surface;
void main() {
  float deformation = length(a_surface.xy);
  float stretch = exp(deformation);
  float angle = deformation > 1e-6 ? 0.5 * atan(a_surface.y, a_surface.x) : 0.0;
  float c = cos(angle), s = sin(angle);
  mat2 rotation = mat2(c, s, -s, c);
  v_local = a_corner * 1.12;
  v_world = a_bubble.xy + rotation * (v_local * vec2(stretch, 1.0 / stretch)) * a_bubble.z;
  v_bubble = a_bubble;
  v_surface = a_surface;
  vec2 extent = vec2(u_resolution.x / u_resolution.y, 1.0);
  gl_Position = vec4(v_world / extent * 2.0 - 1.0, 0.0, 1.0);
}
