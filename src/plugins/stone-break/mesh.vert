#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_surface;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_kind;
uniform float u_aspect;
out vec2 v_surface;
out vec4 v_color;
out float v_kind;
void main() {
  gl_Position = vec4(a_position.x / u_aspect, a_position.y, 0.0, 1.0);
  v_surface = a_surface;
  v_color = a_color;
  v_kind = a_kind;
}
