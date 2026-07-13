#version 300 es
precision highp float;

// Downsamples the crack field into a small grid for CPU readback.
// Each output texel supersamples its footprint (cracks are thin —
// point sampling would miss them) and reports:
//   R = fraction of samples cracked at all (depth > 0.3)
//   G = fraction of samples deeply cracked (depth > 1.4)
//   B = max depth in footprint / 8

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_gridSize;

const int K = 6;

void main() {
  vec2 cell = floor(v_uv * u_gridSize);
  float cracked = 0.0;
  float deep = 0.0;
  float mx = 0.0;
  for (int j = 0; j < K; j++) {
    for (int i = 0; i < K; i++) {
      vec2 suv = (cell + (vec2(float(i), float(j)) + 0.5) / float(K)) / u_gridSize;
      float d = texture(u_state, suv).r;
      cracked += step(0.3, d);
      deep += step(1.4, d);
      mx = max(mx, d);
    }
  }
  float n = float(K * K);
  fragColor = vec4(cracked / n, deep / n, clamp(mx / 8.0, 0.0, 1.0), 1.0);
}
