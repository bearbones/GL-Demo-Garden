#version 300 es
precision highp float;

#include "./mark-shape.glsl"

layout(location = 0) in vec4 a_ripple;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_squash;
uniform float u_handDrawn;
uniform float u_strokeWidth;
flat out vec4 v_ripple;

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 lower, upper;
  if (u_time < a_ripple.z) {
    vec2 head = rainHead(a_ripple, u_time, aspect);
    vec2 tail = head + normalize(vec2(-0.10, 1.0)) * rainLength(fract(a_ripple.w));
    vec2 pad = vec2(2.0 / 720.0 + 2.0 / u_resolution.y);
    lower = min(head, tail) - pad;
    upper = max(head, tail) + pad;
  } else {
    float seed = fract(a_ripple.w);
    float radius = rippleRadius(a_ripple) * 1.035;
    float squash = clamp(u_squash * mix(1.20, 0.80, a_ripple.y), 0.08, 1.0);
    float shear = abs((seed - 0.5) * 0.035 * u_handDrawn);
    vec2 center = rippleCenter(a_ripple, u_time, aspect);
    // Includes maximum pressure, contour excursion, edge retrace and pixel AA.
    float pad = (u_strokeWidth * 1.5 + 1.0) / 720.0 + 2.0 / u_resolution.y;
    vec2 extent = vec2(radius, radius * (squash + shear)) + pad;
    lower = center - extent;
    upper = center + extent;
  }
  vec2 corners[6] = vec2[6](vec2(0,0), vec2(1,0), vec2(0,1),
                            vec2(0,1), vec2(1,0), vec2(1,1));
  vec2 p = mix(lower, upper, corners[gl_VertexID]);
  vec2 uv = p / vec2(aspect, 1.0);
  v_ripple = a_ripple;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
