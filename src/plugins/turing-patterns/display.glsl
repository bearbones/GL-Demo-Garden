#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;

void main() {
  vec4 state = texture(u_state, v_uv);
  float A = state.r;
  float B = state.g;

  // Colormap: map concentrations to a nice palette
  float v = A - B;
  vec3 c1 = vec3(0.01, 0.02, 0.08); // deep blue-black
  vec3 c2 = vec3(0.1, 0.3, 0.6);    // ocean blue
  vec3 c3 = vec3(0.4, 0.8, 0.7);    // teal
  vec3 c4 = vec3(0.95, 0.9, 0.8);   // warm white

  vec3 color;
  if (v < 0.33) {
    color = mix(c1, c2, v / 0.33);
  } else if (v < 0.66) {
    color = mix(c2, c3, (v - 0.33) / 0.33);
  } else {
    color = mix(c3, c4, (v - 0.66) / 0.34);
  }

  fragColor = vec4(color, 1.0);
}
