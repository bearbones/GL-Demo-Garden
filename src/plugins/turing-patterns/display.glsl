#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec3 u_paper;
uniform vec3 u_ink;

void main() {
  vec4 state = texture(u_state, v_uv);
  float A = state.r;
  float B = state.g;

  // Map B concentration to pufferfish coloring:
  // Low B → golden yellow (background), High B → dark blue-black (maze lines)
  float t = smoothstep(0.05, 0.35, B);

  vec3 color = mix(u_paper, u_ink, t);

  fragColor = vec4(color, 1.0);
}
