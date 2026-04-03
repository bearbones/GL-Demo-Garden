#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_direction;   // (1/w, 0) for horizontal, (0, 1/h) for vertical
uniform float u_radius;     // blur radius multiplier

// 15-tap Gaussian blur with sigma ~= 5
void main() {
  // Gaussian weights for sigma ≈ 5.0, 15 taps
  const int TAPS = 15;
  const float weights[15] = float[15](
    0.0093, 0.0178, 0.0312, 0.0500, 0.0733,
    0.0983, 0.1205, 0.1353,
    0.1205, 0.0983, 0.0733,
    0.0500, 0.0312, 0.0178, 0.0093
  );

  vec3 result = vec3(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < TAPS; i++) {
    float offset = float(i - 7);
    vec2 coord = v_uv + u_direction * offset * u_radius;
    result += texture(u_source, coord).rgb * weights[i];
    totalWeight += weights[i];
  }

  fragColor = vec4(result / totalWeight, 1.0);
}
