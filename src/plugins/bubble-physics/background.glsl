#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;

void main() {
  // Deep water gradient: dark navy at bottom → dark teal at top
  vec3 deep   = vec3(0.01, 0.03, 0.08);
  vec3 shallow = vec3(0.02, 0.08, 0.14);
  vec3 bg = mix(deep, shallow, v_uv.y);

  // Subtle animated caustic ripple
  float c = 0.0;
  vec2 p = v_uv * 6.0;
  c += sin(p.x * 2.3 + u_time * 0.4) * sin(p.y * 2.7 - u_time * 0.3) * 0.5;
  c += sin(p.x * 1.7 - u_time * 0.5 + 1.0) * sin(p.y * 1.9 + u_time * 0.35) * 0.5;
  c = c * 0.5 + 0.5; // remap to 0–1
  bg += vec3(0.005, 0.015, 0.025) * c;

  fragColor = vec4(bg, 1.0);
}
