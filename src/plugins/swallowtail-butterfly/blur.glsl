#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_direction;   // (1/w, 0) for horizontal, (0, 1/h) for vertical
uniform float u_glowRadius;

// 15-tap Gaussian kernel (sigma ~4.5)
const float weights[8] = float[8](
  0.1353352832, 0.1238315369, 0.0948770038, 0.0607710517,
  0.0325514671, 0.0145896860, 0.0054679687, 0.0017118080
);

void main() {
  vec3 result = texture(u_source, v_uv).rgb * weights[0];

  for (int i = 1; i < 8; i++) {
    vec2 offset = u_direction * float(i) * u_glowRadius;
    result += texture(u_source, v_uv + offset).rgb * weights[i];
    result += texture(u_source, v_uv - offset).rgb * weights[i];
  }

  fragColor = vec4(result, 1.0);
}
